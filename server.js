'use strict';

/**
 * iTIC Accident Data Explorer
 * ------------------------------------------------------------
 * Zero-dependency Node.js server that
 *   1) serves the static UI from ./public
 *   2) proxies requests to https://api.iticfoundation.org/accidents
 *   3) keeps the API access token server-side (httpOnly session cookie)
 *
 * Run:  node server.js      (or: npm start)
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTrafficEvents } = require('./traffic-events');

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

// Minimal .env loader (no external dependency).
(function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env file - fine */
  }
})(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const API_BASE = (process.env.API_BASE || 'https://api.iticfoundation.org/accidents').replace(/\/+$/, '');
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000); // 8 h

// คีย์แผนที่ CARTO เก็บใน .env เท่านั้น ไม่ส่งไปที่เบราว์เซอร์ — เซิร์ฟเวอร์ดึงกระเบื้องแผนที่แทน (ดู /api/tiles)
const CARTO_KEY = process.env.CARTO_KEY || '';
const CARTO_BASE = (process.env.CARTO_BASE || 'https://basemaps.cartocdn.com').replace(/\/+$/, '');
if (!CARTO_KEY) console.warn('  !  ยังไม่ได้ตั้งค่า CARTO_KEY ใน .env — จะขอกระเบื้องแผนที่โดยไม่ใส่คีย์ (อาจถูกจำกัดโควตา)');
const UPSTREAM_TIMEOUT_MS = 60_000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'itic_sid';

/* ------------------------------------------------------------------ */
/* Session store (in memory)                                          */
/* ------------------------------------------------------------------ */

/** @type {Map<string, {token: string, username: string, roles: string[], permissions: string[], expiresAt: number}>} */
const sessions = new Map();

function createSession(payload, expiresInSeconds) {
  const id = crypto.randomBytes(24).toString('hex');
  const ttl = Math.min(
    SESSION_TTL_MS,
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : SESSION_TTL_MS
  );
  sessions.set(id, {
    token: payload.access_token,
    username: payload.username || '',
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    expiresAt: Date.now() + ttl,
  });
  return { id, ttl };
}

function getSession(req) {
  const sid = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return { sid, session };
}

