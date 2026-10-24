// ShaftCraft shared constants. Every tunable gameplay number lives here.
// Units: 1 block = 1 meter, time in seconds unless the name says TICKS.

export const VERSION = 'ShaftCraft 1.0.0';
export const PROTOCOL_VERSION = 3;

// ---- Simulation ----
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;
export const ENTITY_BROADCAST_EVERY = 2; // ticks -> 10 Hz
export const INTERP_DELAY_MS = 100;

// ---- World ----
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
export const SEA_LEVEL = 62;
export const BEDROCK_TOP = 1;
export const RENDER_DISTANCE_MIN = 2;
export const RENDER_DISTANCE_MAX = 32;
export const RENDER_DISTANCE_DEFAULT = 8;
export const SERVER_SIM_RADIUS = 5; // chunks simulated around each player
export const SERVER_KEEP_RADIUS = 7; // chunks kept loaded around each player
export const RANDOM_TICKS_PER_SECTION = 3;
export const SUPERFLAT_LAYERS = [['bedrock', 1], ['dirt', 2], ['grass', 1]];

// ---- Ores: [blockName, veinMin, veinMax, yMin, yMax, attemptsPerChunk] ----
export const ORES = [
  ['coal_ore', 8, 17, 5, 128, 20],
  ['iron_ore', 4, 9, 5, 64, 18],
  ['gold_ore', 4, 8, 5, 32, 2],
  ['diamond_ore', 3, 7, 2, 16, 1],
  ['gravel', 10, 33, 5, 128, 8],
  ['dirt', 10, 33, 5, 128, 10],
];

// ---- Player body ----
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const SNEAK_HEIGHT = 1.5;
export const SNEAK_EYE = 1.27;
export const SMALL_HEIGHT = 0.6; // swimming / gliding
export const SMALL_EYE = 0.4;

// ---- Movement (blocks/second) ----
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.6;
export const SNEAK_SPEED = 1.3;
export const FLY_SPEED = 10.9;
export const FLY_SPRINT_SPEED = 21.6;
export const SWIM_SPEED = 2.2;
export const SWIM_SPRINT_SPEED = 3.9;
export const SPECTATOR_SPEED = 12;
export const GRAVITY = 32;
export const JUMP_VELOCITY = 9;
export const TERMINAL_VELOCITY = 78;
export const AIR_DRAG = 0.98; // vertical per tick
export const GROUND_FRICTION = 0.6;
export const ICE_FRICTION = 0.98;
export const AIR_CONTROL = 0.09;
export const WATER_GRAVITY = 4;
export const WATER_DRAG = 0.8;
export const WATER_RISE_ACCEL = 24;
export const WATER_FLOW_PUSH = 0.014; // blocks / tick^2, scaled by level
export const LAVA_DRAG = 0.5;
export const LADDER_CLIMB_SPEED = 2.35;
export const LADDER_MAX_FALL = 3;
export const SPRINT_FOV_MULT = 1.1;
export const DOUBLE_TAP_TICKS = 7;

// ---- Health / damage ----
export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
export const MAX_AIR_TICKS = 300; // 15 s
export const DROWN_DAMAGE = 2; // per second
export const LAVA_DAMAGE_PER_SEC = 4;
export const BURN_AFTER_LAVA_TICKS = 80;
export const BURN_DAMAGE_PER_SEC = 1;
export const VOID_Y = -64;
export const VOID_DAMAGE = 4; // per 10 ticks
export const SUFFOCATE_DAMAGE = 1; // per 10 ticks
export const SAFE_FALL = 3;
export const REGEN_FOOD_MIN = 18;
export const REGEN_INTERVAL_TICKS = 80;
export const SPRINT_FOOD_MIN = 6;
export const EXHAUSTION_PER_FOOD = 4;
export const EXH_SPRINT_PER_M = 0.1;
export const EXH_SWIM_PER_M = 0.01;
export const EXH_JUMP = 0.05;
export const EXH_SPRINT_JUMP = 0.2;
export const EXH_MINE = 0.005;
export const EXH_ATTACK = 0.1;
export const EXH_DAMAGE = 0.1;
export const EXH_REGEN = 6;
export const STARVE_INTERVAL_TICKS = 80;
export const ARMOR_REDUCTION_PER_POINT = 0.04;
export const ARMOR_REDUCTION_MAX = 0.8;
export const CRIT_MULT = 1.5;
export const HURT_COOLDOWN_TICKS = 10;
export const KNOCKBACK = 8; // blocks/sec horizontal
export const KNOCKBACK_UP = 6;
export const RESPAWN_ITEM_DESPAWN_TICKS = 6000;

