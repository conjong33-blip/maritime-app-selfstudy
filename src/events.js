// 이벤트 위임. index.html 의 [data-action] 요소 클릭을 document 하나에서 받아 처리기로 넘긴다.
// 아직 어떤 동작도 구현하지 않았다. 각 action 의 실제 처리는 이후 단계에서 채운다.
// (교사용 action 은 두지 않는다.)

const notImplemented = null;

// action 이름(= data-action 값) -> 처리기. 처리기 시그니처: ({ action, value, element, event }) => void
// 값이 함수가 아니면(notImplemented) 아무 일도 하지 않는다.
export const actionHandlers = {
  // 로비
  'select-license-class': notImplemented, // data-value: '3급' | '4급'
  'select-track': notImplemented, // data-value: 'A' | 'B' | 'C'
  'select-subject-b': notImplemented, // data-value: 과목명
  'start-selected-exam': notImplemented,
  'resume-session': notImplemented,
  'clear-and-start-fresh': notImplemented,
  'logout-to-lobby': notImplemented, // 헤더 버튼 2개가 같은 action

  // 문제풀이
  'mark-answer': notImplemented, // data-value: 'ga' | 'na' | 'sa' | 'aa'
  'prev-question': notImplemented,
  'next-question': notImplemented,
  'check-track-b-answer': notImplemented,
  'submit-track-a-exam': notImplemented,
  'return-to-summary-list': notImplemented,
};

function handleClick(event) {
  if (!(event.target instanceof Element)) return;
  const element = event.target.closest('[data-action]');
  if (!element) return;

  const action = element.dataset.action;
  const handler = Object.hasOwn(actionHandlers, action) ? actionHandlers[action] : null;
  if (typeof handler !== 'function') return;

  handler({ action, value: element.dataset.value, element, event });
}

// 클릭 위임 등록. 해제 함수를 돌려준다.
export function registerEvents(root = document) {
  root.addEventListener('click', handleClick);
  return () => root.removeEventListener('click', handleClick);
}
