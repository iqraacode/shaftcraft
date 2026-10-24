// Shared movement physics: swept AABB collision against the voxel world, player and mob
// movement models (walk, swim, ladder, fly, glide) and voxel raycasting.
// World interface: getBlock(x,y,z) -> id (255 = unloaded, treated as solid), getMeta(x,y,z).
import * as C from './constants.js';
import { BLOCKS, collisionBoxes, selectionBox, IS_FLUID, ID } from './blocks.js';

export const UNLOADED = 255;
const EPS = 1e-7;

// Collect collision boxes intersecting the region into a flat Float64 array (reused).
let boxBuf = new Float64Array(6 * 512);
function gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ) {
  let n = 0;
  const x0 = Math.floor(minX), x1 = Math.floor(maxX);
  const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.getBlock(x, y, z);
    if (id === 0) continue;
    let boxes;
    if (id === UNLOADED) boxes = FULL;
    else {
      if (!BLOCKS[id] || !BLOCKS[id].solid) continue;
      boxes = collisionBoxes(id, world.getMeta(x, y, z));
      if (!boxes) continue;
    }
    for (const b of boxes) {
      if (n + 6 > boxBuf.length) { const nb = new Float64Array(boxBuf.length * 2); nb.set(boxBuf); boxBuf = nb; }
      boxBuf[n++] = x + b[0]; boxBuf[n++] = y + b[1]; boxBuf[n++] = z + b[2];
      boxBuf[n++] = x + b[3]; boxBuf[n++] = y + b[4]; boxBuf[n++] = z + b[5];
    }
  }
  return n;
}
const FULL = [[0, 0, 0, 1, 1, 1]];

// Move an AABB (feet-centered: x,z center, y bottom; w width; h height) by (dx,dy,dz).
// Resolves Y, then X, then Z. Returns actual movement and collision flags in `out`.
export function collideMove(world, x, y, z, w, h, dx, dy, dz, out) {
  const hw = w / 2;
  let minX = x - hw, minY = y, minZ = z - hw, maxX = x + hw, maxY = y + h, maxZ = z + hw;
  const n = gatherBoxes(world,
    Math.min(minX, minX + dx), Math.min(minY, minY + dy), Math.min(minZ, minZ + dz),
    Math.max(maxX, maxX + dx), Math.max(maxY, maxY + dy), Math.max(maxZ, maxZ + dz));
  const ody = dy, odx = dx, odz = dz;
  // Y
  for (let i = 0; i < n; i += 6) {
    if (boxBuf[i + 3] <= minX + EPS || boxBuf[i] >= maxX - EPS || boxBuf[i + 5] <= minZ + EPS || boxBuf[i + 2] >= maxZ - EPS) continue;
    if (dy > 0 && boxBuf[i + 1] >= maxY - EPS) dy = Math.min(dy, boxBuf[i + 1] - maxY);
    else if (dy < 0 && boxBuf[i + 4] <= minY + EPS) dy = Math.max(dy, boxBuf[i + 4] - minY);
  }
  minY += dy; maxY += dy;
  // X
  for (let i = 0; i < n; i += 6) {
    if (boxBuf[i + 4] <= minY + EPS || boxBuf[i + 1] >= maxY - EPS || boxBuf[i + 5] <= minZ + EPS || boxBuf[i + 2] >= maxZ - EPS) continue;
    if (dx > 0 && boxBuf[i] >= maxX - EPS) dx = Math.min(dx, boxBuf[i] - maxX);
    else if (dx < 0 && boxBuf[i + 3] <= minX + EPS) dx = Math.max(dx, boxBuf[i + 3] - minX);
  }
  minX += dx; maxX += dx;
  // Z
  for (let i = 0; i < n; i += 6) {
    if (boxBuf[i + 4] <= minY + EPS || boxBuf[i + 1] >= maxY - EPS || boxBuf[i + 3] <= minX + EPS || boxBuf[i] >= maxX - EPS) continue;
    if (dz > 0 && boxBuf[i + 2] >= maxZ - EPS) dz = Math.min(dz, boxBuf[i + 2] - maxZ);
    else if (dz < 0 && boxBuf[i + 5] <= minZ + EPS) dz = Math.max(dz, boxBuf[i + 5] - minZ);
  }
  out.dx = dx; out.dy = dy; out.dz = dz;
  out.cx = Math.abs(dx - odx) > 1e-9;
  out.cy = Math.abs(dy - ody) > 1e-9;
  out.cz = Math.abs(dz - odz) > 1e-9;
  out.onGround = out.cy && ody < 0;
  return out;
}

