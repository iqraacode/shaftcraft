// Chunk worker: deterministic terrain generation + in-chunk lighting, and mesh building.
import { WorldGen } from '../../../shared/worldgen.js';
import { computeChunkLight } from './lightcore.js';
import { meshChunk } from './mesher.js';

let gen = null;
let UV = null;

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      UV = msg.uv;
      if (msg.seed !== undefined) gen = new WorldGen(msg.seed, msg.worldType);
      return;
    }
    if (msg.type === 'world') {
      gen = new WorldGen(msg.seed, msg.worldType);
      return;
    }
    if (msg.type === 'gen') {
      const c = gen.generate(msg.cx, msg.cz);
      const mods = msg.mods || [];
      for (let i = 0; i < mods.length; i += 3) {
        const idx = mods[i];
        c.set(idx & 15, idx >> 8, (idx >> 4) & 15, mods[i + 1], mods[i + 2]);
      }
      // a mod might have raised the top; make sure the heightmap is right
      if (mods.length) c.recomputeHeightmap();
      const light = computeChunkLight(c.blocks, c.height);
      const meta = c.metaEntries();
      self.postMessage({
        type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, height: c.height, blocks: c.blocks, light,
        meta, heightmap: c.heightmap, biomes: c.biomes,
      }, [c.blocks.buffer, light.buffer, c.heightmap.buffer, c.biomes.buffer]);
      return;
    }
    if (msg.type === 'mesh') {
      const r = meshChunk(msg, UV);
      const transfer = [];
      for (const k of ['opaque', 'cutout', 'trans']) {
        const g = r[k];
        if (g) transfer.push(g.pos.buffer, g.uv.buffer, g.lt.buffer, g.col.buffer, g.idx.buffer);
      }
      self.postMessage({ type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, version: msg.version, H: msg.H, ...r }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.stack || err) });
  }
};
