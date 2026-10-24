// Chat / console commands. Players need operator status (ops, or a world with "Allow Commands").
import { ITEMS } from '../../shared/items.js';
import { DIFFICULTIES, DAY_TICKS } from '../../shared/constants.js';
import { addToInventory } from '../../shared/inventory.js';

const MODE_ALIASES = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };

export const COMMANDS = {
  help: { usage: '/help', desc: 'List available commands', op: false },
  gamemode: { usage: '/gamemode <survival|creative|spectator> [player]', desc: 'Change game mode', op: true },
  time: { usage: '/time <set|add> <value|day|noon|night|midnight>', desc: 'Change the time of day', op: true },
  weather: { usage: '/weather <clear|rain|thunder>', desc: 'Change the weather', op: true },
  tp: { usage: '/tp <x> <y> <z> | /tp <player> | /tp <player> <target>', desc: 'Teleport', op: true },
  give: { usage: '/give <player> <item> [count]', desc: 'Give items', op: true },
  kill: { usage: '/kill [player]', desc: 'Kill a player', op: true },
  difficulty: { usage: '/difficulty <peaceful|easy|normal|hard>', desc: 'Set difficulty', op: true },
  seed: { usage: '/seed', desc: 'Show the world seed', op: true },
  spawnpoint: { usage: '/spawnpoint [player] [x y z]', desc: 'Set a player spawn point', op: true },
  clear: { usage: '/clear [player]', desc: 'Clear an inventory', op: true },
  list: { usage: '/list', desc: 'List online players', op: false },
  op: { usage: '/op <player>', desc: 'Make a player operator', op: true, server: true },
  deop: { usage: '/deop <player>', desc: 'Remove operator status', op: true, server: true },
  kick: { usage: '/kick <player> [reason]', desc: 'Kick a player', op: true, server: true },
  ban: { usage: '/ban <player> [reason]', desc: 'Ban a player', op: true, server: true },
  pardon: { usage: '/pardon <player>', desc: 'Unban a player', op: true, server: true },
  save: { usage: '/save', desc: 'Save the world now', op: true, server: true },
  stop: { usage: '/stop', desc: 'Save and stop the server', op: true, server: true, consoleOnly: true },
};

function parseCoord(v, base) {
  if (v === undefined) return NaN;
  if (v.startsWith('~')) return base + (v.length > 1 ? Number(v.slice(1)) : 0);
  return Number(v);
}

