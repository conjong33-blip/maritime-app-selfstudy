// 앱 상태를 한곳에 모은 단일 객체. DOM 요소, Supabase 객체, 함수는 넣지 않는다.
// V65 의 학생용 전역 변수를 아래처럼 나누어 옮겼다 (teacher/clinic/offline 상태는 없음).
//   selectedClass          -> licenseClass
//   currentTrack           -> currentTrack ('A' | 'B' | 'C' | null)
//   selectedSubject(s)     -> filters.subject / filters.subjects
//   selectedYear/Round     -> filters.year / filters.examRound (목록은 DB 기준으로 이후에 가져온다)
//   questionsList/currentNo-> quiz.questions / quiz.currentIndex (currentIndex 는 0부터)
//   markedAnswers          -> quiz.markedAnswers  (키: questions.id)
//   isGradedMap            -> quiz.graded         (키: questions.id)
//   wrongAttemptsMap       -> quiz.eliminatedChoices (이번 풀이에서만 쓰는 임시 UI 상태)
//   localStorage 오답 pool -> wrongPool.activeQuestionIds (영구 오답은 DB, 여기는 화면용 사본)
import { config } from './config.js';

function createInitialQuizState() {
  return {
    questions: [], // 문제 객체 목록 (questions 행)
    currentIndex: 0,
    markedAnswers: {}, // { [questionId]: 'ga' | 'na' | 'sa' | 'aa' }
    graded: {}, // { [questionId]: true } 정답 확인이 끝난 문제 (Track B/C)
    // Track B/C 에서 이번 풀이 중 틀려서 보기에서 제외한 선택지. 영구 오답 기록(wrongPool)과 별개다.
    eliminatedChoices: {}, // { [questionId]: ['ga', ...] }
  };
}

function createInitialState() {
  return {
    view: 'lobby', // 지금 보이는 화면: 'lobby' | 'quiz'
    profile: null, // 학번+이름으로 확인한 프로필 (연결 이후에 채운다)
    licenseClass: '3급', // V65 최초 화면과 동일: 3급 선택 상태
    currentTrack: null,
    filters: {
      subject: null, // Track B 단일 과목
      subjects: [], // Track A 다중 과목
      year: null,
      examRound: null,
    },
    // 시험지 선택지 계산용 questions 메타데이터 ([{ subject, year, examRound, count }]). 로비에서 채운다.
    metadata: { combinations: [] },
    quiz: createInitialQuizState(),
    wrongPool: {
      activeQuestionIds: [],
    },
    session: null, // 최근 학습 세션 (연결 이후에 채운다)
  };
}

export const state = createInitialState();

// 지금 보고 있는 문제 (없으면 null)
export function getCurrentQuestion() {
  return state.quiz.questions[state.quiz.currentIndex] ?? null;
}

// 풀이 중인 문제 관련 상태만 초기 값으로 되돌린다.
export function resetQuizState() {
  state.quiz = createInitialQuizState();
}

// 앱 전체 상태를 초기 값으로 되돌린다.
export function resetAppState() {
  Object.assign(state, createInitialState());
}

// 트랙을 설정한다. 'A' | 'B' | 'C' | null 만 허용한다.
export function setCurrentTrack(track) {
  if (track !== null && !config.trackTypes.includes(track)) {
    throw new Error(`Unknown track: ${track}`);
  }
  state.currentTrack = track;
}
