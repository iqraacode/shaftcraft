// Box-rig models for players and mobs with procedurally painted skins (UV-mapped canvases),
// plus extruded 3D item meshes built from 16x16 icons.
import * as THREE from 'three';
import { mulberry32, hashString } from '../../../shared/noise.js';

// ---------- geometry ----------
// Build a box with MC-style UV unwrap. Sizes in pixels (1/16 block). Texture origin (u,v).
export function boxGeometry(x0, y0, z0, w, h, d, u, v, texW, texH, inflate = 0, mirror = false) {
  const hx0 = x0 - inflate, hy0 = y0 - inflate, hz0 = z0 - inflate;
  const hx1 = x0 + w + inflate, hy1 = y0 + h + inflate, hz1 = z0 + d + inflate;
  const pos = [], uvs = [], idx = [];
  const face = (corners, rx, ry, rw, rh) => {
    const b = pos.length / 3;
    for (const c of corners) pos.push(c[0] / 16, c[1] / 16, c[2] / 16);
    let u0 = rx / texW, u1 = (rx + rw) / texW;
    if (mirror) { const t = u0; u0 = u1; u1 = t; }
    const v0 = ry / texH, v1 = (ry + rh) / texH;
    uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // front (-z)
  face([[hx1, hy0, hz0], [hx0, hy0, hz0], [hx0, hy1, hz0], [hx1, hy1, hz0]], u + d, v + d, w, h);
  // back (+z)
  face([[hx0, hy0, hz1], [hx1, hy0, hz1], [hx1, hy1, hz1], [hx0, hy1, hz1]], u + 2 * d + w, v + d, w, h);
  // right (+x)
  face([[hx1, hy0, hz1], [hx1, hy0, hz0], [hx1, hy1, hz0], [hx1, hy1, hz1]], u, v + d, d, h);
  // left (-x)
  face([[hx0, hy0, hz0], [hx0, hy0, hz1], [hx0, hy1, hz1], [hx0, hy1, hz0]], u + d + w, v + d, d, h);
  // top (+y)
  face([[hx1, hy1, hz0], [hx0, hy1, hz0], [hx0, hy1, hz1], [hx1, hy1, hz1]], u + d, v, w, d);
  // bottom (-y)
  face([[hx1, hy0, hz1], [hx0, hy0, hz1], [hx0, hy0, hz0], [hx1, hy0, hz0]], u + d + w, v, w, d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

// ---------- skin painting ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rgbStr(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function shade(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// Paint a rect with base color + per-pixel noise.
function paint(ctx, x, y, w, h, color, rng, amt = 0.08) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = 1 + (rng() - 0.5) * amt * 2;
    ctx.fillStyle = rgbStr(shade(color, k));
    ctx.fillRect(x + i, y + j, 1, 1);
  }
}
function px(ctx, x, y, c) { ctx.fillStyle = rgbStr(c); ctx.fillRect(x, y, 1, 1); }

// Face regions of a box at (u,v) with size w,h,d.
function regions(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
}
function paintBox(ctx, u, v, w, h, d, color, rng, amt) {
  const r = regions(u, v, w, h, d);
  for (const k of Object.keys(r)) paint(ctx, ...r[k], color, rng, amt);
  return r;
}

const SKIN_TONES = [[247, 210, 180], [233, 186, 150], [198, 144, 106], [160, 110, 76], [118, 80, 54], [88, 58, 40]];

// Humanoid skin (64x32 layout): head(0,0,8,8,8) body(16,16,8,12,4) arm(40,16,4,12,4) leg(0,16,4,12,4)
// Dressing-room palettes. A custom skin is { tone, hair, shirt, pants, long } (indices).
export const SKIN_PALETTE = {
  tone: SKIN_TONES,
  hair: [[40, 26, 16], [90, 56, 30], [150, 100, 50], [220, 190, 110], [170, 60, 30], [20, 20, 22], [200, 200, 200], [60, 90, 200]],
  cloth: [[40, 160, 170], [200, 40, 50], [50, 100, 200], [60, 150, 60], [230, 200, 60], [130, 60, 170], [240, 140, 40], [235, 235, 235], [40, 40, 44], [120, 80, 50], [240, 120, 170], [70, 60, 150]],
};

export function playerSkinTexture(name, skin) {
  const key = 'player:' + name.toLowerCase() + (skin ? ':' + [skin.tone, skin.hair, skin.shirt, skin.pants, skin.long ? 1 : 0].join(',') : '');
  return skinTexture(key, () => paintPlayerSkin(name, skin));
}

export function paintPlayerSkin(name, custom = null) {
  const rng = mulberry32(hashString('skin:' + name.toLowerCase()));
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const P = SKIN_PALETTE;
  const pick = (arr, i) => arr[((i | 0) % arr.length + arr.length) % arr.length];
  let skin = SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)];
  let hair = hsl(rng() * 0.12, 0.3 + rng() * 0.5, 0.1 + rng() * 0.45);
  let shirt = hsl(rng(), 0.35 + rng() * 0.5, 0.3 + rng() * 0.35);
  let pants = hsl(rng(), 0.2 + rng() * 0.5, 0.18 + rng() * 0.3);
  const eye = hsl(rng(), 0.6, 0.35 + rng() * 0.2);
  let longHair = rng() < 0.4;
  if (custom) {
    skin = pick(P.tone, custom.tone); hair = pick(P.hair, custom.hair);
    shirt = pick(P.cloth, custom.shirt); pants = pick(P.cloth, custom.pants); longHair = !!custom.long;
  }
  const shoes = shade(pants, 0.5);
  // head
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, skin, rng, 0.04);
  paint(ctx, ...hr.top, hair, rng, 0.12);
  for (const k of ['front', 'left', 'right', 'back']) {
    const [x, y, w, h] = hr[k];
    const depth = k === 'front' ? 2 : k === 'back' ? (longHair ? 8 : 6) : (longHair ? 7 : 4);
    paint(ctx, x, y, w, depth, hair, rng, 0.12);
  }
  {
    const [x, y] = hr.front;
    px(ctx, x + 1, y + 4, [255, 255, 255]); px(ctx, x + 2, y + 4, eye);
    px(ctx, x + 5, y + 4, eye); px(ctx, x + 6, y + 4, [255, 255, 255]);
    px(ctx, x + 3, y + 5, shade(skin, 0.85)); px(ctx, x + 4, y + 5, shade(skin, 0.85));
    ctx.fillStyle = rgbStr(shade(skin, 0.6)); ctx.fillRect(x + 3, y + 6, 2, 1);
  }
  // body
  const br = paintBox(ctx, 16, 16, 8, 12, 4, shirt, rng, 0.08);
  { const [x, y] = br.front; ctx.fillStyle = rgbStr(skin); ctx.fillRect(x + 3, y, 2, 1); px(ctx, x + 3, y + 1, skin); ctx.fillStyle = rgbStr(shade(pants, 0.8)); ctx.fillRect(x, y + 11, 8, 1); }
  // arms
  const ar = paintBox(ctx, 40, 16, 4, 12, 4, skin, rng, 0.04);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = ar[k]; paint(ctx, x, y, w, 4, shirt, rng, 0.08); }
  paint(ctx, ...ar.top, shirt, rng, 0.08);
  // legs
  const lr = paintBox(ctx, 0, 16, 4, 12, 4, pants, rng, 0.08);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = lr[k]; paint(ctx, x, y + 10, w, 2, shoes, rng, 0.06); }
  paint(ctx, ...lr.bottom, shoes, rng, 0.06);
  return c;
}

