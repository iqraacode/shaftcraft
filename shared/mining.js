// Mining rules shared by client prediction and server validation.
import { BLOCKS } from './blocks.js';
import { ITEMS } from './items.js';
import { BREAK_MULT_CORRECT, BREAK_MULT_WRONG } from './constants.js';

export function toolOf(stack) {
  if (!stack) return null;
  const it = ITEMS[stack.id];
  return it && it.tool ? it.tool : null;
}

export function canHarvest(blockId, stack) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (b.tier < 0) return true;
  const t = toolOf(stack);
  return !!t && t.type === b.tool && t.tier >= b.tier;
}

export function toolSpeed(blockId, stack) {
  const b = BLOCKS[blockId];
  const t = toolOf(stack);
  if (!t) return 1;
  if (t.type === 'shears') {
    if (b.leaves) return 15;
    if (b.name.endsWith('_wool')) return 5;
    return 1;
  }
  if (t.type === 'sword') return b.leaves ? 1.5 : 1;
  if (t.type === 'hoe' && b.leaves) return t.speed;
  return t.type === b.tool ? t.speed : 1;
}

// Ticks needed to break a block. Infinity if unbreakable.
export function breakTicks(blockId, stack, opts = {}) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return opts.creative ? 0 : Infinity;
  if (opts.creative) return 0;
  if (b.hardness === 0) return 0;
  const speed = toolSpeed(blockId, stack);
  const mult = canHarvest(blockId, stack) ? BREAK_MULT_CORRECT : BREAK_MULT_WRONG;
  let seconds = (b.hardness * mult) / speed;
  if (opts.headInWater) seconds *= 5;
  if (opts.airborne) seconds *= 5;
  return Math.max(1, Math.ceil(seconds * 20));
}
