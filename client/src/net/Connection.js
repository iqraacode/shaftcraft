// Transports: single-player (Web Worker running the server) and multiplayer (WebSocket).
import { DEFAULT_PORT } from '../../../shared/constants.js';

export class SPConnection {
  constructor(worldId, create) {
    this.worker = new Worker(new URL('./serverWorker.js', import.meta.url), { type: 'module' });
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'ready') resolve();
        else if (d.type === 'msg') { if (this.onmessage) this.onmessage(d.m); }
        else if (d.type === 'error') { reject(new Error(d.error)); if (this.onerror) this.onerror(d.error); }
        else if (d.type === 'stopped') { if (this.stopResolve) this.stopResolve(); }
        else if (d.type === 'closed') { if (this.onclose) this.onclose('Connection closed'); }
      };
      this.worker.onerror = (e) => { reject(new Error(e.message || 'Server worker failed')); if (this.onerror) this.onerror(e.message); };
    });
    this.worker.postMessage({ type: 'start', worldId, create });
    this.sp = true;
  }
  send(m) { this.worker.postMessage({ type: 'msg', m }); }
  save() { this.worker.postMessage({ type: 'save' }); }
  async close() {
    const p = new Promise((r) => { this.stopResolve = r; setTimeout(r, 4000); });
    this.worker.postMessage({ type: 'stop' });
    await p;
    this.worker.terminate();
  }
}

export function normalizeAddress(address) {
  let a = String(address || '').trim();
  if (!a) a = 'localhost';
  if (/^wss?:\/\//.test(a)) return a;
  if (!/:\d+$/.test(a) && !a.endsWith(']')) a += ':' + DEFAULT_PORT;
  const secure = location.protocol === 'https:';
  return (secure ? 'wss://' : 'ws://') + a;
}

export class WSConnection {
  constructor(address) {
    this.url = normalizeAddress(address);
    this.onmessage = null; this.onclose = null; this.onerror = null;
    this.closedByUser = false;
    this.ready = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (err) { reject(err); return; }
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('Connection timed out')); try { ws.close(); } catch { /* ignore */ } }, 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to ' + address)); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (this.onmessage) this.onmessage(m);
      };
      ws.onclose = () => { clearTimeout(timer); if (!this.closedByUser && this.onclose) this.onclose('Connection lost'); };
    });
    this.sp = false;
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  async close() { this.closedByUser = true; try { this.ws.close(); } catch { /* ignore */ } }
}

// Ping a server for the server list: returns { motd, players, max, ping } or throws.
export function pingServer(address) {
  return new Promise((resolve, reject) => {
    let ws;
    const t0 = performance.now();
    try { ws = new WebSocket(normalizeAddress(address)); } catch (err) { reject(err); return; }
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('timeout')); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'status' }));
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'status') { clearTimeout(timer); resolve({ ...m, ping: Math.round(performance.now() - t0) }); ws.close(); }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
  });
}
