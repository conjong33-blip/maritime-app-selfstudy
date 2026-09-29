// Track C(오답소탕): 학생의 active 오답만 다시 풀고, 정답을 맞히면 그 오답을 정리(clearWrong)한다.
// 풀이 방식은 Track B 와 같다 (오답이면 recordWrong + 틀린 보기 제거 후 재도전, 정답이면 BASE 해설 + HELPER 공개).
// 그 채점/오답 기록은 track-b-actions.js 의 checkTrackBAnswer 를 함께 쓰고, 이 파일은 그 외의 Track C 고유 흐름을 맡는다:
//   - active 오답 목록(getActiveWrongs) + 그 문제 데이터(fetchQuestionsByIds) 확인, 로비의 남은 오답 수/급수별 개수 갱신
//   - 급수(3급/4급) 선택: DB schema 는 그대로 두고 조회한 문제의 license_class 로 화면에서만 나눈다 (selfstudy_wrong_questions 는 급수를 모른다)
//   - 시작: 선택한 급수의 active 오답만 -> 문제를 오답 목록의 순서대로 불러와 풀이 화면으로
//   - 정답 후 clearWrong (실패하면 정답/해설은 그대로 두고 "소탕 완료"로 확정하지 않으며, 실패한 문제만 다시 시도)
//   - 마지막 문제를 정리한 뒤 DB 의 active 오답을 다시 읽어 완료 여부 판단 (로컬 배열만 보고 완료 처리하지 않는다).
//     선택한 급수만 0 이 되고 다른 급수가 남아 있으면 "그 급수만 완료"로 표시하고, 전체가 0 일 때만 "오답소탕 완료"로 본다.
// 세션(최근 학습 위치)은 저장하지 않는다: Track C 는 급수/과목/회차가 섞인 "지금 남은 오답"이고 학생당 세션은 1개라서
// 저장하면 Track A/B 이어하기를 덮어쓴다. 다시 들어오면 그때의 active 오답으로 새로 계산한다 (급수 선택도 저장하지 않는다).
import { config } from './config.js';
import { state, getCurrentQuestion, resetQuizState } from './state.js';
import { clearWrong, getActiveWrongs } from './data/selfstudy.js';
import { fetchQuestionsByIds } from './data/questions.js';
import { fetchLearningTopicsByQuestionIds } from './data/question-topics.js';
import { ensureProfile, readIdentity, validateIdentity } from './profile.js';
import { deselectTrackCIfEmpty, renderTrackCLobby } from './lobby-actions.js';
import { renderCurrentQuestion, renderQuestionStatus } from './quiz-renderer.js';
import { renderDiagnosis } from './diagnosis-view.js';
import { trackWrite, whenWritesIdle } from './pending-writes.js';
import {
  clearStartMessage,
  hideConnectionError,
  showConnectionError,
  showQuiz,
  showQuizMessage,
  showStartMessage,
} from './view.js';

const NO_ACTIVE_MESSAGE = '현재 소탕할 오답이 없습니다. 모의고사나 과목별 학습을 먼저 진행해 주세요.';
const MISSING_MESSAGE =
  '오답 목록의 일부 문제를 불러오지 못해 오답소탕을 시작할 수 없습니다. 오답 기록은 그대로 유지됩니다. 잠시 후 다시 시도해 주세요.';
const SELECT_LICENSE_MESSAGE = '오답소탕을 시작할 급수를 선택해 주세요.';
// 조회한 문제의 license_class 가 비어 있거나 예상 밖 값이어도 조용히 세지 않고 이 이름으로 따로 센다 (무시하지 않는다).
export const UNKNOWN_LICENSE = '미확인';

// ---------------------------------------------------------------------
// active 오답 + 문제 데이터
// ---------------------------------------------------------------------
// selfstudy_question_topics 매핑 조회는 절대 Track A/B/C 의 핵심 흐름(active 오답 읽기)을 막지 못하게 한다 - 실패하면
// (네트워크 오류 등) 빈 Map 을 돌려주고 console.warn 만 남긴다. "내 학습 진단"은 이 경우 전부 미분류로 보이지만
// 오답소탕/오답 기록 자체는 아무 영향을 받지 않는다. concept_tag 로의 fallback 은 하지 않는다.
async function loadTopicsMapSafely(ids) {
  try {
    const rows = await fetchLearningTopicsByQuestionIds(ids);
    return new Map(rows.map((row) => [row.questionId, row.learningTopic]));
  } catch (error) {
    console.warn('learning_topic 매핑 조회 실패 - 이번 새로고침은 전부 미분류로 표시합니다:', error);
    return new Map();
  }
}

