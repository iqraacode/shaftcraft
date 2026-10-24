// Shared inventory / container window logic. The server is authoritative; the client runs the
// same code to predict results so the UI feels instant, then accepts the server's state.
import { ITEMS, maxStackOf, sameItem, cloneStack } from './items.js';
import { matchCrafting, smeltResult, fuelTicks } from './recipes.js';

export const HOTBAR = 9;
export const MAIN_SIZE = 36;
export const CHEST_SIZE = 27;

export function newPlayerInventory() {
  return {
    main: new Array(MAIN_SIZE).fill(null),
    armor: new Array(4).fill(null),
    offhand: [null],
    craft: new Array(4).fill(null),
    craftResult: [null],
    selected: 0,
  };
}

// ---- Window layout ----
// Each slot: { arr, i, role, armor? }
function mainSlots(inv) {
  const s = [];
  for (let i = 9; i < 36; i++) s.push({ arr: inv.main, i, role: 'main' });
  for (let i = 0; i < 9; i++) s.push({ arr: inv.main, i, role: 'hotbar' });
  return s;
}

export function buildWindow(type, inv, container) {
  const slots = [];
  const win = { type, slots, craftGrid: null, craftW: 0, craftResult: null };
  if (type === 'player') {
    slots.push({ arr: inv.craftResult, i: 0, role: 'result' });
    for (let i = 0; i < 4; i++) slots.push({ arr: inv.craft, i, role: 'grid' });
    for (let i = 0; i < 4; i++) slots.push({ arr: inv.armor, i, role: 'armor', armor: i });
    slots.push(...mainSlots(inv));
    slots.push({ arr: inv.offhand, i: 0, role: 'offhand' });
    win.craftGrid = inv.craft; win.craftW = 2; win.craftResult = inv.craftResult;
  } else if (type === 'crafting') {
    slots.push({ arr: container.result, i: 0, role: 'result' });
    for (let i = 0; i < 9; i++) slots.push({ arr: container.grid, i, role: 'grid' });
    slots.push(...mainSlots(inv));
    win.craftGrid = container.grid; win.craftW = 3; win.craftResult = container.result;
  } else if (type === 'chest') {
    for (let i = 0; i < CHEST_SIZE; i++) slots.push({ arr: container.items, i, role: 'container' });
    slots.push(...mainSlots(inv));
  } else if (type === 'furnace') {
    slots.push({ arr: container.items, i: 0, role: 'input' });
    slots.push({ arr: container.items, i: 1, role: 'fuel' });
    slots.push({ arr: container.items, i: 2, role: 'output' });
    slots.push(...mainSlots(inv));
  }
  win.inv = inv;
  updateCraft(win);
  return win;
}

export function updateCraft(win) {
  if (!win.craftGrid) return;
  const r = matchCrafting(win.craftGrid, win.craftW, win.craftW);
  win.craftResult[0] = r ? { id: r.id, count: r.count } : null;
}

export function slotAccepts(slot, stack) {
  if (!stack) return true;
  switch (slot.role) {
    case 'result': case 'output': return false;
    case 'armor': {
      const it = ITEMS[stack.id];
      return !!(it && it.armor && it.armor.slot === slot.armor);
    }
    case 'fuel': return fuelTicks(stack.id) > 0;
    default: return true;
  }
}

function slotMax(slot, stack) {
  if (slot.role === 'armor') return 1;
  return maxStackOf(stack.id);
}

const get = (s) => s.arr[s.i];
const put = (s, v) => { s.arr[s.i] = v && v.count > 0 ? v : null; };

// Try to insert a stack into a list of slots (merging first, then empties). Returns remainder.
export function insertInto(slots, stack, reverse = false) {
  if (!stack) return null;
  let st = cloneStack(stack);
  const order = reverse ? [...slots].reverse() : slots;
  for (const s of order) {
    const cur = get(s);
    if (cur && sameItem(cur, st) && slotAccepts(s, st)) {
      const room = slotMax(s, cur) - cur.count;
      if (room > 0) { const n = Math.min(room, st.count); cur.count += n; st.count -= n; if (!st.count) return null; }
    }
  }
  for (const s of order) {
    if (!get(s) && slotAccepts(s, st)) {
      const n = Math.min(slotMax(s, st), st.count);
      put(s, { ...st, count: n });
      st.count -= n;
      if (!st.count) return null;
    }
  }
  return st;
}

