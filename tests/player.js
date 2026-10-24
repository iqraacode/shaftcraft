// Headless player checks: fall damage, hardcore death -> spectator, anti-fly, eating, sleeping.
import { GameServer } from '../server/core/GameServer.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { ID } from '../shared/blocks.js';

class Mem { async load() { return null; } async save() {} }
let ok = true;
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + ' ' + x); if (!c) ok = false; };
const s = new GameServer({ storage: new Mem(), config: { sp: true }, log: () => {} });
await s.init({ name: 't', seed: 'p', type: 'flat', gamemode: 'hardcore' });
const got = [];
const h = s.connect({ send: (m) => got.push(m), close() {} });
h.onMessage({ t: 'hello', name: 'P', protocol: PROTOCOL_VERSION, viewDistance: 4 });
const p = [...s.players.values()][0];
for (let i = 0; i < 40; i++) s.tick();
const ground = p.y;
// anti-fly: jumping 5 blocks up is rejected
got.length = 0;
h.onMessage({ t: 'move', x: p.x, y: ground + 5, z: p.z, yaw: 0, pitch: 0, f: 0, tid: p.tid });
check('anti-fly rejects vertical teleport', got.some((m) => m.t === 'pos') && p.y === ground);
// fall damage: simulate falling from 12 blocks via a column (allowed: server places player up via teleport first)
s.teleport(p, p.x, ground + 12, p.z);
for (let y = ground + 12; y > ground; y -= 0.8) { h.onMessage({ t: 'move', x: p.x, y: Math.max(ground, y - 0.8), z: p.z, yaw: 0, pitch: 0, f: y - 0.8 <= ground ? 64 : 0, tid: p.tid }); s.tick(); }
check('fall damage applied (12 blocks -> 9)', p.hp === 11, `(hp ${p.hp})`);
// eating
p.food = 10;
p.inv.main[0] = { id: 'bread', count: 2 }; p.inv.selected = 0;
h.onMessage({ t: 'useItem' });
for (let i = 0; i < 40; i++) s.tick();
check('eating bread restores 5 hunger', p.food === 15 && p.inv.main[0].count === 1, `(food ${p.food})`);
// sleeping at night with bed
s.time = 14000;
s.world.setBlock(Math.floor(p.x) + 2, Math.floor(ground), Math.floor(p.z), ID.bed, 1, { noUpdate: true });
s.world.setBlock(Math.floor(p.x) + 3, Math.floor(ground), Math.floor(p.z), ID.bed, 1 | 4, { noUpdate: true });
for (const m of s.entities.mobs()) s.entities.remove(m);
h.onMessage({ t: 'use', x: Math.floor(p.x) + 2, y: Math.floor(ground), z: Math.floor(p.z), face: 2 });
check('player sleeps in bed at night', p.sleeping);
for (let i = 0; i < 120; i++) s.tick();
check('night skipped after sleeping', !p.sleeping && s.time % 24000 < 100, `(time ${s.time % 24000})`);
check('bed sets spawn point', !!p.spawnPoint);
// nether portal: build a 4x5 frame, light it, stand inside, travel there and back
{
  const { dimensionAt } = await import('../shared/dimensions.js');
  const bx = Math.floor(p.x) + 6, by = Math.floor(ground), bz = Math.floor(p.z);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) if (i === 0 || i === 3 || j === 0 || j === 4) s.world.setBlock(bx + i, by + j, bz, ID.obsidian, 0, { noUpdate: true });
  p.inv.main[0] = { id: 'flint_and_steel', count: 1 }; p.inv.selected = 0;
  s.teleport(p, bx + 1.5, by + 1, bz + 2.5);
  h.onMessage({ t: 'use', x: bx + 1, y: by, z: bz, face: 2 });
  check('flint and steel lights the portal', s.world.getBlock(bx + 1, by + 1, bz) === ID.nether_portal && s.world.getBlock(bx + 2, by + 3, bz) === ID.nether_portal);
  s.teleport(p, bx + 1.5, by + 1, bz + 0.5);
  for (let i = 0; i < 90; i++) s.tick();
  check('portal sends player to the Nether', dimensionAt(p.x, p.z) === 'nether', `(at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)})`);
  check('arrived inside a portal', s.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === ID.nether_portal);
  const nb = s.world.getBlock(Math.floor(p.x), 0, Math.floor(p.z));
  check('Nether terrain generated (bedrock floor)', nb === ID.bedrock);
  const px = p.x, py = p.y, pz = p.z;
  s.teleport(p, px + 3, py, pz); for (let i = 0; i < 110; i++) s.tick();
  s.teleport(p, px, py, pz); for (let i = 0; i < 90; i++) s.tick();
  check('portal returns player to the Overworld near the start', dimensionAt(p.x, p.z) === 'overworld' && Math.abs(p.x - bx) < 24, `(at ${p.x.toFixed(0)},${p.z.toFixed(0)})`);
  s.world.setBlock(bx, by + 2, bz, 0, 0);
  check('breaking the frame breaks the portal', s.world.getBlock(bx + 1, by + 2, bz) === 0);
}
// The End: fill a stronghold portal with eyes, travel, dragon + crystals, kill dragon, exit portal home
{
  const { strongholds, frameCells, ROOM_Y } = await import('../shared/strongholds.js');
  const { dimensionAt, END } = await import('../shared/dimensions.js');
  const sh = strongholds(s.seed)[0];
  for (const [fx, fz] of frameCells(sh)) s.world.setBlock(fx, ROOM_Y + 1, fz, ID.end_portal_frame, 0, { noUpdate: true });
  s.teleport(p, sh.x + 0.5, ROOM_Y + 2, sh.z - 3.5);
  for (const [fx, fz] of frameCells(sh)) { p.inv.main[0] = { id: 'eye_of_ender', count: 1 }; p.inv.selected = 0; h.onMessage({ t: 'use', x: fx, y: ROOM_Y + 1, z: fz, face: 2 }); }
  check('12 eyes open the End portal', s.world.getBlock(sh.x, ROOM_Y + 1, sh.z) === ID.end_portal);
  for (let i = 0; i < 120; i++) s.tick();
  s.teleport(p, sh.x + 0.5, ROOM_Y + 1, sh.z + 0.5);
  for (let i = 0; i < 5; i++) s.tick();
  check('End portal sends player to the End platform', dimensionAt(p.x, p.z) === 'end' && s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) === ID.obsidian, `(at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)})`);
  for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) s.world.getChunk((END.x >> 4) + cx, (END.z >> 4) + cz);
  const mobs = s.entities.mobs();
  const dragon = mobs.find((m) => m.type === 'ender_dragon');
  check('Ender Dragon and 10 crystals spawn', !!dragon && mobs.filter((m) => m.type === 'end_crystal').length === 10, `(${mobs.filter((m) => m.type === 'end_crystal').length} crystals)`);
  check('main island is end stone', s.world.getBlock(END.x + 20, END.top, END.z) === ID.end_stone);
  for (let i = 0; i < 40; i++) s.tick();
  check('dragon flies', Math.hypot(dragon.x - (END.x + 40), dragon.z - END.z) > 1);
  dragon.hurt(1000, 'player', p);
  for (let i = 0; i < 25; i++) s.tick();
  check('killing the dragon opens the exit portal', s.level.dragonKilled && s.world.getBlock(END.x + 1, END.top, END.z) === ID.end_portal);
  s.teleport(p, END.x + 1.5, END.top, END.z + 0.5);
  for (let i = 0; i < 5; i++) s.tick();
  check('exit portal returns player to the Overworld', dimensionAt(p.x, p.z) === 'overworld', `(at ${p.x.toFixed(0)},${p.z.toFixed(0)})`);
}
// hardcore death
got.length = 0;
s.damagePlayer(p, 100, 'kill', null, 0, 0, 0, true);
const death = got.find((m) => m.t === 'death');
check('hardcore death message', death && death.hardcore === true);
h.onMessage({ t: 'respawn' });
check('cannot respawn in hardcore', !p.alive);
h.onMessage({ t: 'hardcoreSpectate' });
check('spectate after hardcore death', p.alive && p.gamemode === 'spectator');
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
