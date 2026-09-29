// Track A/B 공통 "최근 학습 위치" 세션: 저장, 이어하기 카드, 이어서 학습하기, 처음부터 시작(삭제).
// 학생당 세션은 1개이고 "어디까지 공부했는가"만 저장한다 (문제 세트 + 현재 위치).
// 답안, 정답 확인 상태, 제외한 보기, Track A 제출 결과, 오답 기록 실패 상태는 저장하지 않으며 복원하지도 않는다.
//
// 저장은 직렬 큐로 처리한다: 한 번에 요청 하나만 나가고, 아직 나가지 않은 저장이 여러 개 쌓이면 마지막 위치 하나만 남긴다.
// (그래서 next -> next -> prev 를 빠르게 눌러도 오래된 위치가 나중에 DB 를 덮어쓰지 않는다.)
// 삭제도 같은 큐를 지나므로 앞선 저장이 끝난 뒤에 실행된다. 저장/삭제 실패는 문제 풀이를 막지 않는다.
import { resetAppState, state, resetQuizState, setCurrentTrack } from './state.js';
import { clearSession, getSession, saveSession, RPC_ERROR_CODE } from './data/selfstudy.js';
import { fetchQuestionsByIds } from './data/questions.js';
import { ensureProfile, isSameIdentity, readIdentity, validateIdentity } from './profile.js';
import { clearLoginInfo, readLoginInfo, saveLoginInfo } from './local-auth.js';
import { resetTrackSelectionUI, syncLobbyFromState } from './lobby-actions.js';
import { renderCurrentQuestion } from './quiz-renderer.js';
import { refreshActiveWrongs, resetActiveWrongs } from './track-c-actions.js';
import {
  clearSessionSaveError,
  clearStartMessage,
  hideConnectionError,
  hideResumeCard,
  renderStudentVerification,
  setResumeCardBusy,
  setStartLoading,
  showConnectionError,
  showIdentityConflictMessage,
  showQuiz,
  showResumeCard,
  showSessionSaveError,
  showStartMessage,
} from './view.js';

// ---------------------------------------------------------------------
// 저장/삭제 큐
// ---------------------------------------------------------------------
const queue = []; // [{ type: 'save' | 'clear', payload, promise, resolve }] 아직 시작하지 않은 작업
let running = false;
let idleWaiters = [];
let isBusy = false; // 이어하기/삭제 처리 중 (중복 클릭, 동시 시작 방지)
export const isSessionBusy = () => isBusy;

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const op = queue.shift();
    let result = false;
    try {
      if (op.type === 'save') {
        await saveSession(op.payload);
        state.session = { ...op.payload, updatedAt: new Date().toISOString() };
        clearSessionSaveError();
      } else {
        await clearSession(op.payload.profileKey);
        if (state.profile?.profileKey === op.payload.profileKey) state.session = null;
      }
      result = true;
    } catch (error) {
      showSessionSaveError(
        op.type === 'save'
          ? '학습 위치를 저장하지 못했습니다. 문제를 풀이하는 데는 지장이 없습니다.'
          : '이전 학습 기록을 정리하지 못했습니다. 문제를 풀이하는 데는 지장이 없습니다.',
      );
      console.warn(`session ${op.type} failed:`, error);
    }
    op.resolve(result);
  }
  running = false;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const wake of waiters) wake();
}

function enqueue(type, payload) {
  const last = queue[queue.length - 1];
  if (type === 'save' && last?.type === 'save' && last.payload.profileKey === payload.profileKey) {
    last.payload = payload; // 대기 중인 저장은 가장 최근 위치로 바꿔치기
    return last.promise;
  }
  const op = { type, payload };
  op.promise = new Promise((resolve) => {
    op.resolve = resolve;
  });
  queue.push(op);
  void runQueue();
  return op.promise;
}