// sender: ServerPlayer or null (console). reply(text, color)
export function runCommand(server, sender, line, reply) {
  const parts = line.trim().replace(/^\//, '').split(/\s+/);
  const name = (parts.shift() || '').toLowerCase();
  const cmd = COMMANDS[name];
  const isOp = !sender || sender.op;
  if (!cmd || (cmd.server && server.sp) || (cmd.consoleOnly && sender)) { reply('Unknown command. Type /help for a list.', 'red'); return; }
  if (cmd.op && !isOp) { reply('You do not have permission to use this command.', 'red'); return; }
  const findPlayer = (n) => {
    if (!n) return null;
    if (n === '@s' || n === '@p') return sender;
    for (const p of server.players.values()) if (p.name.toLowerCase() === n.toLowerCase()) return p;
    return null;
  };
  const target = (n) => {
    if (n === undefined) { if (!sender) reply('Specify a player.', 'red'); return sender; }
    const p = findPlayer(n);
    if (!p) reply('Player not found: ' + n, 'red');
    return p;
  };

  switch (name) {
    case 'help': {
      const avail = Object.entries(COMMANDS).filter(([, c]) => (!c.op || isOp) && !(c.server && server.sp) && !(c.consoleOnly && sender));
      for (const [, c] of avail) reply(c.usage + ' - ' + c.desc, 'gray');
      return;
    }
    case 'list': {
      const names = [...server.players.values()].filter((p) => p.joined).map((p) => p.name);
      reply(`${names.length}/${server.config.maxPlayers} players online: ${names.join(', ')}`, 'yellow');
      return;
    }
    case 'gamemode': {
      const mode = MODE_ALIASES[(parts[0] || '').toLowerCase()];
      if (!mode) { reply('Usage: ' + cmd.usage, 'red'); return; }
      const p = target(parts[1]); if (!p) return;
      if (server.hardcore && p.hardcoreDead && mode !== 'spectator') { reply('That player is dead in hardcore mode.', 'red'); return; }
      p.setGamemode(mode);
      reply(`Set ${p.name}'s game mode to ${mode[0].toUpperCase() + mode.slice(1)}`, 'yellow');
      if (p !== sender) p.send({ t: 'chat', text: `Your game mode has been updated to ${mode}`, color: 'yellow' });
      return;
    }
    case 'time': {
      const sub = (parts[0] || '').toLowerCase();
      const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 0, sunset: 12000 };
      const v = named[(parts[1] || '').toLowerCase()] ?? Number(parts[1]);
      if ((sub !== 'set' && sub !== 'add') || !Number.isFinite(v)) { reply('Usage: ' + cmd.usage, 'red'); return; }
      if (sub === 'set') server.time = Math.floor(server.time / DAY_TICKS) * DAY_TICKS + (v % DAY_TICKS);
      else server.time += v;
      server.broadcastTime();
      reply('Set the time to ' + (server.time % DAY_TICKS), 'yellow');
      return;
    }
    case 'weather': {
      const w = (parts[0] || '').toLowerCase();
      if (!['clear', 'rain', 'thunder'].includes(w)) { reply('Usage: ' + cmd.usage, 'red'); return; }
      server.setWeather(w, 6000 + Math.floor(Math.random() * 12000));
      reply('Changed the weather to ' + w, 'yellow');
      return;
    }
    case 'tp': {
      if (parts.length >= 3 && parts.slice(-3).every((v) => /^~?-?\d*\.?\d*$/.test(v))) {
        const who = parts.length === 4 ? target(parts[0]) : sender;
        if (!who) { reply('Specify a player.', 'red'); return; }
        const c = parts.slice(-3);
        const x = parseCoord(c[0], who.x), y = parseCoord(c[1], who.y), z = parseCoord(c[2], who.z);
        if (![x, y, z].every(Number.isFinite)) { reply('Invalid coordinates', 'red'); return; }
        server.teleport(who, x, y, z);
        reply(`Teleported ${who.name} to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`, 'yellow');
        return;
      }
      if (parts.length === 1) {
        const dest = target(parts[0]); if (!dest) return;
        if (!sender) { reply('Usage: /tp <player> <target>', 'red'); return; }
        server.teleport(sender, dest.x, dest.y, dest.z);
        reply(`Teleported ${sender.name} to ${dest.name}`, 'yellow');
        return;
      }
      if (parts.length === 2) {
        const who = target(parts[0]); const dest = target(parts[1]);
        if (!who || !dest) return;
        server.teleport(who, dest.x, dest.y, dest.z);
        reply(`Teleported ${who.name} to ${dest.name}`, 'yellow');
        return;
      }
      reply('Usage: ' + cmd.usage, 'red');
      return;
    }
    case 'give': {
      const p = target(parts[0]); if (!p) return;
      const id = (parts[1] || '').toLowerCase().replace(/^minecraft:|^shaftcraft:/, '');
      if (!ITEMS[id]) { reply('Unknown item: ' + (parts[1] || ''), 'red'); return; }
      let count = Math.max(1, Math.min(6400, Number(parts[2]) || 1));
      const total = count;
      while (count > 0) {
        const n = Math.min(count, ITEMS[id].maxStack);
        const rest = addToInventory(p.inv, { id, count: n });
        if (rest) server.dropItem(p, rest);
        count -= n;
      }
      p.syncInventory();
      reply(`Gave ${total} [${ITEMS[id].display}] to ${p.name}`, 'yellow');
      return;
    }
    case 'kill': {
      const p = target(parts[0]); if (!p) return;
      if (!p.alive) { reply(p.name + ' is already dead.', 'red'); return; }
      server.damagePlayer(p, 1000, 'kill', null, 0, 0, 0, true);
      reply('Killed ' + p.name, 'yellow');
      return;
    }
    case 'difficulty': {
      const d = (parts[0] || '').toLowerCase();
      if (!DIFFICULTIES.includes(d)) { reply('Usage: ' + cmd.usage, 'red'); return; }
      if (server.hardcore && d !== 'hard') { reply('Difficulty is locked to Hard in hardcore worlds.', 'red'); return; }
      server.difficulty = d;
      server.broadcast({ t: 'difficulty', d });
      reply('Set difficulty to ' + d, 'yellow');
      return;
    }
    case 'seed': reply('Seed: [' + server.seed + ']', 'green'); return;
    case 'spawnpoint': {
      let p = sender, rest = parts;
      if (parts.length === 1 || parts.length === 4) { p = target(parts[0]); rest = parts.slice(1); }
      if (!p) { reply('Specify a player.', 'red'); return; }
      let x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      if (rest.length === 3) { x = Math.floor(parseCoord(rest[0], p.x)); y = Math.floor(parseCoord(rest[1], p.y)); z = Math.floor(parseCoord(rest[2], p.z)); }
      if (![x, y, z].every(Number.isFinite)) { reply('Invalid coordinates', 'red'); return; }
      p.spawnPoint = { x, y, z, forced: true };
      reply(`Set spawn point of ${p.name} to ${x}, ${y}, ${z}`, 'yellow');
      return;
    }
    case 'clear': {
      const p = target(parts[0]); if (!p) return;
      let n = 0;
      for (const arr of [p.inv.main, p.inv.armor, p.inv.offhand]) for (let i = 0; i < arr.length; i++) { if (arr[i]) n += arr[i].count; arr[i] = null; }
      p.syncInventory();
      reply(`Removed ${n} items from ${p.name}`, 'yellow');
      return;
    }
    case 'op': case 'deop': {
      const n = parts[0];
      if (!n) { reply('Usage: ' + cmd.usage, 'red'); return; }
      server.setOp(n, name === 'op');
      reply((name === 'op' ? 'Made ' : 'Removed ') + n + (name === 'op' ? ' a server operator' : ' from operators'), 'yellow');
      return;
    }
    case 'kick': {
      const p = target(parts[0]); if (!p) return;
      server.kick(p, parts.slice(1).join(' ') || 'Kicked by an operator');
      reply('Kicked ' + p.name, 'yellow');
      return;
    }
    case 'ban': {
      const n = parts[0];
      if (!n) { reply('Usage: ' + cmd.usage, 'red'); return; }
      server.ban(n, parts.slice(1).join(' ') || 'Banned by an operator');
      reply('Banned ' + n, 'yellow');
      return;
    }
    case 'pardon': {
      const n = parts[0];
      if (!n) { reply('Usage: ' + cmd.usage, 'red'); return; }
      server.pardon(n);
      reply('Unbanned ' + n, 'yellow');
      return;
    }
    case 'save': server.save().then(() => reply('Saved the world', 'yellow')); return;
    case 'stop': server.requestStop(); reply('Stopping the server', 'yellow'); return;
    default: reply('Unknown command.', 'red');
  }
}
