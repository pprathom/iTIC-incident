'use strict';

/* ================================================================== */
/* Constants                                                          */
/* ================================================================== */

const MIN_DATE = '2023-01-01';
const MAX_DATE = '2025-12-31';
const PAGE_SIZE = 50;
const MAX_ROWS = 100000;

const SOURCE_LABELS = { 1: 'RVP', 2: 'iTIC', 3: 'RAIS' };
const SOURCE_ORDER = [3, 1, 2];
const SEVERITY_LABELS = { 1: 'ทั้งหมด', 2: 'บาดเจ็บ', 3: 'เสียชีวิต' };

/** Fallback list — ใช้เฉพาะกรณีโหลด data/provinces.csv ผ่าน /api/provinces ไม่สำเร็จ */
const FALLBACK_PROVINCES = [
  ['10', 'กรุงเทพมหานคร'], ['11', 'สมุทรปราการ'], ['12', 'นนทบุรี'], ['13', 'ปทุมธานี'],
  ['14', 'พระนครศรีอยุธยา'], ['15', 'อ่างทอง'], ['16', 'ลพบุรี'], ['17', 'สิงห์บุรี'],
  ['18', 'ชัยนาท'], ['19', 'สระบุรี'], ['20', 'ชลบุรี'], ['21', 'ระยอง'],
  ['22', 'จันทบุรี'], ['23', 'ตราด'], ['24', 'ฉะเชิงเทรา'], ['25', 'ปราจีนบุรี'],
  ['26', 'นครนายก'], ['27', 'สระแก้ว'], ['30', 'นครราชสีมา'], ['31', 'บุรีรัมย์'],
  ['32', 'สุรินทร์'], ['33', 'ศรีสะเกษ'], ['34', 'อุบลราชธานี'], ['35', 'ยโสธร'],
  ['36', 'ชัยภูมิ'], ['37', 'อำนาจเจริญ'], ['38', 'บึงกาฬ'], ['39', 'หนองบัวลำภู'],
  ['40', 'ขอนแก่น'], ['41', 'อุดรธานี'], ['42', 'เลย'], ['43', 'หนองคาย'],
  ['44', 'มหาสารคาม'], ['45', 'ร้อยเอ็ด'], ['46', 'กาฬสินธุ์'], ['47', 'สกลนคร'],
  ['48', 'นครพนม'], ['49', 'มุกดาหาร'], ['50', 'เชียงใหม่'], ['51', 'ลำพูน'],
  ['52', 'ลำปาง'], ['53', 'อุตรดิตถ์'], ['54', 'แพร่'], ['55', 'น่าน'],
  ['56', 'พะเยา'], ['57', 'เชียงราย'], ['58', 'แม่ฮ่องสอน'], ['60', 'นครสวรรค์'],
  ['61', 'อุทัยธานี'], ['62', 'กำแพงเพชร'], ['63', 'ตาก'], ['64', 'สุโขทัย'],
  ['65', 'พิษณุโลก'], ['66', 'พิจิตร'], ['67', 'เพชรบูรณ์'], ['70', 'ราชบุรี'],
  ['71', 'กาญจนบุรี'], ['72', 'สุพรรณบุรี'], ['73', 'นครปฐม'], ['74', 'สมุทรสาคร'],
  ['75', 'สมุทรสงคราม'], ['76', 'เพชรบุรี'], ['77', 'ประจวบคีรีขันธ์'],
  ['80', 'นครศรีธรรมราช'], ['81', 'กระบี่'], ['82', 'พังงา'], ['83', 'ภูเก็ต'],
  ['84', 'สุราษฎร์ธานี'], ['85', 'ระนอง'], ['86', 'ชุมพร'], ['90', 'สงขลา'],
  ['91', 'สตูล'], ['92', 'ตรัง'], ['93', 'พัทลุง'], ['94', 'ปัตตานี'],
  ['95', 'ยะลา'], ['96', 'นราธิวาส'],
];

/** code → { name, en } — เติมจาก /api/provinces (CSV geocode) ตอนเริ่มทำงาน */
const provinceByCode = new Map(FALLBACK_PROVINCES.map(([code, name]) => [code, { name, en: '' }]));

/* ================================================================== */
/* State                                                              */
/* ================================================================== */

const state = {
  rows: [],
  view: [],
  page: 1,
  sortKey: 'datetime',
  sortDir: 'desc',
  query: null,
  session: null,
  place: null,
  events: [],
};

let controller = null;

/* ================================================================== */
/* DOM                                                                */
/* ================================================================== */

const $ = (id) => document.getElementById(id);

