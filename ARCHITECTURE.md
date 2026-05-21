# Architecture

A guided tour of every component in the spell-caster roguelike.

The game is a vanilla-JS browser game — no build step, no framework. `index.html` loads `src/main.js` as an ES module, which bootstraps the canvas + game loop. Everything else lives in `src/`.

```
index.html  ──► src/main.js  ──► src/game.js  ◄──── the main loop lives here
                                       │
       ┌─────────────┬─────────────────┼─────────────────┬───────────────┐
       ▼             ▼                 ▼                 ▼               ▼
   world.js      entities.js      runes.js          effects.js        render.js
  (dungeon)    (player/enemy)   (rune defs)     (projectiles/etc.)   (canvas)
       │             │                 │                 │               │
       │             │                 ▼                 ▼               │
       │             │            spells.js  ─────► reactions.js         │
       │             │       (rune composition)   (elemental combos)     │
       │             │                 │                                 │
       │             │                 ▼                                 │
       │             │           trinkets.js                             │
       │             │        (shop accessories)                         │
       │             │                 │                 │               │
       └─────────────┴─────────────────┴─────────────────┴───────► input.js / ui.js / util.js
```

## File-by-file

### `index.html` + `style.css`

The DOM scaffold:

- A `<canvas id="game-canvas" width="1280" height="720">` where all gameplay is drawn.
- A DOM-based **HUD** layered on top (HP/Mana bars, floor indicator, three spell-slot cards).
- A hidden **Crafter overlay** (`#crafter`) — the rune drag-and-drop modal.
- A hidden **Game Over panel** and a **message log**.

`style.css` styles all of the above. Notably, `.log-msg` runs a 3s `fadeOut` keyframe animation; `.log-reaction` overrides it with bold yellow text for reaction callouts.

### `src/main.js`

Tiny entry point. Grabs the canvas, instantiates `Game`, wires up input + UI, calls `game.start()`, and exposes the instance as `window.__game` for debugging.

### `src/game.js` — the core

The `Game` class owns all run-time state:

- `world`, `player`, `enemies`, `pickups` — gameplay actors.
- `effects`, `enemyEffects`, `particles` — visual/damage effects.
- `floor`, `screenShake`, `aim`, `camera`, `state` (`'playing'` | `'gameover'`).

The main loop is `_tick(now)` → `_update(dt)` → `render(ctx, this)`, driven by `requestAnimationFrame`. `dt` is clamped to 50 ms to keep one missed frame from teleporting enemies through walls.

Per-frame `_update` does, in order:

1. Handle crafter toggle (Q/Esc) and slot selection (1/2/3).
2. Move the player, regen mana, decay i-frames + cooldowns + statuses.
3. Update aim from mouse position + camera offset.
4. Fire a spell if the mouse was clicked this frame (`_updateCasting`).
5. Tick every enemy AI (`updateEnemy`), every active effect (`updateEffects`), every particle.
6. Pick up runes the player is touching; descend stairs if standing on them; apply contact damage; cull dead enemies (and drop loot).
7. Recompute field of view from the player's tile.
8. Lerp the camera toward the player; decay screen shake.

### `src/world.js` — procedural dungeons

`generateDungeon(floor)` builds a `70×44` tile grid:

- Spawns ~`8 + floor` non-overlapping rectangular rooms (clamped to 14).
- Connects them with L-shaped corridors (random horizontal-first / vertical-first).
- Adds two extra random corridors so the map isn't a strict chain — gives loops.
- Places downward stairs in the last room.
- Tags one middle room as `world.shopRoom`; `game.js` spawns the shopkeeper at its center.

The `World` class also tracks:

- `tiles` — `Uint8Array` of `WALL` / `FLOOR` / `STAIRS`.
- `seen` — `0` = never seen, `1` = explored (dimmed), `2` = currently visible. `updateFov` re-casts Bresenham lines out to a radius of 8 every frame.
- `pixelBlocked(x, y, radius)` — circle-vs-walls collision; used by player, enemy, and projectile movement.

### `src/entities.js` — player, enemies, pickups

`createPlayer(x, y)` returns a plain object with HP, mana, three `spellSlots`, an `inventory` (rune id → count), a `statuses` map, a `gold` counter, and three `trinkets` slots.

`createShopkeeper(x, y)` and `createGoldPickup(x, y, amount)` cover the shop economy. The shopkeeper is a static, non-collidable entity placed at the center of `world.shopRoom`; gold pickups behave like rune pickups but carry a `goldAmount` field instead of a `runeId`.

`createEnemy(subtype, x, y, hpScale)` builds one of three archetypes:

| Subtype | Behavior |
|---|---|
| **chaser** | Walks straight at the player; deals contact damage. |
| **shooter** | Holds at ~220 px range, strafes, fires `enemyProjectile`s. |
| **exploder** | Charges in; self-destructs into an AoE at close range. |