function paintZombie() {
  const rng = mulberry32(777);
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const skin = [96, 150, 76];
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, skin, rng, 0.1);
  { const [x, y] = hr.front; ctx.fillStyle = '#111'; ctx.fillRect(x + 1, y + 3, 2, 2); ctx.fillRect(x + 5, y + 3, 2, 2); ctx.fillStyle = rgbStr(shade(skin, 0.5)); ctx.fillRect(x + 2, y + 6, 4, 1); }
  paint(ctx, ...hr.top, shade(skin, 0.8), rng, 0.15);
  paintBox(ctx, 16, 16, 8, 12, 4, [40, 160, 170], rng, 0.12);
  const ar = paintBox(ctx, 40, 16, 4, 12, 4, skin, rng, 0.1);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = ar[k]; paint(ctx, x, y, w, 4, [40, 160, 170], rng, 0.12); }
  paintBox(ctx, 0, 16, 4, 12, 4, [70, 60, 150], rng, 0.12);
  const lr = regions(0, 16, 4, 12, 4);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = lr[k]; paint(ctx, x, y + 10, w, 2, [60, 60, 60], rng, 0.1); }
  return c;
}

function paintSkeleton() {
  const rng = mulberry32(888);
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const bone = [200, 200, 196];
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, bone, rng, 0.08);
  { const [x, y] = hr.front; ctx.fillStyle = '#222'; ctx.fillRect(x + 1, y + 3, 2, 2); ctx.fillRect(x + 5, y + 3, 2, 2); ctx.fillRect(x + 3, y + 5, 2, 1); ctx.fillStyle = '#555'; for (let i = 1; i < 7; i += 2) ctx.fillRect(x + i, y + 7, 1, 1); }
  const br = paintBox(ctx, 16, 16, 8, 12, 4, bone, rng, 0.08);
  { const [x, y] = br.front; ctx.fillStyle = '#333'; for (let r = 1; r < 9; r += 2) ctx.fillRect(x + 1, y + r, 6, 1); ctx.fillRect(x + 3, y, 2, 12); }
  { const [x, y] = br.back; ctx.fillStyle = '#333'; for (let r = 1; r < 9; r += 2) ctx.fillRect(x + 1, y + r, 6, 1); }
  paintBox(ctx, 40, 16, 2, 12, 2, bone, rng, 0.08);
  paintBox(ctx, 0, 16, 2, 12, 2, bone, rng, 0.08);
  return c;
}

