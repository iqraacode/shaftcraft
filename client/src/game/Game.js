// In-game controller: connection protocol, local player prediction at 20 TPS, interaction
// (mining, placing, attacking, using items), camera modes, effects, and per-frame rendering.
import * as THREE from 'three';
import * as C from '../../../shared/constants.js';
import { ClientWorld } from '../world/ClientWorld.js';
import { ChunkManager } from '../world/ChunkManager.js';
import { stepPlayer, raycast, lookVector, poseSize, fluidState, UNLOADED } from '../../../shared/physics.js';
import { BLOCKS, ID, IS_FLUID, selectionBox, IS_REPLACEABLE } from '../../../shared/blocks.js';
import { ITEMS, pickItemForBlock, HAND_ATTACK_SPEED } from '../../../shared/items.js';
import { newPlayerInventory, unpackInventoryInto, unpackStacks, buildWindow, applyAction, armorPoints, updateCraft } from '../../../shared/inventory.js';
import { breakTicks, toolOf } from '../../../shared/mining.js';
import { FLAG } from '../../../shared/protocol.js';
import { BIOME_NAMES } from '../../../shared/worldgen.js';
import { EntityView, lightCurve } from '../render/EntityRenderer.js';
import { playerSkinTexture } from '../render/models.js';
import { dimensionAt } from '../../../shared/dimensions.js';
const NETHER_FOG = new THREE.Color(0.22, 0.04, 0.03);
const END_FOG = new THREE.Color(0.07, 0.04, 0.1);
import { SMELT_TICKS } from '../../../shared/constants.js';

