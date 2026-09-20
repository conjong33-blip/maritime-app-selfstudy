// Track A(모의고사) 최종 제출, 채점, 결과 화면 조작.
// 채점은 이미 불러온 문제 데이터로 화면에서 끝내고(gradeTrackA), 선택했지만 틀린 문항만 selfstudy RPC(recordWrong)로 기록한다.
//  - 미응답 문항은 점수에서는 맞히지 못한 문항이지만 오답 기록(recordWrong)에는 넣지 않는다.
//  - 정답 데이터를 알 수 없는 문항(invalid)은 채점하지 않고 기록하지도 않는다.
// 화면 채점과 DB 기록은 분리한다: 기록이 실패해도 결과 화면은 그대로 보이고, 실패한 문항은 메모리에서만 추적한다.
import { state, getCurrentQuestion } from './state.js';
import { gradeTrackA } from './utils.js';
import { recordWrong } from './data/selfstudy.js';
import { renderCurrentQuestion, renderQuestionStatus } from './quiz-renderer.js';
import { renderSaveStatus, renderSubmitConfirm } from './track-a-view.js';
import { clearRecentSession } from './session-actions.js';
import { trackWrite } from './pending-writes.js';
import { clearQuizFeedback } from './view.js';

let isSubmitting = false; // 제출 처리 중 (중복 제출과 오답 중복 기록 방지)
let isRetrying = false;

const isTrackAQuiz = () => state.view === 'quiz' && state.currentTrack === 'A' && state.quiz.questions.length > 0;

// 최종 제출 버튼: 바로 제출하지 않고 화면 안에 확인 창(미응답 수 안내)을 연다.
export function requestSubmitTrackA() {
  if (!isTrackAQuiz() || state.quiz.submission || isSubmitting) return;
  clearQuizFeedback();
  state.quiz.confirmingSubmit = true;
  renderSubmitConfirm();
}

export function cancelSubmitTrackA() {
  if (!state.quiz.confirmingSubmit) return;
  state.quiz.confirmingSubmit = false;
  renderSubmitConfirm();
}

// 이번 제출에서 기록할 대상: 선택했지만 틀린 문항의 questions.id
const wrongIdsOf = (submission) => submission.items.filter((item) => item.result === 'incorrect').map((item) => item.questionId);

// ids 를 recordWrong 으로 기록하고 실패한 id 목록을 돌려준다. 하나가 실패해도 나머지는 계속 기록한다.
async function recordWrongs(profileKey, ids) {
  if (!profileKey) return [...ids];
  const results = await Promise.allSettled(ids.map((id) => trackWrite(recordWrong(profileKey, id))));
  return ids.filter((_, index) => results[index].status === 'rejected');
}

export async function confirmSubmitTrackA() {
  if (!isTrackAQuiz() || state.quiz.submission || isSubmitting || !state.quiz.confirmingSubmit) return;
  isSubmitting = true;
  try {
    const graded = gradeTrackA(state.quiz.questions, state.quiz.markedAnswers);
    const submission = { ...graded, failedWrongIds: [] };
    // 결과를 state 에 먼저 넣는다: 이 순간부터 답 변경, 재제출이 막히고 결과 화면이 나온다.
    state.quiz.submission = submission;
    state.quiz.confirmingSubmit = false;
    state.quiz.reviewing = false;
    renderCurrentQuestion();
    // 제출이 끝났으므로 최근 학습 위치는 지운다. 오답 기록의 성공 여부와는 별개이고, 실패해도 결과 화면은 그대로다.
    void clearRecentSession();

    const profileKey = state.profile?.profileKey;
    const failed = await recordWrongs(profileKey, wrongIdsOf(submission));
    if (state.quiz.submission !== submission) return; // 그 사이 로비로 나갔거나 다른 시험을 시작했다
    submission.failedWrongIds = failed;
    renderSaveStatus();
  } finally {
    isSubmitting = false;
  }
}

// 기록에 실패한 오답만 다시 기록한다. 성공한 것은 다시 보내지 않으므로 wrong_count 가 중복으로 늘지 않는다.
export async function retryTrackASave() {
  const submission = state.quiz.submission;
  if (!submission || isSubmitting || isRetrying || submission.failedWrongIds.length === 0) return;
  isRetrying = true;
  try {
    const targets = [...submission.failedWrongIds];
    const failed = await recordWrongs(state.profile?.profileKey, targets);
    if (state.quiz.submission !== submission) return;
    submission.failedWrongIds = failed;
    renderSaveStatus();
  } finally {
    isRetrying = false;
  }
}

// 결과 목록의 오답 항목을 눌러 그 문제의 복습 화면(선택한 답, 정답, 해설)을 본다.
export function reviewTrackAQuestion(value) {
  if (!state.quiz.submission) return;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= state.quiz.questions.length) return;
  state.quiz.currentIndex = index;
  state.quiz.reviewing = true;
  renderCurrentQuestion();
}

// 복습 화면에서 결과 목록으로 돌아간다. 채점 결과와 답안은 그대로 둔다.
export function returnToSummaryList() {
  if (!state.quiz.submission || !state.quiz.reviewing) return;
  state.quiz.reviewing = false;
  const question = getCurrentQuestion();
  if (question) renderQuestionStatus(question);
}
