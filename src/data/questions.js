// public.questions 조회 (READ ONLY). insert/update/delete/upsert 와 questions 를 수정하는 rpc 는 쓰지 않는다.
// UI/state/DOM 에 의존하지 않는다. 행은 questions 컬럼 이름 그대로 돌려준다 (이미지 URL trim 은 렌더러 쪽 처리).
import { DataError, getSupabaseClient, unwrap } from './supabase.js';

// 실제 questions 컬럼 중 앱이 쓰는 것만 명시해서 조회한다 (search_vector 등 불필요한 컬럼 제외).
export const QUESTION_COLUMNS = [
  'id',
  'license_class',
  'subject',
  'year',
  'exam_round',
  'question_no',
  'question_text',
  'correct_answer',
  'concept_tag',
  'concept_tag_ko',
  'easy_definition',
  'explanation',
  'english_translation',
  'image_url',
  'option_ga',
  'option_na',
  'option_sa',
  'option_aa',
  'option_ga_img',
  'option_na_img',
  'option_sa_img',
  'option_aa_img',
];
const QUESTION_SELECT = QUESTION_COLUMNS.join(',');

// 한 번에 가져올 수 있는 문제 수 상한 (전체 문제은행을 실수로 가져오지 않게 한다)
export const MAX_QUESTIONS = 500;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requiredText(value, name) {
  const text = optionalText(value);
  if (text === null) throw new DataError(`${name} 값이 필요합니다.`);
  return text;
}

function optionalYear(value) {
  if (value === null || value === undefined || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year)) throw new DataError(`year 는 정수여야 합니다: ${value}`);
  return year;
}

function normalizeSubjects(subject, subjects) {
  const list = [subject, ...(Array.isArray(subjects) ? subjects : [])]
    .map(optionalText)
    .filter((item) => item !== null);
  return [...new Set(list)];
}

// 시험지 조건에 맞는 문제 목록.
// licenseClass 는 필수이고, subject(s) / year / examRound 중 하나 이상으로 범위를 좁혀야 한다.
// 값은 DB 에 저장된 그대로 쓴다 (exam_round 예: '제1회 정기시험').
// 정렬: year, exam_round, subject, question_no, id.
export async function fetchQuestions({ licenseClass, subject = null, subjects = [], year = null, examRound = null } = {}) {
  const grade = requiredText(licenseClass, 'licenseClass');
  const subjectList = normalizeSubjects(subject, subjects);
  const yearValue = optionalYear(year);
  const round = optionalText(examRound);
  if (subjectList.length === 0 && yearValue === null && round === null) {
    throw new DataError('subject(s), year, examRound 중 하나 이상으로 조회 범위를 좁혀야 합니다.');
  }

  let query = getSupabaseClient().from('questions').select(QUESTION_SELECT).eq('license_class', grade);
  if (subjectList.length === 1) query = query.eq('subject', subjectList[0]);
  else if (subjectList.length > 1) query = query.in('subject', subjectList);
  if (yearValue !== null) query = query.eq('year', yearValue);
  if (round !== null) query = query.eq('exam_round', round);
  query = query
    .order('year', { ascending: true })
    .order('exam_round', { ascending: true })
    .order('subject', { ascending: true })
    .order('question_no', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_QUESTIONS + 1);

  const rows = unwrap(await query, 'questions 조회');
  if (rows.length > MAX_QUESTIONS) {
    throw new DataError(`조회 결과가 ${MAX_QUESTIONS}건을 넘습니다. 조건을 더 좁혀 주세요.`);
  }
  return rows;
}

// 문제 id 목록으로 조회 (최근 세션 복원용, SELECT only). 조회 결과의 순서는 보장하지 않으므로
// 호출하는 쪽이 id 목록 순서대로 다시 정렬하고, 빠진 id 가 있는지도 확인해야 한다.
export async function fetchQuestionsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new DataError('문제 id 목록이 필요합니다.');
  if (ids.length > MAX_QUESTIONS) throw new DataError(`문제 id 는 ${MAX_QUESTIONS}개까지 조회할 수 있습니다.`);
  if (!ids.every((id) => Number.isInteger(id))) throw new DataError('문제 id 는 정수여야 합니다.');
  const unique = [...new Set(ids)];
  const query = getSupabaseClient().from('questions').select(QUESTION_SELECT).in('id', unique).limit(unique.length + 1);
  return unwrap(await query, 'questions id 조회');
}

// 서버의 max-rows 설정과 관계없이 전체를 가져오도록 count 를 기준으로 페이지를 이어서 읽는다.
async function fetchAllRows(buildQuery, context) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const response = await buildQuery().range(from, from + PAGE_SIZE - 1);
    const chunk = unwrap(response, context);
    rows.push(...chunk);
    const total = response.count ?? rows.length;
    if (chunk.length === 0 || rows.length >= total) return rows;
  }
  throw new DataError(`${context}: 페이지 수가 너무 많습니다.`);
}

// 실제 questions 데이터에 존재하는 과목 / 연도 / 회차 (연도·회차를 코드에 고정하지 않기 위한 조회).
// 반환: { subjects, years, examRounds, combinations: [{ subject, year, examRound, count }] }
//  - subjects: 가나다순, years: 최신 연도 먼저, examRounds: 회차 번호순
//  - combinations 로 "선택한 과목에 실제로 있는 연도/회차" 같은 종속 선택지를 계산할 수 있다.
export async function fetchQuestionMetadata({ licenseClass, subject = null } = {}) {
  const grade = requiredText(licenseClass, 'licenseClass');
  const subjectFilter = optionalText(subject);

  const rows = await fetchAllRows(() => {
    let query = getSupabaseClient()
      .from('questions')
      .select('subject,year,exam_round', { count: 'exact' })
      .eq('license_class', grade);
    if (subjectFilter !== null) query = query.eq('subject', subjectFilter);
    return query.order('id', { ascending: true });
  }, 'questions 메타데이터 조회');

  const counts = new Map();
  for (const row of rows) {
    if (row.subject == null || row.year == null || row.exam_round == null) continue;
    const key = JSON.stringify([row.subject, row.year, row.exam_round]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const combinations = [...counts].map(([key, count]) => {
    const [subjectName, year, examRound] = JSON.parse(key);
    return { subject: subjectName, year, examRound, count };
  });

  const byText = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
  combinations.sort((a, b) => b.year - a.year || byText(a.examRound, b.examRound) || byText(a.subject, b.subject));

  return {
    subjects: [...new Set(combinations.map((c) => c.subject))].sort(byText),
    years: [...new Set(combinations.map((c) => c.year))].sort((a, b) => b - a),
    examRounds: [...new Set(combinations.map((c) => c.examRound))].sort(byText),
    combinations,
  };
}