function destroySession(req) {
  const sid = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (sid) sessions.delete(sid);
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expiresAt <= now) sessions.delete(sid);
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sendJSON(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

/** Call the upstream iTIC API and always return { status, ok, json, text }. */
async function upstream(pathname, { method = 'GET', body, token, form = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  const response = await fetch(API_BASE + pathname, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, text };
}

/** Map an upstream failure to a friendly API error. */
function upstreamError(result, fallbackMessage) {
  if (result.json && typeof result.json === 'object' && result.json.message) {
    return { status: result.status === 200 ? 502 : result.status, message: result.json.message };
  }
  if (result.status === 401 || result.status === 403) {
    return { status: 401, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบใหม่' };
  }
  return { status: 502, message: fallbackMessage || `การเชื่อมต่อ API ล้มเหลว (HTTP ${result.status})` };
}

const num = (value, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* Provinces (geocode reference data)                                 */
/* ------------------------------------------------------------------ */

const PROVINCES_FILE = path.join(__dirname, 'data', 'provinces.csv');
let provinceCache = null;

/** @returns {Array<{code: string, name_th: string, name_en: string}>} */
function loadProvinces() {
  if (provinceCache) return provinceCache;
  try {
    const text = fs.readFileSync(PROVINCES_FILE, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    lines.shift(); // header: Code,Province_TH,Province_EN
    provinceCache = lines
      .map((line) => {
        const [code = '', nameTh = '', nameEn = ''] = line.split(',');
        return { code: code.trim(), name_th: nameTh.trim(), name_en: nameEn.trim() };
      })
      .filter((province) => /^\d{2}$/.test(province.code) && province.name_th);
    console.log(`  ➜  provinces loaded: ${provinceCache.length}`);
  } catch (error) {
    console.error('[provinces] cannot read', PROVINCES_FILE, error.message);
    provinceCache = [];
  }
  return provinceCache;
}


/* ------------------------------------------------------------------ */
/* API routes                                                         */
/* ------------------------------------------------------------------ */

async function handleLogin(req, res) {
  const body = await readJSON(req);
  const user = String(body.user || '').trim();
  const pass = String(body.pass || '');

  if (!user || !pass) {
    return sendJSON(res, 400, { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  const result = await upstream('/auth/login', {
    method: 'POST',
    form: true,
    body: { user, pass },
  });

  const data = result.json && result.json.data;
  if (!result.ok || !data || !data.access_token) {
    const message =
      (result.json && result.json.data && typeof result.json.data === 'string' && result.json.data) ||
      (result.json && result.json.message) ||
      'เข้าสู่ระบบไม่สำเร็จ';
    return sendJSON(res, 401, { error: message });
  }

  const { id, ttl } = createSession(data, data.expires_in);
  const maxAge = Math.floor(ttl / 1000);

  sendJSON(
    res,
    200,
    {
      username: data.username || user,
      roles: data.roles || [],
      permissions: data.permissions || [],
      expiresIn: maxAge,
    },
    {
      'Set-Cookie': `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    }
  );
}

async function handleLogout(req, res) {
  destroySession(req);
  sendJSON(res, 200, { ok: true }, {
    'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  });
}

function handleSession(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 200, { authenticated: false });
  const { session } = found;
  sendJSON(res, 200, {
    authenticated: true,
    username: session.username,
    roles: session.roles,
    permissions: session.permissions,
    expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000),
  });
}

async function handleAccidents(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const input = await readJSON(req);

  const startDate = String(input.start_date || '');
  const endDate = String(input.end_date || '');
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return sendJSON(res, 400, { error: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' });
  }
  if (endDate < startDate) {
    return sendJSON(res, 400, { error: 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น' });
  }

  const limit = Math.min(Math.max(num(input.limit, 500), 1), 2000);
  const offset = Math.max(num(input.offset, 0), 0);

  const sourceId = num(input.source_id, 3);
  if (![1, 2, 3].includes(sourceId)) {
    return sendJSON(res, 400, { error: 'แหล่งข้อมูลไม่ถูกต้อง (1=RVP, 2=iTIC, 3=RAIS)' });
  }

  const geocode = String(num(input.geocode, -1)).padStart(2, '0');
  if (!loadProvinces().some((province) => province.code === geocode)) {
    return sendJSON(res, 400, { error: 'รหัสจังหวัด (geocode) ไม่ถูกต้อง' });
  }

  const body = {
    source_id: sourceId,
    severity_id: num(input.severity_id, 1),
    geocode: Number(geocode),
    start_date: startDate,
    end_date: endDate,
    keyword: String(input.keyword || ''),
    limit,
    offset,
  };

  // Optional spatial filter (point + buffer)
  if (input.point && num(input.point.lat, null) !== null && num(input.point.lon, null) !== null) {
    body.point = { lat: num(input.point.lat, 0), lon: num(input.point.lon, 0) };
    body.buffer = num(input.buffer, 1000);
  }

  const result = await upstream('/get_list', { method: 'POST', body, token: found.session.token });

  if (!result.ok || !result.json || result.json.success === false) {
    const err = upstreamError(result, 'ไม่สามารถดึงข้อมูลอุบัติเหตุได้');
    if (err.status === 401) destroySession(req);
    return sendJSON(res, err.status, { error: err.message });
  }

  sendJSON(res, 200, {
    total: Number(result.json.total) || 0,
    count: Array.isArray(result.json.data) ? result.json.data.length : 0,
    offset,
    limit,
    data: result.json.data || [],
  });
}

/* ------------------------------------------------------------------ */
/* Blackspots, clusters, district stats                               */
/* ------------------------------------------------------------------ */

const ORDER_TYPE_LABELS = {
  1: 'จำนวนอุบัติเหตุทั้งหมด',
  2: 'จำนวนอุบัติเหตุรุนแรง',
  3: 'จำนวนผู้เสียชีวิต',
  4: 'จำนวนผู้บาดเจ็บ',
  6: 'คะแนนความรุนแรง',
};

const DISTRICT_ID_RE = /^\d{2}(\d{2}(\d{2})?)?$/;

/** GET /api/clusters — ชุดการวิเคราะห์จุดเสี่ยง (cluster) */
async function handleClusters(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const cached = cacheGet('clusters');
  if (cached) return sendJSON(res, 200, cached);

  const result = await upstream('/cluster/get_list', { token: found.session.token });
  if (!result.ok || !result.json || result.json.success === false) {
    const err = upstreamError(result, 'ไม่สามารถดึงรายการ cluster ได้');
    if (err.status === 401) destroySession(req);
    return sendJSON(res, err.status, { error: err.message });
  }

  const list = Array.isArray(result.json.data) ? result.json.data : [];
  const defaultCluster = list.find((cluster) => cluster.is_default) || list[0] || null;

  const payload = {
    defaultId: defaultCluster ? defaultCluster.id : null,
    orderTypes: Object.entries(ORDER_TYPE_LABELS).map(([id, label]) => ({ id: Number(id), label })),
    data: list.map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      updated: cluster.updated || '',
      startDate: cluster.start_date || '',
      endDate: cluster.end_date || '',
      isDefault: Boolean(cluster.is_default),
      defaultOrderId: Number(cluster.default_order_id) || 1,
      max: cluster.max || null,
    })),
  };

  cacheSet('clusters', payload);
  sendJSON(res, 200, payload);
}

/** GET /api/blackspots?cluster_id&district_id&order_type_id&limit&offset&all */
async function handleBlackspots(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const clusterId = url.searchParams.get('cluster_id');
  const districtId = String(url.searchParams.get('district_id') || '').trim();
  const orderTypeId = String(url.searchParams.get('order_type_id') || '').trim();
  const fetchAll = url.searchParams.get('all') === '1';

  if (clusterId !== null && !/^\d+$/.test(clusterId)) {
    return sendJSON(res, 400, { error: 'cluster_id ไม่ถูกต้อง' });
  }
  if (districtId && !DISTRICT_ID_RE.test(districtId)) {
    return sendJSON(res, 400, { error: 'district_id ต้องเป็น 2 (จังหวัด), 4 (อำเภอ) หรือ 6 (ตำบล) หลัก' });
  }
  if (orderTypeId && !ORDER_TYPE_LABELS[orderTypeId]) {
    return sendJSON(res, 400, { error: 'order_type_id ไม่ถูกต้อง (1, 2, 3, 4 หรือ 6)' });
  }

  const limit = Math.min(Math.max(num(url.searchParams.get('limit'), 200), 1), 2000);
  const startOffset = Math.max(num(url.searchParams.get('offset'), 0), 0);
  const maxRows = 5000;

  const key = `blackspots:${clusterId || 'd'}:${districtId || '-'}:${orderTypeId || '-'}:${fetchAll ? 'all' : startOffset + ':' + limit}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached);

  const buildQuery = (offset, size) => {
    const params = new URLSearchParams();
    if (clusterId) params.set('id', clusterId);
    if (districtId) params.set('district_id', districtId);
    if (orderTypeId) params.set('order_type_id', orderTypeId);
    params.set('limit', String(size));
    if (offset) params.set('offset', String(offset));
    return `/blackspot/get_list?${params.toString()}`;
  };

  const rows = [];
  let offset = startOffset;
  let truncated = false;

  try {
    do {
      const size = fetchAll ? Math.min(2000, maxRows - rows.length) : limit;
      if (size <= 0) break;

      const result = await upstream(buildQuery(offset, size), { token: found.session.token });
      if (!result.ok || !result.json || result.json.success === false) {
        const err = upstreamError(result, 'ไม่สามารถดึงรายการจุดเสี่ยงได้');
        if (err.status === 401) destroySession(req);
        return sendJSON(res, err.status, { error: err.message });
      }

      const batch = Array.isArray(result.json.data) ? result.json.data : [];
      rows.push(...batch);
      offset += batch.length;

      if (!fetchAll) break;
      if (batch.length < size) break;
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
    } while (true);
  } catch (error) {
    const status = error.name === 'TimeoutError' ? 504 : 502;
    return sendJSON(res, status, { error: `ดึงรายการจุดเสี่ยงไม่สำเร็จ (${error.message})` });
  }

  const payload = {
    clusterId: clusterId ? Number(clusterId) : null,
    districtId,
    orderTypeId: orderTypeId ? Number(orderTypeId) : null,
    orderTypeLabel: orderTypeId ? ORDER_TYPE_LABELS[orderTypeId] : '',
    total: rows.length,
    truncated,
    data: rows,
  };

  cacheSet(key, payload);
  sendJSON(res, 200, payload);
}

/** GET /api/district-stats?lat&lon หรือ ?district_id&cluster_id */
async function handleDistrictStats(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const rawLat = url.searchParams.get('lat');
  const rawLon = url.searchParams.get('lon');
  const districtId = String(url.searchParams.get('district_id') || '').trim();
  const clusterId = url.searchParams.get('cluster_id');

  const params = new URLSearchParams();
  if (rawLat !== null && rawLon !== null) {
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return sendJSON(res, 400, { error: 'พิกัดไม่ถูกต้อง' });
    }
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  } else if (/^\d{4}$/.test(districtId)) {
    params.set('district_id', districtId);
  } else {
    return sendJSON(res, 400, { error: 'ต้องระบุ lat/lon หรือ district_id (4 หลัก)' });
  }
  if (clusterId && /^\d+$/.test(clusterId)) params.set('id', clusterId);

  const key = `district-stats:${params.toString()}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached);

  const result = await upstream(`/get_by_district?${params.toString()}`, { token: found.session.token });
  if (!result.ok || !result.json || result.json.success === false) {
    const err = upstreamError(result, 'ไม่สามารถดึงสถิติอำเภอได้');
    if (err.status === 401) destroySession(req);
    return sendJSON(res, err.status, { error: err.message });
  }

  const data = result.json.data || null;
  const payload = {
    district: data
      ? {
          districtId: data.district_id,
          provinceId: data.province_id,
          districtName: data.district_name || '',
          provinceName: data.province_name || '',
          clusterId: data.cluster_id,
          totalAccident: data.total_accident ?? 0,
          totalDeath: data.total_death ?? 0,
          totalInjured: data.total_injured ?? 0,
          totalAccidentWithDeath: data.total_accident_with_death ?? 0,
          totalAccidentWithInjured: data.total_accident_with_injured ?? 0,
          rankInCluster: data.rank_in_cluster ?? null,
          levelInCluster: data.severity_level_in_cluster || '',
          rankInProvince: data.rank_in_province ?? null,
          levelInProvince: data.severity_level_in_province || '',
          orderTypeId: data.order_type_id ?? null,
          orderTypeName: data.order_type_name || '',
        }
      : null,
  };

  cacheSet(key, payload);
  sendJSON(res, 200, payload);
}

/** GET /api/area-summary?lat&lon&radius&start_date&end_date — สรุปในรัศมี (RAIS) */
async function handleAreaSummary(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const radius = Number(url.searchParams.get('radius'));
  const startDate = String(url.searchParams.get('start_date') || '');
  const endDate = String(url.searchParams.get('end_date') || '');

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return sendJSON(res, 400, { error: 'พิกัดไม่ถูกต้อง' });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) {
    return sendJSON(res, 400, { error: 'รัศมีต้องอยู่ระหว่าง 1 ถึง 50,000 เมตร' });
  }
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate < startDate) {
    return sendJSON(res, 400, { error: 'ช่วงวันที่ไม่ถูกต้อง' });
  }

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: String(Math.round(radius)),
    start_date: startDate,
    end_date: endDate,
  });

  const key = `area-summary:${params.toString()}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached);

  const result = await upstream(`/get_summary_by_area?${params.toString()}`, { token: found.session.token });
  if (!result.ok || !result.json || result.json.success === false) {
    const err = upstreamError(result, 'ไม่สามารถดึงสรุปอุบัติเหตุในพื้นที่ได้');
    if (err.status === 401) destroySession(req);
    return sendJSON(res, err.status, { error: err.message });
  }

  const data = result.json.data || {};
  const payload = {
    totalAccident: data.total_accident ?? 0,
    totalDeath: data.total_death ?? 0,
    totalInjured: data.total_injured ?? 0,
    totalAccidentWithDeath: data.total_accident_with_death ?? 0,
    totalAccidentWithInjured: data.total_accident_with_injured ?? 0,
    startDate,
    endDate,
    radius: Math.round(radius),
  };

  cacheSet(key, payload);
  sendJSON(res, 200, payload);
}

/* ------------------------------------------------------------------ */
/* Area naming (iTIC + OpenStreetMap)                                 */
/* ------------------------------------------------------------------ */

const OSM_UA = 'iTIC-Accident-Explorer/1.0 (internal tool)';
const CACHE_TTL_MS = 10 * 60 * 1000;
const httpCache = new Map();
let lastOsmCall = 0;

function cacheGet(key) {
  const item = httpCache.get(key);
  if (!item) return null;
  if (item.expires <= Date.now()) {
    httpCache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  if (httpCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of httpCache) if (v.expires <= now) httpCache.delete(k);
  }
  httpCache.set(key, { value, expires: Date.now() + ttl });
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Nominatim (OpenStreetMap) call, throttled to ~1 request/second. */
async function osmFetch(pathname, params) {
  const gap = Date.now() - lastOsmCall;
  if (gap < 1100) await new Promise((resolve) => setTimeout(resolve, 1100 - gap));
  lastOsmCall = Date.now();

  const url = new URL(`https://nominatim.openstreetmap.org${pathname}`);
  for (const [key, value] of Object.entries({ ...params, format: 'jsonv2', 'accept-language': 'th' })) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': OSM_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  return response.json();
}

async function handleGeocode(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const query = String(url.searchParams.get('q') || '').trim();
  if (query.length < 2) return sendJSON(res, 400, { error: 'พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร' });

  const key = `geocode:${query.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, { data: cached });

  try {
    const items = await osmFetch('/search', { q: query, limit: 5, countrycodes: 'th' });
    const data = (items || [])
      .map((item) => ({
        name: item.name || item.display_name,
        displayName: item.display_name,
        lat: Number(item.lat),
        lon: Number(item.lon),
        type: item.type || '',
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));

    cacheSet(key, data);
    sendJSON(res, 200, { data });
  } catch (error) {
    sendJSON(res, 502, { error: `ค้นหาสถานที่จาก OpenStreetMap ไม่สำเร็จ (${error.message})` });
  }
}

async function handleArea(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return sendJSON(res, 400, { error: 'พิกัดไม่ถูกต้อง' });
  }

  const key = `area:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, { ...cached, cached: true });

  const token = found.session.token;
  const [blackspotResult, districtResult, osmResult] = await Promise.allSettled([
    upstream(`/blackspot/get_by_area?lat=${lat}&lon=${lon}`, { token }),
    upstream(`/get_by_district?lat=${lat}&lon=${lon}`, { token }),
    osmFetch('/reverse', { lat, lon, zoom: 18, addressdetails: 1 }),
  ]);

  const pickData = (result) =>
    result.status === 'fulfilled' && result.value.ok && result.value.json && result.value.json.data
      ? result.value.json.data
      : null;

  const blackspot = pickData(blackspotResult);
  const district = pickData(districtResult);
  const osm = osmResult.status === 'fulfilled' ? osmResult.value : null;
  const address = (osm && osm.address) || {};

  const title =
    address.junction ||
    (blackspot && blackspot.name) ||
    address.road ||
    (osm && osm.name) ||
    address.quarter ||
    address.suburb ||
    (district && district.district_name) ||
    'ไม่ทราบชื่อบริเวณ';

  const detailParts = [address.road, address.quarter, address.suburb, address.city].filter(
    (part, index, all) => Boolean(part) && part !== title && all.indexOf(part) === index
  );

  const payload = {
    title,
    detail: detailParts.join(' · '),
    road: address.road || (blackspot && blackspot.name) || '',
    subdistrict: address.quarter || '',
    district: (district && district.district_name) || address.suburb || '',
    province: (district && district.province_name) || address.city || address.state || '',
    displayName: (osm && osm.display_name) || '',
    osmName: (osm && osm.name) || '',
    osmOk: Boolean(osm),
    blackspot: blackspot
      ? {
          name: blackspot.name || '',
          subName: blackspot.sub_name || '',
          totalAccident: blackspot.total_accident,
          totalDeath: blackspot.total_death,
          totalInjured: blackspot.total_injured,
          rankInDistrict: blackspot.rank_in_district,
        }
      : null,
    districtStats: district
      ? {
          districtId: district.district_id,
          districtName: district.district_name,
          provinceName: district.province_name,
          totalAccident: district.total_accident,
          totalDeath: district.total_death,
          totalInjured: district.total_injured,
          rankInCluster: district.rank_in_cluster ?? null,
          levelInCluster: district.severity_level_in_cluster || '',
          rankInProvince: district.rank_in_province ?? null,
          levelInProvince: district.severity_level_in_province || '',
          clusterId: district.cluster_id ?? null,
          orderTypeName: district.order_type_name || '',
        }
      : null,
  };

  cacheSet(key, payload);
  sendJSON(res, 200, { ...payload, cached: false });
}

/* ------------------------------------------------------------------ */
/* Live traffic events (Longdo feed)                                  */
/* ------------------------------------------------------------------ */

const LONGDO_FEED = process.env.LONGDO_FEED || 'https://event.longdo.com/feed/json';
const EVENT_TTL_MS = 60 * 1000;

const EVENT_LABELS = {
  flood: 'น้ำท่วม',
  fire: 'เพลิงไหม้',
  accident: 'อุบัติเหตุ',
  roadclosed: 'ปิดถนน',
  diversion: 'เบี่ยงจราจร',
  carbreakdown: 'รถเสีย',
  earthquake: 'แผ่นดินไหว',
  event: 'กิจกรรม/พิธี',
  construction: 'ก่อสร้าง',
  protest: 'ชุมนุม',
  // icon ที่พบใน feed จริง (รหัส 10 / 8 / 7)
  trafficjam: 'รถติด',
  information: 'ประกาศ',
  crowd: 'การชุมนุม',
};

async function fetchLongdoEvents() {
  const cached = cacheGet('longdo:feed');
  if (cached) return cached;

  const response = await fetch(LONGDO_FEED, {
    headers: { 'User-Agent': OSM_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Longdo HTTP ${response.status}`);

  const raw = await response.json();
  if (!Array.isArray(raw)) throw new Error('รูปแบบข้อมูล Longdo ไม่ถูกต้อง');

  const seen = new Set();
  const events = [];

  for (const item of raw) {
    const lat = Number(item.latitude);
    const lon = Number(item.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // ตัดรายการที่ซ้ำ (feed มีหลาย entry ต่อเหตุการณ์เดียว)
    const key = `${item.title}|${item.start}|${lat},${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      id: String(item.eid || ''),
      title: item.title || item.title_en || '',
      titleEn: item.title_en || '',
      description: item.description || item.description_en || '',
      lat,
      lon,
      type: item.icon || 'other',
      // ถ้า feed ส่งรหัสประเภทตัวเลข (ตารางรหัสของ Longdo) มาด้วย เก็บไว้ใช้จับคู่กับคลังย้อนหลัง
      typeCode: item.type !== undefined && item.type !== '' && Number.isFinite(Number(item.type)) ? Number(item.type) : null,
      typeLabel: EVENT_LABELS[item.icon] || 'อื่น ๆ',
      start: item.start || '',
      stop: item.stop || '',
      contributor: item.contributor || '',
    });
  }

  events.sort((a, b) => String(b.start).localeCompare(String(a.start)));
  cacheSet('longdo:feed', events, EVENT_TTL_MS);
  return events;
}

async function handleEvents(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  // NOTE: Number(null) === 0 ซึ่งเป็นพิกัดที่ถูกต้อง จึงต้องเช็คว่ามีพารามิเตอร์จริงหรือไม่
  const rawLat = url.searchParams.get('lat');
  const rawLon = url.searchParams.get('lon');
  const lat = rawLat === null ? NaN : Number(rawLat);
  const lon = rawLon === null ? NaN : Number(rawLon);
  const radius = Number(url.searchParams.get('radius'));
  const bbox = String(url.searchParams.get('bbox') || '');

  let events;
  try {
    events = await fetchLongdoEvents();
  } catch (error) {
    return sendJSON(res, 502, { error: `ดึงข้อมูลเหตุการณ์ปัจจุบันไม่สำเร็จ (${error.message})` });
  }

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
  if (hasPoint) {
    const maxDistance = Number.isFinite(radius) && radius > 0 ? radius : 5000;
    events = events
      .map((event) => ({ ...event, distance: Math.round(haversineMeters(lat, lon, event.lat, event.lon)) }))
      .filter((event) => event.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);
  } else if (bbox) {
    const [minLat, minLon, maxLat, maxLon] = bbox.split(',').map(Number);
    if ([minLat, minLon, maxLat, maxLon].every(Number.isFinite)) {
      events = events.filter(
        (event) => event.lat >= minLat && event.lat <= maxLat && event.lon >= minLon && event.lon <= maxLon
      );
    }
  }

  sendJSON(res, 200, { total: events.length, data: events });
}

/* ------------------------------------------------------------------ */
/* เหตุการณ์จราจร: คลังย้อนหลัง (นกฮูก) + feed สด รวมเป็นชุดเดียว         */
/* ------------------------------------------------------------------ */

const trafficEvents = createTrafficEvents({
  baseDir: __dirname,
  // ระบุไฟล์เองด้วย EVENTS_FILE ไม่เช่นนั้นใช้ไฟล์ .tsv/.csv/.txt ที่ใหม่สุดในโฟลเดอร์ data/events
  archiveFile: process.env.EVENTS_FILE || '',
  archiveDir: path.join(__dirname, 'data', 'events'),
  fetchLive: fetchLongdoEvents,
  eventLabels: EVENT_LABELS,
  // group (ค่าเริ่มต้น) = ไม่ส่งชื่อบัญชีเจ้าหน้าที่รายบุคคลออกไป | full = ส่งชื่อบัญชีเต็ม | none = ไม่ส่งเลย
  contributorMode: ['group', 'full', 'none'].includes(process.env.EVENTS_CONTRIBUTOR)
    ? process.env.EVENTS_CONTRIBUTOR
    : 'group',
  // บัญชีหน่วยงานที่แสดงชื่อได้ในโหมด group (คั่นด้วยจุลภาค) — ค่าเริ่มต้น RVP ซึ่งเป็นผู้ให้ข้อมูลและปรากฏเป็น Cr.RVP
  orgAccounts: String(process.env.EVENTS_ORG_ACCOUNTS || 'RVP')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
});
trafficEvents.init();

async function handleTrafficEvents(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  sendJSON(res, 200, await trafficEvents.search(url.searchParams));
}

async function handleTrafficEventsMeta(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  sendJSON(res, 200, await trafficEvents.meta());
}

async function handleTrafficEventsExport(req, res) {
  const found = getSession(req);
  if (!found) return sendJSON(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });

  const url = new URL(req.url, 'http://localhost');
  const stamp = new Date().toISOString().slice(0, 10);

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="traffic_events_${stamp}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.write('\uFEFF'); // BOM ให้ Excel อ่านภาษาไทยถูกต้อง

  const write = (chunk) => new Promise((resolve) => res.write(chunk, resolve));
  try {
    await trafficEvents.exportCSV(url.searchParams, write);
  } finally {
    res.end();
  }
}

/* ------------------------------------------------------------------ */
/* Static files                                                       */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJSON(res, 403, { error: 'Forbidden' });
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

/* ------------------------------------------------------------------ */
/* Map tiles proxy — ซ่อนคีย์ CARTO ไว้ฝั่งเซิร์ฟเวอร์                      */
/* ------------------------------------------------------------------ */

const TILE_STYLES = { light: 'rastertiles/voyager', dark: 'dark_all' };
const TILE_PATH_RE = /^\/api\/tiles\/(light|dark)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(@2x)?\.png$/;

async function handleTile(req, res, match) {
  const text = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  };

  // ต้องเข้าสู่ระบบก่อน ไม่เช่นนั้นเซิร์ฟเวอร์จะกลายเป็นตัวกลางใช้โควตาคีย์ให้คนทั่วไป
  if (!getSession(req)) return text(401, 'กรุณาเข้าสู่ระบบก่อน');

  const [, style, zs, xs, ys, retina] = match;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys);
  if (z > 20 || x >= 2 ** z || y >= 2 ** z) return text(400, 'พิกัดกระเบื้องแผนที่ไม่ถูกต้อง');

  const query = CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : '';
  const upstream = `${CARTO_BASE}/${TILE_STYLES[style]}/${z}/${x}/${y}${retina || ''}.png${query}`;

  let response;
  try {
    response = await fetch(upstream, {
      headers: { 'User-Agent': OSM_UA, Accept: 'image/png,image/*;q=0.8' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return text(502, 'ดึงกระเบื้องแผนที่ไม่สำเร็จ'); // ไม่แนบรายละเอียดข้อผิดพลาด เพราะอาจมี URL ที่มีคีย์
  }

  if (!response.ok) {
    console.warn(`  ✗  tiles: CARTO ตอบ HTTP ${response.status}`); // ไม่บันทึก URL เพื่อไม่ให้คีย์หลุดลง log
    return text(502, `ดึงกระเบื้องแผนที่ไม่สำเร็จ (${response.status})`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': response.headers.get('content-type') || 'image/png',
    'Content-Length': body.length,
    'Cache-Control': 'private, max-age=86400', // แคชในเบราว์เซอร์ของผู้ใช้เท่านั้น ไม่ใช่แคชกลาง
  });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    const tileMatch = req.method === 'GET' ? TILE_PATH_RE.exec(pathname) : null;
    if (tileMatch) return await handleTile(req, res, tileMatch);
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, api: API_BASE });
    }
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return await handleLogout(req, res);
    if (pathname === '/api/session' && req.method === 'GET') return handleSession(req, res);
    if (pathname === '/api/clusters' && req.method === 'GET') return await handleClusters(req, res);
    if (pathname === '/api/blackspots' && req.method === 'GET') return await handleBlackspots(req, res);
    if (pathname === '/api/district-stats' && req.method === 'GET') return await handleDistrictStats(req, res);
    if (pathname === '/api/area-summary' && req.method === 'GET') return await handleAreaSummary(req, res);
    if (pathname === '/api/provinces' && req.method === 'GET') {
      return sendJSON(res, 200, { data: loadProvinces() });
    }
    if (pathname === '/api/accidents' && req.method === 'POST') return await handleAccidents(req, res);
    if (pathname === '/api/area' && req.method === 'GET') return await handleArea(req, res);
    if (pathname === '/api/geocode' && req.method === 'GET') return await handleGeocode(req, res);
    if (pathname === '/api/events' && req.method === 'GET') return await handleEvents(req, res);
    if (pathname === '/api/traffic-events' && req.method === 'GET') return await handleTrafficEvents(req, res);
    if (pathname === '/api/traffic-events/meta' && req.method === 'GET') return await handleTrafficEventsMeta(req, res);
    if (pathname === '/api/traffic-events/export' && req.method === 'GET') return await handleTrafficEventsExport(req, res);

    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'ไม่พบ endpoint นี้' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }
    return await serveStatic(req, res);
  } catch (error) {
    if (res.headersSent) return;
    const status = error.statusCode || 500;
    const message =
      error.name === 'TimeoutError'
        ? 'API ตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง'
        : status === 500
          ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
          : error.message;
    if (status === 500) console.error('[error]', error);
    sendJSON(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  iTIC Accident Data Explorer`);
  console.log(`  ➜  http://${HOST}:${PORT}`);
  console.log(`  ➜  upstream: ${API_BASE}\n`);
});
