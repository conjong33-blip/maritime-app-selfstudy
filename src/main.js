// 앱 진입점. V65 기능은 이후 단계에서 모듈로 나누어 이곳에서 연결한다.
import './styles.css';
import { config } from './config.js';
import { state } from './state.js';

function init() {
  const app = document.getElementById('app');
  if (!app) return;
  document.title = config.appName;
  app.dataset.track = state.currentTrack;
}

init();
