// Track C(오답소탕) 화면 표시 (state -> DOM): 로비의 급수 선택 버튼, 풀이 화면의 진행/정리 실패/완료 안내.
// 로비의 "내 학습 진단" 요약/상세 카드는 diagnosis-view.js 가 맡는다(이전에는 이 파일의 자가진단 카드였다).
// 상태를 바꾸지 않고 DB 에도 접근하지 않는다. 문제 본문/보기/해설은 공용 quiz-renderer.js 가 그린다.
import { config } from './config.js';
import { state } from './state.js';

const byId = (id) => document.getElementById(id);
const setHidden = (id, hidden) => byId(id)?.classList.toggle('hidden', hidden);

// ---------------------------------------------------------------------
// 급수 선택 버튼 (로비 필터 영역, Track C 카드를 골랐을 때만 보인다)
// ---------------------------------------------------------------------
const LICENSE_IDLE =
  'bg-[#0B132B] border border-[#3A506B] hover:border-rose-500/60 p-3 rounded-xl text-xs font-bold text-slate-300 transition-all duration-200';
const LICENSE_SELECTED =
  'bg-rose-950/60 border-2 border-rose-500 p-3 rounded-xl text-xs font-black text-rose-300 shadow-md shadow-rose-500/10 transition-all duration-200';
const LICENSE_DISABLED =
  'bg-[#0B132B]/40 border border-[#3A506B]/30 p-3 rounded-xl text-xs font-bold text-slate-600 opacity-50 cursor-not-allowed transition-all duration-200';

// 표시 순서: 앱이 아는 급수(config.licenseClasses)를 먼저, 그 외 값(예상 밖 license_class)은 뒤에 그대로 보여 준다(무시하지 않는다).
function licenseEntries() {
  const counts = state.wrongPool.countsByLicense ?? {};
  const known = config.licenseClasses.map((licenseClass) => [licenseClass, counts[licenseClass] ?? 0]);
  const extraKeys = Object.keys(counts)
    .filter((key) => !config.licenseClasses.includes(key))
    .sort();
  return [...known, ...extraKeys.map((key) => [key, counts[key]])];
}

function buildLicenseButton(licenseClass, count, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  const disabled = count === 0;
  button.className = disabled ? LICENSE_DISABLED : selected ? LICENSE_SELECTED : LICENSE_IDLE;
  button.textContent = `${licenseClass} · 오답 ${count}문제`;
  if (disabled) {
    button.disabled = true;
  } else {
    button.dataset.action = 'select-track-c-license';
    button.dataset.value = licenseClass;
  }
  return button;
}

// ---------------------------------------------------------------------
// 상단 탭 (한번에 소탕하기 / 나누어 소탕하기) - 별도 화면 전환 없이 이 값 하나(state.trackCStage)로
// 아래 콘텐츠(급수 버튼 <-> diagnosis-view.js 의 급수/과목/학습영역 패널)와 하단 메인 CTA 표시를 바꾼다.
// ---------------------------------------------------------------------
// rose accent 는 유지하되 탭에서까지 강한 full-fill(bg-rose-600)을 반복하지 않는다 - 절제된 반투명 dark rose.
// hover 는 다른 선택 UI(급수/과목 카드)와 같은 패턴: border/text 한 단계 밝아지고 아주 약한 배경 변화만 준다.
const TAB_ACTIVE =
  'px-3 py-1.5 rounded-md text-[11px] font-bold border border-rose-500/70 bg-rose-950/40 text-rose-200 transition-all duration-200';
const TAB_IDLE =
  'px-3 py-1.5 rounded-md text-[11px] font-bold border border-transparent text-slate-400 hover:border-rose-400/60 hover:text-rose-200 hover:bg-rose-950/10 transition-all duration-200';

function renderTrackCTabs() {
  const stage = state.trackCStage;
  const full = byId('track-c-tab-full');
  const byTopic = byId('track-c-tab-bytopic');
  if (full) full.className = stage === 'full' ? TAB_ACTIVE : TAB_IDLE;
  if (byTopic) byTopic.className = stage === 'byTopic' ? TAB_ACTIVE : TAB_IDLE;
}

