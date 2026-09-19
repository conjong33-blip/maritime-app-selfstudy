// 앱 설정. 비밀 값(키 등)은 코드에 넣지 않는다.
// Supabase 연결 코드는 아직 없다. 아래 supabase 값은 이후 단계에서 연결할 때 읽을 자리(환경변수 이름:
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)만 잡아 둔 것이다.
// 연도/회차/과목 목록은 DB 기준으로 이후에 가져오므로 여기에 고정 목록을 두지 않는다.
export const config = {
  appName: '해기사 튜터',
  trackTypes: ['A', 'B', 'C'],
  licenseClasses: ['3급', '4급'],
  // Track A 과목 체크박스 순서 (index.html 과 같다). 시험 문제도 이 순서로 묶어 출제한다.
  trackASubjects: ['기관1', '기관2', '기관3', '직무일반', '영어'],
  // 학번/이름 최대 글자 수 (db/001_selfstudy_schema.sql 의 CHECK 와 같다)
  limits: { studentNo: 20, studentName: 50 },
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL ?? '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  },
};
