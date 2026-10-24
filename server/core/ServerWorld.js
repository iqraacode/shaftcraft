// Authoritative world state: chunk storage, persistent modifications, block updates,
// fluid simulation, falling blocks, random ticks, explosions and approximate lighting.
import { WorldGen } from '../../shared/worldgen.js';
import { chunkKey, blocksSky } from '../../shared/chunk.js';
import {
  BLOCKS, ID, IS_FLUID, IS_FULL, IS_SOLID, LIGHT_EMIT, canSurviveOn, FACING_VEC,
} from '../../shared/blocks.js';
import * as C from '../../shared/constants.js';
import { mulberry32 } from '../../shared/noise.js';
import { portalIntact } from './portals.js';

const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class ServerWorld {
  constructor(server, seed, type, modsData) {
    this.server = server;
    this.gen = new WorldGen(seed, type);
    this.chunks = new Map();
    this.mods = new Map(); // key -> Map(idx -> [id, meta])
    if (modsData) {
      for (const [k, arr] of Object.entries(modsData)) {
        const m = new Map();
        for (let i = 0; i < arr.length; i += 3) m.set(arr[i], [arr[i + 1], arr[i + 2]]);
        this.mods.set(k, m);
      }
    }
    this.scheduled = new Map(); // "x,y,z" -> {x,y,z,tick}
    this.changed = []; // flat [x,y,z,id,meta,...] for broadcast
    this.rng = mulberry32((seed ^ 0x5eed) | 0);
    this.tickCount = 0;
  }

  // ---------- chunk access ----------
  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = this.gen.generate(cx, cz);
      const mods = this.mods.get(key);
      if (mods) {
        for (const [i, [id, meta]] of mods) {
          const y = i >> 8, z = (i >> 4) & 15, x = i & 15;
          c.set(x, y, z, id, meta);
        }
      }
      c.emitters = null;
      c.lastUsed = this.tickCount;
      this.chunks.set(key, c);
      this.server.onChunkLoaded(c, key);
    }
    c.lastUsed = this.tickCount;
    return c;
  }

  hasChunk(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0 || y >= C.WORLD_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c.get(x & 15, y, z & 15);
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= C.WORLD_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c.getMeta(x & 15, y, z & 15);
  }

  modsOf(cx, cz) {
    const m = this.mods.get(chunkKey(cx, cz));
    if (!m) return [];
    const out = [];
    for (const [i, [id, meta]] of m) out.push(i, id, meta);
    return out;
  }

  // ---------- block changes ----------
  setBlock(x, y, z, id, meta = 0, opts = {}) {
    if (y < 0 || y >= C.WORLD_HEIGHT) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    const lx = x & 15, lz = z & 15;
    const old = c.get(lx, y, lz), oldMeta = c.getMeta(lx, y, lz);
    if (old === id && oldMeta === meta) return false;
    c.set(lx, y, lz, id, meta);
    const key = chunkKey(c.cx, c.cz);
    let m = this.mods.get(key);
    if (!m) { m = new Map(); this.mods.set(key, m); }
    m.set((y << 8) | (lz << 4) | lx, [id, meta]);
    if (c.emitters && (LIGHT_EMIT[old] || LIGHT_EMIT[id])) c.emitters = null;
    this.changed.push(x, y, z, id, meta);
    this.server.onBlockChanged(x, y, z, old, id, oldMeta, meta);
    if (!opts.noUpdate) {
      this.updateNeighbors(x, y, z);
    }
    return true;
  }

  updateNeighbors(x, y, z) {
    this.onNeighborChanged(x, y, z);
    for (const [dx, dy, dz] of DIRS6) this.onNeighborChanged(x + dx, y + dy, z + dz);
  }

  schedule(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    const at = this.tickCount + delay;
    const cur = this.scheduled.get(k);
    if (cur && cur.tick <= at) return;
    this.scheduled.set(k, { x, y, z, tick: at });
  }

  onNeighborChanged(x, y, z) {
    if (y < 0 || y >= C.WORLD_HEIGHT) return;
    const id = this.getBlock(x, y, z);
    if (id === 0) return;
    const b = BLOCKS[id];
    if (IS_FLUID[id]) { this.schedule(x, y, z, IS_FLUID[id] === 1 ? C.WATER_TICK_DELAY : C.LAVA_TICK_DELAY); return; }
    // fluids next to this block may need to flow into newly freed space
    if (b.falls) this.schedule(x, y, z, 2);
    if (b.needsSupport && !this.canStay(x, y, z, id, this.getMeta(x, y, z))) this.breakBlock(x, y, z, null, true);
    if (id === ID.nether_portal) { if (!portalIntact(this, x, y, z, this.getMeta(x, y, z))) this.setBlock(x, y, z, 0, 0); return; }
    if (id === ID.cactus) {
      for (const [dx, dz] of DIRS4) {
        if (IS_SOLID[this.getBlock(x + dx, y, z + dz)]) { this.breakBlock(x, y, z, null, true); return; }
      }
    }
  }

  canStay(x, y, z, id, meta) {
    const b = BLOCKS[id];
    const below = this.getBlock(x, y - 1, z);
    switch (b.name) {
      case 'torch': {
        if (!meta) return IS_SOLID[below] && (IS_FULL[below] || below === ID.farmland || below === ID.chest);
        const [dx, dz] = FACING_VEC[(meta - 1) & 3];
        return !!IS_FULL[this.getBlock(x - dx, y, z - dz)];
      }
      case 'ladder': {
        const [dx, dz] = FACING_VEC[meta & 3];
        return !!IS_FULL[this.getBlock(x - dx, y, z - dz)];
      }
      case 'door': {
        if (meta & 8) return this.getBlock(x, y - 1, z) === ID.door;
        return this.getBlock(x, y + 1, z) === ID.door && IS_SOLID[below] === 1;
      }
      case 'bed': {
        const f = meta & 3;
        const [dx, dz] = FACING_VEC[f];
        const s = meta & 4 ? -1 : 1;
        return this.getBlock(x + dx * s, y, z + dz * s) === ID.bed;
      }
      default:
        return canSurviveOn(id, below, meta);
    }
  }

  // Break a block, optionally dropping items as entities. `player` may be null.
  breakBlock(x, y, z, player, drop = true, ctx = null) {
    const id = this.getBlock(x, y, z);
    if (id === 0 || id === ID.bedrock && player && !player.isCreative()) return [];
    const meta = this.getMeta(x, y, z);
    const b = BLOCKS[id];
    let drops = [];
    if (drop) {
      const dctx = ctx || { rng: this.rng, tool: null, tier: -1 };
      if (b.drops) drops = b.drops(meta, dctx);
      else if (b.item) drops = [[b.item, 1]];
    }
    // containers spill contents
    if (b.container) this.server.containers.onBreak(x, y, z, drop);
    let replace = 0;
    if (id === ID.ice && drop && IS_SOLID[this.getBlock(x, y - 1, z)]) { replace = ID.water; }
    // multi-block structures: remove the other half silently first so it doesn't drop twice
    let other = null;
    if (id === ID.door) other = [x, meta & 8 ? y - 1 : y + 1, z];
    else if (id === ID.bed) { const [dx, dz] = FACING_VEC[meta & 3]; const s = meta & 4 ? -1 : 1; other = [x + dx * s, y, z + dz * s]; }
    if (other && this.getBlock(other[0], other[1], other[2]) === id) {
      if (id === ID.bed && drop && (meta & 4)) drops = [['bed', 1]];
      if (id === ID.door && drop && (meta & 8)) drops = [['door', 1]];
      this.setBlock(other[0], other[1], other[2], 0, 0, { noUpdate: true });
    }
    this.setBlock(x, y, z, replace, 0);
    if (other) this.updateNeighbors(other[0], other[1], other[2]);
    if (drop) for (const [item, count] of drops) if (count > 0) this.server.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, { id: item, count });
    this.server.broadcastNear(x, y, z, { t: 'fx', k: 'break', x, y, z, id, meta }, 48, player);
    return drops;
  }

  // ---------- simulation ----------
  tick() {
    this.tickCount++;
    // scheduled updates
    if (this.scheduled.size) {
      const due = [];
      for (const [k, s] of this.scheduled) if (s.tick <= this.tickCount) { due.push(s); this.scheduled.delete(k); }
      let budget = 4000;
      for (const s of due) {
        if (budget-- <= 0) { this.schedule(s.x, s.y, s.z, 1); continue; }
        if (!this.hasChunk(s.x >> 4, s.z >> 4)) continue;
        this.runScheduled(s.x, s.y, s.z);
      }
    }
    this.randomTicks();
  }

  runScheduled(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (IS_FLUID[id]) this.fluidTick(x, y, z, id);
    else if (BLOCKS[id].falls) {
      const below = this.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || IS_FLUID[below] || BLOCKS[below].replaceable)) {
        const meta = this.getMeta(x, y, z);
        this.setBlock(x, y, z, 0, 0);
        this.server.entities.spawnFalling(x + 0.5, y, z + 0.5, id, meta);
      }
    }
  }

  canFlowInto(id) {
    if (id === 0) return true;
    if (IS_FLUID[id] || id === ID.sugar_cane) return false;
    const b = BLOCKS[id];
    return b.replaceable || b.shape === 'cross' || b.shape === 'crop' || b.shape === 'snow' || b.shape === 'torch';
  }

  fluidTick(x, y, z, id) {
    const water = IS_FLUID[id] === 1;
    const step = water ? 1 : 2;
    const maxLvl = water ? 7 : 6;
    let meta = this.getMeta(x, y, z);
    const other = water ? ID.lava : ID.water;

    // lava touching water hardens
    if (!water) {
      for (const [dx, dy, dz] of DIRS6) {
        if (dy === -1) continue;
        if (this.getBlock(x + dx, y + dy, z + dz) === ID.water) {
          this.setBlock(x, y, z, meta === 0 ? ID.obsidian : ID.cobblestone, 0);
          this.server.broadcastNear(x, y, z, { t: 'fx', k: 'fizz', x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 32);
          return;
        }
      }
    }

    const level = meta & 7, falling = (meta & 8) !== 0;
    if (level !== 0 || falling) {
      let newMeta = -1;
      if (this.getBlock(x, y + 1, z) === id) newMeta = 8;
      else {
        let minN = 99, sources = 0;
        for (const [dx, dz] of DIRS4) {
          if (this.getBlock(x + dx, y, z + dz) !== id) continue;
          const nm = this.getMeta(x + dx, y, z + dz);
          const nl = nm & 8 ? 0 : nm & 7;
          if (nm === 0) sources++;
          if (nl < minN) minN = nl;
        }
        const below = this.getBlock(x, y - 1, z);
        if (water && sources >= 2 && (IS_SOLID[below] || (below === id && this.getMeta(x, y - 1, z) === 0))) newMeta = 0;
        else if (minN === 99) newMeta = -1;
        else {
          const nl = minN + step;
          newMeta = nl > maxLvl ? -1 : nl;
        }
      }
      if (newMeta === -1) { this.setBlock(x, y, z, 0, 0); return; }
      if (newMeta !== meta) {
        this.setBlock(x, y, z, id, newMeta);
        meta = newMeta;
      }
    }

    // spread
    const belowId = this.getBlock(x, y - 1, z);
    let canDown = false;
    if (y > 0) {
      if (belowId === other) {
        this.setBlock(x, y - 1, z, water ? ID.cobblestone : ID.stone, 0);
      } else if (belowId === id) {
        const bm = this.getMeta(x, y - 1, z);
        if (bm !== 0 && bm !== 8) this.setBlock(x, y - 1, z, id, 8);
        canDown = bm !== 0;
      } else if (this.canFlowInto(belowId)) {
        this.destroyForFluid(x, y - 1, z, belowId);
        this.setBlock(x, y - 1, z, id, 8);
        canDown = true;
      }
    }
    const isSource = meta === 0;
    if (canDown && !isSource) return;
    if (!canDown && belowId === id && !isSource) return;
    const lvl = meta & 8 ? 0 : meta & 7;
    const nl = (meta & 8) ? step : lvl + step;
    if (nl > maxLvl) return;
    const dirs = this.flowDirs(x, y, z, id, water ? 4 : 2);
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const nid = this.getBlock(nx, y, nz);
      if (nid === id) {
        const nm = this.getMeta(nx, y, nz);
        if (nm === 0 || nm & 8) continue;
        if ((nm & 7) <= nl) continue;
        this.setBlock(nx, y, nz, id, nl);
      } else if (nid === other) {
        const lavaSource = water && this.getMeta(nx, y, nz) === 0;
        this.setBlock(nx, y, nz, lavaSource ? ID.obsidian : ID.cobblestone, 0);
      } else if (this.canFlowInto(nid)) {
        this.destroyForFluid(nx, y, nz, nid);
        this.setBlock(nx, y, nz, id, nl);
      }
    }
  }

  destroyForFluid(x, y, z, id) {
    if (id === 0 || IS_FLUID[id]) return;
    const b = BLOCKS[id];
    let drops = [];
    if (b.drops) drops = b.drops(this.getMeta(x, y, z), { rng: this.rng, tool: null, tier: -1 });
    else if (b.item) drops = [[b.item, 1]];
    for (const [item, count] of drops) if (count > 0) this.server.entities.spawnItem(x + 0.5, y + 0.3, z + 0.5, { id: item, count });
  }

  // Directions toward the nearest drop within `range`; all open directions if none found.
  flowDirs(x, y, z, id, range) {
    const open = [];
    let best = 99;
    const res = [];
    for (const [dx, dz] of DIRS4) {
      const nid = this.getBlock(x + dx, y, z + dz);
      if (!(this.canFlowInto(nid) || nid === id || IS_FLUID[nid])) continue;
      if (nid === id && this.getMeta(x + dx, y, z + dz) === 0) continue;
      open.push([dx, dz]);
      const d = this.holeDistance(x + dx, y, z + dz, id, range, -dx, -dz);
      res.push(d);
      if (d < best) best = d;
    }
    if (best === 99) return open;
    return open.filter((_, i) => res[i] === best);
  }

  holeDistance(sx, y, sz, id, range, bx, bz) {
    // BFS over flowable cells looking for a cell with a replaceable block beneath.
    const q = [[sx, sz, 0]];
    const seen = new Set([sx + ',' + sz, (sx + bx) + ',' + (sz + bz)]);
    while (q.length) {
      const [cx, cz, d] = q.shift();
      const below = this.getBlock(cx, y - 1, cz);
      if (this.canFlowInto(below) || below === id) return d;
      if (d >= range) continue;
      for (const [dx, dz] of DIRS4) {
        const nx = cx + dx, nz = cz + dz;
        const k = nx + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const nid = this.getBlock(nx, y, nz);
        if (this.canFlowInto(nid) || (nid === id && this.getMeta(nx, y, nz) !== 0)) q.push([nx, nz, d + 1]);
      }
    }
    return 99;
  }

  randomTicks() {
    const players = this.server.activePlayers();
    if (!players.length) return;
    const seen = new Set();
    const r = 4;
    for (const p of players) {
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const key = chunkKey(pcx + dx, pcz + dz);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = this.chunks.get(key);
        if (!c) continue;
        const sections = c.height >> 4;
        for (let s = 0; s < sections; s++) {
          for (let n = 0; n < C.RANDOM_TICKS_PER_SECTION; n++) {
            const v = (this.rng() * 4096) | 0;
            const lx = v & 15, lz = (v >> 4) & 15, ly = (s << 4) | (v >> 8);
            const id = c.get(lx, ly, lz);
            if (id === 0 || id === ID.stone) continue;
            this.randomTick(c.cx * 16 + lx, ly, c.cz * 16 + lz, id, c);
          }
        }
      }
    }
  }

  randomTick(x, y, z, id, c) {
    switch (id) {
      case ID.grass: {
        const above = this.getBlock(x, y + 1, z);
        if (IS_FULL[above] || IS_FLUID[above]) { this.setBlock(x, y, z, ID.dirt, 0); return; }
        for (let i = 0; i < 2; i++) {
          const tx = x + Math.floor(this.rng() * 3) - 1, ty = y + Math.floor(this.rng() * 5) - 3, tz = z + Math.floor(this.rng() * 3) - 1;
          if (this.getBlock(tx, ty, tz) === ID.dirt) {
            const a = this.getBlock(tx, ty + 1, tz);
            if (!IS_FULL[a] && !IS_FLUID[a] && this.lightAt(tx, ty + 1, tz, true) >= 9) this.setBlock(tx, ty, tz, ID.grass, 0);
          }
        }
        return;
      }
      case ID.wheat: {
        const m = this.getMeta(x, y, z);
        if (m < 7 && this.rng() < 0.35 && this.lightAt(x, y, z, true) >= 9) this.setBlock(x, y, z, ID.wheat, m + 1);
        return;
      }
      case ID.oak_sapling: case ID.spruce_sapling: {
        if (this.rng() < 0.15 && this.lightAt(x, y + 1, z, true) >= 9) this.growTree(x, y, z, id === ID.oak_sapling ? 'oak' : 'spruce');
        return;
      }
      case ID.sugar_cane: case ID.cactus: {
        if (this.getBlock(x, y + 1, z) !== 0) return;
        let h = 1;
        while (this.getBlock(x, y - h, z) === id) h++;
        if (h >= 3) return;
        const m = this.getMeta(x, y, z);
        if (m >= 15) { this.setBlock(x, y + 1, z, id, 0); this.setBlock(x, y, z, id, 0, { noUpdate: true }); }
        else this.setBlock(x, y, z, id, m + 1, { noUpdate: true });
        return;
      }
      case ID.leaves: case ID.spruce_leaves: {
        const m = this.getMeta(x, y, z);
        if (m & 4) return; // player placed
        if (!this.logNearby(x, y, z, 4)) this.breakBlock(x, y, z, null, true);
        return;
      }
      case ID.farmland: {
        const above = this.getBlock(x, y + 1, z);
        if (IS_SOLID[above] && above !== ID.wheat) this.setBlock(x, y, z, ID.dirt, 0);
        return;
      }
      default: void c;
    }
  }

  logNearby(x, y, z, range) {
    const q = [[x, y, z, 0]];
    const seen = new Set([x + ',' + y + ',' + z]);
    while (q.length) {
      const [cx, cy, cz, d] = q.shift();
      for (const [dx, dy, dz] of DIRS6) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = this.getBlock(nx, ny, nz);
        if (id === ID.oak_log || id === ID.spruce_log) return true;
        if ((id === ID.leaves || id === ID.spruce_leaves) && d + 1 < range) q.push([nx, ny, nz, d + 1]);
      }
    }
    return false;
  }

  growTree(x, y, z, type) {
    const seed = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ this.tickCount;
    const blocks = this.gen.treeBlocks(type, x, y, z, seed);
    // check trunk space
    for (const [bx, by, bz, id] of blocks) {
      if (id === ID.oak_log || id === ID.spruce_log) {
        const cur = this.getBlock(bx, by, bz);
        if (!(bx === x && by === y && bz === z) && cur !== 0 && !BLOCKS[cur].replaceable && !BLOCKS[cur].leaves) return false;
      }
    }
    this.setBlock(x, y, z, 0, 0, { noUpdate: true });
    for (const [bx, by, bz, id, onlyAir] of blocks) {
      const cur = this.getBlock(bx, by, bz);
      if (onlyAir && cur !== 0 && !BLOCKS[cur].replaceable) continue;
      if (!onlyAir && cur !== 0 && !BLOCKS[cur].replaceable && !BLOCKS[cur].leaves && !(bx === x && by === y && bz === z)) continue;
      this.setBlock(bx, by, bz, id, 0, { noUpdate: true });
    }
    return true;
  }

  // ---------- light approximation for spawning / growth ----------
  skyExposed(x, y, z) {
    if (y >= C.WORLD_HEIGHT) return true;
    const c = this.getChunk(x >> 4, z >> 4);
    return y >= c.heightmap[((z & 15) << 4) | (x & 15)];
  }

  topY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c.heightmap[((z & 15) << 4) | (x & 15)];
  }

  emittersOf(c) {
    if (c.emitters) return c.emitters;
    const e = [];
    const B = c.blocks;
    for (let i = 0; i < B.length; i++) {
      const l = LIGHT_EMIT[B[i]];
      if (l) e.push(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), l);
    }
    c.emitters = e;
    return e;
  }

  blockLightAt(x, y, z) {
    let best = 0;
    const cx = x >> 4, cz = z >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!this.hasChunk(cx + dx, cz + dz)) continue;
      const e = this.emittersOf(this.getChunk(cx + dx, cz + dz));
      for (let i = 0; i < e.length; i += 4) {
        const d = Math.abs(e[i] - x) + Math.abs(e[i + 1] - y) + Math.abs(e[i + 2] - z);
        const l = e[i + 3] - d;
        if (l > best) { best = l; if (best >= 15) return 15; }
      }
    }
    return best;
  }

  // Combined light. withSky: include skylight scaled by time of day.
  lightAt(x, y, z, withSky) {
    let l = this.blockLightAt(x, y, z);
    if (withSky && this.skyExposed(x, y, z)) l = Math.max(l, Math.round(15 * this.server.skyFactor()));
    return l;
  }

  // ---------- explosions ----------
  explode(x, y, z, radius, source, opts = {}) {
    const r = radius;
    const destroyed = [];
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) for (let dz = -ir; dz <= ir; dz++) for (let dx = -ir; dx <= ir; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r * (0.7 + this.rng() * 0.6)) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      const id = this.getBlock(bx, by, bz);
      if (id === 0 || id === ID.bedrock || IS_FLUID[id]) continue;
      destroyed.push([bx, by, bz, id, this.getMeta(bx, by, bz)]);
    }
    if (opts.noBlocks) destroyed.length = 0;
    for (const [bx, by, bz, id, meta] of destroyed) {
      if (this.getBlock(bx, by, bz) !== id) continue;
      const b = BLOCKS[id];
      if (b.container) this.server.containers.onBreak(bx, by, bz, true);
      this.setBlock(bx, by, bz, 0, 0);
      if (this.rng() < C.CREEPER_DROP_CHANCE) {
        let drops = b.drops ? b.drops(meta, { rng: this.rng, tool: 'pickaxe', tier: 3 }) : (b.item ? [[b.item, 1]] : []);
        for (const [item, count] of drops) if (count > 0) this.server.entities.spawnItem(bx + 0.5, by + 0.5, bz + 0.5, { id: item, count });
      }
    }
    this.server.entities.explosionDamage(x, y, z, r, source);
    this.server.broadcastNear(x, y, z, { t: 'fx', k: 'explode', x, y, z, r }, 96);
    this.server.sound('explode', x, y, z, 1, 1);
  }

  // Unload chunks that are far from all players.
  unloadFar(players) {
    for (const [key, c] of this.chunks) {
      let keep = false;
      for (const p of players) {
        const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
        if (Math.abs(c.cx - pcx) <= C.SERVER_KEEP_RADIUS && Math.abs(c.cz - pcz) <= C.SERVER_KEEP_RADIUS) { keep = true; break; }
      }
      if (keep || this.tickCount - c.lastUsed < 200) continue;
      this.server.onChunkUnload(c, key);
      this.chunks.delete(key);
    }
  }

  serializeMods() {
    const out = {};
    for (const [k, m] of this.mods) {
      if (!m.size) continue;
      const arr = [];
      for (const [i, [id, meta]] of m) arr.push(i, id, meta);
      out[k] = arr;
    }
    return out;
  }

  isSolidAt(x, y, z) { return IS_SOLID[this.getBlock(x, y, z)] === 1; }
  blocksSkyAt(x, y, z) { return blocksSky(this.getBlock(x, y, z)); }
}