`updateEnemy(e, dt, state)` ticks statuses first (`chill` slows; `burn` / `poison` / `shock` DoT; `arcane_mark` ttl-only), then runs subtype-specific AI gated on `aggro` once the player enters sight range.

`spawnEnemiesForFloor` / `spawnChestsForFloor` populate the dungeon. HP scales with floor; new subtypes unlock at floors 2 and 3. Both helpers skip `world.shopRoom` so the shop is always a safe zone.

### `src/runes.js` — the 5×5×5 system

The whole spell economy lives in this one file. Every rune is one of three categories:

- **5 Elements** (fire, ice, lightning, poison, arcane) — each has `damage` and an `onHit(target, fx)` that applies a status.
- **5 Forms** (projectile, nova, beam, aura, wall) — each has a `manaCost` and `cooldown`.
- **5 Modifiers** (splits, chains, pierces, homing, explodes) — each tweaks behavior.

Element `onHit` applies these statuses:

| Element | Status applied |
|---|---|
| fire | `burn` (DoT 6/s, 2.5s) |
| ice | `chill` (slow ×0.45, 1.5s) |
| lightning | `shock` (stacks to 3, DoT 2/s, 1.2s) |
| poison | `poison` (stacks to 5, DoT 3×stack/s, 4s) |
| arcane | `arcane_mark` (no DoT, 3s — primes Resonance) |

### `src/spells.js` — composing a spell

`composeSpell([elementId, formId, modifierId])` validates that exactly one rune from each category is present, then builds a spell descriptor with:

- A pretty `name` like *Forking Fiery Bolt*.
- `damage`, `manaCost`, `cooldown` — derived from element + form + modifier.
- A `cast(state, origin, dir)` closure.

When cast, the spell builds a `spec` object and hands it to the matching spawner in `effects.js` (`spawnProjectile`, `spawnNova`, `spawnBeam`, `spawnAura`, `spawnWall`). The modifier mutates the spec first:

| Modifier | Effect |
|---|---|
| **splits** | Auto-splits into two children mid-flight (`triggerSplit`). |
| **chains** | After a hit, jumps to the nearest other enemy as a `chainArc` for up to 3 chains. |
| **pierces** | Projectiles don't die on impact; novas naturally pierce. |
| **homing** | Curves toward the nearest enemy (rad/sec turn rate). |
| **explodes** | Triggers a `spawnExplosion` on hit/expire. |

`spawnChainArc` is the chain-reaction visualizer: it does direct damage to the next target, routes it through `applyElement` (so chains can also trigger reactions), and pushes a `chainArc` render entry.

### `src/trinkets.js` — passive accessories

A small registry of equippable trinkets sold by the shopkeeper. Each entry is one of two kinds:

- **`mutator`** — has `apply(player)` / `unapply(player)`; called when the trinket is equipped or unequipped. Used for stat-level changes (Max HP, Max Mana, Mana Regen, Move Speed).
- **`multiplier`** — carries a `multiplier` descriptor (`{ type: 'element'|'cooldown', element?, value }`). Read at use sites via `getElementMultiplier(player, elementId)` (called in `effects.js:applyHit` and `spells.js:spawnChainArc`) and `getCooldownMultiplier(player)` (called in `game.js:_updateCasting`).

The player has three trinket slots (`player.trinkets`). Buying a fourth requires choosing which to swap out.

### `src/effects.js` — projectiles, AoE, particles

Each effect (projectile/nova/beam/aura/wall/explosion) has its own spawner and updater. They share a common shape: `x/y`, `ttl`, `age`, `damage`, `element`, plus per-type fields (e.g. `vx/vy` for projectiles, `length` for beams).

The heart of the file is `applyHit(fx, target, state)`:

