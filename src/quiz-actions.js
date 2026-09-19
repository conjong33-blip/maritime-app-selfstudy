// 문제 풀이 화면의 화면 조작(UI-only): 보기 선택, 이전/다음 문제.
// 정답 판정, 채점, 저장은 하지 않는다. 문제 데이터가 없으면 아무 일도 하지 않는다.
import { state, getCurrentQuestion } from './state.js';
import { ANSWER_KEYS } from './utils.js';
import { renderChoiceStates, renderCurrentQuestion } from './quiz-renderer.js';
import { clearQuizFeedback } from './view.js';

// 보기 선택. 이미 선택한 보기를 다시 눌러도 선택은 유지된다 (V65 와 동일, 해제하지 않음).
export function markAnswer(key) {
  const question = getCurrentQuestion();
  if (!question || !ANSWER_KEYS.includes(key)) return;
  const id = question.id;
  if (state.currentTrack !== 'A' && state.quiz.graded[id]) return;
  if ((state.quiz.eliminatedChoices[id] ?? []).includes(key)) return;

  state.quiz.markedAnswers[id] = key;
  clearQuizFeedback();
  renderChoiceStates(question);
}

// 이전 문제. 첫 문제에서는 아무 일도 하지 않는다.
export function goToPrevQuestion() {
  if (state.quiz.currentIndex <= 0) return;
  state.quiz.currentIndex -= 1;
  renderCurrentQuestion();
}

// 다음 문제. 마지막 문제에서는 아무 일도 하지 않는다 (다음 회차 이동/제출은 이후 단계).
export function goToNextQuestion() {
  if (state.quiz.currentIndex >= state.quiz.questions.length - 1) return;
  state.quiz.currentIndex += 1;
  renderCurrentQuestion();
}
