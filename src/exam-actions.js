// Track B 시험 시작과 로비 복귀. 학번+이름으로 selfstudy 프로필을 확보한 뒤 문제를 읽어 state.quiz 에 넣고
// 문제 풀이 화면으로 전환한다. 채점은 track-b-actions.js 에서 한다. 세션 저장/복원은 아직 하지 않는다.
import { config } from './config.js';
import { state, resetQuizState } from './state.js';
import { fetchQuestions } from './data/questions.js';
import { getOrCreateProfile } from './data/selfstudy.js';
import { renderCurrentQuestion } from './quiz-renderer.js';
import {
  clearQuizSaveError,
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

// 학번은 앞뒤 공백만 제거한다 (형식 제한 없음). 이름은 앞뒤 공백 제거 + NFC 정규화
// (이름 안의 공백 차이는 DB 가 같은 사람으로 판정하므로 여기서 지우지 않는다).
const readStudentNo = () => document.getElementById('student-id-input').value.trim();
const readStudentName = () => document.getElementById('student-name-input').value.trim().normalize('NFC');
const charCount = (text) => [...text].length; // DB char_length 와 같은 기준(코드포인트)

// 시작 조건 확인. 통과하면 { snapshot }, 아니면 { message }.
function checkStartConditions() {
  const studentNo = readStudentNo();
  if (!studentNo) return { message: '학번을 입력해 주세요.' };
  if (charCount(studentNo) > config.limits.studentNo) {
    return { message: `학번은 ${config.limits.studentNo}자 이하로 입력해 주세요.` };
  }
  const studentName = readStudentName();
  if (!studentName) return { message: '학생 이름을 입력해 주세요.' };
  if (charCount(studentName) > config.limits.studentName) {
    return { message: `이름은 ${config.limits.studentName}자 이하로 입력해 주세요.` };
  }

  if (state.currentTrack === null) return { message: '학습 트랙을 먼저 선택해 주세요.' };
  if (state.currentTrack !== 'B') return { message: '과목 선택(Track B)만 시작할 수 있습니다.' };
  if (!state.filters.subject) return { message: '공부하실 과목 카드를 먼저 한 개 선택해 주세요.' };
  if (state.filters.year === null || state.filters.examRound === null) {
    return { message: '연도와 시험 회차를 선택해 주세요.' };
  }
  return {
    snapshot: {
      studentNo,
      studentName,
      licenseClass: state.licenseClass,
      subject: state.filters.subject,
      year: state.filters.year,
      examRound: state.filters.examRound,
    },
  };
}

// 요청을 보낸 뒤 입력이나 로비 선택이 바뀌었으면 그 응답은 버린다.
function isSameSnapshot(snapshot) {
  return (
    state.view === 'lobby' &&
    state.currentTrack === 'B' &&
    readStudentNo() === snapshot.studentNo &&
    readStudentName() === snapshot.studentName &&
    state.licenseClass === snapshot.licenseClass &&
    state.filters.subject === snapshot.subject &&
    state.filters.year === snapshot.year &&
    state.filters.examRound === snapshot.examRound
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
  const { snapshot } = check;

  const requestId = ++startRequestId;
  isStarting = true;
  setStartLoading(true);
  try {
    // 1) 프로필 (실패하면 문제를 불러오지 않는다)
    const profile = await getOrCreateProfile({ studentNo: snapshot.studentNo, studentName: snapshot.studentName });
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
    state.profile = { profileKey: profile.profileKey, studentNo: profile.studentNo, studentName: profile.studentName };

    // 2) 문제
    const rows = await fetchQuestions({
      licenseClass: snapshot.licenseClass,
      subject: snapshot.subject,
      year: snapshot.year,
      examRound: snapshot.examRound,
    });
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
    hideConnectionError();
    if (rows.length === 0) {
      showStartMessage('선택하신 시험지에 등록된 문제가 없습니다.');
      return;
    }

    resetQuizState();
    state.quiz.questions = rows;
    state.quiz.currentIndex = 0;
    showQuiz(`${state.profile.studentNo} (${state.profile.studentName})`);
    renderCurrentQuestion();
  } catch (error) {
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
    showConnectionError(error);
  } finally {
    if (requestId === startRequestId) {
      isStarting = false;
      setStartLoading(false);
    }
  }
}

// 문제 풀이를 끝내고 로비로 돌아간다. 문제 풀이 상태만 지우고 로비의 입력/선택값과 프로필(메모리)은 그대로 둔다.
// (아직 저장하는 곳이 없으므로 풀던 내용은 사라진다. 이미 기록된 오답은 DB 에 남아 있다.)
export function returnToLobby() {
  if (state.view !== 'quiz') return;
  resetQuizState();
  clearStartMessage();
  clearQuizSaveError();
  showLobby();
}
