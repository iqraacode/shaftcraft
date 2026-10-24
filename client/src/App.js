// Application shell: owns renderer, audio, input, HUD and UI; runs the main loop
// (fixed 20 TPS simulation + interpolated rendering) and the game lifecycle.
import * as C from '../../shared/constants.js';
import { Options } from './options.js';
import { Renderer } from './render/Renderer.js';
import { AudioEngine } from './audio/Audio.js';
import { Input } from './game/Input.js';
import { HUD } from './ui/HUD.js';
import { UI } from './ui/UI.js';
import { buildGuiTextures, GUI } from './ui/guitex.js';
import { Game } from './game/Game.js';
import { SPConnection, WSConnection } from './net/Connection.js';
import { createWorldMeta, deleteWorld } from './net/storage.js';
import { ClientWorld } from './world/ClientWorld.js';
import { ChunkManager } from './world/ChunkManager.js';
import { WorldGen } from '../../shared/worldgen.js';
import { el } from './ui/widgets.js';
import { setLanguage } from './ui/i18n.js';
import { TouchControls, IS_TOUCH } from './ui/Touch.js';

const PANORAMA_SEED = 20240611;

export class App {
  constructor() {
    this.options = new Options();
    this.game = null;
    this.accum = 0;
    this.last = performance.now();
    this.lastFrame = 0;
    this.lastLoop = 0;
  }

