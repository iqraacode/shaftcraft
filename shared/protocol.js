// Network protocol: compact JSON messages with a `t` (type) field. The same messages are used
// over WebSocket (multiplayer) and postMessage (single-player server worker).
//
// Client -> Server
//  hello {name, version, viewDistance}          chunks {req:[cx,cz,...]}
//  move {x,y,z,yaw,pitch,vx,vy,vz,g,f}          dig {p:'start'|'abort'|'finish', x,y,z, face}
//  use {x,y,z,face,hx,hy,hz}                     useItem {target?}      stopUse {}
//  slot {i}  win {wid, ...action}  closeWin {wid}  creative {act, ...}
//  drop {all}  swapHands {}  attack {eid}  interact {eid}  swing {}
//  chat {text}  respawn {}  pause {on}  pick {item}  spectate {name}  glide {on}
//  crash {dmg}  leaveBed {}  settings {viewDistance}  ping {c}  status {}  hardcoreSpectate {}
//
// Server -> Client
//  welcome {...}  chunk {cx,cz,m}  blocks {b}  spawn {e}  ents {d}  despawn {ids}
//  ev {id,k,...}  self {...}  inv {...}  open {...}  cont {...}  winData {...}  close {wid}
//  time {time, weather}  chat {text, color}  death {...}  pos {...}  mode {...}  sound {...}
//  fx {...}  players {list}  pong {c,tps}  kick {reason}  status {...}  equip {...}
//  boost {}  glide {on}  sleep {on}  difficulty {d}

export const MSG = {
  HELLO: 'hello', CHUNKS: 'chunks', MOVE: 'move', DIG: 'dig', USE: 'use', USE_ITEM: 'useItem', STOP_USE: 'stopUse',
  SLOT: 'slot', WIN: 'win', CLOSE_WIN: 'closeWin', CREATIVE: 'creative', DROP: 'drop', SWAP_HANDS: 'swapHands',
  ATTACK: 'attack', INTERACT: 'interact', SWING: 'swing', CHAT: 'chat', RESPAWN: 'respawn', PAUSE: 'pause',
  PICK: 'pick', SPECTATE: 'spectate', GLIDE: 'glide', CRASH: 'crash', LEAVE_BED: 'leaveBed', SETTINGS: 'settings',
  PING: 'ping', STATUS: 'status', HARDCORE_SPECTATE: 'hardcoreSpectate',
};

// Player state flags sent in move / entity updates.
export const FLAG = {
  SNEAK: 1, SPRINT: 2, GLIDE: 4, FLY: 8, SWIM: 16, JUMP: 32, GROUND: 64,
  BURNING: 128, USING: 256, SLEEPING: 512, HURT: 1024, BABY: 2048, SWELL: 4096, ARMS_UP: 8192,
  INVISIBLE: 16384, SHEARED: 32768, EATING_GRASS: 65536, DRAWING: 131072, STUCK: 262144,
};

export function encode(msg) { return JSON.stringify(msg); }
export function decode(data) {
  try {
    const m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
