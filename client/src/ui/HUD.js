// Canvas HUD: crosshair, hotbar, hearts, hunger, armor, air, attack indicator, item name,
// glider readout, chat, debug overlay (F3), player list (Tab) and screen overlays.
import { GUI } from './guitex.js';
import { getIcon } from '../textures/icons.js';
import { ITEMS } from '../../../shared/items.js';
import { MAX_AIR_TICKS, GLIDER_DURABILITY } from '../../../shared/constants.js';

const COLORS = { white: '#ffffff', yellow: '#ffff55', gray: '#aaaaaa', red: '#ff5555', green: '#55ff55', aqua: '#55ffff' };

export class HUD {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.visible = true;
    this.flash = 0;
    this.regen = 0;
    this.vignette = 0;
    this.scale = 2;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  setScale(s) { this.scale = s; }
  onDamage() { this.flash = 10; this.vignette = 1; }
  onHeal() { this.regen = 20; }

  text(str, x, y, color = '#fff', align = 'left', shadow = true, size = 8) {
    const ctx = this.ctx;
    ctx.font = `${size}px "Pixelify Sans", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (shadow) { ctx.fillStyle = '#3f3f3f'; ctx.fillText(str, x + size / 8, y + size / 8); }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  item(stack, x, y) {
    if (!stack) return;
    const ctx = this.ctx;
    ctx.drawImage(getIcon(stack.id), x, y, 16, 16);
    const it = ITEMS[stack.id];
    if (it && it.durability && stack.dmg) {
      const k = Math.max(0, 1 - stack.dmg / it.durability);
      ctx.fillStyle = '#000'; ctx.fillRect(x + 2, y + 13, 13, 2);
      ctx.fillStyle = `hsl(${Math.round(k * 120)},100%,50%)`; ctx.fillRect(x + 2, y + 13, Math.max(1, Math.round(13 * k)), 1);
    }
    if (stack.count > 1) this.text(String(stack.count), x + 17, y + 9, '#fff', 'right');
  }

  draw(game, dt) {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!game || !game.ready) return;
    this.time += dt;
    const k = s * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const W = Math.floor(this.canvas.width / k), H = Math.floor(this.canvas.height / k);
    const st = game.status;
    if (this.flash > 0) this.flash -= dt * 20;
    if (this.regen > 0) this.regen -= dt * 20;
    if (this.vignette > 0) this.vignette = Math.max(0, this.vignette - dt * 2);

    // ---- full-screen overlays ----
    if (game.underwater) { ctx.fillStyle = 'rgba(20,50,140,0.28)'; ctx.fillRect(0, 0, W, H); }
    if (game.inPortal) { ctx.fillStyle = `rgba(150,40,220,${0.35 + Math.sin(this.time * 4) * 0.1})`; ctx.fillRect(0, 0, W, H); }
    if (game.inLava) { ctx.fillStyle = 'rgba(255,90,10,0.55)'; ctx.fillRect(0, 0, W, H); }
    if (st.fire && game.cameraMode === 0 && game.gamemode !== 'creative' && game.gamemode !== 'spectator') this.drawFire(W, H);
    if (this.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, `rgba(160,0,0,${0.55 * this.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (game.sleeping) { ctx.fillStyle = 'rgba(8,8,24,0.75)'; ctx.fillRect(0, 0, W, H); }
    if (!this.visible) return;

    const spectator = game.gamemode === 'spectator';
    const survival = game.gamemode === 'survival';
    const cx = Math.floor(W / 2), hb = cx - 91;

    // ---- crosshair ----
    if (game.alive && !game.sleeping && game.cameraMode === 0 && !game.debug) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 4, Math.floor(H / 2), 9, 1);
      ctx.fillRect(cx, Math.floor(H / 2) - 4, 1, 4); ctx.fillRect(cx, Math.floor(H / 2) + 1, 1, 4);
      ctx.globalCompositeOperation = 'source-over';
      // attack indicator
      if (!spectator) {
        const ch = game.attackCharge();
        if (ch < 1) {
          const y = Math.floor(H / 2) + 9;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 8, y, 16, 3);
          ctx.fillStyle = '#e8e8e8'; ctx.fillRect(cx - 7, y + 1, Math.round(14 * ch), 1);
        }
      }
    } else if (game.debug && game.alive) {
      // F3 axis crosshair
      ctx.fillStyle = '#ff4040'; ctx.fillRect(cx, Math.floor(H / 2), 6, 1);
      ctx.fillStyle = '#40ff40'; ctx.fillRect(cx, Math.floor(H / 2) - 6, 1, 6);
      ctx.fillStyle = '#4040ff'; ctx.fillRect(cx - 4, Math.floor(H / 2) + 1, 1, 4);
    }

