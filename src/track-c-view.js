// Track C(오답소탕) 화면 표시 (state -> DOM): 로비의 "남은 오답" 진단 카드, 풀이 화면의 진행/정리 실패/완료 안내.
// 상태를 바꾸지 않고 DB 에도 접근하지 않는다. 문제 본문/보기/해설은 공용 quiz-renderer.js 가 그린다.
import { state } from './state.js';

const byId = (id) => document.getElementById(id);
const setHidden = (id, hidden) => byId(id)?.classList.toggle('hidden', hidden);

const DIAG_BASE = 'mb-6 p-5 rounded-2xl text-xs flex flex-col gap-3 animate-fadeIn border ';
const DIAG_ACTIVE = DIAG_BASE + 'bg-indigo-950/40 border-indigo-500/40';
const DIAG_CLEAR = DIAG_BASE + 'bg-emerald-950/40 border-emerald-500/40';

// 로비: 이 학생의 소탕할 오답 수 (V65 자가진단 카드). 프로필을 확인하기 전에는 보이지 않는다.
export function renderActiveWrongSummary() {
  const card = byId('self-diagnosis-card');
  if (!card) return;
  const { loaded, activeQuestionIds } = state.wrongPool;
  if (!state.profile || !loaded) {
    card.classList.add('hidden');
    return;
  }
  const count = activeQuestionIds.length;
  byId('diag-student-id').innerText = state.profile.studentNo;
  const status = byId('diag-wrong-status');
  const message = byId('diag-message');
  if (count > 0) {
    card.className = DIAG_ACTIVE;
    status.innerText = `${count}개 남음`;
    status.className = 'text-rose-400 font-extrabold';
    message.innerText = `"현재 격파를 기다리는 오답이 [ ${count} ] 남았습니다! 하나씩 깨트려봐요!"`;
  } else {
    card.className = DIAG_CLEAR;
    status.innerText = '0개 남음';
    status.className = 'text-emerald-400 font-extrabold';
    message.innerText = '"소탕할 오답이 없습니다. 모의고사나 과목별 학습을 먼저 진행해 주세요!"';
  }
}

function retryButton(action, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.className =
    'ml-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 px-2 py-0.5 rounded-md text-[10px] font-bold transition';
  button.textContent = label;
  return button;
}

function actionButton(action, label, primary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.className = primary
    ? 'bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-black transition'
    : 'bg-[#3A506B]/40 hover:bg-[#3A506B] text-slate-300 hover:text-white px-4 py-2 rounded-lg border border-[#3A506B] text-xs font-bold transition';
  button.textContent = label;
  return button;
}

// 풀이 화면 안내: 진행 상황(시험 점수 없음), 정리(clearWrong) 진행/실패, 마무리 결과. Track C 가 아니면 숨긴다.
export function renderTrackCStatus() {
  const panel = byId('track-c-panel');
  if (!panel) return;
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || state.quiz.questions.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const { questions, clearStatus, currentIndex, completion } = state.quiz;
  const total = questions.length;
  const solved = questions.filter((question) => clearStatus[question.id] === 'done').length;
  byId('track-c-progress').innerText = `남은 오답 ${total - solved}문제 · 해결 ${solved} / ${total}`;

  const notice = byId('track-c-clear-notice');
  const current = questions[currentIndex];
  const status = current ? clearStatus[current.id] : undefined;
  if (status === 'pending') {
    notice.replaceChildren(document.createTextNode('오답 기록을 정리하는 중입니다…'));
    notice.classList.remove('hidden');
  } else if (status === 'failed') {
    notice.replaceChildren(
      document.createTextNode('오답 기록 정리에 실패했습니다. 이 문제는 아직 소탕 완료가 아닙니다.'),
      retryButton('retry-track-c-clear', '다시 저장'),
    );
    notice.classList.remove('hidden');
  } else {
    notice.replaceChildren();
    notice.classList.add('hidden');
  }

  const box = byId('track-c-complete-box');
  if (!completion) {
    box.replaceChildren();
    box.classList.add('hidden');
    return;
  }
  const text = document.createElement('p');
  text.className = 'text-xs font-semibold text-slate-100 leading-relaxed';
  const buttons = document.createElement('div');
  buttons.className = 'flex items-center gap-2';
  if (completion.error) {
    text.textContent = '남은 오답 수를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
    buttons.append(actionButton('finish-track-c', '다시 확인', true), actionButton('logout-to-lobby', '대기실로', false));
  } else if (completion.remaining === 0) {
    text.textContent = '오답소탕 완료! 소탕할 오답이 더 이상 남아 있지 않습니다. ⚓';
    buttons.append(actionButton('logout-to-lobby', '대기실로 돌아가기', true));
  } else {
    text.textContent = `아직 소탕할 오답이 ${completion.remaining}개 남아 있습니다.`;
    buttons.append(actionButton('restart-track-c', '남은 오답 다시 소탕하기', true), actionButton('logout-to-lobby', '대기실로', false));
  }
  box.replaceChildren(text, buttons);
  box.classList.remove('hidden');
}
