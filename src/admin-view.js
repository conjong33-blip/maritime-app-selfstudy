// 교사용 "사용자 관리" 화면 표시 (state -> DOM). 상태를 바꾸지 않고 DB 에도 접근하지 않는다 - admin-actions.js 가
// state.admin 을 바꾼 뒤 이 파일의 renderAdminScreen() 하나만 부르면 PIN 화면/목록 화면이 전부 다시 그려진다.
import { state } from './state.js';

const byId = (id) => document.getElementById(id);

function setText(id, text, hidden) {
  const el = byId(id);
  if (!el) return;
  el.textContent = text ?? '';
  el.classList.toggle('hidden', hidden ?? !text);
}

// 수정 저장 중에는 그 버튼만 잠근다(admin-actions.js 의 saveEditProfile 이 부른다) - renderAdminScreen() 을
// 통째로 다시 부르지 않는다. 그렇게 하면 아직 저장되지 않은 입력값이 원래 profile 값으로 되돌아가 버린다
// (buildEditRow 가 매번 profile.studentNo/studentName 으로 입력창을 새로 만들기 때문).
export function setAdminSaveBusy(profileId, busy) {
  const btn = document.querySelector(`[data-action="admin-save-edit"][data-value="${profileId}"]`);
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('opacity-60', busy);
    btn.classList.toggle('cursor-wait', busy);
  }
}

// PIN 화면: 오류 문구, 로딩 중 확인 버튼 잠금.
function renderPinScreen() {
  setText('admin-pin-error', state.admin.error, !state.admin.error);
  const submitBtn = byId('admin-pin-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = state.admin.loading;
    submitBtn.classList.toggle('opacity-60', state.admin.loading);
    submitBtn.classList.toggle('cursor-wait', state.admin.loading);
  }
}

// 목록의 평범한 한 행: 학번/이름 + 수정/삭제 (desktop 은 한 줄, 375px 는 자연스럽게 줄바꿈 - 별도 table 없음).
function buildRow(profile) {
  const row = document.createElement('div');
  row.className = 'flex items-center justify-between gap-3 bg-[#0B132B] border border-[#3A506B]/40 rounded-xl px-3 py-2.5 flex-wrap';
  const info = document.createElement('div');
  info.className = 'min-w-0';
  const no = document.createElement('div');
  no.className = 'text-sm font-bold text-white truncate';
  no.textContent = profile.studentNo;
  const name = document.createElement('div');
  name.className = 'text-xs text-slate-400 truncate';
  name.textContent = profile.studentName;
  info.append(no, name);

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1.5 shrink-0';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.dataset.action = 'admin-start-edit';
  editBtn.dataset.value = String(profile.id);
  editBtn.className =
    'text-[11px] font-bold text-teal-300 hover:text-teal-200 px-2.5 py-1.5 rounded-lg border border-teal-500/40 hover:border-teal-400 transition';
  editBtn.textContent = '수정';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.dataset.action = 'admin-start-delete';
  deleteBtn.dataset.value = String(profile.id);
  deleteBtn.className =
    'text-[11px] font-bold text-rose-300 hover:text-rose-200 px-2.5 py-1.5 rounded-lg border border-rose-500/40 hover:border-rose-400 transition';
  deleteBtn.textContent = '삭제';
  actions.append(editBtn, deleteBtn);

  row.append(info, actions);
  return row;
}

