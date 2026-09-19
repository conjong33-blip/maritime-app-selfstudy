// 이벤트 위임. index.html 의 [data-action] 요소 클릭을 document 하나에서 받아 처리기로 넘긴다.
// 지금 연결된 action: 로비 선택(select-license-class / select-track(A,B) / select-subject-b,
// 연도·회차 select 의 change) 과 문제 화면 조작(mark-answer / prev-question / next-question).
// 나머지는 이후 단계에서 채운다. (교사용 action 은 두지 않는다.)

import { markAnswer, goToNextQuestion, goToPrevQuestion } from './quiz-actions.js';
import { changeExamRound, changeYear, selectLicenseClass, selectSubjectB, selectTrack } from './lobby-actions.js';

const notImplemented = null;

// action 이름(= data-action 값) -> 처리기. 처리기 시그니처: ({ action, value, element, event }) => void
// 값이 함수가 아니면(notImplemented) 아무 일도 하지 않는다.
export const actionHandlers = {
  // 로비
  'select-license-class': ({ value }) => selectLicenseClass(value), // data-value: '3급' | '4급'
  'select-track': ({ value }) => selectTrack(value), // data-value: 'A' | 'B' (C 는 아직 연결하지 않음)
  'select-subject-b': ({ value }) => selectSubjectB(value), // data-value: 과목명
  'start-selected-exam': notImplemented,
  'resume-session': notImplemented,
  'clear-and-start-fresh': notImplemented,
  'logout-to-lobby': notImplemented, // 헤더 버튼 2개가 같은 action

  // 문제풀이
  'mark-answer': ({ value }) => markAnswer(value), // data-value: 'ga' | 'na' | 'sa' | 'aa'
  'prev-question': () => goToPrevQuestion(),
  'next-question': () => goToNextQuestion(),
  'check-track-b-answer': notImplemented,
  'submit-track-a-exam': notImplemented,
  'return-to-summary-list': notImplemented,
};

// <select> 값이 바뀔 때 쓰는 action. change 이벤트로만 처리하고, value 는 선택한 option 의 값이다.
export const changeHandlers = {
  'select-year': ({ value }) => changeYear(value),
  'select-exam-round': ({ value }) => changeExamRound(value),
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
