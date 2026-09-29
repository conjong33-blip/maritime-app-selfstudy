// 로비 선택 화면: 급수, 트랙(A/B), Track B 과목, 연도/회차 선택.
// 선택 값의 기준은 state (licenseClass, currentTrack, filters) 이고 DOM 은 state 를 보여 주기만 한다.
// 연도/회차 선택지는 questions 실제 데이터(fetchQuestionMetadata)로 채운다. 문제 로드, 채점, 저장은 하지 않는다.
// Track A 는 과목을 여러 개 체크할 수 있고(state.filters.subjects 가 기준), 연도/회차는 체크한 과목이 모두 있는 시험지만 고른다.
// Track C 는 이 단계에서 연결하지 않는다 (카드의 초기 비활성 상태를 그대로 둔다).
import { config } from './config.js';
import { state, setCurrentTrack } from './state.js';
import { fetchQuestionMetadata } from './data/questions.js';
import { commonCombinations, resolveFilterSelection } from './utils.js';
import { renderTrackCFilter } from './track-c-view.js';
import { renderDiagnosis } from './diagnosis-view.js';
import { hideConnectionError, showConnectionError } from './view.js';

// V65 와 같은 클래스 문자열
const CLASSES = {
  licenseSelected:
    'py-3 rounded-xl text-xs font-extrabold border-2 border-emerald-500 bg-emerald-950/40 text-emerald-300 shadow-md transition-all duration-200',
  licenseIdle:
    'py-3 rounded-xl text-xs font-extrabold border border-[#3A506B] bg-[#0B132B] text-slate-400 hover:border-emerald-500/60 transition-all duration-200',
  trackBase:
    'bg-[#1C2541] border-2 border-[#3A506B]/50 p-4 rounded-2xl cursor-pointer transition-all duration-300 flex flex-col items-center text-center justify-between shadow-md hover:shadow-lg h-full',
  subjectIdle:
    'subject-card bg-[#0B132B] border border-[#3A506B] p-3 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200',
  subjectSelected:
    'subject-card bg-emerald-950/60 border-2 border-emerald-500 p-3 rounded-xl text-xs font-black text-emerald-300 shadow-md shadow-emerald-500/10 transition-all duration-200',
};

const TRACKS = {
  A: {
    cardId: 'btn-track-a',
    hover: ' hover:border-[#5BC0BE]/60',
    selected: ' border-[#5BC0BE] shadow-lg shadow-[#5BC0BE]/10',
    badgeText: '모의고사',
    badgeClass: 'px-3 py-1 text-xs font-bold rounded-lg bg-[#5BC0BE]/20 border border-[#5BC0BE]/30 text-[#5BC0BE]',
    optionsId: 'track-a-options',
    yearSelectId: 'year-select-a',
    roundSelectId: 'round-select-a',
  },
  B: {
    cardId: 'btn-track-b',
    hover: ' hover:border-emerald-500/60',
    selected: ' border-emerald-500 shadow-lg shadow-emerald-500/10',
    badgeText: '과목 선택',
    badgeClass: 'px-3 py-1 text-xs font-bold rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400',
    optionsId: 'track-b-options',
    yearSelectId: 'year-select-b',
    roundSelectId: 'round-select-b',
  },
  // Track C 는 연도/회차/과목을 고르지 않는다 (지금 남은 오답 전체)
  C: {
    cardId: 'btn-track-c',
    hover: ' hover:border-rose-500/60',
    selected: ' border-rose-500 shadow-lg shadow-rose-500/10',
    badgeText: '오답소탕',
    badgeClass: 'px-3 py-1 text-xs font-bold rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-400',
    optionsId: 'track-c-options', // 급수(3급/4급) 선택 버튼
    yearSelectId: null,
    roundSelectId: null,
  },
};
const DISABLED_CARD = ' opacity-40 pointer-events-none';
const hasActiveWrongs = () => state.wrongPool.activeQuestionIds.length > 0;
const DIMMED_CARD = ' opacity-60 border-[#3A506B]/20';

