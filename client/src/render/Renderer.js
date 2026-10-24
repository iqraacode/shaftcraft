// Owns the WebGL renderer, scene, camera and all render subsystems.
import * as THREE from 'three';
import { Atlas } from '../textures/atlas.js';
import { ChunkRenderer } from './ChunkRenderer.js';
import { Sky } from './Sky.js';
import { EntityRenderer } from './EntityRenderer.js';
import { Particles } from './Particles.js';
import { Weather } from './Weather.js';
import { HeldItem } from './HeldItem.js';

THREE.ColorManagement.enabled = false;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.atlas = new Atlas();
    this.chunks = new ChunkRenderer(this.scene, this.atlas);
    this.sky = new Sky(this.scene);
    this.entities = new EntityRenderer(this.scene, this.atlas, this.chunks);
    this.particles = new Particles(this.scene, this.atlas);
    this.weather = new Weather(this.scene);
    this.held = new HeldItem({ atlas: this.atlas, chunkMaterials: this.chunks.materials });
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.fov = 70;
    this.fovMult = 1;
    // selection outline
    const sel = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(sel, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.selection.visible = false;
    this.selection.renderOrder = 5;
    this.scene.add(this.selection);
    // crack overlay
    this.crackMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.crackGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.crack = new THREE.Mesh(this.crackGeo, this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 6;
    this.scene.add(this.crack);
    this.crackStage = -1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.held.resize(w / h);
    this.particles.setScale(h * Math.min(window.devicePixelRatio || 1, 2), this.camera.fov);
  }

  setFov(fov) { this.fov = fov; }

  applyFov(dt) {
    const target = this.fov * this.fovMult;
    if (Math.abs(this.camera.fov - target) > 0.01) {
      this.camera.fov += (target - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
      this.particles.setScale(window.innerHeight * Math.min(window.devicePixelRatio || 1, 2), this.camera.fov);
    }
  }

  setSelection(box) {
    if (!box) { this.selection.visible = false; return; }
    const [x0, y0, z0, x1, y1, z1] = box;
    this.selection.visible = true;
    this.selection.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.selection.scale.set(x1 - x0 + 0.004, y1 - y0 + 0.004, z1 - z0 + 0.004);
  }

  setCrack(x, y, z, stage, box) {
    if (stage < 0) { this.crack.visible = false; this.crackStage = -1; return; }
    if (stage !== this.crackStage) {
      const uv = this.atlas.uv['crack_' + stage];
      const a = this.crackGeo.getAttribute('uv');
      for (let i = 0; i < a.count; i++) {
        const k = i % 4;
        const u = k === 0 || k === 2 ? uv[0] : uv[2];
        const v = k < 2 ? uv[1] : uv[3];
        a.setXY(i, u, v);
      }
      a.needsUpdate = true;
      this.crackStage = stage;
    }
    const [x0, y0, z0, x1, y1, z1] = box || [0, 0, 0, 1, 1, 1];
    this.crack.visible = true;
    this.crack.position.set(x + (x0 + x1) / 2, y + (y0 + y1) / 2, z + (z0 + z1) / 2);
    this.crack.scale.set(x1 - x0, y1 - y0, z1 - z0);
  }

  setFog(near, far, color) {
    const u = this.chunks.uniforms;
    u.uFogNear.value = near; u.uFogFar.value = far;
    u.uFogColor.value.copy(color);
  }

  render(showHand) {
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const g = this.gl;
    g.info.reset();
    g.setClearColor(this.chunks.uniforms.uFogColor.value, 1);
    g.clear(true, true, true);
    g.render(this.scene, this.camera);
    if (showHand) {
      g.clearDepth();
      g.render(this.held.scene, this.held.camera);
    }
  }

  info() { return this.gl.info.render; }
}