// Add a stack to a player's inventory (hotbar first). Returns remainder or null.
export function addToInventory(inv, stack) {
  const slots = [];
  for (let i = 0; i < 36; i++) slots.push({ arr: inv.main, i, role: 'main' });
  // merge pass across whole inventory first, then empties in hotbar then storage
  let st = cloneStack(stack);
  for (const s of slots) {
    const cur = get(s);
    if (cur && sameItem(cur, st)) {
      const room = maxStackOf(cur.id) - cur.count;
      if (room > 0) { const n = Math.min(room, st.count); cur.count += n; st.count -= n; if (!st.count) return null; }
    }
  }
  for (const s of slots) {
    if (!get(s)) {
      const n = Math.min(maxStackOf(st.id), st.count);
      put(s, { ...st, count: n }); st.count -= n;
      if (!st.count) return null;
    }
  }
  return st;
}

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv.main) if (s && s.id === id) n += s.count;
  return n;
}

export function removeItem(inv, id, count) {
  for (let i = 0; i < inv.main.length && count > 0; i++) {
    const s = inv.main[i];
    if (s && s.id === id) {
      const n = Math.min(count, s.count);
      s.count -= n; count -= n;
      if (!s.count) inv.main[i] = null;
    }
  }
  return count === 0;
}

function consumeCraft(win) {
  for (let i = 0; i < win.craftGrid.length; i++) {
    const s = win.craftGrid[i];
    if (s) { s.count--; if (!s.count) win.craftGrid[i] = null; }
  }
}

function quickMoveTargets(win, slot) {
  const idx = win.slots.indexOf(slot);
  const S = win.slots;
  const main = S.filter((s) => s.role === 'main');
  const hot = S.filter((s) => s.role === 'hotbar');
  const inv = [...hot, ...main];
  if (win.type === 'player') {
    const it = ITEMS[get(slot).id];
    if (slot.role === 'main') {
      if (it && it.armor) { const a = S.find((s) => s.role === 'armor' && s.armor === it.armor.slot && !get(s)); if (a) return [a]; }
      return hot;
    }
    if (slot.role === 'hotbar') {
      if (it && it.armor) { const a = S.find((s) => s.role === 'armor' && s.armor === it.armor.slot && !get(s)); if (a) return [a]; }
      return main;
    }
    return [...main, ...hot];
  }
  if (slot.role === 'main' || slot.role === 'hotbar') {
    if (win.type === 'chest') return S.filter((s) => s.role === 'container');
    if (win.type === 'furnace') {
      const st = get(slot);
      const out = [];
      if (smeltResult(st.id)) out.push(S.find((s) => s.role === 'input'));
      if (fuelTicks(st.id) > 0) out.push(S.find((s) => s.role === 'fuel'));
      if (out.length) return out;
    }
    return slot.role === 'main' ? hot : main;
  }
  void idx; void inv;
  return [...main, ...hot];
}

/**
 * Apply a UI action to a window. state: { cursor, creative }. Returns { drops: [stacks], changed }.
 * Actions:
 *  { a:'click', slot, button:0|1, shift }
 *  { a:'drag', slots:[...], button }
 *  { a:'dbl', slot }
 *  { a:'swap', slot, hotbar: 0..8 | 'offhand' }
 *  { a:'drop', slot, all }
 *  { a:'outside', button }
 */
