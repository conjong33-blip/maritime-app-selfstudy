// 교사용 관리자 RPC 3개의 wrapper. db/005_selfstudy_admin_management.sql 의 함수 이름과 매개변수를 그대로 따른다.
// 기존 src/data/selfstudy.js 와 같은 패턴(callRpc + unwrap/DataError)을 그대로 재사용한다 - 새 fetch wrapper를
// 따로 만들지 않는다. PIN 은 이 모듈이 어디에도 저장하지 않는다 - 호출할 때마다 인자로만 받아 그대로 RPC 에 넘긴다
// (메모리에 PIN 을 들고 있는 건 admin-actions.js 의 state.admin.pin 뿐이다).
//   - PIN 불일치는 error.code 'PIN01' 로 온다(모든 관리자 RPC 공통).
//   - selfstudy_admin_update_profile 한정: 다른 프로필이 이미 쓰는 student_no 로 바꾸려 하면 'ST409'
//     (학생용 selfstudy_get_or_create_profile 의 ST409 와 같은 의미 - 같은 코드를 재사용한다).
//   - 그 외 입력 오류는 '22023' (기존 RPC 들과 동일).
import { DataError, getSupabaseClient, unwrap } from './supabase.js';

export const ADMIN_ERROR_CODE = {
  INVALID_PIN: 'PIN01',
  DUPLICATE_STUDENT_NO: 'ST409',
  INVALID_INPUT: '22023',
};

async function callRpc(name, args, context) {
  return unwrap(await getSupabaseClient().rpc(name, args), context);
}

// A) PIN 검증 + 전체 사용자 목록. 이 호출이 성공하는 것 자체가 PIN 확인이다(별도 verify RPC 없음).
export async function listProfiles(pin) {
  const rows = await callRpc('selfstudy_admin_list_profiles', { p_pin: pin }, '사용자 목록 조회');
  return (rows ?? []).map((row) => ({ id: row.id, studentNo: row.student_no, studentName: row.student_name }));
}

// B) 학번/이름 수정. profile id 는 그대로 유지되므로 그 profile 의 오답/세션 기록은 건드리지 않는다.
export async function updateProfile(pin, { id, studentNo, studentName }) {
  const rows = await callRpc(
    'selfstudy_admin_update_profile',
    { p_pin: pin, p_profile_id: id, p_student_no: studentNo, p_student_name: studentName },
    '학생 정보 수정',
  );
  const row = (rows ?? [])[0];
  if (!row) throw new DataError('학생 정보 수정 실패: 응답이 비어 있습니다.');
  return { id: row.id, studentNo: row.student_no, studentName: row.student_name };
}

// C) 삭제. profile id 기준으로만 삭제한다(학번/이름 문자열로 지우지 않는다) - FK cascade 로 그 profile 의
// 오답/세션만 함께 제거된다(001 스키마의 on delete cascade). questions 등 공용 데이터는 무관하다.
export async function deleteProfile(pin, profileId) {
  return callRpc('selfstudy_admin_delete_profile', { p_pin: pin, p_profile_id: profileId }, '학생 삭제');
}