const LOADING_TEXT = '불러오는 중…';
const EMPTY_TEXT = '등록된 시험 없음';
const FAILED_TEXT = '불러오기 실패';
const NO_SUBJECT_TEXT = '과목을 선택하세요';
const NO_COMMON_TEXT = '공통 시험 없음';

const byId = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// 화면 표시 (state -> DOM)
// ---------------------------------------------------------------------
function renderLicenseClass() {
  byId('btn-class-3').className = state.licenseClass === '3급' ? CLASSES.licenseSelected : CLASSES.licenseIdle;
  byId('btn-class-4').className = state.licenseClass === '4급' ? CLASSES.licenseSelected : CLASSES.licenseIdle;
}

// 하단 메인 CTA: 모의고사/과목선택은 기존 그대로, 오답소탕은 탭에 따라 다르다.
//  - "한번에 소탕하기"(trackCStage 'full'): "오답소탕 시작" 표시, 눌러야 exam-actions.js 가 startTrackC 를 부른다.
//  - "나누어 소탕하기"(trackCStage 'byTopic'): 이미 학습영역을 고르면 그 아래 전용 버튼(이 영역 오답 소탕/새 문제로
//    도전하기)이 있으므로 이 큰 CTA 는 통째로 숨긴다(세로 공간도 함께 사라진다 - display:none).
const START_LABELS = { A: '기출문제 로드 및 시험 시작', B: '기출문제 로드 및 시험 시작', C: '오답소탕 시작' };
function renderStartButtonLabel() {
  const button = byId('start-exam-btn');
  const label = byId('start-exam-btn-label');
  if (!button || !label) return;
  const hideForByTopic = state.currentTrack === 'C' && state.trackCStage === 'byTopic';
  button.classList.toggle('hidden', hideForByTopic);
  label.innerText = `${START_LABELS[state.currentTrack] ?? '기출문제 로드 및 시험 시작'} ⚓`;
}

// 헤더 행의 안내 문구: A/B 는 기존 문구 그대로, 오답소탕(C)만 학생 친화적인 게임형 문구로 바꾼다.
const FILTER_HINTS = {
  A: '세부 학습 필터를 선택해 주세요.',
  B: '세부 학습 필터를 선택해 주세요.',
  C: '격파를 기다리는 오답이 남아 있어요. 하나씩 깨뜨려 봐요!',
};

// Track A/B/C 카드, 상단 배지, 필터 영역 표시.
function renderTracks() {
  const track = state.currentTrack;
  if (!TRACKS[track]) return;
  for (const [key, def] of Object.entries(TRACKS)) {
    if (key === 'C') renderTrackCLobby();
    else byId(def.cardId).className = CLASSES.trackBase + def.hover + (key === track ? def.selected : DIMMED_CARD);
    if (def.optionsId) byId(def.optionsId).classList.toggle('hidden', key !== track);
  }
  const badge = byId('active-track-badge');
  badge.innerText = TRACKS[track].badgeText;
  badge.className = TRACKS[track].badgeClass;
  const hint = byId('active-track-hint');
  if (hint) hint.innerText = FILTER_HINTS[track] ?? FILTER_HINTS.A;
  // 한번에/나누어 소탕하기 탭은 오답소탕(C)일 때만 헤더 행 오른쪽에 보인다.
  byId('track-c-mode-tabs')?.classList.toggle('hidden', track !== 'C');
  byId('filters-container').classList.remove('hidden');
  renderStartButtonLabel();
}

// 과목을 고르기 전에는 HTML 의 초기 카드 스타일을 그대로 둔다 (V65 도 선택 뒤에만 카드 클래스를 다시 썼다).
function renderSubjectB() {
  byId('track-b-dropdowns').classList.toggle('hidden', !state.filters.subject);
  if (!state.filters.subject) return;
  for (const button of document.querySelectorAll('.subject-card')) {
    button.className = button.dataset.value === state.filters.subject ? CLASSES.subjectSelected : CLASSES.subjectIdle;
  }
}