function paintCreeper() {
  const rng = mulberry32(999);
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const camo = (x, y, w, h) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const r = rng();
      const col = r < 0.25 ? [62, 150, 50] : r < 0.5 ? [90, 190, 70] : r < 0.75 ? [40, 120, 40] : [120, 200, 100];
      px(ctx, x + i, y + j, col);
    }
  };
  for (const [u, v, w, h, d] of [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [0, 16, 4, 6, 4]]) {
    const r = regions(u, v, w, h, d);
    for (const k of Object.keys(r)) camo(...r[k]);
  }
  const [x, y] = regions(0, 0, 8, 8, 8).front;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(x + 1, y + 2, 2, 2); ctx.fillRect(x + 5, y + 2, 2, 2);
  ctx.fillRect(x + 3, y + 4, 2, 3); ctx.fillRect(x + 2, y + 5, 1, 3); ctx.fillRect(x + 5, y + 5, 1, 3);
  return c;
}

function paintPig() {
  const rng = mulberry32(111);
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const pink = [240, 160, 160];
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, pink, rng, 0.06);
  { const [x, y] = hr.front; ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 2, 1, 1); ctx.fillRect(x + 6, y + 2, 1, 1); ctx.fillStyle = '#222'; ctx.fillRect(x + 2, y + 2, 1, 1); ctx.fillRect(x + 5, y + 2, 1, 1); }
  const sr = paintBox(ctx, 32, 0, 4, 3, 1, [250, 180, 180], rng, 0.05);
  { const [x, y] = sr.front; ctx.fillStyle = '#7a3c3c'; ctx.fillRect(x, y + 1, 1, 1); ctx.fillRect(x + 3, y + 1, 1, 1); }
  paintBox(ctx, 0, 16, 4, 6, 4, pink, rng, 0.06);
  const lr = regions(0, 16, 4, 6, 4);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = lr[k]; paint(ctx, x, y + 5, w, 1, [180, 110, 110], rng, 0.05); }
  paintBox(ctx, 0, 32, 10, 8, 16, pink, rng, 0.07);
  return c;
}

