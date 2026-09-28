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
// 정답 키 정규화. questions.correct_answer 는 대부분 'ga'/'na'/'sa'/'aa' 이지만 일부 행(100건)은
// 원 문자('㉮' '㉯' '㉴' '㉵')로 저장되어 있다. 채점 비교 직전에 이 함수를 거친다 (DB 값은 수정하지 않는다).
// 'ga'/'na'/'sa'/'aa'(공백, 대소문자 무시)와 원 문자를 ga/na/sa/aa 로 바꾸고, 그 밖의 값은 null.
// ---------------------------------------------------------------------
const ANSWER_SYMBOL_TO_KEY = Object.fromEntries(Object.entries(ANSWER_LABELS).map(([key, label]) => [label, key]));

export function normalizeAnswerKey(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (Object.hasOwn(ANSWER_SYMBOL_TO_KEY, text)) return ANSWER_SYMBOL_TO_KEY[text];
  const key = text.toLowerCase();
  return ANSWER_KEYS.includes(key) ? key : null;
}

// ---------------------------------------------------------------------
// 시험지 선택지 계산. fetchQuestionMetadata 의 combinations([{ subject, year, examRound, count }])에서
// 실제 존재하는 연도/회차만 골라, 현재 선택이 유효하면 유지하고 아니면 기본값을 정한다.
// 기본값: 가장 최신 연도 -> 그 연도에서 가장 이른 회차. (연도/회차를 코드에 고정하지 않는다.)
// 반환: { years(최신순), examRounds(선택 연도의 회차, 번호순), year, examRound } (없으면 null)
// ---------------------------------------------------------------------
const compareRounds = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

export function resolveFilterSelection(combinations, current = {}) {
  const list = Array.isArray(combinations) ? combinations : [];
  const years = [...new Set(list.map((item) => item.year))].sort((a, b) => b - a);
  const year = years.includes(current.year) ? current.year : (years[0] ?? null);
  const examRounds = [...new Set(list.filter((item) => item.year === year).map((item) => item.examRound))].sort(compareRounds);
  const examRound = examRounds.includes(current.examRound) ? current.examRound : (examRounds[0] ?? null);
  return { years, examRounds, year, examRound };
}

// 선택한 과목이 모두 실제로 있는 연도/회차만 남긴다 (Track A 모의고사용).
// combinations: [{ subject, year, examRound, count }], subjects: 선택한 과목 목록.
// 반환: [{ year, examRound }] (resolveFilterSelection 에 그대로 넣을 수 있다). 과목이 없으면 빈 배열.
export function commonCombinations(combinations, subjects) {
  const wanted = [...new Set(Array.isArray(subjects) ? subjects : [])];
  if (wanted.length === 0 || !Array.isArray(combinations)) return [];
  const bySheet = new Map();
  for (const item of combinations) {
    const key = JSON.stringify([item.year, item.examRound]);
    if (!bySheet.has(key)) bySheet.set(key, new Set());
    bySheet.get(key).add(item.subject);
  }
  const result = [];
  for (const [key, present] of bySheet) {
    if (wanted.every((subject) => present.has(subject))) {
      const [year, examRound] = JSON.parse(key);
      result.push({ year, examRound });
    }
  }
  return result;
}