export function boxCollides(world, x, y, z, w, h) {
  const hw = w / 2;
  const n = gatherBoxes(world, x - hw, y, z - hw, x + hw, y + h, z + hw);
  for (let i = 0; i < n; i += 6) {
    if (boxBuf[i + 3] > x - hw + EPS && boxBuf[i] < x + hw - EPS &&
      boxBuf[i + 4] > y + EPS && boxBuf[i + 1] < y + h - EPS &&
      boxBuf[i + 5] > z - hw + EPS && boxBuf[i + 2] < z + hw - EPS) return true;
  }
  return false;
}

// Fluid / ladder state of an entity box.
export function fluidState(world, e, out) {
  const hw = e.w / 2;
  out.water = false; out.lava = false; out.ladder = false; out.headWater = false; out.headLava = false;
  out.flowX = 0; out.flowZ = 0; out.waterDepth = 0;
  const x0 = Math.floor(e.x - hw + 0.001), x1 = Math.floor(e.x + hw - 0.001);
  const y0 = Math.floor(e.y + 0.001), y1 = Math.floor(e.y + e.h - 0.001);
  const z0 = Math.floor(e.z - hw + 0.001), z1 = Math.floor(e.z + hw - 0.001);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.getBlock(x, y, z);
    if (id === 0 || id === UNLOADED) continue;
    const f = IS_FLUID[id];
    if (f) {
      const meta = world.getMeta(x, y, z);
      const top = y + fluidHeight(meta, world.getBlock(x, y + 1, z) === id);
      if (e.y < top) {
        if (f === 1) {
          out.water = true;
          out.waterDepth = Math.max(out.waterDepth, top - e.y);
          const fl = flowVector(world, x, y, z, id, meta);
          const s = (meta & 7) ? (1 + (meta & 7) / 8) : (meta & 8 ? 1 : 0);
          out.flowX += fl[0] * s; out.flowZ += fl[1] * s;
        } else out.lava = true;
      }
    } else if (BLOCKS[id].climbable) out.ladder = true;
  }
  const eyeY = e.y + (e.eye || e.h * 0.85);
  const hid = world.getBlock(Math.floor(e.x), Math.floor(eyeY), Math.floor(e.z));
  if (IS_FLUID[hid]) {
    const meta = world.getMeta(Math.floor(e.x), Math.floor(eyeY), Math.floor(e.z));
    const top = Math.floor(eyeY) + fluidHeight(meta, world.getBlock(Math.floor(e.x), Math.floor(eyeY) + 1, Math.floor(e.z)) === hid);
    if (eyeY < top) { if (IS_FLUID[hid] === 1) out.headWater = true; else out.headLava = true; }
  }
  return out;
}

export function fluidHeight(meta, sameAbove) {
  if (sameAbove || (meta & 8)) return 1;
  const lvl = meta & 7;
  return (8 - lvl) / 9 + 0.0;
}

const flowTmp = [0, 0];
export function flowVector(world, x, y, z, id, meta) {
  let fx = 0, fz = 0;
  const myLvl = meta & 8 ? 0 : meta & 7;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const nid = world.getBlock(x + dx, y, z + dz);
    if (nid === id) {
      const nm = world.getMeta(x + dx, y, z + dz);
      const nl = nm & 8 ? 0 : nm & 7;
      const diff = nl - myLvl;
      fx += dx * diff; fz += dz * diff;
    } else if (nid === 0 || (BLOCKS[nid] && !BLOCKS[nid].solid && !IS_FLUID[nid])) {
      const below = world.getBlock(x + dx, y - 1, z + dz);
      if (below === id) { fx += dx * 4; fz += dz * 4; }
      else if (myLvl > 0) { fx += dx * 1; fz += dz * 1; }
    }
  }
  const len = Math.hypot(fx, fz);
  if (len > 0) { flowTmp[0] = fx / len; flowTmp[1] = fz / len; } else { flowTmp[0] = 0; flowTmp[1] = 0; }
  if (meta & 8) { flowTmp[0] *= 0.5; flowTmp[1] *= 0.5; }
  return flowTmp;
}