function paintCow() {
  const rng = mulberry32(222);
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const spotty = (x, y, w, h, seed) => {
    const r2 = mulberry32(seed);
    const spots = [];
    for (let i = 0; i < 3; i++) spots.push([r2() * w, r2() * h, 2 + r2() * 4]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = spots.some(([sx, sy, sr]) => Math.hypot(i - sx, j - sy) < sr);
      px(ctx, x + i, y + j, shade(s ? [235, 235, 235] : [60, 44, 34], 1 + (rng() - 0.5) * 0.1));
    }
  };
  let seed = 1;
  for (const [u, v, w, h, d] of [[0, 0, 8, 8, 6], [0, 16, 4, 12, 4], [0, 32, 12, 10, 18]]) {
    const r = regions(u, v, w, h, d);
    for (const k of Object.keys(r)) spotty(...r[k], seed++);
  }
  const hr = regions(0, 0, 8, 8, 6);
  { const [x, y] = hr.front; ctx.fillStyle = '#ddd'; ctx.fillRect(x + 2, y + 5, 4, 3); ctx.fillStyle = '#111'; ctx.fillRect(x + 1, y + 2, 1, 1); ctx.fillRect(x + 6, y + 2, 1, 1); ctx.fillStyle = '#c99'; ctx.fillRect(x + 2, y + 6, 1, 1); ctx.fillRect(x + 5, y + 6, 1, 1); }
  paintBox(ctx, 28, 0, 1, 3, 1, [220, 214, 196], rng, 0.05);
  const lr = regions(0, 16, 4, 12, 4);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = lr[k]; paint(ctx, x, y + 10, w, 2, [40, 30, 24], rng, 0.05); }
  return c;
}

function paintSheep() {
  const rng = mulberry32(333);
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const face = [230, 200, 180];
  const hr = paintBox(ctx, 0, 0, 6, 6, 8, face, rng, 0.05);
  { const [x, y] = hr.front; ctx.fillStyle = '#111'; ctx.fillRect(x + 1, y + 2, 1, 1); ctx.fillRect(x + 4, y + 2, 1, 1); ctx.fillStyle = '#b88'; ctx.fillRect(x + 2, y + 4, 2, 1); }
  paintBox(ctx, 0, 16, 4, 12, 4, face, rng, 0.05);
  paintBox(ctx, 0, 32, 8, 7, 16, [214, 190, 170], rng, 0.06);
  return c;
}

export function paintWool(color) {
  const rng = mulberry32(hashString('wool' + color));
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const base = color === 'black' ? [36, 34, 38] : color === 'red' ? [176, 40, 36] : color === 'yellow' ? [244, 204, 46] : [236, 236, 236];
  // body wool (10x9x18 at 0,0) and head wool (8,7,6 at 0,32)
  for (const [u, v, w, h, d] of [[0, 0, 10, 9, 18], [0, 32, 8, 7, 6]]) {
    const r = regions(u, v, w, h, d);
    for (const k of Object.keys(r)) paint(ctx, ...r[k], base, rng, 0.12);
  }
  return c;
}

function paintChicken() {
  const rng = mulberry32(444);
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const white = [244, 244, 240];
  const hr = paintBox(ctx, 0, 0, 4, 6, 3, white, rng, 0.04);
  { const [x, y] = hr.front; ctx.fillStyle = '#111'; ctx.fillRect(x, y + 2, 1, 1); ctx.fillRect(x + 3, y + 2, 1, 1); }
  paintBox(ctx, 16, 0, 4, 2, 2, [250, 180, 40], rng, 0.05);
  paintBox(ctx, 16, 8, 2, 2, 2, [220, 40, 40], rng, 0.05);
  paintBox(ctx, 0, 32, 6, 6, 8, white, rng, 0.05);
  paintBox(ctx, 32, 0, 1, 4, 6, [228, 228, 224], rng, 0.05);
  paintBox(ctx, 32, 16, 1, 5, 1, [240, 170, 40], rng, 0.05);
  return c;
}

function paintSpider() {
  const rng = mulberry32(555);
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const dark = [52, 44, 40];
  paintBox(ctx, 0, 0, 6, 6, 6, dark, rng, 0.15);
  const hr = paintBox(ctx, 24, 0, 8, 8, 8, dark, rng, 0.15);
  { const [x, y] = hr.front; ctx.fillStyle = '#d01010'; ctx.fillRect(x + 1, y + 2, 2, 1); ctx.fillRect(x + 5, y + 2, 2, 1); ctx.fillRect(x + 2, y + 4, 1, 1); ctx.fillRect(x + 5, y + 4, 1, 1); ctx.fillStyle = '#ff5050'; ctx.fillRect(x + 1, y + 2, 1, 1); ctx.fillRect(x + 6, y + 2, 1, 1); }
  const ar = paintBox(ctx, 0, 32, 10, 8, 12, [70, 58, 50], rng, 0.18);
  { const [x, y, w, h] = ar.top; ctx.fillStyle = '#2a2220'; for (let i = 0; i < 5; i++) ctx.fillRect(x + 1 + Math.floor(rng() * (w - 2)), y + Math.floor(rng() * h), 2, 1); }
  paintBox(ctx, 0, 16, 16, 2, 2, [44, 36, 32], rng, 0.15);
  return c;
}

