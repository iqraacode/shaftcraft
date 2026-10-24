// Sky dome with day/night/sunset gradient, sun and phased moon quads, twinkling stars,
// and a scrolling voxel cloud layer (Off / Fast / Fancy).
import * as THREE from 'three';
import * as C from '../../../shared/constants.js';
import { Simplex, mulberry32 } from '../../../shared/noise.js';

const DAY_TOP = new THREE.Color(0x6f9cf0), DAY_HOR = new THREE.Color(0xb9d3ff);
const NIGHT_TOP = new THREE.Color(0x02040c), NIGHT_HOR = new THREE.Color(0x0a1022);
const SUNSET = new THREE.Color(0xff8040), SUNSET_PINK = new THREE.Color(0xff6a7a);
const RAIN_TOP = new THREE.Color(0x5d646f), RAIN_HOR = new THREE.Color(0x868d98);

function pixelCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.flipY = false;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = -10;
    scene.add(this.group);
    this.topColor = new THREE.Color(); this.horizonColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    // dome
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunset: { value: new THREE.Color() }, sunsetAmt: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunset; uniform float sunsetAmt; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); float k = pow(clamp(h + 0.05, 0.0, 1.0), 0.55);
          vec3 c = mix(horizon, top, k);
          float s = max(0.0, dot(normalize(vec3(vDir.x, 0.0, vDir.z) + vec3(0.0, 0.001, 0.0)), normalize(vec3(sunDir.x, 0.0001, sunDir.z))));
          float band = (1.0 - smoothstep(0.0, 0.45, abs(h - 0.03))) * pow(s, 3.0) * sunsetAmt;
          c = mix(c, sunset, clamp(band, 0.0, 1.0));
          if (h < 0.0) c = mix(c, horizon * 0.6, clamp(-h * 5.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    // stars
    const rng = mulberry32(4242);
    const sp = [], sz = [], ph = [];
    for (let i = 0; i < C.STAR_COUNT; i++) {
      let x, y, z, l;
      do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < 0.1);
      sp.push(x / l * 380, y / l * 380, z / l * 380); sz.push(1 + rng() * 2.2); ph.push(rng() * 6.28);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('size', new THREE.Float32BufferAttribute(sz, 1));
    sg.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, time: { value: 0 } },
      vertexShader: 'attribute float size; attribute float phase; uniform float time; varying float vTw; void main(){ vTw = 0.65 + 0.35 * sin(time * 2.0 + phase * 7.0); vec4 wpos = modelMatrix * vec4(position, 1.0); vTw *= smoothstep(-10.0, 30.0, wpos.y - cameraPosition.y); gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float opacity; varying float vTw; void main(){ gl_FragColor = vec4(vec3(1.0), opacity * vTw); }',
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.celestial = new THREE.Group();
    this.celestial.add(this.stars);
    this.group.add(this.celestial);
    // sun
    const sunTex = pixelCanvas(32, 32, (ctx) => {
      ctx.fillStyle = 'rgba(255,240,180,0.25)'; ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = 'rgba(255,245,200,0.6)'; ctx.fillRect(4, 4, 24, 24);
      ctx.fillStyle = '#fffbe6'; ctx.fillRect(8, 8, 16, 16);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(11, 11, 10, 10);
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(C.SUN_SIZE * 2, C.SUN_SIZE * 2), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }));
    this.sun.renderOrder = -8;
    this.celestial.add(this.sun);
    // moon with 8 phases in a 4x2 sheet
    this.moonTex = pixelCanvas(128, 64, (ctx) => {
      for (let p = 0; p < 8; p++) {
        const ox = (p % 4) * 32, oy = Math.floor(p / 4) * 32;
        const r2 = mulberry32(p + 9);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const lit = phaseLit(p, x, y);
          if (!lit) continue;
          const crater = r2() < 0.18;
          const v = crater ? 170 : 220 + r2() * 30;
          ctx.fillStyle = `rgb(${v},${v},${v * 0.98})`;
          ctx.fillRect(ox + 8 + x, oy + 8 + y, 1, 1);
        }
      }
    });
    this.moonTex.repeat.set(0.25, 0.5);
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(C.MOON_SIZE * 2, C.MOON_SIZE * 2), new THREE.MeshBasicMaterial({ map: this.moonTex, transparent: true, depthWrite: false, depthTest: true }));
    this.moon.renderOrder = -8;
    this.celestial.add(this.moon);
    this.clouds = new Clouds(scene);
    this.daylight = 1;
    this.flash = 0;
  }

  update(camera, time, rain, dt, settings) {
    const t = ((time % C.DAY_TICKS) + C.DAY_TICKS) % C.DAY_TICKS;
    const angle = (t / C.DAY_TICKS) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.0).normalize();
    this.group.position.copy(camera.position);
    const day = C.dayLightFactor(time);
    this.daylight = day;
    const dayK = Math.min(1, Math.max(0, (day - C.NIGHT_MIN_SKY) / (1 - C.NIGHT_MIN_SKY)));
    this.topColor.copy(NIGHT_TOP).lerp(DAY_TOP, dayK);
    this.horizonColor.copy(NIGHT_HOR).lerp(DAY_HOR, dayK);
    const sunsetAmt = Math.max(0, 1 - Math.abs(this.sunDir.y) * 3.2) * (rain > 0.5 ? 0.3 : 1);
    if (rain > 0) {
      const r = rain * 0.75;
      this.topColor.lerp(RAIN_TOP.clone().multiplyScalar(0.25 + dayK * 0.75), r);
      this.horizonColor.lerp(RAIN_HOR.clone().multiplyScalar(0.25 + dayK * 0.75), r);
    }
    const sunsetCol = SUNSET.clone().lerp(SUNSET_PINK, 0.35);
    // fog follows the horizon toward the sun at sunset
    const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
    const toSun = Math.max(0, camDir.x * Math.sign(this.sunDir.x || 1));
    this.fogColor.copy(this.horizonColor).lerp(sunsetCol, sunsetAmt * toSun * 0.6);
    if (this.flash > 0) {
      this.flash -= dt;
      const f = Math.max(0, this.flash) * 2;
      this.topColor.lerp(new THREE.Color(1, 1, 1), Math.min(0.7, f));
      this.horizonColor.lerp(new THREE.Color(1, 1, 1), Math.min(0.7, f));
    }
    const u = this.domeMat.uniforms;
    u.top.value.copy(this.topColor); u.horizon.value.copy(this.horizonColor);
    u.sunDir.value.copy(this.sunDir); u.sunset.value.copy(sunsetCol); u.sunsetAmt.value = sunsetAmt;
    // celestial bodies
    const dist = 300;
    this.sun.position.copy(this.sunDir).multiplyScalar(dist);
    this.sun.lookAt(0, 0, 0);
    this.moon.position.copy(this.sunDir).multiplyScalar(-dist);
    this.moon.lookAt(0, 0, 0);
    const dayIndex = Math.floor(time / C.DAY_TICKS);
    const phase = ((dayIndex % C.MOON_PHASES) + C.MOON_PHASES) % C.MOON_PHASES;
    this.moonTex.offset.set((phase % 4) * 0.25, Math.floor(phase / 4) * 0.5);
    const celestialAlpha = 1 - rain * 0.85;
    this.sun.material.opacity = celestialAlpha;
    this.moon.material.opacity = celestialAlpha;
    this.starMat.uniforms.opacity.value = Math.max(0, 1 - dayK * 1.6) * (1 - rain);
    this.starMat.uniforms.time.value += dt;
    this.stars.rotation.z = angle;
    this.clouds.update(camera, time, dayK, sunsetAmt, rain, settings.clouds);
  }

  lightning() { this.flash = 0.35; }
}