// Track C 카드: 남은 오답이 없으면 선택할 수 없게 흐리게 두고, 있으면 남은 개수를 보여 준다.
export function renderTrackCCard() {
  const card = byId('btn-track-c');
  if (!card) return;
  const def = TRACKS.C;
  const count = state.wrongPool.activeQuestionIds.length;
  let tail = '';
  if (state.currentTrack === 'C') tail = def.selected;
  else if (count === 0) tail = DISABLED_CARD;
  else if (state.currentTrack !== null) tail = DIMMED_CARD;
  card.className = CLASSES.trackBase + def.hover + tail;
  const label = byId('track-c-count');
  if (label) {
    label.innerText = `남은 오답 ${count}문제`;
    label.classList.toggle('hidden', !state.wrongPool.loaded || count === 0);
  }
}

// 남은 오답이 0 이 되면 Track C 선택을 풀고 카드를 비활성/완료 상태로 되돌린다 ("소탕할 오답 없음"과 선택 표시가 함께 남지 않게).
// Track A/B 선택은 건드리지 않는다. 문제 풀이 중(quiz)에는 하지 않는다.
export function deselectTrackCIfEmpty() {
  if (state.view !== 'lobby' || state.currentTrack !== 'C' || hasActiveWrongs()) return;
  setCurrentTrack(null);
  byId('filters-container').classList.add('hidden');
  for (const key of ['A', 'B']) byId(TRACKS[key].cardId).className = CLASSES.trackBase + TRACKS[key].hover;
  renderTrackCLobby();
}

// "학생 변경"처럼 state.currentTrack 을 코드에서 직접 null 로 되돌렸을 때 쓴다 - renderTracks() 는
// state.currentTrack 이 null 이면 아무 일도 하지 않으므로(TRACKS[null] 이 없어 바로 return),
// filters-container/트랙 카드 3개가 이전 학생이 고르던 모습 그대로 남아 있을 수 있다(다음 학생에게 그대로 보임).
// 이 함수는 그 화면만 완전한 초기 상태로 되돌린다 - state 는 이미 resetAppState 가 초기화했다고 가정한다.
export function resetTrackSelectionUI() {
  byId('filters-container').classList.add('hidden');
  for (const key of ['A', 'B']) byId(TRACKS[key].cardId).className = CLASSES.trackBase + TRACKS[key].hover;
  renderTrackCLobby(); // Track C 카드는 (지금은 빈) wrongPool 기준으로 다시 그린다 -> 자동으로 비활성 상태
}

// Track C 카드 + 급수 선택 필터를 함께 다시 그린다 (wrongPool 이 바뀔 때마다, 또는 상단 탭이 바뀔 때마다 이 하나만
// 부르면 된다). 급수 자동 선택 정책은 track-c-actions.js 의 applyActive 가 state.wrongPool 을 만들 때 결정한다.
// 하단 메인 CTA 표시 여부(탭이 'byTopic'이면 숨김)도 탭이 바뀔 때 바로 반영되도록 여기서 함께 갱신한다.
export function renderTrackCLobby() {
  renderTrackCCard();
  renderTrackCFilter();
  renderStartButtonLabel();
}

// Track A 과목 체크박스 표시. state.filters.subjects 를 그대로 보여 준다 (DOM 이 기준이 아니다).
function renderSubjectsA() {
  for (const input of document.querySelectorAll('input[name="subject-select-a-group"]')) {
    input.checked = state.filters.subjects.includes(input.value);
  }
}

// 지금 트랙에서 연도/회차 선택지를 만드는 데 쓰는 조합. Track A 는 체크한 과목이 모두 있는 시험지만 남긴다.
function activeCombinations() {
  if (state.currentTrack === 'A') return commonCombinations(state.metadata.combinations, state.filters.subjects);
  return state.metadata.combinations;
}

