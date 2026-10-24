// Server-side player state: survival stats, inventory, windows and per-tick status effects.
import * as C from '../../shared/constants.js';
import { newPlayerInventory, packInventory, unpackInventoryInto, armorPoints, packStacks, buildWindow, addToInventory } from '../../shared/inventory.js';
import { fluidState, poseSize } from '../../shared/physics.js';
import { BLOCKS, ID } from '../../shared/blocks.js';
import { ITEMS } from '../../shared/items.js';
import { portalDestination } from './portals.js';
import { FLAG } from '../../shared/protocol.js';

const fsTmp = {};

export class ServerPlayer {
  constructor(server, id, name, conn) {
    this.server = server;
    this.id = id; this.type = 'player'; this.name = name; this.conn = conn;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.headYaw = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = C.PLAYER_WIDTH; this.h = C.PLAYER_HEIGHT; this.eye = C.PLAYER_EYE;
    this.onGround = false; this.pose = 'stand'; this.flags = 0;
    this.hp = C.MAX_HEALTH; this.food = C.MAX_FOOD; this.sat = 5; this.exhaustion = 0; this.air = C.MAX_AIR_TICKS;
    this.fireTicks = 0; this.alive = true; this.hardcoreDead = false;
    this.gamemode = 'survival';
    this.flying = false; this.gliding = false; this.sleeping = false; this.sleepTicks = 0;
    this.inv = newPlayerInventory();
    this.cursor = null;
    this.window = null; this.nextWid = 1;
    this.spawnPoint = null; // bed position {x,y,z}
    this.score = 0;
    this.hurtTime = 0; this.lastDamage = 0;
    this.regenTimer = 0; this.starveTimer = 0;
    this.digging = null; this.using = null;
    this.lastAttackTick = -1000; this.attackSpeed = 4;
    this.viewDistance = C.RENDER_DISTANCE_DEFAULT;
    this.ping = 0; this.op = false;
    this.moveBudget = 2; this.lastGroundY = 0; this.fallDist = 0; this.kbAllowance = 0;
    this.tid = 0; // teleport id
    this.known = new Set();
    this.joined = false;
    this.lastStatus = '';
    this.lastEquip = '';
    this.paused = false;
    this.boostTicks = 0;
    this.glideTicks = 0;
    this.deathCause = '';
    this.rate = { chat: 0, actions: 0 };
    this.lastPos = null;
  }

  send(msg) { if (this.conn) this.conn.send(msg); }

  isCreative() { return this.gamemode === 'creative'; }
  isSurvivalLike() { return this.gamemode === 'survival'; }
  canInteract() { return this.alive && this.gamemode !== 'spectator' && !this.sleeping; }

  heldStack() { return this.inv.main[this.inv.selected] || null; }
  setHeld(stack) { this.inv.main[this.inv.selected] = stack && stack.count > 0 ? stack : null; }

  addScore(n) { this.score += n; }

  // Called when the player changes gamemode.
  setGamemode(mode) {
    this.gamemode = mode;
    if (mode !== 'creative' && mode !== 'spectator') this.flying = false;
    if (mode === 'spectator') { this.flying = true; this.gliding = false; this.closeWindow(false); }
    this.send({ t: 'mode', gamemode: mode, flying: this.flying });
    this.server.broadcastPlayerList();
    this.server.broadcastToKnown(this, { t: 'spawn', e: this.spawnData() });
  }

  syncInventory() {
    const msg = { t: 'inv', inv: packInventory(this.inv), cursor: this.cursor ? [this.cursor.id, this.cursor.count, this.cursor.dmg || 0] : 0 };
    if (this.window && this.window.container && this.window.container.grid) {
      msg.grid = packStacks(this.window.container.grid);
    }
    this.send(msg);
  }

  status() {
    return {
      hp: Math.max(0, Math.round(this.hp * 2) / 2), food: this.food, sat: Math.round(this.sat * 10) / 10, air: this.air,
      armor: armorPoints(this.inv), fire: this.fireTicks > 0 ? 1 : 0, score: this.score,
    };
  }

  syncStatus(force = false) {
    const s = this.status();
    const key = JSON.stringify(s);
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.send({ t: 'self', ...s });
  }