// active 오답과 그 문제 행을 함께 읽는다. active 가 없으면 바로 끝낸다. 문제 조회 실패(누락)는 questions[i] 가 undefined 로 남는다.
// 각 문제 행에는 learningTopic 을 함께 채워 둔다(매핑이 없으면 null - "내 학습 진단" 집계에서만 제외되고 다른 곳에는 영향 없음).
async function loadActiveWithQuestions(profileKey) {
  const active = await getActiveWrongs(profileKey);
  if (active.length === 0) return { active, questions: [] };
  const ids = active.map((item) => item.questionId);
  const [rows, topicsByQuestionId] = await Promise.all([fetchQuestionsByIds(ids), loadTopicsMapSafely(ids)]);
  const byId = new Map(rows.map((row) => [row.id, { ...row, learningTopic: topicsByQuestionId.get(row.id) ?? null }]));
  const questions = active.map((item) => byId.get(item.questionId));
  const unmapped = questions.filter((question) => question && !question.learningTopic).length;
  if (unmapped > 0) console.warn(`active 오답 ${unmapped}건에 learning_topic 매핑이 없습니다 (진단 집계에서 제외됩니다).`);
  return { active, questions };
}

// 실제로 Track C 를 "시작"할 때만 쓴다: 문제 하나라도 조회에 실패하면 missing 으로 막는다 (일부만 조용히 진행하지 않는다).
async function loadActiveSet(profileKey) {
  const { active, questions } = await loadActiveWithQuestions(profileKey);
  if (active.length === 0) return { active, questions: [] };
  if (questions.some((question) => !question)) return { active, missing: true };
  return { active, questions };
}

