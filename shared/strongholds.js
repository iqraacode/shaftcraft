// Strongholds: three underground End-portal rooms in a ring 900-1300 blocks from spawn.
import { rngFor } from './noise.js';
import { ID } from './blocks.js';

export const ROOM_Y = 28;

export function strongholds(seed) {
  const rng = rngFor(seed, 0, 0x5701, 0);
  const out = [];
  const base = rng() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * Math.PI * 2, r = 900 + rng() * 400;
    out.push({ x: Math.round(Math.cos(a) * r), z: Math.round(Math.sin(a) * r), eyes: Math.floor(rng() * 4096) });
  }
  return out;
}

// End portal frame ring around the room center: 3 per side of a 5x5 square (no corners).
export function frameCells(s) {
  const cells = [];
  for (let i = -1; i <= 1; i++) { cells.push([s.x + i, s.z - 2]); cells.push([s.x + i, s.z + 2]); cells.push([s.x - 2, s.z + i]); cells.push([s.x + 2, s.z + i]); }
  return cells;
}

export function placeStrongholds(seed, chunk) {
  const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
  const inC = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const set = (x, y, z, id, m = 0) => { if (inC(x, z)) chunk.set(x - x0, y, z - z0, id, m); };
  for (const s of strongholds(seed)) {
    if (s.x + 8 < x0 || s.x - 8 >= x0 + 16 || s.z + 8 < z0 || s.z - 8 >= z0 + 16) continue;
    const y = ROOM_Y;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let dy = 0; dy <= 7; dy++) {
      const wall = Math.abs(dx) === 6 || Math.abs(dz) === 6 || dy === 0 || dy === 7;
      set(s.x + dx, y + dy, s.z + dz, wall ? ((dx + dz + dy) % 3 ? ID.stone : ID.cobblestone) : 0);
    }
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) set(s.x + dx, y + 1, s.z + dz, ID.torch, 0);
    // a lava pool on one side, like the classic portal room
    for (let dx = -1; dx <= 1; dx++) set(s.x + dx, y, s.z + 5, ID.lava);
    frameCells(s).forEach(([fx, fz], i) => set(fx, y + 1, fz, ID.end_portal_frame, ((s.eyes >> i) & 1) && (i % 4 === 0) ? 1 : 0));
    // a ladder shaft up toward the surface from one corner
    for (let k = 1; k < 60; k++) { set(s.x - 4, y + 7 + k - 1, s.z - 4, 0); set(s.x - 4, y + 7 + k, s.z - 4, 0); }
  }
}
