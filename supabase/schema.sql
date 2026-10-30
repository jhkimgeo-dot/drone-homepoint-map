-- 내 장소(드론 홈포인트) 공용 DB 설정
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(이미 있는 것은 건너뜀).

-- 1) 장소 테이블
create table if not exists public.places (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 1 and 200),
  address    text not null default '',
  phone      text not null default '',
  memo       text not null default '' constraint places_memo_check check (char_length(memo) <= 2000),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  color      text not null constraint places_color_check check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 이름·같은 좌표는 한 번만 저장한다. 같은 CSV를 두 번 올려도 중복되지 않는다.
create unique index if not exists places_name_coord on public.places (name, lat, lng);

-- 2) 수정 시각 자동 기록
create or replace function public.places_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists places_touch_updated_at on public.places;
create trigger places_touch_updated_at
  before update on public.places
  for each row execute function public.places_touch_updated_at();

-- 3) 보안: 팀 계정으로 로그인한 사람만 읽고 쓸 수 있다. 로그인하지 않은 접속(anon)은 전부 막힌다.
alter table public.places enable row level security;

drop policy if exists "team can read" on public.places;
drop policy if exists "team can insert" on public.places;
drop policy if exists "team can update" on public.places;
drop policy if exists "team can delete" on public.places;

create policy "team can read"   on public.places for select to authenticated using (true);
create policy "team can insert" on public.places for insert to authenticated with check (true);
create policy "team can update" on public.places for update to authenticated using (true) with check (true);
create policy "team can delete" on public.places for delete to authenticated using (true);

revoke all on public.places from anon;
grant select, insert, update, delete on public.places to authenticated;

-- 4) 실시간 동기화: 이 테이블의 변경을 접속한 모든 휴대폰에 바로 보낸다.
do $$
begin
  alter publication supabase_realtime add table public.places;
exception
  when duplicate_object then null;
end;
$$;
