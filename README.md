# 내 장소 — 드론 홈포인트 지도 (웹 버전)

월동채소 드론 현장팀이 이륙(홈)포인트를 지도에서 함께 보고, 카카오맵·카카오내비로 바로 길안내를 받는 사이트입니다.
여러 사람이 각자 휴대폰(LTE·와이파이, 서로 다른 인터넷)으로 같은 주소에 접속해 **같은 장소 목록을 실시간으로 공유**합니다. 한 사람이 색상·메모를 바꾸거나 CSV를 올리면 다른 사람 화면에 바로 반영됩니다.

- 화면: GitHub Pages (무료, 서버 불필요) — `https://jhkimgeo-dot.github.io/drone-homepoint-map/`
- 데이터: Supabase (무료 플랜 PostgreSQL + 실시간 동기화 + 로그인)
- 접속 제한: 비밀번호 2개 — **현장용**(외부 인력 포함: 보기, 길안내, 색상·메모 수정만)과 **관리자용**(CSV 등록, 내보내기, 삭제, 변경 이력, 삭제 복구). 로그인하지 않으면 데이터를 읽을 수도 고칠 수도 없습니다.
- 권한은 화면 버튼을 숨기는 것이 아니라 **DB가 직접 검사**합니다. 현장 계정이 개발자 도구로 삭제·등록을 시도해도 거부됩니다.
- 모든 수정·삭제는 이력에 남고, 지워진 장소는 관리자가 되살릴 수 있습니다.

> 사무실 맥에서 돌리던 서버 버전(Express + SQLite)을 서버 없이 동작하도록 옮긴 것입니다. CSV 읽기 규칙, 색상, 메모, 길안내 동작은 그대로입니다.

## 사용 흐름

1. 사이트 주소 접속 → 비밀번호 입력(현장 인력은 현장용, 관리자는 "관리자로 들어가기" 체크 후 관리자용. 한 번 들어오면 그 기기에서는 로그인 유지)
2. (관리자) CSV 가져오기: 상단 "CSV 가져오기" 또는 화면에 파일 끌어다 놓기 → 색상 열이 없는 장소에 칠할 색 선택 → 가져오기
3. 목록이나 핀을 누르면 상세 정보, 색상 변경·메모 입력(바로 저장, 모두에게 반영). 장소 삭제는 관리자만 가능
4. "카카오맵 길찾기" → 휴대폰은 카카오맵 앱 자동차 길찾기, 앱이 없으면 웹 길찾기
5. 상단 "실시간" 초록 점: 다른 사람의 변경이 바로 들어오는 상태. "연결 끊김"이면 다시 연결될 때 최신 내용으로 맞춥니다.

## 처음 설정 (한 번만)

### 1) Supabase 프로젝트 만들기
1. https://supabase.com 가입(구글·깃허브 계정 가능) → **New project**
   - 이름: 아무거나(예: `drone-homepoint`), Region: **Northeast Asia (Seoul)**, DB 비밀번호는 아무거나(사이트에서 쓰지 않음)
2. 왼쪽 **SQL Editor** → New query → 이 저장소의 `supabase/schema.sql` 내용을 전부 붙여 넣고 **Run**
   - 테이블, 중복 방지, 보안(로그인한 사람만), 실시간 동기화가 한 번에 설정됩니다.

### 2) 계정 2개 만들기 (현장용 / 관리자용)
1. 왼쪽 **Authentication → Users → Add user → Create new user** 를 두 번 합니다.
   - 현장용: Email `fieldteam@example.com`(실제 메일 수신 불필요), Password = 현장 공용 비밀번호
   - 관리자용: Email `fieldteam-admin@example.com`, Password = 관리자 비밀번호(현장용과 **다르게**)
   - 둘 다 **Auto Confirm User** 체크
2. SQL Editor에서 `supabase/schema.sql` 실행 후 **`supabase/security_v2.sql`** 도 실행합니다(권한 분리·이력·복구).
3. 관리자 계정에 관리자 표시를 붙입니다. SQL Editor에서 한 번 실행:
   ```sql
   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'fieldteam-admin@example.com';
   ```
   (이 표시는 사용자가 스스로 바꿀 수 없는 영역(app_metadata)에 저장되며, 이미 로그인된 기기는 다시 로그인해야 반영됩니다.)
4. **Authentication → Sign In / Providers**에서 **Allow new users to sign up 끄기** ← 반드시
   - 켜 두면 주소를 아는 외부인이 스스로 계정을 만들어 들어올 수 있습니다.

### 3) config.js에 값 넣기
**Project Settings → API**(또는 Data API / API Keys)에서 값을 복사해 `config.js`에 넣고 커밋합니다.

```js
export const CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',   // Project URL
  supabaseAnonKey: 'eyJhbGciOi...',              // anon public 키 (또는 publishable 키)
  teamEmail: 'fieldteam@example.com',            // 현장용 계정 이메일
  adminEmail: 'fieldteam-admin@example.com',     // 관리자용 계정 이메일
  kakaoJsKey: '',                                // 선택
};
```

- anon(public) 키는 브라우저에 공개되도록 만든 키라 저장소에 올려도 됩니다. 데이터 보호는 로그인 + DB 보안 정책이 맡습니다.
- **service_role(secret) 키는 절대 넣지 마세요.** 모든 보안을 우회하는 관리자 키입니다.

### 4) GitHub Pages 켜기
저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
1~2분 뒤 `https://jhkimgeo-dot.github.io/drone-homepoint-map/` 로 접속됩니다. 이후 `main`에 올리면 자동으로 다시 배포됩니다.