const el = {
  loginView: $('login-view'),
  appView: $('app-view'),
  loginForm: $('login-form'),
  loginUser: $('login-user'),
  loginPass: $('login-pass'),
  loginError: $('login-error'),
  loginSubmit: $('login-submit'),
  sessionInfo: $('session-info'),
  sessionUser: $('session-user'),
  logoutBtn: $('logout-btn'),

  filterForm: $('filter-form'),
  source: $('source_id'),
  severity: $('severity_id'),
  province: $('province'),
  startDate: $('start_date'),
  endDate: $('end_date'),
  keyword: $('keyword'),
  useArea: $('use-area'),
  lat: $('lat'),
  lon: $('lon'),
  buffer: $('buffer'),
  limit: $('limit'),
  fetchAll: $('fetch-all'),
  searchBtn: $('search-btn'),
  resetBtn: $('reset-btn'),
  status: $('status-line'),
  placeQuery: $('place-query'),
  placeSearchBtn: $('place-search-btn'),
  placeResultField: $('place-result-field'),
  placeResult: $('place-result'),

  areaCard: $('area-card'),
  areaTitle: $('area-title'),
  areaDetail: $('area-detail'),
  areaChips: $('area-chips'),

  eventsCard: $('events-card'),
  eventsSub: $('events-sub'),
  eventsList: $('events-list'),
  eventsExport: $('events-export'),

  stats: $('stats'),
  statTotal: $('stat-total'),
  statDeath: $('stat-death'),
  statInjured: $('stat-injured'),
  statRange: $('stat-range'),

  tableCard: $('table-card'),
  emptyState: $('empty-state'),
  tbody: $('result-body'),
  table: $('result-table'),
  vehicleFilter: $('vehicle-filter'),
  rowSearch: $('row-search'),
  rowCount: $('row-count'),
  pageInfo: $('page-info'),
  prevPage: $('prev-page'),
  nextPage: $('next-page'),
  exportBtn: $('export-btn'),
  exportDetailBtn: $('export-detail-btn'),

  dialog: $('detail-dialog'),
  dialogTitle: $('detail-title'),
  dialogBody: $('detail-body'),
  dialogClose: $('detail-close'),
};

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

const nf = new Intl.NumberFormat('th-TH');

