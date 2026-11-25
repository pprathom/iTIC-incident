'use strict';

/* ================================================================== */
/* Constants                                                          */
/* ================================================================== */

/** ช่วงวันที่ที่ให้เลือก: ข้อมูลจริงมีตั้งแต่ปี 2022 จนถึงวันนี้ (คำนวณ max จากวันที่ปัจจุบัน) */
const MIN_DATE = '2022-01-01';
const TODAY = (() => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
})();
const MAX_DATE = TODAY;
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
  clusters: null,
  orderTypes: [],
  defaultClusterId: null,
  risk: null,
  districtId: null,
  districtName: '',
  riskClusterTouched: false,
  riskScopeTouched: false,
};

let controller = null;
let pendingSearch = false;
let riskRequestId = 0;

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
  areaStats: $('area-stats'),

  themeToggle: $('theme-toggle'),
  themeIcon: $('theme-icon'),
  themeLabel: $('theme-label'),

  mapCard: $('map-card'),
  map: $('map'),
  mapSub: $('map-sub'),
  mapFit: $('map-fit'),

  riskCard: $('risk-card'),
  riskSub: $('risk-sub'),
  riskCluster: $('risk-cluster'),
  riskScope: $('risk-scope'),
  riskOrder: $('risk-order'),
  riskBody: $('risk-body'),
  riskCount: $('risk-count'),
  riskMapToggle: $('risk-map-toggle'),

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
/* Theme (light / dark)                                               */
/* ================================================================== */

const THEME_KEY = 'itic-theme';

function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;

  el.themeIcon.textContent = next === 'dark' ? '☀️' : '🌙';
  el.themeLabel.textContent = next === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
  el.themeToggle.title = next === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
  el.themeToggle.setAttribute('aria-pressed', String(next === 'dark'));

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* localStorage อาจถูกปิด */
    }
  }

  if (mapState.ready) setTileTheme(next);
}

el.themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

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

