// 서버(CSV 가져오기)와 브라우저(색상 선택)가 함께 쓰는 색상표.
export const PALETTE = [
  { hex: '#e5484d', label: '빨강', aliases: ['빨강', '빨간', '빨간색', '레드', 'red'] },
  { hex: '#f76b15', label: '주황', aliases: ['주황', '주황색', '오렌지', 'orange'] },
  { hex: '#e2a400', label: '노랑', aliases: ['노랑', '노란', '노란색', '옐로우', 'yellow'] },
  { hex: '#7cb518', label: '연두', aliases: ['연두', '연두색', 'lime'] },
  { hex: '#30a46c', label: '초록', aliases: ['초록', '초록색', '녹색', '그린', 'green'] },
  { hex: '#0ea5e9', label: '하늘', aliases: ['하늘', '하늘색', 'sky', 'skyblue'] },
  { hex: '#3e63dd', label: '파랑', aliases: ['파랑', '파란', '파란색', '블루', 'blue'] },
  { hex: '#8e4ec6', label: '보라', aliases: ['보라', '보라색', '퍼플', 'purple'] },
  { hex: '#e93d82', label: '분홍', aliases: ['분홍', '분홍색', '핑크', 'pink'] },
  { hex: '#6f6f6f', label: '회색', aliases: ['회색', '그레이', 'gray', 'grey'] },
];

export const DEFAULT_COLOR = PALETTE[0].hex;

// "#abc", "#AABBCC", "파랑", "blue" 같은 값을 "#rrggbb"로 바꾼다. 알 수 없으면 null.
export function normalizeColor(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  const hex = v.startsWith('#') ? v.slice(1) : v;
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (v.startsWith('#') && /^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join('')}`;
  const found = PALETTE.find((p) => p.aliases.includes(v));
  return found ? found.hex : null;
}

export function colorLabel(hex) {
  return PALETTE.find((p) => p.hex === hex)?.label ?? hex;
}