export function paintArmor(material) {
  const base = { leather: [143, 90, 50], golden: [242, 215, 74], iron: [216, 216, 216], diamond: [92, 232, 222] }[material] || [200, 200, 200];
  const rng = mulberry32(hashString('armor' + material));
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  for (const [u, v, w, h, d] of [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [40, 16, 4, 12, 4], [0, 16, 4, 12, 4]]) {
    const r = regions(u, v, w, h, d);
    for (const k of Object.keys(r)) {
      const [x, y, ww, hh] = r[k];
      paint(ctx, x, y, ww, hh, base, rng, 0.1);
      ctx.fillStyle = rgbStr(shade(base, 0.65));
      ctx.fillRect(x, y + hh - 1, ww, 1);
    }
  }
  // visor gap on helmet front
  const [fx, fy] = regions(0, 0, 8, 8, 8).front;
  ctx.clearRect(fx + 1, fy + 3, 6, 5);
  return c;
}

function paintWings() {
  const rng = mulberry32(666);
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const ribs = x % 6 === 0 ? 0.7 : 1;
    px(ctx, x, y, shade([150, 140, 190], ribs * (1 + (rng() - 0.5) * 0.12)));
  }
  return c;
}

const textureCache = new Map();
export function skinTexture(key, painter) {
  let t = textureCache.get(key);
  if (t) return t;
  const c = painter();
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  textureCache.set(key, t);
  return t;
}

const ROBES = { farmer: [150, 110, 60], librarian: [235, 235, 225], toolsmith: [60, 60, 66], butcher: [220, 220, 220], shepherd: [150, 100, 60] };
const APRON = { farmer: [200, 170, 90], librarian: [170, 40, 40], toolsmith: [40, 40, 40], butcher: [200, 60, 60], shepherd: [235, 235, 235] };
const STYLE_TONE = { plains: [196, 150, 110], desert: [170, 120, 80], snowy: [220, 180, 150] };
const STYLE_TRIM = { plains: [110, 80, 50], desert: [200, 170, 90], snowy: [40, 130, 120] };

export function paintVillager(prof, style) {
  const rng = mulberry32(hashString('villager' + prof + style));
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const skin = STYLE_TONE[style] || STYLE_TONE.plains;
  const robe = ROBES[prof] || ROBES.farmer, apron = APRON[prof] || APRON.farmer, trim = STYLE_TRIM[style] || STYLE_TRIM.plains;
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, skin, rng, 0.05);
  { const [x, y] = hr.front; ctx.fillStyle = rgbStr(shade(skin, 0.5)); ctx.fillRect(x, y + 3, 8, 1); ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 4, 2, 1); ctx.fillRect(x + 5, y + 4, 2, 1); ctx.fillStyle = '#2a8a2a'; ctx.fillRect(x + 2, y + 4, 1, 1); ctx.fillRect(x + 5, y + 4, 1, 1); }
  paint(ctx, ...hr.top, trim, rng, 0.1);
  paintBox(ctx, 24, 0, 2, 4, 2, shade(skin, 0.95), rng, 0.04);
  const br = paintBox(ctx, 16, 16, 8, 12, 4, robe, rng, 0.08);
  { const [x, y] = br.front; paint(ctx, x + 2, y + 2, 4, 10, apron, rng, 0.08); ctx.fillStyle = rgbStr(trim); ctx.fillRect(x, y + 11, 8, 1); }
  const ar = paintBox(ctx, 40, 16, 4, 12, 4, robe, rng, 0.08);
  for (const k of ['front', 'left', 'right', 'back', 'bottom']) { const [x, y, w, h] = ar[k]; paint(ctx, x, y + (k === 'bottom' ? 0 : h - 3), w, k === 'bottom' ? h : 3, skin, rng, 0.05); }
  const lr = paintBox(ctx, 0, 16, 4, 12, 4, robe, rng, 0.08);
  for (const k of ['front', 'left', 'right', 'back']) { const [x, y, w] = lr[k]; paint(ctx, x, y + 10, w, 2, [60, 45, 35], rng, 0.05); }
  return c;
}

