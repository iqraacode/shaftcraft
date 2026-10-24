// The End: floating end-stone main island over the void, 10 obsidian pillars (crystals are
// entities), and the inactive bedrock exit-portal frame at the center.
import { Simplex } from './noise.js';
import { ID } from './blocks.js';
import { END } from './dimensions.js';

export const END_BIOME = 5;
export const ISLAND_R = 80;

export function endPillars() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.push({ x: END.x + Math.round(Math.cos(a) * 42), z: END.z + Math.round(Math.sin(a) * 42), r: 2 + (i % 4), top: END.top + 16 + ((i * 7) % 10) * 3 });
  }
  return out;
}

// Exit portal frame: bedrock ring (radius 3) with a 4-high pillar; inner cells get end_portal when the dragon dies.
export function exitPortalCells() {
  const ring = [], inner = [];
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const d = dx * dx + dz * dz;
    if (d <= 2 * 2 + 1 && !(dx === 0 && dz === 0)) inner.push([END.x + dx, END.top, END.z + dz]);
    else if (d <= 3 * 3 + 2) ring.push([END.x + dx, END.top, END.z + dz]);
  }
  return { ring, inner };
}

export class EndGen {
  constructor(seed) { this.n = new Simplex(seed + 9101); }

  generate(chunk) {
    const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
    chunk.ensureHeight(END.top + 48);
    const set = (x, y, z, id) => { if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16) chunk.set(x - x0, y, z - z0, id); };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      chunk.biomes[(z << 4) | x] = END_BIOME;
      const wx = x0 + x - END.x, wz = z0 + z - END.z;
      const d = Math.hypot(wx, wz) / (ISLAND_R + this.n.noise2(wx / 30, wz / 30) * 14);
      if (d >= 1) continue;
      const top = END.top + Math.round((1 - d) * 4 + this.n.noise2(wx / 18, wz / 18) * 2);
      const bottom = END.top - Math.round(Math.sqrt(1 - d * d) * 34);
      for (let y = bottom; y <= top; y++) chunk.set(x, y, z, ID.end_stone);
    }
    for (const p of endPillars()) {
      if (p.x + p.r < x0 || p.x - p.r >= x0 + 16 || p.z + p.r < z0 || p.z - p.r >= z0 + 16) continue;
      for (let dz = -p.r; dz <= p.r; dz++) for (let dx = -p.r; dx <= p.r; dx++) {
        if (dx * dx + dz * dz > p.r * p.r + 1) continue;
        for (let y = END.top - 4; y <= p.top; y++) set(p.x + dx, y, p.z + dz, ID.obsidian);
      }
      set(p.x, p.top + 1, p.z, ID.bedrock);
    }
    const { ring } = exitPortalCells();
    for (const [x, y, z] of ring) set(x, y, z, ID.bedrock);
    for (let k = 0; k < 4; k++) set(END.x, END.top + k, END.z, ID.bedrock);
    for (const [x, y, z] of exitPortalCells().inner) { set(x, y, z, 0); set(x, y - 1, z, ID.bedrock); }
    chunk.recomputeHeightmap();
    return chunk;
  }
}
