// "내 학습 진단" 화면 표시 (state -> DOM): 로비의 compact 요약 카드 + 급수->과목->학습영역 상세 패널.
// 상태를 바꾸지 않고 DB 에도 접근하지 않는다. 집계 자체는 utils.js 의 순수 함수(groupActiveQuestionsBy*, pickPriorityReview,
// pickPriorityLearningTopics)가 한다. 학생에게는 learning_topic 이름만 보여주고 concept_tag 원문은 노출하지 않는다.
// 여기서 다루는 데이터는 전부 "지금 active 인 오답"(state.wrongPool.activeQuestions) 뿐이다 - cleared 문제나 정답 이력은 보지 않는다.
// 취약도 점수/이해도%/정답률/등급 같은 표현은 쓰지 않는다: 문제 수와 "우선 복습"만 보여준다.
import { config } from './config.js';
import { state } from './state.js';
import { groupActiveQuestionsByLearningTopic, groupActiveQuestionsBySubject, pickPriorityLearningTopics } from './utils.js';

const byId = (id) => document.getElementById(id);

// 오답소탕 급수: "한번에 소탕하기"(track-c-view.js)와 첫 인상을 동일하게 맞추기 위해 같은 rose 톤/강도를 쓴다
// (두 모드가 다른 기능처럼 보이지 않도록 - 새 색상을 만들지 않고 이미 쓰는 rose 를 그대로 재사용).
const LICENSE_IDLE =
  'bg-[#0B132B] border border-[#3A506B] hover:border-rose-500/60 p-3 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200';
const LICENSE_SELECTED =
  'bg-rose-950/60 border-2 border-rose-500 p-3 rounded-xl text-xs font-black text-rose-300 shadow-md shadow-rose-500/10 transition-all duration-200';
const LICENSE_DISABLED =
  'bg-[#0B132B]/40 border border-[#3A506B]/30 p-3 rounded-xl text-xs font-bold text-slate-600 opacity-50 cursor-not-allowed transition-all duration-200';

// 과목 선택: 급수보다 한 단계 약한 강조(테두리 1px, shadow 없음)로 단계별 강도 차이를 준다.
const SUBJECT_IDLE =
  'bg-[#0B132B] border border-[#3A506B] hover:border-indigo-500/60 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200';
const SUBJECT_SELECTED =
  'bg-indigo-950/50 border border-indigo-500 px-3 py-2 rounded-xl text-xs font-black text-indigo-300 transition-all duration-200';

// 우선 복습 영역: 선택 컨트롤과 구분되는 "진단 결과 목록"처럼 보이도록 살짝 넓은 행 여백을 쓴다
// (색상/테두리 계열, hover/selected 강조는 과목 행과 동일하게 유지한다 - 새 색상 체계를 만들지 않는다).
const TOPIC_ROW_IDLE =
  'w-full flex items-start justify-between gap-2 bg-[#0B132B] border border-[#3A506B] hover:border-indigo-500/60 px-3 py-2 rounded-lg text-xs font-bold text-slate-300 transition-all duration-200';
const TOPIC_ROW_SELECTED =
  'w-full flex items-start justify-between gap-2 bg-indigo-950/60 border-2 border-indigo-500 px-3 py-2 rounded-lg text-xs font-black text-indigo-300 shadow-md shadow-indigo-500/10 transition-all duration-200';

// 과목 카드: 과목명 + "오답 N문제"를 두 줄로 쌓아 보여준다(긴 가로 row 대신 - 급수 selector 와 시각적 리듬을 맞춘다).
// 과목명을 먼저 보고 그 다음 오답 수를 보도록 텍스트 위계를 준다(과목명 더 크고 진하게, 오답 수는 더 작고 muted).
function buildSubjectCard({ subject, count, selected, action, value }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = selected ? SUBJECT_SELECTED : SUBJECT_IDLE;
  button.dataset.action = action;
  button.dataset.value = value;
  const nameEl = document.createElement('span');
  nameEl.className = 'block text-sm font-black leading-snug';
  nameEl.textContent = subject;
  const detailEl = document.createElement('span');
  detailEl.className = `block mt-1 text-[10px] font-semibold ${selected ? 'text-indigo-300' : 'text-slate-500'}`;
  detailEl.textContent = `오답 ${count}문제`;
  button.append(nameEl, detailEl);
  return button;
}

// label 은 길면 2줄까지 자연스럽게 줄바꿈되고(break-keep 로 단어 중간에 끊기지 않게), detail 은 항상 우측 정렬로 고정한다.
function buildRowButton({ label, detail, selected, action, value, idleClass, selectedClass }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = selected ? selectedClass : idleClass;
  button.dataset.action = action;
  button.dataset.value = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'flex-1 min-w-0 text-left break-keep';
  labelEl.textContent = label;
  const detailEl = document.createElement('span');
  detailEl.className = `shrink-0 whitespace-nowrap ${selected ? 'text-indigo-300 font-semibold' : 'text-slate-500 font-semibold'}`;
  detailEl.textContent = detail;
  button.append(labelEl, detailEl);
  return button;
}

// 학생에게는 순위 숫자(1. 2. 3...)를 보여주지 않는다 - 정렬 순서(우선순위) 자체는 topics 배열 순서 그대로 유지된다.
function buildTopicButton(row, selected) {
  return buildRowButton({
    label: row.topic,
    detail: `관련 오답 ${row.count}문제`,
    selected,
    action: 'select-diagnosis-topic',
    value: row.topic,
    idleClass: TOPIC_ROW_IDLE,
    selectedClass: TOPIC_ROW_SELECTED,
  });
}

function noticeLine(text) {
  const p = document.createElement('p');
  p.className = 'text-[11px] text-slate-500 italic px-1';
  p.textContent = text;
  return p;
}

