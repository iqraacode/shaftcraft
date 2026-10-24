// Deterministic village layout + chunk-clipped placement (houses, well, farms, paths).
import { rngFor } from './noise.js';
import { ID } from './blocks.js';
import { SEA_LEVEL } from './constants.js';

export const VILLAGE_CELL = 96; // one possible village per 96x96 block cell
export const PROFESSIONS = ['farmer', 'librarian', 'toolsmith', 'butcher', 'shepherd'];
const BIOME_STYLE = ['plains', 'plains', 'desert', 'snowy']; // by BIOME id

// Returns village plan for grid cell (gx, gz) or null. gen = WorldGen.
export function villagePlan(gen, gx, gz) {
  const key = gx + ',' + gz;
  if (!gen._villages) gen._villages = new Map();
  if (gen._villages.has(key)) return gen._villages.get(key);
  let plan = null;
  if (gen.type !== 'flat') {
    const rng = rngFor(gen.seed, gx, 0x7111, gz);
    if (rng() < 0.4) {
      const cx = gx * VILLAGE_CELL + 24 + Math.floor(rng() * 48), cz = gz * VILLAGE_CELL + 24 + Math.floor(rng() * 48);
      const cy = gen.heightAt(cx, cz);
      if (cy > SEA_LEVEL + 1 && cy < SEA_LEVEL + 40) {
        const style = BIOME_STYLE[gen.biomeAt(cx, cz)];
        plan = { cx, cz, cy, style, houses: [], farms: [] };
        const n = 5 + Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rng() * 0.4, r = 14 + rng() * 12;
          const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
          const big = rng() < 0.3;
          const w = big ? 7 : 5, d = 5;
          const x0 = x - (w >> 1), z0 = z - (d >> 1);
          const y = gen.heightAt(x, z);
          if (y <= SEA_LEVEL) continue;
          // door on the side facing the well
          const dx = cx - x, dz = cz - z;
          const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0); // 0 n,1 e,2 s,3 w
          plan.houses.push({ x0, z0, w, d, y, side, prof: PROFESSIONS[i % PROFESSIONS.length], bed: rng() < 0.6 });
        }
        for (let i = 0; i < 2; i++) {
          const a = rng() * Math.PI * 2, r = 30 + rng() * 6;
          const x0 = Math.round(cx + Math.cos(a) * r) - 2, z0 = Math.round(cz + Math.sin(a) * r) - 3;
          const y = gen.heightAt(x0 + 2, z0 + 3);
          if (y > SEA_LEVEL) plan.farms.push({ x0, z0, y, seed: Math.floor(rng() * 1e6) });
        }
      }
    }
  }
  gen._villages.set(key, plan);
  if (gen._villages.size > 256) gen._villages.delete(gen._villages.keys().next().value);
  return plan;
}

export function villagesNearChunk(gen, cx, cz) {
  const out = [];
  const gx0 = Math.floor((cx * 16 - 48) / VILLAGE_CELL), gx1 = Math.floor((cx * 16 + 64) / VILLAGE_CELL);
  const gz0 = Math.floor((cz * 16 - 48) / VILLAGE_CELL), gz1 = Math.floor((cz * 16 + 64) / VILLAGE_CELL);
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) { const p = villagePlan(gen, gx, gz); if (p) out.push(p); }
  return out;
}

export function doorPos(h) {
  const mx = h.x0 + (h.w >> 1), mz = h.z0 + (h.d >> 1);
  if (h.side === 0) return [mx, h.z0];
  if (h.side === 2) return [mx, h.z0 + h.d - 1];
  if (h.side === 1) return [h.x0 + h.w - 1, mz];
  return [h.x0, mz];
}