export function applyAction(win, state, act) {
  const res = { drops: [], changed: true };
  const S = win.slots;
  const slot = typeof act.slot === 'number' ? S[act.slot] : null;
  if (typeof act.slot === 'number' && !slot) { res.changed = false; return res; }
  switch (act.a) {
    case 'click': {
      if (act.shift) {
        const st = get(slot);
        if (!st) break;
        if (slot.role === 'result') {
          // craft as many as possible
          let guard = 0;
          while (win.craftResult[0] && guard++ < 64) {
            const r = cloneStack(win.craftResult[0]);
            const targets = [...S.filter((s) => s.role === 'hotbar').reverse(), ...S.filter((s) => s.role === 'main').reverse()];
            // check fit
            const testInv = targets.map((s) => cloneStack(get(s)));
            const sim = targets.map((s, k) => ({ arr: testInv, i: k, role: s.role }));
            if (insertInto(sim, r)) break;
            insertInto(targets, r);
            consumeCraft(win);
            updateCraft(win);
            res.crafted = (res.crafted || 0) + 1;
            res.craftedId = r.id;
          }
          break;
        }
        const targets = quickMoveTargets(win, slot);
        const rest = insertInto(targets, st, slot.role === 'container' || slot.role === 'output');
        put(slot, rest);
        if (slot.role === 'output' && !rest) res.tookOutput = st;
        break;
      }
      const cur = get(slot);
      const cursor = state.cursor;
      if (slot.role === 'result') {
        if (!cur) break;
        if (!cursor) { state.cursor = cloneStack(cur); }
        else if (sameItem(cursor, cur) && cursor.count + cur.count <= maxStackOf(cur.id)) cursor.count += cur.count;
        else break;
        consumeCraft(win);
        updateCraft(win);
        res.crafted = 1; res.craftedId = cur.id;
        break;
      }
      if (act.button === 0) {
        if (!cursor) { state.cursor = cur; put(slot, null); if (slot.role === 'output') res.tookOutput = cur; }
        else if (!cur) { if (slotAccepts(slot, cursor)) { const n = Math.min(slotMax(slot, cursor), cursor.count); put(slot, { ...cursor, count: n }); cursor.count -= n; if (!cursor.count) state.cursor = null; } }
        else if (sameItem(cur, cursor)) {
          if (slot.role === 'output') { if (cursor.count + cur.count <= maxStackOf(cur.id)) { cursor.count += cur.count; put(slot, null); res.tookOutput = cur; } }
          else { const room = slotMax(slot, cur) - cur.count; const n = Math.min(room, cursor.count); cur.count += n; cursor.count -= n; if (!cursor.count) state.cursor = null; }
        } else if (slotAccepts(slot, cursor) && cursor.count <= slotMax(slot, cursor)) { put(slot, cursor); state.cursor = cur; }
      } else {
        if (!cursor) {
          if (!cur) break;
          const half = Math.ceil(cur.count / 2);
          state.cursor = { ...cur, count: half };
          cur.count -= half; if (!cur.count) put(slot, null);
          if (slot.role === 'output') res.tookOutput = state.cursor;
        } else if (!cur) {
          if (slotAccepts(slot, cursor)) { put(slot, { ...cursor, count: 1 }); cursor.count--; if (!cursor.count) state.cursor = null; }
        } else if (sameItem(cur, cursor)) {
          if (slot.role === 'output') break;
          if (cur.count < slotMax(slot, cur)) { cur.count++; cursor.count--; if (!cursor.count) state.cursor = null; }
        } else if (slotAccepts(slot, cursor) && cursor.count <= slotMax(slot, cursor)) { put(slot, cursor); state.cursor = cur; }
      }
      break;
    }
    case 'drag': {
      const cursor = state.cursor;
      if (!cursor || !Array.isArray(act.slots)) break;
      const targets = [...new Set(act.slots)].map((i) => S[i]).filter((s) => s && slotAccepts(s, cursor) && s.role !== 'result' && s.role !== 'output' && (!get(s) || sameItem(get(s), cursor)));
      if (!targets.length) break;
      if (act.button === 0) {
        const per = Math.floor(cursor.count / targets.length);
        if (per < 1) break;
        for (const s of targets) {
          const cur = get(s);
          const room = slotMax(s, cursor) - (cur ? cur.count : 0);
          const n = Math.min(per, room);
          if (n <= 0) continue;
          if (cur) cur.count += n; else put(s, { ...cursor, count: n });
          cursor.count -= n;
        }
      } else {
        for (const s of targets) {
          if (!cursor.count) break;
          const cur = get(s);
          if (cur && cur.count >= slotMax(s, cursor)) continue;
          if (cur) cur.count++; else put(s, { ...cursor, count: 1 });
          cursor.count--;
        }
      }
      if (!cursor.count) state.cursor = null;
      break;
    }
    case 'dbl': {
      const cursor = state.cursor;
      if (!cursor) break;
      const max = maxStackOf(cursor.id);
      for (const pass of [0, 1]) {
        for (const s of S) {
          if (cursor.count >= max) break;
          if (s.role === 'result') continue;
          const cur = get(s);
          if (!cur || !sameItem(cur, cursor)) continue;
          if (pass === 0 && cur.count === maxStackOf(cur.id)) continue;
          const n = Math.min(max - cursor.count, cur.count);
          cursor.count += n; cur.count -= n;
          if (!cur.count) put(s, null);
        }
      }
      break;
    }
    case 'swap': {
      if (!slot || state.cursor) break;
      let other;
      if (act.hotbar === 'offhand') other = { arr: win.inv.offhand, i: 0, role: 'offhand' };
      else {
        const hb = Number(act.hotbar);
        if (!(hb >= 0 && hb < 9)) break;
        other = { arr: win.inv.main, i: hb, role: 'hotbar' };
      }
      if (other.arr === slot.arr && other.i === slot.i) break;
      const a = get(slot), b = get(other);
      if (slot.role === 'result') {
        if (!a || b) break;
        put(other, cloneStack(a)); consumeCraft(win); updateCraft(win); res.crafted = 1; res.craftedId = a.id;
        break;
      }
      if (!slotAccepts(slot, b)) break;
      put(slot, b); put(other, a);
      if (slot.role === 'output' && a) res.tookOutput = a;
      break;
    }
    case 'drop': {
      const cur = get(slot);
      if (!cur || state.cursor) break;
      if (slot.role === 'result') {
        res.drops.push(cloneStack(cur)); consumeCraft(win); updateCraft(win); res.crafted = 1; res.craftedId = cur.id; break;
      }
      const n = act.all ? cur.count : 1;
      res.drops.push({ ...cur, count: n });
      cur.count -= n; if (!cur.count) put(slot, null);
      break;
    }
    case 'outside': {
      const cursor = state.cursor;
      if (!cursor) break;
      const n = act.button === 1 ? 1 : cursor.count;
      res.drops.push({ ...cursor, count: n });
      cursor.count -= n; if (!cursor.count) state.cursor = null;
      break;
    }
    default:
      res.changed = false;
  }
  if (win.craftGrid) updateCraft(win);
  return res;
}

