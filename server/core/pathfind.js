// A* pathfinding on the voxel grid for mobs. Nodes are integer feet positions.
// Handles 1-block step ups, drops up to 3 blocks, and avoids lava, cactus and deep water.
import { BLOCKS, IS_SOLID, IS_FLUID, ID, collisionBoxes } from '../../shared/blocks.js';
import { MOB_PATH_MAX_NODES } from '../../shared/constants.js';

function passable(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === 0) return true;
  if (IS_FLUID[id] === 2 || id === ID.cactus) return false;
  if (!IS_SOLID[id]) return true;
  if (id === ID.door) {
    const meta = world.getMeta(x, y, z);
    return (meta & 4) !== 0; // open doors are passable
  }
  return false;
}

function standable(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (IS_FLUID[id] === 1) return true; // can swim on water
  if (!IS_SOLID[id] || IS_FLUID[id] === 2 || id === ID.cactus) return false;
  const boxes = collisionBoxes(id, world.getMeta(x, y, z));
  return !!boxes && boxes[0][4] > 0.5;
}

export function canStandAt(world, x, y, z, height) {
  for (let i = 0; i < height; i++) if (!passable(world, x, y + i, z)) return false;
  const below = world.getBlock(x, y - 1, z);
  if (IS_FLUID[below] === 2) return false;
  if (IS_FLUID[world.getBlock(x, y, z)] === 1) {
    // treat as swimmable only if not deep (water two below)
    return IS_FLUID[below] !== 1 || IS_FLUID[world.getBlock(x, y - 2, z)] !== 1;
  }
  return standable(world, x, y - 1, z);
}

class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

/**
 * Find a path from (sx,sy,sz) to (tx,ty,tz). Returns array of [x,y,z] waypoints (block coords)
 * or null. `range` limits distance from start. `opts.height` is the mob's height in blocks.
 */
export function findPath(world, sx, sy, sz, tx, ty, tz, range, opts = {}) {
  const height = opts.height || 2;
  const maxNodes = opts.maxNodes || MOB_PATH_MAX_NODES;
  const key = (x, y, z) => ((x - sx + 512) * 1024 + (z - sz + 512)) * 512 + y;
  const open = new Heap();
  const nodes = new Map();
  const h = (x, y, z) => Math.abs(x - tx) + Math.abs(z - tz) + Math.abs(y - ty) * 0.5;
  const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null, closed: false };
  nodes.set(key(sx, sy, sz), start);
  open.push(start);
  let best = start, bestH = h(sx, sy, sz);
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const cur = open.pop();
    if (cur.closed) continue;
    cur.closed = true;
    expanded++;
    const ch = h(cur.x, cur.y, cur.z);
    if (ch < bestH) { bestH = ch; best = cur; }
    if (cur.x === tx && cur.z === tz && Math.abs(cur.y - ty) <= 1) { best = cur; break; }
    for (const [dx, dz, cost] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (Math.abs(nx - sx) > range || Math.abs(nz - sz) > range) continue;
      if (dx && dz) {
        // diagonal only if both orthogonal neighbors are open
        if (!passable(world, cur.x + dx, cur.y, cur.z) || !passable(world, cur.x, cur.y, cur.z + dz)) continue;
        if (!passable(world, cur.x + dx, cur.y + 1, cur.z) || !passable(world, cur.x, cur.y + 1, cur.z + dz)) continue;
      }
      let ny = -1;
      if (canStandAt(world, nx, cur.y, nz, height)) ny = cur.y;
      else if (canStandAt(world, nx, cur.y + 1, nz, height) && passable(world, cur.x, cur.y + height, cur.z)) ny = cur.y + 1;
      else {
        for (let d = 1; d <= 3; d++) {
          if (!passable(world, nx, cur.y - d + height - 1, nz)) break;
          if (canStandAt(world, nx, cur.y - d, nz, height)) { ny = cur.y - d; break; }
        }
      }
      if (ny < 0) continue;
      const k = key(nx, ny, nz);
      let extra = 0;
      if (IS_FLUID[world.getBlock(nx, ny, nz)] === 1) extra += 3;
      if (ny > cur.y) extra += 0.5;
      const g = cur.g + cost + extra;
      let n = nodes.get(k);
      if (n && (n.closed || n.g <= g)) continue;
      if (!n) { n = { x: nx, y: ny, z: nz, g, f: 0, parent: cur, closed: false }; nodes.set(k, n); }
      n.g = g; n.parent = cur; n.f = g + h(nx, ny, nz);
      open.push(n);
    }
  }
  if (best === start) return null;
  const path = [];
  for (let n = best; n && n !== start; n = n.parent) path.push([n.x, n.y, n.z]);
  path.reverse();
  return path;
}

// Line of sight between two points through non-full blocks.
export function lineOfSight(world, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const steps = Math.ceil(dist * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const id = world.getBlock(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t), Math.floor(z0 + dz * t));
    if (id && BLOCKS[id].full) return false;
  }
  return true;
}
