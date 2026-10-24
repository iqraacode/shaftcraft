// Mob definitions and server-side AI.
import * as C from '../../shared/constants.js';
import { stepMob } from '../../shared/physics.js';
import { ID, IS_FLUID, BLOCKS } from '../../shared/blocks.js';
import { FLAG } from '../../shared/protocol.js';
import { findPath, lineOfSight, canStandAt } from './pathfind.js';
import { END as END_CENTER } from '../../shared/dimensions.js';

// width, height, health (half-hearts), speed (b/s), hostile, loot
export const MOB_TYPES = {
  pig: { w: 0.9, h: 0.9, hp: 10, speed: 2.5, hostile: false, name: 'Pig' },
  cow: { w: 0.9, h: 1.4, hp: 10, speed: 2.0, hostile: false, name: 'Cow' },
  sheep: { w: 0.9, h: 1.3, hp: 8, speed: 2.0, hostile: false, name: 'Sheep' },
  chicken: { w: 0.4, h: 0.7, hp: 4, speed: 2.2, hostile: false, name: 'Chicken' },
  zombie: { w: 0.6, h: 1.95, hp: 20, speed: 3.2, hostile: true, name: 'Zombie' },
  skeleton: { w: 0.6, h: 1.99, hp: 20, speed: 3.0, hostile: true, name: 'Skeleton' },
  creeper: { w: 0.6, h: 1.7, hp: 20, speed: 3.0, hostile: true, name: 'Creeper' },
  spider: { w: 1.4, h: 0.9, hp: 16, speed: 4.0, hostile: true, name: 'Spider' },
  enderman: { w: 0.6, h: 2.9, hp: 40, speed: 3.0, hostile: true, name: 'Enderman' },
  ender_dragon: { w: 8, h: 4, hp: 200, speed: 12, hostile: false, boss: true, name: 'Ender Dragon' },
  end_crystal: { w: 2, h: 2, hp: 1, speed: 0, hostile: false, boss: true, name: 'End Crystal' },
  villager: { w: 0.6, h: 1.95, hp: 20, speed: 1.8, hostile: false, name: 'Villager' },
};
export const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];

// Villager trades per profession: [costItem, costCount, resultItem, resultCount]
export const TRADES = {
  farmer: [['wheat', 20, 'emerald', 1], ['emerald', 1, 'bread', 6], ['emerald', 1, 'apple', 4], ['emerald', 2, 'cooked_chicken', 5]],
  librarian: [['paper', 24, 'emerald', 1], ['emerald', 1, 'glass', 6], ['emerald', 1, 'torch', 16], ['emerald', 3, 'firework_rocket', 6]],
  toolsmith: [['coal', 15, 'emerald', 1], ['emerald', 3, 'iron_pickaxe', 1], ['emerald', 3, 'iron_axe', 1], ['emerald', 8, 'diamond_pickaxe', 1]],
  butcher: [['porkchop', 14, 'emerald', 1], ['beef', 14, 'emerald', 1], ['emerald', 1, 'cooked_beef', 5], ['emerald', 1, 'cooked_porkchop', 5]],
  shepherd: [['white_wool', 16, 'emerald', 1], ['emerald', 1, 'red_wool', 3], ['emerald', 1, 'shears', 1], ['emerald', 2, 'bed', 1]],
};
export const HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider'];
export const SHEEP_COLORS = ['white', 'black', 'white', 'white', 'white', 'white', 'white', 'white', 'white', 'black'];

const ENDERMAN_DMG = { peaceful: 0, easy: 4, normal: 7, hard: 10 };
const DRAGON_DMG = { peaceful: 6, easy: 6, normal: 10, hard: 15 };
const ZOMBIE_DMG = { peaceful: 0, easy: 2, normal: 3, hard: 4.5 };
const SPIDER_DMG = { peaceful: 0, easy: 2, normal: 2, hard: 3 };