// Track C 를 고르지 않았으면 아무것도 하지 않는다 (보이고 숨기는 것은 로비의 공통 트랙 옵션 토글이 담당한다).
export function renderTrackCFilter() {
  const buttons = byId('track-c-license-buttons');
  const hint = byId('track-c-license-hint');
  if (!buttons || !hint) return;
  if (state.currentTrack !== 'C') return;
  const entries = licenseEntries();
  buttons.replaceChildren(...entries.map(([licenseClass, count]) => buildLicenseButton(licenseClass, count, licenseClass === state.wrongPool.selectedLicenseClass)));
  hint.innerText = state.wrongPool.selectedLicenseClass ? '' : '오답소탕할 급수를 선택해 주세요.';

  renderTrackCTabs();
  const stage = state.trackCStage;
  setHidden('track-c-license-step', stage !== 'full'); // "한번에 소탕하기": 급수 버튼만
  // "나누어 소탕하기"(diagnosis-detail-panel)의 보임/숨김은 diagnosis-view.js 의 renderDiagnosisDetail 이
  // state.diagnosis.expanded 를 보고 스스로 정한다 - 여기서 별도로 건드리지 않는다.
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

// 풀이 화면 안내: 진행 상황(시험 점수 없음, 지금 급수 표시), 정리(clearWrong) 진행/실패, 마무리 결과.
// Track C 가 아니면 숨긴다.
export function renderTrackCStatus() {
  const panel = byId('track-c-panel');
  if (!panel) return;
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || state.quiz.questions.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const { questions, clearStatus, currentIndex, completion, licenseClass } = state.quiz;
  const total = questions.length;
  const solved = questions.filter((question) => clearStatus[question.id] === 'done').length;
  const prefix = licenseClass ? `${licenseClass} 오답소탕 · ` : '';
  byId('track-c-progress').innerText = `${prefix}남은 오답 ${total - solved}문제 · 해결 ${solved} / ${total}`;

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
  // 진단의 "내가 틀린 문제 다시풀기"로 들어온 회차이고, 그 학습영역의 오답을 정말 다 풀었으면 문구에 학습영역 이름을 더해 준다.
  // 완료/재시작 버튼을 고르는 기준(remainingTotal/remainingInClass, 급수 전체)은 그대로 두고 문구만 바꾼다.
  const topicDone = Boolean(completion.diagnosisContext) && completion.remainingInTopic === 0;
  const topicLabel = completion.diagnosisContext?.topic;
  if (completion.error) {
    text.textContent = '남은 오답 수를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
    buttons.append(actionButton('finish-track-c', '다시 확인', true), actionButton('logout-to-lobby', '대기실로', false));
  } else if (completion.remainingTotal === 0) {
    // 모든 급수를 통틀어 active 오답이 0 일 때만 "전체 완료" 로 본다.
    text.textContent = topicDone
      ? `${topicLabel} 틀린 문제 복습 완료! 오답소탕도 모두 끝났습니다. ⚓`
      : '오답소탕 완료! 소탕할 오답이 더 이상 남아 있지 않습니다. ⚓';
    buttons.append(actionButton('logout-to-lobby', '대기실로 돌아가기', true));
  } else if (completion.remainingInClass === 0) {
    // 이번에 풀던 급수만 완료. 다른 급수가 남아 있어도 "전체 완료"라고 하지 않는다.
    text.textContent = topicDone
      ? `${topicLabel} 틀린 문제 복습 완료! (다른 급수에 아직 ${completion.remainingTotal}개 남았습니다)`
      : `${completion.licenseClass} 오답소탕 완료! (다른 급수에 아직 ${completion.remainingTotal}개 남았습니다)`;
    buttons.append(actionButton('logout-to-lobby', '대기실로 돌아가기', true));
  } else {
    text.textContent = topicDone
      ? `${topicLabel} 틀린 문제 복습 완료! (${completion.licenseClass}에 다른 오답 ${completion.remainingInClass}개 남았습니다)`
      : `${completion.licenseClass} 오답소탕: 아직 ${completion.remainingInClass}개 남아 있습니다.`;
    buttons.append(actionButton('restart-track-c', '남은 오답 다시 소탕하기', true), actionButton('logout-to-lobby', '대기실로', false));
  }
  box.replaceChildren(text, buttons);
  box.classList.remove('hidden');
}
