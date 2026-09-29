// 로그인 유지용 최소 정보만 localStorage 에 보관한다 (학습 데이터 자체는 절대 넣지 않는다 - wrongPool/문제/답안/
// session 진행 상태/HELPER/learning_topic/시험 결과/Supabase key 는 여기 오지 않는다). 실제 데이터는 항상
// Supabase 에서 다시 조회한다 - 여기 저장된 값은 "누구로 로그인했는지"를 기억하는 용도일 뿐이다.
const KEY = 'selfstudy_login_v1';

export function saveLoginInfo({ profileKey, studentNo, studentName }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ profileKey, studentNo, studentName }));
  } catch {
    // localStorage 를 쓸 수 없는 환경(프라이빗 모드 등)에서는 조용히 무시한다 - 로그인 유지만 안 될 뿐,
    // 학번/이름을 직접 입력하는 기존 확인 흐름은 그대로 동작한다.
  }
}

export function readLoginInfo() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.studentNo !== 'string' || typeof parsed.studentName !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLoginInfo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
