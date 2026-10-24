// Nether portals: lighting obsidian frames, keeping portals intact, and linking/creating
// the destination portal on the other side (8:1 coordinate scale).
import { ID } from '../../shared/blocks.js';
import { dimensionAt, toNether, toOverworld, clampToBorder, NETHER } from '../../shared/dimensions.js';

const MAX = 21;

// Fill an obsidian-bounded air region containing (x,y,z) with portal blocks. Returns true if lit.
export function tryLightPortal(world, x, y, z) {
  if (world.getBlock(x, y, z) !== 0) return false;
  for (const axis of [0, 1]) {
    const cells = [], seen = new Set([x + ',' + y + ',' + z]), q = [[x, y, z]];
    let ok = true;
    let minA = Infinity, maxA = -Infinity, minY = Infinity, maxY = -Infinity;
    while (q.length && ok) {
      const [cx, cy, cz] = q.pop();
      cells.push([cx, cy, cz]);
      const a = axis === 0 ? cx : cz;
      minA = Math.min(minA, a); maxA = Math.max(maxA, a); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      if (maxA - minA >= MAX || maxY - minY >= MAX || cells.length > MAX * MAX) { ok = false; break; }
      const nb = axis === 0 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] : [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
      for (const [dx, dy, dz] of nb) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        const id = world.getBlock(nx, ny, nz);
        if (id === ID.obsidian) continue;
        if (id !== 0) { ok = false; break; }
        seen.add(k); q.push([nx, ny, nz]);
      }
    }
    if (!ok || maxA - minA < 1 || maxY - minY < 2) continue;
    for (const [cx, cy, cz] of cells) world.setBlock(cx, cy, cz, ID.nether_portal, axis, { noUpdate: true });
    return true;
  }
  return false;
}

// A portal block breaks if its in-plane neighbors are no longer portal or obsidian.
export function portalIntact(world, x, y, z, meta) {
  const nb = (meta & 1) === 0 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] : [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  for (const [dx, dy, dz] of nb) {
    const id = world.getBlock(x + dx, y + dy, z + dz);
    if (id !== ID.nether_portal && id !== ID.obsidian) return false;
  }
  return true;
}

function findPortal(world, tx, tz, r, ymax) {
  let best = null, bd = Infinity;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x = tx + dx, z = tz + dz;
    for (let y = 1; y < ymax; y++) {
      if (world.getBlock(x, y, z) !== ID.nether_portal || world.getBlock(x, y - 1, z) === ID.nether_portal) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x: x + 0.5, y, z: z + 0.5 }; }
    }
  }
  return best;
}

function buildPortal(world, x, y, z) {
  for (let i = -1; i <= 4; i++) for (let j = -1; j <= 5; j++) for (let k = -1; k <= 1; k++) world.setBlock(x + i - 1, y + j, z + k, j === -1 ? ID.obsidian : 0, 0, { noUpdate: true });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
    const edge = i === 0 || i === 3 || j === 0 || j === 4;
    world.setBlock(x + i - 1, y + j - 1, z, edge ? ID.obsidian : ID.nether_portal, edge ? 0 : 0, { noUpdate: true });
  }
  return { x: x + 0.5, y, z: z + 0.5 };
}

// Destination for a player standing in a portal at (x,z).
export function portalDestination(world, x, z) {
  const fromNether = dimensionAt(x, z) === 'nether';
  let [tx, tz] = fromNether ? toOverworld(x, z) : toNether(x, z);
  [tx, tz] = clampToBorder(tx, tz);
  tx = Math.floor(tx); tz = Math.floor(tz);
  const ymax = fromNether ? 250 : NETHER.ceiling - 1;
  const found = findPortal(world, tx, tz, 16, ymax);
  if (found) return found;
  // find a safe spot: solid floor, 4 air above (Nether: inside the cavern, above the lava ocean)
  let y = -1;
  if (fromNether) y = world.topY(tx, tz);
  else {
    for (let yy = NETHER.lava + 2; yy < NETHER.ceiling - 6 && y < 0; yy++) {
      const f = world.getBlock(tx, yy - 1, tz);
      if (f && f !== ID.lava && world.getBlock(tx, yy, tz) === 0 && world.getBlock(tx, yy + 1, tz) === 0 && world.getBlock(tx, yy + 2, tz) === 0 && world.getBlock(tx, yy + 3, tz) === 0) y = yy;
    }
    if (y < 0) y = NETHER.lava + 10; // build on a platform in mid-air if no cavern floor
  }
  return buildPortal(world, tx, y + 1, tz);
}