  equipKey() {
    const h = this.heldStack(), o = this.inv.offhand[0];
    return [h ? h.id : '', o ? o.id : '', ...this.inv.armor.map((a) => (a ? a.id : ''))].join('|');
  }

  spawnData() {
    const h = this.heldStack(), o = this.inv.offhand[0];
    return {
      id: this.id, type: 'player', name: this.name, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      held: h ? h.id : null, off: o ? o.id : null, armor: this.inv.armor.map((a) => (a ? a.id : null)),
      mode: this.gamemode, skin: this.skin || null,
    };
  }

  state() {
    let f = 0;
    if (this.pose === 'sneak') f |= FLAG.SNEAK;
    if (this.sprinting) f |= FLAG.SPRINT;
    if (this.gliding) f |= FLAG.GLIDE;
    if (this.flying) f |= FLAG.FLY;
    if (this.pose === 'swim') f |= FLAG.SWIM;
    if (this.fireTicks > 0) f |= FLAG.BURNING;
    if (this.using) f |= FLAG.USING;
    if (this.using && this.using.kind === 'bow') f |= FLAG.DRAWING;
    if (this.sleeping) f |= FLAG.SLEEPING;
    if (this.hurtTime > 0) f |= FLAG.HURT;
    if (this.gamemode === 'spectator' || !this.alive) f |= FLAG.INVISIBLE;
    if (this.onGround) f |= FLAG.GROUND;
    return [this.id, +this.x.toFixed(3), +this.y.toFixed(3), +this.z.toFixed(3), +this.yaw.toFixed(3), +this.yaw.toFixed(3), +this.pitch.toFixed(3), f, this.using ? this.using.kind === 'eat' ? 1 : 2 : 0];
  }

  // ---- windows ----
  openWindow(type, container, pos, title) {
    this.closeWindow(false);
    const wid = this.nextWid++;
    const win = buildWindow(type, this.inv, container);
    win.wid = wid; win.container = container; win.pos = pos;
    this.window = win;
    if (container && container.viewers) container.viewers.add(this);
    const msg = { t: 'open', wid, type, title };
    if (container && container.items) msg.items = packStacks(container.items);
    if (container && container.type === 'furnace') Object.assign(msg, { burn: container.burn, burnMax: container.burnMax, cook: container.cook, cookMax: 200 });
    this.send(msg);
  }

  // Player window (inventory) is implicit: window null means the 2x2 grid is used.
  activeWindow() {
    if (this.window) return this.window;
    if (!this.playerWin) {
      this.playerWin = buildWindow('player', this.inv, null);
      this.playerWin.wid = 0;
    }
    return this.playerWin;
  }

  closeWindow(notifyClient) {
    const w = this.window;
    // return crafting grid contents & cursor
    const giveBack = [];
    if (w && w.container && w.container.grid) {
      for (let i = 0; i < w.container.grid.length; i++) { if (w.container.grid[i]) giveBack.push(w.container.grid[i]); w.container.grid[i] = null; }
    }
    if (!w) {
      for (let i = 0; i < 4; i++) { if (this.inv.craft[i]) giveBack.push(this.inv.craft[i]); this.inv.craft[i] = null; }
      this.inv.craftResult[0] = null;
    }
    if (this.cursor) { giveBack.push(this.cursor); this.cursor = null; }
    for (const s of giveBack) {
      const rest = addToInventory(this.inv, s);
      if (rest) this.server.dropItem(this, rest);
    }
    if (w) {
      if (w.container && w.container.viewers) w.container.viewers.delete(this);
      this.window = null;
      if (notifyClient) this.send({ t: 'close', wid: w.wid });
    }
    if (giveBack.length || w) this.syncInventory();
  }