let mapStatusTimer = null;

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status-line${kind ? ` ${kind}` : ''}`;

  // สะท้อนสถานะที่ลอยบนแผนที่ด้วย เพื่อให้เห็นความคืบหน้าแม้เปิดแท็บอื่นอยู่
  const box = document.getElementById('map-status');
  if (!box) return;
  clearTimeout(mapStatusTimer);
  const show = Boolean(text) && (kind === 'busy' || kind === 'error');
  box.hidden = !show;
  if (show) {
    box.textContent = text;
    box.className = `map-status${kind ? ` ${kind}` : ''}`;
    if (kind === 'error') mapStatusTimer = setTimeout(() => { box.hidden = true; }, 6000);
  }
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
  document.body.classList.remove('is-app');
}

function showApp(session) {
  state.session = session;
  el.loginView.hidden = true;
  el.appView.hidden = false;
  el.sessionInfo.hidden = false;
  el.sessionUser.textContent = session.username || 'ผู้ใช้';
  document.body.classList.add('is-app');

  // คีย์แผนที่ส่งมากับข้อมูลเซสชัน (อ่านจาก .env ฝั่งเซิร์ฟเวอร์ ไม่ฝังในไฟล์ static)
  cartoKey = String((session.map && session.map.cartoKey) || '');

  // แสดงแผนที่ทันทีที่เข้าสู่ระบบ ไม่ต้องรอผลค้นหา
  if (initMap()) requestAnimationFrame(() => mapState.map.invalidateSize());
  loadClusters().catch((error) => console.warn('clusters:', error.message));
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

const THAI_YEAR_OFFSET = 543;

function buddhistYear(iso) {
  return Number(String(iso).slice(0, 4)) + THAI_YEAR_OFFSET;
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
  } else if (/^\d{4}$/.test(String(days))) {
    // ปีย้อนหลัง: ใช้ทั้งปี (ไม่เกินวันนี้)
    start = `${days}-01-01`;
    const yearEnd = `${days}-12-31`;
    el.startDate.value = clampDate(start);
    el.endDate.value = clampDate(yearEnd);
    return;
  } else {
    start = clampDate(addDays(end, -(Number(days) - 1)));
  }
  el.startDate.value = clampDate(start);
  el.endDate.value = end;
}

/** ตั้งค่า min/max ของช่องวันที่ + สร้างปุ่มลัดตามปีที่มีข้อมูล (2022 → ปีนี้) */
function setupDateControls() {
  for (const input of [el.startDate, el.endDate]) {
    input.min = MIN_DATE;
    input.max = MAX_DATE;
  }

  const group = el.startDate.closest('.filter-card') || document;
  const row = group.querySelector('.date-chips') || document.querySelector('.date-chips');
  if (!row) return;

  const thisYear = Number(MAX_DATE.slice(0, 4));
  const firstYear = Number(MIN_DATE.slice(0, 4));

  for (const button of row.querySelectorAll('[data-range]')) {
    if (button.dataset.range === 'year') {
      button.textContent = `ทั้งปี ${thisYear + THAI_YEAR_OFFSET}`;
      button.title = `1 ม.ค. – ${MAX_DATE} (ปี ${thisYear + THAI_YEAR_OFFSET})`;
    }
  }

  // ปุ่มปีที่ผ่านมา (ล่าสุดก่อน) — สูงสุด 3 ปุ่มเพื่อไม่ให้แถวยาวเกิน
  const previous = [];
  for (let year = thisYear - 1; year >= firstYear && previous.length < 3; year -= 1) {
    previous.push(year);
  }
  if (previous.length === 0) return;

  for (const year of previous) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.range = String(year);
    button.textContent = `ปี ${year + THAI_YEAR_OFFSET}`;
    button.title = `1 ม.ค. – 31 ธ.ค. ${year + THAI_YEAR_OFFSET}`;
    row.appendChild(button);
  }
}

document.querySelectorAll('.date-chips').forEach((row) => {
  row.addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (button) applyQuickRange(button.dataset.range);
  });
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
  if (mapState.ready) mapState.map.setView([item.lat, item.lon], 15, { animate: true });
  if (mapState.pinMarker) mapState.pinMarker.setLatLng([item.lat, item.lon]);
  if (mapState.circle) mapState.circle.setLatLng([item.lat, item.lon]);
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
  state.risk = null;
  el.riskCard.hidden = true;
  el.riskBody.replaceChildren();
  el.riskCount.textContent = '';
  state.districtId = null;
  state.districtName = '';
  el.areaStats.hidden = true;
  el.areaStats.replaceChildren();
  el.mapSub.textContent = '—';
  if (mapState.ready) {
    mapState.accidents.clearLayers();
    mapState.events.clearLayers();
    mapState.risks.clearLayers();
    mapState.pin.clearLayers();
    mapState.pinMarker = null;
    mapState.circle = null;
  }
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

/** เริ่มค้นหาใหม่ (ถ้ากำลังดึงอยู่ ให้ยกเลิกแล้วเริ่มใหม่หลังจบ) */
function requestSearch() {
  if (controller) {
    pendingSearch = true;
    controller.abort();
    return;
  }
  runSearch();
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
    if (rows.length > 0) activateTab('results');

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
      loadAreaInfo(query.point, query.buffer, rows.length, sameSpot ? place.name : '', query);
    } else {
      el.areaCard.hidden = true;
      state.districtId = null;
      state.districtName = '';
    }

    loadEvents(query, rows);

    if (rows.length > 0) {
      loadRisk(query);
    } else {
      state.risk = null;
      el.riskCard.hidden = true;
      renderRiskMarkers();
    }

    renderMapNow();
    fitToResults();
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('ยกเลิกการดึงข้อมูลแล้ว');
    } else {
      setStatus(error.message, 'error');
    }
  } finally {
    controller = null;
    setSearchBusy(false);

    if (pendingSearch) {
      pendingSearch = false;
      runSearch();
    }
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

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function thaiDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

function renderAreaChips(payload, point, buffer, count) {
  el.areaChips.replaceChildren();

  addAreaChip(`พบ ${fmtNum(count)} รายการ · รัศมี ${fmtNum(buffer)} ม.`);
  addAreaChip(`พิกัด ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`);

  if (payload.blackspot && payload.blackspot.name) {
    const label = payload.blackspot.subName
      ? `จุดเสี่ยง: ${payload.blackspot.name} · ${payload.blackspot.subName}`
      : `จุดเสี่ยง: ${payload.blackspot.name}`;
    addAreaChip(label);
  }

  if (payload.osmOk) addAreaChip('ชื่อสถานที่ © OpenStreetMap', 'attribution');
}

/** ปุ่มข้อมูล (i) ที่แสดงคำอธิบายเมื่อวางเมาส์/โฟกัส/แตะ (ตัวป๊อปอัปจัดการด้านล่างในส่วน Info tips) */
function infoTip(text, title = '') {
  const tip = document.createElement('span');
  tip.className = 'info-tip';
  tip.setAttribute('role', 'button');
  tip.tabIndex = 0;
  tip.textContent = 'i';
  tip.dataset.tip = text;
  if (title) tip.dataset.tipTitle = title;
  tip.setAttribute('aria-label', `คำอธิบาย${title ? `: ${title}` : ''}`);
  return tip;
}

function miniStat(label, value, metaText, metaNode, valueTip) {
  const box = document.createElement('div');
  box.className = 'mini-stat';

  const labelEl = document.createElement('span');
  labelEl.className = 'mini-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('strong');
  valueEl.textContent = value;

  const valueRow = document.createElement('div');
  valueRow.className = 'mini-value';
  valueRow.appendChild(valueEl);
  if (valueTip) valueRow.appendChild(infoTip(valueTip.text, valueTip.title));

  box.append(labelEl, valueRow);

  if (metaNode) {
    box.appendChild(metaNode);
  } else if (metaText) {
    const meta = document.createElement('span');
    meta.className = 'mini-meta';
    meta.textContent = metaText;
    box.appendChild(meta);
  }

  return box;
}

/** ข้อความอธิบายชุดข้อมูล (cluster) เช่น «ปี 2568» (1 ม.ค. 68 – 31 ธ.ค. 68) */
function clusterDescription(clusterId) {
  const cluster = clusterId != null ? clusterById(clusterId) : null;
  if (!cluster) return '';
  const range = cluster.startDate && cluster.endDate ? ` (${thaiDate(cluster.startDate)} – ${thaiDate(cluster.endDate)})` : '';
  return `«${cluster.name}»${range}`;
}

function renderAreaStats(payload, summary, buffer) {
  el.areaStats.replaceChildren();
  const cards = [];

  if (summary) {
    const radius = fmtNum(summary.radius || buffer);
    const period = `${thaiDate(summary.startDate)} – ${thaiDate(summary.endDate)}`;
    cards.push(
      miniStat(
        `ในรัศมี ${radius} ม. · ${thaiDate(summary.startDate)}–${thaiDate(summary.endDate)}`,
        fmtNum(summary.totalAccident),
        `เสียชีวิต ${fmtNum(summary.totalDeath)} · บาดเจ็บ ${fmtNum(summary.totalInjured)}`,
        null,
        {
          title: 'อุบัติเหตุในรัศมีรอบจุดที่เลือก',
          text:
            `จำนวนอุบัติเหตุที่เกิดภายในรัศมี ${radius} เมตรรอบจุดที่เลือก ช่วงวันที่ ${period} ตามที่ตั้งในแท็บตัวกรอง (สรุปจากข้อมูล RAIS ของ iTIC)\n` +
            'บรรทัดล่างคือผลรวมผู้เสียชีวิตและผู้บาดเจ็บของอุบัติเหตุเหล่านี้\n' +
            'ตัวเลขนี้ไม่ขึ้นกับแหล่งข้อมูลหรือระดับความรุนแรงที่เลือกในตัวกรอง จึงอาจไม่เท่ากับ “รายการอุบัติเหตุ” ในแท็บผลลัพธ์',
        }
      )
    );
  }

  const district = payload.districtStats;
  if (district && district.districtName) {
    const name = district.districtName;
    const clusterText = clusterDescription(district.clusterId);
    const clusterRef = clusterText ? `ชุดข้อมูลจุดเสี่ยง ${clusterText}` : 'ชุดข้อมูลจุดเสี่ยงของ iTIC (ดูช่วงเวลาได้ที่แท็บจุดเสี่ยง › ชุดข้อมูล)';
    const criterion = district.orderTypeName ? `เรียงตาม “${district.orderTypeName}”` : 'เรียงตามเกณฑ์ของชุดข้อมูลที่ iTIC กำหนด';

    // ชุดข้อมูลครอบคลุมช่วงวันที่ที่ค้นหาหรือไม่ (ตัวเลขนี้นับทั้งช่วงของชุดข้อมูล ไม่ใช่เฉพาะช่วงที่ค้นหา)
    const cluster = district.clusterId != null ? clusterById(district.clusterId) : null;
    const queryStart = (summary && summary.startDate) || (state.query && state.query.start_date) || '';
    const queryEnd = (summary && summary.endDate) || (state.query && state.query.end_date) || '';
    let coverageNote = '';
    if (cluster && cluster.startDate && cluster.endDate && queryStart && queryEnd) {
      const covers = cluster.startDate <= queryStart && cluster.endDate >= queryEnd;
      const overlaps = cluster.startDate <= queryEnd && cluster.endDate >= queryStart;
      if (!overlaps) {
        coverageNote = `หมายเหตุ: ชุดข้อมูลนี้ไม่ทับซ้อนกับช่วงวันที่ที่ค้นหา (${thaiDate(queryStart)} – ${thaiDate(queryEnd)}) เพราะ iTIC ยังไม่มีชุดข้อมูลที่ตรงช่วงนั้น จึงใช้ชุดที่ใกล้ที่สุด`;
      } else if (!covers) {
        coverageNote = 'หมายเหตุ: ชุดข้อมูลนี้ครอบคลุมช่วงวันที่ที่ค้นหาเพียงบางส่วน';
      }
    }

    const meta = document.createElement('span');
    meta.className = 'mini-meta';

    const part = (text, tip) => {
      const span = document.createElement('span');
      span.className = 'mini-part';
      span.append(text);
      if (tip) span.appendChild(infoTip(tip.text, tip.title));
      return span;
    };

    if (district.rankInProvince != null) {
      meta.appendChild(
        part(`อันดับ ${fmtNum(district.rankInProvince)} ในจังหวัด`, {
          title: 'อันดับในจังหวัด',
          text: `อันดับของ${name} เมื่อเทียบกับเขต/อำเภออื่นในจังหวัดเดียวกัน ${criterion}\nอันดับ 1 = มากที่สุด`,
        })
      );
      if (district.levelInProvince) {
        const level = document.createElement('span');
        level.className = 'mini-part';
        level.appendChild(levelBadge(district.levelInProvince));
        level.appendChild(
          infoTip(
            `ระดับความรุนแรง (มาก / ปานกลาง / น้อย) ที่ iTIC จัดให้${name} เมื่อเทียบกับเขต/อำเภออื่นในจังหวัด\nเป็นค่าจาก API ไม่ใช่ค่าที่แอปคำนวณ (ต่างจากระดับของจุดเสี่ยงในแท็บจุดเสี่ยง ซึ่งแอปคำนวณจากอันดับ)`,
            'ระดับความรุนแรงของเขต/อำเภอ'
          )
        );
        meta.appendChild(level);
      }
    }

    if (district.rankInCluster != null) {
      meta.appendChild(
        part(`${district.rankInProvince != null ? '· ' : ''}อันดับ ${fmtNum(district.rankInCluster)} ในชุดข้อมูล`, {
          title: 'อันดับในชุดข้อมูล',
          text: `อันดับของ${name} เมื่อเทียบกับเขต/อำเภอทั้งหมดที่อยู่ในชุดข้อมูลเดียวกัน (${clusterText || 'ชุดข้อมูลจุดเสี่ยงของ iTIC'}) ${criterion}\nอันดับ 1 = มากที่สุด`,
        })
      );
    }

    cards.push(
      miniStat(`เขต/อำเภอ ${name}`, fmtNum(district.totalAccident), null, meta, {
        title: `จำนวนอุบัติเหตุของ${name}`,
        text:
          `จำนวนอุบัติเหตุรวมของ${name} (ค่า total_accident จาก iTIC) ตาม${clusterRef}\n` +
          'แอปเลือกชุดข้อมูลที่ทับซ้อนกับช่วงวันที่ค้นหามากที่สุดให้ (เหมือนแผงจุดเสี่ยง) ตัวเลขนี้นับทั้งช่วงของชุดข้อมูล ไม่ใช่เฉพาะช่วงวันที่ที่ค้นหา และไม่ขึ้นกับตัวกรองอื่นในแอป\n' +
          (coverageNote ? `${coverageNote}\n` : '') +
          'ถ้าต้องการจำนวนตามช่วงที่ค้นหา ดูการ์ด “ในรัศมี …” หรือแท็บผลลัพธ์',
      })
    );
  }

  if (cards.length === 0) {
    el.areaStats.hidden = true;
    return;
  }

  el.areaStats.hidden = false;
  el.areaStats.append(...cards);
}

/**
 * /api/area เรียก get_by_district โดยไม่ระบุชุดข้อมูล ทำให้ API เลือกชุดของตัวเอง (เช่น อุบัติเหตุ 2567)
 * จึงขอสถิติอำเภอซ้ำด้วยชุดข้อมูลที่ตรงกับช่วงวันที่ค้นหา (เหมือนที่แผงจุดเสี่ยงเลือก) เพื่อให้ตัวเลขสอดคล้องกัน
 */
async function refineDistrictStats(payload, point, query) {
  const current = payload.districtStats;
  if (!current) return;

  try {
    await loadClusters();
    const wanted = state.riskClusterTouched ? clusterById(el.riskCluster.value) : pickClusterForRange(query);
    if (!wanted || Number(current.clusterId) === Number(wanted.id)) return;

    const params = new URLSearchParams({ lat: point.lat, lon: point.lon, cluster_id: String(wanted.id) });
    const result = await api(`/api/district-stats?${params.toString()}`);
    if (result && result.district && result.district.districtName) payload.districtStats = result.district;
  } catch (error) {
    console.warn('district-stats:', error.message); // ใช้ค่าที่ API เลือกให้ต่อไป
  }
}

async function loadAreaInfo(point, buffer, count, preferredTitle, query) {
  el.areaCard.hidden = false;
  el.areaTitle.textContent = preferredTitle || 'กำลังระบุชื่อบริเวณ…';
  el.areaDetail.textContent = '';
  el.areaChips.replaceChildren();
  el.areaStats.hidden = true;
  el.areaStats.replaceChildren();

  const areaParams = new URLSearchParams({ lat: point.lat, lon: point.lon });
  const summaryParams = new URLSearchParams({
    lat: point.lat,
    lon: point.lon,
    radius: String(buffer),
    start_date: query.start_date,
    end_date: query.end_date,
  });

  const [areaResult, summaryResult] = await Promise.allSettled([
    api(`/api/area?${areaParams.toString()}`),
    api(`/api/area-summary?${summaryParams.toString()}`),
  ]);

  const payload = areaResult.status === 'fulfilled' ? areaResult.value : {};
  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;

  await refineDistrictStats(payload, point, query);

  if (payload.districtStats && payload.districtStats.districtId) {
    const nextDistrictId = payload.districtStats.districtId;
    // ถ้าย้ายไปอำเภออื่น ให้กลับไปใช้ค่าอัตโนมัติ (ไม่ค้างตัวเลือกเดิมของผู้ใช้)
    if (String(nextDistrictId) !== String(state.districtId)) state.riskScopeTouched = false;
    state.districtId = nextDistrictId;
    state.districtName = payload.districtStats.districtName || '';
  }

  el.areaTitle.textContent = preferredTitle || payload.title || 'ไม่ทราบชื่อบริเวณ';
  el.areaDetail.textContent =
    payload.detail || [payload.district, payload.province].filter(Boolean).join(' · ');

  if (areaResult.status === 'rejected') {
    el.areaDetail.textContent = areaResult.reason.message;
  }

  renderAreaChips(payload, point, buffer, count);
  renderAreaStats(payload, summary, buffer);

  // เมื่อรู้รหัสอำเภอแล้ว ให้สลับพื้นที่ของแผงจุดเสี่ยงเป็นระดับอำเภอ (ถ้าผู้ใช้ยังไม่เลือกเอง)
  applyDistrictScope();
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
    renderEventMarkers();
  } catch (error) {
    state.events = [];
    el.eventsCard.hidden = true;
    renderEventMarkers();
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
/* Map (Leaflet + CARTO basemaps)                                     */
/* ================================================================== */

/* คีย์ CARTO มาจากเซิร์ฟเวอร์ (อ่านจาก .env) เฉพาะผู้ใช้ที่ล็อกอินแล้ว — ไม่ฝังในโค้ดฝั่งเบราว์เซอร์ */
let cartoKey = '';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
  ' · &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

const CARTO_TILES = {
  light: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

/** ชุดแผนที่ตามธีม: ใช้ CARTO เมื่อมีคีย์ ไม่งั้นถอยไปใช้ OSM มาตรฐาน */
function tileSourceFor(theme) {
  if (cartoKey) {
    return {
      url: `${CARTO_TILES[theme] || CARTO_TILES.light}?key=${encodeURIComponent(cartoKey)}`,
      attribution: CARTO_ATTRIBUTION,
    };
  }
  return { url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
}

const MAP_MAX_ACCIDENTS = 4000;
const MAP_MAX_RISKS = 400;
const RISK_TABLE_LIMIT = 200;

const SEVERITY_COLORS = { death: '#dc2626', injured: '#f59e0b', none: '#0284c7' };

const EVENT_COLORS = {
  flood: '#0284c7',
  fire: '#dc2626',
  accident: '#be123c',
  roadclosed: '#475569',
  diversion: '#d97706',
  carbreakdown: '#ea580c',
  earthquake: '#7c3aed',
  event: '#4f46e5',
  construction: '#a16207',
  protest: '#db2777',
  other: '#64748b',
};

const LEVEL_LABELS = { high: 'มาก', medium: 'ปานกลาง', low: 'น้อย', unknown: '—' };
const LEVEL_COLORS = { high: '#dc2626', medium: '#f59e0b', low: '#16a34a' };

const mapState = {
  map: null,
  ready: false,
  tiles: null,
  accidents: null,
  events: null,
  risks: null,
  pin: null,
  pinMarker: null,
  circle: null,
  mode: 'inspect', // 'inspect' = คลิกจุดเพื่อดูข้อมูล, 'area' = คลิกแผนที่เพื่อเลือกบริเวณ
  showRisks: true,
  located: 0,
  shown: 0,
};

function initMap() {
  if (mapState.ready) return true;

  if (typeof L === 'undefined') {
    el.mapSub.textContent = 'โหลดไลบรารีแผนที่ (Leaflet) ไม่สำเร็จ';
    return false;
  }

  const map = L.map(el.map, {
    center: [13.7563, 100.5018],
    zoom: 11,
    preferCanvas: true,
    zoomControl: true,
    worldCopyJump: true,
  });

  // ลำดับชั้น: จุดเสี่ยง (วงแหวน) อยู่ล่างสุด → เหตุการณ์ → อุบัติเหตุ → หมุดค้นหา
  mapState.risks = L.layerGroup().addTo(map);
  mapState.events = L.layerGroup().addTo(map);
  mapState.accidents = L.layerGroup().addTo(map);
  mapState.pin = L.layerGroup().addTo(map);
  mapState.map = map;

  setTileTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  // โหมด "เลือกบริเวณ" เท่านั้นที่คลิกแผนที่แล้วย้ายหมุด/ค้นหาใหม่
  map.on('click', (event) => {
    if (mapState.mode !== 'area') return;
    movePin(event.latlng.lat, event.latlng.lng, { search: true });
  });

  // โหมด "เลือกบริเวณ": คลิกที่จุดอุบัติเหตุ/เหตุการณ์/จุดเสี่ยง ให้ใช้ตำแหน่งนั้นเป็นศูนย์กลาง ไม่เปิด popup
  map.on('popupopen', (event) => {
    if (mapState.mode !== 'area') return;
    const source = event.popup && event.popup._source;
    if (!source || typeof source.getLatLng !== 'function') return;
    const at = source.getLatLng();
    map.closePopup();
    movePin(at.lat, at.lng, { search: true });
  });

  mapState.ready = true;
  return true;
}

function setTileTheme(theme) {
  if (!mapState.map) return;

  const source = tileSourceFor(theme);
  const layer = L.tileLayer(source.url, {
    attribution: source.attribution,
    maxZoom: 20,
    maxNativeZoom: cartoKey ? 20 : 19,
    detectRetina: Boolean(cartoKey),
  });

  layer.addTo(mapState.map);
  if (mapState.tiles) mapState.map.removeLayer(mapState.tiles);
  mapState.tiles = layer;
}

function accidentLatLng(accident) {
  const location = Array.isArray(accident.location) ? accident.location : [];
  const [lon, lat] = location;
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

function severityOf(accident) {
  if ((Number(accident.death) || 0) > 0) return 'death';
  if ((Number(accident.injured) || 0) > 0) return 'injured';
  return 'none';
}

function pinIcon() {
  return L.divIcon({
    className: 'map-pin',
    html: '<span class="map-pin-head"></span>',
    iconSize: [26, 34],
    iconAnchor: [13, 30],
  });
}

/* ------------------------------ popups ------------------------------ */

function popupBox(children) {
  const box = document.createElement('div');
  box.className = 'map-popup';
  box.append(...children.filter(Boolean));
  return box;
}

function popupLine(text, className = 'muted') {
  if (!text) return null;
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function accidentPopup(accident) {
  const { date, time } = splitDatetime(accident.datetime);
  const title = document.createElement('strong');
  title.textContent = `${date || '—'} ${time || ''}`.trim();

  const meta = popupLine(
    [accident.subdistrict, accident.district, SOURCE_LABELS[accident.__source]].filter(Boolean).join(' · ')
  );
  const stats = popupLine(`เสียชีวิต ${fmtNum(accident.death)} · บาดเจ็บ ${fmtNum(accident.injured)}`);

  const actions = document.createElement('div');
  actions.className = 'popup-actions';
  const detail = document.createElement('button');
  detail.type = 'button';
  detail.className = 'btn btn-outline btn-sm';
  detail.textContent = 'ดูรายละเอียด';
  detail.addEventListener('click', () => {
    mapState.map.closePopup();
    openDetail(accident);
  });
  actions.appendChild(detail);

  return popupBox([title, meta, stats, actions]);
}

function eventPopup(event) {
  const title = document.createElement('strong');
  title.textContent = event.title || '(ไม่มีชื่อเหตุการณ์)';

  const parts = [event.typeLabel, formatEventTime(event.start)];
  if (Number.isFinite(event.distance)) parts.push(formatDistance(event.distance));

  const desc = popupLine(String(event.description || '').replace(/\s+/g, ' ').slice(0, 180));
  return popupBox([title, popupLine(parts.filter(Boolean).join(' · ')), desc]);
}

function riskPopup(spot, level) {
  const title = document.createElement('strong');
  title.textContent = spot.name || '(ไม่มีชื่อจุดเสี่ยง)';

  const sub = popupLine([spot.sub_name, spot.road_name, spot.district].filter(Boolean).join(' · '));
  const stats = popupLine(
    `อุบัติเหตุ ${fmtNum(spot.total)} · เสียชีวิต ${fmtNum(spot.death)} · บาดเจ็บ ${fmtNum(spot.injured)}`
  );

  const badge = document.createElement('span');
  badge.className = `level ${level}`;
  badge.textContent = LEVEL_LABELS[level] || '—';

  const actions = document.createElement('div');
  actions.className = 'popup-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-outline btn-sm';
  btn.textContent = 'ค้นหาอุบัติเหตุรอบจุดนี้';
  btn.addEventListener('click', () => {
    const [lon, lat] = spot.location || [];
    mapState.map.closePopup();
    movePin(lat, lon, { search: true });
    mapState.map.setView([lat, lon], 16);
  });
  actions.appendChild(btn);

  return popupBox([title, sub, stats, badge, actions]);
}

/* ------------------------------ layers ------------------------------ */

function renderMap() {
  if (!initMap()) return;

  const rows = state.view;
  const point = state.query && state.query.point ? state.query.point : null;
  const buffer = Number(state.query && state.query.buffer) || 0;

  mapState.map.invalidateSize();

  if (rows.length === 0 && !point) {
    mapState.accidents.clearLayers();
    mapState.pin.clearLayers();
    mapState.pinMarker = null;
    mapState.circle = null;
    mapState.shown = 0;
    if (state.query) el.mapSub.textContent = 'ไม่พบข้อมูลตามเงื่อนไขที่กำหนด';
    return;
  }

  mapState.accidents.clearLayers();
  mapState.pin.clearLayers();
  mapState.pinMarker = null;
  mapState.circle = null;

  const located = [];
  for (const accident of rows) {
    const ll = accidentLatLng(accident);
    if (ll) located.push({ accident, ll });
  }

  // ให้จุดที่มีผู้เสียชีวิตอยู่บนสุดเสมอ (canvas วาดทับกันตามลำดับ)
  const rank = { death: 0, injured: 1, none: 2 };
  located.sort((a, b) => {
    const diff = rank[severityOf(a.accident)] - rank[severityOf(b.accident)];
    if (diff !== 0) return diff;
    return String(b.accident.datetime).localeCompare(String(a.accident.datetime));
  });

  const shown = located.slice(0, MAP_MAX_ACCIDENTS);
  for (const { accident, ll } of shown) {
    L.circleMarker(ll, {
      bubblingMouseEvents: false,
      radius: 5,
      weight: 1,
      color: '#ffffff',
      opacity: 0.85,
      fillColor: SEVERITY_COLORS[severityOf(accident)],
      fillOpacity: 0.85,
    })
      .bindPopup(() => accidentPopup(accident), { minWidth: 220 })
      .addTo(mapState.accidents);
  }

  mapState.located = located.length;
  mapState.shown = shown.length;

  if (point) {
    const latlng = [point.lat, point.lon];

    if (buffer > 0) {
      mapState.circle = L.circle(latlng, {
        interactive: false, // วงรัศมีเป็นแค่ภาพ ต้องไม่บังการคลิกจุดอุบัติเหตุที่อยู่ข้างใน
        radius: buffer,
        color: '#0f766e',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#0f766e',
        fillOpacity: 0.07,
        dashArray: '5 5',
      }).addTo(mapState.pin);
    }

    mapState.pinMarker = L.marker(latlng, {
      draggable: true,
      keyboard: false,
      title: 'ลากเพื่อย้ายจุดค้นหา',
      icon: pinIcon(),
      zIndexOffset: 1200,
    }).addTo(mapState.pin);

    mapState.pinMarker.on('dragend', () => {
      const pos = mapState.pinMarker.getLatLng();
      movePin(pos.lat, pos.lng, { search: true });
    });
  }

  applyMapMode();

  renderEventMarkers();
  renderRiskMarkers();
  updateMapSummary();
}

/** ดันจุดอุบัติเหตุขึ้นบนสุดของแคนวาส ไม่ให้ถูกวงแหวนจุดเสี่ยง/เหตุการณ์สดที่วาดทีหลังทับ */
function raiseAccidents() {
  if (!mapState.ready || !mapState.map.hasLayer(mapState.accidents)) return;
  mapState.accidents.eachLayer((layer) => {
    if (typeof layer.bringToFront === 'function') layer.bringToFront();
  });
}

function renderEventMarkers() {
  if (!mapState.ready) return;

  mapState.events.clearLayers();
  for (const event of state.events) {
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;
    L.circleMarker([event.lat, event.lon], {
      bubblingMouseEvents: false,
      radius: 8,
      weight: 2,
      color: '#ffffff',
      opacity: 0.95,
      fillColor: EVENT_COLORS[event.type] || EVENT_COLORS.other,
      fillOpacity: 0.95,
    })
      .bindPopup(() => eventPopup(event), { minWidth: 220 })
      .addTo(mapState.events);
  }
  raiseAccidents();
  updateMapSummary();
}

function renderRiskMarkers() {
  if (!mapState.ready) return;

  mapState.risks.clearLayers();
  if (!mapState.showRisks || !state.risk) {
    updateMapSummary();
    return;
  }

  const risk = state.risk;
  for (const spot of risk.rows.slice(0, MAP_MAX_RISKS)) {
    const [lon, lat] = spot.location || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const level = riskLevel(spot, risk);
    // วาดเป็นวงแหวน (ไม่ทึบ) และย่อขนาดตามระดับ เพื่อไม่ให้กลืนกับจุดอุบัติเหตุที่อยู่ชั้นบน
    const style =
      level === 'high'
        ? { radius: 9, weight: 2.5, opacity: 0.95, fillOpacity: 0.2 }
        : level === 'medium'
          ? { radius: 7.5, weight: 2, opacity: 0.85, fillOpacity: 0.14 }
          : { radius: 5.5, weight: 1, opacity: 0.5, fillOpacity: 0.06 };

    L.circleMarker([lat, lon], {
      bubblingMouseEvents: false,
      ...style,
      color: LEVEL_COLORS[level] || '#0f766e',
      fillColor: LEVEL_COLORS[level] || '#0f766e',
    })
      .bindPopup(() => riskPopup(spot, level), { minWidth: 230 })
      .addTo(mapState.risks);
  }
  raiseAccidents();
  updateMapSummary();
}

function updateMapSummary() {
  const total = state.view.length;
  const parts = [`แสดง ${fmtNum(mapState.shown)} จาก ${fmtNum(total)} รายการ`];
  if (total > MAP_MAX_ACCIDENTS) parts.push(`จำกัด ${fmtNum(MAP_MAX_ACCIDENTS)} จุดเพื่อความเร็ว`);
  if (state.events.length) parts.push(`เหตุการณ์ปัจจุบัน ${fmtNum(state.events.length)}`);
  if (state.risk && state.risk.rows.length && mapState.showRisks) {
    const drawn = Math.min(state.risk.rows.length, MAP_MAX_RISKS);
    parts.push(`จุดเสี่ยง ${fmtNum(drawn)}${state.risk.rows.length > drawn ? `/${fmtNum(state.risk.rows.length)}` : ''}`);
  }
  el.mapSub.textContent = parts.join(' · ');
}

let mapRenderTimer = null;

/** อัปเดตแผนที่แบบ debounce (เรียกจาก render() ทุกครั้งที่ผลลัพธ์เปลี่ยน) */
function scheduleMapRender() {
  clearTimeout(mapRenderTimer);
  mapRenderTimer = setTimeout(() => {
    if (state.rows.length > 0 || (state.query && state.query.point)) renderMap();
  }, 200);
}

/** วาดแผนที่ทันที (ใช้หลังค้นหาเสร็จ เพื่อ fit bounds ได้ถูกจังหวะ) */
function renderMapNow() {
  clearTimeout(mapRenderTimer);
  renderMap();
}

function fitToResults() {
  if (!mapState.ready) return;

  const bounds = L.latLngBounds([]);

  for (const accident of state.view) {
    const ll = accidentLatLng(accident);
    if (ll) bounds.extend(ll);
  }

  if (state.query && state.query.point) {
    bounds.extend([state.query.point.lat, state.query.point.lon]);
  }

  if (!bounds.isValid() && state.risk) {
    for (const spot of state.risk.rows) {
      const [lon, lat] = spot.location || [];
      if (Number.isFinite(lat) && Number.isFinite(lon)) bounds.extend([lat, lon]);
    }
  }

  if (!bounds.isValid()) return;

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const samePoint = Math.abs(ne.lat - sw.lat) < 1e-6 && Math.abs(ne.lng - sw.lng) < 1e-6;

  if (samePoint) {
    mapState.map.setView(bounds.getCenter(), 16);
  } else {
    mapState.map.fitBounds(bounds, { padding: [26, 26], maxZoom: 16 });
  }
}

/** ปรับหน้าตา/พฤติกรรมแผนที่ตามโหมดปัจจุบัน */
function applyMapMode() {
  const area = mapState.mode === 'area';

  el.map.classList.toggle('is-area-mode', area);

  const hint = document.getElementById('mode-hint');
  if (hint) hint.hidden = !area;

  for (const [id, active] of [['mode-inspect', !area], ['mode-area', area]]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  // ลากหมุดย้ายจุดได้เฉพาะโหมดเลือกบริเวณ
  if (mapState.pinMarker && mapState.pinMarker.dragging) {
    if (area) mapState.pinMarker.dragging.enable();
    else mapState.pinMarker.dragging.disable();
  }
}

function setMapMode(mode) {
  mapState.mode = mode === 'area' ? 'area' : 'inspect';
  if (mapState.ready && mapState.mode === 'area') mapState.map.closePopup();
  applyMapMode();
}

/** ย้ายหมุดค้นหา (จากลากหมุด / คลิกแผนที่ / popup) */
function movePin(lat, lon, { search = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  el.lat.value = Number(lat).toFixed(6);
  el.lon.value = Number(lon).toFixed(6);

  if (!el.useArea.checked) {
    el.useArea.checked = true;
    syncAreaInputs();
  }

  state.place = null;

  if (mapState.pinMarker) mapState.pinMarker.setLatLng([lat, lon]);
  if (mapState.circle) mapState.circle.setLatLng([lat, lon]);

  if (search) requestSearch();
}

el.mapFit.addEventListener('click', fitToResults);

el.buffer.addEventListener('change', () => {
  const radius = Number(el.buffer.value);
  if (mapState.circle && Number.isFinite(radius) && radius > 0) {
    mapState.circle.setRadius(radius);
  }
  if (state.query && state.query.point) requestSearch();
});

for (const input of [el.lat, el.lon]) {
  input.addEventListener('change', () => {
    const lat = Number(el.lat.value);
    const lon = Number(el.lon.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    state.place = null;
    if (mapState.pinMarker) mapState.pinMarker.setLatLng([lat, lon]);
    if (mapState.circle) mapState.circle.setLatLng([lat, lon]);
  });
}

/* ================================================================== */
/* Blackspot panel                                                    */
/* ================================================================== */

function clusterById(id) {
  return (state.clusters || []).find((cluster) => cluster.id === Number(id)) || null;
}

/**
 * ระดับความรุนแรงของจุดเสี่ยง (แดง/เหลือง/เขียว)
 * API ไม่ได้ส่ง level มาในรายการ get_list จึงคำนวณเองจากอันดับ (rank) ภายในรายการที่กรองอยู่:
 *   อันดับต้น ๆ = มาก (สูงสุด 10 อันดับแรก หรือ 5% ของรายการ), ถัดมา = ปานกลาง (สูงสุด 50 อันดับ หรือ 20%)
 */
function riskLevel(spot, risk) {
  if (!risk || !risk.rows || risk.rows.length === 0) return 'unknown';

  const total = risk.rows.length;
  const rank = Number(spot.rank);
  if (!Number.isFinite(rank) || rank <= 0) return 'unknown';

  const highCut = Math.min(10, Math.max(3, Math.ceil(total * 0.05)));
  const mediumCut = Math.min(50, Math.max(10, Math.ceil(total * 0.2)));

  if (rank <= highCut) return 'high';
  if (rank <= mediumCut) return 'medium';
  return 'low';
}

function levelBadge(level) {
  const key = String(level || '').toLowerCase();
  const badge = document.createElement('span');
  badge.className = `level ${['high', 'medium', 'low'].includes(key) ? key : 'unknown'}`;
  badge.textContent = LEVEL_LABELS[key] || level || '—';
  return badge;
}

async function loadClusters() {
  if (state.clusters) return state.clusters;

  const payload = await api('/api/clusters');
  state.clusters = payload.data || [];
  state.orderTypes = payload.orderTypes || [];
  state.defaultClusterId = payload.defaultId;

  el.riskCluster.replaceChildren();
  for (const cluster of state.clusters) {
    const option = document.createElement('option');
    option.value = String(cluster.id);
    const empty = cluster.max && Number(cluster.max.total) === 0;
    const years =
      cluster.startDate && cluster.endDate
        ? ` (${cluster.startDate.slice(0, 4)}–${cluster.endDate.slice(0, 4)})`
        : '';
    option.textContent = `${cluster.name}${years}${empty ? ' · ยังไม่มีข้อมูล' : ''}`;
    option.title = cluster.startDate && cluster.endDate ? `${cluster.startDate} ถึง ${cluster.endDate}` : '';
    el.riskCluster.appendChild(option);
  }
  if (payload.defaultId != null) el.riskCluster.value = String(payload.defaultId);

  el.riskOrder.replaceChildren();
  for (const type of state.orderTypes) {
    const option = document.createElement('option');
    option.value = String(type.id);
    option.textContent = type.label;
    el.riskOrder.appendChild(option);
  }

  const current = clusterById(el.riskCluster.value);
  el.riskOrder.value = String((current && current.defaultOrderId) || 1);

  return state.clusters;
}

/** ตัวเลือกพื้นที่: ทั้งจังหวัด (2 หลัก) และอำเภอของจุดที่ค้นหา (4 หลัก) */
function renderRiskScopes() {
  const query = state.query;
  if (!query) return;

  const options = [
    {
      value: String(query.geocode).padStart(2, '0'),
      label: `ทั้งจังหวัด (${query.provinceName || query.geocode})`,
    },
  ];

  if (state.districtId) {
    options.push({
      value: String(state.districtId),
      label: `อำเภอ/เขต ${state.districtName || state.districtId}`,
    });
  }

  const current = el.riskScope.value;
  el.riskScope.replaceChildren();

  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    el.riskScope.appendChild(option);
  }

  if (options.some((item) => item.value === current)) {
    el.riskScope.value = current;
  }
}

/** เลือก cluster ที่ทับซ้อนกับช่วงวันที่ค้นหามากที่สุด (ข้ามชุดที่ยังไม่มีข้อมูล) */
function pickClusterForRange(query) {
  const list = (state.clusters || []).filter(
    (cluster) => cluster.startDate && cluster.endDate && (!cluster.max || Number(cluster.max.total) > 0)
  );
  if (list.length === 0) return null;

  const day = 86400000;
  const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
  let best = null;
  let bestScore = -1;

  for (const cluster of list) {
    const start = Math.max(toTime(cluster.startDate), toTime(query.start_date));
    const end = Math.min(toTime(cluster.endDate), toTime(query.end_date));
    const overlap = end >= start ? (end - start) / day + 1 : 0;
    // ถ้าไม่ทับซ้อนเลย ให้ชุดที่สิ้นสุดล่าสุดเป็นตัวเลือกสำรอง (ค่าน้อยกว่า 1 วันเสมอ)
    const score = overlap > 0 ? overlap : toTime(cluster.endDate) / day / 100000;
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }
  return best;
}

async function loadRisk(query) {
  if (!query) return;

  const requestId = ++riskRequestId;

  el.riskCard.hidden = false;
  el.riskSub.textContent = 'กำลังดึงรายการจุดเสี่ยง…';
  el.riskBody.replaceChildren();
  el.riskCount.textContent = '';
  state.risk = null;

  try {
    await loadClusters();
    if (requestId !== riskRequestId) return;
    renderRiskScopes();

    // เลือก cluster ที่ตรงกับช่วงวันที่ค้นหาให้อัตโนมัติ (ถ้าผู้ใช้ยังไม่เลือกเอง)
    if (!state.riskClusterTouched) {
      const best = pickClusterForRange(query);
      if (best) el.riskCluster.value = String(best.id);
      const current = clusterById(el.riskCluster.value);
      if (current) el.riskOrder.value = String(current.defaultOrderId || 1);
    }

    const clusterId = el.riskCluster.value;
    const districtId = el.riskScope.value;
    const orderTypeId = el.riskOrder.value;

    const params = new URLSearchParams({
      cluster_id: clusterId,
      district_id: districtId,
      order_type_id: orderTypeId,
      all: '1',
    });

    const payload = await api(`/api/blackspots?${params.toString()}`);
    if (requestId !== riskRequestId) return;

    state.risk = {
      clusterId: Number(clusterId),
      districtId,
      orderTypeId: Number(orderTypeId),
      rows: payload.data || [],
      total: payload.total || 0,
      truncated: Boolean(payload.truncated),
    };

    renderRiskTable();
    renderRiskMarkers();
  } catch (error) {
    if (requestId !== riskRequestId) return;
    el.riskSub.textContent = error.message;
    el.riskCard.hidden = false;
  }
}

/** ใช้พื้นที่ระดับอำเภอเมื่อรู้รหัสอำเภอจากพิกัดที่ค้นหา */
function applyDistrictScope() {
  if (!state.districtId || state.riskScopeTouched || !state.query) return;

  renderRiskScopes();
  if (el.riskScope.value !== String(state.districtId)) {
    el.riskScope.value = String(state.districtId);
    loadRisk(state.query);
  }
}

function renderRiskTable() {
  const risk = state.risk;
  el.riskBody.replaceChildren();

  if (!risk || risk.rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'risk-empty';
    td.textContent = 'ไม่พบจุดเสี่ยงในพื้นที่นี้';
    tr.appendChild(td);
    el.riskBody.appendChild(tr);
    el.riskCount.textContent = '';
    el.riskSub.textContent = 'ไม่พบจุดเสี่ยงในพื้นที่ที่เลือก';
    return;
  }

  const cluster = clusterById(risk.clusterId);
  const scopeLabel = el.riskScope.selectedOptions[0] ? el.riskScope.selectedOptions[0].textContent : '';
  const orderLabel = el.riskOrder.selectedOptions[0] ? el.riskOrder.selectedOptions[0].textContent : '';

  const subParts = [cluster ? cluster.name : '', scopeLabel, `เรียงตาม${orderLabel}`].filter(Boolean);
  if (cluster && cluster.startDate && cluster.endDate && state.query) {
    const overlaps = cluster.startDate <= state.query.end_date && cluster.endDate >= state.query.start_date;
    if (!overlaps) {
      subParts.push(`⚠ ชุดข้อมูลครอบคลุม ${cluster.startDate} ถึง ${cluster.endDate}`);
    }
  }
  el.riskSub.textContent = subParts.join(' · ');

  const fragment = document.createDocumentFragment();
  for (const spot of risk.rows.slice(0, RISK_TABLE_LIMIT)) {
    fragment.appendChild(riskRow(spot, risk));
  }
  el.riskBody.replaceChildren(fragment);

  const shown = Math.min(risk.rows.length, RISK_TABLE_LIMIT);
  const parts = [
    risk.rows.length > shown
      ? `แสดง ${fmtNum(shown)} จาก ${fmtNum(risk.rows.length)} จุดเสี่ยง`
      : `ทั้งหมด ${fmtNum(risk.rows.length)} จุดเสี่ยง`,
  ];
  if (risk.truncated) parts.push('ตัดที่ 5,000 อันดับแรก');
  el.riskCount.textContent = parts.join(' · ');
}

function riskRow(spot, risk) {
  const level = riskLevel(spot, risk);

  const tr = document.createElement('tr');
  tr.title = 'คลิกเพื่อดูบนแผนที่';
  tr.addEventListener('click', () => focusRisk(spot));

  const rank = document.createElement('td');
  rank.className = 'risk-rank';
  rank.textContent = fmtNum(spot.rank);

  const nameCell = document.createElement('td');
  const name = document.createElement('span');
  name.className = 'risk-name';
  name.textContent = spot.name || '—';
  nameCell.appendChild(name);

  const subText = [spot.sub_name, spot.road_name].filter(Boolean).join(' · ');
  if (subText) {
    const sub = document.createElement('span');
    sub.className = 'risk-sub';
    sub.textContent = subText;
    nameCell.appendChild(sub);
  }

  const district = document.createElement('td');
  district.textContent = spot.district || '—';

  const total = document.createElement('td');
  total.className = 'num';
  total.textContent = fmtNum(spot.total);

  const death = document.createElement('td');
  death.className = 'num';
  death.textContent = fmtNum(spot.death);

  const injured = document.createElement('td');
  injured.className = 'num';
  injured.textContent = fmtNum(spot.injured);

  const levelCell = document.createElement('td');
  const badge = levelBadge(level);
  badge.title = 'คำนวณจากอันดับในรายการที่กรองอยู่ (ไม่ใช่ค่าจาก API)';
  levelCell.appendChild(badge);

  tr.append(rank, nameCell, district, total, death, injured, levelCell);
  return tr;
}

function focusRisk(spot) {
  const [lon, lat] = spot.location || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (!initMap()) return;

  mapState.map.invalidateSize();
  mapState.map.setView([lat, lon], 17, { animate: true });

  const level = riskLevel(spot, state.risk);
  L.popup({ minWidth: 230 })
    .setLatLng([lat, lon])
    .setContent(riskPopup(spot, level))
    .openOn(mapState.map);

  if (window.matchMedia('(max-width: 860px)').matches) {
    el.mapCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

el.riskCluster.addEventListener('change', () => {
  state.riskClusterTouched = true;
  const cluster = clusterById(el.riskCluster.value);
  if (cluster) el.riskOrder.value = String(cluster.defaultOrderId || 1);
  loadRisk(state.query);
});

el.riskScope.addEventListener('change', () => {
  state.riskScopeTouched = true;
  loadRisk(state.query);
});
el.riskOrder.addEventListener('change', () => loadRisk(state.query));

el.riskMapToggle.addEventListener('click', () => {
  mapState.showRisks = !mapState.showRisks;
  el.riskMapToggle.textContent = mapState.showRisks ? 'ซ่อนจุดเสี่ยงบนแผนที่' : 'แสดงจุดเสี่ยงบนแผนที่';
  const layerRisks = document.getElementById('layer-risks');
  if (layerRisks) layerRisks.checked = mapState.showRisks;
  renderRiskMarkers();
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
  scheduleMapRender();

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
/* Workspace UI (tabs, side panel, layers, table drawer, export menu) */
/* ================================================================== */

const ui = {
  tabs: Array.from(document.querySelectorAll('.tab')),
  panes: Array.from(document.querySelectorAll('.tab-pane')),
  panelToggle: $('panel-toggle'),
  tableToggle: $('table-toggle'),
  openTable: $('open-table'),
  exportMenu: $('export-menu'),
  exportToggle: $('export-toggle'),
  exportPop: $('export-pop'),
  mapSearch: $('map-search'),
  mapSearchBox: $('map-search-box'),
  mapSearchResults: $('map-search-results'),
  layerAccidents: $('layer-accidents'),
  layerRisks: $('layer-risks'),
  layerEvents: $('layer-events'),
  stage: $('stage'),
  stageBar: document.querySelector('.stage-bar'),
  splitter: $('splitter'),
  drawerGrip: $('drawer-grip'),
  tableExpand: $('table-expand'),
  fullscreenToggle: $('fullscreen-toggle'),
  modeInspect: $('mode-inspect'),
  modeArea: $('mode-area'),
};

/* ------------------------------- tabs -------------------------------- */

function activateTab(name, { focus = false } = {}) {
  for (const tab of ui.tabs) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }
  for (const pane of ui.panes) {
    pane.hidden = pane.dataset.pane !== name;
    pane.classList.toggle('is-active', pane.dataset.pane === name);
  }
  // ถ้าแผงถูกซ่อนอยู่ ให้เปิดกลับมาเมื่อผู้ใช้เลือกแท็บ
  if (el.appView.classList.contains('panel-collapsed')) setPanelCollapsed(false);
}

for (const tab of ui.tabs) {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    const index = ui.tabs.indexOf(tab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % ui.tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + ui.tabs.length) % ui.tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ui.tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    activateTab(ui.tabs[next].dataset.tab, { focus: true });
  });
}

/* ---------------------------- side panel ----------------------------- */

function setPanelCollapsed(collapsed) {
  el.appView.classList.toggle('panel-collapsed', collapsed);
  ui.panelToggle.textContent = collapsed ? 'แสดงแผง' : 'ซ่อนแผง';
  ui.panelToggle.setAttribute('aria-expanded', String(!collapsed));
}

ui.panelToggle.addEventListener('click', () => {
  setPanelCollapsed(!el.appView.classList.contains('panel-collapsed'));
});

/* ----------------------------- table drawer -------------------------- */

function setDrawer(open) {
  el.tableCard.dataset.open = String(open);
  ui.tableToggle.setAttribute('aria-expanded', String(open));
  ui.tableExpand.hidden = !open;
}

/** ขยายตารางให้เต็มพื้นที่แผนที่ (ทับแผนที่) หรือย่อกลับ */
function setDrawerFull(full) {
  el.tableCard.dataset.size = full ? 'full' : 'normal';
  ui.tableExpand.textContent = full ? 'ย่อตาราง' : 'ขยายเต็มพื้นที่';
  ui.tableExpand.setAttribute('aria-pressed', String(full));
}

ui.tableToggle.addEventListener('click', () => {
  setDrawer(el.tableCard.dataset.open !== 'true');
});

ui.openTable.addEventListener('click', () => setDrawer(true));

ui.tableExpand.addEventListener('click', () => {
  setDrawerFull(el.tableCard.dataset.size !== 'full');
});

/* ลากขอบบนของตารางเพื่อปรับความสูง */
function setDrawerHeight(px) {
  const stageHeight = ui.stage.getBoundingClientRect().height;
  const barHeight = ui.stageBar.getBoundingClientRect().height;
  const max = Math.max(180, stageHeight - barHeight - 48);
  const height = Math.min(max, Math.max(160, px));
  el.tableCard.style.setProperty('--drawer-h', `${Math.round(height)}px`);
}

ui.drawerGrip.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  ui.drawerGrip.setPointerCapture(event.pointerId);
  document.body.classList.add('is-resizing');
  setDrawerFull(false);

  const move = (moveEvent) => {
    const bottom = ui.stage.getBoundingClientRect().bottom;
    setDrawerHeight(bottom - moveEvent.clientY);
  };
  const stop = () => {
    ui.drawerGrip.removeEventListener('pointermove', move);
    ui.drawerGrip.removeEventListener('pointerup', stop);
    ui.drawerGrip.removeEventListener('pointercancel', stop);
    document.body.classList.remove('is-resizing');
  };
  ui.drawerGrip.addEventListener('pointermove', move);
  ui.drawerGrip.addEventListener('pointerup', stop);
  ui.drawerGrip.addEventListener('pointercancel', stop);
});

ui.drawerGrip.addEventListener('dblclick', () => setDrawerFull(true));

ui.drawerGrip.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const current = el.tableCard.getBoundingClientRect().height;
  setDrawerHeight(current + (event.key === 'ArrowUp' ? 32 : -32));
});

/* -------------------- ปรับความกว้างแผงด้านซ้าย (splitter) -------------------- */

const PANEL_WIDTH_KEY = 'itic-panel-width';
const PANEL_MIN = 300;

function panelMax() {
  return Math.max(PANEL_MIN + 40, Math.min(window.innerWidth - 360, Math.round(window.innerWidth * 0.75)));
}

function setPanelWidth(px, { persist = true } = {}) {
  const width = Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, px)));
  el.appView.style.setProperty('--panel-w', `${width}px`);
  ui.splitter.setAttribute('aria-valuenow', String(width));
  ui.splitter.setAttribute('aria-valuemax', String(panelMax()));
  if (persist) {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* ใช้งานต่อได้ แม้จดจำความกว้างไม่ได้ */
    }
  }
}

function resetPanelWidth() {
  el.appView.style.removeProperty('--panel-w');
  ui.splitter.removeAttribute('aria-valuenow');
  try {
    localStorage.removeItem(PANEL_WIDTH_KEY);
  } catch {
    /* ignore */
  }
}

ui.splitter.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  ui.splitter.setPointerCapture(event.pointerId);
  document.body.classList.add('is-resizing');
  if (el.appView.classList.contains('panel-collapsed')) setPanelCollapsed(false);

  const left = el.appView.getBoundingClientRect().left;
  const move = (moveEvent) => setPanelWidth(moveEvent.clientX - left);
  const stop = () => {
    ui.splitter.removeEventListener('pointermove', move);
    ui.splitter.removeEventListener('pointerup', stop);
    ui.splitter.removeEventListener('pointercancel', stop);
    document.body.classList.remove('is-resizing');
  };
  ui.splitter.addEventListener('pointermove', move);
  ui.splitter.addEventListener('pointerup', stop);
  ui.splitter.addEventListener('pointercancel', stop);
});

ui.splitter.addEventListener('dblclick', resetPanelWidth);

ui.splitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const current = document.getElementById('panel').getBoundingClientRect().width;
  setPanelWidth(current + (event.key === 'ArrowRight' ? 24 : -24));
});

try {
  const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  if (Number.isFinite(savedWidth) && savedWidth >= PANEL_MIN) setPanelWidth(savedWidth, { persist: false });
} catch {
  /* ไม่มีค่าที่บันทึกไว้ */
}

window.addEventListener('resize', () => {
  const current = Number.parseFloat(el.appView.style.getPropertyValue('--panel-w'));
  if (Number.isFinite(current) && current > panelMax()) setPanelWidth(current, { persist: false });
});

/* ------------------------- แผนที่เต็มจอ ------------------------- */

function setStageFullscreen(on) {
  ui.stage.classList.toggle('is-fullscreen', on);
  document.body.classList.toggle('stage-fs', on);
  ui.fullscreenToggle.textContent = on ? 'ออกจากเต็มจอ' : 'เต็มจอ';
  ui.fullscreenToggle.setAttribute('aria-pressed', String(on));

  // ขอโหมดเต็มจอของเบราว์เซอร์ด้วยถ้ามี (iOS ไม่รองรับ จึงใช้การขยายเต็มหน้าต่างแทน)
  const root = document.documentElement;
  if (on && !document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen().catch(() => {});
  } else if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  if (mapState.ready) setTimeout(() => mapState.map.invalidateSize(), 50);
}

ui.fullscreenToggle.addEventListener('click', () => {
  setStageFullscreen(!ui.stage.classList.contains('is-fullscreen'));
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && ui.stage.classList.contains('is-fullscreen')) setStageFullscreen(false);
});

/* ---------------------- โหมดคลิกบนแผนที่ ---------------------- */

ui.modeInspect.addEventListener('click', () => setMapMode('inspect'));
ui.modeArea.addEventListener('click', () => setMapMode('area'));

/* ----------------------------- export menu --------------------------- */

function setExportMenu(open) {
  ui.exportPop.hidden = !open;
  ui.exportToggle.setAttribute('aria-expanded', String(open));
}

ui.exportToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  setExportMenu(ui.exportPop.hidden);
});

ui.exportPop.addEventListener('click', () => setExportMenu(false));

/* --------------------------- map layer toggles ----------------------- */

function setLayerVisible(group, visible) {
  if (!mapState.ready || !group) return;
  const has = mapState.map.hasLayer(group);
  if (visible && !has) mapState.map.addLayer(group);
  if (!visible && has) mapState.map.removeLayer(group);
  raiseAccidents();
}

ui.layerAccidents.addEventListener('change', () => setLayerVisible(mapState.accidents, ui.layerAccidents.checked));
ui.layerEvents.addEventListener('change', () => setLayerVisible(mapState.events, ui.layerEvents.checked));
ui.layerRisks.addEventListener('change', () => {
  // ใช้สถานะเดียวกับปุ่มในแท็บจุดเสี่ยง
  if (mapState.showRisks !== ui.layerRisks.checked) el.riskMapToggle.click();
});

/* ------------------------ floating place search ---------------------- */

let mapSearchSeq = 0;

function hideMapSearchResults() {
  ui.mapSearchResults.hidden = true;
  ui.mapSearchResults.replaceChildren();
}

/** เลือกสถานที่จากช่องค้นหาบนแผนที่ → ใช้ตัวแปร/ช่องเดียวกับแท็บตัวกรอง แล้วค้นหาทันที */
function pickPlace(index) {
  el.placeResult.selectedIndex = index;
  applyPlace(index);
  hideMapSearchResults();
  requestSearch();
}

async function runMapSearch() {
  const query = ui.mapSearch.value.trim();
  if (query.length < 2) {
    setStatus('พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร', 'error');
    return;
  }

  const seq = ++mapSearchSeq;
  setStatus('กำลังค้นหาสถานที่…', 'busy');

  try {
    const payload = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (seq !== mapSearchSeq) return;

    const items = payload.data || [];
    if (items.length === 0) {
      hideMapSearchResults();
      setStatus('ไม่พบสถานที่ที่ค้นหา ลองระบุชื่อให้ชัดเจนขึ้น', 'error');
      return;
    }

    placeItems = items;
    el.placeQuery.value = query;
    el.placeResult.replaceChildren(
      ...items.map((item, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = item.displayName;
        return option;
      })
    );
    el.placeResultField.hidden = false;
    setStatus('');

    if (items.length === 1) {
      pickPlace(0);
      return;
    }

    ui.mapSearchResults.replaceChildren(
      ...items.map((item, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.displayName;
        button.addEventListener('click', () => pickPlace(index));
        li.appendChild(button);
        return li;
      })
    );
    ui.mapSearchResults.hidden = false;
  } catch (error) {
    if (seq === mapSearchSeq) setStatus(error.message, 'error');
  }
}

ui.mapSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runMapSearch();
  } else if (event.key === 'Escape') {
    hideMapSearchResults();
  }
});

document.addEventListener('click', (event) => {
  if (!ui.mapSearchBox.contains(event.target)) hideMapSearchResults();
  if (!ui.exportMenu.contains(event.target)) setExportMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menuOpen = !ui.exportPop.hidden || !ui.mapSearchResults.hidden;
  setExportMenu(false);
  hideMapSearchResults();
  // Esc ครั้งแรกปิดเมนูก่อน ครั้งถัดไปจึงออกจากเต็มจอ (กรณีไม่ได้ใช้ Fullscreen API)
  if (!menuOpen && ui.stage.classList.contains('is-fullscreen') && !document.fullscreenElement) {
    setStageFullscreen(false);
  }
});

/* ------------------- เลือกจังหวัด → แผนที่เลื่อนไปที่จังหวัด ------------------- */

let provinceFlySeq = 0;

el.province.addEventListener('change', async () => {
  const info = provinceByCode.get(String(el.province.value));
  if (!info || !mapState.ready) return;

  const seq = ++provinceFlySeq;
  const name = info.name.startsWith('กรุงเทพ') ? info.name : `จังหวัด${info.name}`;

  try {
    const payload = await api(`/api/geocode?q=${encodeURIComponent(name)}`);
    const first = (payload.data || [])[0];
    if (seq !== provinceFlySeq || !first) return;
    mapState.map.setView([first.lat, first.lon], 10, { animate: true });
  } catch {
    /* ไม่เลื่อนแผนที่ ถ้าหาพิกัดจังหวัดไม่ได้ */
  }
});

/* ------------- ตัวเลขบนแท็บ + เปิด/ปิดปุ่มส่งออกตามข้อมูลที่มี ------------- */

function setIfChanged(node, prop, value) {
  if (node[prop] !== value) node[prop] = value;
}

function refreshChrome() {
  const counts = {
    results: state.view.length,
    risk: state.risk && state.risk.rows ? state.risk.rows.length : 0,
    events: state.events.length,
  };

  for (const badge of document.querySelectorAll('.tab-count')) {
    const count = counts[badge.dataset.count] || 0;
    setIfChanged(badge, 'textContent', count ? fmtNum(count) : '');
    setIfChanged(badge, 'hidden', count === 0);
  }

  const hasRows = state.view.length > 0;
  setIfChanged(el.exportBtn, 'disabled', !hasRows);
  setIfChanged(el.exportDetailBtn, 'disabled', !hasRows);
  setIfChanged(el.eventsExport, 'disabled', state.events.length === 0);
  setIfChanged(ui.openTable, 'hidden', !hasRows);
}

let chromeFrame = 0;
new MutationObserver(() => {
  if (chromeFrame) return;
  chromeFrame = requestAnimationFrame(() => {
    chromeFrame = 0;
    refreshChrome();
  });
}).observe(el.appView, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });

refreshChrome();

/* ความสูงแถบด้านบนของแผนที่ (ใช้กำหนดขอบบนของตารางตอนขยายเต็ม) */
function syncBarHeight() {
  ui.stage.style.setProperty('--bar-h', `${ui.stageBar.offsetHeight}px`);
}
syncBarHeight();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncBarHeight).observe(ui.stageBar);

/* แผนที่ปรับขนาดเองเมื่อแผง/ลิ้นชักตาราง/หน้าต่างเปลี่ยนขนาด */
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (mapState.ready) mapState.map.invalidateSize();
  }).observe(el.map);
}

/* ================================================================== */
/* Info tips — ปุ่ม (i) อธิบายตัวเลข                                   */
/* ================================================================== */

const infoPop = document.createElement('div');
infoPop.id = 'info-pop';
infoPop.className = 'info-pop';
infoPop.setAttribute('role', 'tooltip');
infoPop.hidden = true;
document.body.appendChild(infoPop);

let infoOwner = null;
let infoPinned = false;

function hideInfo() {
  if (infoOwner) infoOwner.removeAttribute('aria-describedby');
  infoOwner = null;
  infoPinned = false;
  infoPop.hidden = true;
}

function showInfo(tip, pinned) {
  const text = tip.dataset.tip || '';
  if (!text) return;

  infoPop.replaceChildren();
  if (tip.dataset.tipTitle) {
    const title = document.createElement('strong');
    title.textContent = tip.dataset.tipTitle;
    infoPop.appendChild(title);
  }
  for (const line of text.split('\n').filter(Boolean)) {
    const p = document.createElement('p');
    p.textContent = line;
    infoPop.appendChild(p);
  }

  if (infoOwner && infoOwner !== tip) infoOwner.removeAttribute('aria-describedby');
  infoOwner = tip;
  infoPinned = pinned;
  tip.setAttribute('aria-describedby', 'info-pop');

  infoPop.hidden = false;
  infoPop.style.left = '0px';
  infoPop.style.top = '0px';

  const rect = tip.getBoundingClientRect();
  const width = infoPop.offsetWidth;
  const height = infoPop.offsetHeight;
  const margin = 8;

  const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - margin);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 8);

  infoPop.style.left = `${Math.round(Math.max(margin, left))}px`;
  infoPop.style.top = `${Math.round(top)}px`;
}

document.addEventListener('click', (event) => {
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip) {
    event.preventDefault(); // ไม่ให้ไปกระตุ้น <label>/แถวที่ครอบอยู่
    if (infoOwner === tip && infoPinned) hideInfo();
    else showInfo(tip, true);
    return;
  }
  if (!infoPop.hidden && !infoPop.contains(event.target)) hideInfo();
}, true);

document.addEventListener('mouseover', (event) => {
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip && !infoPinned) showInfo(tip, false);
});

document.addEventListener('mouseout', (event) => {
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip && !infoPinned && infoOwner === tip) hideInfo();
});

document.addEventListener('focusin', (event) => {
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip && !infoPinned) showInfo(tip, false);
});

document.addEventListener('focusout', (event) => {
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip && !infoPinned && infoOwner === tip) hideInfo();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideInfo();
    return;
  }
  const tip = event.target.closest && event.target.closest('.info-tip');
  if (tip && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    tip.click();
  }
});

window.addEventListener('scroll', hideInfo, true);
window.addEventListener('resize', hideInfo);

/* ================================================================== */
/* Boot                                                               */
/* ================================================================== */

(async function init() {
  applyTheme(document.documentElement.dataset.theme || 'light', { persist: false });
  setupDateControls();
  setDefaultDates();
  await loadProvinces();

  const authenticated = await checkSession();
  if (authenticated) {
    setStatus('พร้อมใช้งาน — กำหนดเงื่อนไขแล้วกดค้นหาข้อมูล');
  } else {
    el.loginUser.focus();
  }
})();
