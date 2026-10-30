import { CONFIG } from './config.js';
import { CsvFormatError, readPlaces, toCsv } from './csv.js';
import { DEFAULT_COLOR, PALETTE, colorLabel, normalizeColor } from './palette.js';
import { initKakaoSdk, isMobile, kakaoMapViewUrl, openKakaoMapRoute, startKakaoNavi } from './kakao.js';
import * as store from './store.js';

const MAX_CSV_BYTES = 10 * 1024 * 1024;

const state = {
  places: [],
  selectedId: null,
  filterColor: null,
  query: '',
  naviEnabled: false,
  importFile: null,
  importColor: DEFAULT_COLOR,
  importResult: null,
  importing: false,
  signedIn: false,
};

const $ = (selector) => document.querySelector(selector);

// 작은 DOM 생성 도우미. 문자열은 모두 텍스트로 들어가므로 CSV에서 온 값이 HTML로 해석되지 않는다.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false && c !== ''));
  return el;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ── 지도 ────────────────────────────────────────────────

const map = L.map('map').setView([36.4, 127.9], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const markers = new Map();

// 멀리서 보면 메모 글씨가 서로 겹치므로, 이 배율보다 작을 때는 선택한 장소의 메모만 보여 준다.
const MEMO_LABEL_MIN_ZOOM = 12;
const syncMemoLabels = () => map.getContainer().classList.toggle('hide-memo', map.getZoom() < MEMO_LABEL_MIN_ZOOM);
map.on('zoomend', syncMemoLabels);
syncMemoLabels();

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 메모가 있는 장소는 핀 바로 위에 말풍선 모양으로 메모 내용을 띄운다.
function pinIcon(color, selected, memo) {
  const w = selected ? 34 : 26;
  const hgt = Math.round((w * 4) / 3);
  const memoLabel = memo
    ? `<span class="memo-label"><svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="${color}"/></svg>
        <span class="memo-text">${escapeHtml(memo)}</span></span>`
    : '';
  return L.divIcon({
    className: selected ? 'pin selected' : 'pin',
    html: `<svg class="pin-shape" viewBox="0 0 24 32" width="${w}" height="${hgt}" aria-hidden="true">
      <path d="M12 1C5.9 1 1 5.8 1 11.8 1 20 12 31 12 31s11-11 11-19.2C23 5.8 18.1 1 12 1z" fill="${color}" stroke="#fff" stroke-width="1.6"/>
      <circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg>${memoLabel}`,
    iconSize: [w, hgt],
    iconAnchor: [w / 2, hgt],
  });
}

// 핀 모양이 바뀌었을 때만 아이콘을 다시 만든다(다른 사람이 수정할 때마다 전체 핀을 다시 그리지 않도록).
function renderMarkers(visible) {
  const visibleIds = new Set(visible.map((p) => p.id));
  for (const [id, entry] of markers) {
    if (!visibleIds.has(id)) {
      entry.marker.remove();
      markers.delete(id);
    }
  }
  for (const p of visible) {
    const selected = p.id === state.selectedId;
    const memo = p.memo.trim();
    const key = `${p.color}|${selected}|${memo}`;
    let entry = markers.get(p.id);
    if (!entry) {
      const marker = L.marker([p.lat, p.lng], { title: p.name, keyboard: true })
        .on('click', () => select(p.id))
        .addTo(map);
      entry = { marker, key: null };
      markers.set(p.id, entry);
    }
    if (entry.key !== key) {
      entry.marker.setIcon(pinIcon(p.color, selected, memo));
      entry.marker.setZIndexOffset(selected ? 1000 : 0);
      entry.key = key;
    }
  }
}

function fitToPlaces(places) {
  if (places.length === 0) return;
  map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
}

// ── 화면 그리기 ───────────────────────────────────────────

function visiblePlaces() {
  const q = state.query.trim().toLowerCase();
  return state.places.filter(
    (p) =>
      (!state.filterColor || p.color === state.filterColor) &&
      (!q || [p.name, p.address, p.phone, p.memo].some((v) => v.toLowerCase().includes(q))),
  );
}

function swatch(hex, label, checked, onclick) {
  return h('button', {
    type: 'button',
    class: 'swatch',
    role: 'radio',
    style: `--c:${hex}`,
    title: label,
    'aria-label': label,
    'aria-checked': String(checked),
    onclick,
  });
}

// 색상표 + (색상표에 없는 색을 쓰는 장소라면) 그 색까지 보여 준다.
function swatchRow(current, onPick) {
  const colors = PALETTE.map((c) => c.hex);
  if (!colors.includes(current)) colors.unshift(current);
  return h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': '색상' },
    colors.map((hex) => swatch(hex, colorLabel(hex), hex === current, () => onPick(hex))),
  );
}

