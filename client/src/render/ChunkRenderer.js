// Chunk meshes and the voxel shader (sky/block light with day-night factor, biome tints,
// vertex AO, water waves, distance fog). One mesh per pass per chunk, pooled.
import * as THREE from 'three';
import { chunkKey } from '../../../shared/chunk.js';

const VERT = /* glsl */`
attribute vec4 lt;
attribute vec4 col;
uniform float uTime;
uniform float uFogVert;
varying vec2 vUv;
varying vec4 vLt;
varying vec3 vCol;
varying float vDist;
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  if (lt.w > 0.5) {
    wp.y += (sin(wp.x * 1.3 + uTime * 1.7) + sin(wp.z * 1.1 + uTime * 1.3)) * 0.03 - 0.06;
  }
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vLt = lt;
  vCol = col.rgb;
  vec3 d = wp.xyz - cameraPosition;
  vDist = length(vec3(d.x, d.y * uFogVert, d.z)); // mostly horizontal fog so the ground stays visible from high up
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform float uDaylight;
uniform vec3 uSkyLight;
uniform vec3 uFogColor;
uniform vec3 uAmbient;
uniform float uFogNear;
uniform float uFogFar;
uniform int uPass;
varying vec2 vUv;
varying vec4 vLt;
varying vec3 vCol;
varying float vDist;
float curve(float l) {
  float b = l / (4.0 - 3.0 * l);
  float c = 1.0 - pow(1.0 - b, 4.0);
  return mix(b, c, 0.55) * 0.96 + 0.04;
}
void main() {
  vec4 tex = texture2D(map, vUv);
  if (uPass == 1 && tex.a < 0.1) discard;
  vec3 c = tex.rgb;
  bool tinted = uPass == 2 || (tex.a > 0.5 && tex.a < 0.999);
  if (tinted) c *= vCol;
  float sky = curve(vLt.x * uDaylight);
  float blk = curve(vLt.y);
  vec3 light = max(vec3(sky) * uSkyLight, vec3(blk) * vec3(1.0, 0.88, 0.72));
  light = max(light, uAmbient);
  c *= light * vLt.z;
  float f = clamp((vDist - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  c = mix(c, uFogColor, f);
  float a = uPass == 2 ? tex.a : 1.0;
  gl_FragColor = vec4(c, a);
}`;

export function createChunkUniforms(texture) {
  return {
    map: { value: texture },
    uTime: { value: 0 },
    uFogVert: { value: 0.2 },
    uDaylight: { value: 1 },
    uSkyLight: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color(0.6, 0.75, 1) },
    uFogNear: { value: 80 },
    uFogFar: { value: 128 },
    uAmbient: { value: new THREE.Color(0.04, 0.04, 0.04) },
  };
}

function makeMaterial(uniforms, pass) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPass: { value: pass } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: pass === 2,
    depthWrite: pass !== 2,
    side: THREE.FrontSide,
  });
  return m;
}

export class ChunkRenderer {
  constructor(scene, atlas) {
    this.group = new THREE.Group();
    this.group.name = 'chunks';
    scene.add(this.group);
    this.uniforms = createChunkUniforms(atlas.texture);
    this.materials = [makeMaterial(this.uniforms, 0), makeMaterial(this.uniforms, 1), makeMaterial(this.uniforms, 2)];
    this.meshes = new Map(); // key -> [opaque, cutout, trans]
    this.pool = [];
    this.visibleCount = 0;
  }

  takeMesh(pass) {
    const m = this.pool.pop() || new THREE.Mesh(new THREE.BufferGeometry(), this.materials[pass]);
    m.material = this.materials[pass];
    m.renderOrder = pass === 2 ? 2 : pass;
    m.matrixAutoUpdate = false;
    return m;
  }

  release(m) {
    this.group.remove(m);
    m.geometry.dispose();
    m.geometry = new THREE.BufferGeometry();
    if (this.pool.length < 256) this.pool.push(m);
  }

  setMesh(cx, cz, data) {
    const key = chunkKey(cx, cz);
    let slots = this.meshes.get(key);
    if (!slots) { slots = [null, null, null]; this.meshes.set(key, slots); }
    const parts = [data.opaque, data.cutout, data.trans];
    for (let p = 0; p < 3; p++) {
      const g = parts[p];
      if (!g) {
        if (slots[p]) { this.release(slots[p]); slots[p] = null; }
        continue;
      }
      let m = slots[p];
      if (!m) { m = this.takeMesh(p); slots[p] = m; this.group.add(m); }
      else m.geometry.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute('lt', new THREE.BufferAttribute(g.lt, 4, true));
      geo.setAttribute('col', new THREE.BufferAttribute(g.col, 4, true));
      geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, data.H + 1, 16));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, (data.H + 1) / 2, 8), Math.hypot(8, (data.H + 1) / 2, 8));
      m.geometry = geo;
      m.position.set(cx * 16, 0, cz * 16);
      m.updateMatrix();
      m.updateMatrixWorld(true);
    }
  }

  removeMesh(cx, cz) {
    const key = chunkKey(cx, cz);
    const slots = this.meshes.get(key);
    if (!slots) return;
    for (const m of slots) if (m) this.release(m);
    this.meshes.delete(key);
  }

  hasMesh(cx, cz) { return this.meshes.has(chunkKey(cx, cz)); }

  clear() {
    for (const key of [...this.meshes.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this.removeMesh(cx, cz);
    }
  }

  countVisible(frustum) {
    let n = 0;
    const s = new THREE.Sphere();
    for (const slots of this.meshes.values()) {
      const m = slots[0] || slots[1] || slots[2];
      if (!m) continue;
      s.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
      if (frustum.intersectsSphere(s)) n++;
    }
    this.visibleCount = n;
    return n;
  }
}
