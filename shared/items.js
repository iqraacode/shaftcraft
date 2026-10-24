// Item registry. Block items are generated automatically from the block registry.
import { BLOCKS, ID } from './blocks.js';
import { GLIDER_DURABILITY, MAX_STACK } from './constants.js';

export const ITEMS = Object.create(null);
export const ITEM_LIST = [];

function add(id, props) {
  const it = { id, display: id, maxStack: MAX_STACK, kind: 'misc', tab: 'misc', ...props };
  ITEMS[id] = it;
  ITEM_LIST.push(it);
  return it;
}

// ---------- Block items ----------
const BUILDING = ['grass', 'dirt', 'stone', 'cobblestone', 'sand', 'sandstone', 'gravel', 'bedrock', 'oak_log', 'spruce_log', 'planks',
  'glass', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'coal_block', 'iron_block', 'gold_block', 'diamond_block',
  'white_wool', 'red_wool', 'yellow_wool', 'black_wool', 'ice', 'farmland'];
const DECOR = ['crafting_table', 'furnace', 'chest', 'torch', 'ladder', 'snow', 'cactus', 'tall_grass', 'poppy', 'dandelion',
  'leaves', 'spruce_leaves', 'oak_sapling', 'spruce_sapling', 'sugar_cane'];
for (const b of BLOCKS) {
  if (!b.item || b.item !== b.name) continue;
  if (b.name === 'furnace_lit' || b.name === 'wheat' || b.name === 'bed' || b.name === 'door') continue;
  add(b.name, {
    display: b.display, kind: 'block', block: b.name,
    tab: BUILDING.includes(b.name) ? 'building' : DECOR.includes(b.name) ? 'decoration' : 'building',
  });
}
ITEMS.sugar_cane.flat = true;
for (const n of ['torch', 'ladder', 'tall_grass', 'poppy', 'dandelion', 'oak_sapling', 'spruce_sapling']) ITEMS[n].flat = true;

// Placeable items with non-block icons
add('bed', { display: 'Bed', kind: 'block', block: 'bed', maxStack: 1, tab: 'decoration', flat: true });
add('door', { display: 'Oak Door', kind: 'block', block: 'door', tab: 'decoration', flat: true });
add('seeds', { display: 'Wheat Seeds', kind: 'block', block: 'wheat', tab: 'misc', flat: true });

// ---------- Materials ----------
const mats = [
  ['stick', 'Stick'], ['coal', 'Coal'], ['charcoal', 'Charcoal'], ['iron_ingot', 'Iron Ingot'], ['gold_ingot', 'Gold Ingot'],
  ['diamond', 'Diamond'], ['string', 'String'], ['leather', 'Leather'], ['feather', 'Feather'], ['bone', 'Bone'],
  ['flint', 'Flint'], ['gunpowder', 'Gunpowder'], ['paper', 'Paper'], ['wheat', 'Wheat'], ['red_dye', 'Red Dye'],
  ['yellow_dye', 'Yellow Dye'], ['bone_meal', 'Bone Meal'], ['wing_membrane', 'Wing Membrane'], ['emerald', 'Emerald'], ['glider_frame', 'Glider Frame'],
];
for (const [id, display] of mats) add(id, { display, flat: true });
ITEMS.bone_meal.use = 'bonemeal';
add('arrow', { display: 'Arrow', flat: true, tab: 'combat' });
add('flint_and_steel', { display: 'Flint and Steel', kind: 'tool', maxStack: 1, durability: 64, flat: true, use: 'ignite', tool: { type: 'ignite', tier: 0, speed: 1, damage: 1, attackSpeed: 4 }, tab: 'tools' });
for (const [id, display] of [['quartz', 'Nether Quartz'], ['glowstone_dust', 'Glowstone Dust'], ['gold_nugget', 'Gold Nugget']]) add(id, { display, flat: true });
add('ender_pearl', { display: 'Ender Pearl', maxStack: 16, flat: true, use: 'pearl', tab: 'misc' });
add('eye_of_ender', { display: 'Eye of Ender', flat: true, use: 'eye', tab: 'misc' });
add('egg', { display: 'Egg', maxStack: 16, flat: true, use: 'throw', tab: 'misc' });
add('firework_rocket', { display: 'Firework Rocket', flat: true, use: 'firework', tab: 'misc' });

// ---------- Food ----------
const foods = [
  ['apple', 'Apple', 4, 2.4], ['bread', 'Bread', 5, 6], ['porkchop', 'Raw Porkchop', 3, 1.8], ['cooked_porkchop', 'Cooked Porkchop', 8, 12.8],
  ['beef', 'Raw Beef', 3, 1.8], ['cooked_beef', 'Steak', 8, 12.8], ['chicken', 'Raw Chicken', 2, 1.2], ['cooked_chicken', 'Cooked Chicken', 6, 7.2],
  ['mutton', 'Raw Mutton', 2, 1.2], ['cooked_mutton', 'Cooked Mutton', 6, 9.6], ['rotten_flesh', 'Rotten Flesh', 4, 0.8],
];
for (const [id, display, hunger, sat] of foods) add(id, { display, kind: 'food', food: { hunger, sat }, tab: 'food', flat: true });
add('milk_bucket', { display: 'Milk Bucket', kind: 'food', food: { hunger: 2, sat: 1, drink: true, returns: 'bucket', extinguish: true }, maxStack: 1, tab: 'food', flat: true });

// ---------- Buckets ----------
add('bucket', { display: 'Bucket', maxStack: 16, use: 'bucket', tab: 'tools', flat: true });
add('water_bucket', { display: 'Water Bucket', maxStack: 1, use: 'bucket', fluid: 'water', tab: 'tools', flat: true });
add('lava_bucket', { display: 'Lava Bucket', maxStack: 1, use: 'bucket', fluid: 'lava', tab: 'tools', flat: true });

