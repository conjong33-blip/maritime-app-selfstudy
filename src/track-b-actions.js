// Track B/C 정답 확인 (Track C 오답소탕도 같은 방식으로 푼다). 채점은 이미 불러온 문제 데이터로 화면에서 끝내고, 오답만 selfstudy RPC(recordWrong)로 기록한다.
// - 정답: graded 로 만들고 해설을 공개한다. 오답 기록은 건드리지 않는다 (clearWrong 은 Track C 에서만).
// - 오답: 그 보기를 제외하고 recordWrong 을 호출한다 (틀릴 때마다 wrong_count 누적).
// 화면 채점과 DB 기록은 분리한다: 기록이 실패해도 학생의 풀이 흐름은 막지 않고, 실패한 기록은 다음 정답 확인 때 다시 시도한다.
import { state, getCurrentQuestion } from './state.js';
import { normalizeAnswerKey } from './utils.js';
import { recordWrong } from './data/selfstudy.js';
import { trackWrite } from './pending-writes.js';
import { clearSolvedWrong } from './track-c-actions.js';
import { renderChoiceStates, renderQuestionStatus } from './quiz-renderer.js';
import { clearQuizFeedback, clearQuizSaveError, showQuizMessage, showQuizSaveError } from './view.js';

const checkingQuestionIds = new Set(); // 오답 기록(RPC)이 끝나지 않은 문제 (같은 문제의 중복 처리 방지)
const pendingWrongs = []; // 기록에 실패한 오답 [{ profileKey, questionId }]
let isFlushing = false;

// 저장에 실패했던 오답을 순서대로 다시 기록한다. 하나라도 실패하면 멈추고 남겨 둔다.
async function flushPendingWrongs() {
  if (isFlushing || pendingWrongs.length === 0) return;
  isFlushing = true;
  try {
    while (pendingWrongs.length > 0) {
      const { profileKey, questionId } = pendingWrongs[0];
      try {
        await trackWrite(recordWrong(profileKey, questionId));
      } catch {
        break;
      }
      pendingWrongs.shift();
    }
  } finally {
    isFlushing = false;
  }
  if (pendingWrongs.length === 0) clearQuizSaveError();
}

async function saveWrong(questionId) {
  const profileKey = state.profile?.profileKey;
  if (!profileKey) {
    showQuizSaveError('학생 프로필이 없어 오답을 저장하지 못했습니다.');
    return;
  }
  checkingQuestionIds.add(questionId);
  try {
    await trackWrite(recordWrong(profileKey, questionId));
    if (pendingWrongs.length === 0) clearQuizSaveError();
  } catch (error) {
    pendingWrongs.push({ profileKey, questionId });
    showQuizSaveError(`오답 기록을 저장하지 못했습니다. 다음 정답 확인 때 다시 시도합니다. (${error.message})`);
  } finally {
    checkingQuestionIds.delete(questionId);
  }
}

export async function checkTrackBAnswer() {
  if (state.view !== 'quiz' || (state.currentTrack !== 'B' && state.currentTrack !== 'C')) return;
  const question = getCurrentQuestion();
  if (!question) return;
  const id = question.id;
  if (state.quiz.graded[id] || checkingQuestionIds.has(id)) return;

  void flushPendingWrongs();
  clearQuizFeedback();

  const selectedKey = normalizeAnswerKey(state.quiz.markedAnswers[id]);
  if (!selectedKey) {
    showQuizMessage('정답 확인을 위해 보기를 먼저 선택해 주세요!');
    return;
  }
  // 정답 데이터가 이상하면 정답/오답으로 판정하지 않고 아무것도 기록하지 않는다.
  const correctKey = normalizeAnswerKey(question.correct_answer);
  if (!correctKey) {
    showQuizMessage('이 문항의 정답 데이터를 확인할 수 없어 채점할 수 없습니다.', 'error');
    return;
  }

  if (selectedKey === correctKey) {
    state.quiz.graded[id] = true;
    renderQuestionStatus(question);
    // Track C: 정답을 맞힌 오답은 정리한다 (Track B 는 오답 기록을 건드리지 않는다).
    if (state.currentTrack === 'C') void clearSolvedWrong(question);
    return;
  }

  // 오답: 화면에 먼저 반영하고 기록은 그 뒤에 한다.
  state.quiz.eliminatedChoices[id] = [...new Set([...(state.quiz.eliminatedChoices[id] ?? []), selectedKey])];
  delete state.quiz.markedAnswers[id];
  renderChoiceStates(question);
  showQuizMessage('오답입니다! 다시 고민해 보세요. 틀린 보기는 제외하고 다시 도전할 수 있습니다.', 'error');
  await saveWrong(id);
}
