// Procedural 16x16 block textures. Everything is drawn from seeded noise and palettes.
// Pixels with alpha 254 are "tint" pixels: the renderer multiplies them by the biome color.
import { mulberry32, hashString } from '../../../shared/noise.js';

export const TINT_ALPHA = 254;
const S = 16;

function newImg() { return new ImageData(S, S); }
function put(d, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  d.data[i] = clamp(r); d.data[i + 1] = clamp(g); d.data[i + 2] = clamp(b); d.data[i + 3] = a;
}
function get(d, x, y) { const i = (((y + S) % S) * S + ((x + S) % S)) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; }
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
function rngFor(name) { return mulberry32(hashString('tex:' + name)); }
function vary(c, n) { return [c[0] + n, c[1] + n, c[2] + n]; }
function hex(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
function fill(d, fn) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = fn(x, y); if (c) put(d, x, y, c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]); } }
function copy(src) { const d = newImg(); d.data.set(src.data); return d; }
const TAU = Math.PI * 2;

// Smooth value noise on a wrapping 16x16 grid (tileable).
function valueNoise(rng, cell) {
  const n = S / cell;
  const g = [];
  for (let i = 0; i < n * n; i++) g.push(rng());
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function noisy(base, amt, rng) { return (x, y) => vary(base, (rng() - 0.5) * amt); }

export const TILES = Object.create(null); // name -> ImageData
export const ANIMATED = Object.create(null); // name -> { frames: ImageData[], ticksPerFrame }

function tile(name, draw) { const d = newImg(); const rng = rngFor(name); draw(d, rng); TILES[name] = d; return d; }

// ---------------- base materials ----------------
function drawStone(d, rng) {
  const vn = valueNoise(rng, 4);
  fill(d, (x, y) => { const v = 118 + (vn(x, y) - 0.5) * 22 + (rng() - 0.5) * 16; return [v, v, v]; });
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16), len = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < len; k++) put(d, (x + k) % 16, y, 96, 96, 96);
  }
  for (let i = 0; i < 5; i++) { const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16); put(d, x, y, 145, 145, 145); }
}

function drawCobble(d, rng, tintFn) {
  const seeds = [];
  for (let i = 0; i < 9; i++) seeds.push([rng() * 16, rng() * 16, 0.75 + rng() * 0.4]);
  fill(d, (x, y) => {
    let d1 = 99, d2 = 99, best = null;
    for (const s of seeds) {
      for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
        const dd = Math.hypot(x + 0.5 - s[0] - ox, y + 0.5 - s[1] - oy);
        if (dd < d1) { d2 = d1; d1 = dd; best = [s, ox, oy]; } else if (dd < d2) d2 = dd;
      }
    }
    let c;
    if (d2 - d1 < 1.1) c = [72, 72, 72];
    else {
      const [s, ox, oy] = best;
      const v = 120 * s[2] + (rng() - 0.5) * 14;
      const hl = (x - s[0] - ox) + (y - s[1] - oy) < -1.5 ? 16 : ((x - s[0] - ox) + (y - s[1] - oy) > 2 ? -12 : 0);
      c = [v + hl, v + hl, v + hl];
    }
    return tintFn ? tintFn(c) : c;
  });
}

function drawDirt(d, rng) {
  const base = [134, 96, 67];
  fill(d, noisy(base, 20, rng));
  for (let i = 0; i < 26; i++) { const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16); const c = rng() < 0.5 ? [104, 74, 52] : [152, 112, 80]; put(d, x, y, ...c); }
  for (let i = 0; i < 3; i++) { const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16); put(d, x, y, 128, 128, 128); }
}

function drawGrassTop(d, rng) {
  const vn = valueNoise(rng, 4);
  fill(d, (x, y) => { const v = 205 + (vn(x, y) - 0.5) * 30 + (rng() - 0.5) * 34; return [v, v, v, TINT_ALPHA]; });
  for (let i = 0; i < 12; i++) { const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16); put(d, x, y, 240, 240, 240, TINT_ALPHA); }
}

function drawPlanks(d, rng, base = [162, 130, 78]) {
  const seamOff = [3, 11, 6, 13];
  for (let y = 0; y < 16; y++) {
    const board = y >> 2;
    const rowShade = (rng() - 0.5) * 10;
    for (let x = 0; x < 16; x++) {
      let c = vary(base, rowShade + (rng() - 0.5) * 10 + Math.sin(x * 0.9 + board * 3) * 4);
      if ((y & 3) === 3) c = vary(base, -46);
      else if (x === seamOff[board]) c = vary(base, -40);
      else if ((y & 3) === 0) c = vary(base, 8);
      put(d, x, y, ...c);
    }
  }
}

