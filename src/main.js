// 앱 진입점. 화면은 index.html 의 정적 구조 그대로 두고, 이벤트 위임만 등록한다.
import './styles.css';
import { registerEvents } from './events.js';

registerEvents();
