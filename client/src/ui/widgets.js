import { tr } from './i18n.js';
// Small DOM widget helpers for the pixel UI (buttons, sliders, cycle buttons, text fields).
export const uiHooks = { click: () => {} };

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = tr(text);
  return e;
}

export function button(label, onClick, cls = '', disabled = false) {
  const b = el('button', 'btn ' + cls, label);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', (e) => { e.preventDefault(); if (b.disabled) return; uiHooks.click(); onClick(e); });
  return b;
}

// Cycle button: "Label: Value" cycling through values.
export function cycle(label, values, value, onChange, cls = '', fmt = (v) => v) {
  let idx = Math.max(0, values.indexOf(value));
  const b = button('', () => {
    idx = (idx + 1) % values.length;
    render();
    onChange(values[idx]);
  }, cls);
  const render = () => { b.textContent = `${tr(label)}: ${tr(String(fmt(values[idx])))}`; };
  render();
  b.setValue = (v) => { idx = Math.max(0, values.indexOf(v)); render(); };
  b.getValue = () => values[idx];
  return b;
}

export function toggle(label, value, onChange, cls = '', onText = 'ON', offText = 'OFF') {
  return cycle(label, [true, false], value, onChange, cls, (v) => (v ? onText : offText));
}

export function slider({ min, max, step = 1, value, label, onChange, cls = '' }) {
  const wrap = el('div', 'slider-wrap ' + cls);
  const track = el('div', 'slider');
  track.tabIndex = 0;
  const handle = el('div', 'slider-handle');
  const text = el('div', 'slider-label');
  wrap.append(track, handle, text);
  let v = value;
  const render = () => {
    const k = (v - min) / (max - min);
    handle.style.left = `calc(${k} * (100% - 8px * var(--s)))`;
    text.textContent = label(v);
  };
  const setFromX = (clientX) => {
    const r = track.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    let nv = min + Math.round((k * (max - min)) / step) * step;
    nv = Math.min(max, Math.max(min, +nv.toFixed(4)));
    if (nv !== v) { v = nv; render(); onChange(v); }
  };
  track.addEventListener('mousedown', (e) => {
    e.preventDefault();
    track.focus();
    setFromX(e.clientX);
    const move = (ev) => setFromX(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); uiHooks.click(); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { v = Math.max(min, +(v - step).toFixed(4)); render(); onChange(v); e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { v = Math.min(max, +(v + step).toFixed(4)); render(); onChange(v); e.preventDefault(); }
  });
  wrap.setValue = (nv) => { v = nv; render(); };
  render();
  return wrap;
}

export function textField(value = '', placeholder = '', maxLength = 64, onInput = null) {
  const i = el('input', 'textfield');
  i.type = 'text';
  i.value = value;
  i.placeholder = tr(placeholder);
  i.maxLength = maxLength;
  i.spellcheck = false;
  i.autocomplete = 'off';
  if (onInput) i.addEventListener('input', () => onInput(i.value));
  return i;
}

export function labeled(text, field) {
  const c = el('div', 'col');
  c.style.alignItems = 'stretch';
  c.style.gap = 'calc(2px * var(--s))';
  c.append(el('div', 'field-label', text), field);
  return c;
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
