import '@fontsource/pixelify-sans/400.css';
import './ui/style.css';
import { App } from './App.js';

const app = new App();
window.__shaftcraft = app;
app.init().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'screen dirt';
  box.textContent = 'ShaftCraft failed to start: ' + (err && err.message ? err.message : err);
  ui.appendChild(box);
});
