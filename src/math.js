// KaTeX 수식 렌더링. index.html 에서 CDN 으로 불러온 auto-render(window.renderMathInElement)를 사용한다.
// DOM 을 직접 바꾸므로 utils.js(순수 함수)가 아니라 이 파일에 둔다. V65 renderMath 와 delimiter 설정이 같다.
const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

// element 또는 element id 를 받아 그 안의 수식을 렌더링한다.
// KaTeX 가 아직 없거나 렌더링에 실패해도 예외를 밖으로 던지지 않는다.
export function renderMath(target) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  if (typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(element, { delimiters: MATH_DELIMITERS, throwOnError: false });
  } catch (error) {
    console.error('KaTeX 렌더링 실패', error);
  }
}
