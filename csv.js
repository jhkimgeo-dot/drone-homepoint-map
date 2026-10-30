import { DEFAULT_COLOR, normalizeColor } from './palette.js';

// 엑셀에서 저장한 한글 CSV는 EUC-KR(CP949)인 경우가 많아서, UTF-8로 읽히지 않으면 EUC-KR로 다시 읽는다.
export function decodeCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

// RFC 4180 CSV 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리하고, 레코드가 시작된 줄 번호를 함께 돌려준다.
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    recordLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      endRecord();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return records;
}

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  return firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
}

// 정규화한 머리글 → 필드. 정규화는 괄호 안 설명을 떼고("주소(팜맵 필지 기준)" → "주소") 소문자로 바꾼 뒤 공백·밑줄을 지운다.
const HEADER_ALIASES = {
  name: ['이름', '장소', '장소명', '장소이름', '상호', '상호명', '업체명', '가게명', '명칭', 'name', 'place', 'placename', 'title'],
  address: ['주소', '도로명주소', '지번주소', '소재지', '위치', 'address', 'addr', 'roadaddress'],
  phone: ['전화', '전화번호', '연락처', 'phone', 'tel', 'telephone'],
  lat: ['위도', 'lat', 'latitude', 'y', 'y좌표', '좌표y'],
  lng: ['경도', 'lng', 'lon', 'long', 'longitude', 'x', 'x좌표', '좌표x'],
  color: ['색상', '색', '컬러', 'color', 'colour'],
  memo: ['메모', '설명', '비고', '노트', 'memo', 'note', 'notes', 'description'],
};

const REQUIRED = { name: '이름', lat: '위도', lng: '경도' };

const normalizeHeader = (h) =>
  h
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, '');

// 홈포인트 코드(예: A_TA_GH_16)는 맨 뒤 번호와 그 앞 영문(GH_16)만 이름으로 쓴다.
// 영문·숫자를 _ 나 - 로 이은 코드에만 적용하고, 한글 이름 같은 일반 이름은 그대로 둔다.
export function pointName(raw) {
  if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/.test(raw)) return raw;
  return raw.match(/[A-Za-z]+[_-]?\d+$/)?.[0] ?? raw;
}

export function detectColumns(header) {
  const columns = {};
  header.forEach((raw, index) => {
    const h = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (columns[field] === undefined && aliases.includes(h)) {
        columns[field] = index;
        break;
      }
    }
  });
  return columns;
}

export class CsvFormatError extends Error {}

function parseCoord(value) {
  const v = String(value ?? '').trim();
  if (v === '') return NaN;
  return Number(v);
}

// CSV 바이트를 저장할 장소 목록으로 바꾼다. 잘못된 행은 errors에 줄 번호와 이유를 남기고 건너뛴다.
export function readPlaces(buffer, { defaultColor = DEFAULT_COLOR } = {}) {
  const records = parseCsv(decodeCsv(buffer));
  if (records.length === 0) throw new CsvFormatError('CSV 파일이 비어 있습니다.');

  const [headerRecord, ...rows] = records;
  const columns = detectColumns(headerRecord.cells);
  const missing = Object.keys(REQUIRED).filter((f) => columns[f] === undefined);
  if (missing.length > 0) {
    throw new CsvFormatError(
      `필수 열(${missing.map((f) => REQUIRED[f]).join(', ')})을 찾지 못했습니다. ` +
        `현재 머리글: ${headerRecord.cells.map((c) => c.trim()).join(', ')}`,
    );
  }

  const places = [];
  const errors = [];
  for (const { line, cells } of rows) {
    const get = (field) => (columns[field] === undefined ? '' : (cells[columns[field]] ?? '').trim());
    const name = pointName(get('name'));
    let lat = parseCoord(get('lat'));
    let lng = parseCoord(get('lng'));

    if (!name) {
      errors.push({ line, reason: '이름이 비어 있습니다.' });
      continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push({ line, reason: `좌표가 숫자가 아닙니다. (위도: "${get('lat')}", 경도: "${get('lng')}")` });
      continue;
    }
    // 위도·경도 열이 뒤바뀐 파일이 흔해서, 위도가 90을 넘고 경도가 90 이하이면 바꿔서 읽는다.
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      errors.push({ line, reason: `좌표 범위를 벗어났습니다. (위도: ${lat}, 경도: ${lng})` });
      continue;
    }

    places.push({
      line,
      name,
      address: get('address'),
      phone: get('phone'),
      memo: get('memo'),
      lat,
      lng,
      color: normalizeColor(get('color')) ?? defaultColor,
    });
  }

  return { columns: Object.keys(columns), places, errors };
}

const EXPORT_COLUMNS = [
  ['이름', 'name'],
  ['주소', 'address'],
  ['전화번호', 'phone'],
  ['위도', 'lat'],
  ['경도', 'lng'],
  ['색상', 'color'],
  ['메모', 'memo'],
];

function escapeCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 다시 가져올 수 있는 형식으로 내보낸다. 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다.
export function toCsv(places) {
  const lines = [EXPORT_COLUMNS.map(([label]) => label).join(',')];
  for (const p of places) lines.push(EXPORT_COLUMNS.map(([, key]) => escapeCell(p[key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