// Player armor points (sum) and damage reduction.
export function armorPoints(inv) {
  let p = 0;
  for (const s of inv.armor) if (s && ITEMS[s.id] && ITEMS[s.id].armor) p += ITEMS[s.id].armor.points;
  return p;
}

// Serialize stacks compactly for network/storage.
export function packStacks(arr) { return arr.map((s) => (s ? [s.id, s.count, s.dmg || 0] : 0)); }
export function unpackStacks(arr) {
  return (arr || []).map((s) => {
    if (!s || !ITEMS[s[0]]) return null;
    const o = { id: s[0], count: s[1] };
    if (s[2]) o.dmg = s[2];
    return o;
  });
}
export function packInventory(inv) {
  return { main: packStacks(inv.main), armor: packStacks(inv.armor), offhand: packStacks(inv.offhand), craft: packStacks(inv.craft), selected: inv.selected };
}
export function unpackInventoryInto(inv, data) {
  if (!data) return inv;
  const main = unpackStacks(data.main); for (let i = 0; i < 36; i++) inv.main[i] = main[i] || null;
  const armor = unpackStacks(data.armor); for (let i = 0; i < 4; i++) inv.armor[i] = armor[i] || null;
  const off = unpackStacks(data.offhand); inv.offhand[0] = off[0] || null;
  const craft = unpackStacks(data.craft); for (let i = 0; i < 4; i++) inv.craft[i] = craft[i] || null;
  inv.selected = data.selected | 0;
  return inv;
}
