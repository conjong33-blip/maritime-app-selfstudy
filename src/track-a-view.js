// Track A(모의고사) 제출 확인과 결과 화면 표시 (state -> DOM). 문제 본문/보기는 공용 quiz-renderer.js 가 그린다.
// 결과 화면은 V65 의 exam-summary-block 과 warp(오답 복습) 화면을 그대로 쓴다.
// 상태를 바꾸지 않고, DB 에도 접근하지 않는다.
import { state } from './state.js';
import { renderMath } from './math.js';
import { formatAnswerLabel, getExplanationBlocksHtml } from './utils.js';

const byId = (id) => document.getElementById(id);
const setHidden = (id, hidden) => byId(id)?.classList.toggle('hidden', hidden);

const WRONG_ITEM_CLASS =
  'w-full text-left bg-[#0B132B]/80 hover:bg-rose-950/30 border border-[#3A506B]/50 hover:border-rose-500/60 p-3 rounded-xl transition-all duration-200 flex justify-between items-center text-xs group';
const SAVE_RETRY_CLASS =
  'ml-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 px-2 py-0.5 rounded-md text-[10px] font-bold transition';

// 최종 제출 확인 창 (confirm 대신 문제 영역 안에 표시)
export function renderSubmitConfirm() {
  const open = state.quiz.confirmingSubmit && !state.quiz.submission;
  setHidden('submit-confirm-box', !open);
  if (!open) return;
  const unanswered = state.quiz.questions.filter((question) => !state.quiz.markedAnswers[question.id]).length;
  byId('submit-confirm-text').innerText =
    unanswered > 0
      ? `아직 마킹하지 않은 문항이 ${unanswered}개 있습니다. 이대로 답안지를 최종 제출하시겠습니까? 미응답 문항은 오답 노트에 기록하지 않습니다.`
      : '마킹한 답안지를 최종 제출하시겠습니까? 제출 후에는 답을 바꿀 수 없고 성적이 채점됩니다.';
}

function optionalChevron() {
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-chevron-right text-[#5BC0BE] ml-1.5';
  return icon;
}

function buildWrongItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = WRONG_ITEM_CLASS;
  button.dataset.action = 'review-track-a-question';
  button.dataset.value = String(item.index);

  const left = document.createElement('div');
  left.className = 'flex items-center space-x-2';
  const number = document.createElement('span');
  number.className = 'w-5 h-5 rounded-md bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-[10px]';
  number.textContent = `Q${item.index + 1}`;
  const title = document.createElement('span');
  title.className = 'font-semibold text-slate-300 group-hover:text-rose-300 transition';
  title.textContent = `[${item.subject}] ${item.result === 'unanswered' ? '미응답 문항 해설 확인' : '오답 해설 확인'}`;
  left.append(number, title);

  const right = document.createElement('span');
  right.className = 'text-[10px] text-slate-500';
  right.append(`나의 마킹: ${formatAnswerLabel(item.selectedKey)} `, optionalChevron());

  button.append(left, right);
  return button;
}

// 결과 요약: 점수, 정답/오답/미응답 수, 과목별 결과, 오답 목록, 기록 실패 안내
export function renderSummary() {
  const submission = state.quiz.submission;
  if (!submission) return;
  byId('summary-score').innerText = String(submission.score);

  const parts = [
    `정답 ${submission.correctCount}`,
    `오답 ${submission.incorrectCount}`,
    `미응답 ${submission.unansweredCount}`,
  ];
  if (submission.invalidCount > 0) parts.push(`채점 불가 ${submission.invalidCount}`);
  byId('summary-counts').innerText = `${parts.join(' · ')} / 총 ${submission.total}문항`;

  const subjects = byId('summary-subjects');
  subjects.replaceChildren(
    ...submission.bySubject.map((row) => {
      const line = document.createElement('p');
      line.className = 'text-[11px] text-slate-400';
      const detail = [`오답 ${row.incorrect}`, `미응답 ${row.unanswered}`];
      if (row.invalid > 0) detail.push(`채점 불가 ${row.invalid}`);
      line.textContent = `${row.subject}: ${row.correct}/${row.total}문항 정답 (${row.score}점) · ${detail.join(' · ')}`;
      return line;
    }),
  );

  const reviewItems = submission.items.filter((item) => item.result === 'incorrect' || item.result === 'unanswered');
  byId('wrong-count').innerText = `(${reviewItems.length}개 오답·미응답)`;
  const list = byId('wrong-warp-list');
  if (reviewItems.length === 0) {
    const message = document.createElement('p');
    message.className = 'text-xs text-emerald-400 font-bold text-center py-4';
    message.textContent =
      submission.invalidCount === 0 ? '축하합니다! 오답이 없습니다. ⚓' : '확인할 오답이 없습니다. (채점 불가 문항 제외)';
    list.replaceChildren(message);
  } else {
    list.replaceChildren(...reviewItems.map(buildWrongItem));
  }
  renderSaveStatus();
}

