// Track A/B 시험 시작과 로비 복귀. 학번+이름으로 selfstudy 프로필을 확보한 뒤 문제를 읽어 state.quiz 에 넣고
// 문제 풀이 화면으로 전환한다. 채점은 track-b-actions.js / track-a-actions.js 에서 한다. 세션 저장/복원은 아직 하지 않는다.
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
    readStudentNo() === snapshot.studentNo &&
    readStudentName() === snapshot.studentName &&
    state.licenseClass === snapshot.licenseClass &&
    (snapshot.track === 'A'
      ? state.filters.subjects.join('|') === snapshot.subjects.join('|')
      : state.filters.subject === snapshot.subject) &&
    state.filters.year === snapshot.year &&
    state.filters.examRound === snapshot.examRound
  );
}

// 학번+이름으로 프로필을 확보해 state.profile 에 넣는다 (Track A/B 공통).
async function ensureProfile(snapshot) {
  const profile = await getOrCreateProfile({ studentNo: snapshot.studentNo, studentName: snapshot.studentName });
  return { profileKey: profile.profileKey, studentNo: profile.studentNo, studentName: profile.studentName };
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
    const profile = await ensureProfile(snapshot);
    if (requestId !== startRequestId || !isSameSnapshot(snapshot)) return;
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
