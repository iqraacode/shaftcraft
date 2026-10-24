// GPU point-sprite particle system using sub-rectangles of the block atlas.
import * as THREE from 'three';
import { BLOCKS, faceTex } from '../../../shared/blocks.js';
import { lightCurve } from './EntityRenderer.js';

const MAX = 3000;

export class Particles {
  constructor(scene, atlas) {
    this.atlas = atlas;
    this.pos = new Float32Array(MAX * 3);
    this.rect = new Float32Array(MAX * 4);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.fade = new Uint8Array(MAX);
    this.collide = new Uint8Array(MAX);
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aRect = new THREE.BufferAttribute(this.rect, 4); this.aRect.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('rect', this.aRect); g.setAttribute('pcol', this.aCol); g.setAttribute('psize', this.aSize);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas.texture }, scale: { value: 600 } },
      vertexShader: `attribute vec4 rect; attribute vec4 pcol; attribute float psize; uniform float scale; varying vec4 vRect; varying vec4 vCol;
        void main(){ vRect = rect; vCol = pcol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * scale / max(0.05, -mv.z); }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vRect; varying vec4 vCol;
        void main(){ vec2 uv = mix(vRect.xy, vRect.zw, gl_PointCoord); vec4 t = texture2D(map, uv); if (t.a < 0.1) discard; gl_FragColor = vec4(t.rgb * vCol.rgb, vCol.a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.minimal = false;
    this.white = atlas.uv.white;
  }

  setScale(h, fov) { this.mat.uniforms.scale.value = h / (2 * Math.tan((fov * Math.PI) / 360)); }

  spawn(x, y, z, vx, vy, vz, life, size, rect, r, g, b, a, grav = 0, fade = 1, collide = 1) {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.rect.set(rect, i * 4);
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.fade[i] = fade; this.collide[i] = collide;
  }

  subRect(tex, rng = Math.random) {
    const uv = this.atlas.uv[tex] || this.atlas.uv.stone;
    const px = (uv[2] - uv[0]) / 16;
    const ox = Math.floor(rng() * 12), oy = Math.floor(rng() * 12);
    return [uv[0] + ox * px, uv[1] + oy * px, uv[0] + (ox + 4) * px, uv[1] + (oy + 4) * px];
  }

  whiteRect() { const u = this.white; return [u[0] + 0.001, u[1] + 0.001, u[2] - 0.001, u[3] - 0.001]; }

  bright(world, x, y, z, daylight) {
    const l = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    return Math.max(0.08, Math.max(lightCurve((l >> 4) / 15 * daylight), lightCurve((l & 15) / 15)));
  }

  tintFor(b) {
    if (!b.tint) return [1, 1, 1];
    if (b.tint === 'spruce') return [0.38, 0.6, 0.38];
    return b.tint === 'grass' ? [0.57, 0.74, 0.35] : b.tint === 'water' ? [0.25, 0.46, 0.9] : [0.47, 0.67, 0.18];
  }

  blockBreak(world, x, y, z, id, meta, daylight) {
    const b = BLOCKS[id];
    if (!b || !b.tex) return;
    const n = this.minimal ? 2 : 4;
    const br = this.bright(world, x + 0.5, y + 0.5, z + 0.5, daylight);
    const [tr, tg, tb] = this.tintFor(b);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
      const tex = faceTex(b, Math.floor(Math.random() * 6), meta);
      this.spawn(px, py, pz, (px - x - 0.5) * 3 + (Math.random() - 0.5), (py - y - 0.5) * 3 + 2 + Math.random(), (pz - z - 0.5) * 3 + (Math.random() - 0.5),
        0.5 + Math.random() * 0.6, 0.11 + Math.random() * 0.05, this.subRect(tex), br * tr, br * tg, br * tb, 1, 16, 0);
    }
  }

  blockHit(world, x, y, z, face, id, meta, daylight) {
    const b = BLOCKS[id];
    if (!b || !b.tex || this.minimal && Math.random() < 0.5) return;
    const br = this.bright(world, x + 0.5, y + 0.5, z + 0.5, daylight);
    const [tr, tg, tb] = this.tintFor(b);
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face] || [0, 1, 0];
    const px = x + 0.5 + n[0] * 0.52 + (n[0] ? 0 : (Math.random() - 0.5) * 0.9);
    const py = y + 0.5 + n[1] * 0.52 + (n[1] ? 0 : (Math.random() - 0.5) * 0.9);
    const pz = z + 0.5 + n[2] * 0.52 + (n[2] ? 0 : (Math.random() - 0.5) * 0.9);
    this.spawn(px, py, pz, n[0] * 1.5 + (Math.random() - 0.5), n[1] * 1.5 + 1, n[2] * 1.5 + (Math.random() - 0.5), 0.4, 0.08, this.subRect(faceTex(b, face, meta)), br * tr, br * tg, br * tb, 1, 16, 0);
  }

  puff(x, y, z, n, color, size = 0.25, speed = 1, life = 0.8, grav = -1) {
    const w = this.whiteRect();
    const cnt = this.minimal ? Math.ceil(n / 3) : n;
    for (let i = 0; i < cnt; i++) {
      const v = (0.7 + Math.random() * 0.3);
      this.spawn(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * speed * 2, (Math.random() - 0.5) * speed * 2, (Math.random() - 0.5) * speed * 2,
        life * (0.6 + Math.random() * 0.6), size, w, color[0] * v, color[1] * v, color[2] * v, 0.9, grav, 1, 0);
    }
  }

  explosion(x, y, z, r) {
    this.puff(x, y, z, 50, [0.8, 0.8, 0.8], 0.9, r * 2, 1.2, -0.5);
    this.puff(x, y, z, 20, [1, 0.8, 0.4], 0.5, r * 3, 0.4, 0);
  }

  firework(x, y, z, c) {
    const cols = [[1, 0.3, 0.3], [0.3, 1, 0.4], [0.4, 0.6, 1], [1, 0.9, 0.3], [1, 0.4, 1], [0.4, 1, 1]];
    const col = cols[c % cols.length];
    const w = this.whiteRect();
    const n = this.minimal ? 40 : 120;
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = 7 + Math.random() * 2;
      this.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s, Math.sin(ph) * Math.sin(th) * s, 1.4 + Math.random() * 0.5, 0.18, w, col[0], col[1], col[2], 1, 3, 1, 0);
    }
  }

  trail(x, y, z) { this.spawn(x, y, z, (Math.random() - 0.5) * 0.4, -1, (Math.random() - 0.5) * 0.4, 0.6, 0.12, this.whiteRect(), 1, 0.85, 0.6, 1, 0, 1, 0); }

  bubble(x, y, z) { this.spawn(x, y, z, (Math.random() - 0.5) * 0.3, 2, (Math.random() - 0.5) * 0.3, 0.8, 0.08, this.whiteRect(), 0.7, 0.85, 1, 0.8, -2, 1, 0); }

  splash(x, y, z, n = 12) {
    const w = this.whiteRect();
    for (let i = 0; i < (this.minimal ? 4 : n); i++) this.spawn(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.6, 0.09, w, 0.6, 0.75, 1, 0.9, 20, 1, 1);
  }

  crumbs(x, y, z, color) {
    const w = this.whiteRect();
    for (let i = 0; i < (this.minimal ? 2 : 5); i++) this.spawn(x, y, z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.5, 0.07, w, color[0], color[1], color[2], 1, 16, 0, 1);
  }

  crit(x, y, z) { this.puff(x, y, z, 14, [1, 0.95, 0.6], 0.12, 3, 0.5, 4); }
  sparkle(x, y, z) { this.puff(x, y, z, 12, [0.5, 1, 0.5], 0.1, 1, 1, -0.5); }
  smoke(x, y, z) { this.spawn(x, y, z, (Math.random() - 0.5) * 0.2, 0.6, (Math.random() - 0.5) * 0.2, 1.2, 0.14, this.whiteRect(), 0.4, 0.4, 0.4, 0.6, -0.5, 1, 0); }
  flame(x, y, z) { this.spawn(x, y, z, 0, 0.3, 0, 0.5, 0.07, this.whiteRect(), 1, 0.7, 0.2, 1, -0.2, 1, 0); }

  update(dt, world) {
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      // compact
      if (w !== i) {
        this.pos[w * 3] = this.pos[i * 3]; this.pos[w * 3 + 1] = this.pos[i * 3 + 1]; this.pos[w * 3 + 2] = this.pos[i * 3 + 2];
        this.vel[w * 3] = this.vel[i * 3]; this.vel[w * 3 + 1] = this.vel[i * 3 + 1]; this.vel[w * 3 + 2] = this.vel[i * 3 + 2];
        for (let k = 0; k < 4; k++) { this.rect[w * 4 + k] = this.rect[i * 4 + k]; this.col[w * 4 + k] = this.col[i * 4 + k]; }
        this.size[w] = this.size[i]; this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.grav[w] = this.grav[i]; this.fade[w] = this.fade[i]; this.collide[w] = this.collide[i];
      }
      this.vel[w * 3 + 1] -= this.grav[w] * dt;
      const drag = Math.pow(0.4, dt);
      this.vel[w * 3] *= drag; this.vel[w * 3 + 2] *= drag;
      let nx = this.pos[w * 3] + this.vel[w * 3] * dt, ny = this.pos[w * 3 + 1] + this.vel[w * 3 + 1] * dt, nz = this.pos[w * 3 + 2] + this.vel[w * 3 + 2] * dt;
      if (this.collide[w] && world) {
        const id = world.getBlockRaw(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && (id !== 255) && BLOCKS[id] && BLOCKS[id].full) { ny = this.pos[w * 3 + 1]; this.vel[w * 3 + 1] = 0; this.vel[w * 3] *= 0.5; this.vel[w * 3 + 2] *= 0.5; nx = this.pos[w * 3]; nz = this.pos[w * 3 + 2]; }
      }
      this.pos[w * 3] = nx; this.pos[w * 3 + 1] = ny; this.pos[w * 3 + 2] = nz;
      if (this.fade[w]) this.col[w * 4 + 3] = Math.min(1, this.life[w] / this.maxLife[w] * 2);
      w++;
    }
    this.count = w;
    this.points.geometry.setDrawRange(0, w);
    this.aPos.needsUpdate = true; this.aRect.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }

  clear() { this.count = 0; this.points.geometry.setDrawRange(0, 0); }
}
