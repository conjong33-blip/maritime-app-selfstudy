// 아직 끝나지 않은 오답 기록(recordWrong)/정리(clearWrong) 요청을 세어 둔다.
// 로비로 돌아온 직후 "남은 오답 수"를 다시 읽을 때, 방금 보낸 기록이 DB 에 반영된 뒤에 읽도록 기다리는 데 쓴다.
// 요청 자체의 성공/실패 처리는 호출한 쪽이 하고, 여기서는 세기만 한다 (reject 를 삼키거나 바꾸지 않는다).
let pending = 0;
let waiters = [];

// promise 를 그대로 돌려주며 끝날 때까지 pending 으로 센다.
export function trackWrite(promise) {
  pending += 1;
  const done = () => {
    pending -= 1;
    if (pending === 0) {
      const wake = waiters;
      waiters = [];
      for (const resolve of wake) resolve();
    }
  };
  promise.then(done, done);
  return promise;
}

export function whenWritesIdle() {
  return pending === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve));
}
