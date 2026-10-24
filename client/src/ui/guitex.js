// Procedurally drawn GUI textures: menu background, buttons, HUD icons and the title logo.
import { mulberry32 } from '../../../shared/noise.js';
import { TILES } from '../textures/texgen.js';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function px(ctx, x, y, col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }

export const GUI = {};

function fromTile(name, k) {
  const c = cv(16, 16);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  const src = TILES[name].data;
  for (let i = 0; i < src.length; i += 4) { img.data[i] = src[i] * k; img.data[i + 1] = src[i + 1] * k; img.data[i + 2] = src[i + 2] * k; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

function iconFromMask(mask, colorFn) {
  const c = cv(9, 9);
  const ctx = c.getContext('2d');
  const on = (x, y) => y >= 0 && y < 9 && x >= 0 && x < 9 && mask[y][x] === '#';
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    if (!on(x, y)) continue;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    const col = colorFn(x, y, edge);
    if (col) px(ctx, x, y, col);
  }
  return c;
}

const HEART = [
  '.###.###.',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
  '.........',
];
const FOOD = [
  '.....##..',
  '....####.',
  '...######',
  '...######',
  '..######.',
  '.###.##..',
  '###......',
  '.##......',
  '.........',
];
const ARMOR = [
  '.##...##.',
  '####.####',
  '#########',
  '.#######.',
  '.#######.',
  '.#######.',
  '.#######.',
  '.#######.',
  '.........',
];
const BUBBLE = [
  '..#####..',
  '.#.....#.',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '.#.....#.',
  '..#####..',
];

export function buildGuiTextures() {
  GUI.dirt = fromTile('dirt', 0.25).toDataURL();
  GUI.stone = fromTile('stone', 0.62).toDataURL();
  GUI.stoneHover = fromTile('stone', 0.75).toDataURL();
  GUI.planks = fromTile('planks', 0.5).toDataURL();
  const heart = (fill, half, hardcore, flash) => iconFromMask(HEART, (x, y, edge) => {
    if (edge) return flash ? '#ffffff' : '#1a0000';
    const filled = fill && (!half || x <= 4);
    if (!filled) return '#3a0a0a';
    if (hardcore && (x === 3 || x === 5) && y === 2) return '#fff0a0';
    if (x <= 2 && y <= 2) return '#ff9a9a';
    return y >= 4 ? '#c00000' : '#f01c1c';
  });
  GUI.heartEmpty = heart(false, false, false, false);
  GUI.heartEmptyFlash = heart(false, false, false, true);
  GUI.heartFull = heart(true, false, false, false);
  GUI.heartHalf = heart(true, true, false, false);
  GUI.heartHcFull = heart(true, false, true, false);
  GUI.heartHcHalf = heart(true, true, true, false);
  const food = (fill, half) => iconFromMask(FOOD, (x, y, edge) => {
    if (edge) return '#1e1206';
    const bone = y >= 5 && x <= 3;
    if (!fill || (half && x < 4)) return '#3a2a18';
    if (bone) return '#efe6d2';
    return (x + y) % 3 === 0 ? '#d88a48' : '#b8642a';
  });
  GUI.foodEmpty = food(false, false); GUI.foodFull = food(true, false); GUI.foodHalf = food(true, true);
  const armor = (fill, half) => iconFromMask(ARMOR, (x, y, edge) => {
    if (edge) return '#262626';
    if (!fill || (half && x > 4)) return '#3d3d3d';
    return x <= 2 && y <= 3 ? '#ffffff' : '#c8c8c8';
  });
  GUI.armorEmpty = armor(false, false); GUI.armorFull = armor(true, false); GUI.armorHalf = armor(true, true);
  const FULL = new Array(9).fill('#########');
  GUI.bubble = iconFromMask(FULL, (x, y) => {
    const d = Math.hypot(x - 4, y - 4);
    if (d > 4.3) return null;
    if (d > 3.3) return '#2a5ab0';
    if (x === 2 && y === 2) return '#ffffff';
    return '#8fcaff';
  });
  GUI.bubblePop = iconFromMask(BUBBLE, (x, y) => (Math.hypot(x - 4, y - 4) > 2.5 ? '#6fa8ff' : null));
  void FULL;
  GUI.hotbar = drawHotbar();
  GUI.hotbarSel = drawHotbarSel();
  GUI.logo = drawLogo();
  return GUI;
}

function drawHotbar() {
  const c = cv(182, 22);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 182, 22);
  ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, 182, 1); ctx.fillRect(0, 21, 182, 1); ctx.fillRect(0, 0, 1, 22); ctx.fillRect(181, 0, 1, 22);
  for (let i = 0; i < 9; i++) {
    const x = 1 + i * 20;
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(x, 1, 20, 1); ctx.fillRect(x, 1, 1, 20);
    ctx.fillStyle = '#373737'; ctx.fillRect(x + 19, 1, 1, 20); ctx.fillRect(x, 20, 20, 1);
    ctx.fillStyle = 'rgba(139,139,139,0.35)'; ctx.fillRect(x + 1, 2, 18, 18);
  }
  return c;
}

function drawHotbarSel() {
  const c = cv(24, 24);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 24, 24);
  ctx.clearRect(2, 2, 20, 20);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(1, 1, 22, 1); ctx.fillRect(1, 22, 22, 1); ctx.fillRect(1, 1, 1, 22); ctx.fillRect(22, 1, 1, 22);
  ctx.fillStyle = '#a8a8a8'; ctx.fillRect(2, 2, 20, 1); ctx.fillRect(2, 2, 1, 20);
  ctx.clearRect(3, 3, 18, 18);
  return c;
}

const LETTERS = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
};

function drawLogo() {
  const text = 'SHAFTCRAFT';
  const P = 8, gap = 1, depth = 3;
  const w = text.length * (5 + gap) * P + depth * 2 + 8, h = 7 * P + depth * 2 + 8;
  const c = cv(w, h);
  const ctx = c.getContext('2d');
  const rng = mulberry32(7);
  const cells = [];
  [...text].forEach((ch, li) => {
    const g = LETTERS[ch];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (g[y][x] === '#') cells.push([4 + (li * (5 + gap) + x) * P, 4 + y * P]);
  });
  // extrusion (dark) first
  for (const [x, y] of cells) {
    for (let d = depth; d > 0; d--) { ctx.fillStyle = d === depth ? '#141414' : '#2c2c2c'; ctx.fillRect(x + d, y + d, P, P); }
  }
  // faces with stone texture
  for (const [x, y] of cells) {
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const v = 150 + (rng() - 0.5) * 50;
      const edgeHi = i === 0 || j === 0;
      const edgeLo = i === P - 1 || j === P - 1;
      const k = edgeHi ? 1.25 : edgeLo ? 0.7 : 1;
      ctx.fillStyle = `rgb(${v * k | 0},${v * k | 0},${v * k * 1.02 | 0})`;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
  return c;
}
