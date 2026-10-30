// 공용 저장소(Supabase) 연결. 예전 서버 API(/api/places …)가 하던 일을 브라우저에서 직접 한다.
// 데이터 보호는 DB의 행 수준 보안(RLS)이 맡는다. 로그인하지 않은 사람은 읽기·쓰기가 모두 막힌다.
import { CONFIG } from './config.js';

const COLUMNS = 'id,name,address,phone,memo,lat,lng,color';
const BATCH = 500;

// 좌표는 소수점 7자리(약 1cm)로 맞춰 저장해서 중복 판정이 부동소수 오차에 흔들리지 않게 한다.
const roundCoord = (n) => Math.round(n * 1e7) / 1e7;

export const isConfigured = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && CONFIG.teamEmail && CONFIG.adminEmail);

let client;
function db() {
  client ??= window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

function friendly(error) {
  const msg = String(error?.message ?? error ?? '');
  if (/invalid login credentials/i.test(msg)) return '비밀번호가 맞지 않습니다.';
  if (/jwt|not authorized/i.test(msg)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (/permission denied|row-level security|admin only/i.test(msg)) return '권한이 없습니다. 이 작업은 관리자만 할 수 있습니다.';
  if (/not restorable/i.test(msg)) return '이미 복구했거나 복구할 수 없는 기록입니다.';
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return '인터넷 연결을 확인해 주세요.';
  if (/places_color_check/.test(msg)) return '알 수 없는 색상입니다.';
  if (/places_memo_check/.test(msg)) return '메모가 너무 깁니다. (최대 2000자)';
  return `요청에 실패했습니다. (${msg})`;
}

function check({ data, error }) {
  if (error) throw new Error(friendly(error));
  return data;
}

// 네트워크 오류처럼 응답 자체가 없을 때도 같은 안내 문구로 바꾼다.
async function run(query) {
  try {
    return check(await query);
  } catch (err) {
    throw err instanceof Error && !/^TypeError/.test(err.name) ? err : new Error(friendly(err));
  }
}

// ── 로그인 ──────────────────────────────────────────────

export async function currentSession() {
  const { data } = await db().auth.getSession();
  return data.session;
}

// 관리자는 관리자 계정, 그 외에는 현장 공용 계정으로 들어간다.
export async function signIn(password, asAdmin = false) {
  await run(db().auth.signInWithPassword({ email: asAdmin ? CONFIG.adminEmail : CONFIG.teamEmail, password }));
}

// 로그인 토큰의 app_metadata.role 로 관리자 여부를 안다. 이 값은 사용자가 바꿀 수 없고, 실제 권한은 DB가 다시 검사한다.
export function roleOf(session) {
  return session?.user?.app_metadata?.role === 'admin' ? 'admin' : 'field';
}

export async function signOut() {
  await db().auth.signOut();
}

// 로그인이 풀리면(로그아웃, 토큰 만료) 알려 준다.
export function onSignedOut(callback) {
  db().auth.onAuthStateChange((event, session) => {
    if (!session) callback();
  });
}

// ── 장소 ────────────────────────────────────────────────

export const listPlaces = () => run(db().from('places').select(COLUMNS).order('id'));

// 같은 이름·같은 좌표는 한 번만 저장한다. 이미 있는 장소는 건너뛰고 duplicates로 센다.
export async function insertPlaces(places) {
  const seen = new Set();
  const rows = [];
  for (const p of places) {
    const row = {
      name: p.name,
      address: p.address ?? '',
      phone: p.phone ?? '',
      memo: (p.memo ?? '').slice(0, 2000),
      lat: roundCoord(p.lat),
      lng: roundCoord(p.lng),
      color: p.color,
    };
    const key = `${row.name}|${row.lat}|${row.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const inserted = await run(
      db()
        .from('places')
        .upsert(rows.slice(i, i + BATCH), { onConflict: 'name,lat,lng', ignoreDuplicates: true })
        .select('id'),
    );
    imported += inserted.length;
  }
  return { imported, duplicates: places.length - imported };
}

// fields에는 color, memo 중 바꿀 값만 들어온다. 장소가 없으면(다른 사람이 지웠으면) null.
export const updatePlace = (id, fields) =>
  run(db().from('places').update(fields).eq('id', id).select(COLUMNS).maybeSingle());

export async function deletePlace(id) {
  const deleted = await run(db().from('places').delete().eq('id', id).select('id'));
  return deleted.length > 0;
}

// ── 실시간 동기화 ───────────────────────────────────────

// 다른 사람이 추가·수정·삭제하면 바로 알려 준다. onStatus는 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'.
export async function subscribe({ onUpsert, onDelete, onStatus }) {
  // 저장된 로그인으로 바로 들어온 경우에도 실시간 연결이 로그인 권한(RLS)으로 붙도록 토큰을 먼저 넘긴다.
  const { data } = await db().auth.getSession();
  if (data.session && db().realtime?.setAuth) db().realtime.setAuth(data.session.access_token);
  const channel = db()
    .channel('places-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (payload) => {
      if (payload.eventType === 'DELETE') onDelete(payload.old?.id);
      else onUpsert(payload.new);
    })
    .subscribe((status) => onStatus(status));
  return () => db().removeChannel(channel);
}

// ── 변경 이력·복구 (관리자 전용) ──────────────────────────

// 최근 수정·삭제 기록. 등록(INSERT)은 CSV 한 번에 수백 건이 쌓여서 뺀다.
export const listHistory = (limit = 100) =>
  run(
    db()
      .from('places_history')
      .select('id,place_id,action,old_row,new_row,changed_by,changed_role,changed_at,restored_at')
      .in('action', ['UPDATE', 'DELETE'])
      .order('id', { ascending: false })
      .limit(limit),
  );

export const restorePlace = (historyId) => run(db().rpc('restore_place', { history_id: historyId }));
