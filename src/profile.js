// 학번+이름 입력 읽기/검증과 프로필 확보 (Track A/B 시작, 이어하기 확인이 함께 쓴다).
// 프로필은 입력값으로 getOrCreateProfile 을 호출해 얻고, 같은 입력이면 메모리의 프로필을 다시 쓴다.
// (입력값을 state.profile 에 함께 보관해 두고 비교한다. DB 가 이름 안의 공백 차이를 같은 사람으로 판정해
//  돌려주는 studentName 은 입력과 다를 수 있으므로, 비교에는 돌려받은 값이 아니라 입력값을 쓴다.)
import { config } from './config.js';
import { state } from './state.js';
import { getOrCreateProfile } from './data/selfstudy.js';

const charCount = (text) => [...text].length; // DB char_length 와 같은 기준(코드포인트)

// 학번은 앞뒤 공백만 제거한다 (형식 제한 없음). 이름은 앞뒤 공백 제거 + NFC 정규화
// (이름 안의 공백 차이는 DB 가 같은 사람으로 판정하므로 여기서 지우지 않는다).
export function readIdentity() {
  return {
    studentNo: document.getElementById('student-id-input').value.trim(),
    studentName: document.getElementById('student-name-input').value.trim().normalize('NFC'),
  };
}

// 입력이 올바르면 null, 아니면 안내 문구.
export function validateIdentity({ studentNo, studentName }) {
  if (!studentNo) return '학번을 입력해 주세요.';
  if (charCount(studentNo) > config.limits.studentNo) return `학번은 ${config.limits.studentNo}자 이하로 입력해 주세요.`;
  if (!studentName) return '학생 이름을 입력해 주세요.';
  if (charCount(studentName) > config.limits.studentName) return `이름은 ${config.limits.studentName}자 이하로 입력해 주세요.`;
  return null;
}

// 지금 입력이 state.profile 을 만든 입력과 같은지
export function isSameIdentity(identity, profile = state.profile) {
  return Boolean(profile) && profile.inputStudentNo === identity.studentNo && profile.inputStudentName === identity.studentName;
}

// 입력에 맞는 프로필. 같은 입력의 프로필이 메모리에 있으면 RPC 없이 그대로 돌려준다 (state 는 바꾸지 않는다).
export async function ensureProfile(identity) {
  if (isSameIdentity(identity)) return state.profile;
  const profile = await getOrCreateProfile({ studentNo: identity.studentNo, studentName: identity.studentName });
  return {
    profileKey: profile.profileKey,
    studentNo: profile.studentNo,
    studentName: profile.studentName,
    inputStudentNo: identity.studentNo,
    inputStudentName: identity.studentName,
  };
}
