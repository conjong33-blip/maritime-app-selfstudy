// 로비 선택 화면: 급수, 트랙(A/B), Track B 과목, 연도/회차 선택.
// 선택 값의 기준은 state (licenseClass, currentTrack, filters) 이고 DOM 은 state 를 보여 주기만 한다.
// 연도/회차 선택지는 questions 실제 데이터(fetchQuestionMetadata)로 채운다. 문제 로드, 채점, 저장은 하지 않는다.
// Track C 는 이 단계에서 연결하지 않는다 (카드의 초기 비활성 상태를 그대로 둔다).
import { config } from './config.js';
import { state, setCurrentTrack } from './state.js';
import { fetchQuestionMetadata } from './data/questions.js';
import { resolveFilterSelection } from './utils.js';
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
};
const DIMMED_CARD = ' opacity-60 border-[#3A506B]/20';

const LOADING_TEXT = '불러오는 중…';
const EMPTY_TEXT = '등록된 시험 없음';
const FAILED_TEXT = '불러오기 실패';

const byId = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// 화면 표시 (state -> DOM)
// ---------------------------------------------------------------------
function renderLicenseClass() {
  byId('btn-class-3').className = state.licenseClass === '3급' ? CLASSES.licenseSelected : CLASSES.licenseIdle;
  byId('btn-class-4').className = state.licenseClass === '4급' ? CLASSES.licenseSelected : CLASSES.licenseIdle;
}

// Track A/B 카드, 상단 배지, 필터 영역 표시. Track C 카드는 건드리지 않는다.
function renderTracks() {
  const track = state.currentTrack;
  if (!TRACKS[track]) return;
  for (const [key, def] of Object.entries(TRACKS)) {
    byId(def.cardId).className =
      CLASSES.trackBase + def.hover + (key === track ? def.selected : DIMMED_CARD);
    byId(def.optionsId).classList.toggle('hidden', key !== track);
  }
  const badge = byId('active-track-badge');
  badge.innerText = TRACKS[track].badgeText;
  badge.className = TRACKS[track].badgeClass;
  byId('filters-container').classList.remove('hidden');
}

// 과목을 고르기 전에는 HTML 의 초기 카드 스타일을 그대로 둔다 (V65 도 선택 뒤에만 카드 클래스를 다시 썼다).
function renderSubjectB() {
  byId('track-b-dropdowns').classList.toggle('hidden', !state.filters.subject);
  if (!state.filters.subject) return;
  for (const button of document.querySelectorAll('.subject-card')) {
    button.className = button.dataset.value === state.filters.subject ? CLASSES.subjectSelected : CLASSES.subjectIdle;
  }
}

function activeSelects() {
  const def = TRACKS[state.currentTrack];
  return def ? { year: byId(def.yearSelectId), round: byId(def.roundSelectId) } : null;
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
    setSelectMessage(selects.year, EMPTY_TEXT);
    setSelectMessage(selects.round, EMPTY_TEXT);
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
  const selection = resolveFilterSelection(state.metadata.combinations, {
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

// Track A / B 만 처리한다. C 나 알 수 없는 값은 무시한다.
export function selectTrack(value) {
  if (!Object.hasOwn(TRACKS, value)) return;
  setCurrentTrack(value);
  renderTracks();
  renderSubjectB();
  return refreshFilterOptions();
}

export function selectSubjectB(value) {
  if (typeof value !== 'string' || value === '') return;
  state.filters.subject = value;
  renderSubjectB();
  return refreshFilterOptions();
}

// 연도를 바꾸면 그 연도에 실제 있는 회차로 회차 선택지를 다시 만든다.
export function changeYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year)) return;
  const selection = resolveFilterSelection(state.metadata.combinations, { year, examRound: state.filters.examRound });
  if (selection.year !== year) return;
  state.filters.year = selection.year;
  state.filters.examRound = selection.examRound;
  renderFilterSelects(selection);
}

export function changeExamRound(value) {
  const selection = resolveFilterSelection(state.metadata.combinations, {
    year: state.filters.year,
    examRound: value,
  });
  if (selection.examRound !== value) return;
  state.filters.examRound = value;
}
