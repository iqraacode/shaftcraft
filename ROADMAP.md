# ShaftCraft Roadmap

Baseline: content inspired by Minecraft Java Edition **1.20.x** (original procedural assets only).
Dimensions are separate walled regions of one world space (`shared/dimensions.js`): Overworld |x|,|z| < 30000; Nether centered at x=40960 (±3840), 8:1 scale. End centered at x=-40960 (±2048).

## Done
- Overworld: terrain, 4 biomes, caves, ores (coal/iron/gold/diamond), trees, villages (houses, well, farms, paths), villagers (5 professions, trading, emeralds), ruined portals.
- Nether portal: obsidian frame (any size 2x3..21x21), flint and steel, 4 s travel (instant in creative), linked/created destination portal, breaks when frame breaks. Obsidian from water + lava source.
- Nether: netherrack caverns, bedrock floor/ceiling, lava ocean, soul sand valleys (slow), basalt deltas, glowstone (dust), quartz ore, gold ore (nuggets), magma (burns), red fog + ambient light, no sky/weather.
- The End (step 1): 3 strongholds (900-1300 blocks out) with portal rooms of 12 End portal frames; Eye of Ender (ender pearl + glowstone dust, interim recipe) points toward the nearest stronghold and fills frames; End portal -> obsidian platform; main end-stone island over the void; 10 obsidian pillars with End Crystals (explode, heal the dragon); Ender Dragon (circles, charges, contact damage, boss bar, death opens the exit portal, persists across saves); exit portal -> bed/world spawn; Endermen (neutral until hit, teleport, drop ender pearls; Overworld nights + End); ender pearl throwing.
- Glider Wings = Elytra-style flight (already playable; obtainable by crafting for now).
- Systems: survival/creative/hardcore/spectator, crafting, furnace, chests, mobs, multiplayer, saves, phone controls, dressing room.

## Next (in order)
1. **Nether content**: fortresses (nether brick, blaze + blaze rods), bastions, ghasts, piglins/zombified piglins, nether wart, ancient debris → netherite.
2. **The End step 2 (next concrete task)**: End Gateway spawned on dragon death (`GameServer.onDragonDeath`) -> outer islands generator in `shared/endgen.js` (distance > 1000 from center) -> End Cities (purpur, end rods), shulkers, End Ships with Elytra loot chest; make Glider Wings loot-only as the Elytra.
3. Eye of Ender recipe: switch to blaze powder once Nether fortresses/blazes exist.
4. More ores/materials: copper, redstone, lapis, emerald ore, deepslate, granite/diorite/andesite, raw ores.
5. Mob rules: hostiles only at night/darkness (or burning); drowned + fish; pillagers + outposts.
6. Village upgrade: templates per biome (savanna, taiga), bells, workstations assigning professions, villager sleep/work schedules, iron golem.
7. Game mode switch setting per world; cushions; more blocks (stairs, slabs, fences).

## Known issues
- Hostile Overworld mobs (zombies/skeletons/creepers/spiders) also spawn in the Nether until Nether mobs exist.
- Beds work in the Nether (should explode).
- Dimension border is enforced by the server (moves past it are rejected).