function phaseLit(p, x, y) {
  const cx = x - 7.5, cy = y - 7.5;
  if (cx * cx + cy * cy > 7.6 * 7.6) return false;
  if (p === 0) return true; // full
  if (p === 4) return false; // new (draw faint)
  const k = p < 4 ? p / 4 : (8 - p) / 4; // fraction dark
  const half = Math.sqrt(Math.max(0, 7.6 * 7.6 - cy * cy));
  const edge = half * (1 - 2 * k);
  return p < 4 ? cx < edge : cx > -edge;
}

class Clouds {
  constructor(scene) {
    this.noise = new Simplex(1337);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.builtFor = null;
    this.mode = null;
    this.color = new THREE.Color();
  }

  isCloud(cx, cz) {
    const n = this.noise.noise2(cx * 0.11, cz * 0.11) * 0.75 + this.noise.noise2(cx * 0.031 + 50, cz * 0.031) * 0.5;
    return n > 0.32;
  }

  build(ccx, ccz, mode) {
    const R = C.CLOUD_RANGE_CELLS;
    const pos = [], col = [], idx = [];
    const S = C.CLOUD_CELL, H = C.CLOUD_THICKNESS;
    const quad = (a, b, c, d, shade, alpha) => {
      const base = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let i = 0; i < 4; i++) col.push(shade, shade, shade, alpha);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!this.isCloud(cx, cz)) continue;
      const d = Math.hypot(dx, dz) / R;
      if (d > 1) continue;
      const alpha = 1 - Math.max(0, (d - 0.65) / 0.35);
      const x0 = dx * S, z0 = dz * S, x1 = x0 + S, z1 = z0 + S;
      if (mode === 'fast') {
        quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], 1, alpha);
        continue;
      }
      quad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], 1, alpha);
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], 0.7, alpha);
      if (!this.isCloud(cx + 1, cz)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], 0.86, alpha);
      if (!this.isCloud(cx - 1, cz)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], 0.86, alpha);
      if (!this.isCloud(cx, cz + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], 0.92, alpha);
      if (!this.isCloud(cx, cz - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], 0.8, alpha);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.builtFor = [ccx, ccz];
    this.mode = mode;
  }

  update(camera, time, dayK, sunsetAmt, rain, mode) {
    if (mode === 'off') { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const scroll = (time / 20) * C.CLOUD_SPEED;
    const cx = Math.floor((camera.position.x - scroll) / C.CLOUD_CELL);
    const cz = Math.floor(camera.position.z / C.CLOUD_CELL);
    if (!this.builtFor || this.mode !== mode || Math.abs(cx - this.builtFor[0]) > 3 || Math.abs(cz - this.builtFor[1]) > 3) this.build(cx, cz, mode);
    this.mesh.position.set(this.builtFor[0] * C.CLOUD_CELL + scroll, C.CLOUD_Y, this.builtFor[1] * C.CLOUD_CELL);
    // tint: white by day, orange at dusk, dark at night, gray in rain
    this.color.setRGB(0.32 + dayK * 0.68, 0.33 + dayK * 0.67, 0.4 + dayK * 0.6);
    if (sunsetAmt > 0) this.color.lerp(new THREE.Color(1, 0.62, 0.42), sunsetAmt * 0.6 * Math.max(0.3, dayK));
    if (rain > 0) this.color.multiplyScalar(1 - rain * 0.45);
    this.mat.color.copy(this.color);
    this.mat.opacity = 0.55 + dayK * 0.27; // thinner at night so the world below isn't blacked out
  }
}