function rand(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

export class Mob {
  constructor(id, type, server, opts = {}) {
    const def = MOB_TYPES[type];
    this.id = id; this.type = type; this.def = def; this.server = server;
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.headYaw = 0; this.pitch = 0;
    this.baby = !!opts.baby;
    this.w = def.w * (this.baby ? 0.5 : 1); this.h = def.h * (this.baby ? 0.5 : 1);
    this.hp = def.hp; this.maxHp = def.hp;
    this.onGround = false; this.age = 0; this.removed = false;
    this.hurtTime = 0; this.dead = false; this.deathTime = 0;
    this.fireTicks = 0;
    this.flags = 0;
    this.path = null; this.pathIndex = 0; this.repathTimer = 0;
    this.wanderCooldown = 40 + Math.floor(server.world.rng() * 80);
    this.panicTicks = 0;
    this.target = null; this.attackCooldown = 0;
    this.persistent = !def.hostile;
    this.color = opts.color || (type === 'sheep' ? SHEEP_COLORS[Math.floor(server.world.rng() * SHEEP_COLORS.length)] : null);
    this.sheared = !!opts.sheared;
    this.prof = opts.prof || null; this.style = opts.style || null;
    this.eatTimer = 0;
    this.eggTimer = C.EGG_INTERVAL_MIN + Math.floor(server.world.rng() * (C.EGG_INTERVAL_MAX - C.EGG_INTERVAL_MIN));
    this.growTimer = this.baby ? 24000 : 0;
    this.fuse = 0; this.drawTicks = 0; this.strafeDir = 1; this.strafeTimer = 0;
    this.provoked = 0;
    this.lastAttacker = null;
    this.idleSoundTimer = 200 + Math.floor(server.world.rng() * 400);
    this.fallDistance = 0;
    this.killer = null;
  }

  spawnData() {
    return { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, baby: this.baby, color: this.color, sheared: this.sheared, hp: this.hp, maxHp: this.maxHp, prof: this.prof, style: this.style };
  }

  state() {
    let extra = 0;
    if (this.type === 'creeper') extra = this.fuse;
    if (this.type === 'ender_dragon') extra = Math.ceil(this.hp);
    return [this.id, +this.x.toFixed(3), +this.y.toFixed(3), +this.z.toFixed(3), +this.yaw.toFixed(3), +this.headYaw.toFixed(3), +this.pitch.toFixed(3), this.flags, extra];
  }

  serialize() {
    return { type: this.type, x: this.x, y: this.y, z: this.z, hp: this.hp, baby: this.baby, color: this.color, sheared: this.sheared, growTimer: this.growTimer, prof: this.prof, style: this.style };
  }

  restore(d) {
    if (d.hp) this.hp = d.hp;
    if (d.growTimer) this.growTimer = d.growTimer;
  }

  get world() { return this.server.world; }

  // ----- damage -----
  hurt(amount, cause, attacker, kx = 0, kz = 0, kbScale = 1) {
    if (this.dead || this.hurtTime > 0 && amount <= this.lastDamage) return false;
    this.lastDamage = amount;
    this.hp -= amount;
    this.hurtTime = C.HURT_COOLDOWN_TICKS;
    const len = Math.hypot(kx, kz);
    if (len > 0 && kbScale > 0) {
      this.vx += (kx / len) * C.KNOCKBACK * 0.6 * kbScale;
      this.vz += (kz / len) * C.KNOCKBACK * 0.6 * kbScale;
      if (this.onGround) this.vy = C.KNOCKBACK_UP * 0.8;
    }
    if (attacker && attacker.type === 'player') { this.lastAttacker = attacker; this.provoked = 400; }
    if (!this.def.hostile) this.panicTicks = 100;
    else if (attacker && attacker.type === 'player' && attacker.gamemode !== 'creative' && attacker.gamemode !== 'spectator') this.target = attacker;
    this.server.broadcastNear(this.x, this.y, this.z, { t: 'ev', id: this.id, k: 'hurt' }, 64);
    if (this.type === 'enderman' && this.hp > 0) this.teleportRandom();
    if (this.hp <= 0) this.die(cause, attacker);
    else this.server.sound(this.type + '_hurt', this.x, this.y + this.h / 2, this.z, 1, this.baby ? 1.5 : 1);
    return true;
  }

  die(cause, attacker) {
    this.dead = true; this.deathTime = 0; this.hp = 0;
    this.killer = attacker;
    this.server.broadcastNear(this.x, this.y, this.z, { t: 'ev', id: this.id, k: 'death' }, 64);
    this.server.sound(this.type + '_death', this.x, this.y + this.h / 2, this.z, 1, this.baby ? 1.5 : 1);
    if (attacker && attacker.type === 'player') attacker.addScore(this.def.hostile ? 5 : 1);
    if (!this.baby && cause !== 'despawn') this.dropLoot();
    if (this.type === 'end_crystal') this.world.explode(this.x, this.y + 1, this.z, 3, this, { noBlocks: true });
    if (this.type === 'ender_dragon') this.server.onDragonDeath(this);
  }

  dropLoot() {
    const rng = this.world.rng;
    const burnt = this.fireTicks > 0;
    const drops = [];
    switch (this.type) {
      case 'pig': drops.push([burnt ? 'cooked_porkchop' : 'porkchop', rand(rng, 1, 3)]); break;
      case 'cow': drops.push(['leather', rand(rng, 0, 2)], [burnt ? 'cooked_beef' : 'beef', rand(rng, 1, 3)]); break;
      case 'sheep': if (!this.sheared) drops.push([this.color + '_wool', 1]); drops.push([burnt ? 'cooked_mutton' : 'mutton', rand(rng, 1, 2)]); break;
      case 'chicken': drops.push(['feather', rand(rng, 0, 2)], [burnt ? 'cooked_chicken' : 'chicken', 1]); break;
      case 'zombie': drops.push(['rotten_flesh', rand(rng, 0, 2)]); break;
      case 'skeleton': drops.push(['bone', rand(rng, 0, 2)], ['arrow', rand(rng, 0, 2)]); break;
      case 'creeper': drops.push(['gunpowder', rand(rng, 0, 2)]); break;
      case 'spider': drops.push(['string', rand(rng, 0, 2)]); break;
      case 'enderman': drops.push(['ender_pearl', rand(rng, 0, 1)]); break;
    }
    for (const [id, count] of drops) if (count > 0) this.server.entities.spawnItem(this.x, this.y + 0.5, this.z, { id, count });
  }

  // ----- main tick -----
  tick() {
    const server = this.server;
    if (this.dead) {
      this.deathTime++;
      if (this.deathTime >= 20) {
        server.broadcastNear(this.x, this.y, this.z, { t: 'fx', k: 'poof', x: this.x, y: this.y + this.h / 2, z: this.z }, 48);
        server.entities.remove(this);
      }
      return;
    }
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.provoked > 0) this.provoked--;

    if (this.def.boss) { this.bossTick(); return; }
    // peaceful removes hostiles
    if (this.def.hostile && server.difficulty === 'peaceful') { server.entities.remove(this); return; }
    if (this.def.hostile && this.despawnCheck()) return;

    // baby growth
    if (this.baby && --this.growTimer <= 0) {
      this.baby = false; this.w = this.def.w; this.h = this.def.h;
      server.broadcastNear(this.x, this.y, this.z, { t: 'spawn', e: this.spawnData() }, 160);
    }

    this.environment();
    if (this.dead || this.removed) return;

    let wishX = 0, wishZ = 0, jump = false, speed = this.def.speed;
    const ai = this.def.hostile ? this.hostileAI() : this.passiveAI();
    if (ai) { wishX = ai.x; wishZ = ai.z; jump = ai.jump; speed = ai.speed; }

    // jump when blocked
    if ((wishX || wishZ) && this.hc && this.onGround && this.type !== 'spider') jump = true;
    if (this.inWater && (wishX || wishZ || this.headInWater)) jump = jump || this.headInWater;

    const fall = stepMob(this.world, this, wishX, wishZ, speed, jump, {
      slowFall: this.type === 'chicken',
      climb: this.type === 'spider',
    });
    if (fall > C.SAFE_FALL && this.type !== 'chicken' && !this.inWater) this.hurt(Math.floor(fall - C.SAFE_FALL), 'fall', null);

    // facing
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.3 && !(this.type === 'skeleton' && this.target)) this.yaw = turnToward(this.yaw, Math.atan2(-this.vx, -this.vz), 0.35);
    if (this.lookTarget) {
      const t = this.lookTarget;
      const dx = t.x - this.x, dz = t.z - this.z, dy = (t.y + (t.eye || t.h * 0.85 || 0)) - (this.y + this.h * 0.85);
      const want = Math.atan2(-dx, -dz);
      this.headYaw = turnToward(this.headYaw, clampAngle(want, this.yaw, 75 * Math.PI / 180), 0.4);
      this.pitch = Math.max(-0.7, Math.min(0.7, Math.atan2(dy, Math.hypot(dx, dz))));
      if (this.type === 'skeleton' && this.target) this.yaw = turnToward(this.yaw, want, 0.3);
    } else {
      this.headYaw = turnToward(this.headYaw, this.yaw, 0.2);
      this.pitch *= 0.9;
    }

    // flags
    let f = 0;
    if (this.fireTicks > 0) f |= FLAG.BURNING;
    if (this.hurtTime > 0) f |= FLAG.HURT;
    if (this.baby) f |= FLAG.BABY;
    if (this.fuse > 0) f |= FLAG.SWELL;
    if (this.type === 'zombie' && this.target) f |= FLAG.ARMS_UP;
    if (this.sheared) f |= FLAG.SHEARED;
    if (this.eatTimer > 0) f |= FLAG.EATING_GRASS;
    if (this.drawTicks > 0) f |= FLAG.DRAWING;
    this.flags = f;

    // idle sounds
    if (--this.idleSoundTimer <= 0) {
      this.idleSoundTimer = 160 + Math.floor(this.world.rng() * 480);
      if (this.type !== 'creeper') server.sound(this.type + '_idle', this.x, this.y + this.h * 0.8, this.z, 0.8, this.baby ? 1.5 : 0.9 + this.world.rng() * 0.2);
    }
    if (this.y < C.VOID_Y) server.entities.remove(this);
  }

  environment() {
    const server = this.server, world = this.world;
    if (this.inLava) { this.fireTicks = 300; if (this.age % 10 === 0) this.hurt(2, 'lava', null); }
    if (this.inWater) this.fireTicks = 0;
    // sunlight burning
    if ((this.type === 'zombie' || this.type === 'skeleton') && server.skyFactor() > 0.75 && !server.isRaining() && !this.inWater) {
      if (world.skyExposed(Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z))) this.fireTicks = Math.max(this.fireTicks, 100);
    }
    if (server.isRaining() && this.fireTicks > 0 && world.skyExposed(Math.floor(this.x), Math.floor(this.y + this.h), Math.floor(this.z))) this.fireTicks = 0;
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.fireTicks % 20 === 0) this.hurt(1, 'fire', null);
    }
    // suffocation
    const hid = world.getBlock(Math.floor(this.x), Math.floor(this.y + this.h * 0.85), Math.floor(this.z));
    if (hid && BLOCKS[hid].full && this.age % 10 === 0) this.hurt(1, 'suffocation', null);
    // cactus
    if (this.age % 10 === 0) {
      const hw = this.w / 2 + 0.05;
      for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
        if (world.getBlock(Math.floor(this.x + ox), Math.floor(this.y + 0.2), Math.floor(this.z + oz)) === ID.cactus) { this.hurt(1, 'cactus', null); break; }
      }
    }
  }

  despawnCheck() {
    let nearest = Infinity;
    for (const p of this.server.players.values()) {
      if (!p.joined) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z);
      if (d < nearest) nearest = d;
    }
    if (nearest > C.DESPAWN_FAR || (nearest > C.DESPAWN_RANDOM_DIST && this.world.rng() < 1 / 800)) {
      this.server.entities.remove(this);
      return true;
    }
    return false;
  }

  // ----- path following -----
  pathTo(tx, ty, tz, range = C.MOB_PATH_RANGE) {
    const sx = Math.floor(this.x), sy = Math.floor(this.y + 0.01), sz = Math.floor(this.z);
    this.path = findPath(this.world, sx, sy, sz, Math.floor(tx), Math.floor(ty), Math.floor(tz), range, { height: Math.max(1, Math.ceil(this.h)) });
    this.pathIndex = 0;
    return !!this.path;
  }

  followPath(speed) {
    if (!this.path || this.pathIndex >= this.path.length) { this.path = null; return null; }
    const [px, py, pz] = this.path[this.pathIndex];
    const tx = px + 0.5, tz = pz + 0.5;
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35 && Math.abs(this.y - py) < 1.2) { this.pathIndex++; return this.followPath(speed); }
    const jump = py > Math.floor(this.y + 0.01) && this.onGround;
    // door breaking on hard
    if (this.type === 'zombie' && this.server.difficulty === 'hard' && this.hc) this.tryBreakDoor(px, py, pz);
    this.stuckTicks = (Math.hypot(this.vx, this.vz) < 0.2) ? (this.stuckTicks || 0) + 1 : 0;
    if (this.stuckTicks > 40) { this.path = null; this.stuckTicks = 0; return null; }
    return { x: dx / (d || 1), z: dz / (d || 1), jump, speed };
  }

  tryBreakDoor(px, py, pz) {
    const w = this.world;
    for (const y of [py, py + 1]) {
      if (w.getBlock(px, y, pz) === ID.door && !(w.getMeta(px, y, pz) & 4)) {
        this.doorTicks = (this.doorTicks || 0) + 1;
        if (this.doorTicks % 20 === 0) this.server.sound('door_bang', px + 0.5, y + 0.5, pz + 0.5, 1, 0.8);
        if (this.doorTicks > 80) { w.breakBlock(px, y, pz, null, true); this.doorTicks = 0; }
        return;
      }
    }
  }

  // ----- passive -----
  passiveAI() {
    const rng = this.world.rng;
    this.lookTarget = null;
    // sheep grazing
    if (this.eatTimer > 0) {
      this.eatTimer--;
      if (this.eatTimer === 0) {
        const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
        if (this.world.getBlock(bx, by, bz) === ID.grass) {
          this.world.setBlock(bx, by, bz, ID.dirt, 0);
          if (this.sheared) { this.sheared = false; this.server.broadcastNear(this.x, this.y, this.z, { t: 'spawn', e: this.spawnData() }, 160); }
        }
      }
      return null;
    }
    if (this.type === 'sheep' && this.onGround && !this.path && rng() < (this.sheared ? 1 / 200 : 1 / 1000)) {
      if (this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) === ID.grass) { this.eatTimer = 40; return null; }
    }
    if (this.type === 'chicken' && !this.baby && --this.eggTimer <= 0) {
      this.eggTimer = C.EGG_INTERVAL_MIN + Math.floor(rng() * (C.EGG_INTERVAL_MAX - C.EGG_INTERVAL_MIN));
      this.server.entities.spawnItem(this.x, this.y + 0.2, this.z, { id: 'egg', count: 1 }, { vx: 0, vy: 1, vz: 0 });
      this.server.sound('chicken_plop', this.x, this.y, this.z, 0.8, 1);
    }
    let speed = this.def.speed;
    if (this.panicTicks > 0) {
      this.panicTicks--;
      speed *= 1.6;
      if (!this.path || this.path.length === 0 || rng() < 0.05) {
        const a = rng() * Math.PI * 2;
        this.pathTo(this.x + Math.cos(a) * 8, this.y, this.z + Math.sin(a) * 8, 10);
      }
    } else if (!this.path) {
      // look at nearby player sometimes
      const p = this.server.nearestPlayer(this.x, this.y, this.z, 6, false);
      if (p && rng() < 0.6) this.lookTarget = p;
      if (--this.wanderCooldown <= 0) {
        this.wanderCooldown = 60 + Math.floor(rng() * 160);
        const tx = this.x + (rng() - 0.5) * 16, tz = this.z + (rng() - 0.5) * 16;
        this.pathTo(tx, this.y, tz, 10);
      }
    }
    return this.followPath(speed);
  }

  // ----- hostile -----
  validTarget(p) {
    return p && p.joined && p.alive && p.gamemode !== 'creative' && p.gamemode !== 'spectator';
  }

  hostileAI() {
    const server = this.server, world = this.world;
    const rng = world.rng;
    // spider neutrality
    let aggressive = true;
    if (this.type === 'enderman') aggressive = this.provoked > 0; // neutral until hurt
    if (this.type === 'spider') {
      const light = world.lightAt(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z), true);
      aggressive = light <= C.HOSTILE_MAX_BLOCK_LIGHT || this.provoked > 0;
    }
    const sight = this.type === 'zombie' ? C.ZOMBIE_SIGHT : 16;
    if (this.target && (!this.validTarget(this.target) || dist3(this, this.target) > sight * 1.3)) this.target = null;
    if (!aggressive && !this.provoked) this.target = null;
    if (!this.target && aggressive && this.age % 10 === 0) {
      const p = server.nearestPlayer(this.x, this.y, this.z, sight, true);
      if (p && (this.type === 'zombie' || lineOfSight(world, this.x, this.y + this.h * 0.85, this.z, p.x, p.y + p.eye, p.z))) this.target = p;
    }
    const t = this.target;
    this.lookTarget = t;
    if (!t) {
      this.fuse = Math.max(0, this.fuse - 1);
      this.drawTicks = 0;
      // wander
      if (!this.path && --this.wanderCooldown <= 0) {
        this.wanderCooldown = 80 + Math.floor(rng() * 200);
        this.pathTo(this.x + (rng() - 0.5) * 16, this.y, this.z + (rng() - 0.5) * 16, 10);
      }
      return this.followPath(this.def.speed * 0.6);
    }
    const dx = t.x - this.x, dz = t.z - this.z;
    const hd = Math.hypot(dx, dz);
    const d = dist3(this, t);
    const speed = this.def.speed;

    if (this.type === 'creeper') {
      if (d < 3 || (this.fuse > 0 && d < 7)) {
        if (this.fuse === 0) server.sound('creeper_hiss', this.x, this.y + 1, this.z, 1, 1);
        this.fuse++;
        if (this.fuse >= C.CREEPER_FUSE_TICKS) {
          this.removedByExplosion = true;
          server.entities.remove(this);
          if (server.difficulty !== 'peaceful') world.explode(this.x, this.y + 0.8, this.z, C.CREEPER_RADIUS, this);
          return null;
        }
        return { x: 0, z: 0, jump: false, speed: 0 };
      }
      this.fuse = Math.max(0, this.fuse - 1);
      return this.chase(t, speed);
    }

    if (this.type === 'skeleton') {
      const los = lineOfSight(world, this.x, this.y + 1.7, this.z, t.x, t.y + t.eye, t.z);
      if (los && d < 16) {
        this.drawTicks++;
        if (this.drawTicks >= 20 && this.attackCooldown <= 0) {
          this.shootArrow(t);
          this.drawTicks = 0;
          this.attackCooldown = 20 + Math.floor(rng() * 20);
        }
      } else this.drawTicks = 0;
      if (--this.strafeTimer <= 0) { this.strafeTimer = 30 + Math.floor(rng() * 40); this.strafeDir = rng() < 0.5 ? -1 : 1; }
      if (!los || d > C.SKELETON_RANGE_MAX) return this.chase(t, speed);
      const nx = dx / (hd || 1), nz = dz / (hd || 1);
      let mx = -nz * this.strafeDir * 0.6, mz = nx * this.strafeDir * 0.6;
      if (d < C.SKELETON_RANGE_MIN) { mx -= nx; mz -= nz; }
      const ml = Math.hypot(mx, mz) || 1;
      // avoid walking off cliffs while strafing
      const ax = Math.floor(this.x + mx / ml), az = Math.floor(this.z + mz / ml);
      if (!canStandAt(world, ax, Math.floor(this.y), az, 2) && !canStandAt(world, ax, Math.floor(this.y) - 1, az, 2)) return { x: 0, z: 0, jump: false, speed: 0 };
      return { x: mx / ml, z: mz / ml, jump: false, speed: speed * 0.6 };
    }

    // melee: zombie / spider
    const reach = this.w / 2 + t.w / 2 + 0.9;
    if (hd < reach && Math.abs(t.y - this.y) < 2.2) {
      if (this.attackCooldown <= 0) {
        const dmg = (this.type === 'zombie' ? ZOMBIE_DMG : this.type === 'enderman' ? ENDERMAN_DMG : SPIDER_DMG)[server.difficulty];
        if (dmg > 0) server.damageEntity(t, dmg, this.type, this, dx, dz);
        this.attackCooldown = 20;
        server.broadcastNear(this.x, this.y, this.z, { t: 'ev', id: this.id, k: 'swing' }, 48);
      }
    }
    if (this.type === 'spider' && this.onGround && hd > 2 && hd < 4.5 && rng() < 0.1) {
      this.vy = 7; this.vx = dx / hd * 7; this.vz = dz / hd * 7;
    }
    return this.chase(t, speed);
  }

  chase(t, speed) {
    if (--this.repathTimer <= 0 || !this.path) {
      this.repathTimer = 15 + Math.floor(this.world.rng() * 10);
      if (!this.pathTo(t.x, t.y, t.z)) this.path = null;
    }
    const r = this.followPath(speed);
    if (r) return r;
    // fall back to direct approach
    const dx = t.x - this.x, dz = t.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d, jump: false, speed };
  }

  shootArrow(t) {
    const sx = this.x, sy = this.y + 1.5, sz = this.z;
    const tx = t.x, ty = t.y + t.h * 0.6, tz = t.z;
    const dx = tx - sx, dz = tz - sz;
    const hd = Math.hypot(dx, dz);
    const v = C.ARROW_SPEED;
    const time = hd / v;
    const dy = ty - sy + 0.5 * 20 * time * time; // compensate gravity (20 b/s^2)
    const len = Math.hypot(dx, dy, dz) || 1;
    const spread = this.server.difficulty === 'hard' ? 0.02 : 0.06;
    const r = this.world.rng;
    const vx = (dx / len + (r() - 0.5) * spread) * v;
    const vy = (dy / len + (r() - 0.5) * spread) * v;
    const vz = (dz / len + (r() - 0.5) * spread) * v;
    const dmg = 2 + Math.floor(r() * 3);
    this.server.entities.spawnArrow(this, sx + dx / hd * 0.6, sy, sz + dz / hd * 0.6, vx, vy, vz, dmg, false);
    this.server.sound('bow_shoot', sx, sy, sz, 1, 1 / (r() * 0.4 + 0.8));
  }

  teleportRandom() {
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(this.x + (this.world.rng() - 0.5) * 32), z = Math.floor(this.z + (this.world.rng() - 0.5) * 32);
      for (let y = Math.floor(this.y) + 8; y > Math.floor(this.y) - 8; y--) {
        if (!canStandAt(this.world, x, y, z, 3)) continue;
        this.server.broadcastNear(this.x, this.y, this.z, { t: 'fx', k: 'poof', x: this.x, y: this.y + 1.5, z: this.z }, 48);
        this.x = x + 0.5; this.y = y; this.z = z + 0.5; this.path = null;
        this.server.sound('enderman_teleport', this.x, this.y + 1.5, this.z, 1, 1);
        return;
      }
    }
  }

  // Ender Dragon (circles the pillars, charges players, healed by crystals) and static End Crystals.
  bossTick() {
    if (this.hurtTime > 0) this.hurtTime--;
    this.flags = this.hurtTime > 0 ? FLAG.HURT : 0;
    if (this.type !== 'ender_dragon') return;
    const server = this.server, rng = this.world.rng;
    const c = { x: END_CENTER.x, z: END_CENTER.z, y: END_CENTER.top };
    const players = [...server.players.values()].filter((p) => p.joined && p.alive && p.gamemode !== 'spectator' && Math.hypot(p.x - c.x, p.z - c.z) < 160);
    if (!this.phase) { this.phase = 'circle'; this.angle = 0; }
    let tx, ty, tz, speed = 11;
    if (this.phase === 'charge' && (!this.target || !this.target.alive || this.chargeT-- <= 0)) this.phase = 'circle';
    if (this.phase === 'circle') {
      this.angle += 0.012;
      tx = c.x + Math.cos(this.angle) * 40; tz = c.z + Math.sin(this.angle) * 40; ty = c.y + 24 + Math.sin(this.age * 0.04) * 6;
      const targets = players.filter((p) => p.gamemode !== 'creative');
      if (targets.length && rng() < 1 / 160) { this.phase = 'charge'; this.target = targets[Math.floor(rng() * targets.length)]; this.chargeT = 90; }
    } else { tx = this.target.x; ty = this.target.y + 1; tz = this.target.z; speed = 18; }
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, d = Math.hypot(dx, dy, dz) || 1;
    this.vx += (dx / d * speed - this.vx) * 0.08; this.vy += (dy / d * speed - this.vy) * 0.08; this.vz += (dz / d * speed - this.vz) * 0.08;
    this.x += this.vx * C.DT; this.y += this.vy * C.DT; this.z += this.vz * C.DT;
    this.yaw = Math.atan2(-this.vx, -this.vz); this.headYaw = this.yaw;
    this.pitch = Math.atan2(this.vy, Math.hypot(this.vx, this.vz)) * 0.6;
    if (this.age % 10 === 0) {
      for (const p of players) {
        if (Math.abs(p.x - this.x) < 5 && Math.abs(p.y + 1 - this.y - 2) < 4 && Math.abs(p.z - this.z) < 5) {
          server.damagePlayer(p, DRAGON_DMG[server.difficulty], 'dragon', this, p.x - this.x, p.z - this.z, 2.5);
          if (this.phase === 'charge') this.phase = 'circle';
        }
      }
      // crystals heal the dragon
      if (this.hp < this.maxHp && server.entities.mobs().some((m) => m.type === 'end_crystal' && !m.dead && Math.hypot(m.x - this.x, m.z - this.z) < 64)) this.hp = Math.min(this.maxHp, this.hp + 1);
    }
    if (this.age % 120 === 0) server.sound('ender_dragon_idle', this.x, this.y, this.z, 2, 1);
  }

  interact(player, stack) {
    if (this.dead) return false;
    if (this.type === 'villager' && !this.baby) return 'trade';
    if (this.type === 'cow' && stack && stack.id === 'bucket' && !this.baby) {
      return 'milk';
    }
    if (this.type === 'sheep' && stack && stack.id === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = 1 + Math.floor(this.world.rng() * 3);
      for (let i = 0; i < n; i++) this.server.entities.spawnItem(this.x, this.y + 1, this.z, { id: this.color + '_wool', count: 1 });
      this.server.sound('shear', this.x, this.y + 1, this.z, 1, 1);
      this.server.broadcastNear(this.x, this.y, this.z, { t: 'spawn', e: this.spawnData() }, 160);
      return 'sheared';
    }
    return false;
  }
}

function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function turnToward(cur, target, rate) { return cur + wrapAngle(target - cur) * rate; }
function clampAngle(want, base, lim) { const d = wrapAngle(want - base); return base + Math.max(-lim, Math.min(lim, d)); }

export { IS_FLUID };
