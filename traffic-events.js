'use strict';

/**
 * เหตุการณ์จราจร (Traffic events)
 * ------------------------------------------------------------
 * รวม 2 แหล่งที่เป็นข้อมูลชุดเดียวกัน (สคีมาเดียวกัน) ให้เป็นชุดข้อมูลเดียว:
 *   1) คลังย้อนหลัง "นกฮูก" — ไฟล์ TSV/CSV รายปี (โหลดไว้ในหน่วยความจำ ไม่ส่งไฟล์ดิบไปที่เบราว์เซอร์)
 *   2) feed สดของ Longdo (ผ่าน fetchLive) — ถ้า eid ซ้ำกัน ให้ยึดข้อมูลสด
 *
 * ไฟล์ที่รองรับ: คั่นด้วย tab หรือ comma, มี BOM ได้, ฟิลด์ที่มีเครื่องหมายคำพูดและขึ้นบรรทัดใหม่ได้
 * คอลัมน์: eid, title, title_en, description, description_en, latitude, longitude, type, start, stop, contributor
 * วันที่: วัน/เดือน/ปี ชั่วโมง:นาที (เวลาไทย UTC+7)
 *
 * ไม่มี dependency ภายนอก
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ICT_OFFSET_MS = 7 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const THAILAND = { minLat: 5, maxLat: 21, minLon: 97, maxLon: 106 };

// ตารางรหัสประเภทอย่างเป็นทางการของ Longdo Event (รหัส 4 ไม่มีในเอกสาร)
// ชื่อ kind ของรหัสที่ตรงกับ icon ของ feed สดใช้ชื่อเดียวกัน (accident, flood, fire, …)
const CODE_KINDS = {
  1: 'carbreakdown',
  2: 'construction',
  3: 'accident',
  5: 'rain',
  6: 'flood',
  7: 'protest',
  8: 'info',
  9: 'checkpoint',
  10: 'trafficjam',
  11: 'misc',
  12: 'warning',
  13: 'event',
  14: 'sale',
  15: 'fire',
  16: 'complaint',
  19: 'roadclosed', // ไม่อยู่ในเอกสาร แต่พบใน feed JSON (icon roadclosed) — ข้อสังเกตจากข้อมูลจริง
};
const OFFICIAL_LABELS = {
  carbreakdown: 'รถเสีย',
  construction: 'ก่อสร้าง',
  accident: 'อุบัติเหตุ',
  rain: 'ฝนตก',
  flood: 'น้ำท่วม',
  protest: 'การชุมนุม',
  info: 'ประกาศ',
  checkpoint: 'ด่านตรวจ',
  trafficjam: 'รถติด',
  misc: 'จิปาถะ',
  warning: 'ระวัง',
  event: 'การจัดงาน',
  sale: 'ลดราคา',
  fire: 'เพลิงไหม้',
  complaint: 'ร้องเรียน',
  roadclosed: 'ปิดถนน',
};
// icon ใน feed JSON ที่ชื่อไม่ตรงกับ kind (ตัวอย่างจริง: รหัส 7 = crowd, รหัส 8 = information)
const ICON_ALIASES = { crowd: 'protest', information: 'info' };
// รหัสที่พบเพิ่มเติมนอกเอกสาร (ยังไม่มีในตารางทางการ)
const OBSERVED_CODES = new Set([19]);
const OFFICIAL_KIND_SET = new Set(Object.values(CODE_KINDS));

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const EXPORT_MAX = 200000;
const DESCRIPTION_OUT_MAX = 600;
const STAT_CHECK_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * อ่านข้อความแบบ delimited (tab/comma) รองรับ quoted field ที่มี delimiter, "" และขึ้นบรรทัดใหม่ในตัว
 * คืนอาร์เรย์ของแถว (แต่ละแถวเป็นอาร์เรย์ของฟิลด์)
 */