export function lookVector(yaw, pitch, out = [0, 0, 0]) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

const mv = { dx: 0, dy: 0, dz: 0, cx: false, cy: false, cz: false, onGround: false };
const fs = {};

// Body dimensions for a player pose.
export function poseSize(pose) {
  if (pose === 'sneak') return [C.PLAYER_WIDTH, C.SNEAK_HEIGHT, C.SNEAK_EYE];
  if (pose === 'swim' || pose === 'glide') return [C.PLAYER_WIDTH, C.SMALL_HEIGHT, C.SMALL_EYE];
  return [C.PLAYER_WIDTH, C.PLAYER_HEIGHT, C.PLAYER_EYE];
}

/**
 * Advance a player one tick.
 * p: { x,y,z, vx,vy,vz, yaw,pitch, onGround, flying, gliding, pose, fallDistance, sprinting, ... }
 * input: { forward, strafe, jump, sneak, sprint }
 * mode: { creative, spectator, canGlide }
 * Returns events: { jumped, landed, crashSpeed, horizontalCollision }
 */
export function stepPlayer(world, p, input, mode) {
  const dt = C.DT;
  const ev = { jumped: false, landed: false, crash: 0, hc: false, fall: 0 };
  // ---- pose / hitbox ----
  let pose = 'stand';
  if (p.gliding) pose = 'glide';
  else if (p.swimming) pose = 'swim';
  else if (input.sneak && !p.flying && !mode.spectator) pose = 'sneak';
  // can't stand up if blocked
  if (pose !== p.pose && !mode.spectator) {
    const [w, h] = poseSize(pose);
    if (boxCollides(world, p.x, p.y, p.z, w, h)) {
      const [, sh] = poseSize('sneak');
      pose = (pose === 'stand' && !boxCollides(world, p.x, p.y, p.z, w, sh)) ? 'sneak' : p.pose;
    }
  }
  p.pose = pose;
  const [w, h, eye] = poseSize(pose);
  p.w = w; p.h = h; p.eye = eye;

  fluidState(world, p, fs);
  p.inWater = fs.water; p.inLava = fs.lava; p.headInWater = fs.headWater; p.headInLava = fs.headLava; p.onLadder = fs.ladder;

  // forward/right vectors
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * input.forward + cy * input.strafe;
  let wz = -cy * input.forward - sy * input.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }

  if (mode.spectator) {
    const sp = C.SPECTATOR_SPEED * (input.sprint ? 2 : 1);
    p.vx += (wx * sp - p.vx) * 0.3;
    p.vz += (wz * sp - p.vz) * 0.3;
    p.vy += (((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * sp - p.vy) * 0.3;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.onGround = false; p.fallDistance = 0;
    return ev;
  }

  // sprint rules
  if (input.sprint && input.forward > 0 && !input.sneak && (mode.creative || p.food === undefined || p.food > C.SPRINT_FOOD_MIN)) p.sprinting = true;
  if (input.forward <= 0 || input.sneak || p.hcTicks > 0 || (!mode.creative && p.food !== undefined && p.food <= C.SPRINT_FOOD_MIN)) p.sprinting = false;

  // swimming pose: sprinting while submerged
  p.swimming = p.sprinting && fs.water && fs.headWater && !p.flying;

  const prevHSpeed = Math.hypot(p.vx, p.vz);
  let dx, dy, dz;

  if (p.gliding) {
    // Classic glider flight model in blocks/tick.
    let vx = p.vx * dt, vy = p.vy * dt, vz = p.vz * dt;
    const pitchMC = -p.pitch;
    const lx = -sy * Math.cos(p.pitch), ly = Math.sin(p.pitch), lz = -cy * Math.cos(p.pitch);
    const hLook = Math.sqrt(lx * lx + lz * lz);
    const hVel = Math.sqrt(vx * vx + vz * vz);
    let f = Math.cos(pitchMC); f = f * f;
    vy += -0.08 + f * 0.06;
    if (vy < 0 && hLook > 0) { const d = vy * -0.1 * f; vy += d; vx += lx * d / hLook; vz += lz * d / hLook; }
    if (pitchMC < 0 && hLook > 0) { const d = hVel * -Math.sin(pitchMC) * 0.04; vy += d * 3.2; vx -= lx * d / hLook; vz -= lz * d / hLook; }
    if (hLook > 0) { vx += (lx / hLook * hVel - vx) * 0.1; vz += (lz / hLook * hVel - vz) * 0.1; }
    vx *= 0.99; vy *= 0.98; vz *= 0.99;
    if (p.boostTicks > 0) {
      p.boostTicks--;
      vx += lx * 0.1 + (lx * 1.5 - vx) * 0.5;
      vy += ly * 0.1 + (ly * 1.5 - vy) * 0.5;
      vz += lz * 0.1 + (lz * 1.5 - vz) * 0.5;
    }
    p.vx = vx / dt; p.vy = vy / dt; p.vz = vz / dt;
  } else if (p.flying) {
    const sp = input.sprint ? C.FLY_SPRINT_SPEED : C.FLY_SPEED;
    p.vx += (wx * sp - p.vx) * 0.25;
    p.vz += (wz * sp - p.vz) * 0.25;
    const vt = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * C.FLY_SPEED * 0.75;
    p.vy += (vt - p.vy) * 0.3;
  } else if (fs.water || fs.lava) {
    const lava = fs.lava && !fs.water;
    let sp = p.sprinting && fs.water ? C.SWIM_SPRINT_SPEED : C.SWIM_SPEED;
    if (lava) sp *= 0.5;
    if (p.swimming) {
      // swim along look direction
      const lx = -sy * Math.cos(p.pitch), ly = Math.sin(p.pitch), lz = -cy * Math.cos(p.pitch);
      p.vx += (lx * sp * input.forward - p.vx) * 0.2;
      p.vz += (lz * sp * input.forward - p.vz) * 0.2;
      p.vy += (ly * sp * input.forward - p.vy) * 0.2;
    } else {
      p.vx += (wx * sp - p.vx) * 0.2;
      p.vz += (wz * sp - p.vz) * 0.2;
      p.vy -= C.WATER_GRAVITY * dt;
      if (input.jump) p.vy += C.WATER_RISE_ACCEL * dt;
    }
    const drag = lava ? C.LAVA_DRAG : C.WATER_DRAG;
    p.vy *= drag;
    p.vx *= (1 - (1 - drag) * 0.25); p.vz *= (1 - (1 - drag) * 0.25);
    // flowing water push
    if (fs.water && (fs.flowX || fs.flowZ)) {
      const push = C.WATER_FLOW_PUSH * C.TICK_RATE * C.TICK_RATE * dt;
      p.vx += fs.flowX * push; p.vz += fs.flowZ * push;
    }
    if (input.sneak && !p.swimming) p.vy -= 2 * dt * 8;
    // jump out of water onto ledge
    if (input.jump && p.hcTicks > 0) p.vy = Math.max(p.vy, 4.5);
  } else {
    let sp = p.sprinting ? C.SPRINT_SPEED : (pose === 'sneak' ? C.SNEAK_SPEED : C.WALK_SPEED);
    if (p.usingItem) sp *= 0.3;
    const below = world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z));
    const slip = below !== UNLOADED && BLOCKS[below] && BLOCKS[below].slippery;
    if (below !== UNLOADED && BLOCKS[below] && BLOCKS[below].slow && p.onGround) sp *= BLOCKS[below].slow;
    const friction = slip ? C.ICE_FRICTION : C.GROUND_FRICTION;
    const k = p.onGround ? (1 - friction) * 0.9 : C.AIR_CONTROL;
    p.vx += (wx * sp - p.vx) * k;
    p.vz += (wz * sp - p.vz) * k;
    if (slip && p.onGround) { // ice keeps momentum but still allows acceleration
      p.vx += wx * sp * 0.05; p.vz += wz * sp * 0.05;
    }
    p.vy -= C.GRAVITY * dt;
    p.vy *= C.AIR_DRAG;
    if (p.vy < -C.TERMINAL_VELOCITY) p.vy = -C.TERMINAL_VELOCITY;
    if (input.jump && p.onGround && p.jumpCooldown <= 0) {
      p.vy = C.JUMP_VELOCITY;
      p.jumpCooldown = 2;
      ev.jumped = true;
      if (p.sprinting) { p.vx += -sy * 2.2; p.vz += -cy * 2.2; }
    }
    if (fs.ladder) {
      if (p.vy < -C.LADDER_MAX_FALL) p.vy = -C.LADDER_MAX_FALL;
      if (p.hcTicks > 0 || input.jump) p.vy = C.LADDER_CLIMB_SPEED;
      else if (pose === 'sneak' && p.vy < 0) p.vy = 0;
      p.fallDistance = 0;
    }
  }
  if (p.jumpCooldown > 0) p.jumpCooldown--;

  dx = p.vx * dt; dy = p.vy * dt; dz = p.vz * dt;

  // sneak edge protection
  if (pose === 'sneak' && p.onGround && !p.flying) {
    const step = 0.05;
    while (dx !== 0 && !boxCollides(world, p.x + dx, p.y - 0.6, p.z, w, 0.6)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !boxCollides(world, p.x, p.y - 0.6, p.z + dz, w, 0.6)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !boxCollides(world, p.x + dx, p.y - 0.6, p.z + dz, w, 0.6)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
  }

  collideMove(world, p.x, p.y, p.z, w, h, dx, dy, dz, mv);
  p.x += mv.dx; p.y += mv.dy; p.z += mv.dz;
  const wasGround = p.onGround;
  p.onGround = mv.onGround;
  if (mv.cx) p.vx = 0;
  if (mv.cz) p.vz = 0;
  if (mv.cy) p.vy = 0;
  ev.hc = mv.cx || mv.cz;
  p.hcTicks = ev.hc ? 2 : Math.max(0, (p.hcTicks || 0) - 1);
  if (p.gliding && ev.hc) {
    const after = Math.hypot(p.vx, p.vz);
    const dmg = (prevHSpeed - after) * C.DT * 10 - 3;
    if (dmg > 0) ev.crash = dmg;
  }
  // fall distance tracking (client-side copy; server computes its own)
  if (!p.onGround && mv.dy < 0 && !p.flying) p.fallDistance += -mv.dy;
  if (fs.water || fs.ladder || p.flying) p.fallDistance = 0;
  else if (p.gliding && mv.dy > -0.5) p.fallDistance = Math.min(p.fallDistance, 1);
  if (p.onGround) {
    if (!wasGround) { ev.landed = true; ev.fall = p.fallDistance; }
    p.fallDistance = 0;
    if (p.flying && !mode.spectator) p.flying = false;
    if (p.gliding) p.gliding = false;
  }
  if ((fs.water || fs.lava) && p.gliding) p.gliding = false;
  return ev;
}

