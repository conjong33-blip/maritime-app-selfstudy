// 이벤트 위임. index.html 의 [data-action] 요소 클릭을 document 하나에서 받아 처리기로 넘긴다.
// 지금 연결된 action: 로비 선택(select-license-class / select-track(A,B,C) / select-subject-b,
// 연도·회차 select 와 Track A 과목 체크박스의 change), 시작(start-selected-exam, Track A/B), 문제 화면 조작
// (mark-answer / prev-question / next-question), Track B 정답 확인, Track A 제출/결과/복습, 로비 복귀(logout-to-lobby),
// 교사용 사용자 관리(admin-*, admin-actions.js).

import { markAnswer, goToNextQuestion, goToPrevQuestion } from './quiz-actions.js';
import { changeExamRound, changeYear, selectLicenseClass, selectSubjectB, selectTrack, toggleSubjectA } from './lobby-actions.js';
import { returnToLobby, startSelectedExam } from './exam-actions.js';
import { checkTrackBAnswer } from './track-b-actions.js';
import { finishTrackC, retryClearWrong, selectTrackCLicense, selectTrackCMode } from './track-c-actions.js';
import { logoutStudent, checkIdentityForSession, clearAndStartFresh, resumeRecentSession } from './session-actions.js';
import {
  selectDiagnosisLicense,
  selectDiagnosisSubject,
  selectDiagnosisTopic,
  startDiagnosisRetryAction,
  startRelatedLearningFromCompletion,
} from './diagnosis-actions.js';
import {
  cancelSubmitTrackA,
  confirmSubmitTrackA,
  requestSubmitTrackA,
  retryTrackASave,
  returnToSummaryList,
  reviewTrackAQuestion,
} from './track-a-actions.js';
import {
  cancelDeleteProfile,
  cancelEditProfile,
  closeAdminScreen,
  confirmDeleteProfile,
  openAdminPin,
  saveEditProfile,
  startDeleteProfile,
  startEditProfile,
  submitAdminPin,
} from './admin-actions.js';

const notImplemented = null;

