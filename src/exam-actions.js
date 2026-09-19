// Track A/B 시험 시작과 로비 복귀. 학번+이름으로 selfstudy 프로필을 확보한 뒤 문제를 읽어 state.quiz 에 넣고
// 문제 풀이 화면으로 전환한다. 채점은 track-b-actions.js / track-a-actions.js, 최근 세션 저장/복원은 session-actions.js 에서 한다.
import { config } from './config.js';
import { state, resetQuizState } from './state.js';
import { fetchQuestions } from './data/questions.js';
import { ensureProfile, readIdentity, validateIdentity } from './profile.js';
import { isSessionBusy, refreshResumeCard, saveCurrentSession } from './session-actions.js';
import { renderCurrentQuestion } from './quiz-renderer.js';
import {
  clearQuizSaveError,
  clearSessionSaveError,
  clearStartMessage,
  hideConnectionError,
  hideResumeCard,
  setStartLoading,
  showConnectionError,
  showLobby,
  showQuiz,
  showStartMessage,
} from './view.js';

let startRequestId = 0;
let isStarting = false;

// 시작 조건 확인. 통과하면 { snapshot }, 아니면 { message }.
function checkStartConditions() {
  const { studentNo, studentName } = readIdentity();
  const identityMessage = validateIdentity({ studentNo, studentName });
  if (identityMessage) return { message: identityMessage };

  if (state.currentTrack === null) return { message: '학습 트랙을 먼저 선택해 주세요.' };
  if (state.currentTrack !== 'A' && state.currentTrack !== 'B') {
    return { message: '모의고사(Track A) 또는 과목 선택(Track B)만 시작할 수 있습니다.' };
  }
  if (state.currentTrack === 'B' && !state.filters.subject) {
    return { message: '공부하실 과목 카드를 먼저 한 개 선택해 주세요.' };
  }
  if (state.currentTrack === 'A' && state.filters.subjects.length === 0) {
    return { message: '응시할 과목을 한 개 이상 체크해 주세요.' };
  }
  if (state.filters.year === null || state.filters.examRound === null) {
    return { message: state.currentTrack === 'A' ? '선택한 과목이 모두 있는 시험이 없습니다. 과목 선택을 바꿔 주세요.' : '연도와 시험 회차를 선택해 주세요.' };
  }
  return {
    snapshot: {
      studentNo,
      studentName,
      track: state.currentTrack,
      licenseClass: state.licenseClass,
      subject: state.currentTrack === 'B' ? state.filters.subject : null,
      subjects: state.currentTrack === 'A' ? [...state.filters.subjects] : [],
      year: state.filters.year,
      examRound: state.filters.examRound,
    },
  };
}

// 요청을 보낸 뒤 입력이나 로비 선택이 바뀌었으면 그 응답은 버린다.
function isSameSnapshot(snapshot) {
  return (
    state.view === 'lobby' &&
    state.currentTrack === snapshot.track &&
    readIdentity().studentNo === snapshot.studentNo &&
    readIdentity().studentName === snapshot.studentName &&
    state.licenseClass === snapshot.licenseClass &&
    (snapshot.track === 'A'
      ? state.filters.subjects.join('|') === snapshot.subjects.join('|')
      : state.filters.subject === snapshot.subject) &&
    state.filters.year === snapshot.year &&
    state.filters.examRound === snapshot.examRound
  );
}

// Track A 문제는 체크박스 순서(과목별로 묶음) -> 문항 번호 순서로 정렬한다.
function orderTrackARows(rows) {
  const order = (subject) => config.trackASubjects.indexOf(subject);
  return rows
    .map((row, position) => ({ row, position }))
    .sort((a, b) => order(a.row.subject) - order(b.row.subject) || a.position - b.position)
    .map(({ row }) => row);
}

export async function startSelectedExam() {
  if (isStarting || isSessionBusy() || state.view !== 'lobby') return;
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
    const profile = await ensureProfile({ studentNo: snapshot.studentNo, studentName: snapshot.studentName });
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
    if (state.profile?.profileKey !== profile.profileKey) state.session = null; // 다른 학생의 세션은 이어받지 않는다
    state.profile = profile;

    // 2) 문제
    const isTrackA = snapshot.track === 'A';
    let rows = await fetchQuestions({
      licenseClass: snapshot.licenseClass,
      ...(isTrackA ? { subjects: snapshot.subjects } : { subject: snapshot.subject }),
      year: snapshot.year,
      examRound: snapshot.examRound,
    });
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
    hideConnectionError();
    if (rows.length === 0) {
      showStartMessage('선택하신 시험지에 등록된 문제가 없습니다.');
      return;
    }
    if (isTrackA) {
      // 선택한 과목이 하나라도 빠져 있으면 일부 과목만으로 시험을 시작하지 않는다.
      const present = new Set(rows.map((row) => row.subject));
      const missing = snapshot.subjects.filter((subject) => !present.has(subject));
      if (missing.length > 0) {
        showStartMessage(`선택하신 시험지에 ${missing.join(', ')} 문제가 없어 시작할 수 없습니다.`);
        return;
      }
      rows = orderTrackARows(rows);
    }

    resetQuizState();
    state.quiz.origin = {
      track: snapshot.track,
      licenseClass: snapshot.licenseClass,
      subject: snapshot.subject,
      subjects: [...snapshot.subjects],
      year: snapshot.year,
      examRound: snapshot.examRound,
    };
    state.quiz.questions = rows;
    state.quiz.currentIndex = 0;
    showQuiz(`${state.profile.studentNo} (${state.profile.studentName})`);
    renderCurrentQuestion();
    hideResumeCard(); // 새 시험을 시작하면 이전 세션은 이 시험의 첫 저장으로 덮어쓴다
    void saveCurrentSession();
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
// 풀던 답안은 사라지지만 DB 의 최근 세션(문제 세트 + 위치)과 이미 기록된 오답은 그대로 남는다.
export function returnToLobby() {
  if (state.view !== 'quiz') return;
  resetQuizState();
  clearStartMessage();
  clearQuizSaveError();
  clearSessionSaveError();
  showLobby();
  void refreshResumeCard(); // DB 의 최근 세션은 그대로 두고 이어하기 카드를 다시 보인다
}