const SIZES = { player: [0.6, 1.8], pig: [0.9, 0.9], cow: [0.9, 1.4], sheep: [0.9, 1.3], chicken: [0.4, 0.7], zombie: [0.6, 1.95], skeleton: [0.6, 1.99], creeper: [0.6, 1.7], spider: [1.4, 0.9], villager: [0.6, 1.95], enderman: [0.6, 2.9], ender_dragon: [8, 4], end_crystal: [2, 2] };
export const CAMERA_NAMES = ['First Person', 'Third Person (Back)', 'Third Person (Front)'];
const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class Game {
  constructor(app, conn, opts) {
    this.app = app;
    this.conn = conn;
    this.sp = !!opts.sp;
    this.worldId = opts.worldId || null;
    this.address = opts.address || null;
    this.name = opts.name;
    this.world = new ClientWorld();
    this.renderer = app.renderer;
    this.audio = app.audio;
    this.options = app.options;
    this.input = app.input;
    this.ready = false;
    this.welcomed = false;
    this.tickCount = 0;
    this.time = 0; this.weather = 'clear'; this.rainTarget = 0;
    this.inv = newPlayerInventory();
    this.cursor = null;
    this.status = { hp: 20, food: 20, sat: 5, air: C.MAX_AIR_TICKS, armor: 0, fire: 0, score: 0 };
    this.prevHp = 20;
    this.player = {
      x: 0, y: 80, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, pose: 'stand', w: 0.6, h: 1.8, eye: 1.62,
      flying: false, gliding: false, swimming: false, sprinting: false, fallDistance: 0, jumpCooldown: 0, hcTicks: 0, boostTicks: 0, food: 20,
    };
    this.prev = { x: 0, y: 80, z: 0 };
    this.eyeH = C.PLAYER_EYE;
    this.cameraMode = 0;
    this.gamemode = 'survival';
    this.alive = true;
    this.chat = [];
    this.players = [];
    this.ping = 0; this.serverTps = 20;
    this.dig = null;
    this.digCooldown = 0;
    this.useCooldown = 0;
    this.using = null; // { kind, ticks }
    this.lastAttackTick = -100;
    this.attackSpeed = HAND_ATTACK_SPEED;
    this.hurtTilt = 0; this.hurtTime = 0; this.hurtYaw = null;
    this.bobPhase = 0; this.bobAmount = 0; this.stepDist = 0;
    this.lastForwardTick = -100; this.wasForward = false; this.sprintTap = false;
    this.lastJumpTick = -100; this.wasJump = false;
    this.sneakToggled = false; this.sprintToggled = false;
    this.target = null;
    this.selectedChanged = 0;
    this.heldNameTimer = 0;
    this.sleeping = false;
    this.window = null;
    this.debug = false;
    this.followId = null;
    this.tid = 0;
    this.roll = 0;
    this.fps = 0; this.frames = 0; this.fpsTime = 0;
    this.lastSentMove = '';
    this.wasInWater = false;
    this.listeners = [];
    this.disposed = false;
    this.selfView = null;
    this.op = false;
    this.hardcore = false;
    this.difficulty = 'normal';
  }

  // ---------- connection ----------
  async start() {
    this.conn.onmessage = (m) => this.handle(m);
    this.conn.onclose = (reason) => { if (!this.disposed) this.app.onDisconnected(this.kickReason || reason || 'Connection lost'); };
    await this.conn.ready;
    this.send({ t: 'hello', name: this.name, protocol: C.PROTOCOL_VERSION, viewDistance: this.options.get('renderDistance'), skin: this.options.get('skin'), fullName: this.options.get('fullName') });
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    return new Promise((resolve, reject) => {
      this.welcomeResolve = resolve;
      this.welcomeReject = reject;
    });
  }

  send(m) { if (!this.disposed) this.conn.send(m); }

  async stop() {
    this.disposed = true;
    clearInterval(this.pingTimer);
    if (this.cm) this.cm.dispose();
    this.renderer.entities.clear();
    this.renderer.particles.clear();
    this.renderer.chunks.clear();
    if (this.selfView) { this.renderer.scene.remove(this.selfView.group); this.selfView = null; }
    this.renderer.setSelection(null);
    this.renderer.setCrack(0, 0, 0, -1);
    this.audio.setRain(0); this.audio.setWind(0); this.audio.setUnderwater(false);
    try { await this.conn.close(); } catch { /* ignore */ }
  }

  handle(m) {
    if (this.disposed) return;
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 'kick':
        this.kickReason = m.reason;
        if (!this.welcomed && this.welcomeReject) this.welcomeReject(new Error(m.reason));
        return;
      case 'chunk': if (this.cm) this.cm.onMods(m.cx, m.cz, m.m); return;
      case 'blocks': {
        const b = m.b;
        for (let i = 0; i < b.length; i += 5) {
          const [x, y, z, id, meta] = [b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4]];
          if (this.cm) this.cm.onBlockUpdate(x, y, z, id, meta);
          if (this.dig && this.dig.x === x && this.dig.y === y && this.dig.z === z && id !== this.dig.id) this.dig = null;
        }
        return;
      }
      case 'spawn': {
        if (m.e.id === this.eid) return;
        this.renderer.entities.spawn(m.e);
        return;
      }
      case 'ents': {
        const now = performance.now();
        for (const s of m.d) this.renderer.entities.state(s, now);
        return;
      }
      case 'despawn': for (const id of m.ids) this.renderer.entities.despawn(id); if (this.followId && m.ids.includes(this.followId)) this.followId = null; return;
      case 'ev': return this.onEntityEvent(m);
      case 'self': {
        const prevHp = this.status.hp;
        Object.assign(this.status, m);
        this.player.food = this.status.food;
        if (m.hp > prevHp) this.app.hud.onHeal();
        return;
      }
      case 'hurt':
        this.hurtTime = 10; this.hurtTilt = 1;
        this.hurtYaw = m.yaw;
        this.app.hud.onDamage();
        return;
      case 'kb': this.player.vx += m.vx; this.player.vy = Math.max(this.player.vy, m.vy); this.player.vz += m.vz; return;
      case 'inv': {
        const sel = this.inv.selected;
        unpackInventoryInto(this.inv, m.inv);
        this.inv.selected = sel; // the client owns hotbar selection
        this.cursor = m.cursor ? unpackStacks([m.cursor])[0] : null;
        if (m.grid && this.window && this.window.container && this.window.container.grid) {
          const g = unpackStacks(m.grid); for (let i = 0; i < 9; i++) this.window.container.grid[i] = g[i] || null;
        }
        this.recomputeCraft();
        this.app.ui.refreshInventory();
        return;
      }
      case 'open': return this.onOpenWindow(m);
      case 'trades': this.app.ui.trades(m); return;
      case 'cont': {
        if (!this.window || this.window.wid !== m.wid || !this.window.container) return;
        const items = unpackStacks(m.items);
        for (let i = 0; i < this.window.container.items.length; i++) this.window.container.items[i] = items[i] || null;
        Object.assign(this.window.container, { burn: m.burn, burnMax: m.burnMax, cook: m.cook, cookMax: m.cookMax });
        this.app.ui.refreshInventory();
        return;
      }
      case 'close': if (this.window && this.window.wid === m.wid) { this.window = null; this.localWin = null; this.app.ui.closeInventory(false); } return;
      case 'time': this.time = m.time; this.setWeather(m.weather); return;
      case 'chat': this.addChat(m.text, m.color); return;
      case 'death': return this.onDeath(m);
      case 'respawned':
        this.alive = true;
        this.tid = m.tid;
        this.setPos(m.x, m.y, m.z);
        this.app.ui.closeDeath();
        return;
      case 'pos': this.tid = m.tid; this.setPos(m.x, m.y, m.z); return;
      case 'mode': this.setMode(m.gamemode, m.flying); return;
      case 'sound': this.audio.play(m.s, { x: m.x, y: m.y, z: m.z, volume: m.v, pitch: m.p }); return;
      case 'fx': return this.onFx(m);
      case 'players': this.players = m.list; this.maxPlayers = m.max; this.app.ui.refreshSpectatorMenu(); return;
      case 'pong': this.ping = performance.now() - m.c; this.serverTps = m.tps; return;
      case 'equip': this.renderer.entities.spawn({ id: m.id, type: 'player', held: m.held, off: m.off, armor: m.armor }); return;
      case 'boost': if (this.player.gliding) this.player.boostTicks = C.FIREWORK_BOOST_TICKS; return;
      case 'glide': if (!m.on) this.player.gliding = false; return;
      case 'sleep':
        this.sleeping = m.on;
        if (m.on) { this.setPos(m.x, m.y, m.z); this.player.yaw = m.yaw; this.app.ui.showSleep(); } else this.app.ui.hideSleep();
        return;
      case 'difficulty': this.difficulty = m.d; return;
      case 'op': this.op = m.op; return;
      case 'useDone': this.using = null; return;
      default:
    }
  }

  onWelcome(m) {
    this.welcomed = true;
    this.eid = m.eid;
    this.renderer.entities.selfId = m.eid;
    this.seed = m.seed;
    this.worldType = m.worldType;
    this.worldName = m.worldName;
    this.time = m.time;
    this.setWeather(m.weather);
    this.difficulty = m.difficulty;
    this.hardcore = m.hardcore;
    this.op = m.op;
    this.allowCommands = m.allowCommands;
    this.maxPlayers = m.maxPlayers;
    this.tid = m.tid;
    unpackInventoryInto(this.inv, m.inv);
    Object.assign(this.status, m.status);
    this.setMode(m.gamemode, m.player.flying);
    this.setPos(m.player.x, m.player.y, m.player.z);
    this.player.yaw = m.player.yaw; this.player.pitch = m.player.pitch;
    this.alive = m.player.alive !== false;
    this.cm = new ChunkManager({
      world: this.world, chunkRenderer: this.renderer.chunks, uv: this.renderer.atlas.uv, seed: m.seed, worldType: m.worldType,
      requestMods: (req) => this.send({ t: 'chunks', req }),
    });
    this.cm.smoothLighting = this.options.get('smoothLighting');
    this.cm.setRenderDistance(this.options.get('renderDistance'));
    this.cm.setCenter(this.player.x, this.player.z);
    this.renderer.held.setSkin(this.name, this.options.get('skin'));
    this.selfView = new EntityView({ id: -1, type: 'player', name: this.name, skin: this.options.get('skin'), self: true, x: this.player.x, y: this.player.y, z: this.player.z, yaw: 0, pitch: 0, armor: [null, null, null, null] }, { atlas: this.renderer.atlas, chunkMaterials: this.renderer.chunks.materials });
    this.renderer.scene.add(this.selfView.group);
    this.selfView.group.visible = false;
    if (this.welcomeResolve) this.welcomeResolve();
  }

  setWeather(w) {
    if (w !== this.weather && w !== 'clear' && this.ready) this.addChat(w === 'thunder' ? 'A thunderstorm rolls in' : 'It starts to rain', 'gray');
    this.weather = w;
    this.rainTarget = w === 'clear' ? 0 : 1;
  }

  setMode(mode, flying) {
    this.gamemode = mode;
    if (mode === 'spectator') this.player.flying = true;
    else if (mode === 'creative') this.player.flying = !!flying;
    else this.player.flying = false;
    if (mode !== 'spectator') this.followId = null;
    this.app.ui.onModeChanged();
  }

  setPos(x, y, z) {
    const p = this.player;
    p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
    this.prev.x = x; this.prev.y = y; this.prev.z = z;
    if (this.cm) this.cm.setCenter(x, z);
  }

  onEntityEvent(m) {
    this.renderer.entities.event(m, { self: { x: this.player.x, y: this.player.y, z: this.player.z } });
    const v = this.renderer.entities.views.get(m.id);
    if (m.k === 'eat' && v) { this.audio.play('eat', { x: v.x, y: v.y + 1.5, z: v.z, volume: 0.5 }); this.renderer.particles.crumbs(v.x, v.y + 1.5, v.z, [0.7, 0.5, 0.3]); }
    if (m.k === 'dig' && v) v.digging = { x: m.x, y: m.y, z: m.z, dur: m.dur, start: performance.now() };
    if (m.k === 'digstop' && v) v.digging = null;
    if (m.k === 'boost' && v) this.renderer.particles.trail(v.x, v.y, v.z);
  }

  onFx(m) {
    const P = this.renderer.particles;
    const day = this.renderer.sky.daylight;
    switch (m.k) {
      case 'break': {
        const b = BLOCKS[m.id];
        P.blockBreak(this.world, m.x, m.y, m.z, m.id, m.meta, day);
        if (b) this.audio.play('break:' + b.sound, { x: m.x + 0.5, y: m.y + 0.5, z: m.z + 0.5 });
        break;
      }
      case 'explode': P.explosion(m.x, m.y, m.z, m.r); this.cameraShake = 1; break;
      case 'firework': P.firework(m.x, m.y, m.z, m.c); break;
      case 'lightning': this.renderer.sky.lightning(); setTimeout(() => this.audio.play('thunder', { volume: 0.9 }), 400 + Math.random() * 1500); break;
      case 'bonemeal': P.sparkle(m.x, m.y, m.z); break;
      case 'crit': P.crit(m.x, m.y, m.z); break;
      case 'poof': P.puff(m.x, m.y, m.z, 14, [0.9, 0.9, 0.9], 0.2, 1.2, 0.8, -1); break;
      case 'eggbreak': P.puff(m.x, m.y, m.z, 8, [0.95, 0.9, 0.8], 0.08, 2, 0.4, 12); break;
      case 'fizz': P.puff(m.x, m.y, m.z, 8, [0.6, 0.6, 0.6], 0.15, 0.5, 1, -2); this.audio.play('fizz', { x: m.x, y: m.y, z: m.z }); break;
      default:
    }
  }

  onDeath(m) {
    this.alive = false;
    this.using = null; this.dig = null;
    this.player.gliding = false;
    this.app.ui.closeInventory(true);
    this.app.ui.showDeath({ cause: m.cause, score: m.score, hardcore: m.hardcore, sp: this.sp });
  }

  addChat(text, color = 'white') {
    this.chat.push({ text, color, time: performance.now() });
    if (this.chat.length > 100) this.chat.shift();
  }

  // ---------- windows ----------
  onOpenWindow(m) {
    let container = null;
    if (m.type === 'crafting') container = { grid: new Array(9).fill(null), result: [null] };
    else if (m.type === 'chest' || m.type === 'furnace') container = { items: unpackStacks(m.items).map((s) => s || null), burn: m.burn || 0, burnMax: m.burnMax || 0, cook: m.cook || 0, cookMax: m.cookMax || SMELT_TICKS, type: m.type };
    if (container && container.items) {
      const n = m.type === 'chest' ? 27 : 3;
      while (container.items.length < n) container.items.push(null);
    }
    this.window = { wid: m.wid, type: m.type, title: m.title, container };
    this.localWin = buildWindow(m.type, this.inv, container);
    this.localWin.wid = m.wid;
    this.app.ui.openInventory(m.type);
  }

  playerWindow() {
    if (!this.playerWin || this.playerWin.inv !== this.inv) { this.playerWin = buildWindow('player', this.inv, null); this.playerWin.wid = 0; }
    return this.playerWin;
  }

  activeWindow() { return this.localWin || this.playerWindow(); }

  recomputeCraft() {
    updateCraft(this.playerWindow());
    if (this.localWin && this.localWin.craftGrid) updateCraft(this.localWin);
  }

  windowAction(act) {
    const win = this.activeWindow();
    const state = { cursor: this.cursor, creative: this.gamemode === 'creative' };
    applyAction(win, state, act); // prediction
    this.cursor = state.cursor;
    this.send({ t: 'win', wid: win.wid, ...act });
    this.app.ui.refreshInventory();
  }

  closeWindow() {
    const wid = this.window ? this.window.wid : 0;
    this.send({ t: 'closeWin', wid });
    this.window = null; this.localWin = null;
  }

  creative(msg) { this.send({ t: 'creative', ...msg }); }

  // ---------- actions from UI ----------
  respawn() { this.send({ t: 'respawn' }); }
  hardcoreSpectate() { this.send({ t: 'hardcoreSpectate' }); this.alive = true; }
  leaveBed() { this.send({ t: 'leaveBed' }); }
  spectateTp(name) { this.send({ t: 'spectate', name }); }
  trade(eid, i) { this.send({ t: 'trade', eid, i }); }
  sendChat(text) { this.send({ t: 'chat', text }); }
  setPaused(on) { if (this.sp) this.send({ t: 'pause', on }); }
  selectSlot(i) {
    if (i === this.inv.selected) return;
    this.inv.selected = i;
    this.send({ t: 'slot', i });
    this.heldNameTimer = 2;
    this.using = null;
    if (this.dig) { this.send({ t: 'dig', p: 'abort', x: this.dig.x, y: this.dig.y, z: this.dig.z }); this.dig = null; }
  }

  held() { return this.inv.main[this.inv.selected] || null; }

  // Dressing room changed the skin while playing
  setSkin(skin) {
    this.renderer.held.setSkin(this.name, skin);
    if (this.selfView) { this.selfView.rig.materials[0].map = playerSkinTexture(this.name, skin); this.selfView.rig.materials[0].needsUpdate = true; }
    this.send({ t: 'skin', skin });
  }

  // 0 first person, 1 third person (back), 2 third person (front)
  setCameraMode(mode) {
    this.cameraMode = ((mode % 3) + 3) % 3;
    this.cameraToast = 1.5;
  }

  cameraModeName() { return CAMERA_NAMES[this.cameraMode]; }

  // ---------- tick ----------
  tick() {
    this.tickCount++;
    this.renderer.atlas.animate();
    if (!this.ready || this.disposed) return;
    if (!(this.sp && this.app.ui.isPaused())) this.time++;
    const p = this.player;
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
    const ui = this.app.ui.capturesInput();
    const spectator = this.gamemode === 'spectator';
    const creative = this.gamemode === 'creative';
    const inp = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    const live = !ui && this.alive && !this.sleeping;
    if (live) {
      const I = this.input;
      inp.forward = (I.isDown('forward') ? 1 : 0) - (I.isDown('back') ? 1 : 0);
      inp.strafe = (I.isDown('right') ? 1 : 0) - (I.isDown('left') ? 1 : 0);
      inp.jump = I.isDown('jump');
      inp.sneak = this.options.get('toggleSneak') ? this.sneakToggled : I.isDown('sneak');
      const fwd = inp.forward > 0;
      if (fwd && !this.wasForward) { if (this.tickCount - this.lastForwardTick < C.DOUBLE_TAP_TICKS) this.sprintTap = true; this.lastForwardTick = this.tickCount; }
      if (!fwd) this.sprintTap = false;
      this.wasForward = fwd;
      inp.sprint = this.sprintTap || (this.options.get('toggleSprint') ? this.sprintToggled : I.isDown('sprint'));
      // double-tap space for creative flight
      if (inp.jump && !this.wasJump) {
        if (creative && this.tickCount - this.lastJumpTick < C.DOUBLE_TAP_TICKS) { p.flying = !p.flying; p.vy = 0; this.lastJumpTick = -100; }
        else this.lastJumpTick = this.tickCount;
        // glider deploy / stow
        if (!spectator && !p.flying) {
          if (p.gliding) { p.gliding = false; this.send({ t: 'glide', on: false }); }
          else if (!p.onGround && !p.inWater && p.vy < 0 && this.canGlide()) { p.gliding = true; p.pose = 'glide'; this.send({ t: 'glide', on: true }); this.audio.play('glider_open', { volume: 0.5 }); }
        }
      }
      this.wasJump = inp.jump;
    } else this.wasJump = false;

    if (this.followId && spectator) {
      const v = this.renderer.entities.views.get(this.followId);
      if (v) { p.x = v.x; p.y = v.y; p.z = v.z; p.vx = p.vy = p.vz = 0; }
      if (inp.sneak) this.followId = null;
    } else if (this.alive && !this.sleeping) {
      p.usingItem = !!this.using;
      const wasGround = p.onGround;
      const ev = stepPlayer(this.world, p, inp, { creative, spectator });
      if (ev.crash > 0) this.send({ t: 'crash', dmg: ev.crash });
      if (ev.jumped) this.jumpFlag = true;
      if (ev.landed && ev.fall > 1.5 && !p.inWater) this.playStep(true);
      if (!wasGround && p.onGround && p.gliding) p.gliding = false;
      // water entry splash
      if (p.inWater && !this.wasInWater && p.vy < -4) { this.audio.play('splash', { x: p.x, y: p.y, z: p.z }); this.renderer.particles.splash(p.x, p.y + 0.5, p.z); }
      this.wasInWater = p.inWater;
      if (p.headInWater && Math.random() < 0.15) this.renderer.particles.bubble(p.x + (Math.random() - 0.5) * 0.4, p.y + p.eye, p.z + (Math.random() - 0.5) * 0.4);
      // footsteps
      const hd = Math.hypot(p.x - this.prev.x, p.z - this.prev.z);
      if (p.onGround && !p.flying) { this.stepDist += hd; if (this.stepDist > (p.sprinting ? 2.0 : 1.7)) { this.stepDist = 0; if (p.pose !== 'sneak') this.playStep(false); } }
      else if (p.inWater && hd > 0.02) { this.stepDist += hd; if (this.stepDist > 2) { this.stepDist = 0; this.audio.play('swim', { volume: 0.4 }); } }
      if (p.gliding && p.boostTicks > 0) this.renderer.particles.trail(p.x, p.y, p.z);
    }

    // send movement
    let f = 0;
    if (p.pose === 'sneak') f |= FLAG.SNEAK;
    if (p.sprinting) f |= FLAG.SPRINT;
    if (p.gliding) f |= FLAG.GLIDE;
    if (p.flying) f |= FLAG.FLY;
    if (p.pose === 'swim') f |= FLAG.SWIM;
    if (p.onGround) f |= FLAG.GROUND;
    if (this.jumpFlag) { f |= FLAG.JUMP; this.jumpFlag = false; }
    const mv = { t: 'move', x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), yaw: +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4), vx: +p.vx.toFixed(3), vy: +p.vy.toFixed(3), vz: +p.vz.toFixed(3), f, tid: this.tid };
    const key = `${mv.x},${mv.y},${mv.z},${mv.yaw},${mv.pitch},${f}`;
    if (key !== this.lastSentMove || this.tickCount % 20 === 0) { this.send(mv); this.lastSentMove = key; }

    if (this.hurtTime > 0) this.hurtTime--;
    if (this.heldNameTimer > 0) this.heldNameTimer = Math.max(0, this.heldNameTimer - C.DT);
    if (this.cameraToast > 0) this.cameraToast = Math.max(0, this.cameraToast - C.DT);
    this.interactTick(live);
    if (this.using) this.using.ticks++;
  }

  canGlide() {
    const chest = this.inv.armor[1];
    return !!chest && chest.id === 'glider_wings' && (chest.dmg || 0) < C.GLIDER_DURABILITY - 1;
  }

  playStep(land) {
    const p = this.player;
    const id = this.world.getBlockRaw(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    let b = BLOCKS[id];
    if (!b || id === 0) { const above = this.world.getBlockRaw(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)); b = BLOCKS[above]; }
    if (!b || !b.sound || b.id === 0) return;
    const snd = b.sound === 'water' ? 'swim' : (land ? 'fall_small' : 'step:' + b.sound);
    this.audio.play(snd, { volume: land ? 0.6 : 0.5 });
  }

  // ---------- interaction ----------
  interactTick(live) {
    const p = this.player;
    const I = this.input;
    const R = this.renderer;
    if (this.digCooldown > 0) this.digCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    const spectator = this.gamemode === 'spectator';
    const creative = this.gamemode === 'creative';
    const lmb = live && I.buttons.has(0);
    const rmb = live && I.buttons.has(2);
    const t = this.target;
    // ---- mining ----
    if (lmb && !spectator && t && t.type === 'block' && this.digCooldown === 0) {
      const id = this.world.getBlockRaw(t.x, t.y, t.z);
      if (creative) {
        if (!this.dig || this.dig.x !== t.x || this.dig.y !== t.y || this.dig.z !== t.z) {
          const held = this.held();
          if (!(held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword')) {
            this.send({ t: 'dig', p: 'finish', x: t.x, y: t.y, z: t.z, face: t.face });
            this.predictBreak(t.x, t.y, t.z, id);
            this.digCooldown = 5;
          }
          this.swing();
        }
      } else {
        if (!this.dig || this.dig.x !== t.x || this.dig.y !== t.y || this.dig.z !== t.z) {
          if (this.dig) this.send({ t: 'dig', p: 'abort', x: this.dig.x, y: this.dig.y, z: this.dig.z });
          this.dig = { x: t.x, y: t.y, z: t.z, id, progress: 0, face: t.face };
          this.send({ t: 'dig', p: 'start', x: t.x, y: t.y, z: t.z, face: t.face });
        }
        const d = this.dig;
        const ticks = breakTicks(id, this.held(), { headInWater: p.headInWater, airborne: !p.onGround && !p.inWater && !p.onLadder && !p.flying });
        if (!Number.isFinite(ticks)) { d.progress = 0; }
        else {
          d.progress += ticks === 0 ? 1 : 1 / ticks;
          if (this.tickCount % 4 === 0) {
            const b = BLOCKS[id];
            if (b) this.audio.play('hit:' + b.sound, { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5, volume: 0.5 });
            R.particles.blockHit(this.world, t.x, t.y, t.z, t.face, id, this.world.getMeta(t.x, t.y, t.z), R.sky.daylight);
          }
          if (this.tickCount % 4 === 0) this.swing(false);
          if (d.progress >= 1) {
            this.send({ t: 'dig', p: 'finish', x: d.x, y: d.y, z: d.z, face: d.face });
            this.predictBreak(d.x, d.y, d.z, id);
            this.dig = null;
            this.digCooldown = 5;
          }
        }
      }
    } else if (this.dig && (!lmb || !t || t.type !== 'block')) {
      if (!creative) this.send({ t: 'dig', p: 'abort', x: this.dig.x, y: this.dig.y, z: this.dig.z });
      this.dig = null;
    }
    // ---- using (eating / bow) ----
    if (this.using && !rmb) {
      this.send({ t: 'stopUse' });
      this.using = null;
    }
    if (this.using && this.using.kind === 'eat' && this.using.ticks % 4 === 0 && this.using.ticks > 0) {
      this.audio.play('eat', { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 });
      const look = lookVector(p.yaw, p.pitch);
      R.particles.crumbs(p.x + look[0] * 0.5, p.y + p.eye - 0.2 + look[1] * 0.5, p.z + look[2] * 0.5, [0.75, 0.55, 0.35]);
    }
    if (this.using && this.using.kind === 'eat' && this.using.ticks > C.EAT_TICKS + 10) this.using = null;
    if (rmb && !spectator && this.useCooldown === 0 && !this.using) this.useAction();
  }

  // Right click: entity interaction, block use/placement, or item use.
  useAction(pressed = false) {
    const p = this.player;
    const t = this.target;
    const held = this.held();
    const it = held ? ITEMS[held.id] : null;
    this.useCooldown = 4;
    if (t && t.type === 'entity') {
      this.send({ t: 'interact', eid: t.id });
      this.swing();
      return;
    }
    // buckets target fluids
    if (it && it.use === 'bucket') {
      const look = lookVector(p.yaw, p.pitch);
      const reach = this.gamemode === 'creative' ? C.REACH_CREATIVE : C.REACH_SURVIVAL;
      const hit = raycast(this.world, p.x, p.y + p.eye, p.z, look[0], look[1], look[2], reach, held.id === 'bucket');
      if (hit) { this.send({ t: 'useItem', target: { x: hit.x, y: hit.y, z: hit.z, face: hit.face } }); this.swing(); }
      return;
    }
    if (t && t.type === 'block') {
      const b = BLOCKS[this.world.getBlockRaw(t.x, t.y, t.z)];
      this.send({ t: 'use', x: t.x, y: t.y, z: t.z, face: t.face, hx: t.px - t.x, hy: t.py - t.y, hz: t.pz - t.z });
      if (b && b.interact && !(p.pose === 'sneak' && held)) { this.swing(); this.useCooldown = 6; return; }
      if (it && it.block) { this.predictPlace(t, it); this.swing(); return; }
      if (it && (it.use === 'till' || it.use === 'bonemeal' || it.use === 'firework')) { this.swing(); return; }
    }
    if (it && (it.food || it.use === 'bow')) {
      if (it.food && this.status.food >= C.MAX_FOOD && !it.food.drink && this.gamemode !== 'creative') return;
      if (it.use === 'bow' && this.gamemode !== 'creative' && !this.inv.main.some((s) => s && s.id === 'arrow') && !(this.inv.offhand[0] && this.inv.offhand[0].id === 'arrow')) return;
      if (!t || t.type !== 'block') this.send({ t: 'useItem' });
      this.using = { kind: it.food ? 'eat' : 'bow', ticks: 0 };
      return;
    }
    if (it && (it.use === 'throw' || it.use === 'firework' || it.armor)) {
      if (!t || t.type !== 'block') this.send({ t: 'useItem' });
      if (it.use === 'firework' && p.gliding) p.boostTicks = C.FIREWORK_BOOST_TICKS;
      this.swing();
      this.useCooldown = 4;
      return;
    }
    // off-hand usable items
    const off = this.inv.offhand[0];
    const oit = off ? ITEMS[off.id] : null;
    if (oit && (oit.food || oit.use === 'bow')) { this.send({ t: 'useItem' }); this.using = { kind: oit.food ? 'eat' : 'bow', ticks: 0 }; }
    void pressed;
  }

  predictBreak(x, y, z, id) {
    const b = BLOCKS[id];
    this.renderer.particles.blockBreak(this.world, x, y, z, id, this.world.getMeta(x, y, z), this.renderer.sky.daylight);
    if (b) this.audio.play('break:' + b.sound, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    if (b && (b.shape === 'door' || b.shape === 'bed')) return; // multi-block: wait for server
    this.world.setBlock(x, y, z, 0, 0);
  }

  predictPlace(t, it) {
    const b = BLOCKS[ID[it.block]];
    if (!b || b.shape !== 'cube' || b.facing || b.falls || b.leaves) return;
    const targetId = this.world.getBlockRaw(t.x, t.y, t.z);
    let px = t.x, py = t.y, pz = t.z;
    if (!IS_REPLACEABLE[targetId]) { const n = FACE_N[t.face]; px += n[0]; py += n[1]; pz += n[2]; }
    const cur = this.world.getBlock(px, py, pz);
    if (cur === UNLOADED || (cur !== 0 && !IS_REPLACEABLE[cur])) return;
    const p = this.player;
    const hw = p.w / 2;
    if (p.x + hw > px && p.x - hw < px + 1 && p.y + p.h > py && p.y < py + 1 && p.z + hw > pz && p.z - hw < pz + 1) return;
    for (const v of this.renderer.entities.views.values()) {
      const s = SIZES[v.type];
      if (!s || v.death >= 0) continue;
      const vw = s[0] / 2;
      if (v.x + vw > px && v.x - vw < px + 1 && v.y + s[1] > py && v.y < py + 1 && v.z + vw > pz && v.z - vw < pz + 1) return;
    }
    this.world.setBlock(px, py, pz, b.id, 0);
    this.audio.play('place:' + b.sound, { x: px + 0.5, y: py + 0.5, z: pz + 0.5 });
  }

  swing(send = true) {
    this.renderer.held.startSwing();
    if (this.selfView) this.selfView.swing = 6;
    if (send) this.send({ t: 'swing' });
  }

  // Mouse button pressed (edge-triggered actions).
  onMouse(button, down) {
    if (!this.ready || !this.alive || this.sleeping) return;
    const p = this.player;
    const t = this.target;
    if (down && button === 0) {
      if (this.gamemode === 'spectator') {
        if (t && t.type === 'entity' && t.view.type === 'player') this.followId = t.id;
        return;
      }
      if (t && t.type === 'entity') {
        this.send({ t: 'attack', eid: t.id });
        this.lastAttackTick = this.tickCount;
        this.swing(false);
        this.send({ t: 'swing' });
      } else if (!t) { this.swing(); this.lastAttackTick = this.tickCount; }
    }
    if (down && button === 2 && this.gamemode !== 'spectator') { this.useCooldown = 0; this.useAction(true); }
    if (!down && button === 2 && this.using) { this.send({ t: 'stopUse' }); this.using = null; }
    if (down && button === 1 && this.gamemode === 'creative' && t && t.type === 'block') {
      const item = pickItemForBlock(this.world.getBlockRaw(t.x, t.y, t.z));
      if (item) this.send({ t: 'pick', item });
    }
    void p;
  }

  onKey(code, down, repeat) {
    if (!this.ready) return;
    const I = this.input;
    if (!down) return;
    if (I.is(code, 'debug')) { this.debug = !this.debug; return; }
    if ((I.is(code, 'camera') || code === 'F5') && !repeat) { this.setCameraMode((this.cameraMode + 1) % 3); return; }
    if (!this.alive || this.sleeping) return;
    for (let i = 1; i <= 9; i++) if (I.is(code, 'hotbar' + i)) { if (this.gamemode !== 'spectator') this.selectSlot(i - 1); return; }
    if (I.is(code, 'drop') && !repeat && this.gamemode !== 'spectator') { const all = I.keys.has('ControlLeft') || I.keys.has('ControlRight'); this.send({ t: 'drop', all }); this.swing(false); return; }
    if (I.is(code, 'swapHands') && !repeat && this.gamemode !== 'spectator') { this.send({ t: 'swapHands' }); return; }
    if (I.is(code, 'sneak') && this.options.get('toggleSneak') && !repeat) this.sneakToggled = !this.sneakToggled;
    if (I.is(code, 'sprint') && this.options.get('toggleSprint') && !repeat) this.sprintToggled = !this.sprintToggled;
  }

  // ---------- frame ----------
  frame(dt, alpha) {
    if (!this.welcomed || this.disposed) return;
    const p = this.player;
    const R = this.renderer;
    const ui = this.app.ui.capturesInput();
    // mouse look
    const [mx, my] = this.input.consumeMouse();
    if (!ui && this.alive && !this.sleeping) {
      const sens = (this.options.get('sensitivity') / 100) * 0.0024;
      p.yaw -= mx * sens;
      p.pitch -= my * sens * (this.options.get('invertMouse') ? -1 : 1);
      p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch));
      const w = this.input.consumeWheel();
      if (w && this.gamemode !== 'spectator') this.selectSlot(((this.inv.selected + w) % 9 + 9) % 9);
    } else this.input.consumeWheel();

    // interpolated position
    const ix = this.prev.x + (p.x - this.prev.x) * alpha;
    const iy = this.prev.y + (p.y - this.prev.y) * alpha;
    const iz = this.prev.z + (p.z - this.prev.z) * alpha;
    const [, , targetEye] = poseSize(p.pose);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 14);
    // view bobbing
    const hs = Math.hypot(p.vx, p.vz);
    const bobTarget = p.onGround && !p.flying && this.options.get('viewBobbing') ? Math.min(1, hs / 5) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += hs * dt * 1.6;
    const cam = R.camera;
    let ex = ix, ey = iy + this.eyeH, ez = iz;
    if (this.sleeping) ey = iy + 0.2;
    if (this.cameraMode === 0 && this.bobAmount > 0.01) {
      ey += -Math.abs(Math.cos(this.bobPhase)) * 0.06 * this.bobAmount + 0.03 * this.bobAmount;
      const side = Math.sin(this.bobPhase) * 0.04 * this.bobAmount;
      ex += Math.cos(p.yaw) * side; ez -= Math.sin(p.yaw) * side;
    }
    // camera roll: damage tilt, gliding turn roll
    if (this.hurtTilt > 0) this.hurtTilt = Math.max(0, this.hurtTilt - dt * 2.5);
    let roll = 0;
    if (this.hurtTilt > 0) roll += Math.sin(this.hurtTilt * Math.PI) * 0.14 * (this.hurtYaw !== null ? Math.sign(Math.sin((this.hurtYaw || 0) + p.yaw)) || 1 : 1);
    const yawRate = this.lastYaw !== undefined ? (p.yaw - this.lastYaw) / Math.max(dt, 1e-3) : 0;
    this.lastYaw = p.yaw;
    const glideRoll = p.gliding ? Math.max(-0.5, Math.min(0.5, -yawRate * 0.12)) : 0;
    this.roll += (glideRoll - this.roll) * Math.min(1, dt * 4);
    roll += this.roll;
    if (this.cameraShake > 0) { this.cameraShake = Math.max(0, this.cameraShake - dt * 2); roll += (Math.random() - 0.5) * this.cameraShake * 0.05; }
    cam.rotation.set(p.pitch, p.yaw, roll);
    const look = lookVector(p.yaw, p.pitch);
    if (this.cameraMode === 0 || this.sleeping) cam.position.set(ex, ey, ez);
    else {
      const dirSign = this.cameraMode === 1 ? -1 : 1;
      const dx = look[0] * dirSign, dy = look[1] * dirSign, dz = look[2] * dirSign;
      const hit = raycast(this.world, ex, ey, ez, dx, dy, dz, 4);
      const dist = hit ? Math.max(0.3, hit.dist - 0.25) : 4;
      cam.position.set(ex + dx * dist, ey + dy * dist, ez + dz * dist);
      if (this.cameraMode === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, -roll);
    }
    // FOV: sprint +10%, gliding speed, bow zoom
    let fovMult = 1;
    if (p.sprinting && !p.flying) fovMult *= C.SPRINT_FOV_MULT;
    if (p.flying && p.sprinting) fovMult *= 1.08;
    if (p.gliding) fovMult *= 1 + Math.min(0.25, Math.hypot(p.vx, p.vy, p.vz) / 160);
    if (this.using && this.using.kind === 'bow') fovMult *= 1 - Math.min(1, this.using.ticks / 20) * 0.15;
    R.fovMult = fovMult;
    R.applyFov(dt);

    // targeting
    this.updateTarget(ex, iy + this.eyeH, ez, look);
    // chunk streaming
    this.cm.setCenter(p.x, p.z);
    this.cm.update();
    // world lighting / sky
    const rain = R.weather.level;
    const dim = dimensionAt(p.x, p.z);
    const nether = dim !== 'overworld', isEnd = dim === 'end'; // nether = any dimension without the overworld sky
    this.dimension = dim;
    R.sky.update(cam, this.time + alpha, nether ? 0 : rain, dt, { clouds: nether ? 'off' : this.options.get('clouds') });
    R.sky.group.visible = !nether;
    if (isEnd) R.chunks.uniforms.uAmbient.value.setRGB(0.22, 0.2, 0.3);
    else R.chunks.uniforms.uAmbient.value.setRGB(nether ? 0.3 : 0.04, nether ? 0.16 : 0.04, nether ? 0.12 : 0.04);
    const day = isEnd ? 0.55 : R.sky.daylight;
    const u = R.chunks.uniforms;
    u.uDaylight.value = day * (1 - rain * 0.2);
    u.uTime.value += dt;
    const nightK = 1 - Math.min(1, (day - C.NIGHT_MIN_SKY) / (1 - C.NIGHT_MIN_SKY));
    u.uSkyLight.value.setRGB(1 - nightK * 0.15, 1 - nightK * 0.1, 1);
    // fog
    const rd = this.options.get('renderDistance') * 16;
    const headId = this.world.getBlockRaw(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    const underwater = IS_FLUID[headId] === 1 && this.cameraMode === 0 && this.headInFluid(cam.position, headId);
    const inLava = IS_FLUID[headId] === 2 && this.cameraMode === 0;
    R.chunks.uniforms.uFogVert.value = underwater || inLava ? 1 : 0.2;
    if (underwater) R.setFog(0, 14, new THREE.Color(0.06, 0.18, 0.42).multiplyScalar(Math.max(0.25, day)));
    else if (inLava) R.setFog(0, 1.5, new THREE.Color(0.6, 0.15, 0.02));
    else if (isEnd) R.setFog(24, Math.min(rd * 0.85, 160), END_FOG);
    else if (nether) R.setFog(8, Math.min(rd * 0.7, 96), NETHER_FOG);
    else R.setFog(rd * (rain > 0.5 ? 0.45 : 0.62), rd * 0.98, R.sky.fogColor);
    this.underwater = underwater; this.inLava = inLava;
    this.audio.setUnderwater(underwater);
    // weather
    R.weather.update(dt, cam, this.world, nether ? 0 : this.rainTarget, R.particles);
    this.inPortal = this.world.getBlockRaw(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z)) === ID.nether_portal;
    R.weather.setBrightness(0.35 + day * 0.65);
    this.audio.setRain(R.weather.exposure * (R.weather.snowing ? 0.2 : 1));
    this.audio.setWind(p.gliding ? Math.hypot(p.vx, p.vy, p.vz) / 40 : 0);
    // entities & particles
    R.entities.update(dt, this.world, day, this.tickCount);
    for (const v of R.entities.views.values()) {
      if (v.digging && v.type === 'player' && Math.random() < dt * 5) {
        const d = v.digging;
        const id = this.world.getBlockRaw(d.x, d.y, d.z);
        if (id) R.particles.blockHit(this.world, d.x, d.y, d.z, 2, id, this.world.getMeta(d.x, d.y, d.z), day);
        v.swing = 6;
      }
      if ((v.flags & FLAG.BURNING) && Math.random() < dt * 10) R.particles.flame(v.x + (Math.random() - 0.5) * 0.5, v.y + Math.random() * 1.5, v.z + (Math.random() - 0.5) * 0.5);
      if (v.type === 'firework' && Math.random() < dt * 30) R.particles.trail(v.x, v.y, v.z);
    }
    this.updateSelfView(ix, iy, iz, dt, day);
    R.particles.minimal = this.options.get('particles') === 'minimal';
    R.particles.update(dt, this.world);
    // torch / lava ambient particles near player
    if (!R.particles.minimal && Math.random() < dt * 4) this.ambientParticles();
    // audio listener
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    this.audio.setListener({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, fwd);
    const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
    this.audio.tickAmbient(dt, { underground: (l >> 4) < 4 && p.y < 55 });
    // held item
    const held = this.held();
    R.held.setItem(held ? held.id : null);
    const pl = this.world.getLight(Math.floor(p.x), Math.floor(p.y + p.eye), Math.floor(p.z));
    const bright = Math.max(0.08, Math.max(lightCurve((pl >> 4) / 15 * day), lightCurve((pl & 15) / 15)));
    R.held.update(dt, { bobPhase: this.bobPhase, bobAmount: this.cameraMode === 0 ? this.bobAmount : 0, sky: pl >> 4, blk: pl & 15, daylight: day, using: this.using ? this.using.kind : null, useTicks: this.using ? this.using.ticks : 0, bright });
    const showHand = this.cameraMode === 0 && this.gamemode !== 'spectator' && this.alive && !this.sleeping && this.app.hud.visible;
    R.render(showHand);
    // fps
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.frames / this.fpsTime); this.frames = 0; this.fpsTime = 0; }
  }

  headInFluid(pos, id) {
    const meta = this.world.getMeta(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    const above = this.world.getBlockRaw(Math.floor(pos.x), Math.floor(pos.y) + 1, Math.floor(pos.z));
    const h = above === id || (meta & 8) ? 1 : (8 - (meta & 7)) / 9;
    return pos.y - Math.floor(pos.y) < h;
  }

  ambientParticles() {
    const p = this.player;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 16), y = Math.floor(p.y + (Math.random() - 0.5) * 10), z = Math.floor(p.z + (Math.random() - 0.5) * 16);
      const id = this.world.getBlockRaw(x, y, z);
      if (id === ID.torch) {
        const m = this.world.getMeta(x, y, z);
        let ox = 0.5, oz = 0.5, oy = 0.72;
        if (m) { const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][(m - 1) & 3]; ox = 0.5 - dx * 0.05; oz = 0.5 - dz * 0.05; oy = 0.92; }
        this.renderer.particles.smoke(x + ox, y + oy, z + oz);
        this.renderer.particles.flame(x + ox, y + oy - 0.05, z + oz);
      } else if (id === ID.lava && this.world.getBlockRaw(x, y + 1, z) === 0 && Math.random() < 0.3) {
        this.renderer.particles.puff(x + Math.random(), y + 1, z + Math.random(), 1, [1, 0.5, 0.1], 0.08, 1, 0.8, 8);
      } else if (id === ID.furnace_lit) {
        this.renderer.particles.smoke(x + 0.5, y + 1.05, z + 0.5);
      }
    }
  }

  updateSelfView(ix, iy, iz, dt, day) {
    const v = this.selfView;
    if (!v) return;
    const p = this.player;
    const third = this.cameraMode !== 0 && this.gamemode !== 'spectator' && this.alive;
    v.group.visible = third;
    if (!third) return;
    let f = 0;
    if (p.pose === 'sneak') f |= FLAG.SNEAK;
    if (p.gliding) f |= FLAG.GLIDE;
    if (p.pose === 'swim') f |= FLAG.SWIM;
    if (this.using) { f |= FLAG.USING; if (this.using.kind === 'bow') f |= FLAG.DRAWING; }
    if (this.sleeping) f |= FLAG.SLEEPING;
    if (this.hurtTime > 0) f |= FLAG.HURT;
    v.direct = { x: ix, y: iy, z: iz, yaw: p.yaw, headYaw: p.yaw, pitch: p.pitch, flags: f };
    const held = this.held();
    v.setEquip({ held: held ? held.id : null, armor: this.inv.armor.map((a) => (a ? a.id : null)) });
    v.update(dt, 0, this.world, day, this.tickCount);
  }

  updateTarget(ox, oy, oz, look) {
    const R = this.renderer;
    const p = this.player;
    if (!this.alive || this.sleeping) { this.target = null; R.setSelection(null); R.setCrack(0, 0, 0, -1); return; }
    const creative = this.gamemode === 'creative';
    const reach = creative ? C.REACH_CREATIVE : C.REACH_SURVIVAL;
    const eyeX = p.x, eyeY = p.y + this.eyeH, eyeZ = p.z;
    void ox; void oy; void oz;
    const hit = raycast(this.world, eyeX, eyeY, eyeZ, look[0], look[1], look[2], reach);
    const ent = R.entities.pick(eyeX, eyeY, eyeZ, look[0], look[1], look[2], creative ? 5 : C.ATTACK_REACH, (v) => {
      const s = SIZES[v.type];
      if (!s) return null;
      const baby = v.data && v.data.baby;
      return baby ? [s[0] * 0.5, s[1] * 0.5] : s;
    });
    if (ent && (!hit || ent.dist < hit.dist)) {
      this.target = { type: 'entity', id: ent.id, view: ent.view };
      R.setSelection(null);
    } else if (hit && this.gamemode !== 'spectator') {
      this.target = { type: 'block', ...hit };
      const b = selectionBox(hit.id, hit.meta);
      R.setSelection([hit.x + b[0], hit.y + b[1], hit.z + b[2], hit.x + b[3], hit.y + b[4], hit.z + b[5]]);
    } else {
      this.target = ent ? { type: 'entity', id: ent.id, view: ent.view } : null;
      R.setSelection(null);
    }
    if (this.dig && this.dig.progress > 0) {
      const b = selectionBox(this.dig.id, this.world.getMeta(this.dig.x, this.dig.y, this.dig.z));
      R.setCrack(this.dig.x, this.dig.y, this.dig.z, Math.min(9, Math.floor(this.dig.progress * 10)), b);
    } else R.setCrack(0, 0, 0, -1);
  }

  attackCharge() {
    const held = this.held();
    const tool = toolOf(held);
    const aspd = tool ? tool.attackSpeed : HAND_ATTACK_SPEED;
    return Math.min(1, (this.tickCount - this.lastAttackTick) / (20 / aspd));
  }

  // ---------- info for HUD / debug ----------
  debugInfo() {
    const p = this.player, R = this.renderer;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const l = this.world.getLight(bx, by, bz);
    const facing = ['north (-Z)', 'west (-X)', 'south (+Z)', 'east (+X)'][((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4];
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB heap' : Math.round(this.world.memoryEstimate() / 1048576) + ' MB chunks (est.)';
    const info = R.info();
    const t = ((this.time % C.DAY_TICKS) + C.DAY_TICKS) % C.DAY_TICKS;
    const left = [
      `${C.VERSION} (${this.sp ? 'singleplayer' : 'multiplayer'})`,
      `${this.fps} fps  T: ${this.options.get('fpsCap') || 'inf'}  draw calls: ${info.calls}`,
      `C: ${R.chunks.countVisible(R.frustum)}/${this.cm.loadedCount()} rendered/loaded  D: ${this.options.get('renderDistance')}`,
      `E: ${R.entities.views.size} entities  P: ${R.particles.count} particles`,
      `Server TPS: ${this.serverTps.toFixed(1)}  ping: ${Math.round(this.ping)} ms`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}  Chunk: ${bx >> 4} ${bz >> 4} in ${bx & 15} ${bz & 15}`,
      `Facing: ${facing} (${(((-p.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180).toFixed(1)} / ${(p.pitch * 180 / Math.PI).toFixed(1)})`,
      `Biome: ${BIOME_NAMES[this.world.biomeAt(bx, bz)] || '?'}`,
      `Light: ${l >> 4} sky, ${l & 15} block`,
      `Time: ${t} (day ${Math.floor(this.time / C.DAY_TICKS)})  Weather: ${this.weather}`,
      `Mode: ${this.gamemode}${this.hardcore ? ' (hardcore)' : ''}  Difficulty: ${this.difficulty}`,
    ];
    const right = [
      `Memory: ${mem}`,
      `GPU geometries: ${R.gl.info.memory.geometries}  textures: ${R.gl.info.memory.textures}`,
      `Workers: ${this.cm.workers.length}  generated ${this.cm.stats.generated}  meshed ${this.cm.stats.meshed}`,
    ];
    if (this.target && this.target.type === 'block') {
      const tb = BLOCKS[this.world.getBlockRaw(this.target.x, this.target.y, this.target.z)];
      right.push('', `Targeted block: ${this.target.x} ${this.target.y} ${this.target.z}`, tb ? tb.name + (this.target.meta ? ` [meta ${this.target.meta}]` : '') : '');
    } else if (this.target && this.target.type === 'entity') right.push('', `Targeted entity: ${this.target.view.type} #${this.target.id}`);
    return { left, right };
  }

  armorPoints() { return armorPoints(this.inv); }
  fluidAt() { return fluidState(this.world, this.player, {}); }
}