1. Skip if this fx has already hit this target (via `fx.hits` set).
2. Apply raw damage and a hit-flash.
3. **Call `applyElement(fx.element, target, state, fx)`** — this is where elemental statuses *and* reactions trigger.
4. Run the `fx.onHit` hook (e.g. the chains modifier's chain-jump).
5. Spawn impact particles.

`spawnExplosion` is the workhorse for any AoE burst — used by the `explodes` modifier *and* by reactions (Shatter / Detonate).

`updateEffects(state, dt)` ticks every active effect, then culls those whose `ttl <= 0` (firing `onExpire` once before removal).

`nearestEnemy(state, x, y, maxDist, excludeIds?)` is exported because reactions and chains both need it.

### `src/reactions.js` — elemental combos *(new!)*

When a new element hits a target already carrying a status from a *different* element, a reaction fires. `applyElement(element, target, state, fx)` is the single entry point — `applyHit` and `spawnChainArc` both go through it.

Priority order (first match wins):

| Reaction | Trigger | Effect |
|---|---|---|
| **Shatter** | fire ↔ chill | 3× burst damage (cap 60) + 80 px white AoE + screen shake. Consumes both statuses (no new status reapplied). |
| **Detonate** | fire ↔ poison | 70 px AoE; damage scales with existing poison stacks (×8). Consumes poison. |
| **Conduct** | lightning ↔ chill, ice ↔ shock | Yellow chain arcs to 2 nearby enemies for 60% damage + brief chill. Consumes the triggering status. |
| **Corrode** | lightning ↔ poison, poison ↔ shock | Spreads poison (half stacks) to 2 nearby enemies. Origin keeps its poison. |
| **Resonance** | any non-arcane + arcane_mark | Bonus damage equal to the new element's base damage + purple particle burst. Consumes arcane_mark, then the new element's status still applies. |

If no reaction matches, the element's own `onHit` runs normally. Reactions call `flashReaction(name)` for the on-screen callout.

Note the circular import: `effects.js` imports `applyElement` from this file, and this file imports `spawnExplosion` / `burstParticles` / `nearestEnemy` from `effects.js`. ES modules resolve this fine because both sides only call each other's bindings inside function bodies, not at module top level.

### `src/render.js` — canvas drawing

`render(ctx, state)` paints, in order:

1. **Tiles** — floor/wall/stairs, clipped to the camera viewport.
2. **Pickups** (rune drops, with a bob animation).
3. **Player** (with aim arrow + i-frame flash).
4. **Enemies** (HP bar + status tints: burn=glow, poison=green blend, chill=blue, shock=yellow, arcane=purple glow).
5. **Enemy effects** (their projectiles + explosions).
6. **Player effects** (projectiles, novas, beams, auras, walls, explosions, chain arcs).
7. **Particles**.
8. **Fog of war** (black for unseen, dim overlay for "seen but not visible").

`drawGlowCircle` is the reusable "soft-glow blob" used for almost every game entity. The `Camera` class lerps toward the player; `screenShake` jitters the translation.

### `src/input.js` — keyboard + mouse

A singleton `input` object holds the live state:

- `keys` — currently-held keys.
- `pressed` — keys that went down *this frame* (`consumePressed(k)` reads-and-clears).
- `mouseX/Y`, `mouseDown`, `mouseClicked` (also per-frame).

`endFrameInput()` is called at the end of each `_update` to clear the per-frame flags. `setInputSuspended(true)` pauses movement/casting while the crafter modal is open.

### `src/ui.js` — HUD + crafter

DOM-side glue. `updateHUD()` syncs the HP/mana bars, spell-slot cards, the gold indicator, and the three trinket slot icons every frame. `openCrafter` / `closeCrafter` toggle the rune crafter modal; while it's open, input is suspended and runes can be dragged from the inventory into three category-typed craft slots.

`openShop` / `closeShop` toggle the shop modal — opened when the player presses E within range of the shopkeeper. The shop lists every trinket from `trinkets.js`, marks each as equipped / affordable / too expensive, and handles three flows: equip-to-empty-slot, swap-into-full-loadout (click an equipped slot after buying), and unequip (click an equipped slot when no purchase is pending). Stat mutations are applied via `applyTrinket` / `unapplyTrinket` at the moment of swap.

`flashMessage(text)` pushes a short notification into the on-screen log. `flashReaction(text)` does the same but with the bold yellow `.log-reaction` style — used by `reactions.js` for "Shatter!", "Detonate!", etc.

### `src/util.js` — math + helpers

Generic utilities. `clamp`, `lerp`, `dist`, `angleTo`, `normalize`, `randInt/Range`, `pick`, `chance`, `hexWithAlpha` (color → `rgba(...)`), and `lineCells` (Bresenham generator for FOV).

## End-to-end: what happens on a single click

1. `input.js` records `mouseClicked = true`.
2. `game.js:_updateCasting` reads it, checks the active slot's cooldown and mana, deducts mana, sets the cooldown, and calls `slot.spell.cast(state, origin, dir)`.
3. `spells.js:castSpell` builds a spec based on the form + modifier, then calls the matching `spawn*` from `effects.js`.
4. The effect is added to `state.effects`. Each frame, `updateEffects` ticks it and checks collisions.
5. On collision, `applyHit` runs: damage → `applyElement` (status or reaction) → particles → `fx.onHit` (chain jumps, etc.).
6. `render.js` draws it the next frame; `entities.js:updateEnemy` ticks any status DoTs.
7. When `target.hp <= 0`, `target.dead = true`. `_cullDead` removes the enemy on the next tick, always drops 1–4 gold coins, and 40% of the time also drops a rune at its location.
8. Gold pickups feed `player.gold`, which is spent at the shopkeeper (one per floor) to equip up to three passive trinkets.