const fmtNum = (n) => nf.format(Number(n) || 0);

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function clampDate(iso) {
  if (iso < MIN_DATE) return MIN_DATE;
  if (iso > MAX_DATE) return MAX_DATE;
  return iso;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status-line${kind ? ` ${kind}` : ''}`;
}

function vehicleTypes(accident) {
  const set = new Set();
  for (const v of accident.vehicle || []) {
    const type = (v && v.vehicle_type) || '';
    if (type) set.add(type);
  }
  return [...set];
}

function victimList(accident) {
  const out = [];
  for (const v of accident.vehicle || []) {
    for (const victim of (v && v.victim) || []) {
      out.push({ vehicle_type: (v && v.vehicle_type) || '—', ...victim });
    }
  }
  return out;
}

function splitDatetime(value) {
  const [date = '', time = ''] = String(value || '').split(' ');
  return { date, time };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(filename, header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error((payload && payload.error) || `เกิดข้อผิดพลาด (HTTP ${response.status})`);
  }
  return payload;
}

/* ================================================================== */
/* Session / auth                                                     */
/* ================================================================== */

function showLogin() {
  state.session = null;
  el.appView.hidden = true;
  el.loginView.hidden = false;
  el.sessionInfo.hidden = true;
}

function showApp(session) {
  state.session = session;
  el.loginView.hidden = true;
  el.appView.hidden = false;
  el.sessionInfo.hidden = false;
  el.sessionUser.textContent = session.username || 'ผู้ใช้';
}

async function checkSession() {
  try {
    const payload = await api('/api/session');
    if (payload && payload.authenticated) {
      showApp(payload);
      return true;
    }
  } catch {
    /* not logged in */
  }
  showLogin();
  return false;
}

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.loginError.hidden = true;
  el.loginSubmit.disabled = true;
  el.loginSubmit.textContent = 'กำลังเข้าสู่ระบบ…';

  try {
    const session = await api('/api/login', {
      method: 'POST',
      body: { user: el.loginUser.value.trim(), pass: el.loginPass.value },
    });
    el.loginPass.value = '';
    showApp(session);
    setStatus('เข้าสู่ระบบสำเร็จ');
  } catch (error) {
    el.loginError.textContent = error.message;
    el.loginError.hidden = false;
  } finally {
    el.loginSubmit.disabled = false;
    el.loginSubmit.textContent = 'เข้าสู่ระบบ';
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: {} });
  } catch {
    /* ignore */
  }
  state.rows = [];
  state.view = [];
  showLogin();
});

/* ================================================================== */
/* Filter form                                                        */
/* ================================================================== */

async function loadProvinces() {
  let list = [];

  try {
    const payload = await api('/api/provinces');
    list = (payload.data || [])
      .filter((province) => /^\d{2}$/.test(province.code || ''))
      .map((province) => ({
        code: province.code,
        name: province.name_th || province.name || '',
        en: province.name_en || '',
      }));
  } catch {
    /* ใช้ข้อมูลสำรองด้านล่าง */
  }

  if (list.length === 0) {
    list = FALLBACK_PROVINCES.map(([code, name]) => ({ code, name, en: '' }));
  }

  provinceByCode.clear();
  const fragment = document.createDocumentFragment();
  for (const province of list) {
    provinceByCode.set(province.code, { name: province.name, en: province.en });
    const option = document.createElement('option');
    option.value = province.code;
    option.textContent = `${province.name} (${province.code})`;
    option.title = province.en ? `${province.name} · ${province.en}` : province.name;
    fragment.appendChild(option);
  }
  el.province.replaceChildren(fragment);
  el.province.value = '10';
}

function setDefaultDates() {
  const end = MAX_DATE;
  const start = clampDate(addDays(end, -29));
  el.startDate.value = start;
  el.endDate.value = end;
}

function applyQuickRange(days) {
  const end = MAX_DATE;
  let start;
  if (days === 'year') {
    start = `${end.slice(0, 4)}-01-01`;
  } else {
    start = clampDate(addDays(end, -(Number(days) - 1)));
  }
  el.startDate.value = clampDate(start);
  el.endDate.value = end;
}

document.querySelectorAll('[data-range]').forEach((button) => {
  button.addEventListener('click', () => applyQuickRange(button.dataset.range));
});

function syncAreaInputs() {
  const on = el.useArea.checked;
  for (const input of [el.lat, el.lon, el.buffer]) input.disabled = !on;
  if (on && !el.lat.value) el.lat.value = '13.7563';
  if (on && !el.lon.value) el.lon.value = '100.5018';
}

el.useArea.addEventListener('change', syncAreaInputs);

/* ---------------------------- place search ---------------------------- */

let placeItems = [];

function applyPlace(index) {
  const item = placeItems[index];
  if (!item) return;
  el.lat.value = item.lat.toFixed(6);
  el.lon.value = item.lon.toFixed(6);
  state.place = { name: item.name, displayName: item.displayName, lat: item.lat, lon: item.lon };
  if (!el.useArea.checked) el.useArea.checked = true;
  syncAreaInputs();
}

el.placeSearchBtn.addEventListener('click', async () => {
  const query = el.placeQuery.value.trim();
  if (query.length < 2) {
    setStatus('พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร', 'error');
    return;
  }

  el.placeSearchBtn.disabled = true;
  el.placeSearchBtn.textContent = '…';
  setStatus('กำลังค้นหาสถานที่…', 'busy');

  try {
    const payload = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
    placeItems = payload.data || [];

    if (placeItems.length === 0) {
      el.placeResultField.hidden = true;
      setStatus('ไม่พบสถานที่ที่ค้นหา ลองระบุชื่อให้ชัดเจนขึ้น', 'error');
      return;
    }

    const options = placeItems.map((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.displayName;
      return option;
    });

    el.placeResult.replaceChildren(...options);
    el.placeResultField.hidden = false;
    el.placeResult.selectedIndex = 0;
    applyPlace(0);
    setStatus(`พบ ${placeItems.length} สถานที่ — เลือกจากรายการ หรือแก้พิกัดเองได้`);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    el.placeSearchBtn.disabled = false;
    el.placeSearchBtn.textContent = 'ค้นหา';
  }
});

el.placeQuery.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    el.placeSearchBtn.click();
  }
});

el.placeResult.addEventListener('change', () => {
  applyPlace(Number(el.placeResult.value));
});


el.resetBtn.addEventListener('click', () => {
  el.filterForm.reset();
  el.source.value = '3';
  el.severity.value = '1';
  el.limit.value = '2000';
  el.fetchAll.checked = true;
  el.province.value = '10';
  el.useArea.checked = false;
  syncAreaInputs();
  el.placeResultField.hidden = true;
  el.placeResult.replaceChildren();
  placeItems = [];
  state.place = null;
  el.areaCard.hidden = true;
  state.events = [];
  el.eventsCard.hidden = true;
  el.eventsList.replaceChildren();
  setDefaultDates();
  setStatus('');
});

/* ================================================================== */
/* Search                                                             */
/* ================================================================== */

function buildQuery() {
  const geocode = String(el.province.value || '');
  if (!/^\d{2}$/.test(geocode) || !provinceByCode.has(geocode)) {
    throw new Error('กรุณาเลือกจังหวัดจากรายการ');
  }

  const start = el.startDate.value;
  const end = el.endDate.value;

  if (!start || !end) throw new Error('กรุณาระบุช่วงวันที่ให้ครบถ้วน');
  if (start < MIN_DATE || end > MAX_DATE) {
    throw new Error(`API รองรับข้อมูลระหว่าง ${MIN_DATE} ถึง ${MAX_DATE}`);
  }
  if (end < start) throw new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');

  const query = {
    source_id: Number(el.source.value),
    severity_id: Number(el.severity.value),
    geocode: Number(geocode),
    start_date: start,
    end_date: end,
    keyword: el.keyword.value.trim(),
    limit: Number(el.limit.value),
    provinceName: provinceByCode.get(geocode).name,
  };

  if (el.useArea.checked) {
    const lat = Number(el.lat.value);
    const lon = Number(el.lon.value);
    const buffer = Number(el.buffer.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('กรุณาระบุพิกัดละติจูด/ลองจิจูดให้ถูกต้อง');
    }
    query.point = { lat, lon };
    query.buffer = Number.isFinite(buffer) && buffer > 0 ? buffer : 1000;
  }

  return query;
}

function setSearchBusy(busy) {
  el.searchBtn.textContent = busy ? 'ยกเลิก' : 'ค้นหาข้อมูล';
  el.searchBtn.classList.toggle('btn-primary', !busy);
  el.searchBtn.classList.toggle('btn-ghost', busy);
}

async function runSearch() {
  if (controller) {
    controller.abort();
    return;
  }

  let query;
  try {
    query = buildQuery();
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }

  const sources = query.source_id === 0 ? SOURCE_ORDER : [query.source_id];
  const multiSource = sources.length > 1;

  controller = new AbortController();
  const { signal } = controller;

  setSearchBusy(true);
  setStatus('กำลังดึงข้อมูล…', 'busy');

  const rows = [];
  let grandTotal = 0;
  let pages = 0;

  try {
    for (let index = 0; index < sources.length; index += 1) {
      const sourceId = sources[index];
      let offset = 0;
      let sourceTotal = 0;

      do {
        const payload = await api('/api/accidents', {
          method: 'POST',
          signal,
          body: {
            source_id: sourceId,
            severity_id: query.severity_id,
            geocode: query.geocode,
            start_date: query.start_date,
            end_date: query.end_date,
            keyword: query.keyword,
            limit: query.limit,
            offset,
            point: query.point,
            buffer: query.buffer,
          },
        });

        sourceTotal = Number(payload.total) || 0;
        const batch = (payload.data || []).map((accident) => ({ ...accident, __source: sourceId }));
        rows.push(...batch);
        offset += batch.length;
        pages += 1;

        const label = multiSource ? ` · ${SOURCE_LABELS[sourceId]} (${index + 1}/${sources.length})` : '';
        setStatus(`กำลังดึงข้อมูล… ${fmtNum(rows.length)} รายการ${label}`, 'busy');

        if (!el.fetchAll.checked) break;
        if (batch.length === 0) break;
        if (offset >= sourceTotal) break;
        if (rows.length >= MAX_ROWS) break;
        if (pages >= 200) break;
      } while (true);

      grandTotal += sourceTotal;
      if (rows.length >= MAX_ROWS || pages >= 200) break;
    }

    state.rows = rows;
    state.query = { ...query, sources };
    state.page = 1;
    state.sortKey = 'datetime';
    state.sortDir = 'desc';

    el.vehicleFilter.value = '';
    el.rowSearch.value = '';

    buildVehicleOptions();
    render();

    if (rows.length === 0) {
      setStatus('ไม่พบข้อมูลตามเงื่อนไขที่กำหนด');
    } else if (rows.length < grandTotal) {
      setStatus(
        `ดึงข้อมูลได้ ${fmtNum(rows.length)} จากทั้งหมด ${fmtNum(grandTotal)} รายการ (ถึงขีดจำกัด ${fmtNum(MAX_ROWS)})`,
        'error'
      );
    } else {
      const suffix = multiSource ? ` จาก ${sources.length} แหล่งข้อมูล` : '';
      setStatus(`ดึงข้อมูลสำเร็จ ${fmtNum(rows.length)} รายการ${suffix}`);
    }

    if (query.point) {
      const place = state.place;
      const sameSpot =
        place && Math.abs(place.lat - query.point.lat) < 1e-4 && Math.abs(place.lon - query.point.lon) < 1e-4;
      loadAreaInfo(query.point.lat, query.point.lon, query.buffer, rows.length, sameSpot ? place.name : '');
    } else {
      el.areaCard.hidden = true;
    }

    loadEvents(query, rows);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('ยกเลิกการดึงข้อมูลแล้ว');
    } else {
      setStatus(error.message, 'error');
    }
  } finally {
    controller = null;
    setSearchBusy(false);
  }
}

el.filterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

/* ================================================================== */
/* Area naming                                                        */
/* ================================================================== */

function addAreaChip(text, extraClass = '') {
  const chip = document.createElement('span');
  chip.className = `chip-static${extraClass ? ` ${extraClass}` : ''}`;
  chip.textContent = text;
  el.areaChips.appendChild(chip);
}

function renderAreaChips(payload, lat, lon, buffer, count) {
  el.areaChips.replaceChildren();

  addAreaChip(`พบ ${fmtNum(count)} รายการ · รัศมี ${fmtNum(buffer)} ม.`);
  addAreaChip(`พิกัด ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

  if (payload.blackspot && payload.blackspot.name) {
    const label = payload.blackspot.subName
      ? `จุดเสี่ยง: ${payload.blackspot.name} · ${payload.blackspot.subName}`
      : `จุดเสี่ยง: ${payload.blackspot.name}`;
    addAreaChip(label);
  }

  if (payload.districtStats && payload.districtStats.districtName) {
    addAreaChip(
      `เขต/อำเภอ ${payload.districtStats.districtName}: ${fmtNum(payload.districtStats.totalAccident)} ครั้ง`
    );
  }

  if (payload.osmOk) addAreaChip('ชื่อสถานที่ © OpenStreetMap', 'attribution');
}