function activeSelects() {
  const def = TRACKS[state.currentTrack];
  return def?.yearSelectId ? { year: byId(def.yearSelectId), round: byId(def.roundSelectId) } : null;
}

// select 하나를 안내 문구 한 줄로 바꾸고 잠근다 (불러오는 중, 없음, 실패).
function setSelectMessage(select, text) {
  select.replaceChildren(new Option(text, ''));
  select.disabled = true;
}

function fillSelect(select, items, selectedValue) {
  select.replaceChildren(...items.map(({ value, label }) => new Option(label, value)));
  select.disabled = false;
  select.value = selectedValue;
}

function renderFilterSelects(selection) {
  const selects = activeSelects();
  if (!selects) return;
  if (selection.years.length === 0) {
    const text = state.currentTrack === 'A' ? (state.filters.subjects.length === 0 ? NO_SUBJECT_TEXT : NO_COMMON_TEXT) : EMPTY_TEXT;
    setSelectMessage(selects.year, text);
    setSelectMessage(selects.round, text);
    return;
  }
  fillSelect(selects.year, selection.years.map((year) => ({ value: String(year), label: `${year}년` })), String(selection.year));
  fillSelect(selects.round, selection.examRounds.map((round) => ({ value: round, label: round })), selection.examRound);
}

// ---------------------------------------------------------------------
// questions 메타데이터 -> 연도/회차 선택지
// ---------------------------------------------------------------------
let metadataRequestId = 0; // 가장 최근 요청만 화면에 반영한다 (늦게 온 이전 응답 무시)
const metadataCache = new Map(); // "급수|과목" -> Promise (같은 조합은 다시 요청하지 않는다)

function loadMetadata(licenseClass, subject) {
  const key = `${licenseClass}|${subject ?? ''}`;
  if (!metadataCache.has(key)) {
    const request = fetchQuestionMetadata({ licenseClass, subject }).catch((error) => {
      metadataCache.delete(key); // 실패는 저장하지 않는다 (다시 시도할 수 있게)
      throw error;
    });
    metadataCache.set(key, request);
  }
  return metadataCache.get(key);
}

// 지금 선택에 필요한 메타데이터 범위: Track A 는 급수 전체, Track B 는 급수 + 과목(과목을 골랐을 때만).
function metadataScope() {
  if (state.currentTrack === 'A') return { licenseClass: state.licenseClass, subject: null };
  if (state.currentTrack === 'B' && state.filters.subject) {
    return { licenseClass: state.licenseClass, subject: state.filters.subject };
  }
  return null;
}

function applyFilterSelection() {
  const selection = resolveFilterSelection(activeCombinations(), {
    year: state.filters.year,
    examRound: state.filters.examRound,
  });
  state.filters.year = selection.year;
  state.filters.examRound = selection.examRound;
  renderFilterSelects(selection);
}

// 급수/트랙/과목이 바뀔 때 연도/회차 선택지를 실제 데이터로 다시 채운다. 처리가 끝나면 resolve 된다.
export async function refreshFilterOptions() {
  const requestId = ++metadataRequestId;
  const scope = metadataScope();
  if (!scope) return;

  const selects = activeSelects();
  setSelectMessage(selects.year, LOADING_TEXT);
  setSelectMessage(selects.round, LOADING_TEXT);
  try {
    const metadata = await loadMetadata(scope.licenseClass, scope.subject);
    if (requestId !== metadataRequestId) return;
    state.metadata.combinations = metadata.combinations;
    hideConnectionError();
    applyFilterSelection();
  } catch (error) {
    if (requestId !== metadataRequestId) return;
    state.metadata.combinations = [];
    state.filters.year = null;
    state.filters.examRound = null;
    setSelectMessage(selects.year, FAILED_TEXT);
    setSelectMessage(selects.round, FAILED_TEXT);
    showConnectionError(error);
  }
}