function drawLogSide(d, rng, base) {
  const cols = [];
  for (let x = 0; x < 16; x++) cols.push((rng() - 0.5) * 22);
  fill(d, (x, y) => vary(base, cols[x] + (rng() - 0.5) * 10 + (x % 4 === 0 ? -14 : 0)));
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rng() * 16), y0 = Math.floor(rng() * 16), len = 3 + Math.floor(rng() * 5);
    for (let k = 0; k < len; k++) put(d, x, (y0 + k) % 16, ...vary(base, -32));
  }
}

function drawLogTop(d, rng, inner, bark) {
  fill(d, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return vary(bark, (rng() - 0.5) * 12);
    const r = Math.hypot(x - 7.5, y - 7.5);
    const ring = Math.floor(r * 1.15) % 2;
    return vary(inner, (ring ? -20 : 0) + (rng() - 0.5) * 8);
  });
}

function drawLeaves(d, rng, dense) {
  const vn = valueNoise(rng, 4);
  fill(d, (x, y) => {
    const n = vn(x, y);
    if (rng() < (dense ? 0.08 : 0.2) + (n < 0.3 ? 0.15 : 0)) return [0, 0, 0, 0];
    const v = 150 + n * 80 + (rng() - 0.5) * 40;
    return [v, v, v, TINT_ALPHA];
  });
}

function drawOre(d, rng, ore, dark, light) {
  drawStone(d, rng);
  const clusters = 5;
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + Math.floor(rng() * 12), cy = 2 + Math.floor(rng() * 12);
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(rng() * 3) - 1, y = cy + Math.floor(rng() * 3) - 1;
      put(d, x, y, ...ore);
      if (rng() < 0.4) put(d, x + 1, y, ...dark);
      if (light && rng() < 0.3) put(d, x, y - 1, ...light);
    }
  }
}

function drawBevelBlock(d, rng, base, light, dark) {
  fill(d, (x, y) => {
    if (x === 0 || y === 0) return light;
    if (x === 15 || y === 15) return dark;
    if (x === 1 || y === 1) return vary(base, 20);
    if (x === 14 || y === 14) return vary(base, -20);
    return vary(base, (rng() - 0.5) * 10 + ((x + y) % 7 === 0 ? 14 : 0));
  });
}

function drawWool(d, rng, base) {
  fill(d, (x, y) => {
    const curl = Math.sin((x + (y % 4 < 2 ? 0 : 2)) * 1.6) * 0.5 + Math.sin(y * 1.6) * 0.5;
    return vary(base, curl * 10 + (rng() - 0.5) * 12);
  });
}

function drawSand(d, rng, base) {
  fill(d, noisy(base, 14, rng));
  for (let i = 0; i < 20; i++) { const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16); put(d, x, y, ...vary(base, rng() < 0.5 ? -22 : 14)); }
}

// ---------------- crack overlay ----------------
function buildCracks() {
  const rng = rngFor('cracks');
  const segs = [];
  const branch = (x, y, ang, len, depth) => {
    for (let i = 0; i < len; i++) {
      x += Math.cos(ang); y += Math.sin(ang);
      ang += (rng() - 0.5) * 0.9;
      segs.push([Math.round(x), Math.round(y)]);
      if (depth < 3 && rng() < 0.12) branch(x, y, ang + (rng() < 0.5 ? 1 : -1) * 1.1, Math.floor(len * 0.6), depth + 1);
    }
  };
  for (let k = 0; k < 5; k++) branch(7.5, 7.5, (k / 5) * TAU + rng(), 9, 0);
  for (let stage = 0; stage < 10; stage++) {
    const d = newImg();
    const n = Math.floor(segs.length * (stage + 1) / 10);
    for (let i = 0; i < n; i++) {
      const [x, y] = segs[i];
      put(d, ((x % 16) + 16) % 16, ((y % 16) + 16) % 16, 30, 30, 30, 210);
    }
    TILES['crack_' + stage] = d;
  }
}

