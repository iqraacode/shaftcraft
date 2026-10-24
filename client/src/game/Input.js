// Keyboard / mouse input with pointer lock and rebindable action keys.
export class Input {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.options = options;
    this.keys = new Set();
    this.buttons = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.keyListeners = [];
    this.mouseListeners = [];
    this.lockListeners = [];
    this.enabled = true;
    this.touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
    window.addEventListener('keydown', (e) => this.onKey(e, true), true);
    window.addEventListener('keyup', (e) => this.onKey(e, false), true);
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.buttons.clear();
      for (const l of this.lockListeners) l(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.buttons.add(e.button);
      for (const l of this.mouseListeners) l(e.button, true, e);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.buttons.has(e.button)) return;
      this.buttons.delete(e.button);
      for (const l of this.mouseListeners) l(e.button, false, e);
    });
    canvas.addEventListener('wheel', (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
  }

  onKey(e, down) {
    // Browser shortcuts we take over while playing
    if (down && (e.code === 'F3' || e.code === 'F5' || e.code === 'F11' || e.code === 'Tab')) e.preventDefault();
    if (this.locked && down && (e.code === 'Space' || e.code.startsWith('Arrow') || e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'KeyQ' || e.code === 'KeyF'))) e.preventDefault();
    if (down) {
      const repeat = e.repeat;
      this.keys.add(e.code);
      for (const l of this.keyListeners) l(e.code, true, repeat, e);
    } else {
      this.keys.delete(e.code);
      for (const l of this.keyListeners) l(e.code, false, false, e);
    }
  }

  action(name) { return this.options.get('keys')[name]; }
  isDown(name) { return this.keys.has(this.action(name)); }
  is(code, name) { return code === this.action(name); }

  requestLock() {
    if (this.locked || this.touch) return; // touch devices look around by dragging instead
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignored */ }
      });
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* ignored */ }
    }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  consumeMouse() { const r = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return r; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
}