// ---------------------------------------------------------------------
// action 처리기
// ---------------------------------------------------------------------
export function selectLicenseClass(value) {
  if (!config.licenseClasses.includes(value)) return;
  state.licenseClass = value;
  renderLicenseClass();
  return refreshFilterOptions();
}

// Track A / B / C 를 처리한다 (C 는 남은 오답이 있을 때만). 알 수 없는 값은 무시한다.
export function selectTrack(value) {
  if (!Object.hasOwn(TRACKS, value)) return;
  if (value === 'C' && !hasActiveWrongs()) return;
  // Track C 를 새로 선택할 때만 기본 탭("한번에 소탕하기")으로 되돌린다 (이미 C 에서 다시 눌러도 고른 탭은 유지 -
  // 3번 항목: 이미 "나누어 소탕하기"를 보고 있는데 불필요하게 기본 탭으로 되돌리지 않는다).
  if (value === 'C' && state.currentTrack !== 'C') {
    state.trackCStage = 'full';
    state.diagnosis.expanded = false;
    // diagnosis.expanded 를 여기서 직접 껐으므로, 그 값을 보고 보임/숨김을 정하는 diagnosis-detail-panel
    // ("나누어 소탕하기" 패널)도 즉시 다시 그려야 한다 - renderTracks()/renderTrackCLobby() 는 이 패널을
    // 건드리지 않아서, 부르지 않으면 이전에 열려 있던 "나누어 소탕하기" 패널이 새로 고른 "한번에 소탕하기"
    // 화면과 함께 그대로 남아 보이는 버그가 있었다.
    renderDiagnosis();
  }
  setCurrentTrack(value);
  // V65 처럼 처음 Track A 에 들어가면 기관1 이 체크된 상태로 시작한다 (state 가 기준이고 체크박스는 그것을 보여 준다).
  if (value === 'A' && state.filters.subjects.length === 0) state.filters.subjects = [config.trackASubjects[0]];
  renderTracks();
  renderSubjectsA();
  renderSubjectB();
  return refreshFilterOptions();
}

export function selectSubjectB(value) {
  if (typeof value !== 'string' || value === '') return;
  state.filters.subject = value;
  renderSubjectB();
  return refreshFilterOptions();
}

// state 의 급수/트랙/과목/연도/회차 선택을 로비 화면에 다시 그린다 (이어하기로 선택이 바뀐 뒤에 쓴다).
export function syncLobbyFromState() {
  renderLicenseClass();
  renderTracks();
  renderSubjectB();
  renderSubjectsA();
  return refreshFilterOptions();
}

// Track A 과목 체크/해제. checked 는 사용자가 방금 바꾼 체크 상태이고, 이후 표시는 state 로 다시 그린다.
export function toggleSubjectA(value, checked) {
  if (state.currentTrack !== 'A' || !config.trackASubjects.includes(value)) return;
  const selected = new Set(state.filters.subjects);
  if (checked) selected.add(value);
  else selected.delete(value);
  state.filters.subjects = config.trackASubjects.filter((subject) => selected.has(subject));
  renderSubjectsA();
  return refreshFilterOptions();
}

// 연도를 바꾸면 그 연도에 실제 있는 회차로 회차 선택지를 다시 만든다.
export function changeYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year)) return;
  const selection = resolveFilterSelection(activeCombinations(), { year, examRound: state.filters.examRound });
  if (selection.year !== year) return;
  state.filters.year = selection.year;
  state.filters.examRound = selection.examRound;
  renderFilterSelects(selection);
}

export function changeExamRound(value) {
  const selection = resolveFilterSelection(activeCombinations(), {
    year: state.filters.year,
    examRound: value,
  });
  if (selection.examRound !== value) return;
  state.filters.examRound = value;
}
