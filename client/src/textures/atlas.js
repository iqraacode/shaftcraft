// Packs all 16x16 tiles into a 256x256 atlas with 1px edge padding (no bleeding with
// nearest filtering) and animates water/lava/torch tiles by redrawing them periodically.
import * as THREE from 'three';
import { TILES, ANIMATED, generateTiles } from './texgen.js';

export const ATLAS_SIZE = 256;
const CELL = 18; // 16 + 2px padding
const PER_ROW = Math.floor(ATLAS_SIZE / CELL);

export class Atlas {
  constructor() {
    generateTiles();
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE; this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.uv = Object.create(null); // name -> [u0, v0, u1, v1] (v from top, flipped later)
    this.pos = Object.create(null);
    const names = Object.keys(TILES);
    if (names.length > PER_ROW * PER_ROW) throw new Error('Atlas overflow: ' + names.length);
    names.forEach((name, i) => {
      const cx = (i % PER_ROW) * CELL + 1, cy = Math.floor(i / PER_ROW) * CELL + 1;
      this.pos[name] = [cx, cy];
      this.drawTile(name, TILES[name]);
      // UVs in GL convention (v=0 bottom). Canvas y down -> flipY on texture is false, so compute directly.
      this.uv[name] = [cx / ATLAS_SIZE, cy / ATLAS_SIZE, (cx + 16) / ATLAS_SIZE, (cy + 16) / ATLAS_SIZE];
    });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.frameTick = 0;
  }

  drawTile(name, img) {
    const [x, y] = this.pos[name];
    const ctx = this.ctx;
    ctx.putImageData(img, x, y);
    // replicate edges into the padding
    ctx.putImageData(img, x - 1, y, 0, 0, 1, 16);
    ctx.putImageData(img, x + 1, y, 15, 0, 1, 16);
    ctx.putImageData(img, x, y - 1, 0, 0, 16, 1);
    ctx.putImageData(img, x, y + 1, 0, 15, 16, 1);
    ctx.putImageData(img, x, y, 0, 0, 16, 16);
  }

  // Called once per game tick (20 Hz).
  animate() {
    this.frameTick++;
    let changed = false;
    for (const [name, a] of Object.entries(ANIMATED)) {
      if (this.frameTick % a.ticksPerFrame !== 0) continue;
      const f = Math.floor(this.frameTick / a.ticksPerFrame) % a.frames.length;
      this.drawTile(name, a.frames[f]);
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  tileUVs() { return this.uv; }
}