/**
 * Mob movement: walk toward a wish direction with gravity, water buoyancy and step jumping.
 * m: { x,y,z, vx,vy,vz, w,h, onGround }
 */
export function stepMob(world, m, wishX, wishZ, speed, wantJump, opts = {}) {
  const dt = C.DT;
  fluidState(world, m, fs);
  m.inWater = fs.water; m.inLava = fs.lava;
  m.headInWater = fs.headWater;
  const k = m.onGround ? 0.35 : (fs.water ? 0.15 : 0.06);
  m.vx += (wishX * speed - m.vx) * k;
  m.vz += (wishZ * speed - m.vz) * k;
  if (fs.water || fs.lava) {
    m.vy -= C.WATER_GRAVITY * dt;
    if (opts.floats !== false && fs.waterDepth > m.h * 0.5) m.vy += 12 * dt;
    m.vy *= C.WATER_DRAG;
    if (fs.flowX || fs.flowZ) { m.vx += fs.flowX * 0.28; m.vz += fs.flowZ * 0.28; }
  } else {
    m.vy -= C.GRAVITY * dt;
    m.vy *= C.AIR_DRAG;
    if (opts.slowFall && m.vy < -3) m.vy = -3;
  }
  if (opts.climb && m.hc && (wishX || wishZ)) m.vy = 3;
  if (wantJump && (m.onGround || (fs.water && m.hc))) { m.vy = fs.water ? 5 : C.JUMP_VELOCITY; }
  if (m.vy < -C.TERMINAL_VELOCITY) m.vy = -C.TERMINAL_VELOCITY;
  collideMove(world, m.x, m.y, m.z, m.w, m.h, m.vx * dt, m.vy * dt, m.vz * dt, mv);
  m.x += mv.dx; m.y += mv.dy; m.z += mv.dz;
  if (mv.cx) m.vx = 0;
  if (mv.cz) m.vz = 0;
  if (mv.cy) m.vy = 0;
  const was = m.onGround;
  m.onGround = mv.onGround;
  m.hc = mv.cx || mv.cz;
  let fall = 0;
  if (!m.onGround && mv.dy < 0) m.fallDistance = (m.fallDistance || 0) - mv.dy;
  if (fs.water || opts.slowFall) m.fallDistance = 0;
  if (m.onGround) { if (!was) fall = m.fallDistance || 0; m.fallDistance = 0; }
  return fall;
}

