// 문제 1개 표시. state.quiz 의 현재 문제를 index.html 의 기존 V65 DOM 에 그린다 (V65 showQuestion 의 표시 부분).
// DB 조회, 채점, 저장, 오답 기록, 세션은 여기서 하지 않는다. 데이터가 없으면 아무것도 하지 않는다.
// 문제 객체는 questions 행 형태(option_ga/na/sa/aa, option_*_img, image_url 등)를 가정한다.
import { state, getCurrentQuestion } from './state.js';
import { renderMath } from './math.js';
import {
  ANSWER_KEYS,
  formatAnswerLabel,
  formatBarText,
  getExplanationBlocksHtml,
  normalizeAnswerKey,
  normalizeImageUrl,
} from './utils.js';
import { clearQuizFeedback } from './view.js';

// V65 와 같은 클래스 문자열 (resetOptionsStyle / applySelectionStyle / 오답 보기 제외 스타일)
const OPTION_CLASS = {
  default:
    'option-btn w-full text-left bg-[#0B132B] hover:bg-[#0B132B]/80 border-2 border-[#3A506B]/40 hover:border-[#5BC0BE]/50 p-4 rounded-2xl text-slate-200 transition-all duration-200 flex items-center space-x-3 group',
  selected:
    'option-btn w-full text-left bg-emerald-950/30 border-2 border-emerald-400 p-4 rounded-2xl text-white shadow-md shadow-emerald-400/5 transition-all duration-200 flex items-center space-x-3',
  eliminated:
    'option-btn w-full text-left bg-rose-950/20 border-2 border-rose-500 p-4 rounded-2xl text-rose-300 flex items-center space-x-3 pointer-events-none opacity-50',
};

const TRACK_NAMES = { A: '모의고사', B: '과목 선택', C: '오답 소탕' };

const byId = (id) => document.getElementById(id);
const setHidden = (id, hidden) => byId(id)?.classList.toggle('hidden', hidden);

function isGraded(question) {
  return Boolean(state.quiz.graded[question.id]);
}

// 현재 문제를 화면 전체에 그린다. 문제 데이터가 없으면 아무 일도 하지 않는다.
export function renderCurrentQuestion() {
  const question = getCurrentQuestion();
  if (!question) return;
  renderQuestion(question);
}

export function renderQuestion(question) {
  clearQuizFeedback();
  renderQuestionHeader(question);
  renderQuestionImage(question);
  renderQuestionText(question);
  renderChoices(question);
  renderChoiceImages(question);
  renderChoiceStates(question);
  renderNavigationState();
  renderExplanationPreview(question);
  renderWorkspaceLayout(question);
}

// 문제 본문은 그대로 두고 정답 확인으로 바뀌는 부분(보기 상태, 버튼, 해설, 좌우 배치)만 다시 그린다.
export function renderQuestionStatus(question) {
  renderChoiceStates(question);
  renderNavigationState();
  renderExplanationPreview(question);
  renderWorkspaceLayout(question);
}

// 트랙 이름, 제목줄, 문제 번호 배지
function renderQuestionHeader(question) {
  const grade = question.license_class || state.licenseClass;
  const tag = byId('current-track-tag');
  if (tag) tag.innerText = TRACK_NAMES[state.currentTrack] ?? '';

  const title = byId('subject-title');
  if (title) {
    title.innerText =
      state.currentTrack === 'C'
        ? `[${grade} ${question.subject}] 오답 클리닉 피드백`
        : `[${grade} ${question.subject}] ${question.year}년 ${question.exam_round}`;
  }
  const current = byId('current-num-badge');
  if (current) current.innerText = String(state.quiz.currentIndex + 1);
  const total = byId('total-num-badge');
  if (total) total.innerText = String(state.quiz.questions.length);
}

function renderQuestionImage(question) {
  const container = byId('image-container');
  const image = byId('question-image');
  if (!container || !image) return;
  setImage(container, image, normalizeImageUrl(question.image_url));
}

function renderQuestionText(question) {
  const element = byId('question-text');
  if (!element) return;
  element.innerHTML = `Q${state.quiz.currentIndex + 1}. ${formatBarText(question.question_text)}`;
  renderMath(element);
}

// 보기 4개의 본문
export function renderChoices(question) {
  for (const key of ANSWER_KEYS) {
    const element = byId(`text-${key}`);
    if (!element) continue;
    element.innerHTML = formatBarText(question[`option_${key}`] || '');
    renderMath(element);
  }
}

// 보기 이미지 (앞뒤 공백/줄바꿈은 제거하고, 공백뿐이면 이미지 없음)
export function renderChoiceImages(question) {
  for (const key of ANSWER_KEYS) {
    const container = byId(`img-container-${key}`);
    const image = byId(`img-${key}`);
    if (!container || !image) continue;
    setImage(container, image, normalizeImageUrl(question[`option_${key}_img`]));
  }
}