// ---------------------------------------------------------------------
// Track A 채점 (순수 함수). 선택/정답 모두 normalizeAnswerKey 를 거친다.
//  - correct: 선택 === 정답, incorrect: 선택했지만 다름, unanswered: 선택 없음(점수에서는 오답과 같이 맞힌 수에 안 들어감)
//  - invalid: 정답 데이터를 알 수 없는 문항. 정답/오답 어느 쪽으로도 판정하지 않는다.
// 점수는 V65 와 같이 Math.round(맞힌 수 / 전체 문항 수 * 100). 과목별 문항 수는 실제 문제 목록에서 센다.
// ---------------------------------------------------------------------
export function gradeTrackA(questions, markedAnswers) {
  const items = [];
  const subjects = new Map(); // 처음 나온 순서 유지
  questions.forEach((question, index) => {
    const selectedKey = normalizeAnswerKey(markedAnswers[question.id]);
    const correctKey = normalizeAnswerKey(question.correct_answer);
    let result;
    if (!correctKey) result = 'invalid';
    else if (!selectedKey) result = 'unanswered';
    else result = selectedKey === correctKey ? 'correct' : 'incorrect';
    items.push({ questionId: question.id, index, subject: question.subject, selectedKey, correctKey, result });

    if (!subjects.has(question.subject)) {
      subjects.set(question.subject, { subject: question.subject, total: 0, correct: 0, incorrect: 0, unanswered: 0, invalid: 0 });
    }
    const row = subjects.get(question.subject);
    row.total += 1;
    row[result] += 1;
  });

  const count = (result) => items.filter((item) => item.result === result).length;
  const total = questions.length;
  const correctCount = count('correct');
  return {
    total,
    correctCount,
    incorrectCount: count('incorrect'),
    unansweredCount: count('unanswered'),
    invalidCount: count('invalid'),
    score: total === 0 ? 0 : Math.round((correctCount / total) * 100),
    bySubject: [...subjects.values()].map((row) => ({
      ...row,
      score: row.total === 0 ? 0 : Math.round((row.correct / row.total) * 100),
    })),
    items,
  };
}

// ---------------------------------------------------------------------
// 이미지 URL 정규화. DB 에 저장된 URL 앞뒤에 공백/줄바꿈이 섞여 있는 경우가 있다.
// 문자열이 아니거나, 공백뿐이거나, 'NULL'/'null' 문자열이면 이미지 없음('')으로 본다.
// URL 자체는 DB 값을 그대로 쓴다 (bucket 이름 추론이나 URL 조합을 하지 않는다).
// ---------------------------------------------------------------------
export function normalizeImageUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return url === 'NULL' || url === 'null' ? '' : url;
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

// ---------------------------------------------------------------------
// HELPER("헷갈리기 쉬운 점") 표시. questions 의 helper_* 컬럼(읽기 전용)을 학생 화면용 HTML 로 만든다.
//  - helper_needed === true 이고 실제로 쓸 수 있는 항목이 하나 이상 있을 때만 블록을 만든다.
//    (false / null(아직 HELPER 미처리) / true 인데 내용 없음 -> 빈 문자열: 문구도 빈 박스도 만들지 않는다.)
//  - 데이터가 어떤 모양이어도(null, 배열 아님, 객체 아님, 빈 문자열 ...) 예외를 던지지 않고 그 항목만 건너뛴다.
//  - DB 문자열은 그대로 HTML 에 넣지 않는다: 모두 escape 한 뒤, BASE 해설과 같은 표기인 <sub>/<sup> 짝만 되살리고
//    formatBarText(BASE 와 같은 윗선 표기 처리)를 적용한다. 수식($...$)은 호출하는 쪽이 renderMath 로 렌더링한다.
// ---------------------------------------------------------------------
const HELPER_GROUPS = [
  { key: 'helper_symbols', title: '기호', pairs: true },
  { key: 'helper_confusing_terms', title: '용어', pairs: true },
  { key: 'helper_units', title: '단위', pairs: true },
  { key: 'helper_common_mistake', title: '흔한 실수', pairs: false },
];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 표시할 수 있는 HELPER 그룹만 돌려준다: [{ title, entries: [{ label, meaning }] | mistakes: [text] }]. 없으면 [].
export function getHelperGroups(question) {
  if (!question || question.helper_needed !== true) return [];
  const groups = [];
  for (const { key, title, pairs } of HELPER_GROUPS) {
    const list = Array.isArray(question[key]) ? question[key] : [];
    if (pairs) {
      const entries = [];
      for (const item of list) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const label = cleanText(item.label);
        const meaning = cleanText(item.meaning);
        if (label || meaning) entries.push({ label, meaning });
      }
      if (entries.length > 0) groups.push({ title, entries });
    } else {
      const mistakes = list.map(cleanText).filter(Boolean);
      if (mistakes.length > 0) groups.push({ title, mistakes });
    }
  }
  return groups;
}