function parseDelimited(text, delimiter = '\t') {
  const rows = [];
  const n = text.length;
  const delim = delimiter.charCodeAt(0);
  const DQ = 34;
  let i = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0; // ตัด BOM
  let row = [];

  while (i < n) {
    let field;

    if (text.charCodeAt(i) === DQ) {
      let value = '';
      i += 1;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) {
          value += text.slice(i);
          i = n;
          break;
        }
        value += text.slice(i, q);
        if (text.charCodeAt(q + 1) === DQ) {
          value += '"';
          i = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      // ทนต่อไฟล์ที่มีตัวอักษรเกินหลังเครื่องหมายคำพูดปิด
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === delim || c === 10 || c === 13) break;
        j += 1;
      }
      if (j > i) value += text.slice(i, j);
      i = j;
      field = value;
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === delim || c === 10 || c === 13) break;
        j += 1;
      }
      field = text.slice(i, j);
      i = j;
    }

    row.push(field);
    if (i >= n) break;

    const t = text.charCodeAt(i);
    if (t === delim) {
      i += 1;
      if (i >= n) row.push('');
      continue;
    }

    i += t === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    rows.push(row);
    row = [];
  }

  if (row.length > 0) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let end = text.indexOf('\n', start);
  if (end === -1) end = text.length;
  const head = text.slice(start, end);
  const tabs = head.split('\t').length - 1;
  const commas = head.split(',').length - 1;
  return tabs >= commas ? '\t' : ',';
}

function validDateParts(y, mo, d, h, mi, s) {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 60;
}

/** "31/10/2026 23:56" (วัน/เดือน/ปี, เวลาไทย) → epoch ms, หรือ null */
function parseDMY(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const h = Number(m[4] || 0);
  const mi = Number(m[5] || 0);
  const s = Number(m[6] || 0);
  if (!validDateParts(y, mo, d, h, mi, s)) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s) - ICT_OFFSET_MS;
}

/** รองรับทั้ง วัน/เดือน/ปี และ ISO (ไม่ระบุเขตเวลา = เวลาไทย) — ใช้กับค่าจาก feed สด */
function parseEventTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;

  const dmy = parseDMY(s);
  if (dmy !== null) return dmy;

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const [y, mo, d, h, mi] = iso.slice(1, 6).map(Number);
    const sec = Number(iso[6] || 0);
    if (!validDateParts(y, mo, d, h, mi, sec)) return null;
    let offset = ICT_OFFSET_MS;
    const zone = iso[7];
    if (zone === 'Z') offset = 0;
    else if (zone) {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
    }
    return Date.UTC(y, mo - 1, d, h, mi, sec) - offset;
  }

  const fallback = Date.parse(s);
  return Number.isFinite(fallback) ? fallback : null;
}

/** epoch ms → "YYYY-MM-DD HH:mm" (เวลาไทย) */
function formatICT(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** วันที่ "YYYY-MM-DD" → ขอบเขตวัน (เวลาไทย) */
function dayBound(value, endOfDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validDateParts(y, mo, d, 0, 0, 0)) return NaN;
  return endOfDay ? Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - ICT_OFFSET_MS : Date.UTC(y, mo - 1, d) - ICT_OFFSET_MS;
}

/** description ของ Longdo เป็น rich text (HTML ได้) → ข้อความธรรมดา */
function htmlToText(value) {
  let s = String(value || '');
  if (!s.includes('<') && !s.includes('&')) return s.trim();
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '') // เฉพาะแท็กจริง ไม่แตะเครื่องหมาย < ในข้อความ เช่น "<5 คน"
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** แหล่งข่าวท้ายรายละเอียด เช่น "Cr. JS100" → "JS100" */
function extractCredit(description) {
  const lines = String(description || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^cr\.?\s*[:：]?\s*(.+)$/i.exec(line);
    return m ? m[1].trim().replace(/[\s.]+$/, '') : '';
  }
  return '';
}

/** แสดงผู้ป้อนข้อมูลตามนโยบาย: group (ค่าเริ่มต้น) | full | none */
function contributorLabel(account, mode, orgAccounts = []) {
  const a = String(account || '').trim();
  if (!a || mode === 'none') return '';
  if (mode === 'full') return a;
  if (/^itic\./i.test(a)) return 'เจ้าหน้าที่ iTIC';
  if (orgAccounts.some((org) => org.toLowerCase() === a.toLowerCase())) return a; // บัญชีหน่วยงานที่กำหนดไว้
  if (/^admin/i.test(a) || /(^|[._-])(admin|system|bot)$/i.test(a)) return a; // บัญชีระบบ
  return 'อื่น ๆ';
}