function setImage(container, image, url) {
  if (url) {
    image.src = url;
    container.classList.remove('hidden');
  } else {
    image.removeAttribute('src');
    container.classList.add('hidden');
  }
}

// 보기 버튼 스타일: 기본 -> 선택한 보기 -> (Track B/C) 정답확인 전이면 제외한 보기, 확인 후면 선택 잠금.
// 선택/제외 상태는 questions.id 기준 state 에서 읽는다.
export function renderChoiceStates(question) {
  const marked = state.quiz.markedAnswers[question.id];
  const eliminated = state.quiz.eliminatedChoices[question.id] ?? [];
  const isTrackA = state.currentTrack === 'A';

  for (const key of ANSWER_KEYS) {
    const button = byId(`opt-${key}`);
    if (!button) continue;
    button.className = OPTION_CLASS.default;
    if (key === marked) button.className = OPTION_CLASS.selected;
  }

  if (isTrackA) return;
  // 틀려서 제외한 보기는 정답을 맞힌 뒤에도 그대로 표시한다 (V65 는 정답 직후에만 남고 다시 방문하면 사라졌다).
  for (const key of ANSWER_KEYS) {
    const button = byId(`opt-${key}`);
    if (!button) continue;
    if (eliminated.includes(key)) button.className = OPTION_CLASS.eliminated;
    if (isGraded(question)) button.classList.add('pointer-events-none', 'opacity-80');
  }
}

// 이전/다음/정답확인/최종제출 버튼 표시. V65 처럼 이전 버튼은 첫 문제에서도 그대로 보인다.
export function renderNavigationState() {
  const question = getCurrentQuestion();
  if (!question) return;
  const isLast = state.quiz.currentIndex === state.quiz.questions.length - 1;

  if (state.currentTrack === 'A') {
    setHidden('btn-grade-b', true);
    setHidden('btn-next', isLast);
    setHidden('btn-submit-a', !isLast);
  } else {
    setHidden('btn-next', false);
    setHidden('btn-submit-a', true);
    setHidden('btn-grade-b', isGraded(question));
  }
}

// 우측 해설 영역: 정답 확인 전에는 안내만 보이고 해설은 숨긴다. 정답을 맞힌 문제(graded)는 해설을 보인다.
// (다시 방문해도 state 만으로 같은 화면이 나온다.)
export function renderExplanationPreview(question) {
  setHidden('exam-summary-block', true);
  setHidden('warp-return-container', true);
  if (state.currentTrack === 'A') {
    setHidden('tutor-placeholder-a', false);
    setHidden('tutor-placeholder-b', true);
    setHidden('active-explanation-block', true);
    return;
  }
  setHidden('tutor-placeholder-a', true);
  if (!isGraded(question)) {
    setHidden('active-explanation-block', true);
    setHidden('tutor-placeholder-b', false);
  } else {
    setHidden('tutor-placeholder-b', true);
    renderExplanationBlocks(question);
    setHidden('active-explanation-block', false);
  }
}

// 정답 배지 + 해설 3단 블록(핵심 용어 / 쉬운 개념 정의 또는 영어 번역 / 정답 및 보기 원리 분석)의 내용을 채운다.
// 구조는 V65 showTrackBExplanation 과 같다: [배지 카드] + [해설 블록]. 보이고 숨기는 것은 호출하는 쪽이 정한다.
export function renderExplanationBlocks(question) {
  const block = byId('active-explanation-block');
  if (!block) return;
  block.innerHTML = '';

  const correctKey = normalizeAnswerKey(question.correct_answer);
  const template = byId('tpl-badge-correct');
  if (template) {
    const badge = template.content.cloneNode(true);
    const marked = state.quiz.markedAnswers[question.id] ?? correctKey;
    badge.querySelector('.correct-subtitle-label').innerText =
      `마킹한 답: ${formatAnswerLabel(marked)} | 정답: ${formatAnswerLabel(correctKey)}`;
    const card = document.createElement('div');
    card.id = 'grade-badge-card';
    card.className = 'p-4 rounded-xl bg-[#09291E]/80 border border-emerald-500/30 mb-4 animate-fadeIn';
    card.appendChild(badge);
    block.appendChild(card);
  }

  const blocks = document.createElement('div');
  blocks.className = 'space-y-4';
  blocks.innerHTML = getExplanationBlocksHtml(question);
  block.appendChild(blocks);
  renderMath(block);
}

// 좌우 패널 배치: 모의고사 풀이 중, 그리고 정답확인 전에는 문제 영역이 전체 폭(12:0), 정답확인 후에는 8:4.
// (모의고사 제출 후 결과 화면의 8:4 는 이후 단계에서 채점과 함께 붙인다.)
export function renderWorkspaceLayout(question) {
  const left = byId('workspace-left-panel');
  const right = byId('workspace-right-panel');
  if (!left || !right) return;
  const split = state.currentTrack !== 'A' && isGraded(question);
  left.classList.toggle('lg:col-span-8', split);
  left.classList.toggle('lg:col-span-12', !split);
  right.classList.toggle('hidden', !split);
}
