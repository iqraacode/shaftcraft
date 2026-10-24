// Rain streaks and snow flakes around the camera, hidden under roofs (heightmap test).
import * as THREE from 'three';
import { BIOME } from '../../../shared/worldgen.js';

const DROPS = 1400;
const RADIUS = 22;

export class Weather {
  constructor(scene) {
    this.drops = new Float32Array(DROPS * 4); // x, y, z, speed
    this.linePos = new Float32Array(DROPS * 6);
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.linePos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.rainMat = new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.55, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.rainMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    scene.add(this.lines);
    const sg = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(DROPS * 3);
    this.snowAttr = new THREE.BufferAttribute(this.snowPos, 3);
    this.snowAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.snowAttr);
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    scene.add(this.snow);
    this.initialized = false;
    this.level = 0;
    this.exposure = 0;
    this.snowing = false;
  }

  reset(cx, cy, cz, i) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RADIUS;
    this.drops[i * 4] = cx + Math.cos(a) * r;
    this.drops[i * 4 + 1] = cy + 10 + Math.random() * 14;
    this.drops[i * 4 + 2] = cz + Math.sin(a) * r;
    this.drops[i * 4 + 3] = 14 + Math.random() * 6;
  }

  update(dt, camera, world, target, particles) {
    this.level += (target - this.level) * Math.min(1, dt * 0.4);
    if (this.level < 0.01) { this.lines.visible = false; this.snow.visible = false; this.exposure = 0; return; }
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    if (!this.initialized) { for (let i = 0; i < DROPS; i++) { this.reset(cx, cy, cz, i); this.drops[i * 4 + 1] -= Math.random() * 24; } this.initialized = true; }
    this.snowing = world.biomeAt(Math.floor(cx), Math.floor(cz)) === BIOME.SNOWY || cy > 120;
    const active = Math.floor(DROPS * this.level);
    let exposed = 0;
    const lp = this.linePos, sp = this.snowPos;
    for (let i = 0; i < DROPS; i++) {
      let x = this.drops[i * 4], y = this.drops[i * 4 + 1], z = this.drops[i * 4 + 2];
      const sp0 = this.drops[i * 4 + 3];
      const speed = this.snowing ? sp0 * 0.12 : sp0;
      y -= speed * dt;
      if (this.snowing) { x += Math.sin(y * 0.8 + i) * dt * 0.4; }
      const top = world.heightAt(Math.floor(x), Math.floor(z));
      if (y < top || y < cy - 14 || Math.hypot(x - cx, z - cz) > RADIUS + 2) {
        if (y < top && top > cy - 14 && !this.snowing && i < active && Math.random() < 0.08 && particles && !particles.minimal) particles.splash(x, top + 0.05, z, 1);
        this.reset(cx, cy, cz, i);
        x = this.drops[i * 4]; y = this.drops[i * 4 + 1]; z = this.drops[i * 4 + 2];
      }
      this.drops[i * 4] = x; this.drops[i * 4 + 1] = y; this.drops[i * 4 + 2] = z;
      const visible = i < active && y >= world.heightAt(Math.floor(x), Math.floor(z));
      if (visible && Math.hypot(x - cx, z - cz) < 8) exposed++;
      if (!this.snowing && visible) {
        lp[i * 6] = x; lp[i * 6 + 1] = y; lp[i * 6 + 2] = z; lp[i * 6 + 3] = x; lp[i * 6 + 4] = y + 0.6; lp[i * 6 + 5] = z;
      } else { lp[i * 6 + 1] = -1000; lp[i * 6 + 4] = -1000; }
      if (this.snowing && visible) { sp[i * 3] = x; sp[i * 3 + 1] = y; sp[i * 3 + 2] = z; } else sp[i * 3 + 1] = -1000;
    }
    this.exposure = Math.min(1, exposed / 40) * this.level;
    this.lines.visible = !this.snowing;
    this.snow.visible = this.snowing;
    this.attr.needsUpdate = true;
    this.snowAttr.needsUpdate = true;
  }

  setBrightness(b) {
    this.rainMat.color.setRGB(0.62 * b, 0.7 * b, 0.85 * b);
    this.snowMat.color.setScalar(Math.max(0.2, b));
  }
}
