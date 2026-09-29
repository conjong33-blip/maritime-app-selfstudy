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
    // Track A: 최종 제출 확인 창이 열려 있는지, 제출 결과(제출 전 null), 오답 복습 문제를 보고 있는지.
    confirmingSubmit: false,
    submission: null, // 제출 결과 요약 (track-a-actions.js 가 채운다)
    // 이 문제 세트를 시작한 조건 (최근 세션 저장에 쓴다). { track, licenseClass, subject, subjects, year, examRound }
    origin: null,
    // Track C: 이번 오답소탕 회차가 어느 급수(3급/4급)인지. 정답을 맞힌 문제의 오답 정리(clearWrong) 상태
    // { [questionId]: 'pending' | 'done' | 'failed' }, 마무리 결과
    // { licenseClass, remainingInClass, remainingTotal, diagnosisContext?, remainingInTopic? } | { error }
    licenseClass: null,
    clearStatus: {},
    completion: null,
    // 내 학습 진단의 "내가 틀린 문제 다시풀기"로 들어온 회차만 { subject, topic } - 완료 문구에 학습영역
    // 이름을 보여주고, 완료 화면의 "새 문제로 도전하기" 버튼을 보일지 정하는 데 쓴다(diagnosis-actions.js
    // 의 startRelatedLearningFromCompletion). 일반 오답소탕(급수만 선택, "한번에 소탕하기")에서는 null -
    // 여러 학습영역이 섞여 있어 하나를 고를 수 없으므로 그 버튼을 보이지 않는다.
    diagnosisContext: null,
    reviewing: false, // 제출 후 결과 목록이 아니라 오답 한 문제의 복습 화면을 보고 있으면 true
  };
}

function createInitialState() {
  return {
    view: 'lobby', // 지금 보이는 화면: 'lobby' | 'quiz'
    profile: null, // 학번+이름으로 확인한 프로필 (연결 이후에 채운다)
    // 상단 "확인" 버튼 표시 상태: 'idle' | 'checking' | 'verified' | 'invalid'. 지금은 session-actions.js 의
    // checkIdentityForSession(기존 profile 조회/생성 흐름 그대로)이 idle/checking/verified 만 오간다.
    // 'invalid'는 향후 selfstudy_students 사전등록 검증을 연결할 때 쓸 자리만 미리 마련해 둔 것이다.
    studentVerification: 'idle',
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
      activeQuestionIds: [], // 이 학생의 active 오답 questions.id (RPC 순서: 처음 틀린 순)
      // 위 id 들의 실제 문제 행 + wrongCount, 같은 순서로. getActiveWrongs + fetchQuestionsByIds 를 한 번만 불러서
      // Track C 급수 집계와 "내 학습 진단"(급수/과목/개념 집계)이 함께 쓴다 (중복 조회 방지).
      activeQuestions: [],
      // 급수(license_class)별 active 오답 개수. DB 에는 급수를 저장하지 않고, 조회한 questions 행의
      // license_class 로 화면에서만 계산한다 ({ [licenseClass]: count }).
      countsByLicense: {},
      selectedLicenseClass: null, // Track C 에서 지금 고른 급수 (세션에는 저장하지 않는다)
      // 남은 오답이 한 급수뿐일 때 자동으로 그 급수를 선택해도 되는지. 오답소탕을 한 회차 마치면 꺼지고
      // (학생이 매번 직접 급수를 고른다), 학생이 바뀌면(resetActiveWrongs) 다시 켜진다.
      autoSelectAllowed: true,
      profileKey: null, // 위 목록이 어느 프로필의 것인지
      loaded: false, // 한 번이라도 DB 에서 읽었는지 (프로필 확인 전에는 false)
    },
    // 오답소탕 상단 탭: 'full'(한번에 소탕하기, 기본값) | 'byTopic'(나누어 소탕하기). 별도 중간 화면 없이 이 값 하나로
    // track-c-options 안의 콘텐츠(급수 버튼 <-> 급수/과목/학습영역 패널)와 하단 메인 CTA 표시 여부를 즉시 바꾼다.
    // 화면 전용이며 DB 에 저장하지 않는다. lobby-actions.js 의 selectTrack 이 Track C 를 새로 선택할 때 'full' 로 되돌리되,
    // 이미 Track C 안에서 탭만 바꾸는 경우(track-c-actions.js 의 selectTrackCMode)에는 건드리지 않는다.
    trackCStage: 'full',
    // "나누어 소탕하기"(구 "내 학습 진단") 패널의 화면 전용 선택 상태 (DB 에 저장하지 않는다, wrongPool 이 바뀌면 다시 계산한다).
    // 집계/선택 로직은 그대로 재사용한다 - track-c-actions.js 의 selectTrackCMode 가 expanded 만 켜고 끈다.
    diagnosis: {
      profileKey: null, // 이 선택이 어느 프로필 것인지 (다른 프로필이면 전부 초기화한다)
      expanded: false, // 상세 패널(급수->과목->학습영역)이 열려 있는지
      selectedLicenseClass: null,
      selectedSubject: null,
      selectedTopic: null, // 선택한 learning_topic (동률 포함 최대 5개 중 하나 - utils.js pickPriorityLearningTopics)
      message: '', // 진단 패널 안의 작은 오류 안내 (관련 문제 조회 실패 등)
    },
    // 학생의 최근 학습 세션 1개 (DB selfstudy_sessions 의 사본). 답안은 저장하지 않는다.
    // { trackType, licenseClass, subject, selectedSubjects, year, examRound, questionIds,
    //   currentQuestionId, currentQuestionIndex, updatedAt } 또는 null. profile 과는 별개다.
    session: null,
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
