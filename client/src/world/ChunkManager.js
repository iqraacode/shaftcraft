// Streams chunks around the camera: requests modification lists from the server, generates
// terrain in a worker pool, applies light stitching, and schedules (re)meshing by distance.
import { chunkKey } from '../../../shared/chunk.js';

export class ChunkManager {
  constructor({ world, chunkRenderer, requestMods, uv, seed, worldType }) {
    this.world = world;
    this.renderer = chunkRenderer;
    this.requestMods = requestMods; // (list of [cx,cz]) => void; replies via onMods
    this.renderDistance = 8;
    this.center = [0, 0];
    this.states = new Map(); // key -> 'req' | 'gen' | 'loaded'
    this.pendingBlocks = new Map(); // key -> [[x,y,z,id,meta]] arriving before the chunk exists
    this.genQueue = []; // [cx, cz, mods]
    this.needsMesh = new Set();
    this.meshInFlight = new Map(); // key -> version
    this.version = new Map();
    this.reqInFlight = 0;
    this.maxReqInFlight = 96;
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => this.onWorkerMessage(w, e.data);
      w.onerror = (e) => { console.warn('Chunk worker error', e.message); };
      w.postMessage({ type: 'init', uv, seed, worldType });
      this.workers.push(w);
    }
    this.jobId = 1;
    this.lastNeedKey = '';
    this.needed = [];
    this.stats = { generated: 0, meshed: 0 };
    this.onChunkLoaded = null;
    this.disposed = false;
  }

  setWorld(seed, worldType) {
    for (const w of this.workers) w.postMessage({ type: 'world', seed, worldType });
  }

  setRenderDistance(rd) {
    if (rd === this.renderDistance) return;
    this.renderDistance = rd;
    this.lastNeedKey = '';
  }

  setCenter(x, z) {
    const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    this.center = [cx, cz];
  }

  // Server replied with the modification list for a chunk.
  onMods(cx, cz, mods) {
    const key = chunkKey(cx, cz);
    if (this.states.get(key) !== 'req') return;
    this.reqInFlight = Math.max(0, this.reqInFlight - 1);
    if (!this.isNeeded(cx, cz, 2)) { this.states.delete(key); return; }
    this.states.set(key, 'gen');
    this.genQueue.push([cx, cz, mods]);
  }

  // Block update from the server: apply now, or remember it until the chunk is generated.
  onBlockUpdate(x, y, z, id, meta) {
    const cx = x >> 4, cz = z >> 4;
    const key = chunkKey(cx, cz);
    const st = this.states.get(key);
    if (st === 'loaded') { this.world.setBlock(x, y, z, id, meta); return; }
    if (st === 'req' || st === 'gen') {
      let list = this.pendingBlocks.get(key);
      if (!list) { list = []; this.pendingBlocks.set(key, list); }
      list.push([x, y, z, id, meta]);
    }
  }

  isNeeded(cx, cz, extra = 1) {
    const dx = cx - this.center[0], dz = cz - this.center[1];
    const r = this.renderDistance + extra;
    return dx * dx + dz * dz <= r * r;
  }

  computeNeeded() {
    const key = this.center[0] + ',' + this.center[1] + ',' + this.renderDistance;
    if (key === this.lastNeedKey) return;
    this.lastNeedKey = key;
    const r = this.renderDistance + 1;
    const out = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dz * dz;
      if (d > r * r) continue;
      out.push([this.center[0] + dx, this.center[1] + dz, d]);
    }
    out.sort((a, b) => a[2] - b[2]);
    this.needed = out;
    // unload far chunks
    for (const [k, st] of this.states) {
      const [cx, cz] = k.split(',').map(Number);
      if (this.isNeeded(cx, cz, 3)) continue;
      if (st === 'loaded') { this.world.removeChunk(cx, cz); this.renderer.removeMesh(cx, cz); }
      if (st === 'req') this.reqInFlight = Math.max(0, this.reqInFlight - 1);
      this.states.delete(k);
      this.pendingBlocks.delete(k);
      this.needsMesh.delete(k);
    }
  }

  update() {
    if (this.disposed) return;
    this.computeNeeded();
    // requests
    const req = [];
    for (const [cx, cz] of this.needed) {
      if (this.reqInFlight + req.length / 2 >= this.maxReqInFlight) break;
      const k = chunkKey(cx, cz);
      if (this.states.has(k)) continue;
      this.states.set(k, 'req');
      req.push(cx, cz);
    }
    if (req.length) { this.reqInFlight += req.length / 2; this.requestMods(req); }

    // generation jobs (closest first)
    if (this.genQueue.length > 1) {
      const [ccx, ccz] = this.center;
      this.genQueue.sort((a, b) => ((b[0] - ccx) ** 2 + (b[1] - ccz) ** 2) - ((a[0] - ccx) ** 2 + (a[1] - ccz) ** 2));
    }
    for (const w of this.workers) {
      while (w.busy < 2 && this.genQueue.length) {
        const [cx, cz, mods] = this.genQueue.pop();
        if (!this.isNeeded(cx, cz, 2)) { this.states.delete(chunkKey(cx, cz)); continue; }
        w.busy++;
        w.postMessage({ type: 'gen', id: this.jobId++, cx, cz, mods });
      }
    }

    // dirty chunks -> mesh queue
    for (const k of this.world.dirty) {
      const [cx, cz] = k.split(',').map(Number);
      if (this.states.get(k) !== 'loaded') { this.world.dirty.delete(k); continue; }
      if (!this.isNeeded(cx, cz, 0)) { this.world.dirty.delete(k); continue; }
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) if (!this.world.hasChunk(cx + dx, cz + dz)) ok = false;
      if (!ok) continue;
      this.world.dirty.delete(k);
      this.needsMesh.add(k);
      this.version.set(k, (this.version.get(k) || 0) + 1);
    }
    if (this.needsMesh.size) {
      const [ccx, ccz] = this.center;
      const list = [...this.needsMesh].map((k) => { const [cx, cz] = k.split(',').map(Number); return [k, cx, cz, (cx - ccx) ** 2 + (cz - ccz) ** 2]; });
      list.sort((a, b) => a[3] - b[3]);
      let li = 0;
      for (const w of this.workers) {
        while (w.busy < 2 && li < list.length) {
          const [k, cx, cz] = list[li++];
          if (this.meshInFlight.has(k)) continue;
          const job = this.world.buildMeshJob(cx, cz);
          if (!job) continue;
          this.needsMesh.delete(k);
          const v = this.version.get(k) || 0;
          this.meshInFlight.set(k, v);
          job.type = 'mesh'; job.id = this.jobId++; job.version = v; job.smooth = this.smoothLighting !== false;
          w.busy++;
          w.postMessage(job, [job.blocks.buffer, job.light.buffer, job.meta.buffer, job.biome.buffer]);
        }
      }
    }
  }

  onWorkerMessage(w, d) {
    w.busy = Math.max(0, w.busy - 1);
    if (this.disposed) return;
    if (d.type === 'error') { console.warn('Chunk worker job failed', d.error); return; }
    const key = chunkKey(d.cx, d.cz);
    if (d.type === 'gen') {
      if (this.states.get(key) !== 'gen') return;
      this.world.addChunk(d);
      this.states.set(key, 'loaded');
      this.stats.generated++;
      const pend = this.pendingBlocks.get(key);
      if (pend) { this.pendingBlocks.delete(key); for (const [x, y, z, id, meta] of pend) this.world.setBlock(x, y, z, id, meta); }
      if (this.onChunkLoaded) this.onChunkLoaded(d.cx, d.cz);
    } else if (d.type === 'mesh') {
      this.meshInFlight.delete(key);
      if (this.states.get(key) !== 'loaded') return;
      this.renderer.setMesh(d.cx, d.cz, d);
      this.stats.meshed++;
    }
  }

  remeshAll() {
    for (const k of this.states.keys()) if (this.states.get(k) === 'loaded') this.world.dirty.add(k);
  }

  // progress of chunks within radius r of the center that are meshed
  progress(r) {
    let total = 0, done = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      total++;
      if (this.renderer.hasMesh(this.center[0] + dx, this.center[1] + dz)) done++;
    }
    return { total, done };
  }

  loadedCount() { let n = 0; for (const s of this.states.values()) if (s === 'loaded') n++; return n; }

  reset() {
    for (const k of this.states.keys()) { const [cx, cz] = k.split(',').map(Number); this.renderer.removeMesh(cx, cz); }
    this.states.clear(); this.pendingBlocks.clear(); this.genQueue = []; this.needsMesh.clear(); this.meshInFlight.clear();
    this.world.clear();
    this.reqInFlight = 0; this.lastNeedKey = '';
  }

  dispose() {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
