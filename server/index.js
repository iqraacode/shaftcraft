// ShaftCraft dedicated server (Node.js). Hosts the authoritative GameServer over WebSockets,
// persists the world to ./server-data, serves the built client from ./dist when present,
// and accepts operator commands on stdin.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameServer } from './core/GameServer.js';
import { decode } from '../shared/protocol.js';
import { DEFAULT_PORT, MAX_PLAYERS, VERSION } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.SHAFTCRAFT_DATA || path.join(ROOT, 'server-data'));
const CONFIG_FILE = path.join(DATA_DIR, 'server-config.json');
const DIST_DIR = path.join(ROOT, 'dist');

const DEFAULT_CONFIG = {
  port: DEFAULT_PORT,
  host: '0.0.0.0',
  motd: 'A ShaftCraft Server',
  maxPlayers: MAX_PLAYERS,
  pvp: true,
  worldName: 'world',
  seed: '',
  worldType: 'default',
  gamemode: 'survival',
  difficulty: 'normal',
  hardcore: false,
  ops: [],
};

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

async function loadConfig() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  let cfg = { ...DEFAULT_CONFIG };
  try {
    cfg = { ...cfg, ...JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')) };
  } catch {
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    log('Created default config at ' + CONFIG_FILE);
  }
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  return cfg;
}

class FileStorage {
  constructor(dir) { this.dir = dir; }
  async load() {
    const read = async (name) => {
      try { return JSON.parse(await fsp.readFile(path.join(this.dir, name), 'utf8')); } catch { return null; }
    };
    const level = await read('level.json');
    if (!level) return null;
    return {
      level,
      mods: (await read('mods.json')) || {},
      players: (await read('players.json')) || {},
      containers: (await read('containers.json')) || {},
      dormant: (await read('entities.json')) || {},
      spawned: (await read('spawned.json')) || [],
      ops: (await read('ops.json')) || [],
      bans: (await read('bans.json')) || {},
    };
  }
  async save(data) {
    await fsp.mkdir(this.dir, { recursive: true });
    const write = async (name, obj) => {
      const file = path.join(this.dir, name);
      await fsp.writeFile(file + '.tmp', JSON.stringify(obj));
      await fsp.rename(file + '.tmp', file);
    };
    await write('level.json', data.level);
    await write('mods.json', data.mods);
    await write('players.json', data.players);
    await write('containers.json', data.containers);
    await write('entities.json', data.dormant);
    await write('spawned.json', data.spawned);
    await write('ops.json', data.ops);
    await write('bans.json', data.bans);
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function main() {
  const cfg = await loadConfig();
  const worldDir = path.join(DATA_DIR, cfg.worldName);
  const server = new GameServer({
    storage: new FileStorage(worldDir),
    config: { maxPlayers: cfg.maxPlayers, pvp: cfg.pvp, motd: cfg.motd, ops: cfg.ops || [], sp: false },
    log,
  });
  await server.init({
    name: cfg.worldName, seed: cfg.seed, type: cfg.worldType === 'flat' ? 'flat' : 'default',
    gamemode: cfg.hardcore ? 'hardcore' : cfg.gamemode, difficulty: cfg.difficulty, allowCommands: false,
  });
  server.start();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ motd: cfg.motd, players: server.joinedCount(), max: cfg.maxPlayers, version: VERSION }));
      return;
    }
    if (!fs.existsSync(DIST_DIR)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${VERSION} server is running. Connect from the game client (Multiplayer > Add Server).`);
      return;
    }
    let file = path.normalize(path.join(DIST_DIR, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST_DIR)) { res.writeHead(403); res.end(); return; }
    try {
      const st = await fsp.stat(file);
      if (st.isDirectory()) file = path.join(file, 'index.html');
      const body = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 1 << 20 });
  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress;
    let closed = false;
    const conn = {
      send(msg) { if (!closed && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
      close() { if (!closed) { closed = true; try { ws.close(); } catch { /* already closed */ } } },
      remote,
    };
    const handler = server.connect(conn);
    let lastPing = 0;
    const pinger = setInterval(() => { if (ws.readyState === 1) { lastPing = Date.now(); ws.ping(); } }, 2000);
    ws.on('pong', () => handler.setPing(Date.now() - lastPing));
    ws.on('message', (data) => {
      const msg = decode(data.toString());
      if (msg) handler.onMessage(msg);
    });
    ws.on('close', () => { closed = true; clearInterval(pinger); handler.onClose(); });
    ws.on('error', () => { /* handled by close */ });
  });

  httpServer.listen(cfg.port, cfg.host, () => {
    log(`${VERSION} server listening on ${cfg.host}:${cfg.port} (max ${cfg.maxPlayers} players, pvp ${cfg.pvp ? 'on' : 'off'})`);
    log('Type "help" for console commands.');
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('Saving world and stopping...');
    for (const p of [...server.players.values()]) server.kick(p, 'Server closed');
    await server.stop();
    wss.close();
    httpServer.close();
    log('World saved. Bye!');
    process.exit(0);
  };
  server.onStopRequested = shutdown;
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const l = line.trim();
      if (!l) return;
      if (l === 'help') { server.runConsole('help'); return; }
      server.runConsole(l);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