// ---------- Tools ----------
export const TOOL_TIERS = {
  wooden: { name: 'Wooden', tier: 0, uses: 59, speed: 2, color: '#8b6a3c' },
  stone: { name: 'Stone', tier: 1, uses: 131, speed: 4, color: '#8a8a8a' },
  iron: { name: 'Iron', tier: 2, uses: 250, speed: 6, color: '#d8d8d8' },
  golden: { name: 'Golden', tier: 0, uses: 32, speed: 12, color: '#f2d74a' },
  diamond: { name: 'Diamond', tier: 3, uses: 1561, speed: 8, color: '#5ce8de' },
};
const SWORD_DMG = { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7 };
const AXE_DMG = { wooden: 3, stone: 4, iron: 5, golden: 3, diamond: 6 };
const PICK_DMG = { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5 };
const SHOVEL_DMG = { wooden: 1.5, stone: 2.5, iron: 3.5, golden: 1.5, diamond: 4.5 };
const ATTACK_SPEED = { sword: 1.6, axe: 0.9, pickaxe: 1.2, shovel: 1.0, hoe: 2.0 };
export const HAND_DAMAGE = 1;
export const HAND_ATTACK_SPEED = 4;

for (const [mat, t] of Object.entries(TOOL_TIERS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
    const dmg = type === 'sword' ? SWORD_DMG[mat] : type === 'axe' ? AXE_DMG[mat] : type === 'pickaxe' ? PICK_DMG[mat] : type === 'shovel' ? SHOVEL_DMG[mat] : 1;
    add(`${mat}_${type}`, {
      display: `${t.name} ${type[0].toUpperCase() + type.slice(1)}`,
      kind: 'tool', maxStack: 1, durability: t.uses, flat: true, handheld: true,
      tool: { type, tier: t.tier, speed: type === 'sword' ? 1 : t.speed, damage: dmg, attackSpeed: ATTACK_SPEED[type], material: mat },
      tab: type === 'sword' ? 'combat' : 'tools',
      use: type === 'hoe' ? 'till' : undefined,
    });
  }
}
add('shears', { display: 'Shears', kind: 'tool', maxStack: 1, durability: 238, flat: true, handheld: true, tool: { type: 'shears', tier: 0, speed: 5, damage: 1, attackSpeed: 4 }, tab: 'tools' });
add('bow', { display: 'Bow', kind: 'bow', maxStack: 1, durability: 384, flat: true, handheld: true, use: 'bow', tab: 'combat' });

// ---------- Armor ----------
export const ARMOR_MATS = {
  leather: { name: 'Leather', points: [1, 3, 2, 1], dur: [55, 80, 75, 65], color: '#8f5a32' },
  golden: { name: 'Golden', points: [2, 5, 3, 1], dur: [77, 112, 105, 91], color: '#f2d74a' },
  iron: { name: 'Iron', points: [2, 6, 5, 2], dur: [165, 240, 225, 195], color: '#d8d8d8' },
  diamond: { name: 'Diamond', points: [3, 8, 6, 3], dur: [363, 528, 495, 429], color: '#5ce8de' },
};
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
for (const [mat, a] of Object.entries(ARMOR_MATS)) {
  ARMOR_SLOTS.forEach((slot, i) => {
    add(`${mat}_${slot}`, {
      display: `${a.name} ${slot[0].toUpperCase() + slot.slice(1)}`,
      kind: 'armor', maxStack: 1, durability: a.dur[i], flat: true,
      armor: { slot: i, points: a.points[i], material: mat }, tab: 'combat',
    });
  });
}
add('glider_wings', { display: 'Glider Wings', kind: 'armor', maxStack: 1, durability: GLIDER_DURABILITY, flat: true, armor: { slot: 1, points: 0, material: 'glider', glider: true }, tab: 'combat' });

export const CREATIVE_TABS = [
  { id: 'building', name: 'Building Blocks', icon: 'cobblestone' },
  { id: 'decoration', name: 'Decoration', icon: 'poppy' },
  { id: 'tools', name: 'Tools', icon: 'iron_pickaxe' },
  { id: 'combat', name: 'Combat', icon: 'diamond_sword' },
  { id: 'food', name: 'Food', icon: 'apple' },
  { id: 'misc', name: 'Misc', icon: 'stick' },
];

export function getItem(id) { return ITEMS[id] || null; }
export function maxStackOf(id) { const it = ITEMS[id]; return it ? it.maxStack : MAX_STACK; }
export function blockIdOfItem(id) { const it = ITEMS[id]; return it && it.block ? ID[it.block] : -1; }
export function isTool(id) { const it = ITEMS[id]; return !!(it && it.tool); }
export function itemName(id) { const it = ITEMS[id]; return it ? it.display : id; }

// Stacks are plain objects { id, count, dmg? } or null. dmg = durability used.
export function makeStack(id, count = 1, dmg = 0) {
  if (!ITEMS[id]) return null;
  const s = { id, count };
  if (dmg) s.dmg = dmg;
  return s;
}
export function sameItem(a, b) { return !!a && !!b && a.id === b.id && (a.dmg || 0) === (b.dmg || 0); }
export function cloneStack(s) { return s ? { ...s } : null; }

// Item ids that a "pick block" on a block yields.
export function pickItemForBlock(blockId) {
  const b = BLOCKS[blockId];
  if (!b) return null;
  if (b.name === 'wheat') return 'seeds';
  if (b.name === 'furnace_lit') return 'furnace';
  if (b.name === 'water') return 'water_bucket';
  if (b.name === 'lava') return 'lava_bucket';
  if (ITEMS[b.name]) return b.name;
  return null;
}