// ---- Interaction ----
export const REACH_SURVIVAL = 5;
export const REACH_CREATIVE = 6;
export const ATTACK_REACH = 3.5;
export const BREAK_MULT_CORRECT = 1.5;
export const BREAK_MULT_WRONG = 5;
export const BREAK_TIME_TOLERANCE = 0.7;
export const EAT_TICKS = 32; // 1.6 s
export const BOW_DRAW_TICKS = 20;
export const PICKUP_RADIUS = 1.5;
export const PICKUP_DELAY_TICKS = 10;
export const ITEM_DESPAWN_TICKS = 6000; // 5 minutes
export const ITEM_MERGE_RADIUS = 0.75;
export const MAX_STACK = 64;

// ---- Fluids ----
export const WATER_TICK_DELAY = 5;
export const LAVA_TICK_DELAY = 30;
export const WATER_SPREAD = 7;
export const LAVA_SPREAD = 3;

// ---- Time / sky ----
export const DAY_TICKS = 24000;
export const DAWN = 0;
export const NOON = 6000;
export const DUSK = 12000;
export const MIDNIGHT = 18000;
export const MOON_PHASES = 8;
export const NIGHT_MIN_SKY = 4 / 15;
export const STAR_COUNT = 1500;
export const SUN_SIZE = 30;
export const MOON_SIZE = 20;
export const CLOUD_Y = 192;
export const CLOUD_CELL = 12;
export const CLOUD_THICKNESS = 4;
export const CLOUD_SPEED = 0.6;
export const CLOUD_RANGE_CELLS = 32;
export const WEATHER_MIN_TICKS = 12000;
export const WEATHER_MAX_TICKS = 36000;
export const RAIN_MIN_TICKS = 6000;
export const RAIN_MAX_TICKS = 14000;

// ---- Lighting ----
export const MAX_LIGHT = 15;
export const TORCH_LIGHT = 14;
export const LAVA_LIGHT = 15;
export const FURNACE_LIGHT = 13;

// ---- Mobs ----
export const MOB_PATH_RANGE = 16;
export const MOB_PATH_MAX_NODES = 900;
export const MOB_MAX_DROP = 3;
export const PASSIVE_CAP = 10; // per 64-block radius around a player
export const HOSTILE_CAP = 70;
export const HOSTILE_MIN_DIST = 24;
export const HOSTILE_MAX_DIST = 64;
export const DESPAWN_FAR = 128;
export const DESPAWN_RANDOM_DIST = 32;
export const HOSTILE_MAX_BLOCK_LIGHT = 7;
export const PASSIVE_MIN_LIGHT = 9;
export const ZOMBIE_SIGHT = 35;
export const SKELETON_RANGE_MIN = 8;
export const SKELETON_RANGE_MAX = 12;
export const ARROW_SPEED = 30;
export const CREEPER_FUSE_TICKS = 30;
export const CREEPER_RADIUS = 3;
export const CREEPER_DROP_CHANCE = 0.3;
export const EGG_INTERVAL_MIN = 6000;
export const EGG_INTERVAL_MAX = 12000;

// ---- Glider wings ----
export const GLIDER_DURABILITY = 432;
export const GLIDER_OPEN_TICKS = 8;
export const FIREWORK_BOOST_TICKS = 20;

// ---- Furnace ----
export const SMELT_TICKS = 200; // 10 s
export const FUEL_TICKS = {
  coal: 1600, charcoal: 1600, coal_block: 16000, lava_bucket: 20000,
  oak_log: 300, spruce_log: 300, planks: 300, stick: 100,
  crafting_table: 300, chest: 300, ladder: 300, oak_sapling: 100, spruce_sapling: 100,
  wooden_pickaxe: 200, wooden_axe: 200, wooden_shovel: 200, wooden_hoe: 200, wooden_sword: 200,
  bow: 300, door: 200, bed: 300,
};

// ---- Network / anti-cheat ----
export const DEFAULT_PORT = 25570;
export const MAX_PLAYERS = 20;
export const AUTOSAVE_TICKS = 600; // 30 s
export const MOVE_TOLERANCE = 1.6; // multiplier on allowed displacement
export const CHAT_RATE_PER_SEC = 4;
export const ACTION_RATE_PER_SEC = 80;
export const MAX_CHAT_LENGTH = 256;
export const MAX_NAME_LENGTH = 16;

// ---- Difficulty ----
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
export const STARVE_FLOOR = { peaceful: 20, easy: 10, normal: 1, hard: 0 };
export const GAMEMODES = ['survival', 'creative', 'spectator'];

export function dayLightFactor(time) {
  // 1 at noon, NIGHT_MIN_SKY at midnight, smooth transitions at dawn/dusk.
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  const angle = (t / DAY_TICKS) * Math.PI * 2; // 0 dawn
  const s = Math.sin(angle); // >0 day
  const f = Math.min(1, Math.max(0, s * 2.2 + 0.35));
  return NIGHT_MIN_SKY + (1 - NIGHT_MIN_SKY) * f;
}

export function isNight(time) {
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  return t > 12542 && t < 23460;
}