async function loadAreaInfo(lat, lon, buffer, count, preferredTitle = '') {
  el.areaCard.hidden = false;
  el.areaTitle.textContent = preferredTitle || 'กำลังระบุชื่อบริเวณ…';
  el.areaDetail.textContent = '';
  el.areaChips.replaceChildren();

  try {
    const payload = await api(`/api/area?lat=${lat}&lon=${lon}`);
    el.areaTitle.textContent = preferredTitle || payload.title || 'ไม่ทราบชื่อบริเวณ';
    el.areaDetail.textContent =
      payload.detail || [payload.district, payload.province].filter(Boolean).join(' · ');
    renderAreaChips(payload, lat, lon, buffer, count);
  } catch (error) {
    el.areaTitle.textContent = preferredTitle || 'บริเวณที่เลือก';
    el.areaDetail.textContent = error.message;
    renderAreaChips({}, lat, lon, buffer, count);
  }
}

/* ================================================================== */
/* Live events (Longdo)                                               */
/* ================================================================== */

function bboxOf(rows) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  let found = 0;

  for (const accident of rows) {
    if (!Array.isArray(accident.location) || accident.location.length < 2) continue;
    const [lon, lat] = accident.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    found += 1;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  if (found === 0) return null;
  const pad = 0.02;
  return [minLat - pad, minLon - pad, maxLat + pad, maxLon + pad];
}