### 5) (선택) 카카오내비 켜기
1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가
2. 앱 키 중 **JavaScript 키**를 `config.js`의 `kakaoJsKey`에 넣기
3. 앱 설정 → 플랫폼 → Web → 사이트 도메인에 `https://jhkimgeo-dot.github.io` 등록

## 운영

- 외부 인력이 바뀔 때: Supabase → Authentication → Users → 현장 계정 → 비밀번호 변경. 이미 로그인된 기기는 로그인이 최대 1시간(토큰 만료)까지 남을 수 있습니다. **즉시 끊으려면** 해당 계정의 메뉴에서 **Sign out user**(모든 기기 로그아웃)를 한 번 더 실행하세요.
- 비밀번호는 **12자 이상 영문+숫자+기호**로 정하세요. 계정 이메일이 공개 코드에 있어 비밀번호만 맞으면 들어올 수 있습니다.
- 변경·삭제 이력: 관리자 화면 상단 "이력" → 최근 100건(색상·메모 변경, 삭제). 삭제된 장소는 "복구"로 같은 번호에 되살립니다. 이력은 DB에 계속 쌓이며 SQL Editor에서 `select * from places_history` 로 전체를 볼 수 있습니다.
- 백업: 화면의 "내보내기"(CSV, 다시 가져오기 가능). 또는 Supabase → Table Editor → places → Export.
- 무료 플랜: 1주일 동안 접속이 전혀 없으면 Supabase 프로젝트가 일시 정지됩니다. 대시보드에서 Restore 하면 데이터 그대로 돌아옵니다.
- 지도는 OpenStreetMap 공용 서버(무료, 출처 표시 조건). 팀 내부 사용량은 문제없습니다. 위성지도가 필요하면 `app.js`의 `L.tileLayer(...)`를 브이월드 등으로 바꿉니다.

## CSV 형식

첫 줄은 머리글. 열 순서 무관, 대소문자·공백·괄호 안 설명 무시(`주소(팜맵 필지 기준)` → 주소).

| 항목 | 필수 | 인식하는 머리글 |
| --- | --- | --- |
| 이름 | 필수 | 이름, 장소명, 상호, 업체명, name |
| 위도 | 필수 | 위도, lat, latitude, y |
| 경도 | 필수 | 경도, lng, lon, longitude, x |
| 주소 | | 주소, 도로명주소, 지번주소, 소재지, address |
| 전화번호 | | 전화번호, 연락처, phone, tel |
| 색상 | | 색상, color (빨강·파랑 같은 이름, blue, #3e63dd) |
| 메모 | | 메모, 설명, 비고, memo |

- 엑셀 저장본(EUC-KR)과 UTF-8 모두 읽습니다. 파일은 브라우저에서 읽고 통과한 행만 DB에 저장합니다(최대 10MB).
- 홈포인트 이름 규칙: `A_TA_GH_16` → `GH_16` (영문·숫자 코드는 맨 뒤 영문+번호만). 한글 이름은 그대로.
- 위도·경도 열이 뒤바뀐 파일은 자동으로 바로잡습니다.
- 같은 이름·같은 좌표는 한 번만 저장(같은 CSV를 다시 올려도 중복 안 됨).
- 시군, 읍면, 작업자, 소티, 완료 소티 열은 저장하지 않습니다.

## 폴더 구조

```
index.html        화면 뼈대(로그인 화면 포함)
app.js            지도, 목록, 상세, 가져오기, 실시간 반영, 로그인
store.js          Supabase 연결(목록·추가·수정·삭제·실시간 구독·로그인)
csv.js            CSV 읽기(인코딩 판별, 열 인식, 이름 규칙), 내보내기
kakao.js          카카오맵·카카오내비 연결
palette.js        색상표
config.js         Supabase 주소·키, 팀 계정 이메일, 카카오 키  ← 설정은 여기만
styles.css        스타일(휴대폰 → PC 반응형)
vendor/           Leaflet 1.9.4, supabase-js 2.45.4 (외부 CDN 없이 동작)
supabase/schema.sql       DB 설정 SQL(테이블·실시간)
supabase/security_v2.sql  권한 분리·변경 이력·삭제 복구 SQL
test/             CSV 읽기 자동 테스트 (npm test)
samples/          예시 CSV
```

## 보안 메모

- 로그인 없이는 DB가 아무것도 돌려주지 않습니다(anon 권한 회수 + 행 수준 보안).
- 현장 계정: 보기, 색상·메모 수정만. 이름·주소·좌표 수정, 장소 등록, 삭제, 이력 조회, 복구는 DB가 거부합니다. 관리자 여부는 로그인 토큰의 app_metadata(사용자가 못 바꾸는 값)로 판별합니다.
- 이력에는 계정(현장/관리자)과 시각이 남습니다. 비밀번호를 공용으로 쓰기 때문에 **현장 인력 개인 단위로는 구분되지 않습니다.** 개인별 구분이 필요하면 사람별 계정으로 바꿀 수 있습니다.
- Supabase 무료 플랜에는 DB 자동 백업 복구가 없습니다. 관리자 화면 "내보내기"(CSV)를 주기적으로 받아 두세요.
- 사이트 주소와 코드는 공개 저장소라 누구나 볼 수 있지만, 장소 데이터는 Supabase에만 있고 저장소에는 올라가지 않습니다.

## 남은 확인 사항

- 휴대폰 실기기에서 카카오맵 앱·카카오내비 앱 호출 확인
- 카카오내비 사용 시 카카오 JavaScript 키 발급·도메인 등록
