// 앱 진입점. 화면은 index.html 의 정적 구조 그대로 두고, 이벤트 위임만 등록한다.
import './styles.css';
import { registerEvents } from './events.js';
import { attemptAutoLogin } from './session-actions.js';

registerEvents();
void attemptAutoLogin(); // 로그인 유지 정보가 있으면 기존 확인 흐름으로 자동 복원, 없으면 학생 확인 화면 그대로