function renderFilters() {
  const counts = new Map();
  for (const p of state.places) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  // 다른 사람이 마지막 장소의 색을 바꿔서 고른 색이 사라지면 필터를 푼다.
  if (state.filterColor && !counts.has(state.filterColor)) state.filterColor = null;
  const order = PALETTE.map((c) => c.hex);
  const colors = [...counts.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const chip = (color, label, count) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(state.filterColor === color),
        onclick: () => {
          state.filterColor = state.filterColor === color || color === null ? null : color;
          render();
        },
      },
      color && h('span', { class: 'dot', style: `--c:${color}` }),
      label,
      h('span', { class: 'count' }, String(count)),
    );

  $('#color-filters').replaceChildren(
    ...(state.places.length === 0
      ? []
      : [chip(null, '전체', state.places.length), ...colors.map((c) => chip(c, colorLabel(c), counts.get(c)))]),
  );
}

function renderList(visible) {
  const total = state.places.length;
  $('#empty').hidden = total > 0;
  $('#list-summary').textContent =
    total === 0 ? ''
    : visible.length === total ? `장소 ${total}개`
    : visible.length === 0 ? '조건에 맞는 장소가 없습니다.'
    : `${visible.length}개 / 전체 ${total}개`;

  $('#place-list').replaceChildren(
    ...visible.map((p) =>
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', 'aria-current': String(p.id === state.selectedId), onclick: () => select(p.id, { pan: true }) },
          h('span', { class: 'dot', style: `--c:${p.color}` }),
          h('span', { class: 'text' }, h('span', { class: 'name' }, p.name), h('span', { class: 'addr' }, p.address)),
        ),
      ),
    ),
  );
}

function naviButton(place) {
  if (!state.naviEnabled) {
    return h('button', { type: 'button', class: 'btn', disabled: true, title: 'config.js에 kakaoJsKey를 설정하면 쓸 수 있습니다.' }, '카카오내비');
  }
  if (!isMobile()) {
    return h('button', { type: 'button', class: 'btn', disabled: true, title: '카카오내비는 휴대폰에서만 열립니다.' }, '카카오내비');
  }
  return h(
    'button',
    { type: 'button', class: 'btn', onclick: () => startKakaoNavi(place).catch((err) => toast(err.message)) },
    '카카오내비',
  );
}