  async init() {
    try { await document.fonts.load('16px "Pixelify Sans"'); } catch { /* fallback font */ }
    this.renderer = new Renderer(document.getElementById('game-canvas'));
    buildGuiTextures();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--dirt', `url(${GUI.dirt})`);
    rootStyle.setProperty('--stone', `url(${GUI.stone})`);
    rootStyle.setProperty('--stone-hover', `url(${GUI.stoneHover})`);
    this.audio = new AudioEngine();
    this.input = new Input(document.getElementById('game-canvas'), this.options);
    this.hud = new HUD(document.getElementById('hud-canvas'), this);
    this.uiRoot = document.getElementById('ui');
    setLanguage(this.options.get('lang'));
    this.ui = new UI(this);
    this.touch = IS_TOUCH ? new TouchControls(this) : null;
    this.applyAllOptions();
    this.options.onChange((k, v) => this.applyOption(k, v));
    window.addEventListener('resize', () => this.applyScale());
    const unlockAudio = () => { this.audio.ensure(); this.applyOption('volumes', this.options.get('volumes')); };
    window.addEventListener('mousedown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.input.keyListeners.push((code, down, repeat, e) => this.onKey(code, down, repeat, e));
    this.input.mouseListeners.push((button, down) => {
      if (this.game && this.game.ready && !this.ui.capturesInput()) this.game.onMouse(button, down);
    });
    this.input.lockListeners.push((locked) => {
      if (!locked && this.game && this.game.ready && !this.ui.capturesInput() && this.game.alive && !this.game.sleeping && !this.ui.clickToPlay) this.ui.pause();
    });
    document.getElementById('game-canvas').addEventListener('click', () => {
      if (this.game && this.game.ready && !this.ui.capturesInput() && !this.input.locked) this.input.requestLock();
    });
    document.addEventListener('fullscreenchange', () => this.applyScale());
    // Single-player: persist the world whenever the page is hidden or closed.
    const saveNow = () => { if (this.game && this.game.sp && this.game.conn.save) this.game.conn.save(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    this.ui.title();
    requestAnimationFrame((t) => this.loop(t));
    // Background tabs get no animation frames; keep simulation/networking alive at a low rate.
    setInterval(() => { if (performance.now() - this.lastLoop > 250) this.step(performance.now()); }, 100);
  }

  // ---------- options ----------
  applyAllOptions() {
    for (const k of ['fov', 'guiScale', 'volumes', 'chatScale']) this.applyOption(k, this.options.get(k));
  }

  applyOption(k, v) {
    switch (k) {
      case 'fov': this.renderer.setFov(v); break;
      case 'guiScale': this.applyScale(); break;
      case 'volumes': {
        const n = {};
        for (const [key, val] of Object.entries(v)) n[key] = val / 100;
        this.audio.setVolumes(n);
        break;
      }
      case 'chatScale': document.documentElement.style.setProperty('--chat-scale', String(v / 100)); break;
      case 'renderDistance':
        if (this.game && this.game.cm) { this.game.cm.setRenderDistance(v); this.game.send({ t: 'settings', viewDistance: v }); }
        break;
      case 'smoothLighting':
        if (this.game && this.game.cm) { this.game.cm.smoothLighting = v; this.game.cm.remeshAll(); }
        break;
      default:
    }
  }

  applyScale() {
    const W = window.innerWidth, H = window.innerHeight;
    let auto = Math.max(1, Math.min(4, Math.floor(Math.min(W / 320, H / 240))));
    if (IS_TOUCH && auto < 2 && W >= 600 && H >= 340) auto = 2; // readable on phones in landscape
    const pref = this.options.get('guiScale');
    const s = pref ? Math.min(pref, Math.max(1, Math.floor(Math.min(W / 320, H / 240))) || 1) : auto;
    document.documentElement.style.setProperty('--s', String(s));
    if (this.hud) this.hud.setScale(s);
  }

  setFullscreen(on) {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.options.set('fullscreen', on);
  }

  // ---------- panorama ----------
  showPanorama(on) {
    if (on && !this.panorama && !this.game) {
      const world = new ClientWorld();
      const gen = new WorldGen(PANORAMA_SEED, 'default');
      const spawn = gen.findSpawn();
      const cm = new ChunkManager({
        world, chunkRenderer: this.renderer.chunks, uv: this.renderer.atlas.uv, seed: PANORAMA_SEED, worldType: 'default',
        requestMods: (req) => { for (let i = 0; i < req.length; i += 2) cm.onMods(req[i], req[i + 1], []); },
      });
      cm.setRenderDistance(6);
      cm.setCenter(spawn.x, spawn.z);
      this.panorama = { world, cm, x: spawn.x, y: spawn.y + 10, z: spawn.z, angle: 0 };
      document.getElementById('app').classList.add('blur');
    } else if (!on && this.panorama) {
      this.panorama.cm.dispose();
      this.renderer.chunks.clear();
      this.panorama = null;
      document.getElementById('app').classList.remove('blur');
    }
  }

  renderPanorama(dt) {
    const p = this.panorama;
    p.angle += dt * 0.04;
    p.cm.update();
    const cam = this.renderer.camera;
    cam.position.set(p.x, p.y, p.z);
    cam.rotation.set(-0.12, p.angle, 0);
    const time = 11600;
    this.renderer.sky.update(cam, time, 0, dt, { clouds: this.options.get('clouds') });
    const u = this.renderer.chunks.uniforms;
    u.uDaylight.value = this.renderer.sky.daylight;
    u.uTime.value += dt;
    u.uSkyLight.value.setRGB(1, 0.92, 0.85);
    this.renderer.setFog(60, 100, this.renderer.sky.fogColor);
    this.renderer.particles.update(dt, null);
    this.renderer.render(false);
  }

  // ---------- game lifecycle ----------
  async playWorld(meta) {
    await this.startGame(() => new SPConnection(meta.id, null), { sp: true, worldId: meta.id, name: this.options.get('username') });
  }

  async createAndPlay(cfg) {
    const meta = await createWorldMeta(cfg);
    await this.startGame(() => new SPConnection(meta.id, cfg), { sp: true, worldId: meta.id, name: this.options.get('username') });
  }

  async joinServer(address, label) {
    const name = this.options.get('username');
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) { this.ui.error('Invalid username', 'Set a name (letters, digits, _) on the Multiplayer screen.', 'Back to Server List', () => this.ui.multiplayer()); return; }
    await this.startGame(() => new WSConnection(address), { sp: false, address, label, name });
  }

  async startGame(makeConn, opts) {
    this.audio.ensure();
    let cancelled = false;
    const back = () => (opts.sp ? this.ui.singleplayer() : this.ui.multiplayer());
    const loader = this.ui.loading(opts.sp ? 'Loading world...' : `Connecting to ${opts.label || opts.address}...`, async () => {
      cancelled = true;
      if (this.game) { const g = this.game; this.game = null; await g.stop(); }
      this.showPanorama(true);
      back();
    });
    let conn;
    try { conn = makeConn(); } catch (err) { this.ui.error('Failed to connect to the server', String(err.message || err), opts.sp ? 'Back to Title Screen' : 'Back to Server List', () => (opts.sp ? this.ui.title() : this.ui.multiplayer())); return; }
    this.showPanorama(false);
    const game = new Game(this, conn, opts);
    this.game = game;
    try {
      await game.start();
    } catch (err) {
      if (cancelled) return;
      this.game = null;
      await game.stop();
      this.showPanorama(true);
      this.ui.error(opts.sp ? 'Could not load the world' : 'Failed to connect to the server', String(err && err.message || err), opts.sp ? 'Back to Title Screen' : 'Back to Server List', () => (opts.sp ? this.ui.title() : this.ui.multiplayer()));
      return;
    }
    if (cancelled) return;
    loader.set('Building terrain', 0, '');
    const r = Math.min(this.options.get('renderDistance'), 4);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const check = () => {
        if (cancelled || this.game !== game) { resolve(); return; }
        const pr = game.cm.progress(r);
        loader.set(null, pr.done / pr.total, `${pr.done} / ${pr.total} chunks`);
        if (pr.done >= pr.total || performance.now() - t0 > 20000) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    if (cancelled || this.game !== game) return;
    game.ready = true;
    this.ui.clear();
    if (!game.alive) {
      // death screen was already shown during loading if needed
    }
    this.showClickToPlay();
  }

  showClickToPlay() {
    if (!this.game || this.ui.screen || !this.game.alive || IS_TOUCH) return;
    const s = el('div', 'screen dim');
    s.style.cursor = 'pointer';
    s.append(el('div', 'title', 'Click to play'), el('div', 'label', 'Press Esc to pause'));
    this.ui.clickToPlay = true;
    s.addEventListener('click', () => { this.ui.clickToPlay = false; this.ui.clear(); this.input.requestLock(); });
    this.ui.show(s, null, false);
  }

  async quitToTitle() {
    const g = this.game;
    this.game = null;
    this.ui.closeAll();
    this.input.exitLock();
    const l = this.ui.loading(g && g.sp ? 'Saving world' : 'Disconnecting', null);
    l.set(null, 0.5, '');
    if (g) await g.stop();
    this.showPanorama(true);
    this.ui.title();
  }

  async deleteCurrentWorld() {
    const g = this.game;
    const id = g && g.worldId;
    await this.quitToTitle();
    if (id) await deleteWorld(id);
    this.ui.singleplayer();
  }

  async onDisconnected(reason) {
    const g = this.game;
    if (!g) return;
    this.game = null;
    this.ui.closeAll();
    this.input.exitLock();
    await g.stop();
    this.showPanorama(true);
    this.ui.error('Connection Lost', reason || 'Disconnected', g.sp ? 'Back to Title Screen' : 'Back to Server List', () => (g.sp ? this.ui.title() : this.ui.multiplayer()));
  }

  // ---------- input routing ----------
  onKey(code, down, repeat, e) {
    const g = this.game;
    if (!g || !g.ready) return;
    if (this.ui.chatOpen || this.ui.inventory.isOpen || this.ui.screen) return;
    if (!down) return;
    const I = this.input;
    if (I.is(code, 'inventory') && !repeat) {
      if (!g.alive || g.sleeping) return;
      if (g.gamemode === 'spectator') { this.input.exitLock(); this.ui.spectatorMenu(); return; }
      this.ui.openInventory(g.gamemode === 'creative' ? 'creative' : 'player');
      return;
    }
    if (I.is(code, 'chat') && !repeat) { e.preventDefault(); this.ui.openChat(''); return; }
    if (I.is(code, 'command') && !repeat) { e.preventDefault(); this.ui.openChat('/'); return; }
    if (I.is(code, 'fullscreen') && !repeat) { this.setFullscreen(!document.fullscreenElement); return; }
    if (code === 'Escape' && !this.input.locked) { e.stopPropagation(); this.ui.pause(); return; }
    g.onKey(code, down, repeat);
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    this.step(now);
  }

  step(now) {
    this.lastLoop = performance.now();
    const cap = this.options.get('fpsCap');
    if (cap && now - this.lastFrame < 1000 / cap - 1) return;
    this.lastFrame = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const g = this.game;
    if (g && g.welcomed && !g.disposed) {
      this.accum += dt * 1000;
      let n = 0;
      while (this.accum >= C.TICK_MS && n < 5) {
        if (g.sp && this.ui.isPaused()) this.renderer.atlas.animate();
        else g.tick();
        this.accum -= C.TICK_MS; n++;
      }
      if (n >= 5) this.accum = 0;
      g.frame(dt, this.accum / C.TICK_MS);
      this.hud.draw(g, dt);
    } else {
      if (this.panorama) {
        this.accum += dt * 1000;
        while (this.accum >= C.TICK_MS) { this.renderer.atlas.animate(); this.accum -= C.TICK_MS; }
        this.renderPanorama(dt);
      } else this.renderer.render(false);
      this.hud.draw(null, dt);
    }
    this.ui.inventory.frame(dt);
    if (this.touch) this.touch.update(!!(g && g.ready && !g.disposed && g.alive && !this.ui.capturesInput()));
  }
}
