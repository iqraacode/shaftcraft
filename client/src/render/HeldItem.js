// First-person hand / held item, rendered in its own scene on top of the world.
import * as THREE from 'three';
import { ITEMS } from '../../../shared/items.js';
import { boxGeometry, playerSkinTexture } from './models.js';
import { makeItemMesh } from './EntityRenderer.js';

export class HeldItem {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.armMat = new THREE.MeshBasicMaterial({ alphaTest: 0.1 });
    this.arm = new THREE.Mesh(boxGeometry(-2, -10, -2, 4, 12, 4, 40, 16, 64, 32), this.armMat);
    this.armPivot = new THREE.Group();
    this.armPivot.add(this.arm);
    this.itemPivot = new THREE.Group();
    this.root.add(this.armPivot, this.itemPivot);
    this.itemId = undefined;
    this.equip = 1;
    this.swing = 0;
    this.bob = 0;
    this.visible = true;
  }

  setSkin(name, skin) {
    this.armMat.map = playerSkinTexture(name, skin);
    this.armMat.needsUpdate = true;
  }

  setItem(id) {
    if (id === this.itemId) return;
    if (this.itemId !== undefined) this.equip = 0;
    this.itemId = id;
    while (this.itemPivot.children.length) this.itemPivot.remove(this.itemPivot.children[0]);
    this.itemMesh = null;
    if (id && ITEMS[id]) {
      const m = makeItemMesh(id, this.ctx);
      const it = ITEMS[id];
      if (m.userData.isBlock) { m.scale.setScalar(0.4); m.rotation.set(0, Math.PI / 4, 0); }
      else if (it.handheld) { m.scale.setScalar(0.62); m.rotation.set(0, -Math.PI / 2 + 0.1, Math.PI / 4 - 0.15); }
      else { m.scale.setScalar(0.5); m.rotation.set(0, -Math.PI / 2 + 0.35, 0.2); }
      this.itemMesh = m;
      this.itemPivot.add(m);
    }
  }

  startSwing() { this.swing = 1; }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  update(dt, s) {
    // s: { bobPhase, bobAmount, sky, blk, daylight, using, useTicks, bright, sneak }
    if (this.equip < 1) this.equip = Math.min(1, this.equip + dt * 5);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 20 / 6);
    const p = 1 - this.swing; // 0..1 progress
    const sw = this.swing > 0 ? p : 0;
    const sq = Math.sqrt(sw);
    const swX = -0.4 * Math.sin(sq * Math.PI), swY = 0.2 * Math.sin(sq * Math.PI * 2), swZ = -0.2 * Math.sin(sw * Math.PI);
    const bx = Math.sin(s.bobPhase) * 0.025 * s.bobAmount, by = -Math.abs(Math.cos(s.bobPhase)) * 0.035 * s.bobAmount;
    const eq = (1 - this.equip) * -0.6;
    const bright = s.bright;
    this.armMat.color.setScalar(bright);
    if (this.itemMesh && this.itemMesh.userData.setLight) this.itemMesh.userData.setLight(s.sky, s.blk, s.daylight);
    const hasItem = !!this.itemMesh;
    this.armPivot.visible = !hasItem;
    this.itemPivot.visible = hasItem;
    if (!hasItem) {
      this.armPivot.position.set(0.62 + swX * 0.8 + bx, -0.58 + swY + eq + by, -0.62 + swZ);
      this.armPivot.rotation.set(-0.35 - Math.sin(sq * Math.PI) * 0.6, 0.25 + Math.sin(sw * sw * Math.PI) * 0.3, 0.9 + Math.sin(sq * Math.PI) * 0.3);
      this.armPivot.rotation.order = 'YXZ';
      this.armPivot.rotation.set(Math.PI / 2 - 0.3 - Math.sin(sq * Math.PI) * 0.5, 0.35 - Math.sin(sq * Math.PI) * 0.3, -0.25 + Math.sin(sq * Math.PI) * 0.2);
      return;
    }
    let x = 0.5 + swX + bx, y = -0.5 + swY + eq + by, z = -0.72 + swZ;
    let rx = -Math.sin(sq * Math.PI) * 0.9, ry = -Math.sin(sw * sw * Math.PI) * 0.35, rz = Math.sin(sq * Math.PI) * 0.25;
    if (s.using === 'eat') {
      const t = s.useTicks;
      x = 0.22; y = -0.42 + Math.abs(Math.cos(t * 0.8)) * 0.06 + eq; z = -0.6;
      rx = -0.3; ry = 0.6; rz = 0.2;
    } else if (s.using === 'bow') {
      const d = Math.min(1, s.useTicks / 20);
      x = 0.12; y = -0.32 + eq; z = -0.55 + d * 0.12;
      rx = 0.1; ry = -0.15; rz = -0.35;
      if (d > 0.9) x += Math.sin(s.useTicks * 2.5) * 0.004;
    }
    this.itemPivot.position.set(x, y, z);
    this.itemPivot.rotation.set(rx, ry, rz);
  }
}
