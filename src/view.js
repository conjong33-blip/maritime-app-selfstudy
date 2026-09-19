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
