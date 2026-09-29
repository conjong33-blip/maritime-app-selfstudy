// 교사용 "사용자 관리": PIN 확인 -> 목록 조회 -> 수정/삭제. 사전등록/접근제한 시스템이 아니다 - 학생의
// 학번+이름 자유 로그인 정책(session-actions.js/local-auth.js)은 이 기능과 완전히 별개로 그대로 유지된다.
// PIN 은 절대 localStorage/sessionStorage 에 저장하지 않는다 - state.admin.pin 에 메모리로만 유지하고,
// "대기실로 돌아가기" 또는 새로고침(= 페이지 재실행, state 가 처음부터 다시 만들어짐) 시 사라진다.
import { state } from './state.js';
import { ADMIN_ERROR_CODE, deleteProfile, listProfiles, updateProfile } from './data/admin.js';
import { renderAdminScreen, setAdminSaveBusy } from './admin-view.js';
import { renderStudentVerification } from './view.js';

const PIN_ERROR_MESSAGE = 'PIN 번호를 확인해 주세요.';
const DUPLICATE_STUDENT_NO_MESSAGE = '이미 다른 학생이 사용 중인 학번입니다.';
const GENERIC_ERROR_MESSAGE = '잠시 후 다시 시도해 주세요.';

function messageForError(error) {
  if (error?.code === ADMIN_ERROR_CODE.INVALID_PIN) return PIN_ERROR_MESSAGE;
  if (error?.code === ADMIN_ERROR_CODE.DUPLICATE_STUDENT_NO) return DUPLICATE_STUDENT_NO_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}

// STAGE A(학생 확인)/STAGE B(학습 홈)와 STAGE B-ADMIN 은 이 값 하나(state.admin.screen)로 서로 배타적이다 -
// renderStudentVerification() 이 admin.screen 을 함께 보고 A/B 를 숨기므로, 관리자 상태가 바뀔 때마다 이
// 두 render 를 항상 같이 부른다.
function renderAll() {
  renderStudentVerification();
  renderAdminScreen();
}

// 학생 확인 화면 하단 "교사 관리" - PIN 입력 화면을 연다.
export function openAdminPin() {
  state.admin.screen = 'pin';
  state.admin.error = '';
  state.admin.message = '';
  renderAll();
}

// PIN 화면의 "확인"(버튼 클릭 또는 입력창에서 Enter/blur). 목록 RPC 자체가 PIN 검증을 겸한다 - 성공하면
// 목록까지 한 번에 받아 바로 사용자 관리 화면으로 넘어간다.
export async function submitAdminPin() {
  if (state.admin.loading) return;
  const input = document.getElementById('admin-pin-input');
  const pin = input?.value ?? '';
  if (!pin) {
    state.admin.error = PIN_ERROR_MESSAGE;
    renderAdminScreen();
    return;
  }
  state.admin.loading = true;
  state.admin.error = '';
  renderAdminScreen();
  try {
    const profiles = await listProfiles(pin);
    state.admin.pin = pin; // 이번 관리 세션 동안 수정/삭제에 재사용할 "확인된 PIN" - 여기서만 메모리에 남긴다
    state.admin.profiles = profiles;
    state.admin.screen = 'list';
    if (input) input.value = ''; // PIN 은 입력창에도 남겨두지 않는다
  } catch (error) {
    state.admin.error = messageForError(error);
    if (input) input.value = '';
  } finally {
    state.admin.loading = false;
    renderAll();
  }
}

// "대기실로 돌아가기": 관리자 화면을 완전히 닫고 PIN 을 포함한 관리자 상태를 전부 지운다.
export function closeAdminScreen() {
  state.admin.screen = 'closed';
  state.admin.pin = '';
  state.admin.profiles = [];
  state.admin.loading = false;
  state.admin.error = '';
  state.admin.message = '';
  state.admin.editingId = null;
  state.admin.deletingId = null;
  const input = document.getElementById('admin-pin-input');
  if (input) input.value = '';
  renderAll();
}

// 목록을 다시 읽는다(수정/삭제 성공 뒤). 이미 확인된 PIN 을 그대로 재사용한다 - 재입력을 요구하지 않는다.
async function refreshProfiles() {
  state.admin.profiles = await listProfiles(state.admin.pin);
}

export function startEditProfile(id) {
  state.admin.editingId = Number(id);
  state.admin.deletingId = null;
  state.admin.message = '';
  state.admin.error = '';
  renderAdminScreen();
}

export function cancelEditProfile() {
  state.admin.editingId = null;
  renderAdminScreen();
}

export async function saveEditProfile(id) {
  if (state.admin.loading) return;
  const profileId = Number(id);
  const noInput = document.getElementById(`admin-edit-no-${profileId}`);
  const nameInput = document.getElementById(`admin-edit-name-${profileId}`);
  const studentNo = noInput?.value ?? '';
  const studentName = nameInput?.value ?? '';
  state.admin.loading = true;
  state.admin.error = '';
  // 요청이 끝날 때까지는 저장 버튼만 잠그고 전체를 다시 그리지 않는다 - renderAdminScreen() 을 지금 부르면
  // 아직 저장되지 않은 입력값이 buildEditRow 에 의해 원래 profile 값으로 되돌아가 버린다.
  setAdminSaveBusy(profileId, true);
  try {
    await updateProfile(state.admin.pin, { id: profileId, studentNo, studentName });
    await refreshProfiles();
    state.admin.editingId = null;
    state.admin.message = '학생 정보를 수정했습니다.';
  } catch (error) {
    state.admin.error = messageForError(error);
  } finally {
    state.admin.loading = false;
    renderAdminScreen();
    if (state.admin.editingId === profileId) {
      // 실패해서 같은 행이 여전히 수정 폼으로 남아 있으면, 방금 시도했던 값을 그대로 되살려 넣는다
      // (교사가 입력을 다시 하지 않아도 되게 - 방금 위에서 원래 profile 값으로 새로 그려졌기 때문).
      const retryNo = document.getElementById(`admin-edit-no-${profileId}`);
      const retryName = document.getElementById(`admin-edit-name-${profileId}`);
      if (retryNo) retryNo.value = studentNo;
      if (retryName) retryName.value = studentName;
    }
  }
}

export function startDeleteProfile(id) {
  state.admin.deletingId = Number(id);
  state.admin.editingId = null;
  state.admin.message = '';
  state.admin.error = '';
  renderAdminScreen();
}

export function cancelDeleteProfile() {
  state.admin.deletingId = null;
  renderAdminScreen();
}

export async function confirmDeleteProfile(id) {
  if (state.admin.loading) return;
  const profileId = Number(id);
  state.admin.loading = true;
  state.admin.error = '';
  renderAdminScreen();
  try {
    await deleteProfile(state.admin.pin, profileId);
    state.admin.profiles = state.admin.profiles.filter((profile) => profile.id !== profileId);
    state.admin.deletingId = null;
    state.admin.message = '사용자를 삭제했습니다.';
  } catch (error) {
    state.admin.error = messageForError(error);
  } finally {
    state.admin.loading = false;
    renderAdminScreen();
  }
}
