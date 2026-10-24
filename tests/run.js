// Headless smoke test: boots a GameServer with in-memory storage and drives a fake client.
import { GameServer } from '../server/core/GameServer.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';

class MemStorage { constructor() { this.data = null; } async load() { return this.data; } async save(d) { this.data = JSON.parse(JSON.stringify(d)); } }

const storage = new MemStorage();
const server = new GameServer({ storage, config: { sp: true }, log: () => {} });
await server.init({ name: 'test', seed: 'hello', gamemode: 'survival', allowCommands: true });
const got = [];
const conn = { send: (m) => got.push(m), close() {} };
const h = server.connect(conn);
h.onMessage({ t: 'hello', name: 'Tester', protocol: PROTOCOL_VERSION, viewDistance: 4 });
const welcome = got.find((m) => m.t === 'welcome');
if (!welcome) throw new Error('no welcome: ' + JSON.stringify(got.slice(0, 3)));
const p = [...server.players.values()][0];
h.onMessage({ t: 'chunks', req: [0, 0, 1, 1] });
for (let i = 0; i < 400; i++) server.tick();
h.onMessage({ t: 'chat', text: '/give Tester diamond_pickaxe 1' });
h.onMessage({ t: 'chat', text: '/give Tester planks 64' });
h.onMessage({ t: 'chat', text: '/time set night' });
h.onMessage({ t: 'chat', text: '/help' });
for (let i = 0; i < 2000; i++) server.tick();
// break the block under the player
const bx = Math.floor(p.x), by = Math.floor(p.y) - 1, bz = Math.floor(p.z);
h.onMessage({ t: 'dig', p: 'start', x: bx, y: by, z: bz, face: 2 });
for (let i = 0; i < 40; i++) server.tick();
h.onMessage({ t: 'dig', p: 'finish', x: bx, y: by, z: bz, face: 2 });
server.tick();
// craft sticks in 2x2: put planks into grid via window actions
const invSlot = p.inv.main.findIndex((s) => s && s.id === 'planks');
const winSlotOf = (mainIdx) => (mainIdx < 9 ? 36 + mainIdx : mainIdx);
h.onMessage({ t: 'win', wid: 0, a: 'click', slot: winSlotOf(invSlot), button: 0 });
h.onMessage({ t: 'win', wid: 0, a: 'click', slot: 1, button: 1 });
h.onMessage({ t: 'win', wid: 0, a: 'click', slot: 3, button: 1 });
h.onMessage({ t: 'win', wid: 0, a: 'click', slot: 0, button: 0, shift: true });
h.onMessage({ t: 'closeWin', wid: 0 });
await server.save();
const counts = {};
for (const m of got) counts[m.t] = (counts[m.t] || 0) + 1;
console.log('messages', JSON.stringify(counts));
console.log('inventory', p.inv.main.filter(Boolean).map((s) => s.id + 'x' + s.count).join(', '));
console.log('mobs', server.entities.mobs().map((m) => m.type).join(','));
console.log('chat', got.filter((m) => m.t === 'chat').map((m) => m.text).slice(0, 6).join(' | '));
console.log('saved keys', Object.keys(storage.data), 'mods chunks', Object.keys(storage.data.mods).length);
console.log('OK');