    if (!spectator && game.alive) {
      // ---- hotbar ----
      ctx.drawImage(GUI.hotbar, hb, H - 22);
      ctx.drawImage(GUI.hotbarSel, hb - 1 + game.inv.selected * 20, H - 23);
      for (let i = 0; i < 9; i++) this.item(game.inv.main[i], hb + 3 + i * 20, H - 19);
      const off = game.inv.offhand[0];
      if (off) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(hb - 29, H - 23, 22, 22);
        ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1; ctx.strokeRect(hb - 28.5, H - 22.5, 21, 21);
        this.item(off, hb - 26, H - 19);
      }
      if (survival) this.drawStatus(game, hb, H);
      // held item name
      if (game.cameraToast > 0) {
        ctx.globalAlpha = Math.min(1, game.cameraToast * 2);
        this.text('Camera: ' + game.cameraModeName(), cx, Math.floor(H / 2) - 40, '#ffffff', 'center');
        ctx.globalAlpha = 1;
      }
      if (game.heldNameTimer > 0) {
        const held = game.held();
        if (held) {
          const a = Math.min(1, game.heldNameTimer * 2);
          ctx.globalAlpha = a;
          this.text(ITEMS[held.id] ? ITEMS[held.id].display : held.id, cx, H - (survival ? 59 : 38), '#fff', 'center');
          ctx.globalAlpha = 1;
        }
      }
      // glider readout
      if (game.player.gliding) {
        const p = game.player;
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        const wings = game.inv.armor[1];
        const left = wings ? GLIDER_DURABILITY - (wings.dmg || 0) : 0;
        this.text(`Airspeed ${sp.toFixed(1)} m/s  |  Wings ${left}/${GLIDER_DURABILITY}`, cx, game.debug ? 130 : 6, '#e0e0ff', 'center');
      }
    }

    for (const v of this.app.renderer.entities.views.values()) {
      if (v.type !== 'ender_dragon' || v.death >= 0 || Math.hypot(v.x - game.player.x, v.z - game.player.z) > 200) continue;
      const hp = v.extra || v.data.hp || 0, max = v.data.maxHp || 200, bw = 182, bx = cx - 91;
      this.text('Ender Dragon', cx, 3, '#ffffff', 'center');
      ctx.fillStyle = '#3a0a3a'; ctx.fillRect(bx, 13, bw, 5);
      ctx.fillStyle = '#e040e0'; ctx.fillRect(bx, 13, Math.round(bw * Math.max(0, hp) / max), 5);
      break;
    }
    this.drawChat(game, W, H);
    if (game.debug) this.drawDebug(game, W);
    if (this.app.input.isDown('playerList') && !this.app.ui.capturesInput()) this.drawPlayerList(game, W);
  }

  drawStatus(game, hb, H) {
    const ctx = this.ctx;
    const st = game.status;
    const tick = Math.floor(this.time * 20);
    const hardcore = game.hardcore;
    // hearts
    const hp = st.hp;
    const lowShake = hp <= 4;
    for (let i = 0; i < 10; i++) {
      let x = hb + i * 8, y = H - 39;
      if (lowShake) y += Math.floor(Math.random() * 2);
      if (this.regen > 0 && i === Math.floor(tick / 2) % 15) y -= 2;
      const flashOn = this.flash > 0 && Math.floor(this.flash / 3) % 2 === 0;
      ctx.drawImage(flashOn ? GUI.heartEmptyFlash : GUI.heartEmpty, x, y);
      if (hp >= i * 2 + 2) ctx.drawImage(hardcore ? GUI.heartHcFull : GUI.heartFull, x, y);
      else if (hp > i * 2) ctx.drawImage(hardcore ? GUI.heartHcHalf : GUI.heartHalf, x, y);
    }
    // armor
    const ar = st.armor;
    if (ar > 0) {
      for (let i = 0; i < 10; i++) {
        const x = hb + i * 8, y = H - 49;
        ctx.drawImage(ar >= i * 2 + 2 ? GUI.armorFull : ar > i * 2 ? GUI.armorHalf : GUI.armorEmpty, x, y);
      }
    }
    // food (right to left)
    const food = st.food;
    for (let i = 0; i < 10; i++) {
      const x = hb + 182 - 9 - i * 8;
      let y = H - 39;
      if (st.sat <= 0 && tick % (food * 3 + 1) === 0) y += Math.floor(Math.random() * 3) - 1;
      ctx.drawImage(GUI.foodEmpty, x, y);
      if (food >= i * 2 + 2) ctx.drawImage(GUI.foodFull, x, y);
      else if (food > i * 2) ctx.drawImage(GUI.foodHalf, x, y);
    }
    // air bubbles
    if (st.air < MAX_AIR_TICKS || game.player.headInWater) {
      const full = Math.ceil((Math.max(0, st.air) - 2) * 10 / MAX_AIR_TICKS);
      const partial = Math.ceil(Math.max(0, st.air) * 10 / MAX_AIR_TICKS) - full;
      for (let i = 0; i < full + partial; i++) {
        const x = hb + 182 - 9 - i * 8;
        ctx.drawImage(i < full ? GUI.bubble : GUI.bubblePop, x, H - 49);
      }
    }
  }

  drawFire(W, H) {
    const ctx = this.ctx;
    const t = this.time;
    for (let i = 0; i < 26; i++) {
      const x = (i / 25) * W;
      const h = H * (0.18 + 0.1 * Math.sin(t * 7 + i * 1.7) + 0.06 * Math.sin(t * 13 + i * 0.7));
      const g = ctx.createLinearGradient(0, H, 0, H - h);
      g.addColorStop(0, 'rgba(255,90,0,0.75)'); g.addColorStop(0.6, 'rgba(255,190,40,0.55)'); g.addColorStop(1, 'rgba(255,240,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - W / 30, H); ctx.quadraticCurveTo(x - W / 60, H - h * 0.5, x, H - h); ctx.quadraticCurveTo(x + W / 60, H - h * 0.5, x + W / 30, H);
      ctx.fill();
    }
  }

  drawChat(game, W, H) {
    const ctx = this.ctx;
    const open = this.app.ui.chatOpen;
    const opacity = this.app.options.get('chatOpacity') / 100;
    const scale = this.app.options.get('chatScale') / 100;
    const size = 8 * scale;
    const lineH = 9 * scale;
    const width = Math.min(320, W - 4);
    const now = performance.now();
    const maxLines = open ? 20 : 10;
    const lines = [];
    ctx.font = `${size}px "Pixelify Sans", monospace`;
    for (let i = game.chat.length - 1; i >= 0 && lines.length < maxLines; i--) {
      const m = game.chat[i];
      const age = (now - m.time) / 1000;
      if (!open && age > 10) break;
      const alpha = open ? 1 : Math.min(1, (10 - age) / 1);
      // wrap
      const words = m.text.split(' ');
      const wrapped = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (ctx.measureText(test).width > width - 4 && cur) { wrapped.push(cur); cur = w; } else cur = test;
      }
      if (cur) wrapped.push(cur);
      for (let j = wrapped.length - 1; j >= 0; j--) lines.push({ text: wrapped[j], color: COLORS[m.color] || m.color || '#fff', alpha });
    }
    const base = H - (open ? 16 : 48) * Math.max(1, scale * 0.9);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const y = base - (i + 1) * lineH;
      ctx.globalAlpha = l.alpha * opacity;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(2, y, width, lineH);
      ctx.globalAlpha = l.alpha * Math.max(0.2, opacity);
      this.text(l.text, 4, y + 0.5, l.color, 'left', true, size);
    }
    ctx.globalAlpha = 1;
  }

  drawDebug(game, W) {
    const ctx = this.ctx;
    const { left, right } = game.debugInfo();
    ctx.font = '8px "Pixelify Sans", monospace';
    left.forEach((t, i) => {
      if (!t) return;
      const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(80,80,80,0.55)'; ctx.fillRect(1, 1 + i * 9, w + 3, 9);
      this.text(t, 2, 2 + i * 9, '#e0e0e0', 'left', false);
    });
    right.forEach((t, i) => {
      if (!t) return;
      const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(80,80,80,0.55)'; ctx.fillRect(W - w - 4, 1 + i * 9, w + 3, 9);
      this.text(t, W - 2, 2 + i * 9, '#e0e0e0', 'right', false);
    });
  }

  drawPlayerList(game, W) {
    const ctx = this.ctx;
    const list = game.players;
    const w = 160, rowH = 9;
    const x = Math.floor(W / 2 - w / 2), y = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 2, y - 2, w + 4, (list.length + 1) * rowH + 4);
    this.text(`Players online: ${list.length}/${game.maxPlayers || list.length}`, W / 2, y, '#ffff55', 'center');
    list.forEach((p, i) => {
      const ry = y + (i + 1) * rowH;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, ry, w, rowH - 1);
      this.text(p.name + (p.fullName ? ` (${p.fullName})` : '') + (p.mode === 'spectator' ? ' (spectating)' : ''), x + 2, ry, p.mode === 'spectator' ? '#aaaaaa' : '#ffffff');
      const bars = p.ping < 150 ? 5 : p.ping < 300 ? 4 : p.ping < 600 ? 3 : p.ping < 1000 ? 2 : 1;
      for (let b = 0; b < 5; b++) {
        ctx.fillStyle = b < bars ? '#55ff55' : '#333';
        ctx.fillRect(x + w - 12 + b * 2, ry + 6 - b, 1, b + 2);
      }
      this.text(game.sp ? '' : `${p.ping}ms`, x + w - 15, ry, '#aaaaaa', 'right');
    });
  }
}