// 오답 기록 저장 결과 안내. 저장에 실패해도 결과 화면은 그대로 보인다.
export function renderSaveStatus() {
  const submission = state.quiz.submission;
  const element = byId('summary-save-status');
  if (!submission) return;
  const failed = submission.failedWrongIds.length;
  if (failed === 0) {
    element.classList.add('hidden');
    element.replaceChildren();
    return;
  }
  const text = document.createElement('span');
  text.textContent = `오답 기록 ${failed}건을 저장하지 못했습니다. 채점 결과에는 영향이 없습니다.`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = SAVE_RETRY_CLASS;
  retry.dataset.action = 'retry-track-a-save';
  retry.textContent = '다시 저장';
  element.replaceChildren(text, retry);
  element.classList.remove('hidden');
}

// 제출 후 오른쪽 패널: 결과 목록, 또는 문제 하나의 복습(선택/정답/해설).
export function renderResultPanel(question) {
  setHidden('tutor-placeholder-a', true);
  setHidden('tutor-placeholder-b', true);
  if (!state.quiz.reviewing) {
    setHidden('active-explanation-block', true);
    setHidden('warp-return-container', true);
    setHidden('exam-summary-block', false);
    renderSummary();
    return;
  }
  setHidden('exam-summary-block', true);
  setHidden('warp-return-container', false);
  renderReview(question);
  setHidden('active-explanation-block', false);
}

function renderReview(question) {
  const block = byId('active-explanation-block');
  block.innerHTML = '';
  const item = state.quiz.submission.items.find((entry) => entry.questionId === question.id);
  const number = state.quiz.currentIndex + 1;

  const template = byId(item?.result === 'correct' ? 'tpl-badge-correct' : 'tpl-badge-incorrect');
  const badge = template.content.cloneNode(true);
  const card = document.createElement('div');
  card.id = 'grade-badge-card';
  if (item?.result === 'correct') {
    badge.querySelector('.correct-subtitle-label').innerText =
      `Q${number} 정답 | 나의 마킹: ${formatAnswerLabel(item.selectedKey)} | 정답: ${formatAnswerLabel(item.correctKey)}`;
    card.className = 'p-4 rounded-xl bg-[#09291E]/80 border border-emerald-500/30 mb-4 animate-fadeIn';
  } else {
    const title = badge.querySelector('.incorrect-title-label');
    const subtitle = badge.querySelector('.incorrect-subtitle-label');
    if (item?.result === 'invalid') {
      title.innerText = `Q${number} 정답 데이터를 확인할 수 없는 문항`;
      subtitle.innerText = `선택: ${formatAnswerLabel(item.selectedKey)} | 채점하지 않았습니다.`;
    } else {
      title.innerText = `Q${number} 복습 분석 모드`;
      subtitle.innerHTML = '';
      subtitle.append(`선택: ${formatAnswerLabel(item?.selectedKey)} | 정답: `);
      const correct = document.createElement('span');
      correct.className = 'text-emerald-400 font-semibold';
      correct.textContent = formatAnswerLabel(item?.correctKey);
      subtitle.append(correct);
    }
    card.className = 'p-4 rounded-xl bg-[#1c2541] border border-rose-500/40 mb-4 animate-fadeIn';
  }
  card.appendChild(badge);
  block.appendChild(card);

  const blocks = document.createElement('div');
  blocks.className = 'space-y-4';
  blocks.innerHTML = getExplanationBlocksHtml(question);
  block.appendChild(blocks);
  renderMath(block);
}
