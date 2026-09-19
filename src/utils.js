// 순수 함수 모음. DOM, Supabase, 전역 상태, localStorage에 의존하지 않는다.
// V65(legacy/V65_original.html)에서 옮긴 함수는 출력이 V65와 동일해야 한다.
// renderMath 는 KaTeX 로 DOM 을 직접 바꾸므로 이 파일에 두지 않는다.

// ---------------------------------------------------------------------
// 보기 키 / 표시 라벨 (V65 는 korMap 을 함수마다 따로 정의했다)
// ---------------------------------------------------------------------
export const ANSWER_KEYS = ['ga', 'na', 'sa', 'aa'];

const ANSWER_LABELS = { ga: '㉮', na: '㉯', sa: '㉴', aa: '㉵' };

// 보기 키(ga/na/sa/aa)를 표시용 기호로 바꾼다. 선택하지 않았거나 알 수 없는 키는 '미선택'.
export function formatAnswerLabel(key) {
  return ANSWER_LABELS[key] ?? '미선택';
}

// ---------------------------------------------------------------------
// 수식 윗선(Overline) 및 기호 변환 (V65 formatBarText)
// V65 마지막 줄의 두 번째 replace(/\cdot/g)는 백슬래시 없는 정규식이라 실제로는
// 제어문자 U+0004 뒤에 'ot' 가 붙은 문자열에만 일치한다. 일반 문제 텍스트에는 나올 수 없는 입력이라 제거했다.
// (그 외 모든 입력에서 출력은 V65 와 동일하다.)
// ---------------------------------------------------------------------
export function formatBarText(text) {
if (!text) return "";
let formatted = text;
// 1. 한국어 기재 방식 처리: "EXPR (EXPR 위에 바 표시)" -> <span class="overline">EXPR</span>
const parenRegex = /([^\(]*)\(([^)]+)\s*위에\s*바\s*표시\)/g;
formatted = formatted.replace(parenRegex, function(match, pre, expr) {
let target = expr.trim();
let dotTarget = target.replace(/\*/g, '·');
if (pre.includes(target)) {
let escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
let targetRegex = new RegExp(escapedTarget, 'g');
pre = pre.replace(targetRegex, '<span class="overline">' + dotTarget + '</span>');
} else {
pre = pre + '<span class="overline">' + dotTarget + '</span>';
}
return pre;
});
// 2. functional 표기방식 처리: bar(EXPR) -> <span class="overline">EXPR</span>
formatted = formatted.replace(/bar\(([^)]+)\)/gi, function(match, expr) {
let dotExpr = expr.replace(/\*/g, '·');
return '<span class="overline">' + dotExpr + '</span>';
});
// 3. 접미사 표기방식 처리: EXPR bar (예: A bar -> <span class="overline">A</span>)
formatted = formatted.replace(/\b([A-Za-z0-9•·+.*\-()]+)\s+bar\b/gi, function(match, expr) {
let dotExpr = expr.replace(/\*/g, '·');
return '<span class="overline">' + dotExpr + '</span>';
});
// 4. LaTeX 표기방식 처리: \overline{EXPR} 및 \bar{EXPR} -> <span class="overline">EXPR</span>
// 이렇게 함으로써 KaTeX 전용 폰트가 아닌 기본 본문 폰트(Pretendard)를 그대로 유지하게 합니다.
formatted = formatted.replace(/\\overline\{([^}]+)\}/g, '<span class="overline">$1</span>');
formatted = formatted.replace(/\\bar\{([^}]+)\}/g, '<span class="overline">$1</span>');
formatted = formatted.replace(/overline\{([^}]+)\}/g, '<span class="overline">$1</span>');
formatted = formatted.replace(/bar\{([^}]+)\}/g, '<span class="overline">$1</span>');
formatted = formatted.replace(/\\bar\s+([A-Za-z0-9])/g, '<span class="overline">$1</span>');
// 5. LaTeX 수식 블록 기호 \( 및 \) 내부에서 과하게 감싸진 HTML 수식 기호 정리
// 만약 \( ... \) 또는 \\[ ... \\] 내부에 <span class="overline"> 이 주입되었다면 해당 수식 기호를 해제하여
// KaTeX가 태그를 수식으로 오인하지 않고, Pretendard 고유 폰트로 깔끔하게 표시하게 합니다.
formatted = formatted.replace(/\\\\\(([^)]*?<span[^>]*>.*?<\/span>.*?)\\\\\)/g, '$1');
formatted = formatted.replace(/\\\(([^)]*?<span[^>]*>.*?<\/span>.*?)\\\)/g, '$1');
// 6. LaTeX \cdot 이나 \\cdot 를 middle dot · 로 변환
formatted = formatted.replace(/\\cdot/g, '·');
return formatted;
}

