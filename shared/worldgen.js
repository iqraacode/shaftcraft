// Deterministic world generator. Given a seed it produces identical chunks on client and server.
import { Simplex, rngFor, hash3, mulberry32 } from './noise.js';
import { Chunk } from './chunk.js';
import { ID } from './blocks.js';
import { placeVillages } from './villages.js';
import { dimensionAt } from './dimensions.js';
import { NetherGen } from './nethergen.js';
import { EndGen } from './endgen.js';
import { placeStrongholds } from './strongholds.js';
import { SEA_LEVEL, ORES, SUPERFLAT_LAYERS, BEDROCK_TOP } from './constants.js';

export const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY: 3 };
export const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy', 'Nether', 'The End'];
// Biome tint colors [grass, foliage, water]
export const BIOME_COLORS = [
  [0x91bd59, 0x77ab2f, 0x3f76e4],
  [0x79c05a, 0x59ae30, 0x3f76e4],
  [0xbfb755, 0xaea42a, 0x32a5c8],
  [0x80b497, 0x60a17b, 0x3d57d6],
  [0xbfb755, 0xaea42a, 0x3f76e4], // nether (unused tints)
  [0xbfb755, 0xaea42a, 0x3f76e4], // end (unused tints)
];
export const SPRUCE_COLOR = 0x619961;

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class WorldGen {
  constructor(seed, type = 'default') {
    this.seed = seed | 0;
    this.type = type;
    const s = this.seed;
    this.cont = new Simplex(s + 101);
    this.hills = new Simplex(s + 202);
    this.detail = new Simplex(s + 303);
    this.temp = new Simplex(s + 404);
    this.hum = new Simplex(s + 505);
    this.cave1 = new Simplex(s + 606);
    this.cave2 = new Simplex(s + 707);
    this.cheese = new Simplex(s + 808);
    this.mount = new Simplex(s + 909);
    this.surf = new Simplex(s + 1111);
  }

  heightAt(x, z) {
    if (this.type === 'flat') return this.flatTop();
    const c = this.cont.fbm2(x / 700, z / 700, 4);
    let h = SEA_LEVEL + 3 + c * 30;
    const m = smoothstep(0.05, 0.6, this.mount.fbm2(x / 420, z / 420, 3) + c * 0.3);
    const land = smoothstep(-0.2, 0.05, c);
    h += this.hills.fbm2(x / 170, z / 170, 4) * (5 + 34 * m * land);
    h += this.detail.noise2(x / 26, z / 26) * 2.2;
    return Math.max(6, Math.min(200, Math.floor(h)));
  }

  flatTop() { let n = 0; for (const [, c] of SUPERFLAT_LAYERS) n += c; return n - 1; }

  biomeAt(x, z) {
    const dim = dimensionAt(x, z);
    if (dim === 'nether') return 4;
    if (dim === 'end') return 5;
    if (this.type === 'flat') return BIOME.PLAINS;
    const t = this.temp.fbm2(x / 520, z / 520, 2);
    const h = this.hum.fbm2(x / 470, z / 470, 2);
    if (t > 0.3 && h < 0.12) return BIOME.DESERT;
    if (t < -0.28) return BIOME.SNOWY;
    if (h > 0.12) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  // Tree / cactus features whose origin lies in chunk (cx, cz). Deterministic and independent
  // of neighbors so that chunks can be generated in any order.
  featuresFor(cx, cz) {
    if (this.type === 'flat') return [];
    const rng = rngFor(this.seed, cx, 0x7ee5, cz);
    const centerBiome = this.biomeAt(cx * 16 + 8, cz * 16 + 8);
    let attempts = 0;
    if (centerBiome === BIOME.FOREST) attempts = 7 + Math.floor(rng() * 4);
    else if (centerBiome === BIOME.PLAINS) attempts = rng() < 0.35 ? 1 : 0;
    else if (centerBiome === BIOME.SNOWY) attempts = 2 + Math.floor(rng() * 3);
    else if (centerBiome === BIOME.DESERT) attempts = rng() < 0.6 ? 2 : 0;
    const out = [];
    for (let i = 0; i < attempts; i++) {
      const lx = Math.floor(rng() * 16), lz = Math.floor(rng() * 16);
      const wx = cx * 16 + lx, wz = cz * 16 + lz;
      const biome = this.biomeAt(wx, wz);
      const h = this.heightAt(wx, wz);
      const r = rng(), r2 = rng();
      if (h <= SEA_LEVEL + 1) continue;
      if (biome === BIOME.DESERT) {
        out.push({ type: 'cactus', x: wx, y: h + 1, z: wz, size: 1 + Math.floor(r * 3) });
      } else if (biome === BIOME.SNOWY || (biome === BIOME.FOREST && r2 < 0.12)) {
        out.push({ type: 'spruce', x: wx, y: h + 1, z: wz, size: 6 + Math.floor(r * 4), seed: hash3(this.seed, wx, 7, wz) });
      } else if (biome !== BIOME.DESERT) {
        out.push({ type: 'oak', x: wx, y: h + 1, z: wz, size: 4 + Math.floor(r * 3), seed: hash3(this.seed, wx, 3, wz) });
      }
    }
    return out;
  }

  generate(cx, cz) {
    const chunk = new Chunk(cx, cz, 0, false);
    if (dimensionAt(cx * 16 + 8, cz * 16 + 8) === 'end') return (this.end || (this.end = new EndGen(this.seed))).generate(chunk);
    if (dimensionAt(cx * 16 + 8, cz * 16 + 8) === 'nether') return (this.nether || (this.nether = new NetherGen(this.seed))).generate(chunk);
    if (this.type === 'flat') return this.generateFlat(chunk);
    const x0 = cx * 16, z0 = cz * 16;
    const heights = new Int32Array(256);
    let maxH = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = this.heightAt(x0 + x, z0 + z);
      heights[(z << 4) | x] = h;
      chunk.biomes[(z << 4) | x] = this.biomeAt(x0 + x, z0 + z);
      if (h > maxH) maxH = h;
    }
    const top = Math.max(maxH, SEA_LEVEL) + 1;
    chunk.ensureHeight(top + 16);
    const B = chunk.blocks;

    // --- cave noise sampled on a coarse grid then trilinearly interpolated ---
    const GY = 4, GXZ = 4;
    const ny = Math.ceil(top / GY) + 1, nxz = 16 / GXZ + 1;
    const grid1 = new Float32Array(nxz * nxz * ny), grid2 = new Float32Array(grid1.length), grid3 = new Float32Array(grid1.length);
    for (let gz = 0; gz < nxz; gz++) for (let gx = 0; gx < nxz; gx++) for (let gy = 0; gy < ny; gy++) {
      const wx = x0 + gx * GXZ, wy = gy * GY, wz = z0 + gz * GXZ;
      const i = (gy * nxz + gz) * nxz + gx;
      grid1[i] = this.cave1.noise3(wx / 46, wy / 30, wz / 46);
      grid2[i] = this.cave2.noise3(wx / 46, wy / 30, wz / 46);
      grid3[i] = this.cheese.noise3(wx / 64, wy / 34, wz / 64);
    }
    const sample = (g, x, y, z) => {
      const fx = x / GXZ, fy = y / GY, fz = z / GXZ;
      const ix = Math.min(nxz - 2, fx | 0), iy = Math.min(ny - 2, fy | 0), iz = Math.min(nxz - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i000 = (iy * nxz + iz) * nxz + ix;
      const sY = nxz * nxz, sZ = nxz;
      const c00 = g[i000] + (g[i000 + 1] - g[i000]) * tx;
      const c10 = g[i000 + sZ] + (g[i000 + sZ + 1] - g[i000 + sZ]) * tx;
      const c01 = g[i000 + sY] + (g[i000 + sY + 1] - g[i000 + sY]) * tx;
      const c11 = g[i000 + sY + sZ] + (g[i000 + sY + sZ + 1] - g[i000 + sY + sZ]) * tx;
      const c0 = c00 + (c10 - c00) * tz, c1 = c01 + (c11 - c01) * tz;
      return c0 + (c1 - c0) * ty;
    };

    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const c = (z << 4) | x;
      const h = heights[c];
      const biome = chunk.biomes[c];
      const wx = x0 + x, wz = z0 + z;
      const depthN = this.surf.noise2(wx / 9, wz / 9);
      const soil = 3 + Math.floor(depthN * 1.5 + 1);
      const underwater = h < SEA_LEVEL;
      const beach = !underwater && h <= SEA_LEVEL + 1 && biome !== BIOME.SNOWY;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y <= BEDROCK_TOP) id = ID.bedrock;
        else if (y < h - soil) id = ID.stone;
        else if (biome === BIOME.DESERT) id = y >= h - 3 ? ID.sand : ID.sandstone;
        else if (underwater) id = depthN > 0.35 ? ID.gravel : (depthN < -0.3 ? ID.dirt : ID.sand);
        else if (beach) id = y >= h - 2 ? ID.sand : ID.sandstone;
        else id = y === h ? ID.grass : ID.dirt;
        B[(y << 8) | c] = id;
      }
      // caves
      const carveTop = h <= SEA_LEVEL + 1 ? h - 6 : h - 1; // keep the surface block so features stay grounded
      for (let y = BEDROCK_TOP + 1; y <= carveTop; y++) {
        const n1 = sample(grid1, x, y, z), n2 = sample(grid2, x, y, z);
        let carve = n1 * n1 + n2 * n2 < 0.0065 * (y < 20 ? 1.6 : 1);
        if (!carve && y < h - 8) {
          const n3 = sample(grid3, x, y, z);
          const th = 0.62 + Math.max(0, (y - 40)) * 0.012;
          carve = n3 > th;
        }
        if (carve) {
          const i = (y << 8) | c;
          // don't let caves eat the floor of deserts so sand floats less often
          B[i] = y <= 10 ? ID.lava : 0;
        }
      }
      // water and ice
      if (h < SEA_LEVEL) {
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          B[(y << 8) | c] = (y === SEA_LEVEL && biome === BIOME.SNOWY) ? ID.ice : ID.water;
        }
      }
      // grass under a carved surface becomes dirt-free air already; fix grass below air->ok
    }

    // --- ores (clipped to this chunk) ---
    const orng = rngFor(this.seed, cx, 0x0de5, cz);
    for (const [name, vmin, vmax, ymin, ymax, attempts] of ORES) {
      const oid = ID[name];
      for (let a = 0; a < attempts; a++) {
        let x = Math.floor(orng() * 16), z = Math.floor(orng() * 16);
        let y = ymin + Math.floor(orng() * (ymax - ymin + 1));
        const size = vmin + Math.floor(orng() * (vmax - vmin + 1));
        for (let n = 0; n < size; n++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < chunk.height) {
            const i = (y << 8) | (z << 4) | x;
            if (B[i] === ID.stone) B[i] = oid;
          }
          const d = Math.floor(orng() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++; else if (d === 3) z--; else if (d === 4) y++; else y--;
        }
      }
    }

    // --- surface decoration (in-chunk) ---
    const drng = rngFor(this.seed, cx, 0xf10e, cz);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const c = (z << 4) | x;
      const h = heights[c];
      const biome = chunk.biomes[c];
      const topId = B[(h << 8) | c];
      const above = (h + 1) << 8 | c;
      const r = drng();
      if (topId === ID.grass && B[above] === 0) {
        if (biome === BIOME.SNOWY || h >= 118) { B[above] = ID.snow; continue; }
        if (r < (biome === BIOME.FOREST ? 0.1 : 0.14)) B[above] = ID.tall_grass;
        else if (r < 0.165) B[above] = drng() < 0.5 ? ID.poppy : ID.dandelion;
      }
      if ((topId === ID.grass || topId === ID.sand) && h === SEA_LEVEL && B[above] === 0 && r > 0.75) {
        let nearWater = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx > 15 || nz > 15) continue;
          if (B[(h << 8) | (nz << 4) | nx] === ID.water) nearWater = true;
        }
        if (nearWater) {
          const tall = 1 + Math.floor(drng() * 3);
          for (let k = 1; k <= tall; k++) B[((h + k) << 8) | c] = ID.sugar_cane;
        }
      }
      if (h >= 118 && biome !== BIOME.SNOWY && topId === ID.stone && B[above] === 0) B[above] = ID.snow;
    }

    // --- features from this and neighboring chunks ---
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const f of this.featuresFor(cx + dx, cz + dz)) this.placeFeature(chunk, f, x0, z0);
    }
    placeVillages(this, chunk);
    this.placeRuinedPortal(chunk);
    if (this.type !== 'flat') placeStrongholds(this.seed, chunk);

    chunk.recomputeHeightmap();
    chunk.trim();
    return chunk;
  }

  // Rare broken Nether portal: incomplete obsidian frame on a netherrack/magma patch.
  placeRuinedPortal(chunk) {
    const rng = rngFor(this.seed, chunk.cx, 0x9047, chunk.cz);
    if (rng() > 1 / 40) return;
    const lx = 4 + Math.floor(rng() * 6), lz = 4 + Math.floor(rng() * 6);
    const y = chunk.heightmap[(lz << 4) | lx] - 1;
    if (y <= SEA_LEVEL || chunk.get(lx, y, lz) === ID.water) return;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 4; dx++) {
      if (dx * dx + dz * dz > 12 + rng() * 6) continue;
      const g = chunk.get(lx + dx, y, lz + dz);
      if (g && g !== ID.water) chunk.set(lx + dx, y, lz + dz, rng() < 0.15 ? ID.magma_block : ID.netherrack);
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
      const edge = i === 0 || i === 3 || j === 0 || j === 4;
      chunk.set(lx + i, y + 1 + j, lz, 0);
      if (edge && rng() < 0.7) chunk.set(lx + i, y + 1 + j, lz, ID.obsidian);
    }
    for (let k = 0; k < 3; k++) chunk.set(lx + Math.floor(rng() * 6) - 1, y + 1, lz + 1 + Math.floor(rng() * 2), ID.obsidian);
  }

  placeFeature(chunk, f, x0, z0) {
    const B = chunk.blocks;
    const put = (wx, wy, wz, id, onlyAir) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x > 15 || z < 0 || z > 15 || wy <= 0 || wy >= 250) return;
      chunk.ensureHeight(wy);
      const i = (wy << 8) | (z << 4) | x;
      const cur = chunk.blocks[i];
      if (onlyAir && cur !== 0 && cur !== ID.tall_grass && cur !== ID.snow && cur !== ID.poppy && cur !== ID.dandelion) return;
      if (!onlyAir && cur !== 0 && cur !== ID.leaves && cur !== ID.spruce_leaves && cur !== ID.tall_grass && cur !== ID.snow && cur !== ID.poppy && cur !== ID.dandelion) return;
      chunk.blocks[i] = id;
    };
    if (Math.abs(f.x - (x0 + 8)) > 11 || Math.abs(f.z - (z0 + 8)) > 11) return;
    const rng = mulberry32(f.seed || 1);
    if (f.type === 'cactus') {
      for (let k = 0; k < f.size; k++) put(f.x, f.y + k, f.z, ID.cactus, true);
      return;
    }
    if (f.type === 'oak') {
      const hgt = f.size;
      const topY = f.y + hgt - 1;
      for (let ly = topY - 3; ly <= topY + 1; ly++) {
        const rad = ly >= topY ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (ly === topY + 1 || rng() < 0.5)) continue;
          if (ly === topY + 1 && corner) continue;
          put(f.x + dx, ly, f.z + dz, ID.leaves, true);
        }
      }
      for (let k = 0; k < hgt; k++) put(f.x, f.y + k, f.z, ID.oak_log, false);
      return;
    }
    if (f.type === 'spruce') {
      const hgt = f.size;
      const topY = f.y + hgt;
      put(f.x, topY, f.z, ID.spruce_leaves, true);
      let rad = 0;
      for (let ly = topY - 1; ly >= f.y + 2; ly--) {
        rad = rad >= 2 ? 1 : rad + 1;
        if (ly < topY - 4 && rad === 1 && rng() < 0.5) rad = 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 0) continue;
          put(f.x + dx, ly, f.z + dz, ID.spruce_leaves, true);
        }
      }
      for (let k = 0; k < hgt; k++) put(f.x, f.y + k, f.z, ID.spruce_log, false);
    }
  }

  generateFlat(chunk) {
    let y = 0;
    chunk.ensureHeight(16);
    for (const [name, count] of SUPERFLAT_LAYERS) {
      for (let k = 0; k < count; k++, y++) {
        for (let i = 0; i < 256; i++) chunk.blocks[(y << 8) | i] = ID[name];
      }
    }
    chunk.recomputeHeightmap();
    return chunk;
  }

  // Grow a tree at a world position into a block setter (used for saplings).
  treeBlocks(type, x, y, z, seed) {
    const out = [];
    const f = { type, x, y, z, size: type === 'spruce' ? 6 + (seed & 3) : 4 + (seed % 3 + 3) % 3, seed };
    const rng = mulberry32(seed);
    if (type === 'oak') {
      const topY = y + f.size - 1;
      for (let ly = topY - 3; ly <= topY + 1; ly++) {
        const rad = ly >= topY ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (ly === topY + 1 || rng() < 0.5)) continue;
          out.push([x + dx, ly, z + dz, ID.leaves, true]);
        }
      }
      for (let k = 0; k < f.size; k++) out.push([x, y + k, z, ID.oak_log, false]);
    } else {
      const topY = y + f.size;
      out.push([x, topY, z, ID.spruce_leaves, true]);
      let rad = 0;
      for (let ly = topY - 1; ly >= y + 2; ly--) {
        rad = rad >= 2 ? 1 : rad + 1;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 0) continue;
          out.push([x + dx, ly, z + dz, ID.spruce_leaves, true]);
        }
      }
      for (let k = 0; k < f.size; k++) out.push([x, y + k, z, ID.spruce_log, false]);
    }
    return out;
  }

  findSpawn() {
    if (this.type === 'flat') return { x: 0.5, y: this.flatTop() + 1, z: 0.5 };
    for (let r = 0; r < 4000; r += 8) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 16));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const h = this.heightAt(x, z);
        const b = this.biomeAt(x, z);
        if (h > SEA_LEVEL + 1 && h < SEA_LEVEL + 30 && b !== BIOME.DESERT) {
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: this.heightAt(0, 0) + 1, z: 0.5 };
  }
}
