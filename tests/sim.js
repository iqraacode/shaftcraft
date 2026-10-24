// Headless simulation checks: fluids, infinite water, lava+water, falling blocks, explosion, saplings.
import { GameServer } from '../server/core/GameServer.js';
import { ID } from '../shared/blocks.js';

class MemStorage { async load() { return null; } async save() {} }
const s = new GameServer({ storage: new MemStorage(), config: { sp: true }, log: () => {} });
await s.init({ name: 't', seed: 'flat', type: 'flat', gamemode: 'creative' });
const w = s.world;
import { PROTOCOL_VERSION } from '../shared/constants.js';
s.connect({ send() {}, close() {} }).onMessage({ t: 'hello', name: 'Sim', protocol: PROTOCOL_VERSION, viewDistance: 4 });
const pl = [...s.players.values()][0]; pl.x = 0.5; pl.y = 60; pl.z = 0.5; pl.gamemode = 'creative';
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(cx, cz);
const run = (n) => { for (let i = 0; i < n; i++) s.tick(); };
const count = (id, r = 12) => { let n = 0; for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = 0; y < 12; y++) if (w.getBlock(x, y, z) === id) n++; return n; };
let ok = true;
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra); if (!cond) ok = false; };

// 1. water spreads on flat ground (surface y=3 grass, place at y=4)
w.setBlock(0, 4, 0, ID.water, 0);
run(200);
const water = count(ID.water);
check('water spreads ~7 blocks', water > 60 && water < 200, `(${water} water cells)`);
check('flow level at distance 7', w.getBlock(7, 4, 0) === ID.water && (w.getMeta(7, 4, 0) & 7) === 7);
check('no water at distance 8', w.getBlock(8, 4, 0) !== ID.water);
// 2. removing the source drains
w.setBlock(0, 4, 0, 0, 0);
run(300);
check('water drains after source removed', count(ID.water) === 0, `(${count(ID.water)} left)`);
// 3. infinite water: two sources with a gap
w.setBlock(20, 4, 20, ID.water, 0); w.setBlock(22, 4, 20, ID.water, 0);
// walls to contain
run(100);
check('infinite water creates source', w.getBlock(21, 4, 20) === ID.water && w.getMeta(21, 4, 20) === 0);
// 4. lava + water -> cobblestone
w.setBlock(-20, 4, -20, ID.lava, 0);
run(5);
w.setBlock(-19, 4, -20, ID.water, 0);
run(80);
check('lava source touching water becomes obsidian', w.getBlock(-20, 4, -20) === ID.obsidian, `(got ${w.getBlock(-20, 4, -20)})`);
// 5. falling sand
w.setBlock(10, 9, -10, ID.sand, 0);
run(60);
check('sand falls to ground', w.getBlock(10, 4, -10) === ID.sand && w.getBlock(10, 9, -10) === 0);
// 6. explosion
for (let x = -30; x <= -26; x++) for (let z = 26; z <= 30; z++) w.setBlock(x, 4, z, ID.stone, 0);
w.explode(-28, 4.5, 28, 3, null);
let left = 0; for (let x = -30; x <= -26; x++) for (let z = 26; z <= 30; z++) if (w.getBlock(x, 4, z) === ID.stone) left++;
check('explosion destroys blocks', left < 20, `(${left}/25 left)`);
// 7. sapling grows into a tree
w.setBlock(30, 4, -30, ID.oak_sapling, 0);
const grew = w.growTree(30, 4, -30, 'oak');
check('sapling grows', grew && w.getBlock(30, 4, -30) === ID.oak_log);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