// 수정 중인 행: 학번/이름 입력 + 저장/취소. 값을 state 에 실시간 동기화하지 않는다(기존 학번/이름 입력과
// 같은 관례 - 저장 클릭 시 admin-actions.js 의 saveEditProfile 이 이 입력의 현재 값을 직접 읽는다).
function buildEditRow(profile) {
  const row = document.createElement('div');
  row.className = 'bg-[#0B132B] border border-teal-500/40 rounded-xl p-3 space-y-2';
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-2';

  const noWrap = document.createElement('div');
  const noLabel = document.createElement('label');
  noLabel.className = 'block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1';
  noLabel.textContent = '학번';
  const noInput = document.createElement('input');
  noInput.type = 'text';
  noInput.id = `admin-edit-no-${profile.id}`;
  noInput.maxLength = 20;
  noInput.value = profile.studentNo;
  noInput.className = 'w-full bg-[#1C2541] border border-[#3A506B] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-teal-400 transition';
  noWrap.append(noLabel, noInput);

  const nameWrap = document.createElement('div');
  const nameLabel = document.createElement('label');
  nameLabel.className = 'block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1';
  nameLabel.textContent = '이름';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = `admin-edit-name-${profile.id}`;
  nameInput.maxLength = 50;
  nameInput.value = profile.studentName;
  nameInput.className = 'w-full bg-[#1C2541] border border-[#3A506B] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-teal-400 transition';
  nameWrap.append(nameLabel, nameInput);

  grid.append(noWrap, nameWrap);

  const buttons = document.createElement('div');
  buttons.className = 'flex items-center gap-2';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.dataset.action = 'admin-save-edit';
  saveBtn.dataset.value = String(profile.id);
  saveBtn.disabled = state.admin.loading;
  saveBtn.className = `flex-1 bg-teal-600 hover:bg-teal-500 text-white font-black px-3 py-2 rounded-lg text-[11px] transition${state.admin.loading ? ' opacity-60 cursor-wait' : ''}`;
  saveBtn.textContent = '저장';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.dataset.action = 'admin-cancel-edit';
  cancelBtn.className = 'flex-1 bg-[#3A506B]/40 hover:bg-[#3A506B] text-slate-300 hover:text-white px-3 py-2 rounded-lg border border-[#3A506B] text-[11px] font-bold transition';
  cancelBtn.textContent = '취소';
  buttons.append(saveBtn, cancelBtn);

  row.append(grid, buttons);
  return row;
}

// 삭제 확인 중인 행: 확인 문구 + 삭제/취소. 즉시 삭제하지 않고 반드시 이 확인을 거친다.
function buildDeleteConfirmRow(profile) {
  const row = document.createElement('div');
  row.className = 'bg-rose-950/30 border border-rose-500/40 rounded-xl p-3 space-y-2';
  const text = document.createElement('p');
  text.className = 'text-xs font-semibold text-rose-100';
  text.textContent = `${profile.studentNo} · ${profile.studentName} 사용자를 삭제할까요?`;
  const detail = document.createElement('p');
  detail.className = 'text-[10px] text-rose-300/80';
  detail.textContent = '오답 및 이어서 학습 기록도 함께 삭제됩니다.';
  const buttons = document.createElement('div');
  buttons.className = 'flex items-center gap-2';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.dataset.action = 'admin-confirm-delete';
  confirmBtn.dataset.value = String(profile.id);
  confirmBtn.disabled = state.admin.loading;
  confirmBtn.className = `flex-1 bg-rose-600 hover:bg-rose-500 text-white font-black px-3 py-2 rounded-lg text-[11px] transition${state.admin.loading ? ' opacity-60 cursor-wait' : ''}`;
  confirmBtn.textContent = '삭제';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.dataset.action = 'admin-cancel-delete';
  cancelBtn.className = 'flex-1 bg-[#3A506B]/40 hover:bg-[#3A506B] text-slate-300 hover:text-white px-3 py-2 rounded-lg border border-[#3A506B] text-[11px] font-bold transition';
  cancelBtn.textContent = '취소';
  buttons.append(confirmBtn, cancelBtn);
  row.append(text, detail, buttons);
  return row;
}

function renderProfileList() {
  const list = byId('admin-profile-list');
  if (!list) return;
  if (state.admin.profiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-slate-500 italic px-1';
    empty.textContent = '등록된 사용자가 없습니다.';
    list.replaceChildren(empty);
    return;
  }
  const rows = state.admin.profiles.map((profile) => {
    if (state.admin.editingId === profile.id) return buildEditRow(profile);
    if (state.admin.deletingId === profile.id) return buildDeleteConfirmRow(profile);
    return buildRow(profile);
  });
  list.replaceChildren(...rows);
}

function renderListScreen() {
  setText('admin-list-message', state.admin.message, !state.admin.message);
  setText('admin-list-error', state.admin.error, !state.admin.error);
  renderProfileList();
}

// state.admin.screen 하나로 STAGE B-ADMIN 안의 PIN 화면 <-> 목록 화면을 오간다. 관리자 화면 자체가
// 보이는지(다른 화면 전부 숨김)는 view.js 의 renderStudentVerification() 이 함께 본다.
export function renderAdminScreen() {
  const active = state.admin.screen !== 'closed';
  byId('teacher-admin-screen')?.classList.toggle('hidden', !active);
  byId('teacher-pin-screen')?.classList.toggle('hidden', state.admin.screen !== 'pin');
  byId('teacher-list-screen')?.classList.toggle('hidden', state.admin.screen !== 'list');
  if (state.admin.screen === 'pin') renderPinScreen();
  else if (state.admin.screen === 'list') renderListScreen();
}
