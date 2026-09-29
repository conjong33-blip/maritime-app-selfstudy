// selfstudy RPC 7개의 wrapper. db/001_selfstudy_schema.sql 의 함수 이름과 매개변수 이름을 그대로 따른다.
// selfstudy_* 테이블은 이 RPC 로만 읽고 쓴다 (테이블 직접 접근은 DB 에서 막혀 있다).
// 순수 데이터 계층: state, DOM, alert 를 건드리지 않는다. 실패하면 DataError 를 던진다.
//   - 잘못된 profile_key 는 error.code '28000', 잘못된 입력값은 '22023' 으로 온다.
//   - selfstudy_get_or_create_profile 한정: 같은 student_no 에 이미 다른 이름의 profile 이 있으면
//     'ST409' (db/004_selfstudy_prevent_duplicate_identity.sql 참고). PostgreSQL 표준 unique_violation
//     (23505) 은 일부러 쓰지 않는다 - 그 코드는 실제 UNIQUE 제약 위반에도 범용으로 쓰이므로, 재사용하면
//     그런 일반 오류까지 이 학생 안내 문구로 잘못 처리될 수 있다. 'ST409' 는 이 의도적인 정책 위반만
//     가리키는 전용 코드다.
import { DataError, getSupabaseClient, unwrap } from './supabase.js';

export const RPC_ERROR_CODE = {
  INVALID_PROFILE_KEY: '28000',
  INVALID_INPUT: '22023',
  DUPLICATE_STUDENT_IDENTITY: 'ST409',
};

function requireProfileKey(profileKey) {
  if (typeof profileKey !== 'string' || profileKey.trim() === '') {
    throw new DataError('profileKey 값이 필요합니다.');
  }
  return profileKey;
}

function requireQuestionId(questionId) {
  if (!Number.isInteger(questionId)) throw new DataError(`questionId 는 정수여야 합니다: ${questionId}`);
  return questionId;
}

async function callRpc(name, args, context) {
  return unwrap(await getSupabaseClient().rpc(name, args), context);
}

// returns table 인 RPC 는 행 배열로 온다. 첫 행만 필요할 때 쓴다.
function firstRow(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// 1) selfstudy_get_or_create_profile(p_student_no text, p_student_name text)
//    -> { profileKey, studentNo, studentName, isNew }
export async function getOrCreateProfile({ studentNo, studentName }) {
  const rows = await callRpc(
    'selfstudy_get_or_create_profile',
    { p_student_no: studentNo, p_student_name: studentName },
    '프로필 조회/생성',
  );
  const row = firstRow(rows);
  if (!row) throw new DataError('프로필 조회/생성 실패: 응답이 비어 있습니다.');
  return {
    profileKey: row.profile_key,
    studentNo: row.student_no,
    studentName: row.student_name,
    isNew: row.is_new,
  };
}

// 2) selfstudy_get_session(p_profile_key uuid)
//    -> 최근 세션 객체 또는 null
export async function getSession(profileKey) {
  const rows = await callRpc('selfstudy_get_session', { p_profile_key: requireProfileKey(profileKey) }, '세션 조회');
  const row = firstRow(rows);
  if (!row) return null;
  return {
    trackType: row.track_type,
    licenseClass: row.license_class,
    subject: row.subject,
    selectedSubjects: row.selected_subjects,
    year: row.year,
    examRound: row.exam_round,
    currentQuestionId: row.current_question_id,
    currentQuestionIndex: row.current_question_index,
    questionIds: row.question_ids,
    updatedAt: row.updated_at,
  };
}

// 3) selfstudy_save_session(p_profile_key, p_track_type, p_license_class, p_subject, p_selected_subjects,
//                           p_year, p_exam_round, p_current_question_id, p_current_question_index, p_question_ids)
//    학생당 최근 세션 1개를 통째로 덮어쓴다. -> true
export async function saveSession({
  profileKey,
  trackType,
  licenseClass,
  subject = null,
  selectedSubjects = null,
  year = null,
  examRound = null,
  currentQuestionId = null,
  currentQuestionIndex = null,
  questionIds = null,
}) {
  return callRpc(
    'selfstudy_save_session',
    {
      p_profile_key: requireProfileKey(profileKey),
      p_track_type: trackType,
      p_license_class: licenseClass,
      p_subject: subject,
      p_selected_subjects: selectedSubjects,
      p_year: year,
      p_exam_round: examRound,
      p_current_question_id: currentQuestionId,
      p_current_question_index: currentQuestionIndex,
      p_question_ids: questionIds,
    },
    '세션 저장',
  );
}

// 4) selfstudy_clear_session(p_profile_key uuid) -> 삭제했으면 true, 없었으면 false
export async function clearSession(profileKey) {
  return callRpc('selfstudy_clear_session', { p_profile_key: requireProfileKey(profileKey) }, '세션 삭제');
}

// 5) selfstudy_record_wrong(p_profile_key uuid, p_question_id integer)
//    -> { questionId, wrongCount, status, firstWrongAt, lastWrongAt }
export async function recordWrong(profileKey, questionId) {
  const rows = await callRpc(
    'selfstudy_record_wrong',
    { p_profile_key: requireProfileKey(profileKey), p_question_id: requireQuestionId(questionId) },
    '오답 기록',
  );
  const row = firstRow(rows);
  if (!row) throw new DataError('오답 기록 실패: 응답이 비어 있습니다.');
  return {
    questionId: row.question_id,
    wrongCount: row.wrong_count,
    status: row.status,
    firstWrongAt: row.first_wrong_at,
    lastWrongAt: row.last_wrong_at,
  };
}

// 6) selfstudy_clear_wrong(p_profile_key uuid, p_question_id integer)
//    active 오답을 cleared 로 바꿨으면 true, 아니면 false
export async function clearWrong(profileKey, questionId) {
  return callRpc(
    'selfstudy_clear_wrong',
    { p_profile_key: requireProfileKey(profileKey), p_question_id: requireQuestionId(questionId) },
    '오답 격파 처리',
  );
}

// 7) selfstudy_get_active_wrongs(p_profile_key uuid)
//    -> [{ questionId, wrongCount, firstWrongAt, lastWrongAt }] (first_wrong_at, id 오름차순)
export async function getActiveWrongs(profileKey) {
  const rows = await callRpc('selfstudy_get_active_wrongs', { p_profile_key: requireProfileKey(profileKey) }, '오답 목록 조회');
  return (rows ?? []).map((row) => ({
    questionId: row.question_id,
    wrongCount: row.wrong_count,
    firstWrongAt: row.first_wrong_at,
    lastWrongAt: row.last_wrong_at,
  }));
}
