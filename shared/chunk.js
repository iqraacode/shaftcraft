// Chunk storage shared by client and server.
// Blocks are stored up to `height` (multiple of 16); everything above is implicit air
// with full sky light. Block metadata is sparse (Map index -> value).
import { WORLD_HEIGHT, CHUNK_SIZE } from './constants.js';
import { IS_SOLID, IS_FLUID, LIGHT_OPACITY } from './blocks.js';

export const SECTION = 16;

export function chunkKey(cx, cz) { return cx + ',' + cz; }
export function idx(x, y, z) { return (y << 8) | (z << 4) | x; }

// Blocks that stop rain / define the "sky exposed" surface.
export function blocksSky(id) { return id !== 0 && (IS_SOLID[id] || IS_FLUID[id] || LIGHT_OPACITY[id] > 0); }

export class Chunk {
  constructor(cx, cz, height = 0, withLight = false) {
    this.cx = cx; this.cz = cz;
    this.height = 0;
    this.blocks = new Uint8Array(0);
    this.light = withLight ? new Uint8Array(0) : null;
    this.meta = new Map();
    this.heightmap = new Uint8Array(256); // y+1 of top sky-blocking block
    this.biomes = new Uint8Array(256);
    this.withLight = withLight;
    if (height > 0) this.ensureHeight(height - 1);
  }

  ensureHeight(y) {
    if (y < this.height) return;
    let nh = Math.min(WORLD_HEIGHT, (((y >> 4) + 1) << 4));
    if (nh <= this.height) return;
    const nb = new Uint8Array(nh << 8);
    nb.set(this.blocks);
    this.blocks = nb;
    if (this.withLight) {
      const nl = new Uint8Array(nh << 8);
      nl.set(this.light);
      nl.fill(0xf0, this.height << 8);
      this.light = nl;
    }
    this.height = nh;
  }

  get(x, y, z) {
    if (y < 0 || y >= this.height) return 0;
    return this.blocks[(y << 8) | (z << 4) | x];
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= this.height) return 0;
    return this.meta.get((y << 8) | (z << 4) | x) || 0;
  }

  // Raw set (no lighting/heightmap side effects beyond heightmap maintenance)
  set(x, y, z, id, meta = 0) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    if (id !== 0) this.ensureHeight(y);
    else if (y >= this.height) return;
    const i = (y << 8) | (z << 4) | x;
    this.blocks[i] = id;
    if (meta) this.meta.set(i, meta); else this.meta.delete(i);
    const c = (z << 4) | x;
    const hm = this.heightmap[c];
    if (blocksSky(id)) { if (y + 1 > hm) this.heightmap[c] = y + 1; }
    else if (y + 1 === hm) this.recomputeColumn(x, z);
  }

  setMeta(x, y, z, meta) {
    if (y < 0 || y >= this.height) return;
    const i = (y << 8) | (z << 4) | x;
    if (meta) this.meta.set(i, meta); else this.meta.delete(i);
  }

  recomputeColumn(x, z) {
    let y = this.height - 1;
    while (y >= 0 && !blocksSky(this.blocks[(y << 8) | (z << 4) | x])) y--;
    this.heightmap[(z << 4) | x] = y + 1;
  }

  recomputeHeightmap() {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) this.recomputeColumn(x, z);
  }

  // Shrink allocated height to the highest non-air layer (used after generation).
  trim() {
    let top = -1;
    for (let i = this.blocks.length - 1; i >= 0; i--) if (this.blocks[i]) { top = i >> 8; break; }
    const nh = Math.min(WORLD_HEIGHT, ((top >> 4) + 1) << 4);
    if (nh < this.height) {
      this.blocks = this.blocks.slice(0, nh << 8);
      if (this.light) this.light = this.light.slice(0, nh << 8);
      this.height = nh;
    }
  }

  metaEntries() {
    const out = [];
    for (const [k, v] of this.meta) out.push(k, v);
    return out;
  }
}

export function worldToChunk(v) { return Math.floor(v / CHUNK_SIZE); }
export function localCoord(v) { return ((v % 16) + 16) % 16; }
