// In-chunk initial lighting (runs in the worker right after generation).
// light byte = (sky << 4) | block. Cells above chunk.height are implicitly sky 15.
import { LIGHT_OPACITY, LIGHT_EMIT } from '../../../shared/blocks.js';

export function computeChunkLight(blocks, height) {
  const light = new Uint8Array(height << 8);
  const qx = new Int32Array(height * 256 * 2 + 1024);
  let qh = 0, qt = 0;
  const QN = qx.length;
  // sky: straight down from the top until something with opacity
  for (let c = 0; c < 256; c++) {
    let l = 15;
    for (let y = height - 1; y >= 0; y--) {
      const i = (y << 8) | c;
      const op = LIGHT_OPACITY[blocks[i]];
      if (op) l = Math.max(0, l - Math.max(1, op));
      if (l <= 0) break;
      light[i] = l << 4;
    }
  }
  // seed BFS from sky-lit cells that have darker horizontal/below neighbors
  for (let y = 0; y < height; y++) for (let c = 0; c < 256; c++) {
    const i = (y << 8) | c;
    const s = light[i] >> 4;
    if (s < 2) continue;
    const x = c & 15, z = c >> 4;
    let need = false;
    if (x > 0 && (light[i - 1] >> 4) < s - 1) need = true;
    else if (x < 15 && (light[i + 1] >> 4) < s - 1) need = true;
    else if (z > 0 && (light[i - 16] >> 4) < s - 1) need = true;
    else if (z < 15 && (light[i + 16] >> 4) < s - 1) need = true;
    else if (y > 0 && (light[i - 256] >> 4) < s - 1) need = true;
    if (need) { qx[qt] = i; qt = (qt + 1) % QN; }
  }
  const spread = (shift) => {
    while (qh !== qt) {
      const i = qx[qh]; qh = (qh + 1) % QN;
      const l = (light[i] >> shift) & 15;
      if (l <= 1) continue;
      const y = i >> 8, c = i & 255, x = c & 15, z = c >> 4;
      for (let k = 0; k < 6; k++) {
        let j;
        if (k === 0) { if (x === 15) continue; j = i + 1; }
        else if (k === 1) { if (x === 0) continue; j = i - 1; }
        else if (k === 2) { if (z === 15) continue; j = i + 16; }
        else if (k === 3) { if (z === 0) continue; j = i - 16; }
        else if (k === 4) { if (y === height - 1) continue; j = i + 256; }
        else { if (y === 0) continue; j = i - 256; }
        const op = LIGHT_OPACITY[blocks[j]];
        if (op >= 15) continue;
        const nl = l - Math.max(1, op);
        if (nl <= 0) continue;
        const cur = (light[j] >> shift) & 15;
        if (nl > cur) {
          light[j] = (light[j] & ~(15 << shift)) | (nl << shift);
          qx[qt] = j; qt = (qt + 1) % QN;
        }
      }
    }
  };
  spread(4);
  // block light from emitters
  qh = qt = 0;
  for (let i = 0; i < blocks.length; i++) {
    const e = LIGHT_EMIT[blocks[i]];
    if (e) { light[i] = (light[i] & 0xf0) | e; qx[qt] = i; qt = (qt + 1) % QN; }
  }
  spread(0);
  return light;
}
