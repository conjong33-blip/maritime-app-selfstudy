// Track C(오답소탕): 학생의 active 오답만 다시 풀고, 정답을 맞히면 그 오답을 정리(clearWrong)한다.
// 풀이 방식은 Track B 와 같다 (오답이면 recordWrong + 틀린 보기 제거 후 재도전, 정답이면 BASE 해설 + HELPER 공개).
// 그 채점/오답 기록은 track-b-actions.js 의 checkTrackBAnswer 를 함께 쓰고, 이 파일은 그 외의 Track C 고유 흐름을 맡는다:
//   - active 오답 목록(getActiveWrongs) 확인, 로비의 남은 오답 수/카드 갱신
//   - 시작: active 오답 -> 문제(fetchQuestionsByIds) 를 오답 목록의 순서대로 불러와 풀이 화면으로
//   - 정답 후 clearWrong (실패하면 정답/해설은 그대로 두고 "소탕 완료"로 확정하지 않으며, 실패한 문제만 다시 시도)
//   - 마지막 문제를 정리한 뒤 DB 의 active 오답을 다시 읽어 완료 여부 판단 (로컬 배열만 보고 완료 처리하지 않는다)
// 세션(최근 학습 위치)은 저장하지 않는다: Track C 는 급수/과목/회차가 섞인 "지금 남은 오답"이고 학생당 세션은 1개라서
// 저장하면 Track A/B 이어하기를 덮어쓴다. 다시 들어오면 그때의 active 오답으로 새로 시작한다.
import { state, getCurrentQuestion, resetQuizState } from './state.js';
import { clearWrong, getActiveWrongs } from './data/selfstudy.js';
import { fetchQuestionsByIds } from './data/questions.js';
import { ensureProfile, readIdentity, validateIdentity } from './profile.js';
import { deselectTrackCIfEmpty, renderTrackCCard } from './lobby-actions.js';
import { renderCurrentQuestion, renderQuestionStatus } from './quiz-renderer.js';
import { renderActiveWrongSummary } from './track-c-view.js';
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

// ---------------------------------------------------------------------
// 남은(active) 오답 수: 로비 카드/진단 카드용 화면 사본 (영구 기록은 DB)
// ---------------------------------------------------------------------
function applyActive(profileKey, active) {
  state.wrongPool = { activeQuestionIds: active.map((item) => item.questionId), profileKey, loaded: true };
  deselectTrackCIfEmpty();
  renderTrackCCard();
  renderActiveWrongSummary();
}

// 프로필을 모르는 상태(입력 변경 등)로 되돌린다. 이전 학생의 오답 수가 남지 않게 한다.
// keepTrack: 오답소탕을 시작하는 중이라 이 학생의 오답을 곧 다시 읽을 때는 Track C 선택을 풀지 않는다.
export function resetActiveWrongs({ keepTrack = false } = {}) {
  refreshRequestId += 1;
  state.wrongPool = { activeQuestionIds: [], profileKey: null, loaded: false };
  if (!keepTrack) deselectTrackCIfEmpty();
  renderTrackCCard();
  renderActiveWrongSummary();
}

let refreshRequestId = 0;

// DB 의 active 오답을 다시 읽어 로비 표시를 갱신한다. 방금 보낸 오답 기록/정리가 끝난 뒤에 읽는다. 프로필이 없으면 아무것도 하지 않는다.
export async function refreshActiveWrongs() {
  const profileKey = state.profile?.profileKey;
  if (!profileKey) return;
  const requestId = ++refreshRequestId;
  await whenWritesIdle();
  try {
    const active = await getActiveWrongs(profileKey);
    if (requestId !== refreshRequestId || state.profile?.profileKey !== profileKey) return;
    applyActive(profileKey, active);
  } catch (error) {
    if (requestId !== refreshRequestId) return;
    showConnectionError(error);
  }
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
// active 오답 목록 + 그 문제들. 문제는 오답 목록의 순서(RPC: 처음 틀린 순)대로 정렬하고, 하나라도 빠지면 missing.
async function loadActiveSet(profileKey) {
  const active = await getActiveWrongs(profileKey);
  if (active.length === 0) return { active, questions: [] };
  const rows = await fetchQuestionsByIds(active.map((item) => item.questionId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const questions = active.map((item) => byId.get(item.questionId));
  if (questions.some((question) => !question)) return { active, missing: true };
  return { active, questions };
}

function enterTrackC(profile, questions) {
  resetQuizState(); // origin 은 비워 둔다 (세션 저장 없음)
  state.quiz.questions = questions;
  state.quiz.currentIndex = 0;
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
    applyActive(profile.profileKey, set.active);
    if (set.active.length === 0) {
      showStartMessage(NO_ACTIVE_MESSAGE);
      return;
    }
    if (set.missing) {
      showStartMessage(MISSING_MESSAGE);
      return;
    }
    clearStartMessage();
    enterTrackC(profile, set.questions);
  } catch (error) {
    if (!isSameInput(identity)) return;
    showConnectionError(error);
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
      state.wrongPool.activeQuestionIds = state.wrongPool.activeQuestionIds.filter((activeId) => activeId !== id);
      renderTrackCCard();
      renderActiveWrongSummary();
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

// 마지막 문제까지 모두 정리한 뒤: DB 의 active 오답을 다시 읽어서 정말 0개인지 확인한다.
export async function finishTrackC() {
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || isFinishing) return;
  const quiz = state.quiz;
  if (quiz.questions.length === 0 || !quiz.questions.every((question) => quiz.clearStatus[question.id] === 'done')) return;
  const profileKey = state.profile?.profileKey;
  if (!profileKey) return;
  isFinishing = true;
  try {
    await whenWritesIdle();
    const active = await getActiveWrongs(profileKey);
    if (state.quiz !== quiz) return;
    applyActive(profileKey, active);
    quiz.completion = { remaining: active.length };
  } catch (error) {
    if (state.quiz !== quiz) return;
    console.warn('active wrongs refresh failed:', error);
    quiz.completion = { error: true };
  } finally {
    isFinishing = false;
  }
  redrawCurrent();
}

// 마무리 후 아직 남은 오답이 있을 때: 지금 active 인 오답으로 다시 시작한다.
export async function restartTrackC() {
  if (state.currentTrack !== 'C' || state.view !== 'quiz' || isFinishing) return;
  const quiz = state.quiz;
  const profile = state.profile;
  if (!profile) return;
  isFinishing = true;
  try {
    await whenWritesIdle();
    const set = await loadActiveSet(profile.profileKey);
    if (state.quiz !== quiz) return;
    applyActive(profile.profileKey, set.active);
    if (set.active.length === 0) {
      quiz.completion = { remaining: 0 };
      redrawCurrent();
      return;
    }
    if (set.missing) {
      showQuizMessage(MISSING_MESSAGE, 'error');
      return;
    }
    enterTrackC(profile, set.questions);
  } catch (error) {
    if (state.quiz !== quiz) return;
    showQuizMessage(`오답 목록을 불러오지 못했습니다. (${error.message})`, 'error');
  } finally {
    isFinishing = false;
  }
}