  // ---- survival tick ----
  tick() {
    const server = this.server;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.kbAllowance > 0) this.kbAllowance = Math.max(0, this.kbAllowance - 0.5);
    const speedAllow = this.gamemode === 'spectator' || this.flying ? 30 : this.gliding ? 120 : 9;
    this.moveBudget = Math.min(this.moveBudget + speedAllow * C.DT * C.MOVE_TOLERANCE + 0.05, speedAllow * 0.6 + 2 + this.kbAllowance);
    if (!this.alive || !this.joined) return;
    const [w, h, eye] = poseSize(this.pose);
    this.w = w; this.h = h; this.eye = eye;
    if (this.gamemode === 'spectator') { this.fireTicks = 0; this.air = C.MAX_AIR_TICKS; return; }

    fluidState(server.world, this, fsTmp);
    this.inWater = fsTmp.water; this.inLava = fsTmp.lava; this.onLadder = fsTmp.ladder;
    const creative = this.gamemode === 'creative';

    // breath
    if (fsTmp.headWater && !creative) {
      this.air--;
      if (this.air <= -20) { this.air = 0; server.damagePlayer(this, C.DROWN_DAMAGE, 'drown', null); }
    } else if (this.air < C.MAX_AIR_TICKS) this.air = Math.min(C.MAX_AIR_TICKS, Math.max(0, this.air) + 5);