// 안전한 인라인 HTML: 전부 escape 하고, 짝이 맞는 <sub>..</sub>, <sup>..</sup> 만 되살린다.
function escapeKeepingSubSup(text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return escaped.replace(/&lt;(sub|sup)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, (match, tag, inner) => `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`);
}

const helperText = (text) => formatBarText(escapeKeepingSubSup(text));

// BASE 해설 블록 아래에 붙이는 HELPER 블록. 표시할 내용이 없으면 ''.
export function getHelperHtml(question) {
  const groups = getHelperGroups(question);
  if (groups.length === 0) return '';
  const body = groups
    .map((group) => {
      const rows = group.entries
        ? group.entries
            .map(({ label, meaning }) => {
              const head = label ? `<span class="font-extrabold text-white">${helperText(label)}</span>` : '';
              const sep = label && meaning ? ' <span class="text-slate-500">—</span> ' : '';
              return `<li class="text-sm text-slate-300 font-medium leading-relaxed">${head}${sep}${meaning ? helperText(meaning) : ''}</li>`;
            })
            .join('')
        : group.mistakes.map((text) => `<li class="text-sm text-slate-300 font-medium leading-relaxed">${helperText(text)}</li>`).join('');
      return `<div class="space-y-1.5"><div class="text-[11px] font-bold text-slate-400">${group.title}</div><ul class="space-y-1.5 list-disc pl-4 marker:text-amber-400/70">${rows}</ul></div>`;
    })
    .join('');
  return (
    '<!-- 4. 헷갈리기 쉬운 점(HELPER) -->' +
    '<div data-helper-block class="bg-[#0B132B]/60 p-5 rounded-2xl border border-amber-500/30 space-y-3 mt-4 animate-fadeIn">' +
    '<div class="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider">' +
    '<i class="fa-solid fa-triangle-exclamation"></i>' +
    '<span>헷갈리기 쉬운 점</span>' +
    '</div>' +
    body +
    '</div>'
  );
}

// 정답을 확인했거나 제출한 뒤에 보이는 해설 전체: 기존 3단 BASE 블록 + (있을 때만) HELPER 블록.
// Track A 제출 후 복습과 Track B 정답 후 해설이 함께 쓴다 (Track C 도 같은 함수를 쓸 수 있다).
export function getExplanationWithHelperHtml(question) {
  return getExplanationBlocksHtml(question) + getHelperHtml(question);
}

// ---------------------------------------------------------------------
// "내 학습 진단" 집계 (순수 함수). state.wrongPool.activeQuestions(지금 안 풀린 오답의 문제 행 + wrongCount)만 본다.
// cleared 오답이나 정답 이력은 절대 보지 않는다 - 성적/취약도 분석이 아니라 "지금 무엇이 남았는가" 기준의 복습 방향 제시다.
// 복잡한 취약도 알고리즘은 쓰지 않는다: 1차는 개수, 동률이면 wrong_count 합, 그래도 동률이면 문자열 순서.
// ---------------------------------------------------------------------
function normalizeLearningTopic(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null; // null/undefined/''/공백(매핑 없음) -> 진단 대상에서 제외
}

// 선택한 급수 안에서 과목별 active 오답 개수. subjectOrder(표준 과목 순서)에 있는 과목을 먼저, 그 외는 가나다순으로 뒤에 붙인다.
export function groupActiveQuestionsBySubject(activeQuestions, licenseClass, subjectOrder) {
  const bySubject = new Map();
  for (const question of activeQuestions) {
    if (question.license_class !== licenseClass) continue;
    if (!bySubject.has(question.subject)) bySubject.set(question.subject, { subject: question.subject, count: 0 });
    bySubject.get(question.subject).count += 1;
  }
  const known = subjectOrder.filter((subject) => bySubject.has(subject)).map((subject) => bySubject.get(subject));
  const extraKeys = [...bySubject.keys()].filter((subject) => !subjectOrder.includes(subject)).sort((a, b) => a.localeCompare(b, 'ko'));
  return [...known, ...extraKeys.map((subject) => bySubject.get(subject))];
}

