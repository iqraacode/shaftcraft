// Chunk mesher (runs in a Web Worker). Builds three geometry passes (opaque, cutout,
// translucent) with face culling, smooth lighting, vertex ambient occlusion, biome tints,
// fluids with sloped surfaces, cross plants, crops, torches, doors, beds, ladders and more.
import { BLOCKS, ID, IS_FULL, IS_FLUID, faceTex, doorBox, FACING_VEC } from '../../../shared/blocks.js';
import { BIOME_COLORS, SPRUCE_COLOR } from '../../../shared/worldgen.js';

const P = 18;
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO_CURVE = [0.42, 0.6, 0.78, 1.0];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// corners in BL, BR, TR, TL order (CCW seen from outside)
const CORNERS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

class Buf {
  constructor(n = 4096) {
    this.pos = new Float32Array(n * 3); this.uv = new Float32Array(n * 2);
    this.lt = new Uint8Array(n * 4); this.col = new Uint8Array(n * 4);
    this.idx = new Uint32Array(n * 1.5); this.v = 0; this.i = 0; this.cap = n;
  }
  grow() {
    const n = this.cap * 2;
    const g = (a, k, T) => { const b = new T(n * k); b.set(a); return b; };
    this.pos = g(this.pos, 3, Float32Array); this.uv = g(this.uv, 2, Float32Array);
    this.lt = g(this.lt, 4, Uint8Array); this.col = g(this.col, 4, Uint8Array);
    const ni = new Uint32Array(n * 1.5); ni.set(this.idx); this.idx = ni;
    this.cap = n;
  }
  vert(x, y, z, u, v, sky, blk, shade, flag, r, g, b) {
    if (this.v >= this.cap) this.grow();
    const k = this.v;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.uv[k * 2] = u; this.uv[k * 2 + 1] = v;
    this.lt[k * 4] = sky; this.lt[k * 4 + 1] = blk; this.lt[k * 4 + 2] = shade; this.lt[k * 4 + 3] = flag;
    this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = 255;
    this.v++;
  }
  quad(flip) {
    if (this.i + 6 > this.idx.length) { const ni = new Uint32Array(this.idx.length * 2); ni.set(this.idx); this.idx = ni; }
    const b = this.v - 4;
    if (!flip) { this.idx[this.i++] = b; this.idx[this.i++] = b + 1; this.idx[this.i++] = b + 2; this.idx[this.i++] = b; this.idx[this.i++] = b + 2; this.idx[this.i++] = b + 3; }
    else { this.idx[this.i++] = b + 1; this.idx[this.i++] = b + 2; this.idx[this.i++] = b + 3; this.idx[this.i++] = b + 1; this.idx[this.i++] = b + 3; this.idx[this.i++] = b; }
  }
  result() {
    if (!this.v) return null;
    return {
      pos: this.pos.slice(0, this.v * 3), uv: this.uv.slice(0, this.v * 2), lt: this.lt.slice(0, this.v * 4),
      col: this.col.slice(0, this.v * 4), idx: this.v > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i)),
    };
  }
}