function paintEnderman() {
  const rng = mulberry32(4242);
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  const black = [24, 22, 30];
  const hr = paintBox(ctx, 0, 0, 8, 8, 8, black, rng, 0.15);
  { const [x, y] = hr.front; ctx.fillStyle = '#e070ff'; ctx.fillRect(x, y + 4, 3, 1); ctx.fillRect(x + 5, y + 4, 3, 1); ctx.fillStyle = '#c040e0'; ctx.fillRect(x + 1, y + 4, 1, 1); ctx.fillRect(x + 6, y + 4, 1, 1); }
  paintBox(ctx, 16, 16, 8, 12, 4, black, rng, 0.15);
  paintBox(ctx, 56, 0, 2, 28, 2, black, rng, 0.15);
  paintBox(ctx, 48, 0, 2, 28, 2, black, rng, 0.15);
  return c;
}

export const PAINTERS = {
  enderman: paintEnderman,
  zombie: paintZombie, skeleton: paintSkeleton, creeper: paintCreeper, pig: paintPig, cow: paintCow,
  sheep: paintSheep, chicken: paintChicken, spider: paintSpider, wings: paintWings,
};

// ---------- rig definitions ----------
// part: [name, parent, pivot(px), boxOrigin(rel px), size, uv, opts]
const HUMANOID = (armW = 4, tex = [64, 32]) => ({
  tex,
  parts: [
    ['body', null, [0, 12, 0], [-4, 0, -2], [8, 12, 4], [16, 16]],
    ['head', 'body', [0, 12, 0], [-4, 0, -4], [8, 8, 8], [0, 0]],
    ['rightArm', 'body', [armW === 4 ? 6 : 5, 10, 0], [-armW / 2, -10, -armW / 2], [armW, 12, armW], [40, 16]],
    ['leftArm', 'body', [armW === 4 ? -6 : -5, 10, 0], [-armW / 2, -10, -armW / 2], [armW, 12, armW], [40, 16], { mirror: true }],
    ['rightLeg', null, [2, 12, 0], [-armW / 2, -12, -armW / 2], [armW, 12, armW], [0, 16]],
    ['leftLeg', null, [-2, 12, 0], [-armW / 2, -12, -armW / 2], [armW, 12, armW], [0, 16], { mirror: true }],
  ],
});