// ---------------- animated fluids ----------------
function buildFluids() {
  const frames = 16;
  const ws = [], wf = [], ls = [], lf = [];
  const r = rngFor('fluid');
  const ph = []; for (let i = 0; i < 8; i++) ph.push(r() * TAU);
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const a = newImg(), b = newImg(), c = newImg(), e = newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const u = x / 16, v = y / 16;
      const w1 = Math.sin(TAU * (u * 2 + t) + ph[0]) + Math.sin(TAU * (v * 2 - t) + ph[1]) + 0.6 * Math.sin(TAU * (u + v + t * 2) + ph[2]);
      const wv = 196 + w1 * 13;
      put(a, x, y, wv, wv, wv, 178);
      const w2 = Math.sin(TAU * (v * 2 - t * 2) + Math.sin(TAU * u * 2) * 1.2 + ph[3]) + 0.5 * Math.sin(TAU * (u * 3 + v) + ph[4]);
      const fv = 192 + w2 * 16;
      put(b, x, y, fv, fv, fv, 185);
      const l1 = Math.sin(TAU * (u * 2 + t) + ph[5]) + Math.sin(TAU * (v * 2 + t) + ph[6]) + Math.sin(TAU * (u + v - t) + ph[7]);
      const lv = (l1 + 3) / 6;
      put(c, x, y, 200 + lv * 55, 60 + lv * 150, 10 + lv * 40 * lv);
      const l2 = Math.sin(TAU * (v * 2 - t * 2) + Math.sin(TAU * u * 2) + ph[5]) + 0.5 * Math.sin(TAU * (u * 2 + t) + ph[6]);
      const lw = (l2 + 1.5) / 3;
      put(e, x, y, 205 + lw * 50, 70 + lw * 140, 15 + lw * 35);
    }
    ws.push(a); wf.push(b); ls.push(c); lf.push(e);
  }
  ANIMATED.water_still = { frames: ws, ticksPerFrame: 2 };
  ANIMATED.water_flow = { frames: wf, ticksPerFrame: 1 };
  ANIMATED.lava_still = { frames: ls, ticksPerFrame: 3 };
  ANIMATED.lava_flow = { frames: lf, ticksPerFrame: 2 };
  TILES.water_still = ws[0]; TILES.water_flow = wf[0]; TILES.lava_still = ls[0]; TILES.lava_flow = lf[0];
}

function buildTorch() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const d = newImg();
    for (let y = 7; y < 16; y++) { put(d, 7, y, 120, 88, 46); put(d, 8, y, 92, 66, 34); }
    const fl = [[255, 255, 160], [255, 220, 80], [255, 170, 40], [240, 120, 20]];
    const o = f % 2;
    put(d, 7, 6, ...fl[(1 + o) % 4]); put(d, 8, 6, ...fl[(2 + f) % 4]);
    put(d, 7, 5, ...fl[o]); put(d, 8, 5, ...fl[(1 + f) % 3]);
    if (f !== 3) put(d, 7 + (f & 1), 4, ...fl[2]);
    frames.push(d);
  }
  ANIMATED.torch = { frames, ticksPerFrame: 3 };
  TILES.torch = frames[0];
}