function rgbOf(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
const BIOME_RGB = BIOME_COLORS.map((b) => b.map(rgbOf));
const SPRUCE_RGB = rgbOf(SPRUCE_COLOR);

export function meshChunk(job, UV) {
  const { H, blocks, light, meta, biome, smooth } = job;
  const opaque = new Buf(8192), cutout = new Buf(2048), trans = new Buf(1024);
  const pi = (x, y, z) => (y * P + (z + 1)) * P + (x + 1);
  const bid = (x, y, z) => (y < 0 ? ID.bedrock : y >= H ? 0 : blocks[pi(x, y, z)]);
  const lt = (x, y, z) => (y < 0 ? 0 : y >= H ? 0xf0 : light[pi(x, y, z)]);
  const mt = (x, y, z) => (y < 0 || y >= H ? 0 : meta[pi(x, y, z)]);

  // per-column blended biome tints (3x3 average)
  const tints = [new Uint8Array(P * P * 3), new Uint8Array(P * P * 3), new Uint8Array(P * P * 3)];
  for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
    for (let k = 0; k < 3; k++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < -1 || xx > 16 || zz < -1 || zz > 16) continue;
        const c = BIOME_RGB[biome[(zz + 1) * P + xx + 1]][k];
        r += c[0]; g += c[1]; b += c[2]; n++;
      }
      const o = ((z + 1) * P + x + 1) * 3;
      tints[k][o] = r / n; tints[k][o + 1] = g / n; tints[k][o + 2] = b / n;
    }
  }
  const tintOf = (b, x, z) => {
    if (!b.tint) return null;
    if (b.tint === 'spruce') return SPRUCE_RGB;
    const k = b.tint === 'grass' ? 0 : b.tint === 'foliage' ? 1 : 2;
    const o = ((z + 1) * P + x + 1) * 3;
    return [tints[k][o], tints[k][o + 1], tints[k][o + 2]];
  };

  const sc = [0, 0, 0, 0], bc = [0, 0, 0, 0], ao = [0, 0, 0, 0];
  // Light + AO for a full-cell face corner set
  const cornerLight = (x, y, z, face) => {
    const n = NORMALS[face];
    const nx = x + n[0], ny = y + n[1], nz = z + n[2];
    const base = lt(nx, ny, nz);
    if (!smooth) {
      for (let c = 0; c < 4; c++) { sc[c] = base >> 4; bc[c] = base & 15; ao[c] = 3; }
      return;
    }
    const corners = CORNERS[face];
    for (let c = 0; c < 4; c++) {
      const cc = corners[c];
      // tangent offsets
      let t1x = 0, t1y = 0, t1z = 0, t2x = 0, t2y = 0, t2z = 0;
      if (n[0] !== 0) { t1y = cc[1] ? 1 : -1; t2z = cc[2] ? 1 : -1; }
      else if (n[1] !== 0) { t1x = cc[0] ? 1 : -1; t2z = cc[2] ? 1 : -1; }
      else { t1x = cc[0] ? 1 : -1; t2y = cc[1] ? 1 : -1; }
      const s1 = IS_FULL[bid(nx + t1x, ny + t1y, nz + t1z)];
      const s2 = IS_FULL[bid(nx + t2x, ny + t2y, nz + t2z)];
      const cr = IS_FULL[bid(nx + t1x + t2x, ny + t1y + t2y, nz + t1z + t2z)];
      ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
      let ss = base >> 4, bb = base & 15, cnt = 1;
      if (!s1) { const l = lt(nx + t1x, ny + t1y, nz + t1z); ss += l >> 4; bb += l & 15; cnt++; }
      if (!s2) { const l = lt(nx + t2x, ny + t2y, nz + t2z); ss += l >> 4; bb += l & 15; cnt++; }
      if (!cr && !(s1 && s2)) { const l = lt(nx + t1x + t2x, ny + t1y + t2y, nz + t1z + t2z); ss += l >> 4; bb += l & 15; cnt++; }
      sc[c] = ss / cnt; bc[c] = bb / cnt;
    }
  };

  // Emit a face of an axis-aligned box. box = [x0,y0,z0,x1,y1,z1] local to the cell.
  const emitFace = (buf, x, y, z, face, box, tex, tint, opts) => {
    const uv = UV[tex] || UV.stone;
    const corners = CORNERS[face];
    const shadeF = opts && opts.noShade ? 1 : FACE_SHADE[face];
    const rot = opts && opts.rot ? opts.rot : 0;
    const crop = !(opts && opts.noCrop);
    const tr = tint ? tint[0] : 255, tg = tint ? tint[1] : 255, tb = tint ? tint[2] : 255;
    const flag = opts && opts.wave ? 255 : 0;
    const su = [0, 0, 0, 0], sv = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const cc = corners[c];
      const px = cc[0] ? box[3] : box[0], py = cc[1] ? box[4] : box[1], pz = cc[2] ? box[5] : box[2];
      let s, t;
      if (!crop) { s = (c === 1 || c === 2) ? 1 : 0; t = c >= 2 ? 1 : 0; }
      else if (face === 0) { s = 1 - pz; t = py; }
      else if (face === 1) { s = pz; t = py; }
      else if (face === 2) { s = px; t = 1 - pz; }
      else if (face === 3) { s = px; t = pz; }
      else if (face === 4) { s = px; t = py; }
      else { s = 1 - px; t = py; }
      su[c] = s; sv[c] = t;
    }
    for (let c = 0; c < 4; c++) {
      const k = (c + rot) & 3;
      const cc = corners[c];
      const px = cc[0] ? box[3] : box[0], py = cc[1] ? box[4] : box[1], pz = cc[2] ? box[5] : box[2];
      const u = uv[0] + su[k] * (uv[2] - uv[0]);
      const v = uv[3] - sv[k] * (uv[3] - uv[1]);
      let sky, blk, shade;
      if (opts && opts.flatLight !== undefined) { sky = (opts.flatLight >> 4) * 17; blk = (opts.flatLight & 15) * 17; shade = shadeF * 255; }
      else { sky = sc[c] * 17; blk = bc[c] * 17; shade = shadeF * AO_CURVE[ao[c]] * 255; }
      const yy = opts && opts.heights ? (cc[1] ? opts.heights[c] : py) : py;
      buf.vert(x + px, y + yy, z + pz, u, v, sky, blk, shade, flag && cc[1] ? flag : 0, tr, tg, tb);
    }
    const flip = !(opts && opts.flatLight !== undefined) && ao[0] + ao[2] < ao[1] + ao[3];
    buf.quad(flip);
    if (opts && opts.doubleSided) {
      // duplicate with reversed winding
      const b = buf.v - 4;
      for (let c = 3; c >= 0; c--) {
        const s = b + c;
        buf.vert(buf.pos[s * 3], buf.pos[s * 3 + 1], buf.pos[s * 3 + 2], buf.uv[s * 2], buf.uv[s * 2 + 1], buf.lt[s * 4], buf.lt[s * 4 + 1], buf.lt[s * 4 + 2], buf.lt[s * 4 + 3], buf.col[s * 4], buf.col[s * 4 + 1], buf.col[s * 4 + 2]);
      }
      buf.quad(false);
    }
  };

  // Free-form quad (for crosses / torches): 4 positions, 4 uvs (s,t in tile space)
  const emitQuad = (buf, verts, tex, st, light, tint, shade = 1, both = true) => {
    const uv = UV[tex] || UV.stone;
    const tr = tint ? tint[0] : 255, tg = tint ? tint[1] : 255, tb = tint ? tint[2] : 255;
    const sky = (light >> 4) * 17, blk = (light & 15) * 17;
    for (let c = 0; c < 4; c++) {
      const u = uv[0] + st[c][0] * (uv[2] - uv[0]);
      const v = uv[3] - st[c][1] * (uv[3] - uv[1]);
      buf.vert(verts[c][0], verts[c][1], verts[c][2], u, v, sky, blk, shade * 255, 0, tr, tg, tb);
    }
    buf.quad(false);
    if (both) {
      for (let c = 3; c >= 0; c--) {
        const u = uv[0] + st[c][0] * (uv[2] - uv[0]);
        const v = uv[3] - st[c][1] * (uv[3] - uv[1]);
        buf.vert(verts[c][0], verts[c][1], verts[c][2], u, v, sky, blk, shade * 255, 0, tr, tg, tb);
      }
      buf.quad(false);
    }
  };
  const ST = [[0, 0], [1, 0], [1, 1], [0, 1]];

  const FULLBOX = [0, 0, 0, 1, 1, 1];

  const fluidLevelHeight = (id, x, y, z) => {
    const b = bid(x, y, z);
    if (b !== id) return -1;
    if (bid(x, y + 1, z) === id) return 1;
    const m = mt(x, y, z);
    if (m & 8) return 1;
    return (8 - (m & 7)) / 9;
  };
  const cornerHeight = (id, x, y, z, cx, cz) => {
    // average of the 4 cells sharing corner (cx,cz offsets are 0 or 1)
    let sum = 0, n = 0;
    for (let dz = cz - 1; dz <= cz; dz++) for (let dx = cx - 1; dx <= cx; dx++) {
      if (bid(x + dx, y + 1, z + dz) === id) return 1;
      const h = fluidLevelHeight(id, x + dx, y, z + dz);
      if (h >= 0) { sum += h; n++; }
    }
    return n ? sum / n : 0.1;
  };

  for (let y = 0; y < H; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const id = blocks[pi(x, y, z)];
    if (id === 0) continue;
    const b = BLOCKS[id];
    if (!b) continue;
    const m = mt(x, y, z);
    const own = lt(x, y, z);
    switch (b.shape) {
      case 'cube': {
        const buf = b.pass === 'cutout' ? cutout : b.pass === 'translucent' ? trans : opaque;
        const tint = tintOf(b, x, z);
        const snowAbove = id === ID.grass && (bid(x, y + 1, z) === ID.snow);
        for (let f = 0; f < 6; f++) {
          const n = NORMALS[f];
          const nid = bid(x + n[0], y + n[1], z + n[2]);
          if (IS_FULL[nid]) continue;
          if (nid === id && !b.leaves) continue;
          cornerLight(x, y, z, f);
          const tex = faceTex(b, f, m, snowAbove ? { snowAbove } : null);
          const ftint = (snowAbove && f !== 2 && f !== 3) ? null : tint;
          emitFace(buf, x, y, z, f, FULLBOX, tex, ftint);
        }
        break;
      }
      case 'cross': {
        const tint = tintOf(b, x, z);
        const tex = faceTex(b, 4, m);
        const a = 0.15, c = 0.85, h = 1;
        emitQuad(cutout, [[x + a, y, z + a], [x + c, y, z + c], [x + c, y + h, z + c], [x + a, y + h, z + a]], tex, ST, own, tint);
        emitQuad(cutout, [[x + a, y, z + c], [x + c, y, z + a], [x + c, y + h, z + a], [x + a, y + h, z + c]], tex, ST, own, tint);
        break;
      }
      case 'crop': {
        const tex = faceTex(b, 4, m);
        for (const o of [0.25, 0.75]) {
          emitQuad(cutout, [[x + o, y - 1 / 16, z], [x + o, y - 1 / 16, z + 1], [x + o, y + 15 / 16, z + 1], [x + o, y + 15 / 16, z]], tex, ST, own, null);
          emitQuad(cutout, [[x, y - 1 / 16, z + o], [x + 1, y - 1 / 16, z + o], [x + 1, y + 15 / 16, z + o], [x, y + 15 / 16, z + o]], tex, ST, own, null);
        }
        break;
      }
      case 'torch': {
        const l = (own & 0xf0) | 14;
        const s0 = 7 / 16, s1 = 9 / 16, h = 10 / 16;
        let ox = 0, oz = 0, lx = 0, lz = 0, oy = 0;
        if (m) {
          const [dx, dz] = FACING_VEC[(m - 1) & 3];
          ox = -dx * 0.35; oz = -dz * 0.35; lx = dx * 0.3; lz = dz * 0.3; oy = 0.2;
        }
        const P0 = (px, py, pz) => [x + px + ox + lx * py / h, y + py + oy, z + pz + oz + lz * py / h];
        const stSide = [[7 / 16, 0], [9 / 16, 0], [9 / 16, 10 / 16], [7 / 16, 10 / 16]];
        const faces = [
          [[s1, 0, s1], [s1, 0, s0], [s1, h, s0], [s1, h, s1]],
          [[s0, 0, s0], [s0, 0, s1], [s0, h, s1], [s0, h, s0]],
          [[s0, 0, s1], [s1, 0, s1], [s1, h, s1], [s0, h, s1]],
          [[s1, 0, s0], [s0, 0, s0], [s0, h, s0], [s1, h, s0]],
        ];
        for (const f of faces) emitQuad(cutout, f.map((p) => P0(...p)), 'torch', stSide, l, null, 1, false);
        const stTop = [[7 / 16, 8 / 16], [9 / 16, 8 / 16], [9 / 16, 10 / 16], [7 / 16, 10 / 16]];
        emitQuad(cutout, [P0(s0, h, s1), P0(s1, h, s1), P0(s1, h, s0), P0(s0, h, s0)], 'torch', stTop, l, null, 1, false);
        break;
      }
      case 'ladder': {
        const f = m & 3;
        const t = 1 / 16;
        let box;
        if (f === 0) box = [0, 0, 1 - t, 1, 1, 1 - t + 0.001];
        else if (f === 2) box = [0, 0, t - 0.001, 1, 1, t];
        else if (f === 1) box = [t - 0.001, 0, 0, t, 1, 1];
        else box = [1 - t, 0, 0, 1 - t + 0.001, 1, 1];
        const faceA = f === 0 ? 5 : f === 2 ? 4 : f === 1 ? 0 : 1;
        emitFace(cutout, x, y, z, faceA, box, 'ladder', null, { flatLight: own, noShade: false, doubleSided: true });
        break;
      }
      case 'door': {
        const box = doorBox(m);
        const tex = m & 8 ? 'door_upper' : 'door_lower';
        for (let f = 0; f < 6; f++) {
          if ((f === 2 && (m & 8) === 0) || (f === 3 && (m & 8))) continue;
          emitFace(cutout, x, y, z, f, box, tex, null, { flatLight: own, doubleSided: false });
        }
        break;
      }
      case 'bed': {
        const f = m & 3;
        const head = (m & 4) !== 0;
        const box = [0, 0, 0, 1, 9 / 16, 1];
        // top
        emitFace(opaque, x, y, z, 2, box, head ? 'bed_top_head' : 'bed_top_foot', null, { flatLight: own, rot: f });
        for (let fc = 0; fc < 6; fc++) {
          if (fc === 2) continue;
          const n = NORMALS[fc];
          if (fc === 3 && IS_FULL[bid(x, y - 1, z)]) continue;
          if (fc !== 3 && bid(x + n[0], y, z + n[2]) === ID.bed) continue;
          emitFace(cutout, x, y, z, fc, box, fc === 3 ? 'planks' : 'bed_side', null, { flatLight: own });
        }
        break;
      }
      case 'eframe': {
        const box = [0, 0, 0, 1, 13 / 16, 1];
        for (let f = 0; f < 6; f++) {
          const n = NORMALS[f];
          if (f === 3 && IS_FULL[bid(x, y - 1, z)]) continue;
          const nl = lt(x + n[0], y + n[1], z + n[2]);
          emitFace(opaque, x, y, z, f, box, faceTex(b, f, m), null, { flatLight: f === 2 ? lt(x, y + 1, z) : nl });
        }
        if (m & 1) for (let f = 0; f < 6; f++) if (f !== 3) emitFace(opaque, x, y, z, f, [4 / 16, 13 / 16, 4 / 16, 12 / 16, 1, 12 / 16], 'eframe_eye', null, { flatLight: lt(x, y + 1, z) });
        break;
      }
      case 'endportal': {
        emitFace(opaque, x, y, z, 2, [0, 0, 0, 1, 12 / 16, 1], 'end_portal', null, { flatLight: 0xff, noShade: true });
        break;
      }
      case 'portal': {
        const ax = m & 1;
        const box = ax === 0 ? [0, 0, 6 / 16, 1, 1, 10 / 16] : [6 / 16, 0, 0, 10 / 16, 1, 1];
        for (let f = 0; f < 6; f++) {
          const n = NORMALS[f];
          if (bid(x + n[0], y + n[1], z + n[2]) === id) continue;
          emitFace(trans, x, y, z, f, box, 'nether_portal', null, { flatLight: 0xff, noShade: true, noCrop: true });
        }
        break;
      }
      case 'snow': case 'farmland': case 'chest': case 'cactus': {
        let box;
        if (b.shape === 'snow') box = [0, 0, 0, 1, 2 / 16, 1];
        else if (b.shape === 'farmland') box = [0, 0, 0, 1, 15 / 16, 1];
        else if (b.shape === 'chest') box = [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16];
        else box = [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16];
        const buf = b.shape === 'cactus' ? cutout : opaque;
        for (let f = 0; f < 6; f++) {
          const n = NORMALS[f];
          const nid = bid(x + n[0], y + n[1], z + n[2]);
          if (f === 3 && IS_FULL[nid]) continue;
          if (b.shape === 'snow' || b.shape === 'farmland') { if (f !== 2 && f !== 3 && IS_FULL[nid]) continue; }
          if (b.shape === 'cactus' && (f === 2 || f === 3) && nid === ID.cactus) continue;
          const tex = faceTex(b, f, m);
          const nl = lt(x + n[0], y + n[1], z + n[2]);
          const fl = Math.max(own >> 4, nl >> 4) << 4 | Math.max(own & 15, nl & 15);
          if (b.shape === 'cactus' && f !== 2 && f !== 3) emitFace(buf, x, y, z, f, box, tex, null, { flatLight: fl, noCrop: true });
          else emitFace(buf, x, y, z, f, box, tex, null, { flatLight: fl });
        }
        break;
      }
      case 'fluid': {
        const water = IS_FLUID[id] === 1;
        const buf = water ? trans : opaque;
        const tint = water ? tintOf(b, x, z) : null;
        const still = water ? 'water_still' : 'lava_still';
        const flow = water ? 'water_flow' : 'lava_flow';
        const l = water ? own : 0xff;
        const aboveSame = bid(x, y + 1, z) === id;
        const h = [
          cornerHeight(id, x, y, z, 0, 1), cornerHeight(id, x, y, z, 1, 1),
          cornerHeight(id, x, y, z, 1, 0), cornerHeight(id, x, y, z, 0, 0),
        ]; // BL(0,1) BR(1,1) TR(1,0) TL(0,0) for top face corners
        if (!aboveSame) {
          // flow direction for texture rotation
          const lvl = (m & 8) ? 0 : m & 7;
          let fx = (h[0] + h[3]) - (h[1] + h[2]), fz = (h[2] + h[3]) - (h[0] + h[1]);
          let tex = still, rot = 0;
          if ((lvl > 0 || (m & 8)) && (Math.abs(fx) > 0.01 || Math.abs(fz) > 0.01)) {
            tex = flow;
            if (Math.abs(fx) > Math.abs(fz)) rot = fx > 0 ? 1 : 3; else rot = fz > 0 ? 2 : 0;
          }
          const top = Math.max(...h);
          const surface = IS_FULL[bid(x, y + 1, z)] ? false : true;
          emitFace(buf, x, y, z, 2, [0, 0, 0, 1, top, 1], tex, tint, { flatLight: Math.max(l, lt(x, y + 1, z)), heights: h, rot, wave: water && surface, doubleSided: water });
        }
        // sides
        for (const f of [0, 1, 4, 5]) {
          const n = NORMALS[f];
          const nid = bid(x + n[0], y, z + n[2]);
          if (nid === id || IS_FULL[nid]) continue;
          if (water && nid === ID.ice) continue;
          const fh = (f === 0) ? [0, 0, h[2], h[1]] : (f === 1) ? [0, 0, h[0], h[3]] : (f === 4) ? [0, 0, h[1], h[0]] : [0, 0, h[3], h[2]];
          const hh = aboveSame ? [0, 0, 1, 1] : fh;
          emitFace(buf, x, y, z, f, [0, 0, 0, 1, Math.max(hh[2], hh[3]), 1], flow, tint, { flatLight: Math.max(l, lt(x + n[0], y, z + n[2])), heights: hh, doubleSided: water });
        }
        const below = bid(x, y - 1, z);
        if (below !== id && !IS_FULL[below]) emitFace(buf, x, y, z, 3, FULLBOX, still, tint, { flatLight: Math.max(l, lt(x, y - 1, z)), doubleSided: water });
        break;
      }
      default:
    }
  }
  return { opaque: opaque.result(), cutout: cutout.result(), trans: trans.result() };
}
