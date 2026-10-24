// Server-side entities: dropped items, falling blocks, projectiles, fireworks and mobs.
import * as C from '../../shared/constants.js';
import { stepProjectile, collideMove } from '../../shared/physics.js';
import { BLOCKS, ID, IS_FLUID } from '../../shared/blocks.js';
import { sameItem, maxStackOf, ITEMS } from '../../shared/items.js';
import { addToInventory } from '../../shared/inventory.js';
import { FLAG } from '../../shared/protocol.js';
import { Mob, MOB_TYPES } from './mobs.js';

export class Entity {
  constructor(id, type) {
    this.id = id; this.type = type;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.headYaw = 0;
    this.w = 0.25; this.h = 0.25;
    this.onGround = false;
    this.age = 0;
    this.removed = false;
    this.flags = 0;
  }
  spawnData() { return { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch }; }
  state() { return [this.id, +this.x.toFixed(3), +this.y.toFixed(3), +this.z.toFixed(3), +this.yaw.toFixed(3), +this.headYaw.toFixed(3), +this.pitch.toFixed(3), this.flags, 0]; }
}

export class ItemEntity extends Entity {
  constructor(id, stack) {
    super(id, 'item');
    this.stack = stack;
    this.w = 0.25; this.h = 0.25;
    this.pickupDelay = C.PICKUP_DELAY_TICKS;
    this.lifetime = C.ITEM_DESPAWN_TICKS;
  }
  spawnData() { return { ...super.spawnData(), item: [this.stack.id, this.stack.count] }; }
}

const tmpHit = {};

export class EntityManager {
  constructor(server) {
    this.server = server;
    this.list = new Map();
    this.nextId = 1;
    this.spawnQueue = [];
    this.removeQueue = [];
  }

  newId() { return this.nextId++; }

  add(e) {
    this.list.set(e.id, e);
    this.server.broadcastNear(e.x, e.y, e.z, { t: 'spawn', e: e.spawnData() }, 160);
    return e;
  }

  remove(e) {
    if (e.removed) return;
    e.removed = true;
    this.list.delete(e.id);
    this.removeQueue.push(e.id);
  }

  spawnItem(x, y, z, stack, opts = {}) {
    if (!stack || !stack.count || !ITEMS[stack.id]) return null;
    const e = new ItemEntity(this.newId(), { ...stack });
    e.x = x; e.y = y; e.z = z;
    const r = this.server.world.rng;
    e.vx = opts.vx !== undefined ? opts.vx : (r() - 0.5) * 2;
    e.vy = opts.vy !== undefined ? opts.vy : 3 + r() * 1.5;
    e.vz = opts.vz !== undefined ? opts.vz : (r() - 0.5) * 2;
    if (opts.pickupDelay !== undefined) e.pickupDelay = opts.pickupDelay;
    if (opts.lifetime) e.lifetime = opts.lifetime;
    e.owner = opts.owner || null;
    return this.add(e);
  }

  spawnFalling(x, y, z, block, meta) {
    const e = new Entity(this.newId(), 'falling');
    e.x = x; e.y = y; e.z = z; e.w = 0.98; e.h = 0.98;
    e.block = block; e.meta = meta;
    e.spawnData = function () { return { ...Entity.prototype.spawnData.call(this), block: this.block }; };
    return this.add(e);
  }

  spawnArrow(shooter, x, y, z, vx, vy, vz, damage, pickup) {
    const e = new Entity(this.newId(), 'arrow');
    e.x = x; e.y = y; e.z = z; e.vx = vx; e.vy = vy; e.vz = vz;
    e.w = 0.3; e.h = 0.3;
    e.damage = damage; e.shooter = shooter ? shooter.id : 0; e.pickup = pickup;
    e.yaw = Math.atan2(-vx, -vz); e.pitch = Math.atan2(vy, Math.hypot(vx, vz));
    e.stuck = false;
    return this.add(e);
  }

