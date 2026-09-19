// 앱 설정. 비밀 값(키 등)은 코드에 넣지 않는다.
// Supabase 연결 코드는 아직 없다. 아래 값은 이후 단계에서 연결할 때 읽을 자리만 잡아 둔 것이다.
export const config = {
  appName: '해기사 튜터',
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL ?? '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  },
};