const formatEventTime = (value) => String(value || '').slice(0, 16);

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} กม.` : `${Math.round(meters)} ม.`;
}

function renderEvents(events, scope) {
  el.eventsList.replaceChildren();

  if (events.length === 0) {
    el.eventsCard.hidden = true;
    return;
  }

  el.eventsCard.hidden = false;
  el.eventsSub.textContent = `พบ ${fmtNum(events.length)} เหตุการณ์${scope}`;

  for (const event of events) {
    const item = document.createElement('li');

    const badge = document.createElement('span');
    badge.className = `badge ev-${event.type || 'other'}`;
    badge.textContent = event.typeLabel || 'อื่น ๆ';

    const main = document.createElement('div');
    main.className = 'event-main';

    const title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = event.title || '(ไม่มีชื่อเหตุการณ์)';

    const meta = document.createElement('span');
    meta.className = 'event-meta';
    const parts = [formatEventTime(event.start)];
    if (event.stop) parts.push(`ถึง ${formatEventTime(event.stop)}`);
    if (Number.isFinite(event.distance)) parts.push(formatDistance(event.distance));
    if (event.contributor) parts.push(`โดย ${event.contributor}`);
    meta.textContent = parts.filter(Boolean).join(' · ');

    main.append(title, meta);
    item.append(badge, main);
    el.eventsList.appendChild(item);
  }
}

async function loadEvents(query, rows) {
  el.eventsCard.hidden = true;
  el.eventsList.replaceChildren();
  state.events = [];

  const params = new URLSearchParams();
  let scope = '';

  if (query.point) {
    const radius = Math.max(Number(query.buffer) || 1000, 5000);
    params.set('lat', query.point.lat);
    params.set('lon', query.point.lon);
    params.set('radius', String(radius));
    scope = ` ภายใน ${fmtNum(Math.round(radius / 1000))} กม.`;
  } else {
    const bbox = bboxOf(rows);
    if (bbox) {
      params.set('bbox', bbox.join(','));
      scope = ' ในพื้นที่ผลค้นหา';
    } else {
      scope = ' ทั่วประเทศ';
    }
  }

  try {
    const payload = await api(`/api/events?${params.toString()}`);
    state.events = payload.data || [];
    renderEvents(state.events, scope);
  } catch (error) {
    el.eventsCard.hidden = true;
    console.warn('events:', error.message);
  }
}

el.eventsExport.addEventListener('click', () => {
  if (state.events.length === 0) {
    setStatus('ไม่มีเหตุการณ์ปัจจุบันให้ส่งออก', 'error');
    return;
  }

  const header = [
    'รหัสเหตุการณ์', 'ประเภท', 'หัวข้อ', 'รายละเอียด', 'เริ่ม', 'สิ้นสุด',
    'ละติจูด', 'ลองจิจูด', 'ระยะทาง (กม.)', 'ผู้ให้ข้อมูล',
  ];

  const rows = state.events.map((event) => [
    event.id,
    event.typeLabel,
    event.title,
    event.description,
    event.start,
    event.stop,
    event.lat,
    event.lon,
    Number.isFinite(event.distance) ? (event.distance / 1000).toFixed(2) : '',
    event.contributor,
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  downloadCSV(`longdo_events_${stamp}.csv`, header, rows);
  setStatus(`ส่งออกเหตุการณ์ปัจจุบัน ${fmtNum(rows.length)} รายการแล้ว`);
});

/* ================================================================== */
/* Rendering                                                          */
/* ================================================================== */

function buildVehicleOptions() {
  const counts = new Map();
  for (const accident of state.rows) {
    for (const type of vehicleTypes(accident)) {
      counts.set(type, (counts.get(type) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  el.vehicleFilter.replaceChildren();

  const all = document.createElement('option');
  all.value = '';
  all.textContent = `ทั้งหมด (${fmtNum(state.rows.length)})`;
  el.vehicleFilter.appendChild(all);

  for (const [type, count] of sorted) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = `${type} (${fmtNum(count)})`;
    el.vehicleFilter.appendChild(option);
  }
}

function applyFilters() {
  const vehicle = el.vehicleFilter.value;
  const keyword = el.rowSearch.value.trim().toLowerCase();

  let rows = state.rows;

  if (vehicle) {
    rows = rows.filter((accident) => vehicleTypes(accident).includes(vehicle));
  }

  if (keyword) {
    rows = rows.filter((accident) => {
      const haystack = [
        accident.datetime,
        accident.subdistrict,
        accident.district,
        accident.id,
        SOURCE_LABELS[accident.__source] || '',
        ...vehicleTypes(accident),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }

  const direction = state.sortDir === 'asc' ? 1 : -1;
  const key = state.sortKey;
  rows = [...rows].sort((a, b) => {
    if (key === 'death' || key === 'injured') {
      return ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * direction;
    }
    return String(a[key] || '').localeCompare(String(b[key] || '')) * direction;
  });

  state.view = rows;
  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > maxPage) state.page = maxPage;
}

function render() {
  applyFilters();

  const rows = state.view;
  const hasRows = rows.length > 0;

  el.emptyState.hidden = hasRows;
  el.stats.hidden = !hasRows;
  el.tableCard.hidden = !hasRows;

  if (!hasRows) {
    el.tbody.replaceChildren();
    return;
  }

  let deaths = 0;
  let injured = 0;
  let minDate = '';
  let maxDate = '';

  for (const accident of rows) {
    deaths += Number(accident.death) || 0;
    injured += Number(accident.injured) || 0;
    const { date } = splitDatetime(accident.datetime);
    if (date) {
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }
  }

  el.statTotal.textContent = fmtNum(rows.length);
  el.statDeath.textContent = fmtNum(deaths);
  el.statInjured.textContent = fmtNum(injured);
  el.statRange.textContent = minDate && maxDate ? `${minDate} → ${maxDate}` : '—';

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const fragment = document.createDocumentFragment();
  for (const accident of pageRows) fragment.appendChild(renderRow(accident));
  el.tbody.replaceChildren(fragment);

  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  el.rowCount.textContent = `แสดง ${fmtNum(start + 1)}–${fmtNum(Math.min(start + PAGE_SIZE, rows.length))} จาก ${fmtNum(rows.length)} รายการ`;
  el.pageInfo.textContent = `หน้า ${fmtNum(state.page)} / ${fmtNum(maxPage)}`;
  el.prevPage.disabled = state.page <= 1;
  el.nextPage.disabled = state.page >= maxPage;

  document.querySelectorAll('#result-table th.sortable').forEach((th) => {
    th.dataset.dir = th.dataset.sort === state.sortKey ? state.sortDir : '';
  });
}

function renderRow(accident) {
  const tr = document.createElement('tr');
  tr.tabIndex = 0;
  tr.title = 'คลิกเพื่อดูรายละเอียด';
  tr.addEventListener('click', () => openDetail(accident));
  tr.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openDetail(accident);
  });

  const { date, time } = splitDatetime(accident.datetime);
  const [lon, lat] = Array.isArray(accident.location) ? accident.location : [];

  const cells = [];

  const dateCell = document.createElement('td');
  dateCell.className = 'mono';
  dateCell.textContent = date ? `${date} ${time}` : '—';
  cells.push(dateCell);

  const sourceCell = document.createElement('td');
  const sourceBadge = document.createElement('span');
  sourceBadge.className = `badge source-${accident.__source || 'x'}`;
  sourceBadge.textContent = SOURCE_LABELS[accident.__source] || '—';
  sourceCell.appendChild(sourceBadge);
  cells.push(sourceCell);

  const deathCell = document.createElement('td');
  deathCell.className = 'num';
  deathCell.textContent = fmtNum(accident.death);
  cells.push(deathCell);

  const injuredCell = document.createElement('td');
  injuredCell.className = 'num';
  injuredCell.textContent = fmtNum(accident.injured);
  cells.push(injuredCell);

  const subdistrictCell = document.createElement('td');
  subdistrictCell.textContent = accident.subdistrict || '—';
  cells.push(subdistrictCell);

  const districtCell = document.createElement('td');
  districtCell.textContent = accident.district || '—';
  cells.push(districtCell);

  const locationCell = document.createElement('td');
  locationCell.className = 'mono';
  locationCell.textContent =
    Number.isFinite(lat) && Number.isFinite(lon) ? `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}` : '—';
  cells.push(locationCell);

  const vehicleCell = document.createElement('td');
  vehicleCell.className = 'wrap';
  const types = vehicleTypes(accident);
  if (types.length === 0) {
    vehicleCell.textContent = '—';
  } else {
    for (const type of types.slice(0, 2)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = type;
      vehicleCell.appendChild(badge);
    }
    if (types.length > 2) {
      const more = document.createElement('span');
      more.className = 'badge';
      more.textContent = `+${types.length - 2}`;
      vehicleCell.appendChild(more);
    }
  }
  cells.push(vehicleCell);

  const victimsCell = document.createElement('td');
  victimsCell.className = 'num';
  victimsCell.textContent = fmtNum(victimList(accident).length);
  cells.push(victimsCell);

  tr.append(...cells);
  return tr;
}

/* ================================================================== */
/* Sorting & paging                                                   */
/* ================================================================== */

document.querySelectorAll('#result-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = key === 'datetime' ? 'desc' : 'asc';
    }
    state.page = 1;
    render();
  });
});

el.prevPage.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    render();
  }
});

el.nextPage.addEventListener('click', () => {
  state.page += 1;
  render();
});

el.vehicleFilter.addEventListener('change', () => {
  state.page = 1;
  render();
});

el.rowSearch.addEventListener('input', () => {
  state.page = 1;
  render();
});

/* ================================================================== */
/* Detail dialog                                                      */
/* ================================================================== */

function openDetail(accident) {
  el.dialogTitle.textContent = `อุบัติเหตุ #${accident.id ?? '—'}`;
  el.dialogBody.replaceChildren();

  const [lon, lat] = Array.isArray(accident.location) ? accident.location : [];
  const { date, time } = splitDatetime(accident.datetime);
  const provinceName = state.query ? state.query.provinceName : '';

  const meta = document.createElement('dl');
  meta.className = 'detail-meta';

  const metaItems = [
    ['วัน–เวลา', date ? `${date} ${time}` : '—'],
    ['แหล่งข้อมูล', SOURCE_LABELS[accident.__source] || '—'],
    ['จังหวัด', provinceName || '—'],
    ['อำเภอ / เขต', accident.district || '—'],
    ['ตำบล / แขวง', accident.subdistrict || '—'],
    ['พิกัด', Number.isFinite(lat) && Number.isFinite(lon) ? `${lat}, ${lon}` : '—'],
    ['UTM', Number.isFinite(accident.utm_e) && Number.isFinite(accident.utm_n)
      ? `โซน ${accident.utm_zone} · E ${Math.round(accident.utm_e)} · N ${Math.round(accident.utm_n)}`
      : '—'],
    ['ผู้เสียชีวิต', fmtNum(accident.death)],
    ['ผู้บาดเจ็บ', fmtNum(accident.injured)],
  ];

  for (const [label, value] of metaItems) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    meta.appendChild(wrap);
  }

  el.dialogBody.appendChild(meta);

  const vehicles = accident.vehicle || [];
  if (vehicles.length === 0) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'ไม่มีข้อมูลยานพาหนะ / ผู้ประสบเหตุ';
    el.dialogBody.appendChild(note);
  }

  for (const vehicle of vehicles) {
    const block = document.createElement('div');
    block.className = 'vehicle-block';

    const title = document.createElement('div');
    title.className = 'vehicle-title';
    const name = document.createElement('span');
    name.textContent = vehicle.vehicle_type || 'ไม่ระบุประเภทยานพาหนะ';
    const count = document.createElement('span');
    count.className = 'muted';
    count.textContent = `${fmtNum((vehicle.victim || []).length)} คน`;
    title.append(name, count);
    block.appendChild(title);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const heading of ['เพศ', 'อายุ', 'ระดับความรุนแรง', 'อาชีพ', 'ตำแหน่ง']) {
      const th = document.createElement('th');
      th.textContent = heading;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const victims = vehicle.victim || [];
    if (victims.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'muted';
      td.textContent = 'ไม่มีข้อมูลผู้ประสบเหตุ';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    for (const victim of victims) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      for (const value of [
        victim.gender || '—',
        victim.age ?? '—',
        victim.severity || '—',
        victim.occupation || '—',
        victim.position || '—',
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    block.appendChild(table);
    el.dialogBody.appendChild(block);
  }

  el.dialog.showModal();
}

el.dialogClose.addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('click', (event) => {
  if (event.target === el.dialog) el.dialog.close();
});

/* ================================================================== */
/* CSV export                                                         */
/* ================================================================== */

function exportFilename(suffix = '') {
  const query = state.query || {};
  const start = query.start_date || 'all';
  const end = query.end_date || 'all';
  const province = query.geocode ?? 'xx';
  const source = query.source_id === 0 ? 'all' : SOURCE_LABELS[query.source_id] || query.source_id || 'xx';
  const stamp = new Date().toISOString().slice(0, 10);
  return `itic_accidents${suffix}_${source}_${province}_${start}_${end}_${stamp}.csv`;
}

function ensureRows() {
  if (state.view.length === 0) {
    setStatus('ไม่มีข้อมูลให้ส่งออก', 'error');
    return false;
  }
  return true;
}

el.exportBtn.addEventListener('click', () => {
  if (!ensureRows()) return;

  const query = state.query || {};
  const header = [
    'รหัสอุบัติเหตุ', 'วันที่', 'เวลา', 'ผู้เสียชีวิต', 'ผู้บาดเจ็บ',
    'ตำบล/แขวง', 'อำเภอ/เขต', 'จังหวัด', 'ละติจูด', 'ลองจิจูด',
    'UTM Zone', 'UTM Easting', 'UTM Northing',
    'ประเภทยานพาหนะ', 'จำนวนยานพาหนะ', 'จำนวนผู้ประสบเหตุ',
    'แหล่งข้อมูล', 'ระดับความรุนแรง',
  ];

  const rows = state.view.map((accident) => {
    const { date, time } = splitDatetime(accident.datetime);
    const [lon, lat] = Array.isArray(accident.location) ? accident.location : [];
    return [
      accident.id,
      date,
      time,
      accident.death,
      accident.injured,
      accident.subdistrict,
      accident.district,
      query.provinceName || '',
      lat,
      lon,
      accident.utm_zone,
      accident.utm_e,
      accident.utm_n,
      vehicleTypes(accident).join(' | '),
      (accident.vehicle || []).length,
      victimList(accident).length,
      SOURCE_LABELS[accident.__source] || '',
      SEVERITY_LABELS[query.severity_id] || '',
    ];
  });

  downloadCSV(exportFilename(), header, rows);
  setStatus(`ส่งออก CSV ${fmtNum(rows.length)} รายการแล้ว`);
});

el.exportDetailBtn.addEventListener('click', () => {
  if (!ensureRows()) return;

  const query = state.query || {};
  const header = [
    'รหัสอุบัติเหตุ', 'วันที่', 'เวลา', 'แหล่งข้อมูล', 'ตำบล/แขวง', 'อำเภอ/เขต', 'จังหวัด',
    'ลำดับยานพาหนะ', 'ประเภทยานพาหนะ', 'เพศ', 'อายุ',
    'ระดับความรุนแรง', 'อาชีพ', 'ตำแหน่ง',
  ];

  const rows = [];
  for (const accident of state.view) {
    const { date, time } = splitDatetime(accident.datetime);
    (accident.vehicle || []).forEach((vehicle, index) => {
      for (const victim of vehicle.victim || []) {
        rows.push([
          accident.id,
          date,
          time,
          SOURCE_LABELS[accident.__source] || '',
          accident.subdistrict,
          accident.district,
          query.provinceName || '',
          index + 1,
          vehicle.vehicle_type,
          victim.gender,
          victim.age,
          victim.severity,
          victim.occupation,
          victim.position,
        ]);
      }
    });
  }

  if (rows.length === 0) {
    setStatus('ไม่พบข้อมูลผู้ประสบเหตุสำหรับส่งออก', 'error');
    return;
  }

  downloadCSV(exportFilename('_victims'), header, rows);
  setStatus(`ส่งออก CSV รายละเอียด ${fmtNum(rows.length)} แถวแล้ว`);
});

/* ================================================================== */
/* Boot                                                               */
/* ================================================================== */

(async function init() {
  setDefaultDates();
  await loadProvinces();

  const authenticated = await checkSession();
  if (authenticated) {
    setStatus('พร้อมใช้งาน — กำหนดเงื่อนไขแล้วกดค้นหาข้อมูล');
  } else {
    el.loginUser.focus();
  }
})();
