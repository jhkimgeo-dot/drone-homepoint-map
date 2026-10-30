-- 보안 보완 2단계: 관리자/현장 권한 분리 + 변경·삭제 이력 + 삭제 복구
-- schema.sql을 먼저 실행한 뒤, Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 권한
--   관리자(app_metadata.role = 'admin'): 보기, 장소 등록(CSV), 색상·메모 수정, 삭제, 이력 보기, 삭제 복구
--   현장(그 외 로그인 계정):             보기, 색상·메모 수정만. 등록·삭제는 DB가 거부한다.

-- 1) 관리자 판별: 로그인 토큰의 app_metadata(사용자가 스스로 바꿀 수 없는 영역)에 role=admin 이 있는지 본다.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- 2) 장소 테이블 권한 재설정
drop policy if exists "team can insert" on public.places;
drop policy if exists "team can delete" on public.places;
drop policy if exists "admin can insert" on public.places;
drop policy if exists "admin can delete" on public.places;

create policy "admin can insert" on public.places for insert to authenticated with check (public.is_admin());
create policy "admin can delete" on public.places for delete to authenticated using (public.is_admin());
-- "team can read", "team can update" 정책은 그대로 둔다(수정 가능한 열은 아래에서 색상·메모로 제한).

revoke all on public.places from anon;
revoke update on public.places from authenticated;
grant select, insert, delete on public.places to authenticated;
grant update (color, memo) on public.places to authenticated;

-- 3) 변경·삭제 이력
create table if not exists public.places_history (
  id           bigint generated always as identity primary key,
  place_id     bigint not null,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row      jsonb,
  new_row      jsonb,
  changed_by   text not null default '',
  changed_role text not null default '',
  changed_at   timestamptz not null default now(),
  restored_at  timestamptz
);

create index if not exists places_history_changed_at on public.places_history (changed_at desc);

alter table public.places_history enable row level security;
drop policy if exists "admin can read history" on public.places_history;
create policy "admin can read history" on public.places_history for select to authenticated using (public.is_admin());

revoke all on public.places_history from anon, authenticated;
grant select on public.places_history to authenticated;

create or replace function public.places_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
begin
  insert into public.places_history (place_id, action, old_row, new_row, changed_by, changed_role)
  values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    coalesce(claims ->> 'email', ''),
    coalesce(claims -> 'app_metadata' ->> 'role', 'field')
  );
  return null;
end;
$$;

drop trigger if exists places_audit on public.places;
create trigger places_audit
  after insert or update or delete on public.places
  for each row execute function public.places_audit();

-- 4) 삭제 복구(관리자 전용): 삭제 이력의 원래 값으로 같은 번호(id)에 다시 넣는다.
create or replace function public.restore_place(history_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.places_history;
  restored_id bigint;
begin
  if not public.is_admin() then
    raise exception 'permission denied: admin only' using errcode = '42501';
  end if;

  select * into h from public.places_history where id = history_id and action = 'DELETE' and restored_at is null;
  if not found then
    raise exception 'not restorable' using errcode = 'P0002';
  end if;

  insert into public.places (id, name, address, phone, memo, lat, lng, color)
  overriding system value
  values (
    (h.old_row ->> 'id')::bigint,
    h.old_row ->> 'name',
    coalesce(h.old_row ->> 'address', ''),
    coalesce(h.old_row ->> 'phone', ''),
    coalesce(h.old_row ->> 'memo', ''),
    (h.old_row ->> 'lat')::double precision,
    (h.old_row ->> 'lng')::double precision,
    h.old_row ->> 'color'
  )
  on conflict do nothing
  returning id into restored_id;

  update public.places_history set restored_at = now() where id = history_id;
  return restored_id;
end;
$$;

revoke all on function public.restore_place(bigint) from public, anon;
grant execute on function public.restore_place(bigint) to authenticated;