function renderDetail() {
  const box = $('#detail');
  const p = state.places.find((x) => x.id === state.selectedId);
  box.hidden = !p;
  if (!p) {
    box.replaceChildren();
    return;
  }

  // 메모를 쓰는 도중에 다른 사람의 변경으로 화면이 다시 그려져도 쓰던 글자와 커서를 지킨다.
  const editing = document.activeElement?.dataset?.memoFor === String(p.id) ? document.activeElement : null;
  const memo = h(
    'textarea',
    { rows: 2, placeholder: '메모를 남겨 두세요', 'data-memo-for': p.id, onchange: (e) => saveMemo(p.id, e.target.value) },
    editing ? editing.value : p.memo,
  );

  box.replaceChildren(
    h(
      'div',
      { class: 'detail-head' },
      h('span', { class: 'dot', style: `--c:${p.color}` }),
      h('h2', {}, p.name),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => select(null) }, '×'),
    ),
    (p.address || p.phone) &&
      h('div', { class: 'meta' }, p.address && h('span', {}, p.address), p.phone && h('a', { href: `tel:${p.phone}` }, p.phone)),
    swatchRow(p.color, (hex) => changeColor(p.id, hex)),
    h(
      'div',
      { class: 'route-actions' },
      h('button', { type: 'button', class: 'btn primary wide', onclick: () => openKakaoMapRoute(p) }, '카카오맵 길찾기'),
      naviButton(p),
      h('a', { class: 'btn', href: kakaoMapViewUrl(p), target: '_blank', rel: 'noopener' }, '카카오맵에서 보기'),
    ),
    !state.naviEnabled && h('p', { class: 'hint' }, '카카오내비 바로 연결은 카카오 앱 키가 있어야 켜집니다. 휴대폰에서 "카카오맵 길찾기"를 누르면 카카오맵 앱의 자동차 길찾기가 열립니다.'),
    h('label', { class: 'memo' }, '메모', memo),
    h('button', { type: 'button', class: 'link danger', onclick: () => removePlace(p) }, '이 장소 삭제'),
  );

  if (editing) {
    memo.focus({ preventScroll: true });
    memo.setSelectionRange(editing.selectionStart, editing.selectionEnd);
  }
}

function renderImport() {
  const box = $('#import-panel');
  const file = state.importFile;
  box.hidden = !file;
  if (!file) {
    box.replaceChildren();
    return;
  }

  const close = () => {
    state.importFile = null;
    state.importResult = null;
    renderImport();
  };
  const result = state.importResult;

  box.replaceChildren(
    h(
      'div',
      { class: 'import-head' },
      h('h2', {}, 'CSV 가져오기'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: close }, '×'),
    ),
    h('p', { class: 'file-name' }, file.name),
    ...(result
      ? [
          h('p', { class: 'result-line' }, `저장 ${result.imported}개 · 중복 ${result.duplicates}개 · 오류 ${result.errors.length}개`),
          result.errors.length > 0 &&
            h(
              'ul',
              { class: 'errors' },
              result.errors.slice(0, 50).map((e) => h('li', {}, `${e.line}행: ${e.reason}`)),
              result.errors.length > 50 && h('li', {}, `외 ${result.errors.length - 50}건`),
            ),
          h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn', onclick: close }, '닫기')),
        ]
      : [
          h('p', { class: 'hint' }, 'CSV에 색상 열이 없거나 비어 있는 장소는 이 색으로 저장합니다.'),
          swatchRow(state.importColor, (hex) => {
            state.importColor = hex;
            renderImport();
          }),
          h(
            'div',
            { class: 'button-row' },
            h('button', { type: 'button', class: 'btn primary', disabled: state.importing, onclick: runImport }, state.importing ? '가져오는 중…' : '가져오기'),
            h('button', { type: 'button', class: 'btn', disabled: state.importing, onclick: close }, '취소'),
          ),
        ]),
  );
}

function render() {
  const visible = visiblePlaces();
  renderFilters();
  renderList(visible);
  renderMarkers(visible);
  renderDetail();
}

// 다른 사람이 CSV를 한꺼번에 올리면 변경 알림이 수백 개 연달아 오므로, 한 화면 갱신으로 묶는다.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ── 동작 ────────────────────────────────────────────────