export const RIGS = {
  player: HUMANOID(4),
  zombie: HUMANOID(4),
  enderman: {
    tex: [64, 32],
    parts: [
      ['body', null, [0, 28, 0], [-4, 0, -2], [8, 12, 4], [16, 16]],
      ['head', 'body', [0, 12, 0], [-4, 0, -4], [8, 8, 8], [0, 0]],
      ['rightArm', 'body', [5, 11, 0], [-1, -27, -1], [2, 28, 2], [56, 0]],
      ['leftArm', 'body', [-5, 11, 0], [-1, -27, -1], [2, 28, 2], [56, 0], { mirror: true }],
      ['rightLeg', null, [2, 28, 0], [-1, -28, -1], [2, 28, 2], [48, 0]],
      ['leftLeg', null, [-2, 28, 0], [-1, -28, -1], [2, 28, 2], [48, 0], { mirror: true }],
    ],
  },
  villager: { tex: [64, 32], parts: [...HUMANOID(4).parts, ['nose', 'head', [0, 2, -4], [-1, -1, -2], [2, 4, 2], [24, 0]]] },
  skeleton: HUMANOID(2),
  creeper: {
    tex: [64, 32],
    parts: [
      ['body', null, [0, 6, 0], [-4, 0, -2], [8, 12, 4], [16, 16]],
      ['head', 'body', [0, 12, 0], [-4, 0, -4], [8, 8, 8], [0, 0]],
      ['leg0', null, [-2, 6, -4], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg1', null, [2, 6, -4], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg2', null, [-2, 6, 4], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg3', null, [2, 6, 4], [-2, -6, -2], [4, 6, 4], [0, 16]],
    ],
  },
  pig: {
    tex: [64, 64],
    parts: [
      ['body', null, [0, 6, 0], [-5, 0, -8], [10, 8, 16], [0, 32]],
      ['head', 'body', [0, 5, -8], [-4, -3, -8], [8, 8, 8], [0, 0]],
      ['snout', 'head', [0, 0, -8], [-2, -2, -1], [4, 3, 1], [32, 0]],
      ['leg0', null, [-3, 6, -5], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg1', null, [3, 6, -5], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg2', null, [-3, 6, 5], [-2, -6, -2], [4, 6, 4], [0, 16]],
      ['leg3', null, [3, 6, 5], [-2, -6, -2], [4, 6, 4], [0, 16]],
    ],
  },
  cow: {
    tex: [64, 64],
    parts: [
      ['body', null, [0, 12, 0], [-6, 0, -9], [12, 10, 18], [0, 32]],
      ['head', 'body', [0, 7, -9], [-4, -3, -6], [8, 8, 6], [0, 0]],
      ['horn0', 'head', [0, 0, 0], [-5, 3, -4], [1, 3, 1], [28, 0]],
      ['horn1', 'head', [0, 0, 0], [4, 3, -4], [1, 3, 1], [28, 0]],
      ['leg0', null, [-4, 12, -6], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg1', null, [4, 12, -6], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg2', null, [-4, 12, 7], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg3', null, [4, 12, 7], [-2, -12, -2], [4, 12, 4], [0, 16]],
    ],
  },
  sheep: {
    tex: [64, 64],
    parts: [
      ['body', null, [0, 12, 0], [-4, 0, -8], [8, 7, 16], [0, 32]],
      ['wool', 'body', [0, 0, 0], [-5, -1, -9], [10, 9, 18], [0, 0], { wool: true }],
      ['head', 'body', [0, 6, -8], [-3, -2, -7], [6, 6, 8], [0, 0]],
      ['headWool', 'head', [0, 0, 0], [-4, -1, -6], [8, 7, 6], [0, 32], { wool: true }],
      ['leg0', null, [-3, 12, -5], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg1', null, [3, 12, -5], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg2', null, [-3, 12, 6], [-2, -12, -2], [4, 12, 4], [0, 16]],
      ['leg3', null, [3, 12, 6], [-2, -12, -2], [4, 12, 4], [0, 16]],
    ],
  },
  chicken: {
    tex: [64, 64],
    parts: [
      ['body', null, [0, 5, 0], [-3, 0, -4], [6, 6, 8], [0, 32]],
      ['head', 'body', [0, 5, -3], [-2, 0, -3], [4, 6, 3], [0, 0]],
      ['beak', 'head', [0, 0, 0], [-2, 2, -5], [4, 2, 2], [16, 0]],
      ['wattle', 'head', [0, 0, 0], [-1, 0, -4], [2, 2, 2], [16, 8]],
      ['wing0', 'body', [-3, 5, 0], [-1, -4, -3], [1, 4, 6], [32, 0]],
      ['wing1', 'body', [3, 5, 0], [0, -4, -3], [1, 4, 6], [32, 0]],
      ['leg0', null, [-1, 5, 1], [-0.5, -5, -0.5], [1, 5, 1], [32, 16]],
      ['leg1', null, [1, 5, 1], [-0.5, -5, -0.5], [1, 5, 1], [32, 16]],
    ],
  },
  spider: {
    tex: [64, 64],
    parts: [
      ['neck', null, [0, 9, 0], [-3, -3, -3], [6, 6, 6], [0, 0]],
      ['head', 'neck', [0, 0, -3], [-4, -4, -8], [8, 8, 8], [24, 0]],
      ['abdomen', 'neck', [0, 0, 3], [-5, -4, 0], [10, 8, 12], [0, 32]],
      ...[0, 1, 2, 3].flatMap((i) => [
        ['legR' + i, 'neck', [3, 0, -1 + i], [0, -1, -1], [16, 2, 2], [0, 16]],
        ['legL' + i, 'neck', [-3, 0, -1 + i], [-16, -1, -1], [16, 2, 2], [0, 16], { mirror: true }],
      ]),
    ],
  },
};

// Build a THREE.Group rig: returns { root, parts: {name: Object3D}, materials: [] }
export function buildRig(type, texture, extra = {}) {
  const rig = RIGS[type];
  const [tw, th] = rig.tex;
  const root = new THREE.Group();
  const parts = {};
  const materials = [];
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: false, alphaTest: 0.1 });
  materials.push(mat);
  let woolMat = null;
  if (extra.woolTexture) { woolMat = new THREE.MeshBasicMaterial({ map: extra.woolTexture, alphaTest: 0.1 }); materials.push(woolMat); }
  const scale = new THREE.Group();
  scale.scale.setScalar(1);
  root.add(scale);
  for (const [name, parent, pivot, origin, size, uv, opts = {}] of rig.parts) {
    const pivotObj = new THREE.Group();
    pivotObj.position.set(pivot[0] / 16, pivot[1] / 16, pivot[2] / 16);
    const geo = boxGeometry(origin[0], origin[1], origin[2], size[0], size[1], size[2], uv[0], uv[1], opts.wool ? 64 : tw, opts.wool ? 64 : th, opts.wool ? 0.5 : 0, opts.mirror);
    const mesh = new THREE.Mesh(geo, opts.wool ? woolMat : mat);
    pivotObj.add(mesh);
    pivotObj.userData.base = pivotObj.position.clone();
    parts[name] = pivotObj;
    (parent ? parts[parent] : scale).add(pivotObj);
  }
  return { root, scale, parts, materials, type };
}

