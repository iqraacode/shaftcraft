// Menu screens and in-game overlays. Every control here performs a real action.
import { LANGUAGES, setLanguage, tr } from './i18n.js';
import { el, button, cycle, toggle, slider, textField, labeled, formatDate, uiHooks } from './widgets.js';
import { GUI } from './guitex.js';
import { InventoryUI, PlayerPreview } from './InventoryUI.js';
import { SKIN_PALETTE, playerSkinTexture } from '../render/models.js';
import { listWorlds, renameWorld, deleteWorld, formatSize } from '../net/storage.js';
import { pingServer } from '../net/Connection.js';
import { KEY_LABELS, keyName } from '../options.js';
import { VERSION, RENDER_DISTANCE_MIN, RENDER_DISTANCE_MAX, MAX_CHAT_LENGTH } from '../../../shared/constants.js';
import { getIconURL } from '../textures/icons.js';
import { ITEMS } from '../../../shared/items.js';
import { CAMERA_NAMES } from '../game/Game.js';

const SPLASHES = ['Now with gliders!', 'Dig down... carefully!', 'Made of noise!', '100% procedural!', 'Mind the creepers!', 'Shafts included!', 'Torches recommended!', 'Also try fishing! (not included)', 'Blocky and proud!', 'Lava is hot!'];
const SERVERS_KEY = 'shaftcraft.servers';
// When the page is served by the game server itself, default to that host; otherwise localhost.
const DEFAULT_ADDRESS = (location.port && location.port !== '5173' && location.port !== '4173') ? location.host : 'localhost';

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.screen = null;
    this.onBack = null;
    this.paused = false;
    this.chatOpen = false;
    this.inventory = new InventoryUI(app);
    this.history = [];
    this.historyIdx = -1;
    uiHooks.click = () => { app.audio.ensure(); app.audio.play('click'); };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.screen && this.onBack && !this.listeningKey) { e.preventDefault(); this.onBack(); }
    });
  }

  // ---------- generic ----------
  clear() {
    if (this.screen) this.screen.remove();
    this.screen = null; this.onBack = null;
  }

  show(node, onBack = null, focus = true) {
    this.clear();
    this.screen = node;
    this.onBack = onBack;
    this.root.appendChild(node);
    if (focus) { const f = node.querySelector('button:not(:disabled), input, [tabindex]'); if (f && f.tagName !== 'INPUT') f.focus({ preventScroll: true }); }
  }

  capturesInput() { return !!this.screen || this.inventory.isOpen || this.chatOpen; }
  isPaused() { return this.paused; }

  screenEl(cls = 'dirt') { return el('div', 'screen ' + cls); }

  // ---------- title ----------
  title() {
    this.paused = false;
    const s = this.screenEl('clear');
    const col = el('div', 'col');
    const logoWrap = el('div', 'logo-wrap');
    const logo = document.createElement('img');
    logo.className = 'logo';
    logo.src = GUI.logo.toDataURL();
    logo.alt = 'ShaftCraft';
    const splash = el('div', 'splash', SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);
    logoWrap.append(logo, splash);
    col.append(logoWrap);
    col.append(button('Singleplayer', () => this.singleplayer()));
    col.append(button('Multiplayer', () => this.multiplayer()));
    const row = el('div', 'row');
    row.append(button('Options...', () => this.options(() => this.title()), 'w98'));
    row.append(button('Dressing Room', () => this.dressingRoom(() => this.title()), 'w98'));
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) row.append(button('Quit Game', () => window.close(), 'w98'));
    col.append(row);
    const lang = button('🌐 ' + LANGUAGES.find((l) => l.id === this.app.options.get('lang')).name, () => this.languageScreen(() => this.title()), 'w98');
    lang.title = 'Language';
    col.append(lang);
    s.append(col, el('div', 'corner left', VERSION + ' - not affiliated with Mojang'), el('div', 'corner right', 'All rights reserved Anir ABIDAR GAMES Ⓒ'));
    this.show(s, null);
    this.app.showPanorama(true);
  }

  // ---------- singleplayer ----------
  async singleplayer() {
    const s = this.screenEl('dirt');
    const layout = el('div', 'layout-list');
    layout.append(Object.assign(el('div', 'head'), { innerHTML: '' }));
    layout.firstChild.append(el('div', 'title', 'Select World'));
    const list = el('div', 'list');
    layout.append(list);
    const foot = el('div', 'foot');
    let selected = null;
    const play = button('Play Selected World', () => selected && this.app.playWorld(selected), 'w150', true);
    const create = button('Create New World', () => this.createWorld(), 'w150');
    const rename = button('Rename', () => selected && this.renameWorld(selected), 'w74', true);
    const del = button('Delete', () => selected && this.confirm('Are you sure you want to delete this world?', `'${selected.name}' will be lost forever! (A long time!)`, 'Delete', async () => { await deleteWorld(selected.id); this.singleplayer(); }, () => this.singleplayer()), 'w74', true);
    const back = button('Back', () => this.title(), 'w150');
    const r1 = el('div', 'row'); r1.append(play, create);
    const r2 = el('div', 'row'); r2.append(rename, del, back);
    foot.append(r1, r2);
    layout.append(foot);
    s.append(layout);
    this.show(s, () => this.title());
    const worlds = await listWorlds().catch(() => []);
    if (this.screen !== s) return;
    if (!worlds.length) list.append(el('div', 'list-empty', 'No worlds yet. Create one!'));
    const setSel = (w, e) => {
      selected = w;
      for (const c of list.children) c.classList.remove('selected');
      if (e) e.classList.add('selected');
      play.disabled = rename.disabled = del.disabled = !w;
    };
    for (const w of worlds) {
      const e = el('div', 'entry');
      e.tabIndex = 0;
      const icon = el('div', 'icon');
      icon.style.backgroundImage = `url(${getIconURL(w.hardcore ? 'diamond_sword' : w.gamemode === 'creative' ? 'grass' : 'iron_pickaxe')})`;
      const lines = el('div', 'lines');
      lines.append(el('div', '', w.name));
      lines.append(el('div', 'gray', `${w.id}  (${formatDate(w.lastPlayed)})`));
      const mode = w.hardcore ? 'Hardcore Mode!' : w.gamemode === 'creative' ? 'Creative Mode' : 'Survival Mode';
      lines.append(el('div', w.hardcore ? 'red-text' : 'gray', `${mode}${w.allowCommands ? ', Cheats' : ''} - ${formatSize(w.size || 0)}`));
      e.append(icon, lines);
      e.addEventListener('click', () => setSel(w, e));
      e.addEventListener('dblclick', () => this.app.playWorld(w));
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { if (selected === w) this.app.playWorld(w); else setSel(w, e); } });
      list.append(e);
    }
  }

  createWorld() {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Create New World'));
    const name = textField('New World', '', 32);
    const seed = textField('', 'Leave blank for a random seed', 32);
    col.append(labeled('World Name', name), labeled('Seed for the World Generator', seed));
    let mode = 'survival', diff = 'normal', cheats = false, type = 'default';
    const diffBtn = cycle('Difficulty', ['peaceful', 'easy', 'normal', 'hard'], diff, (v) => { diff = v; }, 'w150', cap);
    const cheatsBtn = toggle('Allow Commands', cheats, (v) => { cheats = v; }, 'w150');
    const modeBtn = cycle('Game Mode', ['survival', 'creative', 'hardcore'], mode, (v) => {
      mode = v;
      if (v === 'hardcore') { diffBtn.setValue('hard'); diff = 'hard'; diffBtn.disabled = true; cheatsBtn.setValue(false); cheats = false; cheatsBtn.disabled = true; }
      else { diffBtn.disabled = false; cheatsBtn.disabled = false; if (v === 'creative' && !cheats) { cheats = true; cheatsBtn.setValue(true); } }
    }, 'w150', cap);
    const typeBtn = cycle('World Type', ['default', 'flat'], type, (v) => { type = v; }, 'w150', (v) => (v === 'flat' ? 'Superflat' : 'Default'));
    const r1 = el('div', 'row'); r1.append(modeBtn, diffBtn);
    const r2 = el('div', 'row'); r2.append(cheatsBtn, typeBtn);
    col.append(el('div', 'spacer'), r1, r2, el('div', 'spacer'));
    const r3 = el('div', 'row');
    const go = () => {
      const n = name.value.trim() || 'New World';
      this.app.createAndPlay({ name: n, seed: seed.value.trim(), gamemode: mode, difficulty: diff, allowCommands: cheats, type });
    };
    r3.append(button('Create New World', go, 'w150'), button('Cancel', () => this.singleplayer(), 'w150'));
    col.append(r3);
    for (const f of [name, seed]) f.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    s.append(col);
    this.show(s, () => this.singleplayer(), false);
    name.focus(); name.select();
  }

  renameWorld(w) {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Rename World'));
    const f = textField(w.name, '', 32);
    col.append(labeled('World Name', f), el('div', 'spacer'));
    const done = async () => { const n = f.value.trim(); if (n) await renameWorld(w.id, n); this.singleplayer(); };
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    col.append(button('Rename World', done), button('Cancel', () => this.singleplayer()));
    s.append(col);
    this.show(s, () => this.singleplayer(), false);
    f.focus(); f.select();
  }

  confirm(text, sub, yes, onYes, onNo) {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'text', text), el('div', 'text gray', sub), el('div', 'spacer'));
    const r = el('div', 'row');
    r.append(button(yes, onYes, 'w150'), button('Cancel', onNo, 'w150'));
    col.append(r);
    s.append(col);
    this.show(s, onNo);
  }

  // ---------- multiplayer ----------
  servers() { try { return JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]'); } catch { return []; } }
  saveServers(list) { try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } }

  languageScreen(back) {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Language'));
    for (const l of LANGUAGES) {
      const b = button((l.id === this.app.options.get('lang') ? '> ' : '') + l.name, () => { this.app.options.set('lang', l.id); setLanguage(l.id); back(); });
      col.append(b);
    }
    col.append(el('div', 'spacer'), button('Done', back));
    s.append(col);
    this.show(s, back);
  }

  // Multiplayer profile: a username (used in game) and a full name, stored on this device.
  signIn(next) {
    const o = this.app.options;
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Sign In'), el('div', 'text gray', 'Sign in to play multiplayer'));
    const user = textField(o.get('username'), 'Enter user name', 16);
    const full = textField(o.get('fullName'), 'Full name', 32);
    const err = el('div', 'red-text', '');
    col.append(labeled('Enter user name', user), labeled('Full name', full), err, el('div', 'spacer'));
    user.addEventListener('input', () => { const v = user.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); if (v !== user.value) user.value = v; });
    const go = () => {
      const u = user.value.trim(), f = full.value.trim().replace(/\s+/g, ' ');
      if (u.length < 3) { err.textContent = tr('Enter user name') + ' (3-16: A-Z 0-9 _)'; user.focus(); return; }
      if (f.length < 2) { err.textContent = tr('Full name') + ' (2-32)'; full.focus(); return; }
      o.set('username', u); o.set('fullName', f); o.set('signedIn', true);
      next();
    };
    for (const f of [user, full]) f.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const r = el('div', 'row');
    r.append(button('Sign In', go, 'w150'), button('Cancel', () => this.title(), 'w150'));
    col.append(r);
    s.append(col);
    this.show(s, () => this.title(), false);
    user.focus();
  }

  multiplayer() {
    if (!this.app.options.get('signedIn')) { this.signIn(() => this.multiplayer()); return; }
    const s = this.screenEl('dirt');
    const layout = el('div', 'layout-list');
    const head = el('div', 'head');
    head.style.gap = 'calc(8px * var(--s))';
    const who = el('div', 'label', '');
    who.textContent = `${tr('Signed in as')} ${this.app.options.get('username')} (${this.app.options.get('fullName')})`;
    const out = button('Sign Out', () => { this.app.options.set('signedIn', false); this.signIn(() => this.multiplayer()); }, 'w74');
    head.append(el('div', 'title', 'Play Multiplayer'), who, out);
    layout.append(head);
    const list = el('div', 'list');
    layout.append(list);
    const foot = el('div', 'foot');
    let selected = -1;
    const servers = this.servers();
    const join = button('Join Server', () => selected >= 0 && this.app.joinServer(servers[selected].address, servers[selected].name), 'w100', true);
    const direct = button('Direct Connect', () => this.directConnect(), 'w100');
    const add = button('Add Server', () => this.editServer(-1), 'w100');
    const edit = button('Edit', () => selected >= 0 && this.editServer(selected), 'w74', true);
    const del = button('Delete', () => {
      if (selected < 0) return;
      const sv = servers[selected];
      this.confirm('Are you sure you want to remove this server?', `'${sv.name}' will be lost forever! (A long time!)`, 'Delete', () => { servers.splice(selected, 1); this.saveServers(servers); this.multiplayer(); }, () => this.multiplayer());
    }, 'w74', true);
    const refresh = button('Refresh', () => this.multiplayer(), 'w74');
    const back = button('Back', () => this.title(), 'w74');
    const r1 = el('div', 'row'); r1.append(join, direct, add);
    const r2 = el('div', 'row'); r2.append(edit, del, refresh, back);
    foot.append(r1, r2);
    layout.append(foot);
    s.append(layout);
    if (!servers.length) list.append(el('div', 'list-empty', 'No servers yet. Add one (e.g. localhost)!'));
    const setSel = (i, e) => {
      selected = i;
      for (const c of list.children) c.classList.remove('selected');
      if (e) e.classList.add('selected');
      join.disabled = edit.disabled = del.disabled = i < 0;
    };
    servers.forEach((sv, i) => {
      const e = el('div', 'entry');
      e.tabIndex = 0;
      const icon = el('div', 'icon');
      icon.style.backgroundImage = `url(${getIconURL('grass')})`;
      const lines = el('div', 'lines');
      lines.append(el('div', '', sv.name));
      const motd = el('div', 'gray', 'Pinging...');
      lines.append(motd, el('div', 'gray', sv.address));
      const right = el('div', 'right', '');
      e.append(icon, lines, right);
      e.addEventListener('click', () => setSel(i, e));
      e.addEventListener('dblclick', () => this.app.joinServer(sv.address, sv.name));
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { if (selected === i) this.app.joinServer(sv.address, sv.name); else setSel(i, e); } });
      list.append(e);
      pingServer(sv.address).then((st) => {
        motd.textContent = st.motd || '';
        motd.className = '';
        right.innerHTML = `${st.players}/${st.max}<br>${st.ping} ms`;
      }).catch(() => { motd.textContent = "Can't connect to server"; motd.className = 'red-text'; right.textContent = 'offline'; });
    });
    this.show(s, () => this.title());
  }

  editServer(index) {
    const servers = this.servers();
    const cur = index >= 0 ? servers[index] : { name: 'ShaftCraft Server', address: DEFAULT_ADDRESS };
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', index >= 0 ? 'Edit Server Info' : 'Add Server'));
    const name = textField(cur.name, '', 32);
    const addr = textField(cur.address, 'host:port', 128);
    col.append(labeled('Server Name', name), labeled('Server Address', addr), el('div', 'spacer'));
    const done = () => {
      const entry = { name: name.value.trim() || 'ShaftCraft Server', address: addr.value.trim() || 'localhost' };
      if (index >= 0) servers[index] = entry; else servers.push(entry);
      this.saveServers(servers);
      this.multiplayer();
    };
    for (const f of [name, addr]) f.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    col.append(button('Done', done), button('Cancel', () => this.multiplayer()));
    s.append(col);
    this.show(s, () => this.multiplayer(), false);
    name.focus(); name.select();
  }

  directConnect() {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Direct Connect'));
    const addr = textField(localStorage.getItem('shaftcraft.lastDirect') || DEFAULT_ADDRESS, 'host:port', 128);
    col.append(labeled('Server Address', addr), el('div', 'spacer'));
    const go = () => { const a = addr.value.trim() || 'localhost'; try { localStorage.setItem('shaftcraft.lastDirect', a); } catch { /* ignore */ } this.app.joinServer(a, a); };
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    col.append(button('Join Server', go), button('Cancel', () => this.multiplayer()));
    s.append(col);
    this.show(s, () => this.multiplayer(), false);
    addr.focus(); addr.select();
  }

  // ---------- options ----------
  options(back) {
    const o = this.app.options;
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Options'));
    const r1 = el('div', 'row'); r1.append(button('Video Settings...', () => this.video(() => this.options(back)), 'w150'), button('Controls...', () => this.controls(() => this.options(back)), 'w150'));
    const r2 = el('div', 'row'); r2.append(button('Music & Sounds...', () => this.audioScreen(() => this.options(back)), 'w150'), button('Chat Settings...', () => this.chatSettings(() => this.options(back)), 'w150'));
    col.append(r1, r2, el('div', 'spacer'), button('Done', back));
    void o;
    s.append(col);
    this.show(s, back);
  }

  video(back) {
    const o = this.app.options;
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Video Settings'));
    const grid = el('div', 'col');
    const rows = [
      [slider({ min: RENDER_DISTANCE_MIN, max: RENDER_DISTANCE_MAX, value: o.get('renderDistance'), label: (v) => `Render Distance: ${v} chunks`, onChange: (v) => o.set('renderDistance', v) }),
        slider({ min: 30, max: 110, value: o.get('fov'), label: (v) => `FOV: ${v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : v}`, onChange: (v) => o.set('fov', v) })],
      [cycle('Clouds', ['fancy', 'fast', 'off'], o.get('clouds'), (v) => o.set('clouds', v), 'w150', cap),
        toggle('View Bobbing', o.get('viewBobbing'), (v) => o.set('viewBobbing', v), 'w150')],
      [cycle('GUI Scale', [0, 1, 2, 3, 4], o.get('guiScale'), (v) => o.set('guiScale', v), 'w150', (v) => (v === 0 ? 'Auto' : String(v))),
        slider({ min: 30, max: 260, step: 10, value: o.get('fpsCap') || 260, label: (v) => `Max Framerate: ${v >= 260 ? 'Unlimited' : v + ' fps'}`, onChange: (v) => o.set('fpsCap', v >= 260 ? 0 : v) })],
      [cycle('Particles', ['all', 'minimal'], o.get('particles'), (v) => o.set('particles', v), 'w150', cap),
        toggle('Smooth Lighting', o.get('smoothLighting'), (v) => o.set('smoothLighting', v), 'w150')],
      [toggle('Fullscreen', !!document.fullscreenElement, (v) => this.app.setFullscreen(v), 'w150')],
    ];
    for (const r of rows) { const row = el('div', 'row'); row.append(...r); grid.append(row); }
    col.append(grid, el('div', 'spacer'), button('Done', back));
    s.append(col);
    this.show(s, back);
  }

  controls(back) {
    const o = this.app.options;
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Controls'));
    const r1 = el('div', 'row');
    r1.append(slider({ min: 10, max: 200, step: 5, value: o.get('sensitivity'), label: (v) => `Sensitivity: ${v}%`, onChange: (v) => o.set('sensitivity', v) }),
      toggle('Invert Mouse', o.get('invertMouse'), (v) => o.set('invertMouse', v), 'w150'));
    const r2 = el('div', 'row');
    r2.append(cycle('Sprint', [false, true], o.get('toggleSprint'), (v) => o.set('toggleSprint', v), 'w150', (v) => (v ? 'Toggle' : 'Hold')),
      cycle('Sneak', [false, true], o.get('toggleSneak'), (v) => o.set('toggleSneak', v), 'w150', (v) => (v ? 'Toggle' : 'Hold')));
    col.append(r1, r2);
    const area = el('div', 'scroll-area');
    const kl = el('div', 'keylist');
    const keys = o.get('keys');
    for (const action of Object.keys(KEY_LABELS)) {
      const b = button(keyName(keys[action]), () => {
        if (this.listeningKey) return;
        b.textContent = '> Press a key <';
        b.classList.add('listening');
        this.listeningKey = (e) => {
          e.preventDefault(); e.stopPropagation();
          window.removeEventListener('keydown', this.listeningKey, true);
          const code = e.code;
          setTimeout(() => { this.listeningKey = null; }, 0);
          b.classList.remove('listening');
          if (code !== 'Escape') o.setKey(action, code);
          b.textContent = keyName(o.get('keys')[action]);
          this.markConflicts(kl);
        };
        window.addEventListener('keydown', this.listeningKey, true);
      }, 'w100');
      b.dataset.action = action;
      kl.append(el('div', 'k-label', KEY_LABELS[action]), b);
    }
    this.markConflicts(kl);
    area.append(kl);
    col.append(area);
    const r3 = el('div', 'row');
    r3.append(button('Reset Keys', () => { o.resetKeys(); this.controls(back); }, 'w150'), button('Done', back, 'w150'));
    col.append(r3);
    s.append(col);
    this.show(s, back);
  }

  markConflicts(kl) {
    const keys = this.app.options.get('keys');
    const count = {};
    for (const v of Object.values(keys)) count[v] = (count[v] || 0) + 1;
    for (const b of kl.querySelectorAll('button')) b.style.color = count[keys[b.dataset.action]] > 1 ? '#ff5555' : '';
  }

  audioScreen(back) {
    const o = this.app.options;
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Music & Sound Options'));
    const names = [['master', 'Master Volume'], ['music', 'Music'], ['blocks', 'Blocks'], ['mobs', 'Mobs'], ['ambient', 'Ambient/Environment'], ['ui', 'User Interface']];
    const mk = ([k, label]) => slider({ min: 0, max: 100, value: o.get('volumes')[k], label: (v) => `${label}: ${v === 0 ? 'OFF' : v + '%'}`, onChange: (v) => o.setVolume(k, v) });
    col.append(slider({ min: 0, max: 100, value: o.get('volumes').master, label: (v) => `Master Volume: ${v === 0 ? 'OFF' : v + '%'}`, onChange: (v) => o.setVolume('master', v), cls: 'w310' }));
    for (let i = 1; i < names.length; i += 2) {
      const r = el('div', 'row');
      r.append(mk(names[i]));
      if (names[i + 1]) r.append(mk(names[i + 1]));
      col.append(r);
    }
    col.append(el('div', 'spacer'), button('Done', back));
    s.append(col);
    this.show(s, back);
  }

  chatSettings(back) {
    const o = this.app.options;
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Chat Settings'));
    const r = el('div', 'row');
    r.append(slider({ min: 10, max: 100, step: 5, value: o.get('chatOpacity'), label: (v) => `Text Opacity: ${v}%`, onChange: (v) => o.set('chatOpacity', v) }),
      slider({ min: 50, max: 200, step: 10, value: o.get('chatScale'), label: (v) => `Text Size: ${v}%`, onChange: (v) => o.set('chatScale', v) }));
    col.append(r, el('div', 'spacer'), button('Done', back));
    s.append(col);
    this.show(s, back);
  }

  // ---------- dressing room ----------
  dressingRoom(back) {
    const o = this.app.options;
    const name = o.get('username');
    const s = this.screenEl(this.app.game ? 'dim' : 'dirt');
    const row = el('div', 'row');
    row.style.gap = 'calc(12px * var(--s))';
    const prevBox = el('div', 'preview');
    prevBox.style.width = 'calc(90px * var(--s))'; prevBox.style.height = 'calc(130px * var(--s))';
    const preview = new PlayerPreview(this.app, name, o.get('skin'));
    prevBox.append(preview.canvas);
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Dressing Room'));
    let skin = o.get('skin') ? { ...o.get('skin') } : { tone: 1, hair: 0, shirt: 0, pants: 2, long: false };
    const apply = (custom) => {
      o.set('skin', custom);
      const mat = preview.view.rig.materials[0];
      mat.map = playerSkinTexture(name, custom); mat.needsUpdate = true;
      if (this.app.game) this.app.game.setSkin(custom);
    };
    const range = (n) => [...Array(n).keys()];
    const opts = [
      ['Skin Tone', 'tone', SKIN_PALETTE.tone.length], ['Hair Color', 'hair', SKIN_PALETTE.hair.length],
      ['Shirt', 'shirt', SKIN_PALETTE.cloth.length], ['Pants', 'pants', SKIN_PALETTE.cloth.length],
    ];
    for (const [label, key, n] of opts) col.append(cycle(label, range(n), skin[key], (v) => { skin[key] = v; apply({ ...skin }); }, '', (v) => String(v + 1)));
    col.append(toggle('Long Hair', !!skin.long, (v) => { skin.long = v; apply({ ...skin }); }));
    col.append(button('Use Name-Based Skin', () => { apply(null); }));
    col.append(el('div', 'spacer'), button('Done', () => { stop(); back(); }));
    row.append(prevBox, col);
    s.append(row);
    let running = true, last = performance.now();
    const stop = () => { running = false; preview.dispose(); };
    const inv = { main: [], selected: 0, armor: [null, null, null, null] };
    const loop = (t) => {
      if (!running || this.screen !== s) { if (running) stop(); return; }
      preview.render(Math.min(0.1, (t - last) / 1000), inv); last = t;
      requestAnimationFrame(loop);
    };
    this.show(s, () => { stop(); back(); });
    requestAnimationFrame(() => { const r = prevBox.getBoundingClientRect(); preview.resize(r.width, r.height); requestAnimationFrame(loop); });
  }

  // ---------- in-game ----------
  pause() {
    const g = this.app.game;
    if (!g) return;
    this.paused = true;
    g.setPaused(true);
    const s = this.screenEl('dim');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Game Menu'));
    col.append(button('Back to Game', () => this.resume()));
    col.append(cycle('Camera', [0, 1, 2], g.cameraMode, (v) => g.setCameraMode(v), '', (v) => CAMERA_NAMES[v]));
    col.append(button('Options...', () => this.options(() => this.pause())));
    col.append(button('Dressing Room', () => this.dressingRoom(() => this.pause())));
    col.append(el('div', 'spacer'));
    col.append(button(g.sp ? 'Save and Quit to Title' : 'Disconnect', () => this.app.quitToTitle()));
    if (g.sp) col.append(el('div', 'label', 'Game paused'));
    s.append(col);
    this.show(s, () => this.resume());
  }

  resume() {
    this.clear();
    this.paused = false;
    if (this.app.game) this.app.game.setPaused(false);
    this.app.input.requestLock();
  }

  showDeath(info) {
    this.closeChat();
    this.app.input.exitLock();
    const s = this.screenEl('red');
    const col = el('div', 'col');
    col.append(el('div', 'big-title', info.hardcore ? 'Game over!' : 'You died!'));
    col.append(el('div', 'text', info.cause || ''));
    col.append(el('div', 'text', ''), Object.assign(el('div', 'text'), { innerHTML: `Score: <span class="yellow">${info.score || 0}</span>` }), el('div', 'spacer'));
    if (info.hardcore) {
      col.append(button('Spectate World', () => { this.app.game.hardcoreSpectate(); this.closeDeath(); }));
      col.append(button(info.sp ? 'Delete World' : 'Leave Server', () => (info.sp ? this.app.deleteCurrentWorld() : this.app.quitToTitle())));
    } else {
      col.append(button('Respawn', () => this.app.game.respawn()));
      col.append(button('Title Screen', () => this.app.quitToTitle()));
    }
    s.append(col);
    this.deathScreen = s;
    this.show(s, null);
  }

  closeDeath() {
    if (this.deathScreen && this.screen === this.deathScreen) { this.clear(); this.app.input.requestLock(); }
    this.deathScreen = null;
  }

  loading(text, onCancel) {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    const t = el('div', 'text', text);
    const sub = el('div', 'text gray', '');
    const bar = el('div', 'progress'); const fill = el('div'); bar.append(fill);
    col.append(t, sub, bar, el('div', 'spacer'));
    if (onCancel) col.append(button('Cancel', onCancel));
    s.append(col);
    this.show(s, onCancel || null);
    return {
      set: (text2, frac, detail) => { if (text2) t.textContent = text2; if (detail !== undefined) sub.textContent = detail; fill.style.width = Math.round(Math.min(1, frac) * 100) + '%'; },
    };
  }

  error(titleText, msg, backLabel, onBack) {
    const s = this.screenEl('dirt');
    const col = el('div', 'col');
    col.append(el('div', 'title', titleText), el('div', 'text gray', msg), el('div', 'spacer'), button(backLabel, onBack));
    s.append(col);
    this.show(s, onBack);
  }

  showSleep() {
    this.hideSleep();
    const s = el('div', 'sleep-overlay');
    s.append(button('Leave Bed', () => this.app.game && this.app.game.leaveBed()));
    this.sleepEl = s;
    this.root.append(s);
    this.app.input.exitLock();
  }

  hideSleep() {
    if (this.sleepEl) { this.sleepEl.remove(); this.sleepEl = null; if (this.app.game && !this.capturesInput()) this.app.input.requestLock(); }
  }

  spectatorMenu() {
    const g = this.app.game;
    const s = this.screenEl('dim');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Teleport to Player'));
    const others = g.players.filter((p) => p.id !== g.eid);
    if (!others.length) col.append(el('div', 'text gray', 'No other players online'));
    for (const p of others) col.append(button(p.name, () => { g.spectateTp(p.name); this.closeMenus(); }));
    col.append(el('div', 'spacer'), button('Close', () => this.closeMenus()));
    s.append(col);
    this.spectatorOpen = true;
    this.show(s, () => this.closeMenus());
  }

  refreshSpectatorMenu() { if (this.spectatorOpen && this.screen) this.spectatorMenu(); }

  closeMenus() {
    this.spectatorOpen = false;
    this.clear();
    this.app.input.requestLock();
  }

  onModeChanged() {
    if (this.inventory.isOpen) this.closeInventory(true);
  }

  // ---------- inventory ----------
  openInventory(type) {
    this.closeChat();
    this.app.input.exitLock();
    this.inventory.open(type);
  }

  closeInventory(notify) {
    if (!this.inventory.isOpen) return;
    this.inventory.close(notify);
    if (!this.screen && !this.chatOpen && this.app.game && this.app.game.alive) this.app.input.requestLock();
  }

  refreshInventory() {
    this.inventory.refresh();
    if (this.tradeData && this.screen === this.tradeScreen) this.trades(this.tradeData);
  }

  // Villager trading: one row per offer, enabled when you have enough of the cost item.
  trades(data) {
    const g = this.app.game;
    if (!g) return;
    this.closeChat();
    this.app.input.exitLock();
    this.tradeData = data;
    const s = this.screenEl('dim');
    const col = el('div', 'col');
    col.append(el('div', 'title', 'Villager - ' + data.prof.charAt(0).toUpperCase() + data.prof.slice(1)));
    const have = (id) => g.inv.main.reduce((n, st) => n + (st && st.id === id ? st.count : 0), 0);
    const icon = (id, n) => {
      const w = el('div', 'slot');
      const img = el('img'); img.src = getIconURL(id); w.append(img);
      if (n > 1) w.append(el('div', 'count', String(n)));
      w.title = ITEMS[id] ? ITEMS[id].display : id;
      return w;
    };
    data.offers.forEach(([cost, n, res, rn], i) => {
      const row = el('div', 'row');
      const ok = g.gamemode === 'creative' || have(cost) >= n;
      row.append(icon(cost, n), el('div', 'text', '->'), icon(res, rn),
        el('div', 'label', `${ITEMS[res] ? ITEMS[res].display : res}  (you have ${have(cost)} ${ITEMS[cost] ? ITEMS[cost].display : cost})`),
        button('Trade', () => g.trade(data.eid, i), 'w74', !ok));
      col.append(row);
    });
    col.append(el('div', 'spacer'), button('Done', () => { this.tradeData = null; this.closeMenus(); }));
    s.append(col);
    this.tradeScreen = s;
    this.show(s, () => { this.tradeData = null; this.closeMenus(); });
  }

  // ---------- chat ----------
  openChat(prefix = '') {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.app.input.exitLock();
    const input = el('input', 'chat-input');
    input.maxLength = MAX_CHAT_LENGTH;
    input.spellcheck = false;
    input.value = prefix;
    this.historyIdx = this.history.length;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) { this.app.game.sendChat(v); this.history.push(v); if (this.history.length > 50) this.history.shift(); }
        this.closeChat(true);
      } else if (e.key === 'Escape') { e.preventDefault(); this.closeChat(true); }
      else if (e.key === 'ArrowUp') { if (this.historyIdx > 0) { this.historyIdx--; input.value = this.history[this.historyIdx]; } e.preventDefault(); }
      else if (e.key === 'ArrowDown') { if (this.historyIdx < this.history.length - 1) { this.historyIdx++; input.value = this.history[this.historyIdx]; } else { this.historyIdx = this.history.length; input.value = ''; } e.preventDefault(); }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    this.chatInput = input;
    this.root.append(input);
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
  }

  closeChat(relock = false) {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    if (this.chatInput) this.chatInput.remove();
    this.chatInput = null;
    if (relock && this.app.game && !this.screen && !this.inventory.isOpen) this.app.input.requestLock();
  }

  closeAll() {
    this.closeChat();
    if (this.inventory.isOpen) this.inventory.close(false);
    this.hideSleep();
    this.spectatorOpen = false;
    this.clear();
    this.paused = false;
  }
}

function cap(v) { return String(v).charAt(0).toUpperCase() + String(v).slice(1); }
