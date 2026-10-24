// Block registry. Each block: id, name, display, shape, collision, opacity, render pass,
// hardness, preferred tool, harvest tier, drops, sound set, light emission and textures.
//
// Faces: 0 +x (east) 1 -x (west) 2 +y (top) 3 -y (bottom) 4 +z (south) 5 -z (north)
// Horizontal facing meta (f): 0 north(-z) 1 east(+x) 2 south(+z) 3 west(-x)

export const FACING_VEC = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// face index for a horizontal facing value
export const FACING_TO_FACE = [5, 0, 4, 1];

export const TIER = { none: -1, wood: 0, gold: 0, stone: 1, iron: 2, diamond: 3 };

const B = [];
export const BLOCKS = B;
export const BLOCK_BY_NAME = Object.create(null);

function def(id, name, display, props) {
  const b = {
    id, name, display,
    shape: 'cube', // cube | cross | crop | torch | fluid | ladder | door | bed | snow | cactus | farmland | chest | air
    solid: true, // has collision
    full: true, // full opaque cube (culls neighbor faces)
    pass: 'opaque', // opaque | cutout | translucent
    lightOpacity: 15,
    light: 0,
    hardness: 1,
    tool: null,
    tier: TIER.none,
    sound: 'stone',
    tex: null,
    tint: null, // grass | foliage | spruce | water
    replaceable: false,
    item: name, // item dropped / picked; null for none
    drops: null, // (meta, ctx) => [[id, count], ...]
    falls: false,
    needsSupport: false,
    climbable: false,
    flammable: false,
    ...props,
  };
  B[id] = b;
  BLOCK_BY_NAME[name] = b;
  return b;
}

const plant = { shape: 'cross', solid: false, full: false, pass: 'cutout', lightOpacity: 0, hardness: 0, sound: 'grass', needsSupport: true, replaceable: false };