// Armor overlay pieces for humanoid rigs.
export function buildArmorLayer(rigParts, material) {
  const tex = skinTexture('armor:' + material, () => paintArmor(material));
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1 });
  const make = (part, origin, size, uv, inflate, mirror = false) => {
    const m = new THREE.Mesh(boxGeometry(origin[0], origin[1], origin[2], size[0], size[1], size[2], uv[0], uv[1], 64, 32, inflate, mirror), mat);
    rigParts[part].add(m);
    return m;
  };
  return {
    material: mat,
    helmet: [make('head', [-4, 0, -4], [8, 8, 8], [0, 0], 1)],
    chestplate: [make('body', [-4, 0, -2], [8, 12, 4], [16, 16], 1.01), make('rightArm', [-2, -10, -2], [4, 12, 4], [40, 16], 1), make('leftArm', [-2, -10, -2], [4, 12, 4], [40, 16], 1, true)],
    leggings: [make('rightLeg', [-2, -12, -2], [4, 12, 4], [0, 16], 0.5), make('leftLeg', [-2, -12, -2], [4, 12, 4], [0, 16], 0.5, true)],
    boots: [make('rightLeg', [-2, -12, -2], [4, 4, 4], [0, 16], 1.05), make('leftLeg', [-2, -12, -2], [4, 4, 4], [0, 16], 1.05, true)],
  };
}

// Glider wings: two thin panels on the back; returns { group, left, right }.
export function buildWings() {
  const tex = skinTexture('wings', paintWings);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const mk = (sign) => {
    const pivot = new THREE.Group();
    pivot.position.set(sign * 1 / 16, 11 / 16, 2.2 / 16);
    const m = new THREE.Mesh(boxGeometry(sign > 0 ? 0 : -10, -18, 0, 10, 20, 1, 0, 0, 32, 32), mat);
    pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  return { group, left: mk(-1), right: mk(1), material: mat };
}

// ---------- extruded item meshes ----------
const itemMeshCache = new Map();
export function extrudedItemGeometry(key, iconCanvas) {
  let g = itemMeshCache.get(key);
  if (g) return g;
  const w = iconCanvas.width, h = iconCanvas.height;
  const data = iconCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const pos = [], col = [], idx = [];
  const sx = 1 / w, sy = 1 / h, t = 1 / 16;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 20;
  const quad = (a, b, c, d, r, gg, bb, k) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) col.push(r * k, gg * k, bb * k);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!opaque(x, y)) continue;
    const i = (y * w + x) * 4;
    const r = data[i] / 255, gg = data[i + 1] / 255, bb = data[i + 2] / 255;
    const x0 = x * sx - 0.5, x1 = (x + 1) * sx - 0.5, y0 = 0.5 - (y + 1) * sy, y1 = 0.5 - y * sy, z0 = -t / 2, z1 = t / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], r, gg, bb, 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], r, gg, bb, 0.8);
    if (!opaque(x, y - 1)) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], r, gg, bb, 0.95);
    if (!opaque(x, y + 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], r, gg, bb, 0.6);
    if (!opaque(x - 1, y)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], r, gg, bb, 0.75);
    if (!opaque(x + 1, y)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], r, gg, bb, 0.75);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  itemMeshCache.set(key, g);
  return g;
}
