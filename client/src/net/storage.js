// IndexedDB persistence for single-player worlds. Used by the menu (main thread) and by the
// single-player server worker (load/save of world data).
const DB_NAME = 'shaftcraft';
const DB_VERSION = 1;
const PARTS = ['level', 'mods', 'players', 'containers', 'dormant', 'spawned', 'ops', 'bans'];

let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  });
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function listWorlds() {
  const db = await openDB();
  const all = await reqP(db.transaction('worlds').objectStore('worlds').getAll());
  return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export async function getWorldMeta(id) {
  const db = await openDB();
  return reqP(db.transaction('worlds').objectStore('worlds').get(id));
}

export async function createWorldMeta(meta) {
  const db = await openDB();
  const existing = await listWorlds();
  let base = meta.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'World';
  let id = base, n = 2;
  const ids = new Set(existing.map((w) => w.id));
  while (ids.has(id)) id = `${base} (${n++})`;
  const m = { id, name: meta.name, gamemode: meta.gamemode, difficulty: meta.difficulty, hardcore: meta.gamemode === 'hardcore', allowCommands: meta.allowCommands, type: meta.type, seed: meta.seed, created: Date.now(), lastPlayed: Date.now(), size: 0 };
  await tx(db, ['worlds'], 'readwrite', (t) => t.objectStore('worlds').put(m));
  return m;
}

export async function updateWorldMeta(id, patch) {
  const db = await openDB();
  const cur = await getWorldMeta(id);
  if (!cur) return;
  await tx(db, ['worlds'], 'readwrite', (t) => t.objectStore('worlds').put({ ...cur, ...patch }));
}

export async function renameWorld(id, name) {
  await updateWorldMeta(id, { name });
  const db = await openDB();
  const level = await reqP(db.transaction('data').objectStore('data').get(id + '/level'));
  if (level) await tx(db, ['data'], 'readwrite', (t) => t.objectStore('data').put({ ...level, name }, id + '/level'));
}

export async function deleteWorld(id) {
  const db = await openDB();
  await tx(db, ['worlds', 'data'], 'readwrite', (t) => {
    t.objectStore('worlds').delete(id);
    for (const p of PARTS) t.objectStore('data').delete(id + '/' + p);
  });
}

// Storage backend for GameServer (runs inside the SP worker).
export class IDBStorage {
  constructor(worldId) { this.id = worldId; }
  async load() {
    const db = await openDB();
    const store = db.transaction('data').objectStore('data');
    const out = {};
    for (const p of PARTS) out[p] = await reqP(store.get(this.id + '/' + p));
    if (!out.level) return null;
    return out;
  }
  async save(data) {
    const db = await openDB();
    let size = 0;
    const enc = {};
    for (const p of PARTS) { const json = JSON.stringify(data[p] ?? null); size += json.length; enc[p] = data[p]; }
    const meta = await getWorldMeta(this.id);
    await tx(db, ['data', 'worlds'], 'readwrite', (t) => {
      const s = t.objectStore('data');
      for (const p of PARTS) s.put(enc[p] ?? null, this.id + '/' + p);
      if (meta) t.objectStore('worlds').put({ ...meta, lastPlayed: Date.now(), size, name: data.level.name || meta.name, difficulty: data.level.difficulty });
    });
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