// action 이름(= data-action 값) -> 처리기. 처리기 시그니처: ({ action, value, element, event }) => void
// 값이 함수가 아니면(notImplemented) 아무 일도 하지 않는다.
export const actionHandlers = {
  // 로비
  'select-license-class': ({ value }) => selectLicenseClass(value), // data-value: '3급' | '4급'
  'select-track': ({ value }) => selectTrack(value), // data-value: 'A' | 'B' (C 는 아직 연결하지 않음)
  'select-subject-b': ({ value }) => selectSubjectB(value), // data-value: 과목명
  'select-track-c-license': ({ value }) => selectTrackCLicense(value), // data-value: '3급' | '4급' (Track C 오답소탕 급수)
  'start-selected-exam': () => startSelectedExam(), // Track B 만 시작 (문제 로드 + 문제 풀이 화면 전환)
  'verify-student': () => checkIdentityForSession(), // 상단 "확인" 버튼 - 학번/이름 change 때와 같은 흐름을 다시 탄다
  'logout-student': () => logoutStudent(), // 학습 홈의 "로그아웃" - 화면 상태+로그인 유지 정보만 초기화, DB profile/오답/세션은 그대로
  'resume-session': () => resumeRecentSession(), // 최근 세션의 문제 세트와 위치로 이어서 학습 (답안은 복원하지 않음)
  'clear-and-start-fresh': () => clearAndStartFresh(), // 최근 세션 삭제 ("아니오")
  'logout-to-lobby': () => returnToLobby(), // 문제 풀이를 끝내고 로비로 (헤더 버튼 2개가 같은 action)

  // 문제풀이
  'mark-answer': ({ value }) => markAnswer(value), // data-value: 'ga' | 'na' | 'sa' | 'aa'
  'prev-question': () => goToPrevQuestion(),
  'next-question': () => goToNextQuestion(),
  'check-track-b-answer': () => checkTrackBAnswer(), // Track B 정답 확인 (오답만 recordWrong 으로 기록)
  'submit-track-a-exam': () => requestSubmitTrackA(), // 최종 제출 확인 창 열기
  'confirm-submit-track-a': () => confirmSubmitTrackA(), // 확인 -> 채점 + 오답 기록(recordWrong)
  'cancel-submit-track-a': () => cancelSubmitTrackA(),
  'retry-track-a-save': () => retryTrackASave(), // 오답 기록에 실패한 문항만 다시 저장
  'review-track-a-question': ({ value }) => reviewTrackAQuestion(value), // data-value: 문제 위치(0부터)
  'return-to-summary-list': () => returnToSummaryList(),
  'finish-track-c': () => finishTrackC(), // Track C 마지막 문제 정리 후 남은 오답을 다시 확인
  'retry-track-c-clear': () => retryClearWrong(), // 오답 정리(clearWrong)에 실패한 문제만 다시 저장
  'start-new-problems-from-completion': () => startRelatedLearningFromCompletion(), // 완료 화면의 "새 문제로 도전하기" - 방금 끝낸 학습영역으로 related-learning 재사용
  'select-track-c-mode': ({ value }) => selectTrackCMode(value), // data-value: 'full'(한번에 소탕하기) | 'byTopic'(나누어 소탕하기)

  // 영역별 오답 소탕 (구 "내 학습 진단" 패널 - 로직/집계 그대로, 진입점만 오답소탕 흐름 안으로 옮겼다)
  'select-diagnosis-license': ({ value }) => selectDiagnosisLicense(value), // data-value: '3급' | '4급'
  'select-diagnosis-subject': ({ value }) => selectDiagnosisSubject(value), // data-value: 과목명
  'select-diagnosis-topic': ({ value }) => selectDiagnosisTopic(value), // data-value: learning_topic
  'start-diagnosis-retry': () => startDiagnosisRetryAction(), // 선택한 학습영역의 오답만 Track C 로 다시 풀기
  // "새 문제로 도전하기"(startRelatedLearning)는 이 화면(나누어 소탕하기의 topic 선택)에는 더 이상 없다 -
  // 오답소탕 완료 화면의 'start-new-problems-from-completion' 으로 옮겨졌다(위 참고, 중복 제거).

  // 교사용 사용자 관리 (admin-actions.js) - 사전등록/접근제한 시스템이 아니다. 학번/이름 오타 수정, 불필요한
  // profile 삭제만 한다. PIN 은 메모리에만 유지(local-auth.js 와 무관, localStorage 저장 없음).
  'admin-open-pin': () => openAdminPin(), // 학생 확인 화면 하단 "교사 관리"
  'admin-submit-pin': () => submitAdminPin(), // PIN 화면의 "확인" - list RPC 성공 자체가 PIN 검증
  'admin-back-to-lobby': () => closeAdminScreen(), // "대기실로 돌아가기" - PIN/목록 등 관리자 상태 전부 초기화
  'admin-start-edit': ({ value }) => startEditProfile(value), // data-value: profile.id
  'admin-cancel-edit': () => cancelEditProfile(),
  'admin-save-edit': ({ value }) => saveEditProfile(value), // data-value: profile.id
  'admin-start-delete': ({ value }) => startDeleteProfile(value), // data-value: profile.id (삭제 확인 문구만 연다)
  'admin-cancel-delete': () => cancelDeleteProfile(),
  'admin-confirm-delete': ({ value }) => confirmDeleteProfile(value), // data-value: profile.id
};

// <select> 값이 바뀔 때 쓰는 action. change 이벤트로만 처리하고, value 는 선택한 option 의 값이다.
export const changeHandlers = {
  'select-year': ({ value }) => changeYear(value),
  'select-exam-round': ({ value }) => changeExamRound(value),
  'check-identity': () => checkIdentityForSession(), // 학번/이름 입력 확정(blur, Enter) -> 최근 세션 확인
  'toggle-subject-a': ({ value, element }) => toggleSubjectA(value, element.checked), // Track A 과목 체크박스
  'admin-pin-confirm': () => submitAdminPin(), // PIN 입력 확정(blur, Enter) - 학번/이름의 check-identity 와 같은 관례
};

function dispatch(table, event, getValue) {
  if (!(event.target instanceof Element)) return;
  const element = event.target.closest('[data-action]');
  if (!element) return;

  const action = element.dataset.action;
  const handler = Object.hasOwn(table, action) ? table[action] : null;
  if (typeof handler !== 'function') return;

  handler({ action, value: getValue(element), element, event });
}

function handleClick(event) {
  dispatch(actionHandlers, event, (element) => element.dataset.value);
}

function handleChange(event) {
  dispatch(changeHandlers, event, (element) => element.value);
}

// 클릭/변경 위임 등록. 해제 함수를 돌려준다.
export function registerEvents(root = document) {
  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  return () => {
    root.removeEventListener('click', handleClick);
    root.removeEventListener('change', handleChange);
  };
}