// 선택한 급수+과목 안에서 learning_topic 별 active 오답을 묶는다. 매핑이 없는 문제(question.learningTopic 이 비었거나
// 공백뿐 - track-c-actions.js 의 loadActiveWithQuestions 가 selfstudy_question_topics 조회 실패/누락 시 null 로 남긴다)는
// 별도로 센다(withoutTopic) - 목록에서는 빠지지만 존재 자체가 사라지지는 않는다(오답 기록 자체는 그대로 유지).
// concept_tag 로 되돌리는 fallback 은 하지 않는다 - 매핑이 없으면 없는 대로 취급한다.
// 우선순위: 문제 수 desc -> wrong_count 합 desc -> 문자열(ko-KR).
export function groupActiveQuestionsByLearningTopic(activeQuestions, licenseClass, subject) {
  const scoped = activeQuestions.filter((question) => question.license_class === licenseClass && question.subject === subject);
  const byTopic = new Map();
  let withoutTopic = 0;
  for (const question of scoped) {
    const topic = normalizeLearningTopic(question.learningTopic);
    if (!topic) {
      withoutTopic += 1;
      continue;
    }
    if (!byTopic.has(topic)) byTopic.set(topic, { topic, count: 0, wrongCountSum: 0 });
    const row = byTopic.get(topic);
    row.count += 1;
    row.wrongCountSum += Number.isFinite(question.wrongCount) ? question.wrongCount : 0;
  }
  const topics = [...byTopic.values()].sort(
    (a, b) => b.count - a.count || b.wrongCountSum - a.wrongCountSum || a.topic.localeCompare(b.topic, 'ko'),
  );
  return { topics, withoutTopic, total: scoped.length };
}

// "우선 복습 영역" 표시 목록: 기본 3개, 3위와 count(active 오답 수)가 같은 topic 은 동률로 포함, 최대 5개.
// topics 는 이미 groupActiveQuestionsByLearningTopic 이 count desc -> wrongCountSum desc -> 이름순으로 정렬해 둔 것을 받는다.
// "전체 보기" 토글 없이 이 함수 하나의 결과만 그대로 보여준다 (다른 topic 으로 채워 넣는 padding 은 하지 않는다).
const PRIORITY_BASE_COUNT = 3;
const PRIORITY_MAX_COUNT = 5;
export function pickPriorityLearningTopics(topics) {
  if (topics.length <= PRIORITY_BASE_COUNT) return topics;
  const cutoff = topics[PRIORITY_BASE_COUNT - 1].count;
  const result = [];
  for (const row of topics) {
    if (result.length < PRIORITY_BASE_COUNT) {
      result.push(row);
      continue;
    }
    if (result.length >= PRIORITY_MAX_COUNT || row.count !== cutoff) break;
    result.push(row);
  }
  return result;
}

// 로비 요약의 "우선 복습" 한 곳(급수+과목 조합). 문제 수가 가장 많은 조합, 동률이면 licenseOrder -> subjectOrder 순.
// active 오답이 하나도 없으면 null.
export function pickPriorityReview(activeQuestions, licenseOrder, subjectOrder) {
  const counts = new Map(); // "license\u0000subject" -> count
  for (const question of activeQuestions) {
    const key = `${question.license_class}\u0000${question.subject}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = null;
  for (const [key, count] of counts) {
    const [license, subject] = key.split('\u0000');
    const licenseRank = licenseOrder.indexOf(license);
    const subjectRank = subjectOrder.indexOf(subject);
    const candidate = {
      license,
      subject,
      count,
      licenseRank: licenseRank === -1 ? Infinity : licenseRank,
      subjectRank: subjectRank === -1 ? Infinity : subjectRank,
    };
    const better =
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.licenseRank < best.licenseRank) ||
      (candidate.count === best.count && candidate.licenseRank === best.licenseRank && candidate.subjectRank < best.subjectRank);
    if (better) best = candidate;
  }
  return best;
}