// 문제 목록에서 급수별 개수를 센다. license_class 가 없거나 문제 조회에 실패한 항목은 UNKNOWN_LICENSE 로 센다.
function countsByLicenseOf(questions) {
  const counts = {};
  for (const question of questions) {
    const key = question && typeof question.license_class === 'string' && question.license_class.trim() ? question.license_class : UNKNOWN_LICENSE;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------
// 로비 표시 갱신 (state.wrongPool)
// ---------------------------------------------------------------------
// 이 프로필의 진단 화면 선택(급수/과목/학습영역)을 지운다. 다른 프로필로 바뀌었을 때만 부른다.
function resetDiagnosisSelectionFor(profileKey) {
  state.diagnosis = {
    profileKey,
    expanded: false,
    selectedLicenseClass: null,
    selectedSubject: null,
    selectedTopic: null,
    message: '',
  };
}

// active 오답 + 문제 데이터를 state.wrongPool 에 반영하고 화면(카드/급수 버튼/진단 패널)을 다시 그린다.
//  - 선택돼 있던 급수가 이번 개수 집계에서 0 이 되면 선택을 지운다.
//  - 남은 오답이 정확히 한 급수에만 있으면 자동으로 그 급수를 선택한다 - 단, 이 학생이 이번 로그인에서
//    아직 Track C 회차를 한 번도 끝내지 않았을 때만(autoSelectAllowed). 오답소탕을 한 번 마친 뒤에는
//    (급수가 남아 있어도) 다시 자동으로 고르지 않는다: 학생이 매번 직접 골라야 한다 (finishTrackC 가 끈다).
//    이 값은 프로필이 바뀌기 전까지 state.wrongPool 에 그대로 이어진다.
//  - 다른 프로필의 데이터로 바뀌면 진단 화면 선택도 함께 초기화한다.
//  - afterOwnRun: 오답소탕(또는 진단의 "내가 틀린 문제 다시풀기") 한 회차를 막 끝낸 뒤의 새로고침이면,
//    방금 다루던 학습영역 선택도 지운다 (다시 최신 우선 복습 영역을 보고 학생이 직접 고르게 한다).
function applyActive(profileKey, active, questions, { afterOwnRun = false } = {}) {
  if (state.diagnosis.profileKey !== profileKey) resetDiagnosisSelectionFor(profileKey);
  else if (afterOwnRun) state.diagnosis.selectedTopic = null;

  const countsByLicense = countsByLicenseOf(questions);
  const previous = state.wrongPool.selectedLicenseClass;
  let selectedLicenseClass = previous && (countsByLicense[previous] ?? 0) > 0 ? previous : null;
  const autoSelectAllowed = afterOwnRun ? false : state.wrongPool.autoSelectAllowed !== false;
  if (autoSelectAllowed && !selectedLicenseClass) {
    const withCount = config.licenseClasses.filter((licenseClass) => (countsByLicense[licenseClass] ?? 0) > 0);
    if (withCount.length === 1) selectedLicenseClass = withCount[0];
  }
  const activeQuestions = active.map((item, index) => ({ ...(questions[index] ?? {}), wrongCount: item.wrongCount }));
  state.wrongPool = {
    activeQuestionIds: active.map((item) => item.questionId),
    activeQuestions,
    countsByLicense,
    selectedLicenseClass,
    profileKey,
    loaded: true,
    autoSelectAllowed,
  };
  deselectTrackCIfEmpty();
  renderTrackCLobby();
  renderDiagnosis();
}

// 프로필을 모르는 상태(입력 변경 등)로 되돌린다. 이전 학생의 오답 수/급수 선택/진단 선택이 남지 않게 하고,
// 새 학생(또는 같은 학생의 다음 로그인)에게 급수 자동 선택을 다시 허용한다.
// keepTrack: 오답소탕을 시작하는 중이라 이 학생의 오답을 곧 다시 읽을 때는 Track C 선택을 풀지 않는다.
export function resetActiveWrongs({ keepTrack = false } = {}) {
  refreshRequestId += 1;
  state.wrongPool = { activeQuestionIds: [], activeQuestions: [], countsByLicense: {}, selectedLicenseClass: null, profileKey: null, loaded: false, autoSelectAllowed: true };
  state.trackCStage = 'full';
  resetDiagnosisSelectionFor(null);
  if (!keepTrack) deselectTrackCIfEmpty();
  renderTrackCLobby();
  renderDiagnosis();
}

let refreshRequestId = 0;

// DB 의 active 오답(+ 급수별 개수)을 다시 읽어 로비 표시를 갱신한다. 방금 보낸 오답 기록/정리가 끝난 뒤에 읽는다.
// 프로필이 없으면 아무것도 하지 않는다.
export async function refreshActiveWrongs() {
  const profileKey = state.profile?.profileKey;
  if (!profileKey) return;
  const requestId = ++refreshRequestId;
  await whenWritesIdle();
  try {
    const { active, questions } = await loadActiveWithQuestions(profileKey);
    if (requestId !== refreshRequestId || state.profile?.profileKey !== profileKey) return;
    applyActive(profileKey, active, questions);
  } catch (error) {
    if (requestId !== refreshRequestId) return;
    showConnectionError(error);
  }
}

// ---------------------------------------------------------------------
// 급수 선택 (Track C 필터 영역)
// ---------------------------------------------------------------------
// 급수 버튼 클릭. 개수가 0 인 급수는 선택할 수 없다 (버튼 자체도 비활성으로 그려진다 - track-c-view.js).
export function selectTrackCLicense(value) {
  if (state.currentTrack !== 'C') return;
  const count = state.wrongPool.countsByLicense[value] ?? 0;
  if (count === 0) return;
  state.wrongPool.selectedLicenseClass = value;
  renderTrackCLobby();
}

// ---------------------------------------------------------------------
// 상단 탭: 한번에 소탕하기('full') / 나누어 소탕하기('byTopic'). 별도 중간 화면 없이 같은 오답소탕 영역 안에서
// 콘텐츠만 즉시 바뀐다. "나누어 소탕하기"는 "내 학습 진단"이 쓰던 진단 집계/선택 로직(diagnosis-actions.js,
// utils.js)을 전혀 바꾸지 않고 그대로 재사용한다 - state.diagnosis.expanded 를 켜고 끄는 것만 이 함수가 한다.
// ---------------------------------------------------------------------
export function selectTrackCMode(mode) {
  if (state.currentTrack !== 'C' || (mode !== 'full' && mode !== 'byTopic')) return;
  if (state.trackCStage === mode) return;
  state.trackCStage = mode;
  state.diagnosis.expanded = mode === 'byTopic'; // diagnosis-view.js 의 렌더 조건을 그대로 재사용한다
  if (mode === 'byTopic') {
    // 급수 선택은 유지한다(같은 급수를 보던 중 탭만 바꾼 것이므로 자연스럽다) - 단 과목/학습영역 선택은 지운다.
    // 지우지 않으면 이전에 고른 과목/학습영역이 남아 있어 "급수만 골랐는데 과목+학습영역까지 한꺼번에" 나타나 보인다.
    state.diagnosis.selectedSubject = null;
    state.diagnosis.selectedTopic = null;
    state.diagnosis.message = '';
  }
  clearStartMessage(); // 예: "급수를 선택해 주세요" 안내가 탭을 바꿔도 남아있지 않게
  renderTrackCLobby();
  renderDiagnosis();
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
// diagnosisContext: 내 학습 진단의 "내가 틀린 문제 다시풀기"로 들어온 회차만 { subject, topic } (완료 문구용, 선택).
function enterTrackC(profile, questions, licenseClass, diagnosisContext = null) {
  resetQuizState(); // origin 은 비워 둔다 (세션 저장 없음)
  state.currentTrack = 'C'; // 진단의 "내가 틀린 문제 다시풀기"는 로비의 Track C 카드를 거치지 않고 바로 들어오므로 여기서 확정한다
  state.quiz.questions = questions;
  state.quiz.currentIndex = 0;
  state.quiz.licenseClass = licenseClass; // 이번 오답소탕 회차가 어느 급수인지 (완료 안내 문구에 쓴다)
  state.quiz.diagnosisContext = diagnosisContext;
  showQuiz(`${profile.studentNo} (${profile.studentName})`);
  renderCurrentQuestion();
}

const isSameInput = (identity) => {
  const now = readIdentity();
  return state.view === 'lobby' && state.currentTrack === 'C' && now.studentNo === identity.studentNo && now.studentName === identity.studentName;
};

// 로비에서 Track C 시작. 로딩 표시/중복 시작 방지는 호출하는 exam-actions.startSelectedExam 이 맡는다.
export async function startTrackC() {
  const identity = readIdentity();
  const message = validateIdentity(identity);
  if (message) {
    showStartMessage(message);
    return;
  }
  try {
    const profile = await ensureProfile(identity);
    if (!isSameInput(identity)) return;
    if (state.profile?.profileKey !== profile.profileKey) {
      state.session = null;
      resetActiveWrongs({ keepTrack: true });
    }
    state.profile = profile;
    await whenWritesIdle();
    const set = await loadActiveSet(profile.profileKey);
    if (!isSameInput(identity)) return;
    hideConnectionError();
    applyActive(profile.profileKey, set.active, set.missing ? [] : set.questions);
    if (set.active.length === 0) {
      showStartMessage(NO_ACTIVE_MESSAGE);
      return;
    }
    if (set.missing) {
      showStartMessage(MISSING_MESSAGE);
      return;
    }
    const licenseClass = state.wrongPool.selectedLicenseClass;
    if (!licenseClass) {
      showStartMessage(SELECT_LICENSE_MESSAGE);
      return;
    }
    // 선택한 급수 문제만, active 목록(첫 오답 시각순) 순서 그대로 남긴다. 다른 급수 문제는 이 회차에 포함하지 않는다
    // (그 오답 row 는 DB 에서 건드리지 않는다).
    const filtered = set.questions.filter((question) => question.license_class === licenseClass);
    if (filtered.length === 0) {
      showStartMessage(NO_ACTIVE_MESSAGE); // 선택 직후 그 사이 0 이 된 경우의 방어
      return;
    }
    clearStartMessage();
    enterTrackC(profile, filtered, licenseClass);
  } catch (error) {
    if (!isSameInput(identity)) return;
    showConnectionError(error);
  }
}

// 내 학습 진단의 "내가 틀린 문제 다시풀기": license_class + subject + learning_topic 이 모두 일치하는
// active 오답만으로 Track C 를 시작한다. 일반 오답소탕(급수만 거름)과 완전히 같은 엔진(clearWrong, 완료 재조회)을
// 그대로 쓰고, 다른 급수/과목/학습영역의 오답은 이 회차에 포함하지 않는다(그 오답 row 는 건드리지 않는다).
// 학번/이름·프로필 확인은 로비에서 진단 패널이 보이는 시점에 이미 끝나 있어야 한다(diagnosis-actions.js 가 호출 전 확인한다).
// 반환값: { ok: true } 또는 { ok: false, message } (호출한 쪽이 진단 패널 안에 표시한다).
export async function startDiagnosisRetry({ licenseClass, subject, learningTopic }) {
  const profile = state.profile;
  if (!profile) return { ok: false, message: '학번/이름을 먼저 확인해 주세요.' };
  try {
    await whenWritesIdle();
    const set = await loadActiveSet(profile.profileKey);
    applyActive(profile.profileKey, set.active, set.missing ? [] : set.questions);
    if (set.missing) return { ok: false, message: MISSING_MESSAGE };
    const filtered = set.questions.filter(
      (question) =>
        question.license_class === licenseClass && question.subject === subject && question.learningTopic === learningTopic,
    );
    if (filtered.length === 0) return { ok: false, message: '선택한 학습영역의 오답이 더 이상 없습니다. 진단을 다시 확인해 주세요.' };
    enterTrackC(profile, filtered, licenseClass, { subject, topic: learningTopic });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `오답 목록을 불러오지 못했습니다. (${error.message})` };
  }
}

// ---------------------------------------------------------------------
// 정답 후 정리 (clearWrong)
// ---------------------------------------------------------------------
function redrawCurrent() {
  const question = getCurrentQuestion();
  if (question) renderQuestionStatus(question);
}

// 정답을 맞힌 문제의 오답을 정리한다. 성공해야 그 문제가 "소탕 완료"가 되고 다음 문제로 넘어갈 수 있다.
// clearWrong 은 이미 정리된 문제에도 오류 없이 false 를 돌려주므로(멱등) 오류 없이 끝나면 정리된 것으로 본다.
// 진행 중이거나 이미 끝난 문제는 다시 보내지 않는다 (실패한 문제만 다시 시도할 수 있다).
export async function clearSolvedWrong(question) {
  const quiz = state.quiz;
  const id = question.id;
  if (quiz.clearStatus[id] === 'pending' || quiz.clearStatus[id] === 'done') return;
  const profileKey = state.profile?.profileKey;
  if (!profileKey) {
    quiz.clearStatus[id] = 'failed';
    redrawCurrent();
    return;
  }
  quiz.clearStatus[id] = 'pending';
  redrawCurrent();
  try {
    await trackWrite(clearWrong(profileKey, id));
    if (state.wrongPool.profileKey === profileKey) {
      // 로비 카드/급수 개수/진단을 다음 전체 새로고침 전에도 즉시 맞춰 둔다 (방금 정리한 문제 하나만 뺀다).
      state.wrongPool.activeQuestionIds = state.wrongPool.activeQuestionIds.filter((activeId) => activeId !== id);
      state.wrongPool.activeQuestions = state.wrongPool.activeQuestions.filter((activeQuestion) => activeQuestion.id !== id);
      const license = question.license_class;
      const key = typeof license === 'string' && license.trim() ? license : UNKNOWN_LICENSE;
      if ((state.wrongPool.countsByLicense[key] ?? 0) > 0) state.wrongPool.countsByLicense[key] -= 1;
      renderTrackCLobby();
      renderDiagnosis();
    }
    if (state.quiz !== quiz) return; // 그 사이 로비로 나갔다 (DB 정리는 끝났다)
    quiz.clearStatus[id] = 'done';
  } catch (error) {
    if (state.quiz !== quiz) return;
    quiz.clearStatus[id] = 'failed';
    console.warn('clearWrong failed:', error);
  }
  redrawCurrent();
}

// "다시 저장": 정리에 실패한 지금 문제만 다시 보낸다.
export function retryClearWrong() {
  const question = getCurrentQuestion();
  if (!question || state.currentTrack !== 'C') return;
  if (state.quiz.clearStatus[question.id] !== 'failed' || !state.quiz.graded[question.id]) return;
  return clearSolvedWrong(question);
}

// ---------------------------------------------------------------------
// 마무리
// ---------------------------------------------------------------------
let isFinishing = false;

// licenseClass 급수 기준으로 완료 상태를 계산한다.
//  - remainingInClass: 이번에 풀던 급수에 아직 남은 active 오답 수 (정상적으로 다 풀었으면 0)
//  - remainingTotal: 전체(모든 급수) active 오답 수
//  - diagnosisContext 가 있으면(진단에서 들어온 회차) remainingInTopic 도 함께 계산해 완료 문구에 학습영역 이름을 쓸 수 있게 한다.
//    이 값은 표시용일 뿐이고, 완료/재시작 버튼을 고르는 기준은 그대로 licenseClass 기준(remainingInClass/remainingTotal)이다.
function computeCompletion(licenseClass, questions, diagnosisContext = null) {
  const counts = countsByLicenseOf(questions);
  const completion = { licenseClass, remainingInClass: counts[licenseClass] ?? 0, remainingTotal: questions.length };
  if (diagnosisContext) {
    completion.diagnosisContext = diagnosisContext;
    completion.remainingInTopic = questions.filter(
      (question) =>
        question.license_class === licenseClass &&
        question.subject === diagnosisContext.subject &&
        question.learningTopic === diagnosisContext.topic,
    ).length;
  }
  return completion;
}

// 마지막 문제까지 모두 정리한 뒤: DB 의 active 오답을 다시 읽어서 이번 급수와 전체가 정말 몇 개 남았는지 확인한다.
// 이번 급수만 0 이고 다른 급수가 남아 있으면 "이 급수는 완료" 로, 전체가 0 일 때만 "오답소탕 완료" 로 본다 (로컬 배열만 보고 판단하지 않는다).
export async function finishTrackC() {
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || isFinishing) return;
  const quiz = state.quiz;
  if (quiz.questions.length === 0 || !quiz.questions.every((question) => quiz.clearStatus[question.id] === 'done')) return;
  const profileKey = state.profile?.profileKey;
  if (!profileKey) return;
  const licenseClass = quiz.licenseClass;
  const diagnosisContext = quiz.diagnosisContext;
  isFinishing = true;
  try {
    await whenWritesIdle();
    const { active, questions } = await loadActiveWithQuestions(profileKey);
    if (state.quiz !== quiz) return;
    applyActive(profileKey, active, questions, { afterOwnRun: true });
    quiz.completion = computeCompletion(licenseClass, questions, diagnosisContext);
  } catch (error) {
    if (state.quiz !== quiz) return;
    console.warn('active wrongs refresh failed:', error);
    quiz.completion = { error: true };
  } finally {
    isFinishing = false;
  }
  redrawCurrent();
}

// 마무리 후에도 지금 급수에 오답이 남아 있을 때: 같은 급수의 지금 active 오답으로 다시 시작한다.
// (다른 급수로 자동 전환하지 않는다 - 학생이 로비/완료 화면에서 직접 다른 급수를 선택해야 한다.)
export async function restartTrackC() {
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || isFinishing) return;
  const quiz = state.quiz;
  const profile = state.profile;
  const licenseClass = quiz.licenseClass;
  if (!profile || !licenseClass) return;
  isFinishing = true;
  try {
    await whenWritesIdle();
    const set = await loadActiveSet(profile.profileKey);
    if (state.quiz !== quiz) return;
    if (set.missing) {
      applyActive(profile.profileKey, set.active, []);
      showQuizMessage(MISSING_MESSAGE, 'error');
      return;
    }
    applyActive(profile.profileKey, set.active, set.questions);
    const filtered = set.questions.filter((question) => question.license_class === licenseClass);
    if (filtered.length === 0) {
      quiz.completion = computeCompletion(licenseClass, set.questions);
      redrawCurrent();
      return;
    }
    enterTrackC(profile, filtered, licenseClass);
  } catch (error) {
    if (state.quiz !== quiz) return;
    showQuizMessage(`오답 목록을 불러오지 못했습니다. (${error.message})`, 'error');
  } finally {
    isFinishing = false;
  }
}
