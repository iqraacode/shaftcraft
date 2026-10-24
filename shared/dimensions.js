// Dimensions live in separate, walled-off regions of one shared world space, so every engine
// system (chunks, light, entities, saving, multiplayer) works in all of them unchanged.
export const OVERWORLD_BORDER = 30000; // |x|,|z| limit in the Overworld
// The End: main island at its center, void around it
export const END = { x: -40960, z: 0, r: 2048, top: 60, platform: [100, 48, 0] };
export const NETHER = { x: 40960, z: 0, r: 3840, ceiling: 127, lava: 31 }; // center + half-size (blocks)

export function dimensionAt(x, z) {
  if (Math.abs(x - NETHER.x) <= NETHER.r + 32 && Math.abs(z - NETHER.z) <= NETHER.r + 32) return 'nether';
  if (Math.abs(x - END.x) <= END.r + 32 && Math.abs(z - END.z) <= END.r + 32) return 'end';
  return 'overworld';
}

// 8:1 horizontal mapping between Overworld and Nether
export function toNether(x, z) { return [Math.floor(x / 8) + NETHER.x, Math.floor(z / 8) + NETHER.z]; }
export function toOverworld(x, z) { return [(x - NETHER.x) * 8, (z - NETHER.z) * 8]; }

// Clamp a position to the playable area of its dimension (world border)
export function clampToBorder(x, z) {
  if (dimensionAt(x, z) === 'nether') {
    const r = NETHER.r - 1;
    return [Math.max(NETHER.x - r, Math.min(NETHER.x + r, x)), Math.max(NETHER.z - r, Math.min(NETHER.z + r, z))];
  }
  if (dimensionAt(x, z) === 'end') {
    const r = END.r - 1;
    return [Math.max(END.x - r, Math.min(END.x + r, x)), Math.max(END.z - r, Math.min(END.z + r, z))];
  }
  const b = OVERWORLD_BORDER;
  return [Math.max(-b, Math.min(b, x)), Math.max(-b, Math.min(b, z))];
}
