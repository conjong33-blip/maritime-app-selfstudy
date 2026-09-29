// 화면 전환과 공통 안내 표시 (state -> DOM). 문제 풀이 화면(workspace)과 로비 화면 중 무엇을 보일지는 state.view 가 정한다.
// 새 DOM 은 만들지 않고 index.html 의 V65 구조를 그대로 쓴다.
import { state } from './state.js';

const byId = (id) => document.getElementById(id);

// state.view('lobby' | 'quiz')에 맞춰 로비/workspace/헤더 버튼을 보인다.
// V65 처럼 문제 풀이 중에는 헤더에 "대기실로 돌아가기"만 보이고, 학번 배지와 로그아웃 버튼은 숨긴다.
export function renderView() {
  const inQuiz = state.view === 'quiz';
  byId('lobby-screen').classList.toggle('hidden', inQuiz);
  byId('system-workspace').classList.toggle('hidden', !inQuiz);
  byId('header-back-to-lobby-btn').classList.toggle('hidden', !inQuiz);
  byId('header-logout-btn').classList.toggle('hidden', inQuiz);
  byId('header-student-badge').classList.add('hidden');
}

// 상단 "확인" 버튼: state.studentVerification 을 그대로 보여준다 (계산은 session-actions.js 가 한다).
// 실제 사전등록 검증은 아직 연결하지 않았으므로 'invalid' 는 지금 쓰이지 않는다 - 여기서는 표시만 준비해 둔다.
const VERIFY_BTN_IDLE = 'bg-[#5BC0BE] hover:bg-[#4aa9a7] text-slate-950 font-black px-5 py-2 rounded-xl text-xs transition';
const VERIFY_BTN_CHECKING = 'bg-[#5BC0BE]/50 text-slate-950/70 font-black px-5 py-2 rounded-xl text-xs cursor-wait';
const VERIFY_BTN_VERIFIED = 'bg-emerald-600 text-white font-black px-5 py-2 rounded-xl text-xs cursor-default';
const VERIFY_BTN_INVALID = 'bg-rose-950/60 border border-rose-500/50 text-rose-300 font-black px-5 py-2 rounded-xl text-xs transition';

export function renderStudentVerification() {
  const btn = byId('student-verify-btn');
  if (btn) {
    if (state.studentVerification === 'verified') {
      btn.className = VERIFY_BTN_VERIFIED;
      btn.textContent = '확인 완료 ✓';
      btn.disabled = true;
    } else if (state.studentVerification === 'checking') {
      btn.className = VERIFY_BTN_CHECKING;
      btn.textContent = '확인 중…';
      btn.disabled = true;
    } else if (state.studentVerification === 'invalid') {
      btn.className = VERIFY_BTN_INVALID;
      btn.textContent = '확인';
      btn.disabled = false;
    } else {
      btn.className = VERIFY_BTN_IDLE;
      btn.textContent = '확인';
      btn.disabled = false;
    }
  }

  // 2단계 화면 전환: 확인 전에는 학생 확인 화면만, verified 되면 학습 홈만 보인다. 같은 SPA 안에서
  // state 값 하나(studentVerification)로 show/hide 만 한다 - 새 페이지/router 는 만들지 않는다.
  const verified = state.studentVerification === 'verified';
  byId('student-verify-screen')?.classList.toggle('hidden', verified);
  byId('learning-home')?.classList.toggle('hidden', !verified);
  const infoText = byId('student-info-text');
  if (infoText && verified && state.profile) {
    infoText.textContent = `${state.profile.studentNo} · ${state.profile.studentName}`;
  }
}

// 문제 풀이 화면으로 전환. studentLabel 은 V65 처럼 숨겨진 학번 배지 텍스트에 넣어 둔다.
export function showQuiz(studentLabel) {
  state.view = 'quiz';
  byId('display-student-id').innerText = studentLabel;
  renderView();
}

export function showLobby() {
  state.view = 'lobby';
  renderView();
}

// 시험 시작 버튼 주변의 입력 안내 (alert 대신)
export function showStartMessage(text) {
  const element = byId('start-message');
  element.innerText = text;
  element.classList.remove('hidden');
}

export function clearStartMessage() {
  const element = byId('start-message');
  element.innerText = '';
  element.classList.add('hidden');
}

// 문제를 불러오는 동안 시작 버튼을 잠근다.
export function setStartLoading(loading) {
  const button = byId('start-exam-btn');
  button.disabled = loading;
  button.classList.toggle('opacity-60', loading);
  button.classList.toggle('cursor-wait', loading);
}

// 문제 풀이 화면의 안내 (alert 대신). 정답 확인 결과 안내(quiz-message)와 오답 저장 실패 안내(quiz-save-message)를 따로 둔다.
const MESSAGE_BASE = 'mb-4 rounded-xl border px-4 py-3 text-xs font-semibold';
const MESSAGE_TONES = {
  warning: 'bg-amber-950/40 border-amber-600/40 text-amber-200',
  error: 'bg-rose-950/40 border-rose-600/40 text-rose-200',
};

function setMessage(id, text, tone) {
  const element = byId(id);
  element.innerText = text;
  element.className = `${MESSAGE_BASE} ${MESSAGE_TONES[tone] ?? MESSAGE_TONES.warning}`;
}

function clearMessage(id) {
  const element = byId(id);
  element.innerText = '';
  element.className = 'hidden';
}

export function showQuizMessage(text, tone = 'warning') {
  setMessage('quiz-message', text, tone);
}

export function clearQuizFeedback() {
  clearMessage('quiz-message');
}

export function showQuizSaveError(text) {
  setMessage('quiz-save-message', text, 'error');
}

export function clearQuizSaveError() {
  clearMessage('quiz-save-message');
}

// 통신 오류 안내 박스 (V65 의 connection-error-box)
export function showConnectionError(error) {
  byId('connection-error-message').innerText = error instanceof Error ? error.message : String(error);
  byId('connection-error-box').classList.remove('hidden');
}

export function hideConnectionError() {
  byId('connection-error-box').classList.add('hidden');
}

// 최근 학습 세션 저장 실패 안내 (문제 풀이를 막지 않는 작은 안내). 오답 저장 실패 안내와 따로 둔다.
export function showSessionSaveError(text) {
  setMessage('session-save-message', text, 'warning');
}

export function clearSessionSaveError() {
  clearMessage('session-save-message');
}

// 로비의 "이어서 학습하기" 배너 (V65 resume-prompt-card, compact 형태).
// main: Track/급수/과목/위치 ("Track B · 4급 기관2 · 12/25"), detail: 연도/회차(좁은 화면에서는 CSS 로 숨긴다).
export function showResumeCard({ main, detail }) {
  byId('resume-session-info').innerText = main;
  byId('resume-session-detail').innerText = detail;
  byId('resume-prompt-card').classList.remove('hidden');
}

export function hideResumeCard() {
  byId('resume-prompt-card').classList.add('hidden');
}

// 이어하기/처음부터 시작 처리 중에는 카드의 두 버튼을 잠근다.
export function setResumeCardBusy(busy) {
  for (const button of byId('resume-prompt-card').querySelectorAll('button')) {
    button.disabled = busy;
    button.classList.toggle('opacity-60', busy);
    button.classList.toggle('cursor-wait', busy);
  }
}