  spawnEgg(shooter, x, y, z, vx, vy, vz, kind = 'egg') {
    const e = new Entity(this.newId(), kind);
    e.x = x; e.y = y; e.z = z; e.vx = vx; e.vy = vy; e.vz = vz; e.w = 0.25; e.h = 0.25;
    e.shooter = shooter ? shooter.id : 0;
    return this.add(e);
  }

  spawnFirework(x, y, z) {
    const e = new Entity(this.newId(), 'firework');
    e.x = x; e.y = y; e.z = z; e.vy = 12; e.w = 0.25; e.h = 0.25;
    e.fuse = 26 + Math.floor(this.server.world.rng() * 10);
    return this.add(e);
  }

  spawnMob(type, x, y, z, opts = {}) {
    if (!MOB_TYPES[type]) return null;
    const m = new Mob(this.newId(), type, this.server, opts);
    m.x = x; m.y = y; m.z = z;
    m.yaw = this.server.world.rng() * Math.PI * 2;
    m.headYaw = m.yaw;
    return this.add(m);
  }

  mobs() { const out = []; for (const e of this.list.values()) if (e instanceof Mob) out.push(e); return out; }

  tick() {
    const world = this.server.world;
    for (const e of this.list.values()) {
      if (e.removed) continue;
      // freeze entities in unloaded chunks
      if (!world.hasChunk(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4)) continue;
      e.age++;
      if (e instanceof Mob) { e.tick(); continue; }
      switch (e.type) {
        case 'item': this.tickItem(e); break;
        case 'falling': this.tickFalling(e); break;
        case 'arrow': this.tickArrow(e); break;
        case 'egg': case 'pearl': this.tickEgg(e); break;
        case 'eye': this.tickEye(e); break;
        case 'firework': this.tickFirework(e); break;
      }
      if (e.y < C.VOID_Y) this.remove(e);
    }
  }

