# ShaftCraft

A multiplayer voxel sandbox for the browser: procedurally generated worlds, survival / creative / hardcore / spectator modes, mobs, crafting, smelting, fluids, day/night, weather, glider wings and an authoritative multiplayer server. Every texture, model, skin, icon, sound and the UI art are generated in code at startup — there are no image or audio files.

```
npm install
npm run dev
```

Then open **http://localhost:5173**. `npm run dev` starts both the game client (Vite, port 5173) and the dedicated multiplayer server (port 25570).

Requires Node.js 18+ (tested with Node 24).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dedicated server + Vite dev client together. You can type server console commands (`op <name>`, `kick`, `save`, `stop`...) into this terminal. |
| `npm run client` | Only the client (single-player works fully on its own). |
| `npm run server` / `npm start` | Only the dedicated server. If `dist/` exists it also serves the built client over HTTP on the same port. |
| `npm run build` | Production build of the client into `dist/`. |
| `npm test` | Headless tests: server boot/commands/crafting, fluid simulation, falling blocks, explosions, trees, fall damage, eating, sleeping, hardcore death → spectator. |

`tests/bot.js` is a small headless bot (`node tests/bot.js localhost:25570 Bot1`) for testing multiplayer with a second player.

---

## Controls (all rebindable in Options → Controls)