// ---------------------------------------------------------------------
// 로비 요약 카드 (V65 자가진단 카드 영역을 재사용)
// ---------------------------------------------------------------------
// 접힌 상태는 제목 + 토글 버튼만 남긴다(요약 문구는 학생 화면에 표시하지 않는다 - 진단 데이터 자체는
// state.wrongPool/state.diagnosis 에 그대로 유지되고, 펼치면 아래 상세 패널에서 그 데이터를 보여준다).
export function renderDiagnosisSummary() {
  const card = byId('self-diagnosis-card');
  if (!card) return;
  if (!state.profile || !state.wrongPool.loaded) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const toggle = byId('diagnosis-toggle-btn');
  if (toggle) toggle.innerText = state.diagnosis.expanded ? '접기' : '펼치기';
}

// ---------------------------------------------------------------------
// 상세 패널: 급수 -> 과목 -> 우선 복습 영역(오답 기록 기준, 기본 3개~최대 5개) -> (선택 시) 두 가지 행동
// ---------------------------------------------------------------------
function buildLicenseButton(licenseClass, count, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  const disabled = count === 0;
  button.className = disabled ? LICENSE_DISABLED : selected ? LICENSE_SELECTED : LICENSE_IDLE;
  button.textContent = `${licenseClass} · 오답 ${count}문제`;
  if (disabled) {
    button.disabled = true;
  } else {
    button.dataset.action = 'select-diagnosis-license';
    button.dataset.value = licenseClass;
  }
  return button;
}

function renderLicenseStep() {
  const container = byId('diagnosis-license-buttons');
  if (!container) return;
  const counts = state.wrongPool.countsByLicense ?? {};
  container.replaceChildren(
    ...config.licenseClasses.map((licenseClass) =>
      buildLicenseButton(licenseClass, counts[licenseClass] ?? 0, licenseClass === state.diagnosis.selectedLicenseClass),
    ),
  );
}

function renderSubjectStep() {
  const step = byId('diagnosis-subject-step');
  const list = byId('diagnosis-subject-list');
  if (!step || !list) return;
  const licenseClass = state.diagnosis.selectedLicenseClass;
  if (!licenseClass) {
    step.classList.add('hidden');
    return;
  }
  step.classList.remove('hidden');
  const subjects = groupActiveQuestionsBySubject(state.wrongPool.activeQuestions, licenseClass, config.trackASubjects);
  list.replaceChildren(
    ...subjects.map((row) =>
      buildSubjectCard({
        subject: row.subject,
        count: row.count,
        selected: row.subject === state.diagnosis.selectedSubject,
        action: 'select-diagnosis-subject',
        value: row.subject,
      }),
    ),
  );
}

function renderTopicStep() {
  const step = byId('diagnosis-topic-step');
  const list = byId('diagnosis-topic-list');
  const subjectLabel = byId('diagnosis-topic-subject-label');
  if (!step || !list) return;
  const { selectedLicenseClass: licenseClass, selectedSubject: subject, selectedTopic } = state.diagnosis;
  if (!licenseClass || !subject) {
    step.classList.add('hidden');
    return;
  }
  step.classList.remove('hidden');
  if (subjectLabel) subjectLabel.innerText = subject;

  const { topics, withoutTopic } = groupActiveQuestionsByLearningTopic(state.wrongPool.activeQuestions, licenseClass, subject);
  const visible = pickPriorityLearningTopics(topics); // 기본 3개, 3위와 동률이면 포함, 최대 5개 (전체보기 없음)
  const rows = visible.map((row) => buildTopicButton(row, row.topic === selectedTopic));
  if (visible.length === 0) {
    rows.push(
      noticeLine(
        withoutTopic > 0
          ? '복습할 오답은 있지만 학습영역 정보가 아직 없습니다.'
          : '이 과목에는 지금 복습할 오답이 없습니다.',
      ),
    );
  } else if (withoutTopic > 0) {
    rows.push(noticeLine(`학습영역 정보가 없는 오답 ${withoutTopic}문제는 목록에서 제외했습니다.`));
  }
  list.replaceChildren(...rows);
}

function renderTopicActions() {
  const box = byId('diagnosis-topic-actions');
  const label = byId('diagnosis-selected-topic-label');
  if (!box) return;
  const topic = state.diagnosis.selectedTopic;
  if (!topic) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  if (label) label.innerText = `선택한 학습영역: ${state.diagnosis.selectedSubject} · ${topic}`;
}

function renderDiagnosisMessage() {
  const el = byId('diagnosis-message');
  if (!el) return;
  if (state.diagnosis.message) {
    el.innerText = state.diagnosis.message;
    el.classList.remove('hidden');
  } else {
    el.innerText = '';
    el.classList.add('hidden');
  }
}

export function renderDiagnosisDetail() {
  const panel = byId('diagnosis-detail-panel');
  if (!panel) return;
  const canShow = Boolean(state.profile) && state.wrongPool.loaded && state.diagnosis.expanded;
  if (!canShow) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  const total = state.wrongPool.activeQuestionIds.length;
  const empty = byId('diagnosis-empty-message');
  if (empty) {
    if (total === 0) {
      empty.innerText = '지금은 복습할 오답이 없습니다. 모의고사나 과목별 학습을 먼저 진행해 보세요.';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
    }
  }

  renderLicenseStep();
  renderSubjectStep();
  renderTopicStep();
  renderTopicActions();
  renderDiagnosisMessage();
}

// wrongPool 이 바뀔 때마다(track-c-actions.js 의 applyActive) 이 하나만 부르면 요약+상세가 함께 갱신된다.
export function renderDiagnosis() {
  renderDiagnosisSummary();
  renderDiagnosisDetail();
}