export function placeVillages(gen, chunk) {
  const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
  const inC = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const set = (x, y, z, id, meta = 0) => { if (inC(x, z) && y > 0 && y < 250) chunk.set(x - x0, y, z - z0, id, meta); };
  const get = (x, y, z) => (inC(x, z) ? chunk.get(x - x0, y, z - z0) : 0);
  for (const v of villagesNearChunk(gen, chunk.cx, chunk.cz)) {
    const desert = v.style === 'desert', snowy = v.style === 'snowy';
    const wall = desert ? ID.sandstone : ID.planks;
    const post = desert ? ID.sandstone : snowy ? ID.spruce_log : ID.oak_log;
    const found = desert ? ID.sandstone : ID.cobblestone;
    const roof = desert ? ID.sandstone : snowy ? ID.spruce_log : ID.planks;
    const pathId = desert ? ID.sandstone : ID.gravel;
    // paths: L-shaped from the well to every door
    for (const h of v.houses) {
      const [dx, dz] = doorPos(h);
      const steps = [];
      let x = v.cx, z = v.cz;
      while (x !== dx) { steps.push([x, z]); x += Math.sign(dx - x); }
      while (z !== dz) { steps.push([x, z]); z += Math.sign(dz - z); }
      for (const [px, pz] of steps) for (const [ox, oz] of [[0, 0], [1, 0], [0, 1]]) {
        const qx = px + ox, qz = pz + oz;
        if (!inC(qx, qz)) continue;
        const y = gen.heightAt(qx, qz);
        const top = get(qx, y, qz);
        if (top === ID.grass || top === ID.dirt || top === ID.sand) { set(qx, y, qz, pathId); for (let k = 1; k < 3; k++) { const a = get(qx, y + k, qz); if (a === ID.tall_grass || a === ID.poppy || a === ID.dandelion || a === ID.snow) set(qx, y + k, qz, 0); } }
      }
    }
    // houses
    for (const h of v.houses) {
      const y = h.y;
      for (let x = h.x0 - 1; x <= h.x0 + h.w; x++) for (let z = h.z0 - 1; z <= h.z0 + h.d; z++) {
        if (!inC(x, z)) continue;
        const inside = x >= h.x0 && x < h.x0 + h.w && z >= h.z0 && z < h.z0 + h.d;
        for (let k = 1; k <= 9; k++) set(x, y + k, z, 0);
        if (!inside) continue;
        for (let k = 0; k <= 4; k++) if (!get(x, y - k, z) || k === 0) set(x, y - k, z, k === 0 ? (desert ? ID.sandstone : ID.planks) : found);
        const edgeX = x === h.x0 || x === h.x0 + h.w - 1, edgeZ = z === h.z0 || z === h.z0 + h.d - 1;
        if (edgeX || edgeZ) {
          for (let k = 1; k <= 3; k++) set(x, y + k, z, edgeX && edgeZ ? post : wall);
          const mid = (x === h.x0 + (h.w >> 1)) || (z === h.z0 + (h.d >> 1));
          if (mid && !(edgeX && edgeZ)) set(x, y + 2, z, ID.glass);
        }
        set(x, y + 4, z, roof);
        if (!(edgeX || edgeZ)) { set(x, y + 5, z, roof); if (snowy) set(x, y + 6, z, ID.snow); } else if (snowy) set(x, y + 5, z, ID.snow);
      }
      // door (two halves) facing outward
      const [dx, dz] = doorPos(h);
      const facing = [0, 1, 2, 3][h.side];
      set(dx, y + 1, dz, ID.door, facing); set(dx, y + 2, dz, ID.door, facing | 8);
      // interior: torch, crafting table, bed
      const ix = h.x0 + 1, iz = h.z0 + 1;
      set(ix, y + 1, iz, ID.torch, 0);
      set(h.x0 + h.w - 2, y + 1, iz, ID.crafting_table, 2);
      if (h.bed && h.w >= 5) { set(ix, y + 1, h.z0 + h.d - 2, ID.bed, 1); set(ix + 1, y + 1, h.z0 + h.d - 2, ID.bed, 1 | 4); }
    }
    // well
    for (let x = v.cx - 1; x <= v.cx + 2; x++) for (let z = v.cz - 1; z <= v.cz + 2; z++) {
      const edge = x === v.cx - 1 || x === v.cx + 2 || z === v.cz - 1 || z === v.cz + 2;
      for (let k = 1; k <= 4; k++) set(x, v.cy + k, z, 0);
      set(x, v.cy, z, edge ? ID.cobblestone : ID.water);
      set(x, v.cy - 1, z, ID.cobblestone);
      if (edge) set(x, v.cy + 1, z, ID.cobblestone);
      if ((x === v.cx - 1 || x === v.cx + 2) && (z === v.cz - 1 || z === v.cz + 2)) { set(x, v.cy + 2, z, post); set(x, v.cy + 3, z, post); }
      set(x, v.cy + 4, z, roof);
    }
    // farms
    for (const f of v.farms) {
      for (let x = f.x0 - 1; x <= f.x0 + 5; x++) for (let z = f.z0 - 1; z <= f.z0 + 7; z++) {
        const edge = x === f.x0 - 1 || x === f.x0 + 5 || z === f.z0 - 1 || z === f.z0 + 7;
        for (let k = 1; k <= 4; k++) set(x, f.y + k, z, 0);
        set(x, f.y - 1, z, ID.dirt);
        if (edge) { set(x, f.y, z, post); continue; }
        if (x === f.x0 + 2) { set(x, f.y, z, ID.water); continue; }
        set(x, f.y, z, ID.farmland);
        set(x, f.y + 1, z, ID.wheat, 2 + ((x * 7 + z * 13 + f.seed) % 6));
      }
    }
  }
}

// Houses whose door lies in this chunk -> where to spawn their villager.
export function villagersForChunk(gen, cx, cz) {
  const out = [];
  for (const v of villagesNearChunk(gen, cx, cz)) for (const h of v.houses) {
    const mx = h.x0 + (h.w >> 1), mz = h.z0 + (h.d >> 1);
    if ((mx >> 4) === cx && (mz >> 4) === cz) out.push({ x: mx + 0.5, y: h.y + 1, z: mz + 0.5, prof: h.prof, style: v.style });
  }
  return out;
}
