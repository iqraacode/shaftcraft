// On-screen controls for phones/tablets: move joystick, drag-to-look, action buttons,
// tap the hotbar to select. Feeds the same Input object as keyboard and mouse.
import { el } from './widgets.js';

export const IS_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);

export class TouchControls {
  constructor(app) {
    this.app = app;
    this.input = app.input;
    this.root = el('div', 'touch');
    this.look = el('div', 'touch-look');
    this.stick = el('div', 'touch-stick');
    this.knob = el('div', 'touch-knob');
    this.stick.append(this.knob);
    this.buttons = el('div', 'touch-buttons');
    this.top = el('div', 'touch-top');
    this.root.append(this.look, this.stick, this.buttons, this.top);
    document.getElementById('app').append(this.root);
    this.moveKeys = new Set();
    this.setupStick();
    this.setupLook();
    // [label, kind, value] kind: key = hold a bound key, tap = press an action key once, mouse = hold a mouse button
    this.addButton(this.buttons, 'Jump', 'key', 'jump', 'big');
    this.addButton(this.buttons, 'Sneak', 'key', 'sneak');
    this.addButton(this.buttons, 'Break', 'mouse', 0, 'big');
    this.addButton(this.buttons, 'Use', 'mouse', 2, 'big');
    this.addButton(this.top, 'Pause', 'fn', () => app.ui.pause());
    this.addButton(this.top, 'Inv', 'tap', 'inventory');
    this.addButton(this.top, 'Cam', 'tap', 'camera');
    this.addButton(this.top, 'Chat', 'tap', 'chat');
    this.addButton(this.top, 'Drop', 'tap', 'drop');
    this.visible = false;
    this.root.style.display = 'none';
  }

  fakeKey(code, down) {
    this.input.onKey({ code, repeat: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, down);
  }

  addButton(parent, label, kind, value, cls = '') {
    const b = el('div', 'touch-btn ' + cls, label);
    const start = (e) => {
      e.preventDefault();
      b.classList.add('down');
      if (kind === 'key') this.input.keys.add(this.input.action(value));
      else if (kind === 'tap') { const c = this.input.action(value); this.fakeKey(c, true); this.fakeKey(c, false); }
      else if (kind === 'mouse') { this.input.buttons.add(value); for (const l of this.input.mouseListeners) l(value, true); }
      else if (kind === 'fn') value();
    };
    const end = (e) => {
      e.preventDefault();
      b.classList.remove('down');
      if (kind === 'key') this.input.keys.delete(this.input.action(value));
      else if (kind === 'mouse' && this.input.buttons.has(value)) { this.input.buttons.delete(value); for (const l of this.input.mouseListeners) l(value, false); }
    };
    b.addEventListener('touchstart', start, { passive: false });
    b.addEventListener('touchend', end, { passive: false });
    b.addEventListener('touchcancel', end, { passive: false });
    parent.append(b);
  }

  setupStick() {
    let id = null, cx = 0, cy = 0;
    const set = (dx, dy) => {
      const r = 50;
      const len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const nx = dx / r, ny = dy / r;
      const want = new Set();
      if (ny < -0.35) want.add('forward');
      if (ny > 0.35) want.add('back');
      if (nx < -0.35) want.add('left');
      if (nx > 0.35) want.add('right');
      if (ny < -1.1) want.add('sprint');
      for (const a of ['forward', 'back', 'left', 'right', 'sprint']) {
        const code = this.input.action(a);
        if (want.has(a)) this.input.keys.add(code); else if (this.moveKeys.has(a)) this.input.keys.delete(code);
      }
      this.moveKeys = want;
    };
    this.stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = this.stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(t.clientX - cx, t.clientY - cy);
    }, { passive: false });
    this.stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) set(t.clientX - cx, t.clientY - cy);
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; set(0, 0); } };
    this.stick.addEventListener('touchend', end);
    this.stick.addEventListener('touchcancel', end);
  }

  setupLook() {
    const touches = new Map();
    this.look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, time: performance.now() });
    }, { passive: false });
    this.look.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (!s) continue;
        this.input.dx += (t.clientX - s.x) * 1.6;
        this.input.dy += (t.clientY - s.y) * 1.6;
        s.x = t.clientX; s.y = t.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        touches.delete(t.identifier);
        if (!s) continue;
        const tap = performance.now() - s.time < 250 && Math.hypot(t.clientX - s.sx, t.clientY - s.sy) < 12;
        if (tap) this.tapHotbar(t.clientX, t.clientY);
      }
    };
    this.look.addEventListener('touchend', end);
    this.look.addEventListener('touchcancel', end);
  }

  tapHotbar(x, y) {
    const g = this.app.game;
    if (!g) return;
    const s = this.app.hud.scale;
    const W = window.innerWidth, H = window.innerHeight;
    const left = W / 2 - 91 * s;
    if (y < H - 22 * s || x < left || x > left + 182 * s) return;
    g.selectSlot(Math.min(8, Math.max(0, Math.floor((x - left) / (20 * s)))));
  }

  update(active) {
    if (active === this.visible) return;
    this.visible = active;
    this.root.style.display = active ? '' : 'none';
    if (!active) {
      for (const a of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']) this.input.keys.delete(this.input.action(a));
      this.moveKeys.clear();
      this.knob.style.transform = '';
      for (const b of [0, 2]) if (this.input.buttons.has(b)) { this.input.buttons.delete(b); for (const l of this.input.mouseListeners) l(b, false); }
    }
  }
}
