// Authoritative game server. Runs in Node (multiplayer) or in a Web Worker (single-player)
// with the exact same code path. Hosts provide a storage backend and connections.
import * as C from '../../shared/constants.js';
import { parseSeed } from '../../shared/noise.js';
import { ServerWorld } from './ServerWorld.js';
import { EntityManager } from './entities.js';
import { Mob, TRADES } from './mobs.js';
import { Containers } from './containers.js';
import { ServerPlayer } from './ServerPlayer.js';
import { Spawner } from './spawner.js';
import { runCommand } from './commands.js';
import { BLOCKS, ID, IS_FLUID, IS_SOLID, IS_FULL, FACING_VEC, canSurviveOn } from '../../shared/blocks.js';
import { ITEMS, maxStackOf, HAND_DAMAGE, HAND_ATTACK_SPEED } from '../../shared/items.js';
import { applyAction, addToInventory, countItem, removeItem, packInventory, armorPoints, unpackStacks } from '../../shared/inventory.js';
import { breakTicks, canHarvest, toolOf } from '../../shared/mining.js';
import { boxCollides, fluidState, lookVector } from '../../shared/physics.js';
import { FLAG } from '../../shared/protocol.js';
import { chunkKey } from '../../shared/chunk.js';
import { tryLightPortal } from './portals.js';
import { clampToBorder, dimensionAt, END } from '../../shared/dimensions.js';
import { strongholds, frameCells, ROOM_Y } from '../../shared/strongholds.js';
import { exitPortalCells } from '../../shared/endgen.js';

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const ARMOR_CAUSES = new Set(['zombie', 'spider', 'skeleton', 'arrow', 'arrow_player', 'explosion', 'player', 'lava', 'fire', 'cactus', 'crash']);
const DEATH_MESSAGES = {
  fall: '%s fell from a high place', drown: '%s drowned', lava: '%s tried to swim in lava', fire: '%s burned to death',
  zombie: '%s was slain by Zombie', spider: '%s was slain by Spider', skeleton: '%s was shot by Skeleton', arrow: '%s was shot by an arrow',
  arrow_player: '%s was shot by %k', explosion: '%s was blown up by Creeper', starve: '%s starved to death',
  suffocation: '%s suffocated in a wall', void: '%s fell out of the world', cactus: '%s was pricked to death',
  crash: '%s experienced kinetic energy', magma: '%s discovered the floor was lava', dragon: '%s was slain by Ender Dragon', enderman: '%s was slain by Enderman', kill: '%s was killed', player: '%s was slain by %k',
};