    // lava / fire
    if (fsTmp.lava && !creative) {
      this.fireTicks = C.BURN_AFTER_LAVA_TICKS;
      if (server.tickCount % 10 === 0) server.damagePlayer(this, C.LAVA_DAMAGE_PER_SEC / 2, 'lava', null);
    }
    if (fsTmp.water) this.fireTicks = 0;
    // Nether portal travel (instant in creative, 4 s otherwise)
    if (this.portalCooldown > 0) this.portalCooldown--;
    const pw = server.world;
    const inPortal = pw.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z)) === ID.nether_portal || pw.getBlock(Math.floor(this.x), Math.floor(this.y + 1.2), Math.floor(this.z)) === ID.nether_portal;
    if (inPortal && !this.portalCooldown) {
      this.portalTicks = (this.portalTicks || 0) + 1;
      if (this.portalTicks >= (creative ? 2 : 80)) {
        this.portalTicks = 0; this.portalCooldown = 100;
        const dest = portalDestination(pw, this.x, this.z);
        server.teleport(this, dest.x, dest.y, dest.z);
        server.sound('portal_travel', dest.x, dest.y + 1, dest.z, 1, 1);
      }
    } else if (!inPortal) this.portalTicks = 0;
    if (inPortal && this.portalCooldown) this.portalCooldown = 100;
    if (!this.portalCooldown && pw.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z)) === ID.end_portal) {
      this.portalCooldown = 60;
      server.endPortalTravel(this);
      server.sound('portal_travel', this.x, this.y + 1, this.z, 1, 1.3);
    }
    // magma blocks burn feet unless sneaking
    if (!creative && this.onGround && this.pose !== 'sneak' && server.tickCount % 20 === 0 && pw.getBlock(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z)) === ID.magma_block) server.damagePlayer(this, 1, 'magma', null);
    if (this.fireTicks > 0) {
      if (server.isRaining() && server.world.skyExposed(Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z))) this.fireTicks = 0;
      else {
        this.fireTicks--;
        if (!fsTmp.lava && this.fireTicks % 20 === 0 && !creative) server.damagePlayer(this, C.BURN_DAMAGE_PER_SEC, 'fire', null);
      }
    }
    if (creative) this.fireTicks = 0;

    // suffocation & void & cactus
    if (!creative) {
      const hb = server.world.getBlock(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z));
      if (hb && BLOCKS[hb] && BLOCKS[hb].full && server.tickCount % 10 === 0) server.damagePlayer(this, C.SUFFOCATE_DAMAGE, 'suffocation', null);
      if (server.tickCount % 10 === 0) {
        const hw = this.w / 2 + 0.03;
        let cactus = false;
        for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
          for (const oy of [0.1, this.h - 0.1]) if (server.world.getBlock(Math.floor(this.x + ox), Math.floor(this.y + oy), Math.floor(this.z + oz)) === ID.cactus) cactus = true;
        }
        if (cactus) server.damagePlayer(this, 1, 'cactus', null);
      }
    }
    if (this.y < C.VOID_Y && server.tickCount % 10 === 0) server.damagePlayer(this, C.VOID_DAMAGE, 'void', null, 0, 0, 0, true);

    // hunger & regen
    if (!creative) {
      const diff = server.difficulty;
      if (diff === 'peaceful') {
        if (server.tickCount % 40 === 0 && this.hp < C.MAX_HEALTH) this.heal(1);
        if (server.tickCount % 20 === 0 && this.food < C.MAX_FOOD) this.food++;
      }
      while (this.exhaustion >= C.EXHAUSTION_PER_FOOD) {
        this.exhaustion -= C.EXHAUSTION_PER_FOOD;
        if (this.sat > 0) this.sat = Math.max(0, this.sat - 1);
        else if (diff !== 'peaceful') this.food = Math.max(0, this.food - 1);
      }
      if (this.food >= C.REGEN_FOOD_MIN && this.hp < C.MAX_HEALTH) {
        if (++this.regenTimer >= C.REGEN_INTERVAL_TICKS) { this.regenTimer = 0; this.heal(1); this.exhaustion += C.EXH_REGEN; }
      } else this.regenTimer = 0;
      if (this.food <= 0) {
        if (++this.starveTimer >= C.STARVE_INTERVAL_TICKS) {
          this.starveTimer = 0;
          if (this.hp > C.STARVE_FLOOR[diff]) server.damagePlayer(this, 1, 'starve', null);
        }
      } else this.starveTimer = 0;
    }

    // gliding durability
    if (this.gliding) {
      this.glideTicks++;
      const chest = this.inv.armor[1];
      if (!chest || chest.id !== 'glider_wings' || (chest.dmg || 0) >= C.GLIDER_DURABILITY - 1) {
        this.gliding = false; this.send({ t: 'glide', on: false });
      } else if (this.glideTicks % 20 === 0 && !creative) {
        chest.dmg = (chest.dmg || 0) + 1;
        this.syncInventory();
      }
    }

    // using items
    if (this.using) {
      this.using.ticks++;
      const held = this.using.hand === 'off' ? this.inv.offhand[0] : this.heldStack();
      if (!held || held.id !== this.using.id) this.using = null;
      else if (this.using.kind === 'eat' && this.using.ticks >= C.EAT_TICKS) server.finishEating(this);
      else if (this.using.kind === 'eat' && this.using.ticks % 4 === 0) server.broadcastNear(this.x, this.y, this.z, { t: 'ev', id: this.id, k: 'eat', item: this.using.id }, 32);
    }

    // sleeping
    if (this.sleeping) this.sleepTicks++;
  }

  heal(n) { this.hp = Math.min(C.MAX_HEALTH, this.hp + n); }

  addExhaustion(n) { if (this.gamemode === 'survival') this.exhaustion = Math.min(40, this.exhaustion + n); }

  serialize() {
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      hp: this.hp, food: this.food, sat: this.sat, exhaustion: this.exhaustion, air: this.air, fire: this.fireTicks,
      inv: packInventory(this.inv), gamemode: this.gamemode, flying: this.flying, spawnPoint: this.spawnPoint,
      score: this.score, alive: this.alive, hardcoreDead: this.hardcoreDead,
    };
  }

  restore(d) {
    if (!d) return;
    this.x = d.x; this.y = d.y; this.z = d.z; this.yaw = d.yaw || 0; this.pitch = d.pitch || 0;
    this.hp = d.hp ?? C.MAX_HEALTH; this.food = d.food ?? C.MAX_FOOD; this.sat = d.sat ?? 5; this.exhaustion = d.exhaustion || 0;
    this.air = d.air ?? C.MAX_AIR_TICKS; this.fireTicks = d.fire || 0;
    unpackInventoryInto(this.inv, d.inv);
    this.gamemode = d.gamemode || this.gamemode;
    this.flying = !!d.flying && (this.gamemode === 'creative' || this.gamemode === 'spectator');
    this.spawnPoint = d.spawnPoint || null;
    this.score = d.score || 0;
    this.alive = d.alive !== false;
    this.hardcoreDead = !!d.hardcoreDead;
    if (!this.alive && this.hp <= 0) this.hp = 0;
  }
}

export function itemMeta(id) { return ITEMS[id]; }