function numberParam(value) {
  // NOTE: Number(null) === 0 ซึ่งเป็นพิกัดที่ถูกต้อง จึงต้องแยกกรณีไม่มีค่า
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(value);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function csvCell(value, { text = false } = {}) {
  let s = value === null || value === undefined ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // กันสูตรใน Excel
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

function createTrafficEvents({
  baseDir = process.cwd(),
  archiveFile = '',
  archiveDir = '',
  fetchLive = null,
  eventLabels = {},
  contributorMode = 'group',
  orgAccounts = [],
  now = () => Date.now(),
  log = console,
} = {}) {
  const archive = {
    rows: [],
    byId: new Map(),
    codeCounts: new Map(),
    loaded: false,
    loading: false,
    file: '',
    mtimeMs: 0,
    size: 0,
    loadedAt: 0,
    from: null,
    to: null,
    stats: {},
    error: '',
  };

  const codeVotes = new Map(); // รหัสที่ไม่อยู่ในตาราง -> Map(icon -> count) (จากรายการสดที่มีทั้งรหัสและ icon)
  const learnedCodeKinds = new Map(); // รหัสที่ไม่อยู่ในตาราง -> kind (ชื่อ icon)
  const seenPairs = new Map(); // "code|icon" -> { code, icon, count } ใช้แสดงใน meta
  const votedIds = new Set();
  let lastStatCheck = 0;
  let liveCache = { source: null, rows: [] };

  /* ------------------------------ kinds ------------------------------ */

  function kindOfCode(code) {
    if (code === null || !Number.isFinite(code)) return 'other';
    return CODE_KINDS[code] || learnedCodeKinds.get(code) || `type${code}`;
  }

  /** icon ของ feed สด → kind (ใช้เมื่อรายการนั้นไม่มีรหัสตัวเลข) */
  function kindOfIcon(icon) {
    const name = String(icon || '').trim();
    if (!name) return 'other';
    if (OFFICIAL_KIND_SET.has(name)) return name;
    return ICON_ALIASES[name] || name;
  }

  function kindOfRow(row) {
    if (row.code !== null && Number.isFinite(row.code)) return kindOfCode(row.code);
    return kindOfIcon(row.icon);
  }

  function labelOfKind(kind) {
    if (OFFICIAL_LABELS[kind]) return OFFICIAL_LABELS[kind];
    if (eventLabels[kind]) return eventLabels[kind];
    const m = /^type(\d+)$/.exec(kind);
    return m ? `ประเภท ${m[1]}` : 'อื่น ๆ';
  }

  /**
   * feed สด (JSON) ส่งทั้งรหัสตัวเลข (type) และชื่อ icon มาด้วย
   * รหัสที่ไม่อยู่ในตารางทางการ (เช่น เบี่ยงจราจร) จึงตั้งชื่อตาม icon ที่พบคู่กันได้
   * — ต้องพบอย่างน้อย 2 รายการ และสอดคล้อง ≥ 70% ก่อนจึงใช้
   */
  function learnFromLive(liveRows) {
    const touched = new Set();
    for (const row of liveRows) {
      if (row.code === null || !row.icon || row.icon === 'other') continue;

      const pairKey = `${row.code}|${row.icon}`;
      const seen = seenPairs.get(pairKey) || { code: row.code, icon: row.icon, ids: new Set() };
      seen.ids.add(row.id || pairKey + seen.ids.size);
      seenPairs.set(pairKey, seen);

      if (CODE_KINDS[row.code] || (row.id && votedIds.has(row.id))) continue;
      if (row.id) votedIds.add(row.id);
      let votes = codeVotes.get(row.code);
      if (!votes) codeVotes.set(row.code, (votes = new Map()));
      votes.set(row.icon, (votes.get(row.icon) || 0) + 1);
      touched.add(row.code);
    }

    for (const code of touched) {
      const votes = codeVotes.get(code);
      let total = 0;
      let best = '';
      let bestCount = 0;
      for (const [icon, count] of votes) {
        total += count;
        if (count > bestCount) {
          best = icon;
          bestCount = count;
        }
      }
      if (bestCount >= 2 && bestCount / total >= 0.7) learnedCodeKinds.set(code, kindOfIcon(best));
    }
  }

  /* ------------------------------ archive ---------------------------- */

  function resolveFile() {
    if (archiveFile) {
      const file = path.resolve(baseDir, archiveFile);
      return fs.existsSync(file) ? file : null;
    }
    if (!archiveDir) return null;
    try {
      let best = null;
      for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(tsv|csv|txt)$/i.test(entry.name)) continue;
        const file = path.join(archiveDir, entry.name);
        const mtime = fs.statSync(file).mtimeMs;
        if (!best || mtime > best.mtime) best = { file, mtime };
      }
      return best ? best.file : null;
    } catch {
      return null;
    }
  }

  function buildRows(table) {
    if (table.length === 0) throw new Error('ไฟล์ว่าง');

    const header = table[0].map((name) => String(name).replace(/^\uFEFF/, '').trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const c = {
      eid: col('eid'),
      title: col('title'),
      titleEn: col('title_en'),
      description: col('description'),
      descriptionEn: col('description_en'),
      lat: col('latitude'),
      lon: col('longitude'),
      type: col('type'),
      start: col('start'),
      stop: col('stop'),
      contributor: col('contributor'),
    };
    const missing = ['eid', 'lat', 'lon', 'start'].filter((key) => c[key] < 0);
    if (missing.length > 0) {
      throw new Error(`ไม่พบคอลัมน์ที่จำเป็นในหัวไฟล์ (eid, latitude, longitude, start) — พบ: ${header.join(', ')}`);
    }

    const stats = {
      readRows: Math.max(0, table.length - 1),
      malformed: 0,
      badCoords: 0,
      badDates: 0,
      duplicates: 0,
      dayFirstLike: 0,
      monthFirstLike: 0,
    };

    const byId = new Map();
    const codeCounts = new Map();

    for (let i = 1; i < table.length; i += 1) {
      const r = table[i];
      if (r.length === 1 && r[0] === '') continue; // บรรทัดว่าง
      const get = (idx) => (idx >= 0 && idx < r.length ? r[idx] : '');

      const id = get(c.eid).trim();
      if (!id) {
        stats.malformed += 1;
        continue;
      }

      const lat = numberParam(get(c.lat));
      const lon = numberParam(get(c.lon));
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < THAILAND.minLat ||
        lat > THAILAND.maxLat ||
        lon < THAILAND.minLon ||
        lon > THAILAND.maxLon
      ) {
        stats.badCoords += 1;
        continue;
      }

      const rawStart = get(c.start);
      const parts = /^(\d{1,2})\/(\d{1,2})\//.exec(rawStart.trim());
      if (parts) {
        if (Number(parts[1]) > 12) stats.dayFirstLike += 1;
        else if (Number(parts[2]) > 12) stats.monthFirstLike += 1;
      }

      const start = parseEventTime(rawStart);
      if (start === null) {
        stats.badDates += 1;
        continue;
      }
      const stop = parseEventTime(get(c.stop));

      const typeText = get(c.type).trim();
      const code = typeText === '' || !Number.isFinite(Number(typeText)) ? null : Number(typeText);

      const title = htmlToText(get(c.title));
      const titleEn = htmlToText(get(c.titleEn));
      const description = htmlToText(get(c.description));
      const descriptionEn = htmlToText(get(c.descriptionEn));

      if (byId.has(id)) stats.duplicates += 1;
      byId.set(id, {
        id,
        title,
        titleEn,
        description,
        descriptionEn,
        lat,
        lon,
        code,
        start,
        stop,
        contributor: get(c.contributor).trim(),
        credit: extractCredit(description),
        origin: 'archive',
        blob: `${title}\n${titleEn}\n${description}\n${descriptionEn}`.toLowerCase(),
      });
    }

    const rows = Array.from(byId.values());
    let from = null;
    let to = null;
    for (const row of rows) {
      codeCounts.set(row.code, (codeCounts.get(row.code) || 0) + 1);
      if (from === null || row.start < from) from = row.start;
      if (to === null || row.start > to) to = row.start;
    }
    stats.rows = rows.length;

    return { rows, byId, codeCounts, from, to, stats };
  }

  async function loadArchive() {
    if (archive.loading) return;
    archive.loading = true;
    try {
      const file = resolveFile();
      if (!file) {
        archive.loaded = false;
        archive.file = '';
        archive.rows = [];
        archive.byId = new Map();
        archive.error = '';
        return;
      }

      const t0 = Date.now();
      const st = await fsp.stat(file);
      const text = await fsp.readFile(file, 'utf8');
      const built = buildRows(parseDelimited(text, detectDelimiter(text)));

      Object.assign(archive, {
        rows: built.rows,
        byId: built.byId,
        codeCounts: built.codeCounts,
        from: built.from,
        to: built.to,
        stats: built.stats,
        loaded: true,
        file,
        mtimeMs: st.mtimeMs,
        size: st.size,
        loadedAt: Date.now(),
        error: '',
      });
      votedIds.clear();
      log.log(
        `  ➜  traffic events: โหลด ${built.rows.length.toLocaleString('en-US')} รายการจาก ${path.basename(file)} ` +
          `(${Date.now() - t0} ms)`
      );
    } catch (error) {
      archive.error = error.message;
      log.warn(`  ✗  traffic events: ${error.message}`);
    } finally {
      archive.loading = false;
    }
  }

  /** ตรวจว่าไฟล์เปลี่ยนหรือไม่ (ไม่ถี่เกิน 15 วินาที) แล้วโหลดใหม่ในพื้นหลัง */
  function ensureFresh() {
    const t = now();
    if (t - lastStatCheck < STAT_CHECK_MS) return;
    lastStatCheck = t;
    if (archive.loading) return;

    const file = resolveFile();
    if (!file) {
      if (archive.loaded) loadArchive();
      return;
    }
    try {
      const st = fs.statSync(file);
      if (file !== archive.file || st.mtimeMs !== archive.mtimeMs || st.size !== archive.size) loadArchive();
    } catch {
      /* ignore */
    }
  }

  function init() {
    setImmediate(loadArchive);
  }

  /* ------------------------------ live feed -------------------------- */

  function convertLive(events) {
    return events
      .map((event) => {
        const start = parseEventTime(event.start);
        if (start === null || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return null;
        const description = htmlToText(event.description);
        const title = htmlToText(event.title);
        const titleEn = htmlToText(event.titleEn);
        return {
          id: String(event.id || ''),
          title,
          titleEn,
          description,
          descriptionEn: '',
          lat: event.lat,
          lon: event.lon,
          code: Number.isFinite(event.typeCode) ? event.typeCode : null,
          icon: String(event.type || ''),
          start,
          stop: parseEventTime(event.stop),
          contributor: String(event.contributor || ''),
          credit: extractCredit(description),
          origin: 'live',
          blob: `${title}\n${titleEn}\n${description}`.toLowerCase(),
        };
      })
      .filter(Boolean);
  }

  async function getLive() {
    if (typeof fetchLive !== 'function') return { rows: [], error: '' };
    try {
      const events = await fetchLive();
      if (liveCache.source !== events) liveCache = { source: events, rows: convertLive(events) };
      return { rows: liveCache.rows, error: '' };
    } catch (error) {
      return { rows: [], error: error.message };
    }
  }

  /* ------------------------------ query ------------------------------ */

  function parseFilters(params) {
    const get = (key) => params.get(key);

    const mode = ['start', 'active', 'now'].includes(get('time_mode')) ? get('time_mode') : 'start';
    const lat = numberParam(get('lat'));
    const lon = numberParam(get('lon'));
    const radius = numberParam(get('radius'));

    let area = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      area = { type: 'point', lat, lon, radius: Number.isFinite(radius) && radius > 0 ? radius : 1000 };
      const dLat = area.radius / 111_000;
      const dLon = area.radius / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      area.box = [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
    } else {
      const parts = String(get('bbox') || '').split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) area = { type: 'bbox', box: parts };
    }

    const kinds = String(get('types') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(numberParam(get('limit'))) || DEFAULT_LIMIT));
    const offset = Math.max(0, Math.floor(numberParam(get('offset'))) || 0);

    return {
      mode,
      nowMs: now(),
      startMs: dayBound(get('start_date'), false),
      endMs: dayBound(get('end_date'), true),
      area,
      kinds: kinds.length > 0 ? new Set(kinds) : null,
      terms: String(get('q') || '').toLowerCase().split(/\s+/).filter(Boolean),
      credit: String(get('credit') || '').trim(),
      sort: get('sort') === 'distance' && area && area.type === 'point' ? 'distance' : 'start',
      limit,
      offset,
    };
  }

  function timeOk(row, f) {
    const stopEff = row.stop !== null ? row.stop : row.start + HOUR_MS;
    if (f.mode === 'now') return row.start <= f.nowMs && stopEff >= f.nowMs;
    if (f.mode === 'active') {
      if (Number.isFinite(f.endMs) && row.start > f.endMs) return false;
      if (Number.isFinite(f.startMs) && stopEff < f.startMs) return false;
      return true;
    }
    if (Number.isFinite(f.startMs) && row.start < f.startMs) return false;
    if (Number.isFinite(f.endMs) && row.start > f.endMs) return false;
    return true;
  }

  function areaOk(row, f) {
    if (!f.area) return true;
    const [minLat, minLon, maxLat, maxLon] = f.area.box;
    if (row.lat < minLat || row.lat > maxLat || row.lon < minLon || row.lon > maxLon) return false;
    if (f.area.type === 'point') return haversineMeters(f.area.lat, f.area.lon, row.lat, row.lon) <= f.area.radius;
    return true;
  }

  function termsOk(row, f) {
    for (const term of f.terms) if (!row.blob.includes(term)) return false;
    return true;
  }

  function toClient(row, kind, f, { full = false } = {}) {
    const description = row.description || row.descriptionEn || '';
    const out = {
      id: row.id,
      title: row.title || row.titleEn || '',
      titleEn: row.titleEn,
      description: full || description.length <= DESCRIPTION_OUT_MAX ? description : `${description.slice(0, DESCRIPTION_OUT_MAX)}…`,
      lat: Math.round(row.lat * 1e6) / 1e6,
      lon: Math.round(row.lon * 1e6) / 1e6,
      type: kind,
      typeLabel: labelOfKind(kind),
      start: formatICT(row.start),
      stop: row.stop !== null ? formatICT(row.stop) : '',
      durationMin: row.stop !== null ? Math.round((row.stop - row.start) / 60000) : null,
      credit: row.credit,
      contributor: contributorLabel(row.contributor, contributorMode, orgAccounts),
      origin: row.origin,
    };
    if (f && f.area && f.area.type === 'point') {
      out.distance = Math.round(haversineMeters(f.area.lat, f.area.lon, row.lat, row.lon));
    }
    return out;
  }

  /** เลือกรายการตามตัวกรอง พร้อมนับ facet (ประเภท / แหล่งข่าว) โดยไม่นับตัวกรองของ facet นั้นเอง */
  async function select(params, { limitRows = true } = {}) {
    ensureFresh();
    const f = parseFilters(params);
    const live = await getLive();
    learnFromLive(live.rows);

    const liveIds = new Set();
    for (const row of live.rows) if (row.id) liveIds.add(row.id);

    const kindCounts = new Map();
    const creditCounts = new Map();
    const matched = [];

    const visit = (row, kind) => {
      if (!timeOk(row, f) || !areaOk(row, f) || !termsOk(row, f)) return;
      const kindOk = !f.kinds || f.kinds.has(kind);
      const creditOk = !f.credit || row.credit === f.credit;
      if (creditOk) kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);
      if (kindOk && row.credit) creditCounts.set(row.credit, (creditCounts.get(row.credit) || 0) + 1);
      if (kindOk && creditOk) matched.push({ row, kind });
    };

    for (const row of archive.rows) {
      if (liveIds.has(row.id)) continue; // ข้อมูลสดมาก่อน
      visit(row, kindOfCode(row.code));
    }
    for (const row of live.rows) visit(row, kindOfRow(row));

    if (f.sort === 'distance') {
      for (const item of matched) item.d = haversineMeters(f.area.lat, f.area.lon, item.row.lat, item.row.lon);
      matched.sort((a, b) => a.d - b.d);
    } else {
      matched.sort((a, b) => b.row.start - a.row.start);
    }

    const total = matched.length;
    const slice = limitRows ? matched.slice(f.offset, f.offset + f.limit) : matched;

    return { f, live, total, slice, kindCounts, creditCounts };
  }

  async function search(params) {
    const { f, live, total, slice, kindCounts, creditCounts } = await select(params);

    return {
      total,
      truncated: total > f.offset + slice.length,
      offset: f.offset,
      data: slice.map(({ row, kind }) => toClient(row, kind, f)),
      facets: {
        kinds: Array.from(kindCounts, ([kind, count]) => ({ kind, label: labelOfKind(kind), count })).sort(
          (a, b) => b.count - a.count
        ),
        credits: Array.from(creditCounts, ([credit, count]) => ({ credit, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 25),
      },
      source: sourceInfo(live),
    };
  }

  /** ส่งออก CSV ตามตัวกรองเดียวกับการค้นหา (ทุกรายการที่ตรงเงื่อนไข สูงสุด EXPORT_MAX) */
  async function exportCSV(params, write) {
    const { f, total, slice } = await select(params, { limitRows: false });
    const rows = slice.slice(0, EXPORT_MAX);

    const header = [
      'eid', 'title', 'title_en', 'description', 'description_en', 'latitude', 'longitude',
      'type_code', 'type_kind', 'type_label', 'start', 'stop', 'credit', 'source', 'contributor',
    ];
    await write(`${header.join(',')}\r\n`);

    let chunk = [];
    for (const { row, kind } of rows) {
      chunk.push(
        [
          csvCell(row.id),
          csvCell(row.title, { text: true }),
          csvCell(row.titleEn, { text: true }),
          csvCell(row.description, { text: true }),
          csvCell(row.descriptionEn, { text: true }),
          csvCell(row.lat),
          csvCell(row.lon),
          csvCell(row.code),
          csvCell(kind),
          csvCell(labelOfKind(kind)),
          csvCell(formatICT(row.start)),
          csvCell(row.stop !== null ? formatICT(row.stop) : ''),
          csvCell(row.credit, { text: true }),
          csvCell(row.origin === 'live' ? 'feed สด' : 'คลังย้อนหลัง'),
          csvCell(contributorLabel(row.contributor, contributorMode, orgAccounts), { text: true }),
        ].join(',')
      );
      if (chunk.length >= 1000) {
        await write(`${chunk.join('\r\n')}\r\n`);
        chunk = [];
      }
    }
    if (chunk.length > 0) await write(`${chunk.join('\r\n')}\r\n`);

    return { count: rows.length, total, f };
  }

  function sourceInfo(live) {
    return {
      archiveLoaded: archive.loaded,
      archiveLoading: archive.loading,
      archiveRows: archive.rows.length,
      archiveFrom: archive.from !== null ? formatICT(archive.from) : '',
      archiveTo: archive.to !== null ? formatICT(archive.to) : '',
      liveCount: live ? live.rows.length : 0,
      liveError: live ? live.error : '',
    };
  }

  async function meta() {
    ensureFresh();
    const live = await getLive();
    learnFromLive(live.rows);

    const basisOf = (code) => {
      if (code === null) return 'unknown';
      if (OBSERVED_CODES.has(code)) return 'observed';
      if (CODE_KINDS[code]) return 'official';
      return learnedCodeKinds.has(code) ? 'learned' : 'unknown';
    };

    const codes = Array.from(archive.codeCounts, ([code, count]) => {
      const kind = kindOfCode(code);
      return { code, count, kind, label: labelOfKind(kind), basis: basisOf(code) };
    }).sort((a, b) => b.count - a.count);

    const liveCodes = Array.from(seenPairs.values())
      .map(({ code, icon, ids }) => {
        const kind = kindOfCode(code);
        return { code, icon, count: ids.size, kind, label: labelOfKind(kind), basis: basisOf(code) };
      })
      .sort((a, b) => a.code - b.code);

    return {
      archive: {
        configured: Boolean(archiveFile) || Boolean(archiveDir),
        loaded: archive.loaded,
        loading: archive.loading,
        file: archive.file ? path.basename(archive.file) : '',
        rows: archive.rows.length,
        from: archive.from !== null ? formatICT(archive.from) : '',
        to: archive.to !== null ? formatICT(archive.to) : '',
        loadedAt: archive.loadedAt ? new Date(archive.loadedAt).toISOString() : '',
        error: archive.error,
        stats: archive.stats,
      },
      live: { count: live.rows.length, error: live.error },
      typeCodes: codes,
      liveCodes,
      contributorMode,
    };
  }

  return { init, search, exportCSV, meta, loadArchive };
}

module.exports = {
  createTrafficEvents,
  // ส่งออกไว้สำหรับทดสอบ
  parseDelimited,
  parseEventTime,
  parseDMY,
  extractCredit,
  htmlToText,
  contributorLabel,
  formatICT,
};
