// Client-side entity views: interpolation buffer (100 ms), procedural animation of box rigs,
// players with armor/held items/glider wings/nametags, dropped items, projectiles, falling blocks.
import * as THREE from 'three';
import { INTERP_DELAY_MS, NIGHT_MIN_SKY } from '../../../shared/constants.js';
import { FLAG } from '../../../shared/protocol.js';
import { ITEMS } from '../../../shared/items.js';
import { ID, BLOCKS } from '../../../shared/blocks.js';
import { buildRig, skinTexture, playerSkinTexture, paintVillager, paintWool, PAINTERS, buildArmorLayer, buildWings, extrudedItemGeometry } from './models.js';
import { getIcon, isFlatItem } from '../textures/icons.js';
import { meshChunk } from '../world/mesher.js';

const TAU = Math.PI * 2;
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * t; }
export function lightCurve(l) { const b = l / (4 - 3 * l); const c = 1 - Math.pow(1 - b, 4); return (b + (c - b) * 0.55) * 0.96 + 0.04; }

// Build chunk-style geometry for a single block (used for items/falling blocks/held blocks).
const blockGeoCache = new Map();
export function blockGeometries(blockId, meta, uv) {
  const key = blockId + ':' + meta;
  let r = blockGeoCache.get(key);
  if (r) return r;
  const H = 3, N = 18 * 18 * H;
  const blocks = new Uint8Array(N), light = new Uint8Array(N).fill(0xf0), metaA = new Uint8Array(N), biome = new Uint8Array(18 * 18);
  const at = (x, y, z) => (y * 18 + (z + 1)) * 18 + (x + 1);
  blocks[at(0, 1, 0)] = blockId; metaA[at(0, 1, 0)] = meta;
  if (BLOCKS[blockId].shape === 'door') { blocks[at(0, 2, 0)] = blockId; metaA[at(0, 2, 0)] = meta | 8; }
  const m = meshChunk({ H, blocks, light, meta: metaA, biome, smooth: false }, uv);
  r = [];
  for (const [k, pass] of [['opaque', 0], ['cutout', 1], ['trans', 2]]) {
    const g = m[k];
    if (!g) continue;
    const geo = new THREE.BufferGeometry();
    const pos = g.pos;
    for (let i = 0; i < pos.length; i += 3) { pos[i] -= 0.5; pos[i + 1] -= 1; pos[i + 2] -= 0.5; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('lt', new THREE.BufferAttribute(g.lt, 4, true));
    geo.setAttribute('col', new THREE.BufferAttribute(g.col, 4, true));
    geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    r.push([geo, pass]);
  }
  blockGeoCache.set(key, r);
  return r;
}

// A block mesh with its own copy of the 'lt' attribute so light can be updated per entity.
export function makeBlockMesh(blockId, meta, ctx) {
  const group = new THREE.Group();
  const lts = [];
  for (const [geo, pass] of blockGeometries(blockId, meta, ctx.atlas.uv)) {
    const g = geo.clone();
    const lt = g.getAttribute('lt').clone();
    g.setAttribute('lt', lt);
    const mesh = new THREE.Mesh(g, ctx.chunkMaterials[pass]);
    group.add(mesh);
    lts.push(lt);
  }
  group.userData.setLight = (sky, blk) => {
    for (const lt of lts) {
      const a = lt.array;
      for (let i = 0; i < a.length; i += 4) { a[i] = sky * 17; a[i + 1] = blk * 17; }
      lt.needsUpdate = true;
    }
  };
  return group;
}

const itemMatCache = { mat: null };
export function makeItemMesh(id, ctx) {
  const it = ITEMS[id];
  if (it && it.kind === 'block' && !it.flat) {
    const g = makeBlockMesh(ID[it.block], it.block === 'chest' || it.block === 'furnace' || it.block === 'crafting_table' ? 2 : 0, ctx);
    g.userData.isBlock = true;
    return g;
  }
  if (!itemMatCache.mat) itemMatCache.mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const geo = extrudedItemGeometry(id, getIcon(id));
  const mat = itemMatCache.mat.clone();
  const mesh = new THREE.Mesh(geo, mat);
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.setLight = (sky, blk, daylight) => {
    const b = Math.max(lightCurve(sky / 15 * daylight), lightCurve(blk / 15));
    mat.color.setScalar(Math.max(0.06, b));
  };
  return g;
}

function nameTag(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '28px "Pixelify Sans", monospace';
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = 40;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = 'rgba(0,0,0,0.35)';
  ctx2.fillRect(0, 0, w, 40);
  ctx2.font = '28px "Pixelify Sans", monospace';
  ctx2.fillStyle = '#fff';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 8, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(w / 40 * 0.25, 0.25, 1);
  sp.renderOrder = 10;
  return sp;
}

export class EntityView {
  constructor(data, ctx) {
    this.id = data.id;
    this.type = data.type;
    this.ctx = ctx;
    this.snaps = [];
    this.group = new THREE.Group();
    this.data = data;
    this.walkDist = 0; this.limb = 0; this.swing = 0; this.hurt = 0; this.death = -1; this.age = 0;
    this.flags = 0; this.extra = 0;
    this.prev = null;
    this.x = data.x; this.y = data.y; this.z = data.z; this.yaw = data.yaw || 0; this.headYaw = data.yaw || 0; this.pitch = data.pitch || 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.pickup = null;
    this.build();
    this.push(performance.now() - INTERP_DELAY_MS, data.x, data.y, data.z, this.yaw, this.headYaw, this.pitch, 0, 0);
  }

  build() {
    const d = this.data, ctx = this.ctx;
    const t = this.type;
    if (t === 'player' || t === 'zombie' || t === 'skeleton' || t === 'creeper' || t === 'pig' || t === 'cow' || t === 'sheep' || t === 'chicken' || t === 'spider' || t === 'villager' || t === 'enderman') {
      let tex;
      if (t === 'player') tex = playerSkinTexture(d.name, d.skin);
      else if (t === 'villager') tex = skinTexture('villager:' + d.prof + d.style, () => paintVillager(d.prof || 'farmer', d.style || 'plains'));
      else tex = skinTexture(t, PAINTERS[t]);
      const extra = {};
      if (t === 'sheep') extra.woolTexture = skinTexture('wool:' + (d.color || 'white'), () => paintWool(d.color || 'white'));
      this.rig = buildRig(t, tex, extra);
      this.materials = this.rig.materials;
      const s = (t === 'player' || t === 'zombie' || t === 'skeleton' || t === 'villager') ? 0.9 : 1;
      this.rig.scale.scale.setScalar(s);
      this.baseScale = s;
      this.group.add(this.rig.root);
      if (t === 'player' || t === 'zombie' || t === 'skeleton' || t === 'villager' || t === 'enderman') this.setupHumanoid();
      if (t === 'player' && !d.self) {
        this.tag = nameTag(d.name);
        this.tag.position.y = 2.05;
        this.group.add(this.tag);
      }
      if (t === 'skeleton') this.setHeld('bow');
      this.applyMobData(d);
    } else if (t === 'item') {
      this.setItemStack(d.item);
    } else if (t === 'falling') {
      this.model = makeBlockMesh(d.block, 0, ctx);
      this.model.position.y = 0.5;
      this.group.add(this.model);
    } else if (t === 'arrow') {
      const g = new THREE.Group();
      const mk = (hex) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.userData.base = new THREE.Color(hex); return m; };
      const mat = mk(0x8a6a3a);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(1 / 32, 1 / 32, 0.6), mat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1 / 16, 1 / 16, 0.08), mk(0x9a9a9a));
      head.position.z = -0.32;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.12), mk(0xeeeeee));
      fl.position.z = 0.26;
      g.add(shaft, head, fl);
      this.arrowMats = [mat, head.material, fl.material];
      this.model = g;
      this.group.add(g);
    } else if (t === 'ender_dragon') {
      this.buildDragon();
    } else if (t === 'end_crystal') {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshBasicMaterial({ color: 0xc8f0ff, transparent: true, opacity: 0.35, depthWrite: false }));
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xe040e0 }));
      g.add(outer, inner);
      g.position.y = 1;
      this.crystal = { outer, inner };
      this.model = g; this.group.add(g);
    } else if (t === 'eye' || t === 'pearl') {
      this.model = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: t === 'eye' ? 0x50d070 : 0x1f6f66 }));
      this.group.add(this.model);
    } else if (t === 'egg') {
      this.model = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.2), new THREE.MeshBasicMaterial({ color: 0xf2e6c8 }));
      this.model.position.y = 0.12;
      this.group.add(this.model);
    } else if (t === 'firework') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), new THREE.MeshBasicMaterial({ color: 0xd23030 }));
      body.position.y = 0.2;
      g.add(body);
      this.model = g;
      this.group.add(g);
    }
  }

  // Procedural Ender Dragon: body, neck, head with glowing eyes, segmented tail and flapping wings.
  buildDragon() {
    const dark = new THREE.MeshBasicMaterial({ color: 0x241e2c }), mid = new THREE.MeshBasicMaterial({ color: 0x3a3244 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xe060ff }), membrane = new THREE.MeshBasicMaterial({ color: 0x2e2638, side: THREE.DoubleSide });
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const body = box(3, 2.2, 6, dark); body.position.y = 2; root.add(body);
    for (let i = 0; i < 4; i++) { const sp = box(0.3, 0.6, 0.6, mid); sp.position.set(0, 3.3, -2 + i * 1.4); root.add(sp); }
    const neck = box(1.2, 1.2, 3, dark); neck.position.set(0, 2.6, -4.3); root.add(neck);
    const head = new THREE.Group(); head.position.set(0, 2.9, -6.3); root.add(head);
    head.add(box(2, 1.4, 2.4, dark));
    const snout = box(1.4, 0.8, 1.6, mid); snout.position.set(0, -0.2, -1.8); head.add(snout);
    for (const sx of [-0.6, 0.6]) { const e = box(0.35, 0.2, 0.1, eye); e.position.set(sx, 0.3, -1.21); head.add(e); }
    const tail = []; let prev = root, z = 3;
    for (let i = 0; i < 6; i++) { const seg = new THREE.Group(); seg.position.set(0, i === 0 ? 1.9 : 0, i === 0 ? z : 1.3); const m = box(1 - i * 0.12, 1 - i * 0.12, 1.3, i % 2 ? mid : dark); m.position.z = 0.65; seg.add(m); prev.add(seg); prev = seg; tail.push(seg); }
    const wings = [];
    for (const sgn of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(sgn * 1.5, 2.8, -1); root.add(w);
      const bone = box(6, 0.25, 0.3, mid); bone.position.x = sgn * 3; w.add(bone);
      const mem = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), membrane); mem.rotation.x = -Math.PI / 2; mem.position.set(sgn * 3, 0, 2); w.add(mem);
      wings.push([w, sgn]);
    }
    this.dragon = { root, tail, wings, mats: [dark, mid, membrane] };
    this.model = root;
    this.group.add(root);
  }

  animateDragon(dt) {
    const d = this.dragon;
    d.root.rotation.y = this.yaw; d.root.rotation.x = this.pitch;
    const flap = Math.sin(this.age * 0.15);
    for (const [w, sgn] of d.wings) w.rotation.z = sgn * flap * 0.7;
    d.tail.forEach((s, i) => { s.rotation.y = Math.sin(this.age * 0.08 - i * 0.6) * 0.15; s.rotation.x = Math.sin(this.age * 0.1 - i) * 0.05; });
    const hurt = this.hurt > 0 || (this.flags & FLAG.HURT);
    d.mats[0].color.setHex(hurt ? 0x8a2030 : 0x241e2c);
    if (this.death >= 0) { this.death += dt * 20; d.root.position.y = this.death * 0.1; d.root.rotation.z = this.death * 0.05; }
  }

  setupHumanoid() {
    const p = this.rig.parts;
    this.heldAnchor = new THREE.Group();
    this.heldAnchor.position.set(0, -9.5 / 16, -1 / 16);
    p.rightArm.add(this.heldAnchor);
    if (this.type === 'player') {
      this.armorLayers = {};
      this.wings = buildWings();
      this.wings.group.visible = false;
      p.body.add(this.wings.group);
      this.wingOpen = 0;
      this.setEquip(this.data);
    }
  }

  setEquip(d) {
    if (this.type !== 'player') return;
    this.setHeld(d.held || null);
    const armor = d.armor || [null, null, null, null];
    const slots = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < 4; i++) {
      const id = armor[i];
      const it = id ? ITEMS[id] : null;
      const glider = it && it.armor && it.armor.glider;
      const mat = it && it.armor && !glider ? it.armor.material : null;
      for (const [m, layer] of Object.entries(this.armorLayers)) for (const mesh of layer[slots[i]]) mesh.visible = m === mat;
      if (mat && !this.armorLayers[mat]) {
        this.armorLayers[mat] = buildArmorLayer(this.rig.parts, mat);
        this.materials.push(this.armorLayers[mat].material);
        for (const s of slots) for (const mesh of this.armorLayers[mat][s]) mesh.visible = false;
        for (const mesh of this.armorLayers[mat][slots[i]]) mesh.visible = true;
      }
      if (i === 1) this.hasWings = !!glider;
    }
    if (this.wings) this.wings.group.visible = !!this.hasWings;
    if (this.wings && !this.materials.includes(this.wings.material)) this.materials.push(this.wings.material);
  }

  setHeld(id) {
    if (!this.heldAnchor) return;
    if (this.heldId === id) return;
    this.heldId = id;
    while (this.heldAnchor.children.length) this.heldAnchor.remove(this.heldAnchor.children[0]);
    this.heldMesh = null;
    if (!id || !ITEMS[id]) return;
    const m = makeItemMesh(id, this.ctx);
    if (m.userData.isBlock) { m.scale.setScalar(0.38); m.position.set(0, 0, -0.12); m.rotation.set(0.3, 0.7, 0); }
    else {
      m.scale.setScalar(0.6);
      const it = ITEMS[id];
      if (it.handheld) { m.rotation.set(0, Math.PI / 2, -Math.PI / 4 + 0.2); m.position.set(0, 0.08, -0.12); }
      else { m.rotation.set(-0.3, Math.PI / 2, 0); m.position.set(0, -0.02, -0.15); m.scale.setScalar(0.45); }
    }
    this.heldMesh = m;
    this.heldAnchor.add(m);
  }

  setItemStack(item) {
    if (this.model) this.group.remove(this.model);
    const [id, count] = item;
    const g = new THREE.Group();
    const copies = count <= 1 ? 1 : count < 16 ? 2 : 3;
    this.itemMeshes = [];
    for (let i = 0; i < copies; i++) {
      const m = makeItemMesh(id, this.ctx);
      if (m.userData.isBlock) m.scale.setScalar(0.25); else m.scale.setScalar(0.5);
      m.position.set(i * 0.06, (m.userData.isBlock ? 0.125 : 0.25) + i * 0.04, i * 0.05);
      g.add(m);
      this.itemMeshes.push(m);
    }
    this.model = g;
    this.group.add(g);
    this.itemId = id;
  }

  applyMobData(d) {
    if (this.type === 'sheep' && this.rig) {
      const sheared = !!d.sheared;
      this.rig.parts.wool.visible = !sheared;
      this.rig.parts.headWool.visible = !sheared;
      if (d.color && d.color !== this.data.color && this.rig.materials[1]) {
        this.rig.materials[1].map = skinTexture('wool:' + d.color, () => paintWool(d.color));
      }
    }
    const baby = !!d.baby;
    if (this.rig) {
      const s = this.baseScale * (baby ? 0.5 : 1);
      this.rig.scale.scale.setScalar(s);
      if (this.rig.parts.head) this.rig.parts.head.scale.setScalar(baby ? 1.5 : 1);
    }
    this.data = { ...this.data, ...d };
  }

  push(t, x, y, z, yaw, headYaw, pitch, flags, extra) {
    this.snaps.push({ t, x, y, z, yaw, headYaw, pitch, flags, extra });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  sample(rt) {
    const s = this.snaps;
    if (!s.length) return;
    let a = s[0], b = s[s.length - 1];
    if (rt >= b.t) { a = b; }
    else {
      for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; }
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    const nx = a.x + (b.x - a.x) * k, ny = a.y + (b.y - a.y) * k, nz = a.z + (b.z - a.z) * k;
    this.vx = nx - this.x; this.vy = ny - this.y; this.vz = nz - this.z;
    this.x = nx; this.y = ny; this.z = nz;
    this.yaw = lerpAngle(a.yaw, b.yaw, k);
    this.headYaw = lerpAngle(a.headYaw, b.headYaw, k);
    this.pitch = a.pitch + (b.pitch - a.pitch) * k;
    this.flags = k < 0.5 ? a.flags : b.flags;
    this.extra = k < 0.5 ? a.extra : b.extra;
  }

  update(dt, rt, world, daylight, tick) {
    this.age += dt * 20;
    if (this.pickup) {
      const p = this.pickup;
      p.t += dt * 20;
      const k = Math.min(1, p.t / 3);
      const tx = p.target.x, ty = p.target.y + 0.8, tz = p.target.z;
      this.group.position.set(this.x + (tx - this.x) * k, this.y + (ty - this.y) * k, this.z + (tz - this.z) * k);
      return k >= 1;
    }
    if (this.direct) {
      const d = this.direct;
      this.vx = d.x - this.x; this.vy = d.y - this.y; this.vz = d.z - this.z;
      this.x = d.x; this.y = d.y; this.z = d.z; this.yaw = d.yaw; this.headYaw = d.headYaw; this.pitch = d.pitch; this.flags = d.flags;
    } else this.sample(rt);
    this.group.position.set(this.x, this.y, this.z);
    // lighting
    const l = world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const sky = l >> 4, blk = l & 15;
    const bright = Math.max(0.06, Math.max(lightCurve(sky / 15 * daylight), lightCurve(blk / 15)));
    if (this.hurt > 0) this.hurt -= dt * 20;
    const hurtTint = this.hurt > 0 || (this.flags & FLAG.HURT) ? 1 : 0;
    let flash = 0;
    if (this.type === 'creeper' && this.extra > 0) flash = Math.floor(this.extra / 3) % 2 ? 0.6 : 0;
    if (this.materials) {
      for (const m of this.materials) {
        m.color.setRGB(bright + flash, bright * (hurtTint ? 0.45 : 1) + flash, bright * (hurtTint ? 0.45 : 1) + flash);
        if (this.death >= 0) { m.transparent = true; m.opacity = Math.max(0, 1 - Math.max(0, this.death - 14) / 6); }
      }
    }
    if (this.heldMesh && this.heldMesh.userData.setLight) this.heldMesh.userData.setLight(sky, blk, daylight);
    if (this.arrowMats) for (const m of this.arrowMats) m.color.copy(m.userData.base).multiplyScalar(bright);
    if (this.type === 'item' && this.model) {
      this.model.rotation.y = this.age * 0.05 + this.id;
      this.model.position.y = Math.sin(this.age * 0.1 + this.id) * 0.06 + 0.06;
      for (const m of this.itemMeshes) if (m.userData.setLight) m.userData.setLight(sky, blk, daylight);
      return false;
    }
    if (this.type === 'falling' && this.model) { this.model.userData.setLight(sky, blk); return false; }
    if (this.type === 'arrow' && this.model) {
      this.model.rotation.set(0, 0, 0);
      this.model.rotation.order = 'YXZ';
      this.model.rotation.y = this.yaw;
      this.model.rotation.x = this.pitch;
      this.model.position.y = 0.15;
      return false;
    }
    if (this.dragon) { this.animateDragon(dt); return false; }
    if (this.crystal) {
      this.crystal.outer.rotation.set(this.age * 0.05, this.age * 0.07, 0);
      this.crystal.inner.rotation.set(0, -this.age * 0.09, this.age * 0.05);
      this.model.position.y = 1 + Math.sin(this.age * 0.08) * 0.25;
      return false;
    }
    if (!this.rig) return false;
    this.animate(dt, tick);
    if (this.tag) this.tag.visible = !(this.flags & FLAG.SNEAK) && !(this.flags & FLAG.INVISIBLE) && this.death < 0;
    this.group.visible = !(this.flags & FLAG.INVISIBLE);
    if (this.death >= 0) { this.death += dt * 20; }
    return false;
  }

  animate(dt, tick) {
    const p = this.rig.parts;
    const t = this.type;
    const hs = Math.hypot(this.vx, this.vz) / Math.max(dt, 1e-3);
    const target = Math.min(1, hs / 4.3);
    this.limb += (target - this.limb) * Math.min(1, dt * 10);
    this.walkDist += hs * dt * 1.6;
    const swingA = Math.sin(this.walkDist * 0.6662) * 1.4 * this.limb;
    const breathe = Math.sin(this.age * 0.067) * 0.03;
    const f = this.flags;
    const root = this.rig.root;
    root.rotation.set(0, 0, 0);
    root.rotation.order = 'YXZ';
    root.rotation.y = this.yaw; // models face -z; yaw 0 looks -z
    root.position.set(0, 0, 0);
    // death roll
    if (this.death >= 0) root.rotation.z = Math.min(1, this.death / 20) * Math.PI / 2;
    const headYaw = this.headYaw - this.yaw;
    if (p.head) { p.head.rotation.set(0, 0, 0); p.head.rotation.order = 'YXZ'; p.head.rotation.y = headYaw; p.head.rotation.x = this.pitch; }
    if (this.swing > 0) this.swing -= dt * 20;
    const swingP = this.swing > 0 ? Math.sin((1 - this.swing / 6) * Math.PI) : 0;
    if (t === 'player' || t === 'zombie' || t === 'skeleton' || t === 'villager' || t === 'enderman') {
      const sneak = f & FLAG.SNEAK, glide = f & FLAG.GLIDE, swim = f & FLAG.SWIM, sleeping = f & FLAG.SLEEPING;
      p.body.rotation.set(0, 0, 0); p.body.position.copy(p.body.userData.base);
      p.rightLeg.position.copy(p.rightLeg.userData.base); p.leftLeg.position.copy(p.leftLeg.userData.base);
      p.rightArm.rotation.set(-swingA * 0.5 * (t === 'player' ? 1 : 0.6) + breathe, 0, 0.05 + breathe);
      p.leftArm.rotation.set(swingA * 0.5 * (t === 'player' ? 1 : 0.6) - breathe, 0, -0.05 - breathe);
      p.rightLeg.rotation.set(swingA * 0.7, 0, 0);
      p.leftLeg.rotation.set(-swingA * 0.7, 0, 0);
      if ((t === 'zombie' && (f & FLAG.ARMS_UP)) || (t === 'skeleton' && (f & FLAG.DRAWING))) {
        p.rightArm.rotation.x = -Math.PI / 2 + breathe; p.leftArm.rotation.x = -Math.PI / 2 - breathe;
        if (t === 'skeleton') { p.leftArm.rotation.y = 0.4; p.rightArm.rotation.y = -0.1; }
      }
      if (t === 'player' && (f & FLAG.USING)) {
        if (f & FLAG.DRAWING) { p.rightArm.rotation.set(-Math.PI / 2 + this.pitch, -0.1, 0); p.leftArm.rotation.set(-Math.PI / 2 + this.pitch, 0.5, 0); }
        else { p.rightArm.rotation.x = -0.9 + Math.sin(this.age * 1.6) * 0.15; p.rightArm.rotation.y = -0.4; }
      }
      if (swingP) { p.rightArm.rotation.x = -swingP * 1.6 - 0.2; p.rightArm.rotation.y = -swingP * 0.4; }
      if (sneak && !glide) {
        p.body.rotation.x = -0.5;
        p.rightLeg.position.z += 4 / 16; p.leftLeg.position.z += 4 / 16;
        p.rightLeg.position.y -= 0.12; p.leftLeg.position.y -= 0.12;
        p.body.position.y -= 0.12;
        p.head.rotation.x = this.pitch + 0.5;
      }
      // glide/swim: whole body horizontal following pitch
      if ((glide || swim) && this.death < 0) {
        root.rotation.x = -Math.PI / 2 + this.pitch;
        root.position.y = 0.3;
        p.head.rotation.x = -Math.PI / 4;
        if (swim) { p.rightLeg.rotation.x = Math.sin(this.age * 0.5) * 0.4; p.leftLeg.rotation.x = -Math.sin(this.age * 0.5) * 0.4; }
      }
      if (sleeping) { root.rotation.x = -Math.PI / 2; root.position.y = 0.2; root.position.z = 0.9; }
      // wings
      if (this.wings && this.wings.group.visible) {
        const open = glide ? 1 : 0;
        this.wingOpen += (open - this.wingOpen) * Math.min(1, dt * 20 / 8 * 2.5);
        const o = this.wingOpen;
        this.wings.left.rotation.set(0.26 + o * 0.6, 0, 0.26 + o * 1.0);
        this.wings.right.rotation.set(0.26 + o * 0.6, 0, -0.26 - o * 1.0);
      }
    } else if (t === 'creeper') {
      p.leg0.rotation.x = swingA; p.leg1.rotation.x = -swingA; p.leg2.rotation.x = -swingA; p.leg3.rotation.x = swingA;
      const sw = this.extra > 0 ? 1 + Math.min(1, this.extra / 30) * 0.18 + Math.sin(this.age * 3) * 0.02 : 1;
      this.rig.scale.scale.set(sw, sw * 0.95 + 0.05, sw);
    } else if (t === 'pig' || t === 'cow' || t === 'sheep') {
      p.leg0.rotation.x = swingA; p.leg1.rotation.x = -swingA; p.leg2.rotation.x = -swingA; p.leg3.rotation.x = swingA;
      if (t === 'sheep' && (f & FLAG.EATING_GRASS)) { p.head.rotation.x = 0.9; p.head.position.y = p.head.userData.base.y - 0.3; }
      else if (p.head.userData.base) p.head.position.copy(p.head.userData.base);
    } else if (t === 'chicken') {
      p.leg0.rotation.x = swingA; p.leg1.rotation.x = -swingA;
      const flap = this.vy < -0.001 ? Math.sin(this.age * 2.2) * 0.9 + 0.9 : 0;
      p.wing0.rotation.z = flap; p.wing1.rotation.z = -flap;
    } else if (t === 'spider') {
      for (let i = 0; i < 4; i++) {
        const spread = (i - 1.5) * 0.45;
        const phase = Math.sin(this.walkDist * 0.6662 + i * Math.PI / 2) * 0.4 * this.limb;
        const lift = Math.abs(Math.cos(this.walkDist * 0.6662 + i * Math.PI / 2)) * 0.2 * this.limb;
        p['legR' + i].rotation.set(0, -spread + phase, -0.6 + lift);
        p['legL' + i].rotation.set(0, spread - phase, 0.6 - lift);
      }
    }
    void tick;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData.shared) { /* geometries are cached/shared */ }
      if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export class EntityRenderer {
  constructor(scene, atlas, chunkRenderer) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.views = new Map();
    this.ctx = { atlas, chunkMaterials: chunkRenderer.materials };
    this.selfId = -1;
  }

  spawn(e) {
    if (e.id === this.selfId) return null;
    let v = this.views.get(e.id);
    if (v) {
      // data update for an existing entity
      if (v.type === 'item' && e.item) v.setItemStack(e.item);
      if (v.type === 'player') { v.setEquip(e); if (e.skin !== undefined && v.rig) { v.rig.materials[0].map = playerSkinTexture(v.data.name, e.skin); v.rig.materials[0].needsUpdate = true; } }
      else if (v.rig) v.applyMobData(e);
      return v;
    }
    v = new EntityView(e, this.ctx);
    this.views.set(e.id, v);
    this.group.add(v.group);
    return v;
  }

  despawn(id) {
    const v = this.views.get(id);
    if (!v) return;
    if (v.death >= 0 && v.death < 20) { v.pendingRemove = true; return; }
    if (v.pickup) { v.pendingRemove = true; return; }
    this.group.remove(v.group);
    v.dispose();
    this.views.delete(id);
  }

  state(arr, now) {
    const [id, x, y, z, yaw, headYaw, pitch, flags, extra] = arr;
    const v = this.views.get(id);
    if (!v) return;
    v.push(now, x, y, z, yaw, headYaw, pitch, flags, extra);
  }

  event(ev, players) {
    const v = this.views.get(ev.id);
    if (!v) return;
    switch (ev.k) {
      case 'hurt': v.hurt = 10; break;
      case 'death': v.death = 0; break;
      case 'swing': v.swing = 6; break;
      case 'pickup': {
        const target = ev.by === this.selfId ? players.self : this.views.get(ev.by);
        if (target) v.pickup = { t: 0, target };
        break;
      }
      default:
    }
  }

  update(dt, world, daylight, tick) {
    const rt = performance.now() - INTERP_DELAY_MS;
    for (const [id, v] of this.views) {
      const done = v.update(dt, rt, world, daylight, tick);
      if ((done && v.pickup) || (v.pendingRemove && (v.death < 0 || v.death >= 20) && !v.pickup) || (v.pickup && done)) {
        this.group.remove(v.group);
        v.dispose();
        this.views.delete(id);
      }
    }
  }

  clear() {
    for (const v of this.views.values()) { this.group.remove(v.group); v.dispose(); }
    this.views.clear();
  }

  // Raycast against entity hitboxes; returns { id, dist } of the closest hit.
  pick(ox, oy, oz, dx, dy, dz, maxDist, sizes) {
    let best = null;
    for (const v of this.views.values()) {
      if (v.type === 'item' || v.type === 'arrow' || v.type === 'falling' || v.type === 'egg' || v.type === 'firework' || v.death >= 0) continue;
      if (v.flags & FLAG.INVISIBLE) continue;
      const s = sizes(v);
      if (!s) continue;
      const hw = s[0] / 2;
      const t = rayAABB(ox, oy, oz, dx, dy, dz, v.x - hw, v.y, v.z - hw, v.x + hw, v.y + s[1], v.z + hw);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { id: v.id, dist: t, view: v };
    }
    return best;
  }
}

function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return null; continue; }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export { NIGHT_MIN_SKY };
