// Track B 시험 시작과 로비 복귀. 문제를 읽어 state.quiz 에 넣고 문제 풀이 화면으로 전환한다.
// 채점, 해설 공개, 오답 기록, 프로필, 세션은 하지 않는다 (학번/이름은 비어 있는지만 확인한다).
import { state, resetQuizState } from './state.js';
import { fetchQuestions } from './data/questions.js';
import { renderCurrentQuestion } from './quiz-renderer.js';
import {
  clearStartMessage,
  hideConnectionError,
  setStartLoading,
  showConnectionError,
  showLobby,
  showQuiz,
  showStartMessage,
} from './view.js';

let startRequestId = 0;
let isStarting = false;

const inputValue = (id) => document.getElementById(id).value.trim();

// 시작 조건 확인. 통과하면 { studentId, studentName, selection }, 아니면 { message }.
function checkStartConditions() {
  const studentId = inputValue('student-id-input');
  if (!studentId) return { message: '학번을 입력해 주세요.' };
  const studentName = inputValue('student-name-input');
  if (!studentName) return { message: '학생 이름을 입력해 주세요.' };

  if (state.currentTrack === null) return { message: '학습 트랙을 먼저 선택해 주세요.' };
  if (state.currentTrack !== 'B') return { message: '과목 선택(Track B)만 시작할 수 있습니다.' };
  if (!state.filters.subject) return { message: '공부하실 과목 카드를 먼저 한 개 선택해 주세요.' };
  if (state.filters.year === null || state.filters.examRound === null) {
    return { message: '연도와 시험 회차를 선택해 주세요.' };
  }
  return {
    studentId,
    studentName,
    selection: {
      licenseClass: state.licenseClass,
      subject: state.filters.subject,
      year: state.filters.year,
      examRound: state.filters.examRound,
    },
  };
}

// 요청을 보낸 뒤 로비 선택이 바뀌었으면 그 응답은 버린다.
function isSameSelection(selection) {
  return (
    state.view === 'lobby' &&
    state.currentTrack === 'B' &&
    state.licenseClass === selection.licenseClass &&
    state.filters.subject === selection.subject &&
    state.filters.year === selection.year &&
    state.filters.examRound === selection.examRound
  );
}

export async function startSelectedExam() {
  if (isStarting || state.view !== 'lobby') return;
  clearStartMessage();

  const check = checkStartConditions();
  if (check.message) {
    showStartMessage(check.message);
    return;
  }
  const { studentId, studentName, selection } = check;

  const requestId = ++startRequestId;
  isStarting = true;
  setStartLoading(true);
  try {
    const rows = await fetchQuestions(selection);
    if (requestId !== startRequestId || !isSameSelection(selection)) return;
    hideConnectionError();
    if (rows.length === 0) {
      showStartMessage('선택하신 시험지에 등록된 문제가 없습니다.');
      return;
    }
    resetQuizState();
    state.quiz.questions = rows;
    state.quiz.currentIndex = 0;
    showQuiz(studentName ? `${studentId} (${studentName})` : `학번: ${studentId}`);
    renderCurrentQuestion();
  } catch (error) {
    if (requestId !== startRequestId || !isSameSelection(selection)) return;
    showConnectionError(error);
  } finally {
    if (requestId === startRequestId) {
      isStarting = false;
      setStartLoading(false);
    }
  }
}

// 문제 풀이를 끝내고 로비로 돌아간다. 문제 풀이 상태만 지우고 로비의 입력/선택값은 그대로 둔다.
// (아직 저장하는 곳이 없으므로 풀던 내용은 사라진다. 오답 pool 과 프로필 관련 state 는 건드리지 않는다.)
export function returnToLobby() {
  if (state.view !== 'quiz') return;
  resetQuizState();
  clearStartMessage();
  showLobby();
}