| Key | Action |
|---|---|
| W A S D | Move |
| Space | Jump · double-tap: toggle flight (creative) · in air while falling with Glider Wings: deploy / stow wings |
| Left Shift | Sneak (can't walk off edges) · fly down |
| Left Ctrl or double-tap W | Sprint |
| Left mouse | Attack / break block (hold) |
| Right mouse | Use / place block (hold to repeat) · eat · draw bow · firework boost while gliding |
| Middle mouse | Pick block (creative) |
| 1–9 / mouse wheel | Hotbar slot |
| E | Inventory (creative inventory in creative, teleport menu in spectator) |
| Q / Ctrl+Q | Drop one / drop stack |
| F | Swap held item with off-hand |
| T | Chat · `/` opens chat with a command |
| Tab (hold) | Player list with ping |
| F3 | Debug overlay (FPS, chunks, entities, memory, TPS, position, light...) |
| F5 | Camera: first person → third person back → third person front |
| F11 | Fullscreen |
| Esc | Pause menu |

Inventory screen: LMB pick up / place stack · RMB half / one · Shift+click quick-move (also crafts the maximum from the result slot) · drag with LMB (split evenly) or RMB (one each) · double-click to collect matching items · number keys swap with hotbar · Q drops · F swaps with off-hand · click outside the panel to drop the held stack.

Commands (ops, or single-player worlds created with **Allow Commands**): `/help /gamemode /time /weather /tp /give /kill /difficulty /seed /spawnpoint /clear /list`. Dedicated-server console only: `op deop kick ban pardon save stop`.

---

## Architecture

```
shared/        Code used by both client and server
  constants.js   every tunable number (speeds, gravity, ranges, timings, caps...)
  blocks.js      block registry: shape, collision, light, hardness, tool/tier, drops, sounds, textures
  items.js       item registry: tools, armor, food, materials, glider wings, creative tabs
  recipes.json   ALL crafting (shaped + shapeless, with tags) and smelting recipes
  recipes.js     recipe matcher, fuel times
  noise.js       seeded simplex noise + RNGs
  worldgen.js    deterministic terrain: continents, hills, 4 biomes, caves, ores, trees, plants
  chunk.js       chunk storage (variable height, sparse metadata, heightmap)
  physics.js     swept-AABB collision, player movement (walk/sprint/sneak/swim/ladder/fly/glide), mob movement, raycasts
  inventory.js   window/slot logic (click, shift, drag, double-click, swap, drop) shared for prediction
  mining.js      break-time / harvest rules
  protocol.js    message types and flags

server/
  index.js       Node host: WebSocket server, HTTP (status + static dist/), file persistence, console
  core/          The authoritative game server (pure ES modules – also runs in a Web Worker)
    GameServer.js  20 TPS loop, players, validation, interaction, damage, chat, saving
    ServerWorld.js chunks + modifications, fluids, falling blocks, random ticks, explosions
    entities.js    items, arrows, eggs, falling blocks, fireworks
    mobs.js        8 mobs with AI; pathfind.js (A*); spawner.js; containers.js; commands.js

client/src/
  App.js         main loop (fixed 20 TPS ticks + interpolated rendering), lifecycle, options wiring
  game/          Game.js (protocol, prediction, mining, placing, camera modes), Input.js
  world/         ClientWorld (light engine), ChunkManager (streaming), worker.js (gen + mesh), mesher.js
  render/        Renderer, ChunkRenderer (shader), Sky (sun/moon/stars/clouds), Weather, Particles,
                 EntityRenderer + models.js (box rigs, skins), HeldItem (first-person hand)
  textures/      texgen.js (all block textures), atlas.js, itemsprites.js, icons.js
  audio/         Audio.js – synthesized sounds, positional audio, rain/wind loops, generative music
  ui/            UI.js (menus), HUD.js (canvas HUD), InventoryUI.js, guitex.js (UI art + logo)
  net/           Connection.js (worker / WebSocket), serverWorker.js, storage.js (IndexedDB)
```

* **Single-player** runs the exact same `GameServer` inside a Web Worker and saves to IndexedDB (autosave every 30 s, on pause-quit and when the tab is hidden/closed).
* **Terrain** is generated client-side from the seed in worker threads; the server only sends per-chunk *modification lists*, so joining a server costs very little bandwidth.
* **Lighting**: sky + block light (0–15) per cell, computed in the worker per chunk, then stitched across chunk borders and updated incrementally (flood-fill add/remove) on the main thread. Day/night is a shader uniform, so time changes never re-mesh.
* **Meshing**: face culling with smooth lighting and vertex AO, three passes (opaque, cutout, translucent), biome-blended tints, sloped/animated water and lava.
* **Networking**: compact JSON messages. Clients predict their own movement with the shared physics; the server validates speed, flight, collision, reach, break time, placement and every inventory action, and sends corrections. Other players and mobs are interpolated with a 100 ms buffer (state broadcast at 10 Hz).

---

## Deployment

```
npm install
npm run build        # builds the client into dist/
npm start            # serves dist/ and the WebSocket game server on port 25570
```

Players open `http://your-host:25570`; the Multiplayer screen pre-fills that address. The server writes `server-data/server-config.json` on first start:

| Key | Default | Meaning |
|---|---|---|
| `port` / `host` | 25570 / 0.0.0.0 | Listen address (env `PORT` overrides) |
| `motd` | A ShaftCraft Server | Shown in the server list |
| `maxPlayers` | 20 | Player cap |
| `pvp` | true | Players can damage each other |
| `worldName`, `seed`, `worldType` | world, random, default | `worldType`: `default` or `flat` |
| `gamemode`, `difficulty`, `hardcore` | survival, normal, false | World rules |
| `ops` | [] | Operator names (also `op <name>` in the console) |

World data lives in `server-data/<worldName>/` (JSON files, saved every 30 s and on Ctrl+C / SIGTERM). For HTTPS sites, put the server behind a TLS reverse proxy and connect with `wss://host` in Direct Connect. `SHAFTCRAFT_DATA=/path` changes the data directory.

---

## Milestone report

### M1 – World, meshing, textures, movement, break/place, day/night, sky, clouds
**Works:** seeded terrain (continents, hills, mountains, Plains/Forest/Desert/Snowy biomes, worm + cheese caves, lava below y 10, ores with the specified vein sizes/ranges, gravel/dirt pockets, oak/spruce trees, cactus, flowers, tall grass, sugar cane, snow and ice), 16×16 procedural textures in a padded 256×256 atlas, per-face textures, animated water/lava/torch, biome tints, crack overlay, isometric block icons, worker meshing, render distance 2–32, swept-AABB collision, all movement speeds, sky gradient, sun, 8-phase moon, 1500 twinkling stars, Off/Fast/Fancy scrolling clouds.
**Test:** create a world; walk, sprint (double-tap W), sneak at a ledge, dig and place; `/time set night`; F3.

### M2 – Fluids, lighting, health, damage, HUD, sounds
**Works:** water spreads 7 / lava 3 with flow-toward-drops, infinite water, draining, lava+water → cobblestone (stone when lava falls on water), buckets, swimming/buoyancy/flow push, breath and drowning, lava/fire damage, fall damage (none into water), void, suffocation, cactus, flood-fill sky/block light with torches (14) and lava (15), hearts/hunger/armor/bubbles HUD, synthesized sounds.
**Test:** pour a water bucket on a slope; dive (bubbles + fog); jump from a cliff; place torches in a cave.

### M3 – Inventory, crafting, furnace, chest, tools, hunger, game modes, commands
**Works:** full inventory interactions, 2×2/3×3 crafting (64 shaped + 12 shapeless recipes), furnace fuel/smelting at 10 s per item, live-shared chests and furnaces, tool tiers/speeds/durability/harvest rules, hunger/saturation/exhaustion/regeneration/starvation per difficulty, survival/creative/hardcore/spectator, all commands.
**Test:** punch a tree → planks → crafting table → wooden pickaxe → stone tools → furnace + coal → iron.

### M4 – Mobs, drops, armor, bow, creepers
**Works:** pig, cow (milk), sheep (shear, regrow by eating grass), chicken (eggs, slow fall), zombie (burns in sun, breaks doors on Hard), skeleton (strafes, aims with gravity compensation), creeper (fuse, cancel at 7 blocks, radius-3 explosion with 30 % drops), spider (climbs, leaps, neutral in light); A* pathfinding; spawning rules and caps; despawning; baby variants; walk/hurt/death animations; item drops (bob, spin, merge, pickup delay, 5-min despawn); armor reduction and visible armor; bow with charge and FOV zoom; critical hits; attack cooldown meter.
**Test:** `/time set night` in survival on a hill; craft a bow (sticks + string) and arrows (flint, stick, feather).

### M5 – Menus, saving, options, third person, glider
**Works:** title screen with live panorama, world list (play/create/rename/delete), create-world options, multiplayer list with ping/refresh, all option screens wired to real effects, pause menu, death and hardcore death screens, IndexedDB saves, F5 camera modes, Glider Wings (unfold animation, flight model, firework boost, crash damage, durability, airspeed readout, wind sound, camera roll/FOV).
**Test:** craft or `/give @s glider_wings`, equip in the chest slot, jump off a mountain and press Space while falling; hold fireworks and right-click.

### M6 – Multiplayer
**Works:** dedicated Node server, protocol, client prediction + server correction, 100 ms interpolation, shared containers, chat, player list with ping, per-username skins, nametags (hidden while sneaking), equipment/armor/wings on remote players, join/leave messages, kick/ban/op, PvP toggle, max players, persistence every 30 s and on shutdown (including entities), server status ping for the list.
**Test:** `npm run dev`, open two browser windows (different names on the Multiplayer screen), Add Server `localhost`.

### M7 – Polish
Verified in a browser: no console errors during menus, single-player, multiplayer, creative/survival, death and respawn; 60 FPS at render distance 8 in a desktop browser. Headless test suites pass (`npm test`).

### Assumptions / decisions
* Mob damage numbers are in half-hearts (HP), matching health units (e.g. zombie 2 / 3 / 4.5).
* XP is omitted; the death screen shows a **score** (points for kills and valuable ores).
* Lava sources and flowing lava touched by water become cobblestone, as specified.
* Items that need a source got one: farming (hoe, seeds from tall grass, wheat → bread), saplings and leaf decay, bone meal, sugar cane → paper, creeper gunpowder → fireworks, gravel flint → arrows, flower dyes for colored wool, throwable eggs (1/8 hatch a chick).
* Glider Wings recipe: **Wing Membrane** (4 leather + 2 string) ×2 around a **Glider Frame** (3 sticks + 2 string) in one row. Also in the creative Combat tab.
* Snow layers are walk-through (like a 1-layer snow cover). Hand-placed leaves never decay.
* Movement uses client prediction with server-side validation and position correction (not a full input-replay scheme).
* The server approximates light for spawning/growth (heightmap sky exposure + distance to light emitters); the client has exact flood-fill light.
* Server port 25570 (avoids clashing with other games on 25565).
* Pointer lock needs a user gesture, so after loading a world the game asks for one click ("Click to play").

### Known issues / limits
* Render distances above ~16 are memory and GPU heavy (as in any voxel engine).
* Double chests, a recipe book, enchanting and XP are not included (optional / omitted per spec).
* Entities in chunks far from every player are frozen until a player comes back; passive mobs there are stored with the chunk.
* Browsers pause animation frames in hidden tabs; the game keeps simulating at a low rate so multiplayer connections stay alive.

---

## Button / control audit

Every control exists only because it performs the action listed. Verified by clicking through the UI in a browser and by code review.

| Button / Control | Screen | What it does | Where in code |
|---|---|---|---|
| Singleplayer | Title | Opens the world list | `client/src/ui/UI.js` `title()` |
| Multiplayer | Title | Opens the server list | `UI.js` `title()` |
| Options... | Title | Opens Options (returns to Title) | `UI.js` `title()` |
| Quit Game | Title (installed app only) | Closes the app window; hidden in a normal browser tab | `UI.js` `title()` |
| World entry (click / double-click / Enter) | Select World | Selects / plays that world | `UI.js` `singleplayer()` |
| Play Selected World | Select World | Starts the single-player server worker and loads the world | `UI.js` → `App.playWorld` |
| Create New World | Select World | Opens Create New World | `UI.js` `createWorld()` |
| Rename | Select World | Opens Rename World for the selection | `UI.js` `renameWorld()` |
| Delete | Select World | Confirmation, then deletes the world from IndexedDB | `UI.js`, `net/storage.js` `deleteWorld` |
| Back | Select World | Returns to Title | `UI.js` |
| World Name / Seed fields | Create New World | Name; seed (blank = random, numbers used directly, text hashed) | `UI.js` `createWorld()`, `shared/noise.js` `parseSeed` |
| Game Mode: Survival/Creative/Hardcore | Create New World | Sets the world rules; Hardcore locks difficulty to Hard and disables commands | `UI.js` `createWorld()` |
| Difficulty | Create New World | Peaceful/Easy/Normal/Hard (disabled in Hardcore) | `UI.js` |
| Allow Commands | Create New World | Makes the single player an operator | `UI.js`, `GameServer.handleHello` |
| World Type | Create New World | Default terrain or Superflat | `UI.js`, `shared/worldgen.js` |
| Create New World | Create New World | Creates the save and starts the world | `App.createAndPlay` |
| Cancel | Create New World | Back to Select World | `UI.js` |
| Rename World / Cancel | Rename World | Saves the new name / goes back | `UI.js` `renameWorld()`, `storage.renameWorld` |
| Delete / Cancel | Delete confirmation | Deletes / goes back | `UI.js` `confirm()` |
| Name field | Multiplayer | Sets the username used for joining (and skin) | `UI.js` `multiplayer()` |
| Server entry (click / double-click / Enter) | Multiplayer | Selects / joins; shows MOTD, players and ping | `UI.js`, `net/Connection.js` `pingServer` |
| Join Server | Multiplayer | Connects to the selected server | `App.joinServer` |
| Direct Connect | Multiplayer | Opens Direct Connect | `UI.js` `directConnect()` |
| Add Server | Multiplayer | Opens the add form | `UI.js` `editServer(-1)` |
| Edit | Multiplayer | Opens the edit form for the selection | `UI.js` `editServer(i)` |
| Delete | Multiplayer | Confirmation, then removes the entry (localStorage) | `UI.js` |
| Refresh | Multiplayer | Re-pings every server | `UI.js` `multiplayer()` |
| Back | Multiplayer | Returns to Title | `UI.js` |
| Server Name / Address, Done, Cancel | Add / Edit Server | Saves the entry / goes back | `UI.js` `editServer()` |
| Server Address, Join Server, Cancel | Direct Connect | Connects to the typed address / goes back | `UI.js` `directConnect()` |
| Video Settings... / Controls... / Music & Sounds... / Chat Settings... / Done | Options | Open the sub-screens / go back (Title or Pause) | `UI.js` `options()` |
| Render Distance slider | Video | Chunk streaming radius (2–32) and fog; sent to the server | `UI.js` `video()`, `App.applyOption`, `ChunkManager.setRenderDistance` |
| FOV slider | Video | Camera field of view 30–110 | `App.applyOption('fov')`, `Renderer.setFov` |
| Clouds | Video | Fancy (3D) / Fast (flat) / Off | `render/Sky.js` `Clouds.update` |
| View Bobbing | Video | Camera and hand bobbing | `game/Game.js` `frame()` |
| GUI Scale | Video | Auto / 1–4 integer UI scale | `App.applyScale` |
| Max Framerate | Video | FPS cap 30–250 or Unlimited | `App.step` |
| Particles | Video | All / Minimal particle counts | `render/Particles.js` |
| Smooth Lighting | Video | Smooth light + AO on/off (re-meshes) | `world/mesher.js`, `ChunkManager.remeshAll` |
| Fullscreen | Video | Enters / leaves fullscreen | `App.setFullscreen` |
| Done | Video / Controls / Music & Sounds / Chat Settings | Back to Options | `UI.js` |
| Sensitivity slider | Controls | Mouse look speed | `Game.frame()` |
| Invert Mouse | Controls | Inverts vertical look | `Game.frame()` |
| Sprint: Hold/Toggle, Sneak: Hold/Toggle | Controls | Hold or toggle behaviour | `Game.tick()`, `Game.onKey()` |
| Key binding buttons (24) | Controls | Click, press a key to rebind (Esc cancels); conflicts shown in red | `UI.js` `controls()`, `options.js` |
| Reset Keys | Controls | Restores default bindings | `options.resetKeys` |
| Master / Music / Blocks / Mobs / Ambient / User Interface sliders | Music & Sounds | Gain of each audio bus | `audio/Audio.js` `setVolumes` |
| Text Opacity / Text Size sliders | Chat Settings | Chat background/text opacity and scale | `ui/HUD.js` `drawChat`, CSS `--chat-scale` |
| Cancel | Loading | Aborts loading/connecting and returns | `App.startGame` |
| Back to Title Screen / Back to Server List | Error / Connection Lost | Returns to Title / server list | `UI.js` `error()` |
| Click to play | After loading | Grabs the mouse (pointer lock) | `App.showClickToPlay` |
| Back to Game | Pause | Closes the menu, unpauses single-player, grabs the mouse | `UI.js` `resume()` |
| Options... | Pause | Options (returns to Pause) | `UI.js` `pause()` |
| Save and Quit to Title / Disconnect | Pause | Saves and stops the SP server / leaves the MP server | `App.quitToTitle` |
| Respawn | Death | Respawns at bed or world spawn | `Game.respawn`, `GameServer.respawn` |
| Title Screen | Death | Saves and quits to Title | `App.quitToTitle` |
| Spectate World | Hardcore death | Switches to spectator mode | `GameServer` `hardcoreSpectate` |
| Delete World / Leave Server | Hardcore death | Deletes the SP world / disconnects in MP | `App.deleteCurrentWorld`, `App.quitToTitle` |
| Leave Bed | Sleeping | Wakes up | `GameServer.wake` |
| Player buttons / Close | Spectator menu (E) | Teleport to that player / close | `UI.js` `spectatorMenu()` |
| Slots (all windows) | Inventory, Crafting, Furnace, Chest | Click, right-click, shift-click, drag, double-click, number keys, Q, F | `ui/InventoryUI.js`, `shared/inventory.js` |
| Crafting result slot | Inventory / Crafting Table | Takes the result; shift-click crafts the maximum | `shared/inventory.js` `applyAction` |
| Armor / off-hand slots | Inventory | Accept only matching armor (wings in chest) / any item | `shared/inventory.js` `slotAccepts` |
| Player preview | Inventory | Live, rotating model with current armor, wings and held item | `InventoryUI.js` `PlayerPreview` |
| Furnace flame / arrow | Furnace | Show remaining fuel and smelting progress (live from server) | `InventoryUI.refresh` |
| Category tabs (Building Blocks, Decoration, Tools, Combat, Food, Misc) | Creative inventory | Show that category | `InventoryUI.buildCreative` |
| Search tab + search box | Creative inventory | Filters all items by name | `InventoryUI.paletteItems` |
| Survival Inventory tab | Creative inventory | Armor, off-hand and full inventory | `InventoryUI.buildCreative` |
| Palette items | Creative inventory | LMB full stack, RMB one, shift-click to hotbar; clicking while holding deletes the held stack | `InventoryUI.fillPalette` |
| Trash slot | Creative inventory | Destroys the held stack; shift-click clears the inventory | `InventoryUI.buildCreative` |
| Chat input | In game (T, /) | Sends chat or commands; Up/Down history; Esc closes | `UI.js` `openChat()` |
