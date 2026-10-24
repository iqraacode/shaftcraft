// Single-player: the same authoritative GameServer used by the Node server, running in a
// Web Worker and persisting to IndexedDB.
import { GameServer } from '../../../server/core/GameServer.js';
import { IDBStorage } from './storage.js';

let server = null;
let handler = null;

const conn = {
  send(m) { self.postMessage({ type: 'msg', m }); },
  close() { self.postMessage({ type: 'closed' }); },
};

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === 'start') {
      server = new GameServer({ storage: new IDBStorage(d.worldId), config: { sp: true, maxPlayers: 1, pvp: false }, log: () => {} });
      await server.init(d.create || null);
      server.start();
      handler = server.connect(conn);
      self.postMessage({ type: 'ready' });
    } else if (d.type === 'msg') {
      if (handler) handler.onMessage(d.m);
    } else if (d.type === 'save') {
      if (server) await server.save();
    } else if (d.type === 'stop') {
      if (handler) handler.onClose();
      handler = null;
      if (server) await server.stop();
      self.postMessage({ type: 'stopped' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack || err) });
  }
};