  tickItem(e) {
    const world = this.server.world;
    if (e.pickupDelay > 0) e.pickupDelay--;
    const inWater = IS_FLUID[world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))] === 1;
    if (inWater) { e.vy += 6 * C.DT; e.vy *= 0.8; e.vx *= 0.9; e.vz *= 0.9; }
    stepProjectile(world, e, inWater ? 2 : 16, 0.98, tmpHit);
    if (e.onGround) { e.vx *= 0.6; e.vz *= 0.6; }
    if (IS_FLUID[world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === 2) { this.remove(e); return; }
    if (e.age >= e.lifetime) { this.remove(e); return; }
    // merge
    if (e.age % 10 === 0) {
      for (const o of this.list.values()) {
        if (o === e || o.type !== 'item' || o.removed || !sameItem(o.stack, e.stack)) continue;
        if (Math.abs(o.x - e.x) > C.ITEM_MERGE_RADIUS || Math.abs(o.y - e.y) > 0.5 || Math.abs(o.z - e.z) > C.ITEM_MERGE_RADIUS) continue;
        const max = maxStackOf(e.stack.id);
        if (e.stack.count + o.stack.count > max) continue;
        e.stack.count += o.stack.count;
        e.age = Math.min(e.age, o.age);
        this.remove(o);
        this.server.broadcastNear(e.x, e.y, e.z, { t: 'spawn', e: e.spawnData() }, 160);
      }
    }
    if (e.pickupDelay > 0) return;
    for (const p of this.server.players.values()) {
      if (!p.alive || p.gamemode === 'spectator' || !p.joined) continue;
      if (e.owner === p.id && e.age < 40) continue;
      const dx = p.x - e.x, dz = p.z - e.z, dy = (p.y + 0.6) - e.y;
      if (Math.abs(dx) > C.PICKUP_RADIUS || Math.abs(dz) > C.PICKUP_RADIUS || Math.abs(dy) > 1.6) continue;
      const before = e.stack.count;
      const rest = addToInventory(p.inv, e.stack);
      const taken = before - (rest ? rest.count : 0);
      if (taken <= 0) continue;
      this.server.broadcastNear(e.x, e.y, e.z, { t: 'ev', id: e.id, k: 'pickup', by: p.id }, 48);
      this.server.sound('pop', e.x, e.y, e.z, 0.4, 1.4 + this.server.world.rng() * 0.6);
      p.syncInventory();
      if (rest) { e.stack = rest; this.server.broadcastNear(e.x, e.y, e.z, { t: 'spawn', e: e.spawnData() }, 160); }
      else { this.remove(e); break; }
    }
  }

  tickFalling(e) {
    const world = this.server.world;
    stepProjectile(world, e, C.GRAVITY, 0.98, tmpHit);
    if (e.onGround || e.age > 600) {
      const bx = Math.floor(e.x), by = Math.floor(e.y + 0.5), bz = Math.floor(e.z);
      const cur = world.getBlock(bx, by, bz);
      this.remove(e);
      if (cur === 0 || BLOCKS[cur].replaceable) {
        world.setBlock(bx, by, bz, e.block, e.meta);
        this.server.sound('place:' + BLOCKS[e.block].sound, bx + 0.5, by + 0.5, bz + 0.5, 0.7, 0.9);
      } else {
        this.spawnItem(e.x, e.y + 0.5, e.z, { id: BLOCKS[e.block].item, count: 1 });
      }
      return;
    }
    // damage entities it lands on? (anvil-only in reference; skip)
  }

  hitEntityAlong(e, x0, y0, z0, x1, y1, z1, ignoreId) {
    // Sweep test against players and mobs hitboxes.
    let best = null, bestT = 2;
    const test = (t, w, h, x, y, z) => {
      const hw = w / 2 + 0.1;
      const minX = x - hw, maxX = x + hw, minY = y - 0.1, maxY = y + h + 0.1, minZ = z - hw, maxZ = z + hw;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      let tmin = 0, tmax = 1;
      for (const [o, d, a, b] of [[x0, dx, minX, maxX], [y0, dy, minY, maxY], [z0, dz, minZ, maxZ]]) {
        if (Math.abs(d) < 1e-9) { if (o < a || o > b) return; continue; }
        let t1 = (a - o) / d, t2 = (b - o) / d;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return;
      }
      if (tmin < bestT) { bestT = tmin; best = t; }
    };
    for (const p of this.server.players.values()) {
      if (!p.alive || p.gamemode === 'spectator' || p.id === ignoreId || !p.joined) continue;
      test(p, p.w, p.h, p.x, p.y, p.z);
    }
    for (const m of this.list.values()) {
      if (!(m instanceof Mob) || m.dead || m.id === ignoreId) continue;
      test(m, m.w, m.h, m.x, m.y, m.z);
    }
    return best;
  }

  tickArrow(e) {
    const world = this.server.world;
    if (e.stuck) {
      e.flags |= FLAG.STUCK;
      if (e.age > 1200) { this.remove(e); return; }
      if (world.getBlock(e.sx, e.sy, e.sz) === 0) { e.stuck = false; e.flags &= ~FLAG.STUCK; }
      // pickup
      if (e.pickup && e.age > 10) {
        for (const p of this.server.players.values()) {
          if (!p.alive || p.gamemode === 'spectator') continue;
          if (Math.abs(p.x - e.x) < 1.2 && Math.abs(p.z - e.z) < 1.2 && Math.abs(p.y + 0.9 - e.y) < 1.6) {
            if (!addToInventory(p.inv, { id: 'arrow', count: 1 })) {
              p.syncInventory();
              this.server.sound('pop', e.x, e.y, e.z, 0.4, 1.6);
              this.server.broadcastNear(e.x, e.y, e.z, { t: 'ev', id: e.id, k: 'pickup', by: p.id }, 48);
              this.remove(e); return;
            }
          }
        }
      }
      return;
    }
    const x0 = e.x, y0 = e.y, z0 = e.z;
    const pvx = e.vx, pvy = e.vy, pvz = e.vz;
    const inWater = IS_FLUID[world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))] === 1;
    const hitBlock = stepProjectile(world, e, 20, inWater ? 0.8 : 0.99, tmpHit);
    const target = this.hitEntityAlong(e, x0, y0, z0, e.x, e.y, e.z, e.age < 3 ? e.shooter : -1);
    if (target) {
      const speed = Math.hypot(e.vx, e.vy, e.vz);
      const dmg = Math.max(1, Math.ceil(e.damage * Math.min(1.2, speed / 40 + 0.3)));
      const shooter = this.server.entityById(e.shooter);
      this.server.damageEntity(target, dmg, shooter ? (shooter.type === 'player' ? 'arrow_player' : shooter.type === 'skeleton' ? 'skeleton' : 'arrow') : 'arrow', shooter, e.vx, e.vz);
      this.server.sound('arrow_hit', e.x, e.y, e.z, 0.6, 1.2);
      this.remove(e);
      return;
    }
    if (hitBlock) {
      e.stuck = true;
      e.age = 0;
      const n = Math.hypot(pvx, pvy, pvz) || 1;
      e.sx = Math.floor(e.x + pvx / n * 0.4); e.sy = Math.floor(e.y + 0.15 + pvy / n * 0.4); e.sz = Math.floor(e.z + pvz / n * 0.4);
      if (world.getBlock(e.sx, e.sy, e.sz) === 0) { e.sx = Math.floor(e.x); e.sy = Math.floor(e.y - 0.2); e.sz = Math.floor(e.z); }
      e.vx = e.vy = e.vz = 0;
      this.server.sound('arrow_hit', e.x, e.y, e.z, 0.6, 1.0);
      return;
    }
    const sp = Math.hypot(e.vx, e.vz);
    e.yaw = Math.atan2(-e.vx, -e.vz); e.pitch = Math.atan2(e.vy, sp);
    if (e.age > 600) this.remove(e);
  }

  tickEgg(e) {
    const world = this.server.world;
    const x0 = e.x, y0 = e.y, z0 = e.z;
    const hitBlock = stepProjectile(world, e, 20, 0.99, tmpHit);
    const target = this.hitEntityAlong(e, x0, y0, z0, e.x, e.y, e.z, e.age < 3 ? e.shooter : -1);
    if ((target || hitBlock || e.age > 200) && e.type === 'pearl') {
      const sh = this.server.entityById(e.shooter);
      if (sh && sh.type === 'player' && sh.alive) { this.server.teleport(sh, e.x, e.y + 0.2, e.z); this.server.damagePlayer(sh, 5, 'fall', null); }
      this.server.broadcastNear(e.x, e.y, e.z, { t: 'fx', k: 'poof', x: e.x, y: e.y, z: e.z }, 48);
      this.remove(e);
      return;
    }
    if (target || hitBlock || e.age > 200) {
      if (target) this.server.damageEntity(target, 0, 'egg', this.server.entityById(e.shooter), e.vx, e.vz);
      this.server.broadcastNear(e.x, e.y, e.z, { t: 'fx', k: 'eggbreak', x: e.x, y: e.y, z: e.z }, 48);
      if (world.rng() < 0.125) {
        const n = world.rng() < 1 / 32 ? 4 : 1;
        for (let i = 0; i < n; i++) this.spawnMob('chicken', e.x, e.y, e.z, { baby: true });
      }
      this.remove(e);
    }
  }

  // Eye of Ender: flies toward the nearest stronghold, then drops (80%) or shatters.
  spawnEyeSignal(p, tx, tz) {
    const e = new Entity(this.newId(), 'eye');
    e.x = p.x; e.y = p.y + p.eye; e.z = p.z; e.tx = tx; e.tz = tz;
    return this.add(e);
  }

  tickEye(e) {
    const dx = e.tx - e.x, dz = e.tz - e.z, d = Math.hypot(dx, dz) || 1;
    const sp = Math.min(d, 12) * 0.05;
    e.x += dx / d * sp; e.z += dz / d * sp; e.y += e.age < 30 ? 0.12 : -0.02;
    if (e.age >= 50) {
      if (this.server.world.rng() < 0.8) this.spawnItem(e.x, e.y, e.z, { id: 'eye_of_ender', count: 1 }, { vx: 0, vy: 0, vz: 0 });
      else this.server.broadcastNear(e.x, e.y, e.z, { t: 'fx', k: 'poof', x: e.x, y: e.y, z: e.z }, 48);
      this.remove(e);
    }
  }

  tickFirework(e) {
    e.vy += 1.0;
    e.vx *= 0.9; e.vz *= 0.9;
    collideMove(this.server.world, e.x, e.y, e.z, e.w, e.h, e.vx * C.DT, e.vy * C.DT, e.vz * C.DT, tmpHit);
    e.x += tmpHit.dx; e.y += tmpHit.dy; e.z += tmpHit.dz;
    if (e.age >= e.fuse || tmpHit.cy) {
      this.server.broadcastNear(e.x, e.y, e.z, { t: 'fx', k: 'firework', x: e.x, y: e.y, z: e.z, c: Math.floor(this.server.world.rng() * 6) }, 160);
      this.server.sound('firework_blast', e.x, e.y, e.z, 1.5, 1);
      this.remove(e);
    }
  }

  explosionDamage(x, y, z, r, source) {
    const reach = r * 2;
    const hitList = [];
    for (const p of this.server.players.values()) if (p.alive && p.gamemode !== 'spectator' && p.joined) hitList.push(p);
    for (const m of this.list.values()) if ((m instanceof Mob && !m.dead) || m.type === 'item') hitList.push(m);
    for (const t of hitList) {
      const cx = t.x, cy = t.y + (t.h || 0.25) / 2, cz = t.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > reach) continue;
      if (t.type === 'item') { if (d < r) this.remove(t); continue; }
      const impact = (1 - d / reach);
      const dmg = Math.floor((impact * impact + impact) / 2 * 7 * reach + 1);
      const scale = this.server.difficulty === 'easy' ? 0.5 : this.server.difficulty === 'hard' ? 1.5 : 1;
      const nx = (cx - x) / (d || 1), nz = (cz - z) / (d || 1);
      this.server.damageEntity(t, Math.max(1, Math.round(dmg * (t.type === 'player' ? scale : 1))), 'explosion', source, nx, nz, impact * 3);
    }
  }

  states() {
    const out = [];
    for (const e of this.list.values()) {
      if (e.type === 'arrow' && e.stuck && e.sentStuck) continue;
      if (e.type === 'item' && e.onGround && e.sentRest && Math.abs(e.vx) + Math.abs(e.vz) < 0.01) continue;
      out.push(e.state());
      if (e.type === 'arrow' && e.stuck) e.sentStuck = true;
      if (e.type === 'item') e.sentRest = e.onGround;
    }
    return out;
  }

  serializeNear(filter) {
    const out = [];
    for (const e of this.list.values()) {
      if (!filter(e)) continue;
      if (e instanceof Mob) out.push(e.serialize());
      else if (e.type === 'item') out.push({ type: 'item', x: e.x, y: e.y, z: e.z, item: [e.stack.id, e.stack.count, e.stack.dmg || 0], age: e.age });
    }
    return out;
  }

  restore(list) {
    for (const d of list || []) {
      if (d.type === 'item') {
        const st = { id: d.item[0], count: d.item[1] };
        if (d.item[2]) st.dmg = d.item[2];
        const e = this.spawnItem(d.x, d.y, d.z, st, { vx: 0, vy: 0, vz: 0, pickupDelay: 0 });
        if (e) e.age = d.age || 0;
      } else if (MOB_TYPES[d.type]) {
        const m = this.spawnMob(d.type, d.x, d.y, d.z, d);
        if (m) m.restore(d);
      }
    }
  }
}

export { ID };
