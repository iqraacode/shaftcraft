// Headless test bot: connects to a ShaftCraft server and walks in a circle around spawn.
// Usage: node tests/bot.js [host:port] [name]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, DEFAULT_PORT } from '../shared/constants.js';

const addr = process.argv[2] || 'localhost:' + DEFAULT_PORT;
const name = process.argv[3] || 'TestBot';
const ws = new WebSocket('ws://' + addr);
let me = null, tid = 0, t = 0;
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, protocol: PROTOCOL_VERSION, viewDistance: 4 })));
ws.on('message', (data) => {
  const m = JSON.parse(data);
  if (m.t === 'welcome') {
    me = { ...m.player }; tid = m.tid;
    console.log('joined as', name, 'at', me.x, me.y, me.z);
    ws.send(JSON.stringify({ t: 'chat', text: 'Hello from ' + name + '!' }));
    setInterval(() => {
      t += 0.05;
      const x = me.x + Math.cos(t) * 3, z = me.z + Math.sin(t) * 3;
      ws.send(JSON.stringify({ t: 'move', x, y: me.y, z, yaw: -t, pitch: 0, vx: 0, vy: 0, vz: 0, f: 64, tid }));
      if (Math.random() < 0.05) ws.send(JSON.stringify({ t: 'swing' }));
    }, 50);
  }
  if (m.t === 'pos') { me.x = m.x; me.y = m.y; me.z = m.z; tid = m.tid; }
  if (m.t === 'chat') console.log('[chat]', m.text);
  if (m.t === 'kick') { console.log('kicked:', m.reason); process.exit(0); }
});
ws.on('close', () => { console.log('disconnected'); process.exit(0); });