// 큐가 모두 끝날 때까지 기다린다 (테스트/로비 복귀 후 카드 갱신용)
export function whenSessionIdle() {
  if (!running && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

// ---------------------------------------------------------------------
// 현재 문제 풀이 -> 세션 payload
// ---------------------------------------------------------------------
// 저장할 수 없는 상태(로비, 제출 후, 프로필/문제 없음)에서는 null.
export function buildSessionPayload() {
  const { origin, questions, currentIndex, submission } = state.quiz;
  const profileKey = state.profile?.profileKey;
  if (state.view !== 'quiz' || !profileKey || !origin || questions.length === 0 || submission) return null;
  const current = questions[currentIndex];
  if (!current) return null;
  return {
    profileKey,
    trackType: origin.track,
    licenseClass: origin.licenseClass,
    subject: origin.track === 'B' ? origin.subject : null,
    selectedSubjects: origin.track === 'A' ? [...origin.subjects] : [],
    year: origin.year,
    examRound: origin.examRound,
    currentQuestionId: current.id,
    currentQuestionIndex: currentIndex,
    questionIds: questions.map((question) => question.id),
  };
}

// 현재 위치를 저장한다. 절대 reject 하지 않는다 (true: 저장됨, false: 실패하거나 저장할 게 없음).
export function saveCurrentSession() {
  const payload = buildSessionPayload();
  return payload ? enqueue('save', payload) : Promise.resolve(false);
}

// 저장된 최근 세션을 지운다 (Track A 제출 완료, 처음부터 시작). 절대 reject 하지 않는다.
export function clearRecentSession() {
  const profileKey = state.profile?.profileKey;
  return profileKey ? enqueue('clear', { profileKey }) : Promise.resolve(false);
}

// ---------------------------------------------------------------------
// 이어하기 카드
// ---------------------------------------------------------------------
// compact 배너용 2단 표시. main 은 항상 보이고(Track/급수/과목/위치), detail(연도/회차)은 좁은 화면에서 CSS 로 숨길 수 있다.
function describeSession(session) {
  const total = session.questionIds?.length ?? 0;
  const position = Math.min((session.currentQuestionIndex ?? 0) + 1, Math.max(total, 1));
  const subjects = session.trackType === 'A' ? (session.selectedSubjects ?? []).join('·') : (session.subject ?? '');
  const track = session.trackType === 'A' ? 'Track A' : 'Track B';
  return {
    main: `${track} · ${session.licenseClass} ${subjects} · ${position}/${total}`,
    detail: `${session.year}년 ${session.examRound}`,
  };
}

// Track A/B 이고 이어갈 문제 세트가 있는 세션만 카드로 보여 준다 (Track C 세션 등은 이번 단계에서 다루지 않는다).
function isResumable(session) {
  return Boolean(
    session &&
      (session.trackType === 'A' || session.trackType === 'B') &&
      Array.isArray(session.questionIds) &&
      session.questionIds.length > 0,
  );
}

function renderResumeCard() {
  if (state.view === 'lobby' && isResumable(state.session)) showResumeCard(describeSession(state.session));
  else hideResumeCard();
}

let identityRequestId = 0;

// 학번/이름 입력이 확정되면(blur, Enter, 또는 상단 "확인" 버튼 클릭) 프로필을 확보하고 최근 세션이 있으면
// 이어하기 카드를 보인다. 키를 누를 때마다 부르지 않는다. 입력이 올바르지 않으면 카드를 숨기고 조용히 끝낸다.
// state.studentVerification 은 이 함수의 진행 상황을 그대로 보여주는 화면 전용 표시일 뿐이다 - 실제 프로필
// 조회/생성(ensureProfile)이나 세션 조회 흐름 자체는 이전과 완전히 같다(사전등록 검증은 아직 없다).
export async function checkIdentityForSession() {
  if (state.view !== 'lobby' || isBusy) return;
  const requestId = ++identityRequestId;
  const identity = readIdentity();
  if (validateIdentity(identity) !== null) {
    hideResumeCard();
    resetActiveWrongs();
    state.studentVerification = 'idle';
    renderStudentVerification();
    return;
  }
  if (!isSameIdentity(identity)) {
    hideResumeCard(); // 다른 학생 입력: 이전 학생의 카드는 바로 숨긴다
    state.session = null;
    resetActiveWrongs();
  }
  state.studentVerification = 'checking';
  renderStudentVerification();
  try {
    const profile = await ensureProfile(identity);
    if (requestId !== identityRequestId || !isSameCurrentInput(identity)) return;
    if (state.profile?.profileKey !== profile.profileKey) state.session = null;
    state.profile = profile;
    state.studentVerification = 'verified';
    renderStudentVerification();
    // 확인에 성공했을 때만 로그인 유지 정보를 저장한다(실패/에러 상태에서는 저장하지 않는다) - 여기 저장하는
    // 값은 "누구로 로그인했는지"뿐이고, wrongPool 등 실제 학습 데이터는 항상 Supabase 에서 다시 읽는다.
    saveLoginInfo({ profileKey: profile.profileKey, studentNo: identity.studentNo, studentName: identity.studentName });
    void refreshActiveWrongs(); // 프로필이 확인되면 남은 오답 수(Track C 카드)도 함께 확인한다
    const session = await getSession(profile.profileKey);
    if (requestId !== identityRequestId || !isSameCurrentInput(identity)) return;
    state.session = session;
    hideConnectionError();
    renderResumeCard();
  } catch (error) {
    if (requestId !== identityRequestId) return;
    state.studentVerification = 'idle';
    renderStudentVerification();
    hideResumeCard();
    // 같은 학번에 이미 다른 이름의 profile 이 있어서 막힌 경우(db/004_selfstudy_prevent_duplicate_
    // identity.sql)만 학생이 이해할 수 있는 안내로 보여준다. 그 외(네트워크/통신 오류 등)는 기존
    // 그대로 연결 오류 안내를 보여준다 - 오답/세션 등 다른 어떤 데이터도 건드리지 않는다.
    if (error?.code === RPC_ERROR_CODE.DUPLICATE_STUDENT_IDENTITY) {
      showIdentityConflictMessage();
    } else {
      showConnectionError(error);
    }
  }
}

function isSameCurrentInput(identity) {
  const now = readIdentity();
  return state.view === 'lobby' && now.studentNo === identity.studentNo && now.studentName === identity.studentName;
}

// "로그아웃"(구 "학생 변경"): 학습 홈의 화면 상태만 초기 값으로 되돌리고 학생 확인 화면으로 되돌아간다. DB 의
// profile/오답 기록/세션은 전혀 건드리지 않는다 - "현재 기기에서 학생 확인 상태만 해제"하는 기능이다.
// 같은 학번/이름으로 다시 확인하면 ensureProfile/getSession 이 그대로 복원한다(기존 프로필 생성/조회 흐름
// 무수정). resetAppState 가 이미 있는 "전체 상태 초기화" 함수를 그대로 재사용한다 - profile/currentTrack/
// filters/wrongPool/trackCStage/diagnosis/session/studentVerification 등 state.js 의 createInitialState 가
// 정의하는 모든 화면 상태가 한 번에 초기값으로 돌아간다. 로그인 유지 정보(local-auth.js)도 함께 지운다 -
// 지우지 않으면 새로고침 시 자동 로그인이 다시 이 학생으로 복원되어 버린다.
export function logoutStudent() {
  clearLoginInfo();
  resetAppState();
  const idInput = document.getElementById('student-id-input');
  const nameInput = document.getElementById('student-name-input');
  if (idInput) idInput.value = '';
  if (nameInput) nameInput.value = '';
  identityRequestId += 1; // 진행 중이던 확인 요청이 있었다면 그 응답은 이제 버린다
  hideResumeCard();
  resetTrackSelectionUI(); // filters-container/트랙 카드가 이전 학생 선택 그대로 남아 다음 학생에게 보이지 않게
  renderStudentVerification();
}

// 앱 시작 시 한 번 호출한다: 로그인 유지 정보가 있으면 학번/이름 입력을 채우고 기존 확인 흐름
// (checkIdentityForSession)을 그대로 태운다 - wrongPool 등 실제 데이터는 로컬 값을 신뢰하지 않고
// 이 흐름을 통해 Supabase 에서 다시 조회한다. 확인에 실패하면(탈퇴/오류 등) 로그인 유지 정보를 지우고
// 학생 확인 화면을 그대로 둔다 - 빈 학습 홈이나 깨진 화면을 보여주지 않는다.
export async function attemptAutoLogin() {
  const saved = readLoginInfo();
  if (!saved) return;
  const idInput = document.getElementById('student-id-input');
  const nameInput = document.getElementById('student-name-input');
  if (!idInput || !nameInput) return;
  idInput.value = saved.studentNo;
  nameInput.value = saved.studentName;
  await checkIdentityForSession();
  if (state.studentVerification !== 'verified') {
    clearLoginInfo();
    idInput.value = '';
    nameInput.value = '';
  }
}

// 문제 풀이에서 로비로 돌아온 뒤: 저장이 모두 끝나기를 기다렸다가 DB 의 최근 세션으로 카드를 다시 그린다.
export async function refreshResumeCard() {
  const profileKey = state.profile?.profileKey;
  if (!profileKey) return;
  await whenSessionIdle();
  try {
    const session = await getSession(profileKey);
    if (state.profile?.profileKey !== profileKey) return;
    state.session = session;
    renderResumeCard();
  } catch (error) {
    hideResumeCard();
    showConnectionError(error);
  }
}

// ---------------------------------------------------------------------
// 이어서 학습하기 / 처음부터 시작
// ---------------------------------------------------------------------

// 로비 카드와 입력 학생이 같은지 확인한다. 다르면 카드를 숨기고 다시 확인하게 한다.
function verifyIdentityOrReset() {
  const identity = readIdentity();
  if (validateIdentity(identity) === null && isSameIdentity(identity) && state.profile) return true;
  hideResumeCard();
  state.session = null;
  showStartMessage('학번 또는 이름이 바뀌었습니다. 입력을 확인해 주세요.');
  void checkIdentityForSession();
  return false;
}

const UNRESUMABLE_MESSAGE =
  '이전 학습 기록의 문제를 모두 불러올 수 없어 이어서 학습할 수 없습니다. "아니오"를 눌러 처음부터 시작해 주세요.';

// 세션 + 조회한 문제 행 -> { questions, index } 또는 null (조용히 잘못된 세트로 이어가지 않는다).
function restoreQuestions(session, rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const questions = session.questionIds.map((id) => byId.get(id));
  if (questions.some((question) => !question)) return null; // 누락된 문제가 있으면 이어하기 불가
  if (questions.some((question) => question.license_class !== session.licenseClass)) return null;
  if (session.trackType === 'A') {
    const present = new Set(questions.map((question) => question.subject));
    if (!(session.selectedSubjects ?? []).every((subject) => present.has(subject))) return null;
  }
  let index;
  if (session.currentQuestionId !== null && session.currentQuestionId !== undefined) {
    index = session.questionIds.indexOf(session.currentQuestionId);
    if (index === -1) return null;
  } else {
    index = session.currentQuestionIndex; // 현재 문제 id 가 없을 때만 저장된 순번을 보조로 쓴다
    if (!Number.isInteger(index) || index < 0 || index >= questions.length) return null;
  }
  return { questions, index };
}

export async function resumeRecentSession() {
  if (isBusy || state.view !== 'lobby') return;
  clearStartMessage();
  if (!verifyIdentityOrReset()) return;
  const profileKey = state.profile.profileKey;

  isBusy = true;
  setResumeCardBusy(true);
  setStartLoading(true);
  try {
    await whenSessionIdle();
    const session = await getSession(profileKey); // 최신 세션을 다시 읽는다
    if (state.view !== 'lobby' || state.profile?.profileKey !== profileKey) return;
    if (!isResumable(session)) {
      state.session = session;
      renderResumeCard();
      showStartMessage('이어서 학습할 기록이 없습니다.');
      return;
    }
    const rows = await fetchQuestionsByIds(session.questionIds);
    if (state.view !== 'lobby' || state.profile?.profileKey !== profileKey) return;
    const restored = restoreQuestions(session, rows);
    if (!restored) {
      state.session = session; // 세션은 지우지 않는다 (학생이 "아니오"로 직접 정리한다)
      showStartMessage(UNRESUMABLE_MESSAGE);
      return;
    }

    hideConnectionError();
    state.session = session;
    // 답안은 복원하지 않는다: 빈 답안으로 문제 세트와 위치만 되돌린다.
    resetQuizState();
    state.quiz.questions = restored.questions;
    state.quiz.currentIndex = restored.index;
    state.quiz.origin = {
      track: session.trackType,
      licenseClass: session.licenseClass,
      subject: session.trackType === 'B' ? session.subject : null,
      subjects: session.trackType === 'A' ? [...(session.selectedSubjects ?? [])] : [],
      year: session.year,
      examRound: session.examRound,
    };
    // 로비 선택도 이어하는 시험에 맞춘다 (로비로 돌아왔을 때 같은 선택이 보이도록)
    setCurrentTrack(session.trackType);
    state.licenseClass = session.licenseClass;
    if (session.trackType === 'A') state.filters.subjects = [...(session.selectedSubjects ?? [])];
    else state.filters.subject = session.subject;
    state.filters.year = session.year;
    state.filters.examRound = session.examRound;
    hideResumeCard();
    showQuiz(`${state.profile.studentNo} (${state.profile.studentName})`);
    renderCurrentQuestion();
    void syncLobbyFromState();
  } catch (error) {
    showConnectionError(error);
  } finally {
    isBusy = false;
    setResumeCardBusy(false);
    setStartLoading(false);
  }
}

// "아니오": 저장된 세션을 지우고 카드를 숨긴다. 삭제에 실패하면 카드를 그대로 두고 안내한다.
export async function clearAndStartFresh() {
  if (isBusy || state.view !== 'lobby') return;
  clearStartMessage();
  if (!verifyIdentityOrReset()) return;
  isBusy = true;
  setResumeCardBusy(true);
  try {
    const cleared = await clearRecentSession();
    if (!cleared) {
      showStartMessage('이전 학습 기록을 지우지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    clearSessionSaveError();
    state.session = null;
    hideResumeCard();
  } finally {
    isBusy = false;
    setResumeCardBusy(false);
  }
}