// Simple projectile / item physics: gravity + drag + collision; returns true if it hit something.
export function stepProjectile(world, e, gravity, drag, out) {
  const dt = C.DT;
  e.vy -= gravity * dt;
  e.vx *= drag; e.vy *= drag; e.vz *= drag;
  collideMove(world, e.x, e.y, e.z, e.w, e.h, e.vx * dt, e.vy * dt, e.vz * dt, mv);
  e.x += mv.dx; e.y += mv.dy; e.z += mv.dz;
  if (out) { out.cx = mv.cx; out.cy = mv.cy; out.cz = mv.cz; }
  e.onGround = mv.onGround;
  const hit = mv.cx || mv.cy || mv.cz;
  if (mv.cy) e.vy = 0;
  if (mv.cx) e.vx = 0;
  if (mv.cz) e.vz = 0;
  return hit;
}

// Voxel raycast (Amanatides & Woo) with per-block selection boxes.
// Returns { x,y,z, face, id, meta, dist, px,py,pz } or null.
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, includeFluids = false) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity;
  let tmy = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity;
  let tmz = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
  let t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = world.getBlock(x, y, z);
    if (id !== 0 && id !== UNLOADED && (includeFluids || !IS_FLUID[id])) {
      if (!IS_FLUID[id] || includeFluids) {
        const meta = world.getMeta(x, y, z);
        if (IS_FLUID[id] && includeFluids && (meta & 7) !== 0) { /* only source blocks are targetable */ }
        else {
          const b = selectionBox(id, meta);
          const hit = rayBox(ox, oy, oz, dx, dy, dz, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
          if (hit && hit.t <= maxDist) {
            return { x, y, z, face: hit.face, id, meta, dist: hit.t, px: ox + dx * hit.t, py: oy + dy * hit.t, pz: oz + dz * hit.t };
          }
        }
      }
    }
    if (tmx < tmy) {
      if (tmx < tmz) { x += stepX; t = tmx; tmx += tdx; }
      else { z += stepZ; t = tmz; tmz += tdz; }
    } else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; }
    else { z += stepZ; t = tmz; tmz += tdz; }
  }
  return null;
}

// Ray vs AABB slab test. Returns { t, face } where face uses the 0..5 convention.
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const axes = [[ox, dx, x0, x1, 1, 0], [oy, dy, y0, y1, 3, 2], [oz, dz, z0, z1, 5, 4]];
  for (const [o, d, a, b, negFace, posFace] of axes) {
    if (Math.abs(d) < 1e-12) { if (o < a || o > b) return null; continue; }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    let f1 = negFace, f2 = posFace;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; const ff = f1; f1 = f2; f2 = ff; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face };
}

export function aabbIntersect(a, b) {
  return a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];
}

export { ID };
