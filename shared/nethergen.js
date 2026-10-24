// Nether terrain: netherrack caverns between a bedrock floor and ceiling, a lava ocean,
// soul sand valleys, basalt deltas, glowstone clusters, quartz and gold ores, magma.
import { Simplex, rngFor } from './noise.js';
import { ID } from './blocks.js';
import { NETHER } from './dimensions.js';

export const NETHER_BIOME = 4;

export class NetherGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.d1 = new Simplex(seed + 7001);
    this.d2 = new Simplex(seed + 7002);
    this.biome = new Simplex(seed + 7003);
  }

  density(x, y, z) {
    const n = this.d1.noise3(x / 48, y / 24, z / 48) * 0.7 + this.d2.noise3(x / 16, y / 12, z / 16) * 0.3;
    const floor = Math.max(0, (36 - y) / 18), ceil = Math.max(0, (y - 96) / 20);
    return n + floor + ceil - 0.15;
  }

  generate(chunk) {
    const H = NETHER.ceiling + 1;
    chunk.ensureHeight(H - 1);
    const B = chunk.blocks;
    const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
    // coarse density grid (4x8x4) with trilinear interpolation
    const nx = 5, ny = Math.ceil(H / 8) + 1;
    const g = new Float32Array(nx * nx * ny);
    for (let gy = 0; gy < ny; gy++) for (let gz = 0; gz < nx; gz++) for (let gx = 0; gx < nx; gx++) g[(gy * nx + gz) * nx + gx] = this.density(x0 + gx * 4, gy * 8, z0 + gz * 4);
    const D = (x, y, z) => {
      const fx = x / 4, fy = y / 8, fz = z / 4;
      const ix = Math.min(nx - 2, fx | 0), iy = Math.min(ny - 2, fy | 0), iz = Math.min(nx - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const v = (a, b, c) => g[((iy + b) * nx + (iz + c)) * nx + ix + a];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(v(0, 0, 0), v(1, 0, 0), tx), l(v(0, 0, 1), v(1, 0, 1), tx), tz), l(l(v(0, 1, 0), v(1, 1, 0), tx), l(v(0, 1, 1), v(1, 1, 1), tx), tz), ty);
    };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const c = (z << 4) | x;
      const b = this.biome.noise2((x0 + x) / 140, (z0 + z) / 140);
      const kind = b > 0.35 ? 'soul' : b < -0.4 ? 'basalt' : 'wastes';
      chunk.biomes[c] = NETHER_BIOME;
      for (let y = 0; y < H; y++) {
        let id = 0;
        if (y === 0 || y === H - 1 || (y === 1 || y === H - 2) && ((x * 7 + z * 13 + y) % 3 === 0)) id = ID.bedrock;
        else if (D(x, y, z) > 0) id = kind === 'basalt' && y > 30 ? ID.basalt : ID.netherrack;
        else if (y <= NETHER.lava) id = ID.lava;
        B[(y << 8) | c] = id;
      }
      // surface layer: soul sand valleys / magma near lava
      for (let y = H - 3; y > 2; y--) {
        const i = (y << 8) | c;
        if (B[i] === ID.netherrack && B[i + 256] === 0) {
          if (kind === 'soul') B[i] = ID.soul_sand;
          else if (y <= NETHER.lava + 2 && ((x + z + y) % 5 === 0)) B[i] = ID.magma_block;
        }
      }
    }
    const rng = rngFor(this.seed, chunk.cx, 0x4e7, chunk.cz);
    // ores
    const vein = (oid, n, size, ymin, ymax) => {
      for (let a = 0; a < n; a++) {
        let x = Math.floor(rng() * 16), y = ymin + Math.floor(rng() * (ymax - ymin)), z = Math.floor(rng() * 16);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < H - 1) { const i = (y << 8) | (z << 4) | x; if (B[i] === ID.netherrack) B[i] = oid; }
          const d = Math.floor(rng() * 6); if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++; else if (d === 3) z--; else if (d === 4) y++; else y--;
        }
      }
    };
    vein(ID.nether_quartz_ore, 12, 10, 10, 118);
    vein(ID.nether_gold_ore, 8, 8, 10, 118);
    // glowstone clusters hanging from ceilings
    for (let a = 0; a < 3; a++) {
      const x = 2 + Math.floor(rng() * 12), z = 2 + Math.floor(rng() * 12);
      for (let y = H - 3; y > 40; y--) {
        const i = (y << 8) | (z << 4) | x;
        if (B[i] === 0 && B[i + 256] !== 0 && B[i + 256] !== ID.lava) {
          for (let k = 0; k < 14; k++) {
            const gx = x + Math.floor(rng() * 3) - 1, gz = z + Math.floor(rng() * 3) - 1, gy = y - Math.floor(rng() * 4);
            const j = (gy << 8) | (gz << 4) | gx;
            if (B[j] === 0) B[j] = ID.glowstone;
          }
          break;
        }
      }
    }
    chunk.recomputeHeightmap();
    return chunk;
  }
}
