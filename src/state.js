// 학습 상태를 한곳에 모을 자리. 지금은 최소 빈 구조만 둔다.
// V65의 전역 변수(questionsList, currentNo, markedAnswers, currentTrack ...)는 이후 단계에서 옮긴다.
export const state = {
  profile: null,
  currentTrack: '',
  questions: [],
  currentIndex: 0,
};
