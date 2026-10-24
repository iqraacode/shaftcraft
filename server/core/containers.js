// Block containers (chests, furnaces): server-owned item storage shared live between viewers.
import { ID } from '../../shared/blocks.js';
import { CHEST_SIZE, packStacks, unpackStacks } from '../../shared/inventory.js';
import { smeltResult, fuelTicks } from '../../shared/recipes.js';
import { maxStackOf } from '../../shared/items.js';
import { SMELT_TICKS } from '../../shared/constants.js';

export class Containers {
  constructor(server, data) {
    this.server = server;
    this.map = new Map();
    for (const [key, d] of Object.entries(data || {})) {
      const [x, y, z] = key.split(',').map(Number);
      this.map.set(key, {
        x, y, z,
        type: d.type,
        items: unpackStacks(d.items).concat(new Array(Math.max(0, (d.type === 'chest' ? CHEST_SIZE : 3) - (d.items || []).length)).fill(null)),
        burn: d.burn || 0, burnMax: d.burnMax || 0, cook: d.cook || 0,
        viewers: new Set(),
      });
    }
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  get(x, y, z, type) {
    const k = this.key(x, y, z);
    let c = this.map.get(k);
    if (!c || c.type !== type) {
      c = { type, items: new Array(type === 'chest' ? CHEST_SIZE : 3).fill(null), burn: 0, burnMax: 0, cook: 0, viewers: new Set() };
      this.map.set(k, c);
    }
    c.x = x; c.y = y; c.z = z;
    return c;
  }

  onBreak(x, y, z, drop) {
    const k = this.key(x, y, z);
    const c = this.map.get(k);
    if (!c) return;
    for (const p of c.viewers) p.closeWindow(true);
    if (drop) for (const s of c.items) if (s) this.server.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, s);
    this.map.delete(k);
  }

  notify(c, except) {
    for (const p of c.viewers) {
      if (p === except || !p.window) continue;
      p.send({ t: 'cont', wid: p.window.wid, items: packStacks(c.items), burn: c.burn, burnMax: c.burnMax, cook: c.cook, cookMax: SMELT_TICKS });
    }
  }

  tick() {
    const world = this.server.world;
    for (const c of this.map.values()) {
      if (c.type !== 'furnace') continue;
      if (!world.hasChunk(c.x >> 4, c.z >> 4)) continue;
      const [input, fuel, output] = c.items;
      const result = input ? smeltResult(input.id) : null;
      const canOut = result && (!output || (output.id === result && output.count < maxStackOf(result)));
      let changed = false;
      const wasBurning = c.burn > 0;
      if (c.burn > 0) { c.burn--; changed = true; }
      if (c.burn <= 0 && canOut && fuel && fuelTicks(fuel.id) > 0) {
        c.burn = c.burnMax = fuelTicks(fuel.id);
        if (fuel.id === 'lava_bucket') c.items[1] = { id: 'bucket', count: 1 };
        else { fuel.count--; if (!fuel.count) c.items[1] = null; }
        changed = true;
      }
      if (c.burn > 0 && canOut) {
        c.cook++;
        if (c.cook >= SMELT_TICKS) {
          c.cook = 0;
          input.count--; if (!input.count) c.items[0] = null;
          if (output) output.count++; else c.items[2] = { id: result, count: 1 };
        }
        changed = true;
      } else if (c.cook > 0) { c.cook = Math.max(0, c.cook - 2); changed = true; }
      const burning = c.burn > 0;
      if (burning !== wasBurning || (burning && world.getBlock(c.x, c.y, c.z) === ID.furnace) || (!burning && world.getBlock(c.x, c.y, c.z) === ID.furnace_lit)) {
        const cur = world.getBlock(c.x, c.y, c.z);
        if (cur === ID.furnace || cur === ID.furnace_lit) {
          const meta = world.getMeta(c.x, c.y, c.z);
          world.setBlock(c.x, c.y, c.z, burning ? ID.furnace_lit : ID.furnace, meta, { noUpdate: true });
        }
      }
      if (changed && c.viewers.size && (this.server.tickCount % 4 === 0 || c.cook === 0)) this.notify(c, null);
    }
  }

  serialize() {
    const out = {};
    for (const [k, c] of this.map) {
      if (!c.items.some(Boolean) && !c.burn) continue;
      out[k] = { type: c.type, items: packStacks(c.items), burn: c.burn, burnMax: c.burnMax, cook: c.cook };
    }
    return out;
  }
}
