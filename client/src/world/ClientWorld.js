// Client-side world: chunk storage with light, incremental flood-fill light updates
// (sky + block channels), dirty tracking for remeshing and padded mesh-job extraction.
import { Chunk, chunkKey } from '../../../shared/chunk.js';
import { LIGHT_OPACITY, LIGHT_EMIT, IS_FLUID } from '../../../shared/blocks.js';
import { WORLD_HEIGHT } from '../../../shared/constants.js';
import { UNLOADED } from '../../../shared/physics.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class ClientWorld {
  constructor() {
    this.chunks = new Map();
    this.dirty = new Set();
    this.lastKey = null; this.lastChunk = null;
    this.blockChangeListeners = [];
  }

  chunkAt(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.lastChunk;
    if (c && c.cx === cx && c.cz === cz) return c;
    const n = this.chunks.get(chunkKey(cx, cz)) || null;
    if (n) this.lastChunk = n;
    return n;
  }

  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)) || null; }
  hasChunk(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }

  // For physics: unloaded chunks are solid.
  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return UNLOADED;
    return c.get(x & 15, y, z & 15);
  }

  getBlockRaw(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.get(x & 15, y, z & 15) : 0;
  }

  getMeta(x, y, z) {
    const c = this.chunkAt(x, z);
    return c ? c.getMeta(x & 15, y, z & 15) : 0;
  }

  getLight(x, y, z) {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0xf0;
    if (y >= c.height) return 0xf0;
    return c.light[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  heightAt(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.heightmap[((z & 15) << 4) | (x & 15)] : 0;
  }

  biomeAt(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.biomes[((z & 15) << 4) | (x & 15)] : 0;
  }

  // ---- chunk lifecycle ----
  addChunk(d) {
    const c = new Chunk(d.cx, d.cz, 0, true);
    c.height = d.height;
    c.blocks = d.blocks;
    c.light = d.light;
    c.heightmap = d.heightmap;
    c.biomes = d.biomes;
    for (let i = 0; i < d.meta.length; i += 2) c.meta.set(d.meta[i], d.meta[i + 1]);
    const key = chunkKey(d.cx, d.cz);
    this.chunks.set(key, c);
    this.lastChunk = null;
    this.stitch(c);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.dirty.add(chunkKey(d.cx + dx, d.cz + dz));
    return c;
  }

  removeChunk(cx, cz) {
    this.chunks.delete(chunkKey(cx, cz));
    this.lastChunk = null;
    this.dirty.delete(chunkKey(cx, cz));
  }

  clear() { this.chunks.clear(); this.dirty.clear(); this.lastChunk = null; }

  // ---- light helpers ----
  getL(x, y, z, shift) {
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    if (y >= c.height) return shift === 4 ? 15 : 0;
    return (c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] >> shift) & 15;
  }

  setL(c, x, y, z, shift, v) {
    if (y >= c.height) { if (shift === 4 && v === 15) return; c.ensureHeight(y); }
    const lx = x & 15, lz = z & 15;
    const i = (y << 8) | (lz << 4) | lx;
    c.light[i] = (c.light[i] & ~(15 << shift)) | (v << shift);
    this.markDirtyAt(c, lx, lz);
  }

  markDirtyAt(c, lx, lz) {
    const cx = c.cx, cz = c.cz;
    this.dirty.add(chunkKey(cx, cz));
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cz));
    else if (lx === 15) this.dirty.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cz - 1));
    else if (lz === 15) this.dirty.add(chunkKey(cx, cz + 1));
    if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) this.dirty.add(chunkKey(cx + (lx ? 1 : -1), cz + (lz ? 1 : -1)));
  }

  increase(q, shift) {
    let guard = 0;
    while (q.length) {
      const z = q.pop(), y = q.pop(), x = q.pop();
      if (++guard > 2000000) break;
      const L = this.getL(x, y, z, shift);
      if (L <= 1 && !(shift === 4 && L === 15)) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const c = this.chunkAt(nx, nz);
        if (!c) continue;
        const id = ny < c.height ? c.blocks[(ny << 8) | ((nz & 15) << 4) | (nx & 15)] : 0;
        const op = LIGHT_OPACITY[id];
        if (op >= 15) continue;
        const nl = (shift === 4 && d === 3 && L === 15 && op === 0) ? 15 : L - Math.max(1, op);
        if (nl <= 0) continue;
        if (nl <= this.getL(nx, ny, nz, shift)) continue;
        this.setL(c, nx, ny, nz, shift, nl);
        q.push(nx, ny, nz);
      }
    }
  }

  removal(rq, shift, relight) {
    let guard = 0;
    while (rq.length) {
      const old = rq.pop(), z = rq.pop(), y = rq.pop(), x = rq.pop();
      if (++guard > 2000000) break;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const c = this.chunkAt(nx, nz);
        if (!c) continue;
        if (ny >= c.height) { if (shift === 4) relight.push(nx, ny, nz); continue; }
        const nl = this.getL(nx, ny, nz, shift);
        if (nl === 0) continue;
        if (nl < old || (shift === 4 && d === 3 && old === 15 && nl === 15)) {
          this.setL(c, nx, ny, nz, shift, 0);
          rq.push(nx, ny, nz, nl);
        } else relight.push(nx, ny, nz);
      }
    }
  }

  updateLightAt(x, y, z) {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const id = this.getBlockRaw(x, y, z);
    for (const shift of [4, 0]) {
      const relight = [];
      const old = this.getL(x, y, z, shift);
      if (old > 0 && y < c.height) {
        this.setL(c, x, y, z, shift, 0);
        this.removal([x, y, z, old], shift, relight);
      }
      if (shift === 0 && LIGHT_EMIT[id]) { this.setL(c, x, y, z, 0, LIGHT_EMIT[id]); relight.push(x, y, z); }
      for (const [dx, dy, dz] of DIRS) relight.push(x + dx, y + dy, z + dz);
      this.increase(relight, shift);
    }
  }

  // Propagate light across borders with already-loaded neighbors.
  stitch(c) {
    const qs = [], qb = [];
    const x0 = c.cx * 16, z0 = c.cz * 16;
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of sides) {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n) continue;
      const H = Math.max(c.height, n.height);
      for (let y = 0; y < H; y++) for (let k = 0; k < 16; k++) {
        // cell in c on the border, and the touching cell in n
        let ax, az, bx, bz;
        if (dx === -1) { ax = x0; az = z0 + k; bx = x0 - 1; bz = az; }
        else if (dx === 1) { ax = x0 + 15; az = z0 + k; bx = x0 + 16; bz = az; }
        else if (dz === -1) { ax = x0 + k; az = z0; bx = ax; bz = z0 - 1; }
        else { ax = x0 + k; az = z0 + 15; bx = ax; bz = z0 + 16; }
        const la = this.getLight(ax, y, az), lb = this.getLight(bx, y, bz);
        if ((la >> 4) > (lb >> 4) + 1) qs.push(ax, y, az); else if ((lb >> 4) > (la >> 4) + 1) qs.push(bx, y, bz);
        if ((la & 15) > (lb & 15) + 1) qb.push(ax, y, az); else if ((lb & 15) > (la & 15) + 1) qb.push(bx, y, bz);
      }
    }
    if (qs.length) this.increase(qs, 4);
    if (qb.length) this.increase(qb, 0);
  }

  // ---- block updates (from server or prediction) ----
  setBlock(x, y, z, id, meta = 0) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x & 15, lz = z & 15;
    const old = c.get(lx, y, lz), oldMeta = c.getMeta(lx, y, lz);
    if (old === id && oldMeta === meta) return false;
    const oldHeight = c.height;
    c.set(lx, y, lz, id, meta);
    if (c.height !== oldHeight) {
      // grew: new light cells were filled with sky 15 by ensureHeight
    }
    this.markDirtyAt(c, lx, lz);
    if (y + 1 >= c.height - 1) this.dirty.add(chunkKey(c.cx, c.cz));
    if (LIGHT_OPACITY[old] !== LIGHT_OPACITY[id] || LIGHT_EMIT[old] !== LIGHT_EMIT[id]) this.updateLightAt(x, y, z);
    // fluids/neighbors affect AO & fluid heights of adjacent cells
    if (IS_FLUID[id] || IS_FLUID[old]) {
      for (const [dx, , dz] of DIRS) { const n = this.chunkAt(x + dx, z + dz); if (n) this.markDirtyAt(n, (x + dx) & 15, (z + dz) & 15); }
    }
    for (const l of this.blockChangeListeners) l(x, y, z, old, id);
    return true;
  }

  // Build padded arrays (18x18xH) for the mesher. Requires all 8 neighbors.
  buildMeshJob(cx, cz) {
    let H = 0;
    const cs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.getChunk(cx + dx, cz + dz);
      if (!c) return null;
      cs.push([dx, dz, c]);
      if (c.height > H) H = c.height;
    }
    H = Math.min(WORLD_HEIGHT, H);
    const N = 18 * 18 * H;
    const blocks = new Uint8Array(N);
    const light = new Uint8Array(N).fill(0xf0);
    const meta = new Uint8Array(N);
    const biome = new Uint8Array(18 * 18);
    for (const [dx, dz, c] of cs) {
      const xs = dx === -1 ? [15, 15] : dx === 1 ? [0, 0] : [0, 15];
      const zs = dz === -1 ? [15, 15] : dz === 1 ? [0, 0] : [0, 15];
      const px0 = dx * 16 + xs[0];
      const len = xs[1] - xs[0] + 1;
      const ch = Math.min(c.height, H);
      for (let lz = zs[0]; lz <= zs[1]; lz++) {
        const pz = dz * 16 + lz;
        for (let y = 0; y < ch; y++) {
          const src = (y << 8) | (lz << 4) | xs[0];
          const dst = (y * 18 + (pz + 1)) * 18 + (px0 + 1);
          blocks.set(c.blocks.subarray(src, src + len), dst);
          light.set(c.light.subarray(src, src + len), dst);
        }
        for (let lx = xs[0]; lx <= xs[1]; lx++) biome[(pz + 1) * 18 + (dx * 16 + lx + 1)] = c.biomes[(lz << 4) | lx];
      }
      for (const [i, v] of c.meta) {
        const y = i >> 8, lz = (i >> 4) & 15, lx = i & 15;
        if (lx < xs[0] || lx > xs[1] || lz < zs[0] || lz > zs[1] || y >= H) continue;
        meta[(y * 18 + (dz * 16 + lz + 1)) * 18 + (dx * 16 + lx + 1)] = v;
      }
    }
    return { cx, cz, H, blocks, light, meta, biome };
  }

  memoryEstimate() {
    let bytes = 0;
    for (const c of this.chunks.values()) bytes += c.blocks.length * 2 + c.meta.size * 16 + 512;
    return bytes;
  }
}
