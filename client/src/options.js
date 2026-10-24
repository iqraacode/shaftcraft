// Persistent player options (localStorage). Every option here is wired to a real effect.
import { RENDER_DISTANCE_DEFAULT } from '../../shared/constants.js';

export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', swapHands: 'KeyF', chat: 'KeyT', command: 'Slash', playerList: 'Tab',
  debug: 'F3', camera: 'KeyV', fullscreen: 'F11',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5',
  hotbar6: 'Digit6', hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

export const KEY_LABELS = {
  forward: 'Walk Forwards', back: 'Walk Backwards', left: 'Strafe Left', right: 'Strafe Right', jump: 'Jump', sneak: 'Sneak',
  sprint: 'Sprint', inventory: 'Open/Close Inventory', drop: 'Drop Selected Item', swapHands: 'Swap Item With Offhand',
  chat: 'Open Chat', command: 'Open Command', playerList: 'List Players', debug: 'Debug Screen', camera: 'Toggle Perspective',
  fullscreen: 'Toggle Fullscreen',
  hotbar1: 'Hotbar Slot 1', hotbar2: 'Hotbar Slot 2', hotbar3: 'Hotbar Slot 3', hotbar4: 'Hotbar Slot 4', hotbar5: 'Hotbar Slot 5',
  hotbar6: 'Hotbar Slot 6', hotbar7: 'Hotbar Slot 7', hotbar8: 'Hotbar Slot 8', hotbar9: 'Hotbar Slot 9',
};

export const DEFAULTS = {
  renderDistance: RENDER_DISTANCE_DEFAULT,
  fov: 70,
  clouds: 'fancy', // off | fast | fancy
  viewBobbing: true,
  guiScale: 0, // 0 = auto
  fpsCap: 0, // 0 = unlimited
  particles: 'all', // all | minimal
  smoothLighting: true,
  fullscreen: false,
  sensitivity: 100, // percent
  invertMouse: false,
  toggleSprint: false,
  toggleSneak: false,
  volumes: { master: 100, music: 50, blocks: 100, mobs: 100, ambient: 100, ui: 100 },
  chatOpacity: 100,
  chatScale: 100,
  keys: { ...DEFAULT_KEYS },
  username: '',
  fullName: '',
  signedIn: false, // multiplayer profile (username + full name) entered on the sign-in form
  lang: 'en',
  skin: null, // dressing room choice { tone, hair, shirt, pants, long }; null = generated from the name
};

const KEY = 'shaftcraft.options';

function randomName() {
  const a = ['Brave', 'Quiet', 'Lucky', 'Swift', 'Mossy', 'Stone', 'Iron', 'Clever', 'Sunny', 'Pixel'];
  const b = ['Miner', 'Fox', 'Builder', 'Digger', 'Wolf', 'Crafter', 'Owl', 'Explorer', 'Rabbit', 'Smith'];
  return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)] + Math.floor(Math.random() * 90 + 10);
}

export class Options {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
    this.data = { ...DEFAULTS, ...saved, volumes: { ...DEFAULTS.volumes, ...(saved.volumes || {}) }, keys: { ...DEFAULT_KEYS, ...(saved.keys || {}) } };
    // F5 is a media/reload key on many keyboards: move old saves to V (F5 keeps working as an alternate)
    if (this.data.keys.camera === 'F5') { this.data.keys = { ...this.data.keys, camera: 'KeyV' }; this.save(); }
    if (!this.data.username) { this.data.username = randomName(); this.save(); }
    this.listeners = new Set();
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); for (const l of this.listeners) l(k, v); }
  setVolume(k, v) { this.data.volumes = { ...this.data.volumes, [k]: v }; this.save(); for (const l of this.listeners) l('volumes', this.data.volumes); }
  setKey(action, code) { this.data.keys = { ...this.data.keys, [action]: code }; this.save(); for (const l of this.listeners) l('keys', this.data.keys); }
  resetKeys() { this.data.keys = { ...DEFAULT_KEYS }; this.save(); for (const l of this.listeners) l('keys', this.data.keys); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ } }
}

export function keyName(code) {
  if (!code) return 'NONE';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Space: 'Space', Slash: '/', Tab: 'Tab', Escape: 'Esc', Mouse0: 'Left Button', Mouse1: 'Middle Button', Mouse2: 'Right Button', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backslash: '\\', CapsLock: 'Caps Lock', Enter: 'Enter' };
  return map[code] || code.replace(/^Numpad/, 'Num ').replace(/^Arrow/, '');
}
