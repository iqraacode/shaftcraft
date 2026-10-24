// Web Audio synthesizer: every sound is generated from oscillators and filtered noise.
// Categories map to gain nodes driven by the Audio options sliders.

const CATEGORY = (name) => {
  if (name === 'click') return 'ui';
  if (/^(pig|cow|sheep|chicken|zombie|skeleton|creeper|spider|villager|enderman|ender|end)_/.test(name)) return 'mobs';
  if (name === 'thunder' || name === 'cave' || name === 'rain') return 'ambient';
  return 'blocks';
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 1, music: 0.5, blocks: 1, mobs: 1, ambient: 1, ui: 1 };
    this.listener = { x: 0, y: 0, z: 0 };
    this.musicTimer = 30;
    this.caveTimer = 40;
    this.underwater = false;
  }

  // Must be called from a user gesture.
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);
    this.bus = {};
    for (const k of ['music', 'blocks', 'mobs', 'ambient', 'ui']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(k === 'ui' || k === 'music' ? ctx.destination : this.master); }
    // ui & music bypass the underwater muffle but still respect master volume via their own gain scaling
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb impulse for music
    const ir = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.5); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.reverb.connect(this.bus.music);
    this.applyVolumes();
    this.rainGain = this.loopNoise('bandpass', 2800, 0.6, this.bus.ambient);
    this.windGain = this.loopNoise('lowpass', 700, 0.7, this.bus.blocks);
    return true;
  }

  setVolumes(v) { Object.assign(this.volumes, v); this.applyVolumes(); }

  applyVolumes() {
    if (!this.ctx) return;
    const m = this.volumes.master;
    this.master.gain.value = m;
    this.bus.music.gain.value = this.volumes.music * m * 0.6;
    this.bus.blocks.gain.value = this.volumes.blocks;
    this.bus.mobs.gain.value = this.volumes.mobs;
    this.bus.ambient.gain.value = this.volumes.ambient;
    this.bus.ui.gain.value = this.volumes.ui * m;
  }

  setListener(pos, forward) {
    this.listener = pos;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t); l.forwardY.setValueAtTime(forward.y, t); l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setUnderwater(on) {
    if (!this.ctx || on === this.underwater) return;
    this.underwater = on;
    this.muffle.frequency.setTargetAtTime(on ? 500 : 20000, this.ctx.currentTime, 0.08);
  }

  loopNoise(type, freq, q, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    src.start();
    return g;
  }

  setRain(level) { if (this.ctx) this.rainGain.gain.setTargetAtTime(level * 0.25, this.ctx.currentTime, 0.3); }
  setWind(level) { if (this.ctx) this.windGain.gain.setTargetAtTime(Math.min(1, level) * 0.35, this.ctx.currentTime, 0.15); }

  // ---- building blocks ----
  out(cat, opts) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    if (opts.x !== undefined) {
      const dx = opts.x - this.listener.x, dy = opts.y - this.listener.y, dz = opts.z - this.listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxD = opts.range || 24;
      if (dist > maxD) return null;
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = maxD; p.rolloffFactor = 1;
      if (p.positionX) { p.positionX.value = opts.x; p.positionY.value = opts.y; p.positionZ.value = opts.z; } else p.setPosition(opts.x, opts.y, opts.z);
      g.connect(p).connect(this.bus[cat]);
    } else g.connect(this.bus[cat]);
    return g;
  }

  nz(dest, t0, dur, type, freq, q, gain, rate = 1, attack = 0.003) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5, dur + 0.05);
    return f;
  }

  osc(dest, t0, dur, type, f0, f1, gain, attack = 0.005, filt = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filt) { const f = ctx.createBiquadFilter(); f.type = filt[0]; f.frequency.value = filt[1]; f.Q.value = filt[2] || 1; o.connect(f); node = f; }
    node.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  vibrato(o, t0, rate, depth) {
    const ctx = this.ctx;
    const l = ctx.createOscillator(); l.frequency.value = rate;
    const g = ctx.createGain(); g.gain.value = depth;
    l.connect(g).connect(o.frequency);
    l.start(t0); l.stop(t0 + 2);
  }

  // ---- public ----
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const cat = CATEGORY(name);
    const dest = this.out(cat, opts);
    if (!dest) return;
    const t = this.ctx.currentTime + 0.005;
    const pitch = opts.pitch || 1;
    const r = () => 0.85 + Math.random() * 0.3;
    const [kind, mat] = name.split(':');
    if (mat) return this.material(dest, t, kind, mat, pitch);
    switch (name) {
      case 'click': this.osc(dest, t, 0.05, 'square', 900, 700, 0.12); break;
      case 'pop': this.osc(dest, t, 0.07, 'sine', 500 * pitch, 1100 * pitch, 0.25); break;
      case 'player_hurt': this.nz(dest, t, 0.18, 'lowpass', 900, 1, 0.5); this.osc(dest, t, 0.18, 'triangle', 240, 150, 0.35); break;
      case 'fall_small': this.nz(dest, t, 0.12, 'lowpass', 500, 1, 0.5); break;
      case 'fall_big': this.nz(dest, t, 0.3, 'lowpass', 300, 1, 0.8); this.osc(dest, t, 0.2, 'sine', 90, 50, 0.6); break;
      case 'explode':
        this.nz(dest, t, 1.8, 'lowpass', 380, 0.7, 1.4, 0.6, 0.01);
        this.osc(dest, t, 0.6, 'sine', 70, 30, 1.0, 0.01);
        this.nz(dest, t + 0.05, 0.6, 'bandpass', 1200, 0.5, 0.3);
        break;
      case 'bow_shoot': { const f = this.nz(dest, t, 0.25, 'bandpass', 2000, 2, 0.4); f.frequency.exponentialRampToValueAtTime(600, t + 0.25); this.osc(dest, t, 0.15, 'triangle', 320 * pitch, 260 * pitch, 0.2); break; }
      case 'arrow_hit': this.nz(dest, t, 0.08, 'bandpass', 1800, 1.5, 0.4); this.osc(dest, t, 0.06, 'square', 400, 300, 0.08); break;
      case 'eat': this.nz(dest, t, 0.08, 'bandpass', 1400 * r(), 1.2, 0.35); this.nz(dest, t + 0.06, 0.06, 'bandpass', 1100 * r(), 1.2, 0.25); break;
      case 'burp': { const o = this.osc(dest, t, 0.35, 'sawtooth', 110, 80, 0.25, 0.02, ['lowpass', 500, 3]); this.vibrato(o, t, 25, 20); break; }
      case 'drink': this.osc(dest, t, 0.1, 'sine', 300 * r(), 500, 0.2); break;
      case 'drink_done': this.osc(dest, t, 0.25, 'sine', 400, 250, 0.2); break;
      case 'door_open': case 'door_close':
        this.osc(dest, t, 0.25, 'sawtooth', name === 'door_open' ? 180 : 220, name === 'door_open' ? 260 : 140, 0.08, 0.02, ['bandpass', 600, 4]);
        this.nz(dest, t + (name === 'door_close' ? 0.15 : 0), 0.1, 'bandpass', 500, 1.5, 0.4);
        break;
      case 'door_bang': this.nz(dest, t, 0.15, 'bandpass', 300, 1.5, 0.8); this.osc(dest, t, 0.1, 'sine', 120, 80, 0.4); break;
      case 'chest_open': this.osc(dest, t, 0.35, 'sawtooth', 150, 210, 0.07, 0.03, ['bandpass', 500, 5]); this.nz(dest, t + 0.25, 0.08, 'bandpass', 400, 1, 0.3); break;
      case 'splash': { const f = this.nz(dest, t, 0.5, 'lowpass', 3000, 0.7, 0.5); f.frequency.exponentialRampToValueAtTime(400, t + 0.5); break; }
      case 'swim': this.nz(dest, t, 0.25, 'lowpass', 1500 * r(), 0.7, 0.15); break;
      case 'item_break': this.nz(dest, t, 0.15, 'highpass', 2500, 1, 0.4); this.osc(dest, t, 0.1, 'square', 800, 300, 0.15); break;
      case 'equip': this.nz(dest, t, 0.15, 'bandpass', 2500, 2, 0.3); this.osc(dest, t, 0.12, 'triangle', 600, 900, 0.1); break;
      case 'bucket_fill': case 'bucket_empty': { const f = this.nz(dest, t, 0.4, 'bandpass', name === 'bucket_fill' ? 600 : 1500, 2, 0.4); f.frequency.exponentialRampToValueAtTime(name === 'bucket_fill' ? 1500 : 500, t + 0.4); break; }
      case 'bucket_fill_lava': case 'bucket_empty_lava': this.nz(dest, t, 0.5, 'lowpass', 400, 1, 0.5); this.osc(dest, t, 0.4, 'sine', 80, 60, 0.3); break;
      case 'fizz': { const f = this.nz(dest, t, 0.6, 'highpass', 3000, 0.7, 0.4); void f; break; }
      case 'milk': this.osc(dest, t, 0.2, 'sine', 500, 700, 0.15); this.nz(dest, t, 0.3, 'bandpass', 800, 1, 0.2); break;
      case 'shear': this.nz(dest, t, 0.06, 'highpass', 4000, 1, 0.4); this.nz(dest, t + 0.08, 0.06, 'highpass', 4500, 1, 0.4); break;
      case 'throw': { const f = this.nz(dest, t, 0.2, 'bandpass', 1200, 2, 0.3); f.frequency.exponentialRampToValueAtTime(2500, t + 0.2); break; }
      case 'firework_launch': { const f = this.nz(dest, t, 0.9, 'bandpass', 800, 1.5, 0.5); f.frequency.exponentialRampToValueAtTime(3000, t + 0.9); break; }
      case 'firework_blast':
        this.nz(dest, t, 0.6, 'lowpass', 900, 0.7, 1.0, 0.8, 0.005);
        for (let i = 0; i < 10; i++) this.nz(dest, t + 0.3 + Math.random() * 0.8, 0.04, 'highpass', 3000, 1, 0.3);
        break;
      case 'glider_open': this.nz(dest, t, 0.35, 'bandpass', 900, 1.5, 0.3); break;
      case 'attack_weak': this.nz(dest, t, 0.08, 'bandpass', 800, 1, 0.3); break;
      case 'attack_strong': this.nz(dest, t, 0.12, 'bandpass', 600, 1, 0.5); this.osc(dest, t, 0.08, 'sine', 160, 90, 0.3); break;
      case 'attack_crit': this.nz(dest, t, 0.15, 'bandpass', 1200, 2, 0.6); this.osc(dest, t, 0.12, 'square', 300, 900, 0.12); break;
      case 'thunder': {
        const f = this.nz(dest, t, 3.2, 'lowpass', 300, 0.5, 1.2, 0.5, 0.05);
        f.frequency.exponentialRampToValueAtTime(80, t + 3);
        this.nz(dest, t + 0.4, 2.5, 'lowpass', 150, 0.5, 0.8, 0.4, 0.3);
        break;
      }
      case 'portal_light': { const f = this.nz(dest, t, 0.6, 'bandpass', 600, 2, 0.5); f.frequency.exponentialRampToValueAtTime(2400, t + 0.6); break; }
      case 'portal_travel': { const o = this.osc(dest, t, 1.6, 'sawtooth', 90, 300, 0.25, 0.2, ['lowpass', 900, 2]); this.vibrato(o, t, 6, 20); this.nz(dest, t, 1.4, 'bandpass', 1200, 1, 0.2, 0.6, 0.3); break; }
      case 'chicken_plop': this.osc(dest, t, 0.08, 'sine', 300, 150, 0.4); break;
      case 'cave': {
        const base = 60 + Math.random() * 60;
        const o1 = this.osc(dest, t, 4, 'sine', base, base * 0.8, 0.25, 1.5); this.vibrato(o1, t, 0.5, 3);
        this.osc(dest, t + 0.5, 3.5, 'sine', base * 1.5 + 3, base * 1.2, 0.12, 1.2);
        this.nz(dest, t, 3, 'bandpass', 300, 3, 0.08, 0.5, 1);
        break;
      }
      default: this.mob(dest, t, name, pitch);
    }
  }

  material(dest, t, kind, mat, pitch) {
    const step = kind === 'step';
    const hit = kind === 'hit';
    const v = step ? 0.22 : hit ? 0.3 : kind === 'place' ? 0.55 : 0.7;
    const d = step ? 0.07 : hit ? 0.06 : 0.16;
    const r = () => 0.85 + Math.random() * 0.3;
    switch (mat) {
      case 'stone': case 'metal':
        this.nz(dest, t, d * 1.2, 'bandpass', 1300 * r() * pitch, 1.1, v);
        if (!step) this.nz(dest, t + 0.03, d, 'bandpass', 700 * r(), 1, v * 0.6);
        if (mat === 'metal') this.osc(dest, t, 0.3, 'sine', 1400 * r(), 1300, v * 0.15);
        break;
      case 'grass': for (let i = 0; i < (step ? 2 : 4); i++) this.nz(dest, t + i * 0.025, 0.05, 'highpass', 2600 * r(), 0.8, v * 0.7); break;
      case 'dirt': this.nz(dest, t, d * 1.3, 'lowpass', 900 * r(), 0.8, v); break;
      case 'gravel': for (let i = 0; i < (step ? 2 : 4); i++) this.nz(dest, t + i * 0.03, 0.06, 'bandpass', 900 * r(), 1, v * 0.8); break;
      case 'wood': this.nz(dest, t, d, 'bandpass', 420 * r() * pitch, 2, v); this.osc(dest, t, d, 'sine', 190 * r(), 150, v * 0.5); break;
      case 'sand': this.nz(dest, t, d * 1.4, 'highpass', 3000 * r(), 0.6, v * 0.6); break;
      case 'snow': for (let i = 0; i < 3; i++) this.nz(dest, t + i * 0.03, 0.05, 'lowpass', 2200 * r(), 1, v * 0.6); break;
      case 'cloth': this.nz(dest, t, d, 'lowpass', 1100 * r(), 0.7, v * 0.7); break;
      case 'glass':
        if (kind === 'break') { for (let i = 0; i < 6; i++) this.osc(dest, t + Math.random() * 0.15, 0.25, 'sine', 2000 + Math.random() * 3000, 1800, 0.12); this.nz(dest, t, 0.3, 'highpass', 4000, 1, 0.5); }
        else this.nz(dest, t, d, 'bandpass', 2500 * r(), 2, v * 0.6);
        break;
      case 'water': { const f = this.nz(dest, t, 0.3, 'lowpass', 2000, 0.7, v * 0.5); f.frequency.exponentialRampToValueAtTime(500, t + 0.3); break; }
      default: this.nz(dest, t, d, 'bandpass', 1000 * r(), 1, v);
    }
  }

  mob(dest, t, name, pitch) {
    const [type, act] = name.split('_');
    const hurt = act === 'hurt', death = act === 'death';
    const p = pitch * (hurt ? 1.3 : death ? 0.8 : 1) * (0.92 + Math.random() * 0.16);
    const dur = death ? 1.4 : 1;
    switch (type) {
      case 'pig': {
        for (let i = 0; i < (hurt ? 1 : 2); i++) this.osc(dest, t + i * 0.18, 0.16 * dur, 'sawtooth', 200 * p, 130 * p, 0.25, 0.01, ['lowpass', 900, 4]);
        break;
      }
      case 'cow': { const o = this.osc(dest, t, (hurt ? 0.4 : 0.9) * dur, 'sawtooth', 130 * p, 105 * p, 0.25, 0.08, ['bandpass', 520, 2]); this.vibrato(o, t, 5, 4); break; }
      case 'sheep': { const o = this.osc(dest, t, (hurt ? 0.3 : 0.6) * dur, 'sawtooth', 320 * p, 290 * p, 0.2, 0.04, ['bandpass', 1000, 3]); this.vibrato(o, t, 9, 25); break; }
      case 'chicken': for (let i = 0; i < (hurt ? 2 : 3); i++) this.osc(dest, t + i * 0.09, 0.06, 'square', 780 * p, 520 * p, 0.08, 0.005, ['bandpass', 1500, 2]); break;
      case 'zombie': { const o = this.osc(dest, t, (hurt ? 0.4 : 1.0) * dur, 'sawtooth', 95 * p, (death ? 50 : 80) * p, 0.25, 0.1, ['lowpass', 500, 3]); this.vibrato(o, t, 7, 6); this.nz(dest, t, 0.6 * dur, 'lowpass', 500, 1, 0.1, 0.7, 0.1); break; }
      case 'skeleton': for (let i = 0; i < 7; i++) this.nz(dest, t + i * 0.045, 0.03, 'highpass', 3200 * p, 1, 0.25); if (hurt || death) this.osc(dest, t, 0.2, 'square', 500 * p, 300 * p, 0.06); break;
      case 'creeper':
        if (act === 'hiss') { const g = this.nz(dest, t, 1.5, 'highpass', 1800, 0.5, 0.7, 1, 1.2); void g; }
        else this.nz(dest, t, 0.25 * dur, 'bandpass', 900 * p, 1, 0.4);
        break;
      case 'enderman': { const o = this.osc(dest, t, act === 'teleport' ? 0.5 : 0.7, 'sawtooth', 70 * p, act === 'teleport' ? 300 : 50 * p, 0.25, 0.05, ['lowpass', 700, 4]); this.vibrato(o, t, 13, 15); break; }
      case 'ender': { const o = this.osc(dest, t, act === 'death' ? 4 : 1.6, 'sawtooth', 55 * p, 35, 0.6, 0.1, ['lowpass', 500, 3]); this.vibrato(o, t, 8, 10); this.nz(dest, t, act === 'death' ? 4 : 1.4, 'lowpass', 400, 0.7, 0.5, 0.5, 0.2); break; }
      case 'end': this.nz(dest, t, 0.3, 'highpass', 2500, 1, 0.4); break;
      case 'villager': { const o = this.osc(dest, t, act === 'yes' ? 0.35 : 0.5, 'sawtooth', 210 * p, act === 'yes' ? 260 * p : 170 * p, 0.18, 0.03, ['bandpass', 800, 3]); this.vibrato(o, t, 6, 8); break; }
      case 'spider': { const f = this.nz(dest, t, 0.45 * dur, 'bandpass', 2600 * p, 3, 0.35, 1, 0.02); void f; for (let i = 0; i < 6; i++) this.nz(dest, t + i * 0.05, 0.03, 'highpass', 4000, 1, 0.12); break; }
      default:
    }
  }

  // Called every frame with game state for music / cave ambience.
  tickAmbient(dt, state) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.volumes.music > 0) {
      this.musicTimer -= dt;
      if (this.musicTimer <= 0) { this.playMusic(); this.musicTimer = 120 + Math.random() * 180; }
    }
    if (state.underground) {
      this.caveTimer -= dt;
      if (this.caveTimer <= 0) { this.play('cave', { volume: 0.6 }); this.caveTimer = 50 + Math.random() * 90; }
    }
  }

  playMusic() {
    const ctx = this.ctx;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    const root = 196 * Math.pow(2, Math.floor(Math.random() * 5) / 12);
    const t0 = ctx.currentTime + 0.5;
    const notes = 28 + Math.floor(Math.random() * 14);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const deg = scale[Math.floor(Math.random() * scale.length)];
      const f = root * Math.pow(2, deg / 12);
      const dur = 2.5 + Math.random() * 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.001;
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      o.connect(g); o2.connect(g2).connect(g);
      g.connect(this.reverb);
      g.connect(this.bus.music);
      o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
      if (Math.random() < 0.3) {
        // soft chord pad
        for (const k of [0, 4, 7]) {
          const pd = ctx.createOscillator(); pd.type = 'sine'; pd.frequency.value = root / 2 * Math.pow(2, k / 12);
          const pg = ctx.createGain();
          pg.gain.setValueAtTime(0.0001, t); pg.gain.linearRampToValueAtTime(0.03, t + 1.5); pg.gain.exponentialRampToValueAtTime(0.0001, t + 6);
          pd.connect(pg).connect(this.reverb);
          pd.start(t); pd.stop(t + 6.2);
        }
      }
      t += 0.8 + Math.random() * 1.6;
    }
  }
}