def(0, 'air', 'Air', { shape: 'air', solid: false, full: false, pass: 'none', lightOpacity: 0, hardness: 0, replaceable: true, item: null });
def(1, 'grass', 'Grass Block', { hardness: 0.6, tool: 'shovel', sound: 'grass', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, tint: 'grass', drops: () => [['dirt', 1]] });
def(2, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel', sound: 'dirt', tex: { all: 'dirt' } });
def(3, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'stone' }, drops: () => [['cobblestone', 1]] });
def(4, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'cobblestone' } });
def(5, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', tex: { all: 'sand' }, falls: true });
def(6, 'sandstone', 'Sandstone', { hardness: 0.8, tool: 'pickaxe', tier: TIER.wood, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' } });
def(7, 'gravel', 'Gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', tex: { all: 'gravel' }, falls: true, drops: (m, c) => [[c.rng() < 0.1 ? 'flint' : 'gravel', 1]] });
def(8, 'bedrock', 'Bedrock', { hardness: -1, tex: { all: 'bedrock' } });
def(9, 'water', 'Water', { shape: 'fluid', solid: false, full: false, pass: 'translucent', lightOpacity: 2, hardness: -1, sound: 'water', tex: { all: 'water_still', flow: 'water_flow' }, tint: 'water', replaceable: true, item: null, fluid: 'water' });
def(10, 'lava', 'Lava', { shape: 'fluid', solid: false, full: false, pass: 'opaque', lightOpacity: 15, light: 15, hardness: -1, sound: 'water', tex: { all: 'lava_still', flow: 'lava_flow' }, replaceable: true, item: null, fluid: 'lava' });
def(11, 'oak_log', 'Oak Log', { hardness: 2, tool: 'axe', sound: 'wood', tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' }, flammable: true });
def(12, 'planks', 'Oak Planks', { hardness: 2, tool: 'axe', sound: 'wood', tex: { all: 'planks' }, flammable: true });
def(13, 'leaves', 'Oak Leaves', { full: false, pass: 'cutout', lightOpacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', tex: { all: 'leaves' }, tint: 'foliage', flammable: true, leaves: true,
  drops: (m, c) => {
    if (c.tool === 'shears') return [['leaves', 1]];
    const out = [];
    if (c.rng() < 0.05) out.push(['oak_sapling', 1]);
    if (c.rng() < 0.005) out.push(['apple', 1]);
    if (c.rng() < 0.02) out.push(['stick', 1]);
    return out;
  } });
def(14, 'glass', 'Glass', { full: false, pass: 'cutout', lightOpacity: 0, hardness: 0.3, sound: 'glass', tex: { all: 'glass' }, drops: () => [] });
def(15, 'coal_ore', 'Coal Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'coal_ore' }, drops: () => [['coal', 1]], score: 1 });
def(16, 'iron_ore', 'Iron Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.stone, tex: { all: 'iron_ore' }, score: 2 });
def(17, 'gold_ore', 'Gold Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.iron, tex: { all: 'gold_ore' }, score: 4 });
def(18, 'diamond_ore', 'Diamond Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.iron, tex: { all: 'diamond_ore' }, drops: () => [['diamond', 1]], score: 10 });
def(19, 'coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'coal_block' } });
def(20, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', tier: TIER.stone, sound: 'metal', tex: { all: 'iron_block' } });
def(21, 'gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', tier: TIER.iron, sound: 'metal', tex: { all: 'gold_block' } });
def(22, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', tier: TIER.iron, sound: 'metal', tex: { all: 'diamond_block' } });
def(23, 'crafting_table', 'Crafting Table', { hardness: 2.5, tool: 'axe', sound: 'wood', tex: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: true, interact: 'crafting', flammable: true });
def(24, 'furnace', 'Furnace', { hardness: 3.5, tool: 'pickaxe', tier: TIER.wood, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, facing: true, interact: 'furnace', container: 'furnace' });
def(25, 'furnace_lit', 'Furnace', { hardness: 3.5, tool: 'pickaxe', tier: TIER.wood, light: 13, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, facing: true, interact: 'furnace', container: 'furnace', item: 'furnace' });
def(26, 'chest', 'Chest', { shape: 'chest', full: false, pass: 'opaque', lightOpacity: 0, hardness: 2.5, tool: 'axe', sound: 'wood', tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, facing: true, interact: 'chest', container: 'chest', flammable: true });
def(27, 'torch', 'Torch', { shape: 'torch', solid: false, full: false, pass: 'cutout', lightOpacity: 0, light: 14, hardness: 0, sound: 'wood', tex: { all: 'torch' }, needsSupport: true });
def(28, 'bed', 'Bed', { shape: 'bed', full: false, pass: 'opaque', lightOpacity: 0, hardness: 0.2, sound: 'cloth', tex: { all: 'bed_top_foot' }, interact: 'bed', drops: (m) => (m & 4 ? [] : [['bed', 1]]), needsSupport: true });
def(29, 'ladder', 'Ladder', { shape: 'ladder', solid: true, full: false, pass: 'cutout', lightOpacity: 0, hardness: 0.4, tool: 'axe', sound: 'wood', tex: { all: 'ladder' }, climbable: true, needsSupport: true });
def(30, 'door', 'Oak Door', { shape: 'door', full: false, pass: 'cutout', lightOpacity: 0, hardness: 3, tool: 'axe', sound: 'wood', tex: { all: 'door_lower' }, interact: 'door', drops: (m) => (m & 8 ? [] : [['door', 1]]), needsSupport: true });
def(31, 'snow', 'Snow', { shape: 'snow', solid: false, full: false, pass: 'opaque', lightOpacity: 0, hardness: 0.1, tool: 'shovel', sound: 'snow', tex: { all: 'snow' }, replaceable: true, needsSupport: true });
def(32, 'ice', 'Ice', { full: false, pass: 'translucent', lightOpacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', tex: { all: 'ice' }, slippery: true, drops: () => [] });
def(33, 'cactus', 'Cactus', { shape: 'cactus', full: false, pass: 'cutout', lightOpacity: 0, hardness: 0.4, sound: 'cloth', tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, needsSupport: true, hurts: true });
def(34, 'tall_grass', 'Tall Grass', { ...plant, tex: { all: 'tall_grass' }, tint: 'grass', replaceable: true, drops: (m, c) => (c.tool === 'shears' ? [['tall_grass', 1]] : c.rng() < 0.125 ? [['seeds', 1]] : []) });
def(35, 'poppy', 'Poppy', { ...plant, tex: { all: 'poppy' } });
def(36, 'dandelion', 'Dandelion', { ...plant, tex: { all: 'dandelion' } });
def(37, 'white_wool', 'White Wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', tex: { all: 'wool_white' }, flammable: true });
def(38, 'red_wool', 'Red Wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', tex: { all: 'wool_red' }, flammable: true });
def(39, 'yellow_wool', 'Yellow Wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', tex: { all: 'wool_yellow' }, flammable: true });
def(40, 'black_wool', 'Black Wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', tex: { all: 'wool_black' }, flammable: true });
def(41, 'spruce_log', 'Spruce Log', { hardness: 2, tool: 'axe', sound: 'wood', tex: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log_side' }, flammable: true });
def(42, 'spruce_leaves', 'Spruce Leaves', { full: false, pass: 'cutout', lightOpacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', tex: { all: 'spruce_leaves' }, tint: 'spruce', flammable: true, leaves: true,
  drops: (m, c) => {
    if (c.tool === 'shears') return [['spruce_leaves', 1]];
    const out = [];
    if (c.rng() < 0.05) out.push(['spruce_sapling', 1]);
    if (c.rng() < 0.02) out.push(['stick', 1]);
    return out;
  } });
def(43, 'farmland', 'Farmland', { shape: 'farmland', full: false, lightOpacity: 15, hardness: 0.6, tool: 'shovel', sound: 'dirt', tex: { top: 'farmland_top', bottom: 'dirt', side: 'dirt' }, drops: () => [['dirt', 1]] });
def(44, 'wheat', 'Wheat Crops', { ...plant, shape: 'crop', tex: { all: 'wheat_0' }, item: 'seeds',
  drops: (m, c) => (m >= 7 ? [['wheat', 1], ['seeds', 1 + Math.floor(c.rng() * 3)]] : [['seeds', 1]]) });
def(45, 'sugar_cane', 'Sugar Cane', { ...plant, tex: { all: 'sugar_cane' }, tint: 'grass' });
def(46, 'oak_sapling', 'Oak Sapling', { ...plant, tex: { all: 'oak_sapling' } });
def(47, 'spruce_sapling', 'Spruce Sapling', { ...plant, tex: { all: 'spruce_sapling' } });

// ---- Nether & portals ----
def(48, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', tier: TIER.diamond, tex: { all: 'obsidian' } });
def(49, 'nether_portal', 'Nether Portal', { shape: 'portal', solid: false, full: false, pass: 'translucent', lightOpacity: 0, light: 11, hardness: -1, sound: 'glass', tex: { all: 'nether_portal' }, item: null, portal: true });
def(50, 'netherrack', 'Netherrack', { hardness: 0.4, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'netherrack' } });
def(51, 'soul_sand', 'Soul Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', tex: { all: 'soul_sand' }, slow: 0.4 });
def(52, 'glowstone', 'Glowstone', { hardness: 0.3, sound: 'glass', light: 15, tex: { all: 'glowstone' }, drops: (m, c) => [['glowstone_dust', 2 + Math.floor(c.rng() * 3)]] });
def(53, 'nether_quartz_ore', 'Nether Quartz Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'nether_quartz_ore' }, drops: () => [['quartz', 1]], score: 2 });
def(54, 'nether_gold_ore', 'Nether Gold Ore', { hardness: 3, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'nether_gold_ore' }, drops: (m, c) => [['gold_nugget', 2 + Math.floor(c.rng() * 5)]], score: 2 });
def(55, 'magma_block', 'Magma Block', { hardness: 0.5, tool: 'pickaxe', tier: TIER.wood, light: 3, tex: { all: 'magma' }, hurts: true });
def(56, 'basalt', 'Basalt', { hardness: 1.25, tool: 'pickaxe', tier: TIER.wood, tex: { top: 'basalt_top', bottom: 'basalt_top', side: 'basalt_side' } });

// ---- The End ----
def(57, 'end_stone', 'End Stone', { hardness: 3, tool: 'pickaxe', tier: TIER.wood, tex: { all: 'end_stone' } });
def(58, 'end_portal_frame', 'End Portal Frame', { shape: 'eframe', full: false, hardness: -1, lightOpacity: 15, tex: { top: 'eframe_top', bottom: 'end_stone', side: 'eframe_side' }, item: null });
def(59, 'end_portal', 'End Portal', { shape: 'endportal', solid: false, full: false, pass: 'opaque', lightOpacity: 0, light: 15, hardness: -1, tex: { all: 'end_portal' }, item: null, portal: true });

export const BLOCK_COUNT = B.length;
export const ID = Object.create(null);
for (const b of B) ID[b.name] = b.id;

// Fast lookup tables (indexed by block id) for hot loops.
export const IS_SOLID = new Uint8Array(256);
export const IS_FULL = new Uint8Array(256); // full opaque cube
export const LIGHT_OPACITY = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const IS_FLUID = new Uint8Array(256); // 1 water, 2 lava
export const IS_REPLACEABLE = new Uint8Array(256);
for (const b of B) {
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_FULL[b.id] = b.full ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  LIGHT_EMIT[b.id] = b.light;
  IS_FLUID[b.id] = b.fluid === 'water' ? 1 : b.fluid === 'lava' ? 2 : 0;
  IS_REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
}

export function blockByName(name) {
  return BLOCK_BY_NAME[name] || null;
}

// Texture name for a face of a block with meta. Used by the mesher and icon renderer.
export function faceTex(b, face, meta = 0, ctx = null) {
  const t = b.tex;
  if (!t) return 'stone';
  if (b.facing && t.front) {
    const front = FACING_TO_FACE[meta & 3];
    if (face === front) return t.front;
  }
  if (face === 2) {
    if (b.id === 43) return 'farmland_top';
    return t.top || t.all || t.side;
  }
  if (face === 3) return t.bottom || t.all || t.side;
  if (b.id === 1 && ctx && ctx.snowAbove) return 'grass_side_snowed';
  if (b.id === 44) return 'wheat_' + Math.min(7, meta);
  return t.side || t.all;
}

// Collision boxes in block-local coordinates [x0,y0,z0,x1,y1,z1]. Returns null for none.
const FULL_BOX = [[0, 0, 0, 1, 1, 1]];
export function collisionBoxes(id, meta) {
  const b = B[id];
  if (!b || !b.solid) return null;
  switch (b.shape) {
    case 'cube': return FULL_BOX;
    case 'cactus': return [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
    case 'farmland': return [[0, 0, 0, 1, 15 / 16, 1]];
    case 'bed': return [[0, 0, 0, 1, 9 / 16, 1]];
    case 'chest': return [[1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16]];
    case 'ladder': {
      const f = meta & 3; // ladder faces direction f; it is attached to the wall at -f
      const t = 3 / 16;
      if (f === 0) return [[0, 0, 1 - t, 1, 1, 1]];
      if (f === 2) return [[0, 0, 0, 1, 1, t]];
      if (f === 1) return [[0, 0, 0, t, 1, 1]];
      return [[1 - t, 0, 0, 1, 1, 1]];
    }
    case 'door': return [doorBox(meta)];
    default: return FULL_BOX;
  }
}

// Door: meta bits 0-1 facing, bit 2 open, bit 3 upper half.
// A closed door with facing f sits flush against the side of the cell toward f.
export function doorBox(meta) {
  let f = meta & 3;
  if (meta & 4) f = (f + 1) & 3;
  const t = 3 / 16;
  if (f === 0) return [0, 0, 0, 1, 1, t];
  if (f === 2) return [0, 0, 1 - t, 1, 1, 1];
  if (f === 1) return [1 - t, 0, 0, 1, 1, 1];
  return [0, 0, 0, t, 1, 1];
}

// Selection / outline box (for raycast and highlight).
export function selectionBox(id, meta) {
  const b = B[id];
  switch (b.shape) {
    case 'cross': case 'crop': return [0.15, 0, 0.15, 0.85, b.id === 45 ? 1 : 0.8, 0.85];
    case 'torch': {
      if (!meta) return [0.4, 0, 0.4, 0.6, 0.62, 0.6];
      const [dx, dz] = FACING_VEC[(meta - 1) & 3];
      const cx = 0.5 - dx * 0.35, cz = 0.5 - dz * 0.35;
      return [cx - 0.1, 0.2, cz - 0.1, cx + 0.1, 0.85, cz + 0.1];
    }
    case 'snow': return [0, 0, 0, 1, 2 / 16, 1];
    case 'fluid': return [0, 0, 0, 1, 1, 1];
    default: {
      const boxes = collisionBoxes(id, meta);
      return boxes ? boxes[0] : [0, 0, 0, 1, 1, 1];
    }
  }
}

// Whether the block at (id) needs a solid block under it and what kind.
export function canSurviveOn(id, belowId, meta) {
  const b = B[id];
  const below = B[belowId];
  switch (b.name) {
    case 'tall_grass': case 'poppy': case 'dandelion': case 'oak_sapling': case 'spruce_sapling':
      return belowId === ID.grass || belowId === ID.dirt || belowId === ID.farmland;
    case 'wheat': return belowId === ID.farmland;
    case 'sugar_cane': return belowId === ID.sugar_cane || belowId === ID.grass || belowId === ID.dirt || belowId === ID.sand;
    case 'cactus': return belowId === ID.cactus || belowId === ID.sand;
    case 'snow': return !!below && below.full;
    case 'torch': return true; // handled by attachment check
    case 'ladder': return true;
    default: return !!below && below.solid;
  }
}

export function isFluid(id) { return IS_FLUID[id] !== 0; }