function select(id, { pan = false } = {}) {
  state.selectedId = id;
  render();
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  if (pan) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// DB에서 온 행을 화면용 장소로 맞춘다(빈 값은 빈 문자열, 좌표는 숫자).
function toPlace(row) {
  return {
    id: Number(row.id),
    name: row.name ?? '',
    address: row.address ?? '',
    phone: row.phone ?? '',
    memo: row.memo ?? '',
    lat: Number(row.lat),
    lng: Number(row.lng),
    color: row.color ?? DEFAULT_COLOR,
  };
}

// 추가·수정을 한 함수로 처리한다. 목록은 항상 id 순(= CSV 순)으로 유지한다.
function upsertLocal(row) {
  const place = toPlace(row);
  const i = state.places.findIndex((p) => p.id === place.id);
  if (i >= 0) state.places[i] = place;
  else {
    state.places.push(place);
    state.places.sort((a, b) => a.id - b.id);
  }
}

function removeLocal(id) {
  state.places = state.places.filter((p) => p.id !== id);
}

async function reloadPlaces() {
  state.places = (await store.listPlaces()).map(toPlace);
}

async function changeColor(id, color) {
  const before = state.places.find((p) => p.id === id);
  if (!before || before.color === color) return;
  upsertLocal({ ...before, color });
  render();
  try {
    const updated = await store.updatePlace(id, { color: normalizeColor(color) });
    if (!updated) throw new Error('장소를 찾을 수 없습니다. 다른 사람이 삭제했을 수 있습니다.');
    upsertLocal(updated);
  } catch (err) {
    if (state.places.some((p) => p.id === id)) upsertLocal(before);
    toast(err.message);
  }
  render();
}

async function saveMemo(id, memo) {
  try {
    const updated = await store.updatePlace(id, { memo: memo.slice(0, 2000) });
    if (!updated) throw new Error('장소를 찾을 수 없습니다. 다른 사람이 삭제했을 수 있습니다.');
    upsertLocal(updated);
    render();
    toast('메모를 저장했습니다.');
  } catch (err) {
    toast(err.message);
  }
}

async function removePlace(place) {
  if (!confirm(`"${place.name}"을(를) 삭제할까요?`)) return;
  try {
    await store.deletePlace(place.id);
    removeLocal(place.id);
    state.selectedId = null;
    render();
    toast('삭제했습니다.');
  } catch (err) {
    toast(err.message);
  }
}

function startImport(file) {
  state.importFile = file;
  state.importResult = null;
  renderImport();
  $('.panel').scrollTo({ top: 0, behavior: 'smooth' });
}

// CSV는 브라우저에서 읽고(인코딩 판별·열 인식·검증), 통과한 행만 공용 DB에 넣는다.
async function runImport() {
  state.importing = true;
  renderImport();
  try {
    if (state.importFile.size > MAX_CSV_BYTES) throw new Error('CSV 파일이 너무 큽니다. (최대 10MB)');
    const bytes = new Uint8Array(await state.importFile.arrayBuffer());
    if (bytes.length === 0) throw new Error('CSV 파일 내용이 없습니다.');
    const parsed = readPlaces(bytes, { defaultColor: state.importColor });
    const { imported, duplicates } = await store.insertPlaces(parsed.places);
    state.importResult = { imported, duplicates, errors: parsed.errors, total: parsed.places.length + parsed.errors.length };

    const wasEmpty = state.places.length === 0;
    await reloadPlaces();
    render();
    if (wasEmpty || imported > 0) fitToPlaces(visiblePlaces());
  } catch (err) {
    toast(err instanceof CsvFormatError || err instanceof Error ? err.message : String(err));
  } finally {
    state.importing = false;
    renderImport();
  }
}

// 저장된 장소를 다시 가져올 수 있는 CSV로 내려받는다.
function exportCsv() {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([toCsv(state.places)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `places-${date}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#csv-input').addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (file) startImport(file);
  e.target.value = '';
});

$('#export').addEventListener('click', exportCsv);

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectedId !== null && !e.target.closest('input, textarea')) select(null);
});

// 화면 어디든 CSV를 끌어다 놓으면 가져오기를 시작한다.
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || !state.signedIn) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const [file] = e.dataTransfer.files;
  if (file && state.signedIn) startImport(file);
});

// ── 실시간 동기화 ───────────────────────────────────────

const SYNC_TEXT = { live: '실시간', connecting: '연결 중', offline: '연결 끊김', off: '' };
function setSync(mode) {
  const el = $('#sync');
  el.dataset.state = mode;
  el.textContent = SYNC_TEXT[mode];
  el.title = mode === 'live' ? '다른 사람의 변경이 바로 반영됩니다.' : mode === 'offline' ? '다시 연결되면 최신 내용으로 맞춥니다.' : '';
}

let unsubscribe = null;
async function startSync() {
  setSync('connecting');
  const stop = await store.subscribe({
    onUpsert: (row) => {
      upsertLocal(row);
      scheduleRender();
    },
    onDelete: (id) => {
      if (id == null) return;
      const wasSelected = state.selectedId === Number(id);
      removeLocal(Number(id));
      if (wasSelected) {
        state.selectedId = null;
        toast('보고 있던 장소를 다른 사람이 삭제했습니다.');
      }
      scheduleRender();
    },
    onStatus: (status) => {
      if (status === 'SUBSCRIBED') {
        setSync('live');
        // 연결이 끊긴 동안 놓친 변경이 있을 수 있으니 목록을 새로 받는다.
        reloadPlaces().then(scheduleRender).catch((err) => toast(err.message));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setSync('offline');
      }
    },
  });
  // 연결을 준비하는 사이에 로그아웃했다면 바로 끊는다.
  if (state.signedIn) unsubscribe = stop;
  else stop();
}

function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  setSync('off');
}

// 휴대폰은 화면이 꺼지면 연결이 멈추므로, 다시 볼 때 목록을 새로 받는다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.signedIn) {
    reloadPlaces().then(scheduleRender).catch(() => {});
  }
});

// ── 로그인 ──────────────────────────────────────────────

function showGate(which) {
  $('#gate').hidden = false;
  $('#login-form').hidden = which !== 'login';
  $('#setup-needed').hidden = which !== 'setup';
  if (which === 'login') setTimeout(() => $('#login-password').focus(), 0);
}

function hideGate() {
  $('#gate').hidden = true;
  $('#login-error').hidden = true;
  $('#login-password').value = '';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#login-submit');
  const error = $('#login-error');
  button.disabled = true;
  button.textContent = '확인 중…';
  error.hidden = true;
  try {
    await store.signIn($('#login-password').value);
    await enter();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = '들어가기';
  }
});

$('#logout').addEventListener('click', async () => {
  leave();
  await store.signOut().catch(() => {});
});

async function enter() {
  if (state.signedIn) return;
  await reloadPlaces();
  state.signedIn = true;
  hideGate();
  render();
  fitToPlaces(state.places);
  startSync().catch((err) => {
    console.warn(err);
    setSync('offline');
  });
}

function leave() {
  if (!state.signedIn && !$('#gate').hidden) return;
  state.signedIn = false;
  stopSync();
  state.places = [];
  state.selectedId = null;
  state.importFile = null;
  render();
  renderImport();
  showGate('login');
}

// ── 시작 ────────────────────────────────────────────────

async function boot() {
  if (CONFIG.kakaoJsKey) {
    state.naviEnabled = true;
    initKakaoSdk(CONFIG.kakaoJsKey).catch((err) => {
      console.warn(err);
      state.naviEnabled = false;
      render();
    });
  }
  render();

  if (!store.isConfigured()) {
    showGate('setup');
    return;
  }
  store.onSignedOut(() => {
    if (state.signedIn) {
      leave();
      toast('로그인이 풀렸습니다. 비밀번호를 다시 입력해 주세요.');
    }
  });
  if (await store.currentSession()) {
    try {
      await enter();
      return;
    } catch (err) {
      toast(err.message);
    }
  }
  showGate('login');
}

boot().catch((err) => toast(err.message));