// ---------------------------------------------------------------------
// 영어 과목 번역 블록 포맷 (V65 formatEnglishTranslation)
// ---------------------------------------------------------------------
export function formatEnglishTranslation(text) {
if (!text) return "이 문항에는 아직 등록된 영어 번역이 존재하지 않습니다.";
const match = text.match(/[㉮-㉿]/);
if (!match) {
return `<div class="text-[13px] text-slate-200 leading-relaxed">${formatBarText(text)}</div>`;
}
const splitIndex = match.index;
const questionPart = text.substring(0, splitIndex).trim();
const optionsPart = text.substring(splitIndex).trim();
const optionItems = [];
const optionRegex = /([㉮-㉿])\s*([^㉮-㉿]+)/g;
let optMatch;
while ((optMatch = optionRegex.exec(optionsPart)) !== null) {
const symbol = optMatch[1];
let val = optMatch[2].trim();
val = val.replace(/,\s*$/, "").trim();
optionItems.push(`<div class="flex items-start"><span class="text-emerald-400 font-bold mr-1.5">${symbol}</span><span>${formatBarText(val)}</span></div>`);
}
if (optionItems.length === 0) {
return `
<div class="space-y-3">
<div class="text-[13px] text-slate-200 leading-relaxed">${formatBarText(questionPart)}</div>
<div class="border-t border-dashed border-slate-700/60 my-2"></div>
<div class="text-[12px] text-slate-300 leading-relaxed">${formatBarText(optionsPart)}</div>
</div>
`;
}
return `
<div class="space-y-3 animate-fadeIn">
<div class="text-[13px] text-slate-200 leading-relaxed">${formatBarText(questionPart)}</div>
<div class="border-t border-dashed border-slate-700/60 my-2"></div>
<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] text-slate-300">
${optionItems.join('')}
</div>
</div>
`;
}

// ---------------------------------------------------------------------
// 3단 해설 블록 HTML 문자열 (V65 getExplanationBlocksHtml)
// 문제 객체 q 만으로 문자열을 만든다.
// ---------------------------------------------------------------------
export function getExplanationBlocksHtml(q) {
const isEnglish = (q.subject === '영어');
const displayTitle = isEnglish ? '영어 번역' : '쉬운 개념 정의';
const iconClass = isEnglish ? 'fa-solid fa-language text-emerald-400' : 'fa-solid fa-book-open text-teal-400';
const textCol = isEnglish ? 'text-emerald-400' : 'text-teal-400';
const displayContentHtml = isEnglish
? formatEnglishTranslation(q.english_translation)
: formatBarText(q.easy_definition || "이 문항에는 아직 수록된 핵심개념 요약집이 존재하지 않습니다.");
return '<!-- 1. 핵심 용어 블록 -->' +
'<div class="bg-[#0B132B] p-5 rounded-2xl border border-[#3A506B]/50 space-y-2 shadow-inner mb-4 animate-fadeIn">' +
'<div class="flex items-center space-x-2 text-[#5BC0BE] text-xs font-bold uppercase tracking-wider">' +
'<i class="fa-solid fa-tags"></i>' +
'<span>핵심 용어</span>' +
'</div>' +
'<div class="text-sm text-white font-extrabold leading-relaxed">' + formatBarText(q.concept_tag || "공학 개념") + '</div>' +
'</div>' +
'<!-- 2. ' + displayTitle + ' 블록 -->' +
'<div class="bg-[#0B132B]/80 p-5 rounded-2xl border border-[#3A506B]/40 space-y-2 mb-4 animate-fadeIn">' +
'<div class="flex items-center space-x-2 ' + textCol + ' text-xs font-bold uppercase tracking-wider">' +
'<i class="' + iconClass + '"></i>' +
'<span>' + displayTitle + '</span>' +
'</div>' +
'<div class="text-sm text-slate-300 font-semibold leading-relaxed">' + displayContentHtml + '</div>' +
'</div>' +
'<!-- 3. 정답 및 보기 원리 분석 블록 -->' +
'<div class="bg-[#0B132B]/60 p-5 rounded-2xl border border-[#3A506B]/30 space-y-2 animate-fadeIn">' +
'<div class="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">' +
'<i class="fa-solid fa-lightbulb"></i>' +
'<span>정답 및 보기 원리 분석</span>' +
'</div>' +
'<div class="text-sm text-slate-300 font-medium leading-relaxed space-y-2 whitespace-pre-line">' + formatBarText(q.explanation || "이 문항에는 아직 수록된 오답 해설집이 존재하지 않습니다.").replace(/㉮/g, '<b>㉮</b>').replace(/㉯/g, '<b>㉯</b>').replace(/㉴/g, '<b>㉴</b>').replace(/㉵/g, '<b>㉵</b>') + '</div>' +
'</div>';
}
