// "내 학습 진단" 로비 패널 조작: 상세 패널 열기/닫기, 급수->과목->학습영역 선택, 선택한 학습영역으로 학습 시작.
// 집계(급수/과목/학습영역 우선 복습)는 순수 함수(utils.js)가 하고, 이 파일은 state.diagnosis 선택 상태만 바꾼 뒤 다시 그린다.
// AI 를 쓰지 않는다: 여기서 하는 일은 "지금 active 인 오답"을 급수/과목/학습영역(public.selfstudy_question_topics.learning_topic)
// 으로 나눠 보여주는 집계일 뿐이다.
//
// 두 가지 학습 진입점:
//  - 내가 틀린 문제 다시풀기: 기존 Track C 엔진을 그대로 쓴다(track-c-actions.js 의 startDiagnosisRetry).
//    선택한 급수+과목+학습영역의 active 오답만 포함하고, 다른 오답은 건드리지 않는다.
//  - 관련 문제 학습하기: 새 엔진을 만들지 않고 Track B 채점 엔진(오답 recordWrong, 정답 BASE+HELPER)을 재사용한다.
//    같은 급수/과목/학습영역의 문제 중 지금 active 오답인 것은 제외하고(같은 문제 답 암기가 아니라 다른 문제 적용이 목적),
//    최근 연도 우선으로 최대 5문제. session 은 저장하지 않는다(아래 startRelatedLearning 주석 참고).
import { state, resetQuizState, setCurrentTrack } from './state.js';
import { fetchQuestionsByLearningTopic } from './data/questions.js';
import { startDiagnosisRetry } from './track-c-actions.js';
import { renderDiagnosisDetail, renderDiagnosisSummary } from './diagnosis-view.js';
import { renderCurrentQuestion } from './quiz-renderer.js';
import { showQuiz } from './view.js';

const RELATED_QUESTIONS_LIMIT = 5;
// active 오답 제외/최대 5개 제한 전에 넉넉히 후보를 읽어 온다 (READ ONLY, questions 만 조회).
const RELATED_CANDIDATE_FETCH_LIMIT = 50;

function setDiagnosisMessage(message) {
  state.diagnosis.message = message;
  renderDiagnosisDetail();
}

// "자세히 보기" / "접기".
export function toggleDiagnosisDetail() {
  if (!state.profile || !state.wrongPool.loaded) return;
  state.diagnosis.expanded = !state.diagnosis.expanded;
  renderDiagnosisSummary();
  renderDiagnosisDetail();
}

export function closeDiagnosisDetail() {
  state.diagnosis.expanded = false;
  renderDiagnosisSummary();
  renderDiagnosisDetail();
}

// 급수 선택. 개수가 0 인 급수는 선택할 수 없다 (버튼 자체도 비활성 - diagnosis-view.js).
export function selectDiagnosisLicense(value) {
  const count = state.wrongPool.countsByLicense[value] ?? 0;
  if (count === 0) return;
  state.diagnosis.selectedLicenseClass = value;
  state.diagnosis.selectedSubject = null;
  state.diagnosis.selectedTopic = null;
  state.diagnosis.message = '';
  renderDiagnosisDetail();
}

export function selectDiagnosisSubject(value) {
  if (!state.diagnosis.selectedLicenseClass) return;
  state.diagnosis.selectedSubject = value;
  state.diagnosis.selectedTopic = null;
  state.diagnosis.message = '';
  renderDiagnosisDetail();
}

export function selectDiagnosisTopic(value) {
  if (!state.diagnosis.selectedSubject) return;
  state.diagnosis.selectedTopic = value;
  state.diagnosis.message = '';
  renderDiagnosisDetail();
}

function currentSelection() {
  const { selectedLicenseClass, selectedSubject, selectedTopic } = state.diagnosis;
  if (!selectedLicenseClass || !selectedSubject || !selectedTopic) return null;
  return { licenseClass: selectedLicenseClass, subject: selectedSubject, learningTopic: selectedTopic };
}

// [내가 틀린 문제 다시풀기] - 기존 Track C 엔진 재사용 (clearWrong 포함).
export async function startDiagnosisRetryAction() {
  const selection = currentSelection();
  if (!selection) return;
  const result = await startDiagnosisRetry(selection);
  if (!result.ok) setDiagnosisMessage(result.message);
}

// [관련 문제 학습하기] - Track B 채점 엔진 재사용, active 오답은 제외, 최대 5문제, session 저장 없음.
export async function startRelatedLearning() {
  const selection = currentSelection();
  if (!selection || !state.profile) return;
  setDiagnosisMessage('');
  try {
    const rows = await fetchQuestionsByLearningTopic({
      licenseClass: selection.licenseClass,
      subject: selection.subject,
      learningTopic: selection.learningTopic,
      limit: RELATED_CANDIDATE_FETCH_LIMIT,
    });
    const activeIds = new Set(state.wrongPool.activeQuestionIds);
    const candidates = rows.filter((row) => !activeIds.has(row.id)).slice(0, RELATED_QUESTIONS_LIMIT);
    if (candidates.length === 0) {
      setDiagnosisMessage('지금은 추가로 학습할 관련 문제가 없습니다.');
      return;
    }
    // 로비의 급수/과목 선택도 방금 학습한 내용에 맞춰 둔다(대기실로 돌아왔을 때 화면이 어긋나지 않게).
    // 연도/회차는 여러 시험지에 걸쳐 있을 수 있어 하나로 정할 수 없으므로 건드리지 않는다.
    state.licenseClass = selection.licenseClass;
    state.filters.subject = selection.subject;
    setCurrentTrack('B'); // Track B 와 완전히 같은 채점/해설 엔진을 쓴다 (오답 recordWrong, 정답 BASE+HELPER, 8:4)
    resetQuizState(); // origin 은 비워 둔다 - 이 세트는 하나의 (연도, 회차) 로 표현할 수 없어 session 을 저장하지 않는다
    state.quiz.questions = candidates;
    state.quiz.currentIndex = 0;
    showQuiz(`${state.profile.studentNo} (${state.profile.studentName})`);
    renderCurrentQuestion();
  } catch (error) {
    setDiagnosisMessage(`관련 문제를 불러오지 못했습니다. (${error.message})`);
  }
}
