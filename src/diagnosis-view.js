// "내 학습 진단" 화면 표시 (state -> DOM): 로비의 compact 요약 카드 + 급수->과목->학습영역 상세 패널.
// 상태를 바꾸지 않고 DB 에도 접근하지 않는다. 집계 자체는 utils.js 의 순수 함수(groupActiveQuestionsBy*, pickPriorityReview,
// pickPriorityLearningTopics)가 한다. 학생에게는 learning_topic 이름만 보여주고 concept_tag 원문은 노출하지 않는다.
// 여기서 다루는 데이터는 전부 "지금 active 인 오답"(state.wrongPool.activeQuestions) 뿐이다 - cleared 문제나 정답 이력은 보지 않는다.
// 취약도 점수/이해도%/정답률/등급 같은 표현은 쓰지 않는다: 문제 수와 "우선 복습"만 보여준다.
import { config } from './config.js';
import { state } from './state.js';
import {
  groupActiveQuestionsByLearningTopic,
  groupActiveQuestionsBySubject,
  pickPriorityLearningTopics,
  pickPriorityReview,
} from './utils.js';

const byId = (id) => document.getElementById(id);

const STEP_IDLE =
  'bg-[#0B132B] border border-[#3A506B] hover:border-indigo-500/60 p-3 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200';
const STEP_SELECTED =
  'bg-indigo-950/60 border-2 border-indigo-500 p-3 rounded-xl text-xs font-black text-indigo-300 shadow-md shadow-indigo-500/10 transition-all duration-200';
const STEP_DISABLED =
  'bg-[#0B132B]/40 border border-[#3A506B]/30 p-3 rounded-xl text-xs font-bold text-slate-600 opacity-50 cursor-not-allowed transition-all duration-200';

const ROW_IDLE =
  'w-full flex items-center justify-between bg-[#0B132B] border border-[#3A506B] hover:border-indigo-500/60 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200';
const ROW_SELECTED =
  'w-full flex items-center justify-between bg-indigo-950/60 border-2 border-indigo-500 px-3 py-2 rounded-xl text-xs font-black text-indigo-300 shadow-md shadow-indigo-500/10 transition-all duration-200';

function buildGridButton({ label, disabled, selected, action, value }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = disabled ? STEP_DISABLED : selected ? STEP_SELECTED : STEP_IDLE;
  button.textContent = label;
  if (disabled) button.disabled = true;
  else {
    button.dataset.action = action;
    button.dataset.value = value;
  }
  return button;
}

function buildRowButton({ label, detail, selected, action, value }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = selected ? ROW_SELECTED : ROW_IDLE;
  button.dataset.action = action;
  button.dataset.value = value;
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const detailEl = document.createElement('span');
  detailEl.className = selected ? 'text-indigo-300 font-semibold' : 'text-slate-500 font-semibold';
  detailEl.textContent = detail;
  button.append(labelEl, detailEl);
  return button;
}

function buildTopicButton(row, index, selected) {
  const button = buildRowButton({
    label: `${index + 1}. ${row.topic}`,
    detail: `관련 오답 ${row.count}문제`,
    selected,
    action: 'select-diagnosis-topic',
    value: row.topic,
  });
  return button;
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
export function renderDiagnosisSummary() {
  const card = byId('self-diagnosis-card');
  if (!card) return;
  if (!state.profile || !state.wrongPool.loaded) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const counts = state.wrongPool.countsByLicense ?? {};
  const parts = config.licenseClasses.filter((licenseClass) => (counts[licenseClass] ?? 0) > 0).map((licenseClass) => `${licenseClass} ${counts[licenseClass]}문제`);
  const line = byId('diagnosis-summary-line');
  if (parts.length === 0) {
    line.innerText = '지금은 복습할 오답이 없습니다. 모의고사나 과목별 학습을 먼저 진행해 보세요.';
  } else {
    const best = pickPriorityReview(state.wrongPool.activeQuestions, config.licenseClasses, config.trackASubjects);
    line.innerText = parts.join(' · ') + (best ? ` · 우선 복습: ${best.license} ${best.subject}` : '');
  }

  const toggle = byId('diagnosis-toggle-btn');
  if (toggle) toggle.innerText = state.diagnosis.expanded ? '접기' : '자세히 보기';
}

// ---------------------------------------------------------------------
// 상세 패널: 급수 -> 과목 -> 우선 복습 영역(오답 기록 기준, 기본 3개~최대 5개) -> (선택 시) 두 가지 행동
// ---------------------------------------------------------------------
function renderLicenseStep() {
  const container = byId('diagnosis-license-buttons');
  if (!container) return;
  const counts = state.wrongPool.countsByLicense ?? {};
  container.replaceChildren(
    ...config.licenseClasses.map((licenseClass) =>
      buildGridButton({
        label: `${licenseClass} · ${counts[licenseClass] ?? 0}문제`,
        disabled: !((counts[licenseClass] ?? 0) > 0),
        selected: licenseClass === state.diagnosis.selectedLicenseClass,
        action: 'select-diagnosis-license',
        value: licenseClass,
      }),
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
      buildRowButton({
        label: row.subject,
        detail: `복습할 문제 ${row.count}`,
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
  const rows = visible.map((row, index) => buildTopicButton(row, index, row.topic === selectedTopic));
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
