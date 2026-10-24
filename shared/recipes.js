// Recipe matcher for crafting grids and furnaces. All recipe data lives in recipes.json.
import data from './recipes.json' with { type: 'json' };
import { FUEL_TICKS } from './constants.js';
import { ITEMS } from './items.js';

export const RECIPE_DATA = data;
const TAGS = data.tags;

function ingredientMatches(ing, id) {
  if (!ing) return !id;
  if (!id) return false;
  if (ing[0] === '#') return (TAGS[ing.slice(1)] || []).includes(id);
  return ing === id;
}

// Pre-process shaped recipes into normalized grids.
const SHAPED = data.shaped.map((r) => {
  const h = r.pattern.length;
  const w = Math.max(...r.pattern.map((row) => row.length));
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = r.pattern[y][x] || ' ';
    cells.push(ch === ' ' ? null : r.key[ch]);
  }
  return { w, h, cells, result: r.result };
});
const SHAPELESS = data.shapeless;

for (const r of [...data.shaped, ...data.shapeless, ...data.smelting]) {
  const res = Array.isArray(r.result) ? r.result[0] : r.result;
  if (!ITEMS[res]) throw new Error('Recipe result is not a registered item: ' + res);
}

// grid: array of stacks (or null) of size gw*gh. Returns { id, count } or null.
export function matchCrafting(grid, gw, gh) {
  let minX = gw, minY = gh, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (grid[y * gw + x]) { n++; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  }
  if (!n) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const at = (x, y) => { const s = grid[(y + minY) * gw + x + minX]; return s ? s.id : null; };
  for (const r of SHAPED) {
    if (r.w !== w || r.h !== h) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
        const ing = r.cells[y * w + (mirror ? w - 1 - x : x)];
        if (!ingredientMatches(ing, at(x, y))) ok = false;
      }
      if (ok) return { id: r.result[0], count: r.result[1] };
    }
  }
  const ids = grid.filter(Boolean).map((s) => s.id);
  for (const r of SHAPELESS) {
    if (r.ingredients.length !== ids.length) continue;
    const left = ids.slice();
    let ok = true;
    for (const ing of r.ingredients) {
      const i = left.findIndex((id) => ingredientMatches(ing, id));
      if (i < 0) { ok = false; break; }
      left.splice(i, 1);
    }
    if (ok) return { id: r.result[0], count: r.result[1] };
  }
  return null;
}

export function smeltResult(id) {
  if (!id) return null;
  for (const r of data.smelting) if (ingredientMatches(r.input, id)) return r.result;
  return null;
}

export function fuelTicks(id) {
  return (id && FUEL_TICKS[id]) || 0;
}

// List of recipes producing a given item (used by the recipe tooltip/book in UI).
export function recipesFor(id) {
  const out = [];
  for (const r of data.shaped) if (r.result[0] === id) out.push({ type: 'shaped', ...r });
  for (const r of data.shapeless) if (r.result[0] === id) out.push({ type: 'shapeless', ...r });
  for (const r of data.smelting) if (r.result === id) out.push({ type: 'smelting', ...r });
  return out;
}
export function tagItems(tag) { return TAGS[tag] || []; }
