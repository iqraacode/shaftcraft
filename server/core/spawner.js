// Natural mob spawning: passive animals at chunk generation and slowly over time,
// hostile mobs in darkness away from players.
import * as C from '../../shared/constants.js';
import { ID, IS_SOLID, IS_FLUID, BLOCKS } from '../../shared/blocks.js';
import { rngFor } from '../../shared/noise.js';
import { PASSIVE, HOSTILE, MOB_TYPES } from './mobs.js';
import { BIOME } from '../../shared/worldgen.js';
import { villagersForChunk } from '../../shared/villages.js';
import { dimensionAt, END } from '../../shared/dimensions.js';
import { endPillars } from '../../shared/endgen.js';

export class Spawner {
  constructor(server, spawnedChunks) {
    this.server = server;
    this.spawned = new Set(spawnedChunks || []);
  }

  canSpawnAt(x, y, z, h) {
    const w = this.server.world;
    const below = w.getBlock(x, y - 1, z);
    if (!IS_SOLID[below] || !BLOCKS[below].full || below === ID.bedrock) return false;
    for (let i = 0; i < Math.ceil(h); i++) {
      const id = w.getBlock(x, y + i, z);
      if (id !== 0 && (IS_SOLID[id] || IS_FLUID[id])) return false;
    }
    return true;
  }

  // Called when a chunk is generated/loaded for the first time ever.
  onChunkFirstLoad(chunk, key) {
    if (this.spawned.has(key)) return;
    this.spawned.add(key);
    if (this.server.world.gen.type === 'flat' && !this.server.config.flatAnimals) { /* animals still spawn on superflat */ }
    if (dimensionAt(chunk.cx * 16, chunk.cz * 16) === 'end') {
      for (const p of endPillars()) if ((p.x >> 4) === chunk.cx && (p.z >> 4) === chunk.cz) this.server.entities.spawnMob('end_crystal', p.x + 0.5, p.top + 2, p.z + 0.5);
      if ((END.x >> 4) === chunk.cx && (END.z >> 4) === chunk.cz && !this.server.level.dragonKilled) this.server.entities.spawnMob('ender_dragon', END.x + 40, END.top + 25, END.z);
    }
    if (dimensionAt(chunk.cx * 16, chunk.cz * 16) === 'overworld') for (const v of villagersForChunk(this.server.world.gen, chunk.cx, chunk.cz)) {
      this.server.entities.spawnMob('villager', v.x, v.y, v.z, { prof: v.prof, style: v.style });
    }
    const rng = rngFor(this.server.seed, chunk.cx, 0xa11, chunk.cz);
    if (rng() > 0.12) return;
    const lx = Math.floor(rng() * 16), lz = Math.floor(rng() * 16);
    const x = chunk.cx * 16 + lx, z = chunk.cz * 16 + lz;
    const top = chunk.heightmap[(lz << 4) | lx];
    if (top <= 0) return;
    const ground = chunk.get(lx, top - 1, lz);
    if (ground !== ID.grass) return;
    const biome = chunk.biomes[(lz << 4) | lx];
    if (biome === BIOME.DESERT) return;
    const type = PASSIVE[Math.floor(rng() * PASSIVE.length)];
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const sx = x + Math.floor(rng() * 5) - 2, sz = z + Math.floor(rng() * 5) - 2;
      if ((sx >> 4) !== chunk.cx || (sz >> 4) !== chunk.cz) continue;
      const sy = chunk.heightmap[((sz & 15) << 4) | (sx & 15)];
      if (chunk.get(sx & 15, sy - 1, sz & 15) !== ID.grass) continue;
      this.server.entities.spawnMob(type, sx + 0.5, sy, sz + 0.5, { baby: rng() < 0.1 });
    }
  }

  tick() {
    const server = this.server;
    const players = server.activePlayers().filter((p) => p.gamemode !== 'spectator');
    if (!players.length) return;
    const w = server.world;
    const rng = w.rng;
    const mobs = server.entities.mobs();
    // ---- passive (slowly over time) ----
    if (server.tickCount % 400 === 0) {
      for (const p of players) {
        const near = mobs.filter((m) => !m.def.hostile && Math.abs(m.x - p.x) < 64 && Math.abs(m.z - p.z) < 64).length;
        if (near >= C.PASSIVE_CAP) continue;
        const a = rng() * Math.PI * 2, d = 24 + rng() * 40;
        const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
        if (!w.hasChunk(x >> 4, z >> 4)) continue;
        const y = w.topY(x, z);
        if (w.getBlock(x, y - 1, z) !== ID.grass) continue;
        if (w.lightAt(x, y, z, true) < C.PASSIVE_MIN_LIGHT) continue;
        const type = PASSIVE[Math.floor(rng() * PASSIVE.length)];
        if (this.canSpawnAt(x, y, z, MOB_TYPES[type].h)) server.entities.spawnMob(type, x + 0.5, y, z + 0.5, { baby: rng() < 0.1 });
      }
    }
    // ---- hostile ----
    if (server.difficulty === 'peaceful') return;
    const hostileCount = mobs.filter((m) => m.def.hostile).length;
    const cap = Math.min(C.HOSTILE_CAP, 20 + players.length * 25);
    if (hostileCount >= cap) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = players[Math.floor(rng() * players.length)];
      const a = rng() * Math.PI * 2, d = C.HOSTILE_MIN_DIST + rng() * (C.HOSTILE_MAX_DIST - C.HOSTILE_MIN_DIST);
      const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (!w.hasChunk(x >> 4, z >> 4)) continue;
      const top = w.topY(x, z);
      // pick a y: surface or somewhere in caves below
      let y = rng() < 0.5 ? top : 2 + Math.floor(rng() * Math.max(1, top - 2));
      // find floor near y
      let found = false;
      for (let k = 0; k < 16 && y > 1; k++, y--) {
        if (this.canSpawnAt(x, y, z, 2)) { found = true; break; }
      }
      if (!found) continue;
      // too close to any player?
      let tooClose = false;
      for (const q of players) if (Math.hypot(q.x - x, q.y - y, q.z - z) < C.HOSTILE_MIN_DIST) tooClose = true;
      if (tooClose) continue;
      const dim = dimensionAt(x, z);
      if (dim === 'end' && (rng() < 0.85 || mobs.filter((m) => m.type === 'enderman').length > 12)) continue;
      if (dim !== 'end') {
        const blockLight = w.blockLightAt(x, y, z);
        if (blockLight > C.HOSTILE_MAX_BLOCK_LIGHT) continue;
        if (w.skyExposed(x, y, z) && server.skyFactor() > 0.5) continue;
      }
      const type = dim === 'end' ? 'enderman' : rng() < 0.1 ? 'enderman' : HOSTILE[Math.floor(rng() * HOSTILE.length)];
      const def = MOB_TYPES[type];
      if (type === 'spider' && !this.canSpawnAt(x + 1, y, z, 1)) continue;
      if (!this.canSpawnAt(x, y, z, def.h)) continue;
      server.entities.spawnMob(type, x + 0.5, y, z + 0.5);
    }
  }

  serialize() { return [...this.spawned]; }
}