// ---------------- all tiles ----------------
export function generateTiles() {
  tile('stone', drawStone);
  tile('cobblestone', (d, r) => drawCobble(d, r));
  tile('dirt', drawDirt);
  tile('grass_top', drawGrassTop);
  tile('grass_side', (d, rng) => {
    drawDirt(d, rng);
    for (let x = 0; x < 16; x++) {
      let h = 3 + (rng() < 0.5 ? 1 : 0);
      if (rng() < 0.18) h += 2;
      for (let y = 0; y < h; y++) { const v = 200 + (rng() - 0.5) * 36; put(d, x, y, v, v, v, TINT_ALPHA); }
    }
  });
  tile('grass_side_snowed', (d, rng) => {
    drawDirt(d, rng);
    for (let x = 0; x < 16; x++) {
      const h = 3 + (rng() < 0.4 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
      for (let y = 0; y < h; y++) put(d, x, y, ...vary([238, 246, 250], (rng() - 0.5) * 10));
    }
  });
  tile('sand', (d, r) => drawSand(d, r, [219, 207, 163]));
  tile('sandstone_top', (d, r) => drawSand(d, r, [216, 203, 155]));
  tile('sandstone_bottom', (d, r) => { drawSand(d, r, [205, 190, 140]); });
  tile('sandstone_side', (d, rng) => {
    fill(d, (x, y) => {
      let c = vary([214, 200, 152], (rng() - 0.5) * 10);
      if (y < 3) c = vary([224, 212, 166], (rng() - 0.5) * 8);
      if (y === 3 || y === 11) c = vary([188, 172, 124], (rng() - 0.5) * 8);
      if (y > 12) c = vary([200, 185, 136], (rng() - 0.5) * 10);
      return c;
    });
  });
  tile('gravel', (d, rng) => {
    fill(d, noisy([128, 122, 118], 18, rng));
    const pal = [[156, 150, 146], [102, 98, 94], [130, 112, 100], [88, 84, 80], [170, 162, 150]];
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16), c = pal[Math.floor(rng() * pal.length)];
      put(d, x, y, ...c); put(d, (x + 1) % 16, y, ...vary(c, -10)); put(d, x, (y + 1) % 16, ...vary(c, -20));
    }
  });
  tile('bedrock', (d, rng) => {
    const pal = [[58, 58, 58], [86, 86, 86], [36, 36, 36], [112, 112, 112], [70, 70, 70]];
    const vn = valueNoise(rng, 2);
    fill(d, (x, y) => vary(pal[Math.floor(vn(x, y) * pal.length) % pal.length], (rng() - 0.5) * 12));
  });
  tile('oak_log_side', (d, r) => drawLogSide(d, r, [108, 84, 50]));
  tile('oak_log_top', (d, r) => drawLogTop(d, r, [176, 142, 88], [104, 82, 50]));
  tile('spruce_log_side', (d, r) => drawLogSide(d, r, [62, 44, 26]));
  tile('spruce_log_top', (d, r) => drawLogTop(d, r, [130, 98, 60], [60, 42, 24]));
  tile('planks', (d, r) => drawPlanks(d, r));
  tile('leaves', (d, r) => drawLeaves(d, r, false));
  tile('spruce_leaves', (d, r) => drawLeaves(d, r, true));
  tile('glass', (d, rng) => {
    fill(d, (x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return [214, 236, 244, 255];
      if ((x === y + 3 && x < 9) || (x === y + 4 && x < 8) || (x + 2 === y && x > 8 && x < 13)) return [250, 255, 255, 180];
      return [0, 0, 0, 0];
    });
    void rng;
  });
  tile('coal_ore', (d, r) => drawOre(d, r, [42, 42, 42], [22, 22, 22], [70, 70, 70]));
  tile('iron_ore', (d, r) => drawOre(d, r, [216, 176, 146], [176, 136, 104], [236, 210, 186]));
  tile('gold_ore', (d, r) => drawOre(d, r, [250, 230, 70], [214, 168, 30], [255, 252, 180]));
  tile('diamond_ore', (d, r) => drawOre(d, r, [92, 236, 240], [34, 170, 180], [220, 255, 255]));
  tile('coal_block', (d, rng) => fill(d, (x, y) => vary([24, 24, 26], (rng() - 0.5) * 12 + ((x * 3 + y * 5) % 11 === 0 ? 26 : 0))));
  tile('iron_block', (d, r) => drawBevelBlock(d, r, [214, 214, 214], [250, 250, 250], [150, 150, 150]));
  tile('gold_block', (d, r) => drawBevelBlock(d, r, [246, 208, 60], [255, 250, 160], [200, 150, 30]));
  tile('diamond_block', (d, r) => drawBevelBlock(d, r, [98, 226, 220], [210, 255, 252], [40, 160, 160]));
  tile('crafting_table_top', (d, rng) => {
    drawPlanks(d, rng, [170, 128, 76]);
    fill(d, (x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return [88, 58, 32];
      if ((x === 5 || x === 10 || y === 5 || y === 10) && x > 1 && x < 14 && y > 1 && y < 14) return [116, 82, 46];
      return null;
    });
  });
  const tableSide = (front) => (d, rng) => {
    drawPlanks(d, rng, [160, 124, 74]);
    fill(d, (x, y) => (y < 2 ? [104, 72, 40] : null));
    if (front) {
      // hanging tools: pickaxe and saw silhouettes
      for (let x = 3; x <= 7; x++) put(d, x, 4, 150, 150, 150);
      put(d, 2, 5, 150, 150, 150); put(d, 8, 5, 150, 150, 150);
      for (let y = 5; y < 12; y++) put(d, 5, y, 110, 78, 40);
      for (let y = 4; y < 11; y++) { put(d, 11, y, 190, 190, 190); put(d, 12, y, 160, 160, 160); }
      put(d, 11, 11, 96, 66, 36); put(d, 12, 11, 96, 66, 36); put(d, 11, 12, 96, 66, 36);
    } else {
      for (let x = 3; x < 13; x++) put(d, x, 6, 70, 70, 70);
      for (let x = 4; x < 12; x += 2) put(d, x, 7, 130, 130, 130);
      for (let y = 9; y < 13; y++) { put(d, 6, y, 120, 84, 44); }
      for (let x = 4; x < 9; x++) put(d, x, 9, 140, 140, 140);
    }
  };
  tile('crafting_table_side', tableSide(false));
  tile('crafting_table_front', tableSide(true));
  tile('furnace_top', (d, rng) => fill(d, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15) ? vary([96, 96, 96], (rng() - 0.5) * 8) : vary([138, 138, 138], (rng() - 0.5) * 16)));
  tile('furnace_side', (d, rng) => {
    drawCobble(d, rng, (c) => vary(c, 6));
    fill(d, (x, y) => (y < 2 ? vary([150, 150, 150], (rng() - 0.5) * 10) : null));
  });
  const furnaceFront = (lit) => (d, rng) => {
    drawCobble(d, rng, (c) => vary(c, 6));
    fill(d, (x, y) => {
      if (y < 2) return vary([150, 150, 150], (rng() - 0.5) * 10);
      if (x >= 4 && x <= 11 && y === 4) return [60, 60, 60];
      if (x >= 4 && x <= 11 && y >= 5 && y <= 6 && x % 2 === 0) return [44, 44, 44];
      if (x >= 3 && x <= 12 && y >= 8 && y <= 13) {
        if (x === 3 || x === 12 || y === 8 || y === 13) return [70, 70, 70];
        if (!lit) return [24, 22, 22];
        const h = 13 - y;
        const flick = rng();
        return h < 2 ? [255, 210 + flick * 40, 80] : h < 3 ? [255, 140 + flick * 60, 30] : [140 + flick * 80, 40, 10];
      }
      return null;
    });
  };
  tile('furnace_front', furnaceFront(false));
  tile('furnace_front_lit', furnaceFront(true));
  const chestTex = (kind) => (d, rng) => {
    fill(d, (x, y) => {
      if (x === 0 || x === 15 || y === 0 || y === 15) return [70, 44, 18];
      if (kind !== 'top' && y === 5) return [70, 44, 18];
      return vary([164, 112, 52], (rng() - 0.5) * 12 + ((y % 4 === 0) ? -12 : 0));
    });
    if (kind === 'front') {
      for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) put(d, x, y, 190, 190, 190);
      put(d, 7, 7, 120, 120, 120); put(d, 8, 7, 120, 120, 120);
    }
  };
  tile('chest_top', chestTex('top'));
  tile('chest_side', chestTex('side'));
  tile('chest_front', chestTex('front'));
  tile('bed_top_foot', (d, rng) => fill(d, (x, y) => (x === 0 || x === 15) ? [130, 20, 20] : vary([176, 34, 34], (rng() - 0.5) * 10 + (y % 5 === 0 ? -16 : 0))));
  tile('bed_top_head', (d, rng) => fill(d, (x, y) => {
    if (y < 7 && x > 1 && x < 14) return vary([236, 236, 230], (rng() - 0.5) * 10 + (y === 6 ? -30 : 0));
    if (x === 0 || x === 15) return [130, 20, 20];
    return vary([176, 34, 34], (rng() - 0.5) * 10);
  }));
  tile('bed_side', (d, rng) => fill(d, (x, y) => {
    if (y < 7) return [0, 0, 0, 0];
    if (y < 12) return vary([176, 34, 34], (rng() - 0.5) * 10 + (y === 11 ? -24 : 0));
    if (y < 13) return vary([150, 110, 64], (rng() - 0.5) * 8);
    return (x < 3 || x > 12) ? vary([120, 86, 48], (rng() - 0.5) * 8) : [0, 0, 0, 0];
  }));
  tile('ladder', (d, rng) => fill(d, (x, y) => {
    if (x === 2 || x === 3 || x === 12 || x === 13) return vary([128, 96, 52], (rng() - 0.5) * 10 + (x === 3 || x === 13 ? -16 : 0));
    if ((y % 4 === 1) && x > 3 && x < 12) return vary([150, 114, 64], (rng() - 0.5) * 10);
    if ((y % 4 === 2) && x > 3 && x < 12) return vary([110, 80, 44], (rng() - 0.5) * 8);
    return [0, 0, 0, 0];
  }));
  const doorTex = (upper) => (d, rng) => fill(d, (x, y) => {
    if (x === 0 || x === 15 || (upper ? y === 0 : y === 15)) return [104, 74, 40];
    if (upper && y >= 3 && y <= 11 && x >= 3 && x <= 12) {
      if (x === 7 || x === 8 || y === 7) return [104, 74, 40];
      return [0, 0, 0, 0];
    }
    if (!upper && x === 12 && y === 1) return [70, 70, 70];
    return vary([160, 124, 72], (rng() - 0.5) * 10 + (x % 5 === 0 ? -14 : 0));
  });
  tile('door_lower', doorTex(false));
  tile('door_upper', doorTex(true));
  tile('snow', (d, rng) => fill(d, () => vary([240, 250, 252], (rng() - 0.5) * 10)));
  tile('ice', (d, rng) => {
    fill(d, (x, y) => [150 + (rng() - 0.5) * 10, 186 + (rng() - 0.5) * 10, 252, 190]);
    for (let i = 0; i < 3; i++) {
      let x = rng() * 16, y = rng() * 16; const a = rng() * TAU;
      for (let k = 0; k < 7; k++) { put(d, Math.floor(x) & 15, Math.floor(y) & 15, 214, 236, 255, 220); x += Math.cos(a); y += Math.sin(a); }
    }
  });
  tile('cactus_side', (d, rng) => fill(d, (x, y) => {
    if (x === 0 || x === 15) return [0, 0, 0, 0];
    if ((x === 3 || x === 8 || x === 12) && (y % 4 === 1)) return [220, 230, 190];
    if (x === 2 || x === 7 || x === 11) return vary([14, 92, 28], (rng() - 0.5) * 8);
    return vary([24, 124, 38], (rng() - 0.5) * 14);
  }));
  tile('cactus_top', (d, rng) => fill(d, (x, y) => {
    const r = Math.hypot(x - 7.5, y - 7.5);
    if (x === 0 || x === 15 || y === 0 || y === 15) return [0, 0, 0, 0];
    if (r < 3) return vary([110, 170, 80], (rng() - 0.5) * 10);
    return vary([30, 130, 40], (rng() - 0.5) * 12 + (Math.floor(r) % 2 ? -10 : 0));
  }));
  tile('cactus_bottom', (d, rng) => fill(d, (x, y) => (x === 0 || x === 15 || y === 0 || y === 15) ? [0, 0, 0, 0] : vary([40, 120, 46], (rng() - 0.5) * 12)));
  tile('tall_grass', (d, rng) => {
    for (let b = 0; b < 9; b++) {
      let x = 1 + rng() * 14; const h = 6 + Math.floor(rng() * 9); const lean = (rng() - 0.5) * 0.5;
      for (let k = 0; k < h; k++) { const v = 175 + k * 5 + (rng() - 0.5) * 20; put(d, Math.floor(x), 15 - k, v, v, v, TINT_ALPHA); x += lean; }
    }
  });
  tile('poppy', (d, rng) => {
    for (let y = 8; y < 16; y++) put(d, 7, y, 40, 118, 30);
    put(d, 8, 12, 50, 140, 40); put(d, 9, 11, 50, 140, 40); put(d, 6, 13, 50, 140, 40); put(d, 5, 12, 50, 140, 40);
    for (let y = 3; y < 8; y++) for (let x = 5; x < 10; x++) {
      if ((x === 5 || x === 9) && (y === 3 || y === 7)) continue;
      put(d, x, y, ...vary([214, 30, 30], (rng() - 0.5) * 30));
    }
    put(d, 7, 5, 30, 20, 20);
  });
  tile('dandelion', (d, rng) => {
    for (let y = 9; y < 16; y++) put(d, 7, y, 50, 128, 34);
    put(d, 6, 13, 60, 150, 40); put(d, 8, 12, 60, 150, 40);
    for (let y = 5; y < 9; y++) for (let x = 6; x < 10; x++) put(d, x, y, ...vary([250, 222, 40], (rng() - 0.5) * 24));
    put(d, 7, 6, 240, 160, 30); put(d, 8, 7, 240, 160, 30);
  });
  tile('sugar_cane', (d, rng) => {
    for (const sx of [3, 8, 12]) {
      for (let y = 0; y < 16; y++) {
        const joint = (y + sx) % 5 === 0;
        const v = joint ? 240 : 200 + (rng() - 0.5) * 20;
        put(d, sx, y, v, v, v, TINT_ALPHA); put(d, sx + 1, y, v - 30, v - 30, v - 30, TINT_ALPHA);
      }
      put(d, sx - 1, (sx * 3) % 16, 150, 150, 150, TINT_ALPHA); put(d, sx + 2, (sx * 5 + 4) % 16, 150, 150, 150, TINT_ALPHA);
    }
  });
  tile('oak_sapling', (d, rng) => {
    for (let y = 9; y < 16; y++) put(d, 7, y, 104, 78, 40);
    for (let y = 2; y < 10; y++) for (let x = 3; x < 12; x++) {
      const r = Math.hypot(x - 7, y - 5.5);
      if (r < 4 && rng() > 0.2) put(d, x, y, ...vary([60, 140, 30], (rng() - 0.5) * 40));
    }
  });
  tile('spruce_sapling', (d, rng) => {
    for (let y = 11; y < 16; y++) put(d, 7, y, 70, 50, 28);
    for (let y = 1; y < 12; y++) { const w = Math.floor((y - 1) / 2.2); for (let x = 7 - w; x <= 8 + w; x++) if (rng() > 0.15) put(d, x, y, ...vary([40, 96, 50], (rng() - 0.5) * 30)); }
  });
  tile('wool_white', (d, r) => drawWool(d, r, [232, 232, 232]));
  tile('wool_red', (d, r) => drawWool(d, r, [176, 40, 36]));
  tile('wool_yellow', (d, r) => drawWool(d, r, [244, 204, 46]));
  tile('wool_black', (d, r) => drawWool(d, r, [32, 30, 34]));
  tile('farmland_top', (d, rng) => fill(d, (x, y) => vary(y % 4 === 3 ? [70, 44, 26] : [98, 64, 40], (rng() - 0.5) * 14 + (y % 4 === 0 ? 10 : 0))));
  for (let s = 0; s < 8; s++) {
    tile('wheat_' + s, (d, rng) => {
      const h = 3 + Math.floor(s * 1.6);
      const ripe = s / 7;
      for (const bx of [2, 5, 9, 12]) {
        for (let k = 0; k < h; k++) {
          const g = [60 + ripe * 140, 150 - ripe * 10, 40 + ripe * 10];
          put(d, bx + (k > h / 2 && bx % 2 ? 1 : 0), 15 - k, ...vary(g, (rng() - 0.5) * 20));
        }
        if (s >= 5) for (let k = h - 3; k < h; k++) { put(d, bx - 1, 15 - k, 200, 170, 70); put(d, bx + 1, 15 - k, 186, 150, 60); }
      }
    });
  }
  tile('white', (d) => fill(d, () => [255, 255, 255]));
  // ---- The End ----
  tile('end_stone', (d, rng) => { const vn = valueNoise(rng, 4); fill(d, (x, y) => vary([222, 222, 162], (vn(x, y) - 0.5) * 26 + (rng() - 0.5) * 14 + ((x * 3 + y * 5) % 11 === 0 ? -30 : 0))); });
  tile('eframe_side', (d, rng) => fill(d, (x, y) => (y < 3 ? vary([40, 90, 80], (rng() - 0.5) * 20) : vary([222, 222, 162], (rng() - 0.5) * 18))));
  tile('eframe_top', (d, rng) => fill(d, (x, y) => (x < 2 || x > 13 || y < 2 || y > 13 ? vary([222, 222, 162], (rng() - 0.5) * 18) : (Math.hypot(x - 7.5, y - 7.5) < 3.5 ? [20, 40, 40] : vary([50, 110, 100], (rng() - 0.5) * 20)))));
  tile('eframe_eye', (d) => fill(d, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); return r < 2 ? [10, 10, 10] : r < 5 ? [40, 160, 80] : [20, 90, 60]; }));
  // ---- Nether ----
  tile('obsidian', (d, rng) => fill(d, () => { const r = rng(); return r < 0.08 ? [70, 40, 110] : vary([20, 14, 32], (rng() - 0.5) * 14); }));
  tile('netherrack', (d, rng) => { const vn = valueNoise(rng, 4); fill(d, (x, y) => vary([110, 36, 36], (vn(x, y) - 0.5) * 40 + (rng() - 0.5) * 22)); });
  tile('soul_sand', (d, rng) => { fill(d, () => vary([82, 62, 50], (rng() - 0.5) * 18)); for (let i = 0; i < 4; i++) { const x = 2 + Math.floor(rng() * 11), y = 2 + Math.floor(rng() * 10); put(d, x, y, 40, 28, 22); put(d, x + 2, y, 40, 28, 22); put(d, x + 1, y + 2, 40, 28, 22); } });
  tile('glowstone', (d, rng) => fill(d, (x, y) => ((x + y * 3) % 5 === 0 || rng() < 0.15) ? [255, 240, 170] : vary([200, 150, 70], (rng() - 0.5) * 50)));
  const netherOre = (c1, c2) => (d, rng) => { const vn = valueNoise(rng, 4); fill(d, (x, y) => vary([110, 36, 36], (vn(x, y) - 0.5) * 40 + (rng() - 0.5) * 22)); for (let i = 0; i < 9; i++) { const x = 1 + Math.floor(rng() * 14), y = 1 + Math.floor(rng() * 14); put(d, x, y, ...c1); put(d, x + 1, y, ...c2); } };
  tile('nether_quartz_ore', netherOre([236, 230, 220], [200, 190, 180]));
  tile('nether_gold_ore', netherOre([250, 210, 60], [210, 160, 30]));
  tile('magma', (d, rng) => fill(d, (x, y) => ((x * 5 + y * 3) % 7 < 2) ? [255, 140 + rng() * 60, 30] : vary([90, 30, 20], (rng() - 0.5) * 20)));
  tile('basalt_side', (d, rng) => fill(d, (x) => vary([74, 74, 80], (x % 4 === 0 ? -18 : 0) + (rng() - 0.5) * 16)));
  tile('basalt_top', (d, rng) => fill(d, (x, y) => vary([86, 86, 92], (Math.hypot(x - 7.5, y - 7.5) % 3 < 1 ? -14 : 0) + (rng() - 0.5) * 14)));
  buildCracks();
  buildFluids();
  buildTorch();
  const pf = [];
  for (let f = 0; f < 16; f++) {
    const d = newImg();
    const t = f / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const u = x / 16 - 0.5, v = y / 16 - 0.5;
      const sw = Math.sin(TAU * (Math.hypot(u, v) * 2 - t) + Math.atan2(v, u) * 2) * 0.5 + 0.5;
      put(d, x, y, 120 + sw * 90, 30 + sw * 40, 200 + sw * 55, 190);
    }
    pf.push(d);
  }
  ANIMATED.nether_portal = { frames: pf, ticksPerFrame: 2 };
  const ef = [], stars = [];
  const sr = rngFor('endstars');
  for (let i = 0; i < 24; i++) stars.push([sr() * 16, sr() * 16, sr()]);
  for (let f = 0; f < 16; f++) {
    const d = newImg();
    fill(d, () => [8, 12, 20]);
    for (const [sx, sy, c] of stars) put(d, Math.floor(sx + f * (0.5 + c)) & 15, Math.floor(sy + f * 0.3) & 15, 60 + c * 120, 160 + c * 90, 150 + c * 100);
    ef.push(d);
  }
  ANIMATED.end_portal = { frames: ef, ticksPerFrame: 3 };
  TILES.end_portal = ef[0];
  TILES.nether_portal = pf[0];
}

// Copy a tile into a canvas context at (x, y), optionally multiplying tint pixels.
export function tileToCanvas(name, tint = null, frame = 0) {
  const src = (ANIMATED[name] ? ANIMATED[name].frames[frame % ANIMATED[name].frames.length] : TILES[name]) || TILES.stone;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(16, 16);
  out.data.set(src.data);
  if (tint) {
    const [tr, tg, tb] = tint;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === TINT_ALPHA || name.startsWith('water')) {
        out.data[i] = out.data[i] * tr / 255; out.data[i + 1] = out.data[i + 1] * tg / 255; out.data[i + 2] = out.data[i + 2] * tb / 255;
        if (out.data[i + 3] === TINT_ALPHA) out.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

export { hex, copy, get };
