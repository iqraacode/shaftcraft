// Item icons for the inventory/HUD: blocks as isometric cubes, everything else as flat sprites.
import { ITEMS } from '../../../shared/items.js';
import { BLOCKS, ID, faceTex } from '../../../shared/blocks.js';
import { BIOME_COLORS, SPRUCE_COLOR } from '../../../shared/worldgen.js';
import { tileToCanvas } from './texgen.js';
import { drawItemSprite } from './itemsprites.js';

const cache = new Map();
const urlCache = new Map();

function rgb(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
export function blockTint(b) {
  if (!b || !b.tint) return null;
  if (b.tint === 'grass') return rgb(BIOME_COLORS[0][0]);
  if (b.tint === 'foliage') return rgb(BIOME_COLORS[0][1]);
  if (b.tint === 'spruce') return rgb(SPRUCE_COLOR);
  if (b.tint === 'water') return rgb(BIOME_COLORS[0][2]);
  return null;
}

function shade(ctx, w, h, alpha) {
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

function faceCanvas(name, tint, cropTop = 0, darken = 0) {
  const src = tileToCanvas(name, tint);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, cropTop, 16, 16 - cropTop, 0, cropTop, 16, 16 - cropTop);
  if (darken) shade(ctx, 16, 16, darken);
  return c;
}

function isoBlock(b) {
  const S = 64; // drawn at 64px for smooth affine transforms, displayed scaled
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const meta = b.facing ? 2 : 0;
  let h = 1;
  if (b.shape === 'snow') h = 2 / 16;
  else if (b.shape === 'farmland') h = 15 / 16;
  else if (b.shape === 'chest') h = 14 / 16;
  const tint = blockTint(b);
  const topTint = b.id === ID.grass ? tint : (b.id === ID.water ? null : tint);
  const sideTint = (b.id === ID.grass ? tint : tint);
  const top = faceCanvas(faceTex(b, 2, meta), topTint);
  const left = faceCanvas(faceTex(b, 4, meta), sideTint, Math.round((1 - h) * 16), 0.2);
  const right = faceCanvas(faceTex(b, 0, meta), sideTint, Math.round((1 - h) * 16), 0.42);
  const k = S / 32;
  const drop = (1 - h) * 15.5 * k;
  // top face
  ctx.setTransform((15 / 16) * k, (7.5 / 16) * k, (-15 / 16) * k, (7.5 / 16) * k, 16 * k, 1 * k + drop);
  ctx.drawImage(top, 0, 0);
  // left face (south)
  ctx.setTransform((15 / 16) * k, (7.5 / 16) * k, 0, (15.5 / 16) * k, 1 * k, 8.5 * k);
  ctx.drawImage(left, 0, 0);
  // right face (east)
  ctx.setTransform((15 / 16) * k, (-7.5 / 16) * k, 0, (15.5 / 16) * k, 16 * k, 16 * k);
  ctx.drawImage(right, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

export function getIcon(id) {
  let c = cache.get(id);
  if (c) return c;
  const it = ITEMS[id];
  if (!it) {
    c = document.createElement('canvas'); c.width = c.height = 16;
  } else if (it.kind === 'block' && !it.flat) {
    c = isoBlock(BLOCKS[ID[it.block]]);
  } else {
    c = drawItemSprite(id, it);
    if (!c) {
      const b = it.block ? BLOCKS[ID[it.block]] : null;
      const texName = b ? faceTex(b, 4, 0) : 'stone';
      c = tileToCanvas(texName, blockTint(b));
    }
  }
  cache.set(id, c);
  return c;
}

export function getIconURL(id) {
  let u = urlCache.get(id);
  if (!u) { u = getIcon(id).toDataURL(); urlCache.set(id, u); }
  return u;
}

// Whether the icon is a flat sprite (affects first-person/drop rendering).
export function isFlatItem(id) {
  const it = ITEMS[id];
  return !it || it.kind !== 'block' || !!it.flat;
}
