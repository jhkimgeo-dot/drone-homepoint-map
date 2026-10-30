// 사이트 설정. Supabase 프로젝트를 만든 뒤 아래 값을 채워 넣으면 됩니다. (README의 "처음 설정" 참고)
//
// - supabaseUrl, supabaseAnonKey: Supabase 대시보드 → Project Settings → API 에 있는 값.
//   anon(public) 키는 브라우저에 공개되도록 만들어진 키라서 여기에 적어도 됩니다.
//   데이터는 DB의 행 수준 보안(RLS) 때문에 팀 비밀번호로 로그인한 사람만 읽고 쓸 수 있습니다.
//   service_role 키는 절대 여기에 넣지 마세요.
// - teamEmail: Supabase Authentication에 만든 팀 공용 계정의 이메일. 화면에서는 비밀번호만 묻습니다.
// - kakaoJsKey: 선택. 넣으면 "카카오내비" 버튼이 켜집니다.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  teamEmail: '',
  kakaoJsKey: '',
};