function cleanSkin(s) {
  if (!s || typeof s !== 'object') return null;
  const n = (v, max) => Math.max(0, Math.min(max, v | 0));
  return { tone: n(s.tone, 15), hair: n(s.hair, 15), shirt: n(s.shirt, 15), pants: n(s.pants, 15), long: !!s.long };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

export class GameServer {
  constructor({ storage, config = {}, log = console.log }) {
    this.storage = storage;
    this.config = {
      maxPlayers: C.MAX_PLAYERS, pvp: true, motd: 'A ShaftCraft Server', sp: false,
      ops: [], bans: {}, ...config,
    };
    this.sp = !!this.config.sp;
    this.log = log;
    this.players = new Map(); // id -> ServerPlayer
    this.savedPlayers = {};
    this.tickCount = 0;
    this.paused = false;
    this.running = false;
    this.tpsSamples = [];
    this.tps = C.TICK_RATE;
    this.stopRequested = false;
  }

  // ---------- lifecycle ----------
  async init(create) {
    const data = await this.storage.load();
    let level;
    if (data && data.level) {
      level = data.level;
    } else {
      if (!create) create = {};
      const seed = parseSeed(create.seed);
      level = {
        name: create.name || 'world', seed, type: create.type === 'flat' ? 'flat' : 'default',
        time: 1000, weather: 'clear', weatherTimer: C.WEATHER_MIN_TICKS, difficulty: create.difficulty || 'normal',
        gamemode: create.gamemode === 'creative' ? 'creative' : 'survival', hardcore: create.gamemode === 'hardcore',
        allowCommands: create.allowCommands !== undefined ? !!create.allowCommands : create.gamemode === 'creative',
        spawn: null, created: Date.now(),
      };
      if (level.hardcore) level.difficulty = 'hard';
    }
    this.level = level;
    this.seed = level.seed;
    this.time = level.time || 0;
    this.weather = level.weather || 'clear';
    this.weatherTimer = level.weatherTimer || C.WEATHER_MIN_TICKS;
    this.difficulty = level.difficulty;
    this.hardcore = !!level.hardcore;
    this.world = new ServerWorld(this, level.seed, level.type, data ? data.mods : null);
    this.entities = new EntityManager(this);
    this.containers = new Containers(this, data ? data.containers : null);
    this.spawner = new Spawner(this, data ? data.spawned : null);
    this.dormant = (data && data.dormant) || {};
    this.savedPlayers = (data && data.players) || {};
    if (data && data.ops) this.config.ops = [...new Set([...this.config.ops, ...data.ops])];
    if (data && data.bans) this.config.bans = { ...data.bans, ...this.config.bans };
    if (!level.spawn) {
      const s = this.world.gen.findSpawn();
      level.spawn = { x: Math.floor(s.x), y: s.y, z: Math.floor(s.z) };
    }
    // pre-generate spawn area
    const scx = level.spawn.x >> 4, scz = level.spawn.z >> 4;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) this.world.getChunk(scx + dx, scz + dz);
    level.spawn.y = this.safeY(level.spawn.x, level.spawn.z);
    this.log(`World "${level.name}" seed ${level.seed} (${level.type}), spawn ${level.spawn.x} ${level.spawn.y} ${level.spawn.z}`);
    return level;
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = Date.now();
    let acc = 0;
    this.interval = setInterval(() => {
      const now = Date.now();
      acc += now - last;
      last = now;
      if (acc > 1000) acc = 1000; // don't spiral after long stalls
      while (acc >= C.TICK_MS) {
        acc -= C.TICK_MS;
        if (!this.paused) this.tick();
      }
    }, 10);
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.running = false;
    for (const p of this.players.values()) this.savePlayer(p);
    await this.save();
  }

  requestStop() { this.stopRequested = true; if (this.onStopRequested) this.onStopRequested(); }

  // ---------- connections ----------
  connect(conn) {
    const self = this;
    let player = null;
    return {
      onMessage(msg) {
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'status') {
          conn.send({ t: 'status', motd: self.config.motd, players: self.joinedCount(), max: self.config.maxPlayers, version: C.VERSION, protocol: C.PROTOCOL_VERSION });
          return;
        }
        if (msg.t === 'ping') { conn.send({ t: 'pong', c: msg.c, tps: self.tps }); if (player) player.lastPingAt = Date.now(); return; }
        if (!player) {
          if (msg.t === 'hello') player = self.handleHello(conn, msg);
          return;
        }
        try {
          self.handle(player, msg);
        } catch (err) {
          self.log('Error handling ' + msg.t + ' from ' + player.name + ': ' + (err && err.stack || err));
        }
      },
      onClose() {
        if (player) self.removePlayer(player);
        player = null;
      },
      setPing(ms) { if (player) player.ping = ms; },
    };
  }

  joinedCount() { let n = 0; for (const p of this.players.values()) if (p.joined) n++; return n; }

  handleHello(conn, msg) {
    const name = String(msg.name || '').trim();
    if (msg.protocol !== C.PROTOCOL_VERSION) { conn.send({ t: 'kick', reason: 'Outdated client or server (protocol ' + C.PROTOCOL_VERSION + ')' }); conn.close(); return null; }
    if (!NAME_RE.test(name)) { conn.send({ t: 'kick', reason: 'Invalid username (1-16 letters, digits or _)' }); conn.close(); return null; }
    const ban = this.config.bans[name.toLowerCase()];
    if (ban) { conn.send({ t: 'kick', reason: 'You are banned from this server: ' + ban }); conn.close(); return null; }
    if (this.joinedCount() >= this.config.maxPlayers) { conn.send({ t: 'kick', reason: 'The server is full' }); conn.close(); return null; }
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) { this.kick(p, 'You logged in from another location'); }
    }
    const p = new ServerPlayer(this, this.entities.newId(), name, conn);
    p.skin = cleanSkin(msg.skin);
    p.fullName = String(msg.fullName || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32);
    p.viewDistance = Math.max(C.RENDER_DISTANCE_MIN, Math.min(C.RENDER_DISTANCE_MAX, msg.viewDistance | 0 || C.RENDER_DISTANCE_DEFAULT));
    p.op = this.sp ? this.level.allowCommands : this.config.ops.map((o) => o.toLowerCase()).includes(name.toLowerCase());
    const saved = this.savedPlayers[name.toLowerCase()];
    if (saved) p.restore(saved);
    else {
      p.gamemode = this.level.gamemode;
      const sp = this.level.spawn;
      p.x = sp.x + 0.5; p.y = this.safeY(sp.x, sp.z); p.z = sp.z + 0.5;
      p.flying = false;
    }
    if (this.hardcore && p.hardcoreDead) { p.gamemode = 'spectator'; p.alive = true; }
    p.lastGroundY = p.y;
    this.players.set(p.id, p);
    p.joined = true;
    const ps = p.status();
    conn.send({
      t: 'welcome', eid: p.id, name: p.name, seed: this.seed, worldType: this.level.type, worldName: this.level.name,
      time: this.time, weather: this.weather, difficulty: this.difficulty, gamemode: p.gamemode, hardcore: this.hardcore,
      op: p.op, allowCommands: this.level.allowCommands, sp: this.sp, spawn: this.level.spawn, pvp: this.config.pvp,
      player: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying, alive: p.alive },
      inv: packInventory(p.inv), status: ps, tid: p.tid, maxPlayers: this.config.maxPlayers,
    });
    p.lastStatus = JSON.stringify(ps);
    if (!p.alive) p.send({ t: 'death', cause: p.deathCause || 'You died', score: p.score, hardcore: this.hardcore && p.hardcoreDead });
    this.broadcast({ t: 'chat', text: `${p.name} joined the game`, color: 'yellow' });
    this.log(`${p.name} joined (${this.joinedCount()} online)`);
    this.broadcastPlayerList();
    return p;
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    p.closeWindow(false);
    this.savePlayer(p);
    this.players.delete(p.id);
    p.joined = false;
    for (const q of this.players.values()) if (q.known.has(p.id)) { q.known.delete(p.id); q.send({ t: 'despawn', ids: [p.id] }); }
    this.broadcast({ t: 'chat', text: `${p.name} left the game`, color: 'yellow' });
    this.log(`${p.name} left`);
    this.broadcastPlayerList();
    this.checkSleep();
  }

  savePlayer(p) { this.savedPlayers[p.name.toLowerCase()] = p.serialize(); }

  kick(p, reason) {
    p.send({ t: 'kick', reason });
    this.removePlayer(p);
    if (p.conn) p.conn.close();
  }

  ban(name, reason) {
    this.config.bans[name.toLowerCase()] = reason;
    for (const p of this.players.values()) if (p.name.toLowerCase() === name.toLowerCase()) this.kick(p, 'You are banned: ' + reason);
  }

  pardon(name) { delete this.config.bans[name.toLowerCase()]; }

  setOp(name, on) {
    const n = name.toLowerCase();
    const ops = new Set(this.config.ops.map((o) => o.toLowerCase()));
    if (on) ops.add(n); else ops.delete(n);
    this.config.ops = [...ops];
    for (const p of this.players.values()) if (p.name.toLowerCase() === n) { p.op = on; p.send({ t: 'op', op: on }); p.send({ t: 'chat', text: on ? 'You are now a server operator' : 'You are no longer a server operator', color: 'yellow' }); }
  }

  // ---------- messaging helpers ----------
  broadcast(msg, except) { for (const p of this.players.values()) if (p !== except && p.joined) p.send(msg); }

  broadcastNear(x, y, z, msg, range = 64, except = null) {
    for (const p of this.players.values()) {
      if (p === except || !p.joined) continue;
      if (Math.abs(p.x - x) <= range && Math.abs(p.z - z) <= range && Math.abs(p.y - y) <= range * 1.5) p.send(msg);
    }
  }

  broadcastToKnown(e, msg) {
    for (const p of this.players.values()) if (p !== e && p.known.has(e.id)) p.send(msg);
  }

  sound(name, x, y, z, v = 1, pitch = 1, except = null) {
    this.broadcastNear(x, y, z, { t: 'sound', s: name, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), v, p: +pitch.toFixed(3) }, 48, except);
  }

  broadcastPlayerList() {
    const list = [...this.players.values()].filter((p) => p.joined).map((p) => ({ name: p.name, fullName: p.fullName || '', ping: Math.round(p.ping), mode: p.gamemode, id: p.id }));
    this.broadcast({ t: 'players', list, max: this.config.maxPlayers });
  }

  broadcastTime() { this.broadcast({ t: 'time', time: this.time, weather: this.weather }); }

  chat(text, color) { this.broadcast({ t: 'chat', text, color }); this.log('[chat] ' + text); }

  activePlayers() { const out = []; for (const p of this.players.values()) if (p.joined) out.push(p); return out; }

  entityById(id) { if (!id) return null; return this.players.get(id) || this.entities.list.get(id) || null; }

  nearestPlayer(x, y, z, range, hostileTarget) {
    let best = null, bd = range;
    for (const p of this.players.values()) {
      if (!p.joined || !p.alive) continue;
      if (hostileTarget && (p.gamemode === 'creative' || p.gamemode === 'spectator')) continue;
      if (!hostileTarget && p.gamemode === 'spectator') continue;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  skyFactor() {
    let f = C.dayLightFactor(this.time);
    if (this.weather !== 'clear') f *= 0.8;
    return f;
  }

  isRaining() { return this.weather !== 'clear'; }

  setWeather(w, duration) {
    this.weather = w;
    this.weatherTimer = duration;
    this.broadcastTime();
  }

  safeY(x, z) {
    this.world.getChunk(x >> 4, z >> 4);
    let y = this.world.topY(x, z);
    // move up out of fluids/leaves
    while (y < 250 && (IS_SOLID[this.world.getBlock(x, y, z)] || IS_SOLID[this.world.getBlock(x, y + 1, z)])) y++;
    return Math.max(1, y);
  }

  // ---------- main tick ----------
  tick() {
    const t0 = Date.now();
    this.tickCount++;
    this.time++;
    // weather
    if (--this.weatherTimer <= 0) {
      if (this.weather === 'clear') {
        const w = Math.random() < 0.2 ? 'thunder' : 'rain';
        this.setWeather(w, C.RAIN_MIN_TICKS + Math.floor(Math.random() * (C.RAIN_MAX_TICKS - C.RAIN_MIN_TICKS)));
      } else this.setWeather('clear', C.WEATHER_MIN_TICKS + Math.floor(Math.random() * (C.WEATHER_MAX_TICKS - C.WEATHER_MIN_TICKS)));
    }
    if (this.weather === 'thunder' && Math.random() < 1 / 200) {
      const ps = this.activePlayers();
      if (ps.length) {
        const p = ps[Math.floor(Math.random() * ps.length)];
        const x = p.x + (Math.random() - 0.5) * 120, z = p.z + (Math.random() - 0.5) * 120;
        this.broadcastNear(x, p.y, z, { t: 'fx', k: 'lightning', x, z }, 200);
      }
    }
    if (this.tickCount % 20 === 0) this.broadcastTime();

    // load chunks around players
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      let budget = 3;
      const R = C.SERVER_SIM_RADIUS;
      for (let r = 0; r <= R && budget > 0; r++) {
        for (let dz = -r; dz <= r && budget > 0; dz++) for (let dx = -r; dx <= r && budget > 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.world.hasChunk(pcx + dx, pcz + dz)) { this.world.getChunk(pcx + dx, pcz + dz); budget--; }
        }
      }
    }

    for (const p of this.players.values()) {
      p.tick();
      if (p.alive && p.joined) {
        const ek = p.equipKey();
        if (ek !== p.lastEquip) {
          p.lastEquip = ek;
          const h = p.heldStack(), o = p.inv.offhand[0];
          this.broadcastToKnown(p, { t: 'equip', id: p.id, held: h ? h.id : null, off: o ? o.id : null, armor: p.inv.armor.map((a) => (a ? a.id : null)) });
        }
      }
      p.syncStatus();
    }
    this.checkSleep();
    this.world.tick();
    this.entities.tick();
    this.spawner.tick();
    this.containers.tick();

    // flush block changes
    if (this.world.changed.length) {
      const ch = this.world.changed;
      this.world.changed = [];
      for (const p of this.players.values()) {
        if (!p.joined) continue;
        const range = (p.viewDistance + 1) * 16;
        const out = [];
        for (let i = 0; i < ch.length; i += 5) {
          if (Math.abs(ch[i] - p.x) <= range && Math.abs(ch[i + 2] - p.z) <= range) out.push(ch[i], ch[i + 1], ch[i + 2], ch[i + 3], ch[i + 4]);
        }
        if (out.length) p.send({ t: 'blocks', b: out });
      }
    }
    if (this.tickCount % C.ENTITY_BROADCAST_EVERY === 0) this.trackEntities();
    if (this.tickCount % 40 === 0) this.broadcastPlayerList();
    if (this.tickCount % 100 === 0) this.world.unloadFar(this.activePlayers());
    if (this.tickCount % C.AUTOSAVE_TICKS === 0) this.save();

    const dt = Date.now() - t0;
    this.tpsSamples.push(dt);
    if (this.tpsSamples.length > 40) this.tpsSamples.shift();
    if (this.tickCount % 20 === 0) {
      const avg = this.tpsSamples.reduce((a, b) => a + b, 0) / this.tpsSamples.length;
      this.tps = Math.min(C.TICK_RATE, 1000 / Math.max(C.TICK_MS, avg));
      this.mspt = avg;
    }
  }

  trackEntities() {
    // compute state strings once per entity
    const all = [];
    for (const e of this.entities.list.values()) all.push(e);
    for (const p of this.players.values()) if (p.joined) all.push(p);
    for (const e of all) {
      const s = e.state();
      const key = s.join(',');
      e._changed = key !== e._lastKey;
      e._lastKey = key;
      e._state = s;
    }
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const range = Math.min(p.viewDistance * 16, 160);
      const states = [];
      const seen = new Set();
      for (const e of all) {
        if (e === p || e.removed) continue;
        if (Math.abs(e.x - p.x) > range || Math.abs(e.z - p.z) > range) continue;
        seen.add(e.id);
        if (!p.known.has(e.id)) {
          p.known.add(e.id);
          p.send({ t: 'spawn', e: e.spawnData() });
          states.push(e._state);
        } else if (e._changed) states.push(e._state);
      }
      const gone = [];
      for (const id of p.known) if (!seen.has(id)) gone.push(id);
      if (gone.length) { for (const id of gone) p.known.delete(id); p.send({ t: 'despawn', ids: gone }); }
      if (states.length) p.send({ t: 'ents', d: states });
    }
  }

  onDragonDeath(dragon) {
    this.level.dragonKilled = true;
    for (const [x, y, z] of exitPortalCells().inner) this.world.setBlock(x, y, z, ID.end_portal, 0, { noUpdate: true });
    this.broadcast({ t: 'chat', text: 'The Ender Dragon has been slain! The exit portal is open.', color: 'aqua' });
    this.sound('ender_dragon_death', dragon.x, dragon.y, dragon.z, 3, 1);
    if (dragon.killer && dragon.killer.type === 'player') dragon.killer.addScore(500);
  }

  // Player stepped into an End portal: Overworld -> End platform, End -> respawn point.
  endPortalTravel(p) {
    if (dimensionAt(p.x, p.z) === 'end') {
      let pos = null;
      if (p.spawnPoint && this.world.getBlock(p.spawnPoint.x, p.spawnPoint.y, p.spawnPoint.z) === ID.bed) pos = this.besideBed(p.spawnPoint.x, p.spawnPoint.y, p.spawnPoint.z);
      if (!pos) { const s = this.level.spawn; pos = { x: s.x + 0.5, y: this.safeY(s.x, s.z), z: s.z + 0.5 }; }
      this.teleport(p, pos.x, pos.y, pos.z);
      return;
    }
    const [ox, oy, oz] = END.platform;
    const px = END.x + ox, pz = END.z + oz;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      this.world.setBlock(px + dx, oy, pz + dz, ID.obsidian, 0, { noUpdate: true });
      for (let k = 1; k <= 3; k++) this.world.setBlock(px + dx, oy + k, pz + dz, 0, 0, { noUpdate: true });
    }
    this.teleport(p, px + 0.5, oy + 1, pz + 0.5);
  }

  onChunkLoaded(c, key) {
    if (this.spawner) this.spawner.onChunkFirstLoad(c, key);
    const d = this.dormant[key];
    if (d) { delete this.dormant[key]; this.entities.restore(d); }
  }

  onChunkUnload(c, key) {
    const inChunk = (e) => (Math.floor(e.x) >> 4) === c.cx && (Math.floor(e.z) >> 4) === c.cz;
    const list = [];
    for (const e of [...this.entities.list.values()]) {
      if (!inChunk(e)) continue;
      if (e instanceof Mob) { if (e.persistent && !e.dead) list.push(e.serialize()); this.entities.remove(e); }
      else if (e.type === 'item') { list.push({ type: 'item', x: e.x, y: e.y, z: e.z, item: [e.stack.id, e.stack.count, e.stack.dmg || 0], age: e.age }); this.entities.remove(e); }
      else this.entities.remove(e);
    }
    if (list.length) this.dormant[key] = (this.dormant[key] || []).concat(list);
  }

  onBlockChanged(x, y, z, oldId, newId) {
    if (oldId === ID.bed && newId !== ID.bed) {
      for (const p of this.players.values()) if (p.sleeping && p.bedPos && p.bedPos.x === x && p.bedPos.y === y && p.bedPos.z === z) this.wake(p);
    }
  }

  // ---------- persistence ----------
  snapshot() {
    for (const p of this.players.values()) if (p.joined) this.savePlayer(p);
    const dormant = { ...this.dormant };
    // persist entities in loaded chunks too
    for (const e of this.entities.list.values()) {
      const key = chunkKey(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
      let d = null;
      if (e instanceof Mob) { if (e.persistent && !e.dead) d = e.serialize(); }
      else if (e.type === 'item') d = { type: 'item', x: e.x, y: e.y, z: e.z, item: [e.stack.id, e.stack.count, e.stack.dmg || 0], age: e.age };
      if (d) (dormant[key] = dormant[key] ? dormant[key].slice() : []).push(d);
    }
    return {
      level: { ...this.level, time: this.time, weather: this.weather, weatherTimer: this.weatherTimer, difficulty: this.difficulty, lastPlayed: Date.now() },
      mods: this.world.serializeMods(),
      players: this.savedPlayers,
      containers: this.containers.serialize(),
      dormant,
      spawned: this.spawner.serialize(),
      ops: this.config.ops,
      bans: this.config.bans,
    };
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      await this.storage.save(this.snapshot());
    } catch (err) {
      this.log('Save failed: ' + (err && err.message || err));
    } finally {
      this.saving = false;
    }
  }

  runConsole(line) {
    runCommand(this, null, line, (text) => this.log(text));
  }

  // ---------- damage ----------
  damageEntity(target, amount, cause, attacker, kx = 0, kz = 0, kbScale = 1) {
    if (!target) return;
    if (target.type === 'player') return this.damagePlayer(target, amount, cause, attacker, kx, kz, kbScale);
    if (target instanceof Mob) return target.hurt(amount, cause, attacker, kx, kz, kbScale);
  }

  damagePlayer(p, amount, cause, attacker, kx = 0, kz = 0, kbScale = 1, bypass = false) {
    if (!p.alive || !p.joined) return false;
    if (!bypass && (p.gamemode === 'creative' || p.gamemode === 'spectator')) return false;
    if (p.gamemode === 'spectator' && cause !== 'kill') return false;
    if (p.hurtTime > 0 && amount <= p.lastDamage && cause !== 'kill') return false;
    const extra = p.hurtTime > 0 ? amount - p.lastDamage : amount;
    p.lastDamage = amount;
    let dmg = extra;
    if (ARMOR_CAUSES.has(cause)) {
      const pts = armorPoints(p.inv);
      dmg *= 1 - Math.min(C.ARMOR_REDUCTION_MAX, pts * C.ARMOR_REDUCTION_PER_POINT);
      // armor wear
      let changed = false;
      for (let i = 0; i < 4; i++) {
        const a = p.inv.armor[i];
        if (!a || !ITEMS[a.id].armor || ITEMS[a.id].armor.glider) continue;
        a.dmg = (a.dmg || 0) + Math.max(1, Math.floor(amount / 4));
        if (a.dmg >= ITEMS[a.id].durability) { p.inv.armor[i] = null; this.sound('item_break', p.x, p.y + 1, p.z); }
        changed = true;
      }
      if (changed) p.syncInventory();
    }
    if (p.sleeping) this.wake(p);
    p.hp = Math.max(0, p.hp - dmg);
    p.hurtTime = C.HURT_COOLDOWN_TICKS;
    p.addExhaustion(C.EXH_DAMAGE);
    if (p.using && p.using.kind === 'eat') p.using = null;
    const len = Math.hypot(kx, kz);
    if (len > 0 && kbScale > 0) {
      const kvx = (kx / len) * C.KNOCKBACK * 0.55 * kbScale, kvz = (kz / len) * C.KNOCKBACK * 0.55 * kbScale;
      const kvy = Math.min(C.KNOCKBACK_UP, 4 + kbScale * 2);
      p.kbAllowance += Math.hypot(kvx, kvz) * 0.5 + 2;
      p.send({ t: 'kb', vx: kvx, vy: kvy, vz: kvz });
    }
    const hurtYaw = attacker ? Math.atan2(attacker.x - p.x, attacker.z - p.z) : null;
    p.send({ t: 'hurt', cause, yaw: hurtYaw });
    this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'hurt' });
    this.sound('player_hurt', p.x, p.y + 1, p.z, 1, 1);
    p.syncStatus();
    if (p.hp <= 0) this.killPlayer(p, cause, attacker);
    return true;
  }

  killPlayer(p, cause, attacker) {
    p.alive = false;
    p.hp = 0;
    p.gliding = false; p.sleeping = false; p.using = null; p.digging = null;
    let msg = (DEATH_MESSAGES[cause] || '%s died').replace('%s', p.name).replace('%k', attacker ? (attacker.name || attacker.def && attacker.def.name || 'something') : 'something');
    p.deathCause = msg;
    this.chat(msg, 'white');
    p.closeWindow(true);
    // drop inventory
    if (p.gamemode === 'survival') {
      for (const arr of [p.inv.main, p.inv.armor, p.inv.offhand]) {
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i]) continue;
          const a = Math.random() * Math.PI * 2, s = Math.random() * 3;
          this.entities.spawnItem(p.x, p.y + 1, p.z, arr[i], { vx: Math.cos(a) * s, vy: 3, vz: Math.sin(a) * s, pickupDelay: 40, lifetime: C.RESPAWN_ITEM_DESPAWN_TICKS });
          arr[i] = null;
        }
      }
      p.syncInventory();
    }
    if (this.hardcore) p.hardcoreDead = true;
    this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'death' });
    p.send({ t: 'death', cause: msg, score: p.score, hardcore: this.hardcore });
    p.syncStatus(true);
    this.checkSleep();
  }

  respawn(p) {
    if (p.alive || p.hardcoreDead) return;
    p.alive = true;
    p.hp = C.MAX_HEALTH; p.food = C.MAX_FOOD; p.sat = 5; p.exhaustion = 0; p.air = C.MAX_AIR_TICKS; p.fireTicks = 0;
    p.score = 0;
    let pos = null;
    if (p.spawnPoint) {
      const sp = p.spawnPoint;
      if (sp.forced) pos = { x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 };
      else if (this.world.getBlock(sp.x, sp.y, sp.z) === ID.bed) pos = this.besideBed(sp.x, sp.y, sp.z);
      else { p.spawnPoint = null; p.send({ t: 'chat', text: 'You have no home bed or it was obstructed', color: 'gray' }); }
    }
    if (!pos) {
      const s = this.level.spawn;
      pos = { x: s.x + 0.5, y: this.safeY(s.x, s.z), z: s.z + 0.5 };
    }
    this.teleport(p, pos.x, pos.y, pos.z);
    p.send({ t: 'respawned', x: pos.x, y: pos.y, z: pos.z, tid: p.tid });
    p.syncStatus(true);
    p.syncInventory();
    for (const q of this.players.values()) if (q !== p && q.known.has(p.id)) q.send({ t: 'spawn', e: p.spawnData() });
  }

  besideBed(x, y, z) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const bx = x + dx, bz = z + dz;
      for (const by of [y, y + 1, y - 1]) {
        if (!IS_SOLID[this.world.getBlock(bx, by, bz)] && !IS_SOLID[this.world.getBlock(bx, by + 1, bz)] && IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return { x: bx + 0.5, y: by, z: bz + 0.5 };
      }
    }
    return { x: x + 0.5, y: y + 0.6, z: z + 0.5 };
  }

  teleport(p, x, y, z) {
    p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0;
    p.fallDist = 0; p.lastGroundY = y; p.moveBudget = 4;
    p.tid++;
    p.gliding = false;
    p.send({ t: 'pos', x, y, z, tid: p.tid });
  }

  dropItem(p, stack, all = true) {
    if (!stack) return;
    const look = lookVector(p.yaw, p.pitch);
    this.entities.spawnItem(p.x, p.y + p.eye - 0.3, p.z, stack, { vx: look[0] * 6, vy: look[1] * 6 + 2, vz: look[2] * 6, pickupDelay: 40, owner: p.id });
    void all;
  }

  // ---------- sleeping ----------
  wake(p) {
    if (!p.sleeping) return;
    p.sleeping = false; p.sleepTicks = 0;
    const bp = p.bedPos;
    if (bp) { const pos = this.besideBed(bp.x, bp.y, bp.z); this.teleport(p, pos.x, pos.y, pos.z); }
    p.send({ t: 'sleep', on: false });
  }

  checkSleep() {
    const list = this.activePlayers().filter((p) => p.alive && p.gamemode !== 'spectator');
    if (!list.length || !list.every((p) => p.sleeping)) return;
    if (!list.every((p) => p.sleepTicks >= 100)) return;
    const day = Math.floor(this.time / C.DAY_TICKS);
    this.time = (day + 1) * C.DAY_TICKS;
    if (this.weather !== 'clear') this.setWeather('clear', C.WEATHER_MIN_TICKS + Math.floor(Math.random() * C.WEATHER_MIN_TICKS));
    for (const p of list) this.wake(p);
    this.broadcastTime();
  }

  // ---------- eating ----------
  finishEating(p) {
    const u = p.using;
    p.using = null;
    const stack = u.hand === 'off' ? p.inv.offhand[0] : p.heldStack();
    if (!stack || stack.id !== u.id) return;
    const food = ITEMS[stack.id].food;
    if (!food) return;
    p.food = Math.min(C.MAX_FOOD, p.food + food.hunger);
    p.sat = Math.min(p.food, p.sat + food.sat);
    if (food.extinguish) p.fireTicks = 0;
    if (p.gamemode !== 'creative') {
      stack.count--;
      const empty = stack.count <= 0;
      if (empty) { if (u.hand === 'off') p.inv.offhand[0] = null; else p.setHeld(null); }
      if (food.returns) {
        const ret = { id: food.returns, count: 1 };
        if (empty) { if (u.hand === 'off') p.inv.offhand[0] = ret; else p.setHeld(ret); }
        else { const rest = addToInventory(p.inv, ret); if (rest) this.dropItem(p, rest); }
      }
    }
    this.sound(food.drink ? 'drink_done' : 'burp', p.x, p.y + 1.5, p.z, 0.6, 1);
    p.send({ t: 'useDone' });
    p.syncInventory();
    p.syncStatus();
  }

  // ---------- message handling ----------
  handle(p, m) {
    // rate limit
    const now = Date.now();
    if (!p.rateWindow || now - p.rateWindow > 1000) { p.rateWindow = now; p.rate.actions = 0; p.rate.chat = 0; }
    if (m.t !== 'move' && m.t !== 'chunks' && ++p.rate.actions > C.ACTION_RATE_PER_SEC) return;
    switch (m.t) {
      case 'move': return this.onMove(p, m);
      case 'chunks': return this.onChunks(p, m);
      case 'dig': return this.onDig(p, m);
      case 'use': return this.onUse(p, m);
      case 'useItem': return this.onUseItem(p, m);
      case 'stopUse': return this.onStopUse(p);
      case 'slot': {
        const i = m.i | 0;
        if (i >= 0 && i < 9 && i !== p.inv.selected) { p.inv.selected = i; p.using = null; p.digging = null; }
        return;
      }
      case 'win': return this.onWindow(p, m);
      case 'closeWin': if (!p.window || p.window.wid === m.wid || m.wid === 0) p.closeWindow(false); return;
      case 'creative': return this.onCreative(p, m);
      case 'drop': {
        if (!p.canInteract()) return;
        const h = p.heldStack();
        if (!h) return;
        const n = m.all ? h.count : 1;
        const st = { ...h, count: n };
        h.count -= n;
        if (h.count <= 0) p.setHeld(null);
        this.dropItem(p, st);
        p.syncInventory();
        return;
      }
      case 'swapHands': {
        if (!p.canInteract()) return;
        const h = p.heldStack();
        p.setHeld(p.inv.offhand[0]);
        p.inv.offhand[0] = h;
        p.syncInventory();
        return;
      }
      case 'attack': return this.onAttack(p, m);
      case 'interact': return this.onInteract(p, m);
      case 'trade': {
        const t = this.entityById(m.eid | 0);
        if (!p.canInteract() || !t || t.type !== 'villager' || t.dead || dist(p, t) > 6) return;
        const offer = (TRADES[t.prof] || TRADES.farmer)[m.i | 0];
        if (!offer) return;
        const [cost, n, res, rn] = offer;
        if (p.gamemode !== 'creative') { if (countItem(p.inv, cost) < n) return; removeItem(p.inv, cost, n); }
        const rest = addToInventory(p.inv, { id: res, count: rn });
        if (rest) this.dropItem(p, rest);
        this.sound('villager_yes', t.x, t.y + 1.5, t.z, 1, 1);
        p.syncInventory();
        return;
      }
      case 'swing': this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'swing' }); return;
      case 'chat': return this.onChat(p, m);
      case 'respawn': this.respawn(p); return;
      case 'hardcoreSpectate': {
        if (!p.hardcoreDead) return;
        p.alive = true; p.hp = C.MAX_HEALTH;
        p.setGamemode('spectator');
        p.syncStatus(true);
        return;
      }
      case 'pause': if (this.sp) this.paused = !!m.on; return;
      case 'pick': {
        if (p.gamemode !== 'creative' || !ITEMS[m.item]) return;
        const idx = p.inv.main.findIndex((s, i) => i < 9 && s && s.id === m.item);
        if (idx >= 0) p.inv.selected = idx;
        else {
          let slot = p.inv.main.findIndex((s, i) => i < 9 && !s);
          if (slot < 0) slot = p.inv.selected;
          p.inv.main[slot] = { id: m.item, count: maxStackOf(m.item) };
          p.inv.selected = slot;
        }
        p.syncInventory();
        return;
      }
      case 'spectate': {
        if (p.gamemode !== 'spectator') return;
        const t = [...this.players.values()].find((q) => q.name === m.name && q.joined);
        if (t) this.teleport(p, t.x, t.y, t.z);
        return;
      }
      case 'glide': {
        if (!m.on) { p.gliding = false; return; }
        const chest = p.inv.armor[1];
        const ok = p.alive && chest && chest.id === 'glider_wings' && (chest.dmg || 0) < C.GLIDER_DURABILITY - 1 && !p.inWater && !p.flying && p.gamemode !== 'spectator';
        if (ok) { p.gliding = true; p.glideTicks = 0; this.sound('glider_open', p.x, p.y + 1, p.z, 0.6, 1, p); }
        else p.send({ t: 'glide', on: false });
        return;
      }
      case 'crash': {
        const d = Math.min(40, Math.max(0, Number(m.dmg) || 0));
        if (d > 0 && p.gliding) this.damagePlayer(p, Math.round(d), 'crash', null);
        return;
      }
      case 'leaveBed': this.wake(p); return;
      case 'skin':
        p.skin = cleanSkin(m.skin);
        this.broadcastToKnown(p, { t: 'spawn', e: p.spawnData() });
        return;
      case 'settings': {
        const vd = m.viewDistance | 0;
        if (vd >= C.RENDER_DISTANCE_MIN && vd <= C.RENDER_DISTANCE_MAX) p.viewDistance = vd;
        return;
      }
      default:
    }
  }

  onChunks(p, m) {
    const req = Array.isArray(m.req) ? m.req.slice(0, 256) : [];
    for (let i = 0; i + 1 < req.length; i += 2) {
      const cx = req[i] | 0, cz = req[i + 1] | 0;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      if (Math.abs(cx - pcx) > p.viewDistance + 3 || Math.abs(cz - pcz) > p.viewDistance + 3) {
        p.send({ t: 'chunk', cx, cz, m: [], far: 1 });
        continue;
      }
      p.send({ t: 'chunk', cx, cz, m: this.world.modsOf(cx, cz) });
    }
  }

  onMove(p, m) {
    if (!p.joined) return;
    if ((m.tid | 0) !== p.tid) return; // stale packet from before a teleport
    const yaw = Number(m.yaw), pitch = Number(m.pitch);
    if (Number.isFinite(yaw)) p.yaw = yaw;
    if (Number.isFinite(pitch)) p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    if (!p.alive || p.sleeping) return;
    const x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (![x, y, z].every(Number.isFinite)) return;
    const f = m.f | 0;
    const spectator = p.gamemode === 'spectator';
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    const h = Math.hypot(dx, dz);
    let reject = false;
    if (h > p.moveBudget + 0.3) reject = true;
    { const [bx, bz] = clampToBorder(x, z); if (bx !== x || bz !== z) reject = true; }
    if (!reject && Math.abs(dy) > 10 && !spectator) reject = true;
    // pose
    let pose = 'stand';
    if (f & FLAG.GLIDE && p.gliding) pose = 'glide';
    else if (f & FLAG.SWIM) pose = 'swim';
    else if (f & FLAG.SNEAK && !p.flying) pose = 'sneak';
    const [w, hh] = pose === 'sneak' ? [C.PLAYER_WIDTH, C.SNEAK_HEIGHT] : (pose === 'glide' || pose === 'swim') ? [C.PLAYER_WIDTH, C.SMALL_HEIGHT] : [C.PLAYER_WIDTH, C.PLAYER_HEIGHT];
    if (!reject && !spectator && this.world.hasChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) {
      if (boxCollides(this.world, x, y + 0.02, z, w - 0.08, hh - 0.08)) {
        // allow if the previous position also collided (e.g. block placed on player)
        if (!boxCollides(this.world, p.x, p.y + 0.02, p.z, w - 0.08, hh - 0.08)) reject = true;
      }
    }
    // flight check for survival
    const flyingAllowed = p.gamemode === 'creative' || spectator;
    if (f & FLAG.FLY && !flyingAllowed) { p.flying = false; p.send({ t: 'mode', gamemode: p.gamemode, flying: false }); }
    else p.flying = !!(f & FLAG.FLY) && flyingAllowed;
    const fsx = fluidState(this.world, { x, y, z, w, h: hh, eye: hh * 0.9 }, {});
    const onGround = !!(f & FLAG.GROUND) && boxCollides(this.world, x, y - 0.08, z, w - 0.02, 0.1);
    if (!reject && !flyingAllowed && !p.gliding && !fsx.water && !fsx.lava && !fsx.ladder) {
      if (onGround) p.lastGroundY = y;
      else if (y > p.lastGroundY + 1.6 + p.kbAllowance) reject = true;
    } else if (fsx.water || fsx.ladder || p.gliding || flyingAllowed) p.lastGroundY = Math.max(p.lastGroundY, y);
    if (reject) {
      p.send({ t: 'pos', x: p.x, y: p.y, z: p.z, tid: p.tid });
      p.moveBudget = Math.max(p.moveBudget, 1);
      return;
    }
    p.moveBudget = Math.max(0, p.moveBudget - h);
    // fall damage (server-side)
    if (fsx.water || fsx.ladder || p.flying || spectator) p.fallDist = 0;
    else if (p.gliding) { if (dy > -0.5) p.fallDist = Math.min(p.fallDist, 1); else p.fallDist -= dy; }
    else if (dy < 0) p.fallDist -= dy;
    if (onGround) {
      if (p.fallDist > C.SAFE_FALL && p.gamemode === 'survival') {
        const dmg = Math.ceil(p.fallDist - C.SAFE_FALL - 1e-4);
        if (dmg > 0) {
          this.damagePlayer(p, dmg, 'fall', null);
          this.sound(dmg > 4 ? 'fall_big' : 'fall_small', x, y, z, 1, 1);
        }
      }
      p.fallDist = 0;
      if (p.gliding) p.gliding = false;
    }
    // exhaustion
    if (p.gamemode === 'survival') {
      if (f & FLAG.SPRINT && !fsx.water) p.addExhaustion(h * C.EXH_SPRINT_PER_M);
      if (fsx.water) p.addExhaustion(h * C.EXH_SWIM_PER_M);
      if (f & FLAG.JUMP) p.addExhaustion(f & FLAG.SPRINT ? C.EXH_SPRINT_JUMP : C.EXH_JUMP);
    }
    p.x = x; p.y = y; p.z = z;
    p.vx = Number(m.vx) || 0; p.vy = Number(m.vy) || 0; p.vz = Number(m.vz) || 0;
    p.onGround = onGround;
    p.pose = pose;
    p.sprinting = !!(f & FLAG.SPRINT);
    if (!(f & FLAG.GLIDE) && p.gliding) p.gliding = false;
    p.w = w; p.h = hh; p.eye = pose === 'sneak' ? C.SNEAK_EYE : (pose === 'glide' || pose === 'swim') ? C.SMALL_EYE : C.PLAYER_EYE;
  }

  reachOk(p, x, y, z, extra = 1) {
    const reach = (p.gamemode === 'creative' ? C.REACH_CREATIVE : C.REACH_SURVIVAL) + extra;
    const ex = p.x, ey = p.y + p.eye, ez = p.z;
    return Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez) <= reach + 0.9;
  }

  resendBlock(p, x, y, z) {
    p.send({ t: 'blocks', b: [x, y, z, this.world.getBlock(x, y, z), this.world.getMeta(x, y, z)] });
  }

  onDig(p, m) {
    const x = m.x | 0, y = m.y | 0, z = m.z | 0;
    if (!p.canInteract() || !this.reachOk(p, x, y, z)) { if (m.p === 'finish') this.resendBlock(p, x, y, z); return; }
    const id = this.world.getBlock(x, y, z);
    if (m.p === 'start') {
      p.digging = { x, y, z, id, tick: this.tickCount };
      if (p.gamemode !== 'creative') {
        const ticks = breakTicks(id, p.heldStack(), { headInWater: false, airborne: false });
        this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'dig', x, y, z, dur: Number.isFinite(ticks) ? ticks : 0 });
      }
      // punching hurts on cactus? no; but hitting a block extinguishes nothing.
      return;
    }
    if (m.p === 'abort') {
      p.digging = null;
      this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'digstop' });
      return;
    }
    if (m.p !== 'finish') return;
    if (id === 0 || IS_FLUID[id]) return;
    const b = BLOCKS[id];
    const creative = p.gamemode === 'creative';
    const held = p.heldStack();
    if (creative) {
      if (held && ITEMS[held.id] && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') { this.resendBlock(p, x, y, z); return; }
    } else {
      if (b.hardness < 0) { this.resendBlock(p, x, y, z); return; }
      const d = p.digging;
      const need = breakTicks(id, held, { headInWater: false, airborne: false });
      // client accounts for water/airborne slowdowns; server uses the most permissive estimate
      const minTicks = Math.floor(need * C.BREAK_TIME_TOLERANCE) - 2;
      if (need > 0 && (!d || d.x !== x || d.y !== y || d.z !== z || this.tickCount - d.tick < minTicks)) { this.resendBlock(p, x, y, z); return; }
    }
    p.digging = null;
    this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'digstop' });
    const harvest = !creative && canHarvest(id, held);
    const tool = toolOf(held);
    this.world.breakBlock(x, y, z, p, harvest, { rng: this.world.rng, tool: tool ? tool.type : null, tier: tool ? tool.tier : -1 });
    if (!creative) {
      p.addExhaustion(C.EXH_MINE);
      if (harvest && b.score) p.addScore(b.score);
      if (held && ITEMS[held.id].durability && b.hardness > 0) this.damageHeld(p, ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword' ? 2 : 1);
    }
  }

  damageHeld(p, n) {
    const held = p.heldStack();
    if (!held || p.gamemode === 'creative') return;
    const it = ITEMS[held.id];
    if (!it.durability) return;
    held.dmg = (held.dmg || 0) + n;
    if (held.dmg >= it.durability) {
      p.setHeld(null);
      this.sound('item_break', p.x, p.y + 1, p.z, 0.8, 1);
    }
    p.syncInventory();
  }

  consumeHeld(p, n = 1) {
    if (p.gamemode === 'creative') return;
    const held = p.heldStack();
    if (!held) return;
    held.count -= n;
    if (held.count <= 0) p.setHeld(null);
  }

  placeFacing(p) {
    // horizontal facing pointing back toward the player
    const yaw = p.yaw;
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    let f;
    if (Math.abs(lx) > Math.abs(lz)) f = lx > 0 ? 1 : 3; else f = lz > 0 ? 2 : 0;
    return f;
  }

  onUse(p, m) {
    const x = m.x | 0, y = m.y | 0, z = m.z | 0, face = m.face | 0;
    if (!p.canInteract() || face < 0 || face > 5 || !this.reachOk(p, x, y, z)) { this.resendBlock(p, x, y, z); return; }
    const world = this.world;
    const id = world.getBlock(x, y, z), meta = world.getMeta(x, y, z);
    const b = BLOCKS[id];
    const held = p.heldStack();
    const sneaking = p.pose === 'sneak';
    // --- block interactions ---
    if (b.interact && !(sneaking && held)) {
      switch (b.interact) {
        case 'crafting':
          p.openWindow('crafting', { grid: new Array(9).fill(null), result: [null], type: 'crafting' }, { x, y, z }, 'Crafting');
          return;
        case 'furnace':
          p.openWindow('furnace', this.containers.get(x, y, z, 'furnace'), { x, y, z }, 'Furnace');
          return;
        case 'chest':
          p.openWindow('chest', this.containers.get(x, y, z, 'chest'), { x, y, z }, 'Chest');
          this.sound('chest_open', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
          return;
        case 'door': {
          const lower = meta & 8 ? y - 1 : y;
          const lm = world.getMeta(x, lower, z);
          const nm = lm ^ 4;
          world.setBlock(x, lower, z, ID.door, nm, { noUpdate: true });
          if (world.getBlock(x, lower + 1, z) === ID.door) world.setBlock(x, lower + 1, z, ID.door, (nm & 7) | 8, { noUpdate: true });
          this.sound(nm & 4 ? 'door_open' : 'door_close', x + 0.5, y + 0.5, z + 0.5, 0.8, 1);
          return;
        }
        case 'bed': return this.useBed(p, x, y, z, meta);
        default:
      }
    }
    // --- item use on block ---
    const it = held ? ITEMS[held.id] : null;
    if (it) {
      if (it.use === 'till' && (id === ID.grass || id === ID.dirt) && face !== 3 && world.getBlock(x, y + 1, z) === 0) {
        world.setBlock(x, y, z, ID.farmland, 0);
        this.sound('step:dirt', x + 0.5, y + 1, z + 0.5, 1, 1);
        this.damageHeld(p, 1);
        return;
      }
      if (it.use === 'bonemeal') return this.useBoneMeal(p, x, y, z, id);
      if (it.use === 'eye' && id === ID.end_portal_frame) {
        if (world.getMeta(x, y, z) & 1) return;
        world.setBlock(x, y, z, ID.end_portal_frame, 1, { noUpdate: true });
        this.consumeHeld(p); p.syncInventory();
        this.sound('portal_light', x + 0.5, y + 1, z + 0.5, 1, 1.5);
        for (const s of strongholds(this.seed)) {
          const cells = frameCells(s);
          if (!cells.some(([fx, fz]) => fx === x && fz === z)) continue;
          if (cells.every(([fx, fz]) => world.getBlock(fx, ROOM_Y + 1, fz) === ID.end_portal_frame && (world.getMeta(fx, ROOM_Y + 1, fz) & 1))) {
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) world.setBlock(s.x + dx, ROOM_Y + 1, s.z + dz, ID.end_portal, 0, { noUpdate: true });
            this.broadcastNear(x, y, z, { t: 'chat', text: 'The End Portal has opened.', color: 'aqua' }, 64);
            this.sound('portal_travel', s.x + 0.5, ROOM_Y + 2, s.z + 0.5, 1.5, 0.7);
          }
        }
        return;
      }
      if (it.use === 'ignite') {
        const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
        if (tryLightPortal(world, x + n[0], y + n[1], z + n[2])) {
          this.sound('portal_light', x + 0.5, y + 1, z + 0.5, 1, 1);
          this.damageHeld(p, 1);
        } else this.sound('click', x + 0.5, y + 1, z + 0.5, 0.5, 1.5);
        return;
      }
      if (it.use === 'bucket') return this.useBucket(p, m.target || { x, y, z, face });
      if (it.use === 'firework') {
        if (p.gliding) return this.onUseItem(p, {});
        const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
        this.entities.spawnFirework(x + 0.5 + n[0] * 0.6, y + 0.5 + n[1] * 0.6, z + 0.5 + n[2] * 0.6);
        this.sound('firework_launch', x + 0.5, y + 1, z + 0.5, 1, 1);
        this.consumeHeld(p); p.syncInventory();
        return;
      }
    }
    if (!it || !it.block) {
      if (it && (it.food || it.use === 'bow' || it.use === 'throw' || it.armor)) this.onUseItem(p, {});
      return;
    }
    return this.placeBlock(p, x, y, z, face, it, m);
  }

  placeBlock(p, x, y, z, face, it, m) {
    const world = this.world;
    const targetId = world.getBlock(x, y, z);
    const blockDef = BLOCKS[ID[it.block]];
    let px = x, py = y, pz = z;
    if (!(BLOCKS[targetId].replaceable && targetId !== blockDef.id)) {
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
      px += n[0]; py += n[1]; pz += n[2];
    }
    const fail = () => { this.resendBlock(p, px, py, pz); this.resendBlock(p, x, y, z); p.syncInventory(); };
    if (py < 0 || py >= C.WORLD_HEIGHT || !this.reachOk(p, px, py, pz, 1.5)) return fail();
    const cur = world.getBlock(px, py, pz);
    if (cur !== 0 && !BLOCKS[cur].replaceable) return fail();
    if (cur === blockDef.id) return fail();
    let meta = 0;
    const id = blockDef.id;
    const f = this.placeFacing(p);
    const faceToFacing = { 0: 1, 1: 3, 4: 2, 5: 0 };
    switch (blockDef.name) {
      case 'torch':
        if (face === 3) return fail();
        if (face === 2) { if (!IS_SOLID[world.getBlock(px, py - 1, pz)]) return fail(); meta = 0; }
        else { meta = faceToFacing[face] + 1; if (!IS_FULL[world.getBlock(x, y, z)]) return fail(); }
        break;
      case 'ladder':
        if (face === 2 || face === 3) return fail();
        if (!IS_FULL[world.getBlock(x, y, z)]) return fail();
        meta = faceToFacing[face];
        break;
      case 'furnace': case 'chest': case 'crafting_table':
        meta = (f + 2) & 3; // front faces the player
        break;
      case 'door': {
        if (!IS_SOLID[world.getBlock(px, py - 1, pz)]) return fail();
        const above = world.getBlock(px, py + 1, pz);
        if (above !== 0 && !BLOCKS[above].replaceable) return fail();
        meta = (f + 2) & 3;
        break;
      }
      case 'bed': {
        const [dx, dz] = FACING_VEC[f];
        const hx = px + dx, hz = pz + dz;
        const hc = world.getBlock(hx, py, hz);
        if ((hc !== 0 && !BLOCKS[hc].replaceable) || !IS_SOLID[world.getBlock(px, py - 1, pz)] || !IS_SOLID[world.getBlock(hx, py - 1, hz)]) return fail();
        meta = f; // foot -> head direction = player look direction
        break;
      }
      case 'leaves': case 'spruce_leaves': meta = 4; break;
      case 'cactus':
        if (!canSurviveOn(id, world.getBlock(px, py - 1, pz))) return fail();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (IS_SOLID[world.getBlock(px + dx, py, pz + dz)]) return fail();
        break;
      case 'sugar_cane': {
        const below = world.getBlock(px, py - 1, pz);
        if (below !== ID.sugar_cane) {
          if (!canSurviveOn(id, below)) return fail();
          let water = false;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (IS_FLUID[world.getBlock(px + dx, py - 1, pz + dz)] === 1) water = true;
          if (!water) return fail();
        }
        break;
      }
      default:
        if (blockDef.needsSupport && !canSurviveOn(id, world.getBlock(px, py - 1, pz), 0)) return fail();
    }
    // entity collision for solid blocks
    if (blockDef.solid) {
      const boxes = [[px, py, pz, px + 1, py + (blockDef.name === 'door' ? 2 : 1), pz + 1]];
      const hits = (e) => {
        const hw = e.w / 2;
        return boxes.some((bb) => e.x + hw > bb[0] + 0.001 && e.x - hw < bb[3] - 0.001 && e.y + e.h > bb[1] + 0.001 && e.y < bb[4] - 0.001 && e.z + hw > bb[2] + 0.001 && e.z - hw < bb[5] - 0.001);
      };
      for (const q of this.players.values()) if (q.joined && q.alive && q.gamemode !== 'spectator' && hits(q)) return fail();
      for (const e of this.entities.list.values()) if (e instanceof Mob && !e.dead && hits(e)) return fail();
    }
    if (blockDef.name === 'door') {
      // place both halves before neighbor updates so neither half fails its support check
      world.setBlock(px, py, pz, id, meta, { noUpdate: true });
      world.setBlock(px, py + 1, pz, ID.door, meta | 8, { noUpdate: true });
      world.updateNeighbors(px, py, pz); world.updateNeighbors(px, py + 1, pz);
    } else if (blockDef.name === 'bed') {
      const [dx, dz] = FACING_VEC[meta & 3];
      world.setBlock(px, py, pz, id, meta, { noUpdate: true });
      world.setBlock(px + dx, py, pz + dz, ID.bed, meta | 4, { noUpdate: true });
      world.updateNeighbors(px, py, pz); world.updateNeighbors(px + dx, py, pz + dz);
    } else world.setBlock(px, py, pz, id, meta);
    this.sound('place:' + blockDef.sound, px + 0.5, py + 0.5, pz + 0.5, 1, 0.8, p);
    this.consumeHeld(p);
    p.syncInventory();
    void m;
  }

  useBed(p, x, y, z, meta) {
    // locate head block
    let hx = x, hz = z;
    if (!(meta & 4)) { const [dx, dz] = FACING_VEC[meta & 3]; hx += dx; hz += dz; }
    p.spawnPoint = { x: hx, y, z: hz };
    const t = this.time % C.DAY_TICKS;
    if (!C.isNight(t) && this.weather !== 'thunder') {
      p.send({ t: 'chat', text: 'Respawn point set. You can only sleep at night or during thunderstorms.', color: 'gray' });
      return;
    }
    for (const mob of this.entities.mobs()) {
      if (mob.def.hostile && !mob.dead && Math.abs(mob.x - x) < 8 && Math.abs(mob.y - y) < 5 && Math.abs(mob.z - z) < 8) {
        p.send({ t: 'chat', text: 'You may not rest now; there are monsters nearby', color: 'gray' });
        return;
      }
    }
    p.sleeping = true; p.sleepTicks = 0; p.bedPos = { x: hx, y, z: hz };
    p.x = hx + 0.5; p.y = y + 0.5625; p.z = hz + 0.5;
    p.send({ t: 'sleep', on: true, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-FACING_VEC[meta & 3][0], -FACING_VEC[meta & 3][1]) });
    p.send({ t: 'chat', text: 'Respawn point set', color: 'gray' });
  }

  useBoneMeal(p, x, y, z, id) {
    const world = this.world;
    let used = false;
    if (id === ID.wheat) {
      const m = world.getMeta(x, y, z);
      if (m < 7) { world.setBlock(x, y, z, ID.wheat, Math.min(7, m + 2 + Math.floor(world.rng() * 4))); used = true; }
    } else if (id === ID.oak_sapling || id === ID.spruce_sapling) {
      used = true;
      if (world.rng() < 0.45) world.growTree(x, y, z, id === ID.oak_sapling ? 'oak' : 'spruce');
    } else if (id === ID.grass && world.getBlock(x, y + 1, z) === 0) {
      used = true;
      for (let i = 0; i < 24; i++) {
        const tx = x + Math.floor(world.rng() * 7) - 3, tz = z + Math.floor(world.rng() * 7) - 3;
        if (world.getBlock(tx, y, tz) === ID.grass && world.getBlock(tx, y + 1, tz) === 0) {
          const r = world.rng();
          world.setBlock(tx, y + 1, tz, r < 0.8 ? ID.tall_grass : r < 0.9 ? ID.poppy : ID.dandelion, 0);
        }
      }
    } else if (id === ID.sugar_cane || id === ID.cactus) {
      let top = y; while (world.getBlock(x, top + 1, z) === id) top++;
      let bottom = y; while (world.getBlock(x, bottom - 1, z) === id) bottom--;
      if (top - bottom + 1 < 3 && world.getBlock(x, top + 1, z) === 0) { world.setBlock(x, top + 1, z, id, 0); used = true; }
    }
    if (used) {
      this.broadcastNear(x, y, z, { t: 'fx', k: 'bonemeal', x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 48);
      this.consumeHeld(p);
      p.syncInventory();
    }
  }

  useBucket(p, target) {
    const world = this.world;
    const held = p.heldStack();
    if (!held || !target) return;
    const tx = target.x | 0, ty = target.y | 0, tz = target.z | 0, face = target.face | 0;
    if (!this.reachOk(p, tx, ty, tz)) return;
    const tid = world.getBlock(tx, ty, tz);
    if (held.id === 'bucket') {
      if (!IS_FLUID[tid] || world.getMeta(tx, ty, tz) !== 0) return;
      const filled = IS_FLUID[tid] === 1 ? 'water_bucket' : 'lava_bucket';
      world.setBlock(tx, ty, tz, 0, 0);
      this.sound(IS_FLUID[tid] === 1 ? 'bucket_fill' : 'bucket_fill_lava', tx + 0.5, ty + 0.5, tz + 0.5, 1, 1);
      if (p.gamemode !== 'creative') {
        if (held.count === 1) p.setHeld({ id: filled, count: 1 });
        else { held.count--; const rest = addToInventory(p.inv, { id: filled, count: 1 }); if (rest) this.dropItem(p, rest); }
      }
      p.syncInventory();
      return;
    }
    const fluid = held.id === 'water_bucket' ? ID.water : ID.lava;
    let px = tx, py = ty, pz = tz;
    const tb = BLOCKS[tid];
    if (!(tid === 0 || tb.replaceable)) {
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
      px += n[0]; py += n[1]; pz += n[2];
    }
    const cur = world.getBlock(px, py, pz);
    if (cur !== 0 && !BLOCKS[cur].replaceable) { this.resendBlock(p, px, py, pz); return; }
    if (cur === fluid && world.getMeta(px, py, pz) === 0) return;
    if (cur !== 0 && !IS_FLUID[cur]) world.destroyForFluid(px, py, pz, cur);
    world.setBlock(px, py, pz, fluid, 0);
    this.sound(fluid === ID.water ? 'bucket_empty' : 'bucket_empty_lava', px + 0.5, py + 0.5, pz + 0.5, 1, 1);
    if (p.gamemode !== 'creative') p.setHeld({ id: 'bucket', count: 1 });
    p.syncInventory();
  }

  onUseItem(p, m) {
    if (!p.canInteract()) return;
    const held = p.heldStack();
    const off = p.inv.offhand[0];
    let stack = held, hand = 'main';
    let it = stack ? ITEMS[stack.id] : null;
    const usable = (s) => { const i = s && ITEMS[s.id]; return i && (i.food || i.use === 'bow' || i.use === 'throw' || i.use === 'firework' || i.use === 'bucket' || i.armor); };
    if (!usable(held) && usable(off)) { stack = off; hand = 'off'; it = ITEMS[off.id]; }
    if (!it) return;
    if (it.use === 'bucket') { if (hand === 'main') return this.useBucket(p, m.target); return; }
    if (it.food) {
      if (p.food >= C.MAX_FOOD && !it.food.drink && p.gamemode !== 'creative') return;
      p.using = { kind: 'eat', id: stack.id, ticks: 0, hand };
      return;
    }
    if (it.use === 'bow') {
      if (p.gamemode !== 'creative' && !p.inv.main.some((s) => s && s.id === 'arrow') && !(p.inv.offhand[0] && p.inv.offhand[0].id === 'arrow')) return;
      p.using = { kind: 'bow', id: stack.id, ticks: 0, hand };
      return;
    }
    if (it.use === 'eye') {
      let best = null, bd = Infinity;
      for (const s of strongholds(this.seed)) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
      if (!best || dimensionAt(p.x, p.z) !== 'overworld') return;
      this.entities.spawnEyeSignal(p, best.x + 0.5, best.z + 0.5);
      this.sound('throw', p.x, p.y + 1.5, p.z, 0.5, 0.5);
      if (p.gamemode !== 'creative') { stack.count--; if (!stack.count) { if (hand === 'off') p.inv.offhand[0] = null; else p.setHeld(null); } }
      p.syncInventory();
      return;
    }
    if (it.use === 'pearl') {
      const look = lookVector(p.yaw, p.pitch);
      this.entities.spawnEgg(p, p.x + look[0] * 0.4, p.y + p.eye - 0.1, p.z + look[2] * 0.4, look[0] * 30 + p.vx, look[1] * 30 + 2, look[2] * 30 + p.vz, 'pearl');
      this.sound('throw', p.x, p.y + 1.5, p.z, 0.5, 0.5);
      if (p.gamemode !== 'creative') { stack.count--; if (!stack.count) { if (hand === 'off') p.inv.offhand[0] = null; else p.setHeld(null); } }
      p.syncInventory();
      return;
    }
    if (it.use === 'throw') {
      const look = lookVector(p.yaw, p.pitch);
      this.entities.spawnEgg(p, p.x + look[0] * 0.4, p.y + p.eye - 0.1, p.z + look[2] * 0.4, look[0] * 30 + p.vx, look[1] * 30 + 2, look[2] * 30 + p.vz);
      this.sound('throw', p.x, p.y + 1.5, p.z, 0.5, 0.6);
      if (p.gamemode !== 'creative') { stack.count--; if (!stack.count) { if (hand === 'off') p.inv.offhand[0] = null; else p.setHeld(null); } }
      p.syncInventory();
      return;
    }
    if (it.use === 'firework') {
      if (!p.gliding) return;
      p.send({ t: 'boost' });
      p.kbAllowance += 40;
      this.sound('firework_launch', p.x, p.y + 1, p.z, 1, 1);
      this.broadcastToKnown(p, { t: 'ev', id: p.id, k: 'boost' });
      if (p.gamemode !== 'creative') { stack.count--; if (!stack.count) { if (hand === 'off') p.inv.offhand[0] = null; else p.setHeld(null); } }
      p.syncInventory();
      return;
    }
    if (it.armor && hand === 'main') {
      const slot = it.armor.slot;
      const cur = p.inv.armor[slot];
      p.inv.armor[slot] = held;
      p.setHeld(cur);
      this.sound('equip', p.x, p.y + 1, p.z, 0.6, 1);
      p.syncInventory();
    }
  }

  onStopUse(p) {
    const u = p.using;
    if (!u) return;
    p.using = null;
    if (u.kind !== 'bow') return;
    let f = u.ticks / C.BOW_DRAW_TICKS;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const creative = p.gamemode === 'creative';
    if (!creative) {
      let idx = p.inv.main.findIndex((s) => s && s.id === 'arrow');
      if (idx < 0 && p.inv.offhand[0] && p.inv.offhand[0].id === 'arrow') { p.inv.offhand[0].count--; if (!p.inv.offhand[0].count) p.inv.offhand[0] = null; }
      else if (idx >= 0) { p.inv.main[idx].count--; if (!p.inv.main[idx].count) p.inv.main[idx] = null; }
      else return;
    }
    const look = lookVector(p.yaw, p.pitch);
    const speed = f * 50;
    let dmg = Math.ceil(f * 3 * 2);
    if (f >= 1) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
    this.entities.spawnArrow(p, p.x + look[0] * 0.5, p.y + p.eye - 0.1, p.z + look[2] * 0.5, look[0] * speed, look[1] * speed, look[2] * speed, dmg, !creative);
    this.sound('bow_shoot', p.x, p.y + 1.5, p.z, 1, 1 / (Math.random() * 0.4 + 1.2) + f * 0.5);
    this.damageHeld(p, 1);
    p.syncInventory();
  }

  onWindow(p, m) {
    if (!p.alive) return;
    const win = p.activeWindow();
    if ((m.wid | 0) !== win.wid) { p.syncInventory(); return; }
    const state = { cursor: p.cursor, creative: p.gamemode === 'creative' };
    const act = { a: m.a, slot: m.slot, button: m.button, shift: !!m.shift, slots: m.slots, hotbar: m.hotbar, all: !!m.all };
    const res = applyAction(win, state, act);
    p.cursor = state.cursor;
    for (const d of res.drops) this.dropItem(p, d);
    p.syncInventory();
    if (win.container && win.container.viewers) this.containers.notify(win.container, null);
  }

  onCreative(p, m) {
    if (p.gamemode !== 'creative') { p.syncInventory(); return; }
    const parse = (v) => {
      if (!v) return null;
      const [st] = unpackStacks([v]);
      if (st) st.count = Math.max(1, Math.min(maxStackOf(st.id), st.count | 0));
      return st;
    };
    switch (m.act) {
      case 'cursor': p.cursor = parse(m.item); break;
      case 'trash': p.cursor = null; break;
      case 'clear':
        for (const arr of [p.inv.main, p.inv.armor, p.inv.offhand]) arr.fill(null);
        p.cursor = null;
        break;
      case 'set': {
        const i = m.i | 0;
        const st = parse(m.item);
        if (m.area === 'main' && i >= 0 && i < 36) p.inv.main[i] = st;
        else if (m.area === 'armor' && i >= 0 && i < 4) p.inv.armor[i] = st;
        else if (m.area === 'offhand') p.inv.offhand[0] = st;
        break;
      }
      default:
    }
    p.syncInventory();
  }

  onAttack(p, m) {
    if (!p.canInteract()) return;
    const t = this.entityById(m.eid | 0);
    if (!t || t === p || t.removed) return;
    if (t.type === 'player') {
      if (!this.config.pvp || !t.alive || t.gamemode === 'spectator' || t.gamemode === 'creative') return;
    } else if (!(t instanceof Mob) || t.dead) {
      if (t.type === 'item' || t.type === 'arrow') return;
      return;
    }
    // reach: eye to nearest point of target box
    const ex = p.x, ey = p.y + p.eye, ez = p.z;
    const hw = t.w / 2;
    const cx = Math.max(t.x - hw, Math.min(ex, t.x + hw)), cy = Math.max(t.y, Math.min(ey, t.y + t.h)), cz = Math.max(t.z - hw, Math.min(ez, t.z + hw));
    if (Math.hypot(cx - ex, cy - ey, cz - ez) > C.ATTACK_REACH + (p.gamemode === 'creative' ? 2 : 1)) return;
    const held = p.heldStack();
    const tool = toolOf(held);
    const base = tool ? tool.damage : HAND_DAMAGE;
    const aspd = tool ? tool.attackSpeed : HAND_ATTACK_SPEED;
    const cooldownTicks = 20 / aspd;
    const charge = Math.min(1, (this.tickCount - p.lastAttackTick + 0.5) / cooldownTicks);
    p.lastAttackTick = this.tickCount;
    let dmg = base * (0.2 + charge * charge * 0.8);
    const crit = charge > 0.9 && p.vy < 0 && !p.onGround && !p.inWater && !p.onLadder;
    if (crit) dmg *= C.CRIT_MULT;
    dmg = Math.round(dmg * 2) / 2;
    const kb = (p.sprinting && charge > 0.9 ? 1.6 : 1) * (0.5 + charge * 0.5);
    const look = lookVector(p.yaw, 0);
    const hit = this.damageEntity(t, Math.max(0.5, dmg), t.type === 'player' ? 'player' : 'player_attack', p, look[0], look[2], kb);
    if (hit !== false) {
      if (crit) this.broadcastNear(t.x, t.y, t.z, { t: 'fx', k: 'crit', x: t.x, y: t.y + t.h * 0.6, z: t.z }, 48);
      this.sound(crit ? 'attack_crit' : charge > 0.9 ? 'attack_strong' : 'attack_weak', t.x, t.y + 1, t.z, 0.7, 1);
      p.addExhaustion(C.EXH_ATTACK);
      if (held && ITEMS[held.id].durability) this.damageHeld(p, tool && tool.type === 'sword' ? 1 : 2);
    }
    if (p.sprinting && charge > 0.9) p.sprinting = false;
  }

  onInteract(p, m) {
    if (!p.canInteract()) return;
    const t = this.entityById(m.eid | 0);
    if (!t || !(t instanceof Mob) || dist(p, t) > 6) return;
    const held = p.heldStack();
    const r = t.interact(p, held);
    if (r === 'trade') {
      p.send({ t: 'trades', eid: t.id, prof: t.prof || 'farmer', offers: TRADES[t.prof] || TRADES.farmer });
      this.sound('villager_idle', t.x, t.y + 1.5, t.z, 1, 1);
      return;
    }
    if (r === 'milk') {
      this.sound('milk', t.x, t.y + 1, t.z, 1, 1);
      if (p.gamemode !== 'creative') {
        if (held.count === 1) p.setHeld({ id: 'milk_bucket', count: 1 });
        else { held.count--; const rest = addToInventory(p.inv, { id: 'milk_bucket', count: 1 }); if (rest) this.dropItem(p, rest); }
      } else {
        const rest = addToInventory(p.inv, { id: 'milk_bucket', count: 1 }); void rest;
      }
      p.syncInventory();
    } else if (r === 'sheared') {
      this.damageHeld(p, 1);
    }
  }

  onChat(p, m) {
    let text = String(m.text || '').slice(0, C.MAX_CHAT_LENGTH).replace(/[\u0000-\u001f]/g, '').trim();
    if (!text) return;
    if (++p.rate.chat > C.CHAT_RATE_PER_SEC) { p.send({ t: 'chat', text: 'You are sending messages too quickly', color: 'red' }); return; }
    if (text.startsWith('/')) {
      this.log(`${p.name} issued command: ${text}`);
      runCommand(this, p, text, (msg, color) => p.send({ t: 'chat', text: msg, color: color || 'gray' }));
      return;
    }
    this.chat(`<${p.name}> ${text}`, 'white');
  }
}
