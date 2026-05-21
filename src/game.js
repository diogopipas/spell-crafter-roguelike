// Top-level game state + main loop.

import { generateDungeon, TILE, TILE_SIZE, tileToPixel, pixelToTile } from './world.js';
import { createPlayer, addRuneToInventory, damagePlayer, updateEnemy, spawnEnemiesForFloor, spawnChestsForFloor, createShopkeeper, createGoldPickup, createPickup } from './entities.js';
import { updateEffects, updateParticles, spawnEnemyProjectile, spawnEnemyExplosion, burstParticles } from './effects.js';
import { composeSpell, defaultStarterSpells } from './spells.js';
import { input, consumePressed, isSuspended, endFrameInput } from './input.js';
import { RUNES, CATEGORY, allRuneIds } from './runes.js';
import { Camera, render, VIEW_W, VIEW_H } from './render.js';
import { updateHUD, openCrafter, closeCrafter, toggleCrafter, openShop, closeShop, showGameOver, hideGameOver, flashMessage, flashReaction, resetCrafter, flashShards } from './ui.js';
import { getCooldownMultiplier } from './trinkets.js';
import { playSound, setMusicTheme } from './audio.js';
import { bossForFloor, createBoss, updateBoss } from './bosses.js';
import { clamp, normalize, dist, chance, pick, randRange } from './util.js';
import { isUnlocked, saveRun, loadRun, clearRun, awardFloorClear, awardBossKill, recordStat, recordMax, recordKillByElement } from './meta.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'playing';   // 'playing' | 'gameover'
    this.lastTime = 0;
    this.floor = 1;
    this.screenShake = 0;
    this.aim = { x: 0, y: 0 };
    this.camera = new Camera();
    this.runesById = RUNES;
    this.particles = [];
    this.effects = [];
    this.enemyEffects = [];

    // Bind methods used by effects subsystem.
    this.spawnEnemyProjectile = (e, t) => spawnEnemyProjectile(this, e, t);
    this.spawnEnemyExplosion = (e) => spawnEnemyExplosion(this, e);
    this.damagePlayer = (n) => damagePlayer(this.player, n);
  }

  start({ resume = false } = {}) {
    const snapshot = resume ? loadRun() : null;
    this._initRun(snapshot);
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._tick(t));
  }

  restart() {
    clearRun();
    hideGameOver();
    this._initRun(null);
    this.state = 'playing';
  }

  _initRun(snapshot) {
    this.particles.length = 0;
    this.effects.length = 0;
    this.enemyEffects.length = 0;
    this.screenShake = 0;
    this.player = null;

    if (snapshot && snapshot.player) {
      this.floor = snapshot.floor || 1;
      this._buildFloor(this.floor);
      this._applyPlayerSnapshot(snapshot.player);
    } else {
      this.floor = 1;
      recordStat('runs');
      this._buildFloor(this.floor);
      // Starter inventory + spells.
      const starter = ['fire', 'ice', 'projectile', 'beam', 'splits', 'pierces'];
      for (const id of starter) addRuneToInventory(this.player, id);
      this.player.spellSlots = defaultStarterSpells();
    }
    resetCrafter();
    updateHUD();
    saveRun(this);
  }

  // Overwrite the freshly-created player with serialized fields.
  // Trinket mutator stats are already baked into the saved hp/maxHp/etc,
  // so we set p.trinkets directly and skip applyTrinket().
  _applyPlayerSnapshot(saved) {
    const p = this.player;
    p.hp = saved.hp; p.maxHp = saved.maxHp;
    p.mana = saved.mana; p.maxMana = saved.maxMana;
    p.manaRegen = saved.manaRegen;
    p.speed = saved.speed;
    if (typeof saved.radius === 'number') p.radius = saved.radius;
    p.gold = saved.gold || 0;
    p.inventory = { ...saved.inventory };
    p.trinkets = saved.trinkets.slice();
    p.activeSlot = saved.activeSlot || 0;
    p.spellSlots = saved.spellSlots.map(s => {
      if (!s || !s.runes) return null;
      return { runes: s.runes.slice(), spell: composeSpell(s.runes) };
    });
  }

  _buildFloor(floor) {
    // Reset boss state for the new floor.
    setMusicTheme('default');
    this.activeBoss = null;
    this.bossEngaged = false;
    this.bossBarrier = null;

    // Boss floors carve a large themed final room.
    const bossProto = bossForFloor(floor);
    const genOpts = bossProto ? { bossFloor: true, theme: bossProto.theme } : {};
    const world = generateDungeon(floor, genOpts);
    this.world = world;
    // Player at center of first room.
    const spawn = world.rooms[0];
    const [px, py] = tileToPixel(spawn.cx, spawn.cy);
    if (this.player) {
      this.player.x = px; this.player.y = py;
      this.player.iframes = 1;
      this.player.statuses = {};
    } else {
      this.player = createPlayer(px, py);
    }
    this.camera.x = px - VIEW_W / 2;
    this.camera.y = py - VIEW_H / 2;

    // Enemies & pickups.
    this.enemies = spawnEnemiesForFloor(world, floor);
    // Possible rune pool grows with depth.
    const pool = this._floorRunePool(floor);
    this.pickups = spawnChestsForFloor(world, pool);

    // Boss spawn — placed at the boss room center, added to the enemies list.
    if (bossProto && world.bossRoom) {
      const [bx, by] = tileToPixel(world.bossRoom.cx, world.bossRoom.cy);
      const boss = createBoss(bossProto.id, bx, by);
      this.enemies.push(boss);
      this.activeBoss = boss;
    }

    // Shopkeeper (if the dungeon designated a shop room).
    if (world.shopRoom) {
      const [sx, sy] = tileToPixel(world.shopRoom.cx, world.shopRoom.cy);
      this.shopkeeper = createShopkeeper(sx, sy);
    } else {
      this.shopkeeper = null;
    }

    // Clear active effects between floors.
    this.effects.length = 0;
    this.enemyEffects.length = 0;
    this.particles.length = 0;

    world.updateFov(spawn.cx, spawn.cy);
    flashMessage(`Floor ${floor}.`);
  }

  _floorRunePool(floor) {
    // Make every (unlocked) rune reachable but bias toward those the player
    // has not yet seen this run. Locked runes are gated by meta-progression.
    const all = allRuneIds().filter(id => isUnlocked('rune', id));
    const owned = this.player ? new Set(Object.keys(this.player.inventory).filter(k => this.player.inventory[k] > 0)) : new Set();
    const unowned = all.filter(id => !owned.has(id));
    if (floor <= 2 && unowned.length > 0) return unowned;
    return all;
  }

  _tick(now) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._update(dt);
    render(this.ctx, this);
    requestAnimationFrame((t) => this._tick(t));
  }

  _update(dt) {
    if (this.state === 'gameover') {
      endFrameInput();
      if (consumePressed('r')) this.restart();
      return;
    }

    // Toggle crafter.
    if (consumePressed('q')) toggleCrafter();
    if (consumePressed('Escape')) { closeCrafter(); closeShop(); }

    // Shop interaction.
    if (this.shopkeeper && !isSuspended()) {
      const sd = dist(this.player.x, this.player.y, this.shopkeeper.x, this.shopkeeper.y);
      const inRange = sd < this.shopkeeper.radius + this.player.radius + 24;
      this._nearShop = inRange;
      if (inRange && consumePressed('e')) openShop();
    } else {
      this._nearShop = false;
    }

    if (isSuspended()) {
      // Game paused while crafter is open.
      endFrameInput();
      updateHUD();
      return;
    }

    // Slot selection.
    if (consumePressed('1')) this.player.activeSlot = 0;
    if (consumePressed('2')) this.player.activeSlot = 1;
    if (consumePressed('3')) this.player.activeSlot = 2;

    this._updatePlayer(dt);
    this._updateAim();
    this._updateCasting(dt);

    this._updateBossEncounter(dt);

    for (const e of this.enemies) {
      if (e.isBoss) updateBoss(e, dt, this);
      else updateEnemy(e, dt, this);
    }
    updateEffects(this, dt);
    updateParticles(this.particles, dt);

    this._updatePickups();
    this._checkStairs();
    this._checkContactDamage(dt);
    this._cullDead();

    // FOV update.
    const [tx, ty] = pixelToTile(this.player.x, this.player.y);
    this.world.updateFov(tx, ty);

    this.camera.follow(this.player, dt);
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 30);

    if (this.player.dead) {
      this.state = 'gameover';
      recordStat('deaths');
      recordMax('deepestFloor', this.floor);
      recordMax('bestGold', this.player.gold || 0);
      clearRun();
      showGameOver(`Reached Floor ${this.floor}.`);
      playSound('gameOver');
    }

    endFrameInput();
    updateHUD();
  }

  _updatePlayer(dt) {
    const p = this.player;
    let dx = 0, dy = 0;
    if (input.keys.has('w') || input.keys.has('ArrowUp')) dy -= 1;
    if (input.keys.has('s') || input.keys.has('ArrowDown')) dy += 1;
    if (input.keys.has('a') || input.keys.has('ArrowLeft')) dx -= 1;
    if (input.keys.has('d') || input.keys.has('ArrowRight')) dx += 1;
    // Chill slows the player while the status is active.
    let speedMul = 1;
    if (p.statuses.chill) speedMul *= p.statuses.chill.factor ?? 0.5;
    if (dx || dy) {
      [dx, dy] = normalize(dx, dy);
      const sp = p.speed * speedMul * dt;
      const nx = p.x + dx * sp;
      if (!this.world.pixelBlocked(nx, p.y, p.radius) && !this._barrierBlocks(nx, p.y, p.radius)) p.x = nx;
      const ny = p.y + dy * sp;
      if (!this.world.pixelBlocked(p.x, ny, p.radius) && !this._barrierBlocks(p.x, ny, p.radius)) p.y = ny;
    }

    if (p.iframes > 0) p.iframes = Math.max(0, p.iframes - dt);
    p.mana = clamp(p.mana + p.manaRegen * dt, 0, p.maxMana);

    // Statuses on player.
    if (p.statuses.burn) {
      p.statuses.burn.ttl -= dt;
      // (No DoT on player for v1 — would be brutal.)
      if (p.statuses.burn.ttl <= 0) delete p.statuses.burn;
    }
    if (p.statuses.chill) {
      p.statuses.chill.ttl -= dt;
      if (p.statuses.chill.ttl <= 0) delete p.statuses.chill;
    }

    // Cooldowns tick down.
    for (let i = 0; i < p.cooldowns.length; i++) {
      if (p.cooldowns[i] > 0) p.cooldowns[i] = Math.max(0, p.cooldowns[i] - dt);
    }
  }

  // AABB-vs-circle test against the boss barrier segments (player only).
  _barrierBlocks(px, py, radius) {
    const bar = this.bossBarrier;
    if (!bar) return false;
    for (const seg of bar.segments) {
      if (circleVsRect(px, py, radius, seg.rectX, seg.rectY, seg.rectW, seg.rectH)) return true;
    }
    return false;
  }

  _updateBossEncounter(dt) {
    const boss = this.activeBoss;
    if (!boss) return;
    const world = this.world;
    const room = world.bossRoom;
    if (!room) return;

    // First-time entry: spawn the barrier, start boss music, expand FoV.
    if (!this.bossEngaged) {
      const [tx, ty] = pixelToTile(this.player.x, this.player.y);
      const inside = tx >= room.x && tx < room.x + room.w &&
                     ty >= room.y && ty < room.y + room.h;
      if (inside) {
        this.bossEngaged = true;
        world._fovRange = 14;   // reveal whole arena
        this.bossBarrier = buildBossBarrier(room.doorways || [], boss);
        setMusicTheme(`boss-${boss.theme}`);
        playSound('bossEntry');
        flashReaction(`${boss.name} awakens!`);
        this.screenShake = Math.max(this.screenShake, 8);
      }
    }
  }

  _updateAim() {
    // Convert mouse position (canvas coords) to world coords.
    this.aim.x = input.mouseX + this.camera.x;
    this.aim.y = input.mouseY + this.camera.y;
  }

  _updateCasting() {
    if (!input.mouseClicked) return;
    const p = this.player;
    const slot = p.spellSlots[p.activeSlot];
    if (!slot || !slot.spell) {
      flashMessage('Empty spell slot. Press Q to craft a spell.');
      return;
    }
    if (p.cooldowns[p.activeSlot] > 0) return;
    if (p.mana < slot.spell.manaCost) {
      flashMessage('Not enough mana.');
      return;
    }
    p.mana -= slot.spell.manaCost;
    p.cooldowns[p.activeSlot] = slot.spell.cooldown * getCooldownMultiplier(p);

    const dx = this.aim.x - p.x, dy = this.aim.y - p.y;
    const [ndx, ndy] = normalize(dx, dy);
    playSound('cast', { element: slot.spell.element });
    slot.spell.cast(this, { x: p.x, y: p.y }, { dx: ndx, dy: ndy });
  }

  _updatePickups() {
    for (const p of this.pickups) {
      if (p.consumed) continue;
      if (dist(p.x, p.y, this.player.x, this.player.y) < p.radius + this.player.radius) {
        p.consumed = true;
        if (p.goldAmount) {
          this.player.gold += p.goldAmount;
          burstParticles(this, p.x, p.y, '#ffd84a', 8, { speed: 160, ttl: 0.4 });
          playSound('pickup');
        } else {
          addRuneToInventory(this.player, p.runeId);
          const rune = RUNES[p.runeId];
          flashMessage(`Picked up ${rune.name} rune.`);
          burstParticles(this, p.x, p.y, rune.color, 12, { speed: 180, ttl: 0.5 });
          playSound('pickup');
        }
      }
    }
    this.pickups = this.pickups.filter(p => !p.consumed);
  }

  _checkStairs() {
    const [tx, ty] = pixelToTile(this.player.x, this.player.y);
    if (this.world.get(tx, ty) === TILE.STAIRS) {
      playSound('floorDown');
      const cleared = this.floor;
      const reward = awardFloorClear(cleared);
      flashShards(reward.total, reward.bonus ? `floor ${cleared} first clear` : `floor ${cleared}`);
      this.floor++;
      this._buildFloor(this.floor);
      saveRun(this);
    }
  }

  _checkContactDamage(dt) {
    const p = this.player;
    if (p.iframes > 0) return;
    for (const e of this.enemies) {
      if (e.dead || !e.contactDamage) continue;
      if (dist(e.x, e.y, p.x, p.y) < e.radius + p.radius) {
        damagePlayer(p, e.damage);
        this.screenShake = Math.max(this.screenShake, 6);
        break;
      }
    }
  }

  _cullDead() {
    // Drop loot from killed enemies. Bosses get their own fat-loot branch.
    for (const e of this.enemies) {
      if (!e.dead || e._dropped) continue;
      e._dropped = true;

      if (e.isBoss) {
        this._handleBossDeath(e);
        continue;
      }

      // Stats: tag the kill by the dominant elemental status if any was active.
      recordKillByElement(dominantElementOnKill(e));

      playSound('enemyDeath');
      if (chance(0.4)) {
        const pool = this._floorRunePool(this.floor);
        const runeId = pick(pool);
        this.pickups.push({
          id: -1, kind: 'pickup',
          x: e.x + randRange(-6, 6),
          y: e.y + randRange(-6, 6),
          radius: 9, runeId,
          bobPhase: Math.random() * Math.PI * 2,
          consumed: false,
        });
      }
      // Always drop a small pile of gold.
      const amt = 1 + Math.floor(Math.random() * 4);   // 1–4 coins
      this.pickups.push(createGoldPickup(
        e.x + randRange(-10, 10),
        e.y + randRange(-10, 10),
        amt,
      ));
      burstParticles(this, e.x, e.y, e.color, 14, { speed: 220, ttl: 0.6, size: 3 });
    }
    this.enemies = this.enemies.filter(e => !e.dead);
  }

  _handleBossDeath(boss) {
    playSound('bossDeath');
    flashReaction(`${boss.name} defeated.`);
    this.screenShake = Math.max(this.screenShake, 14);

    const reward = awardBossKill(boss.bossId);
    flashShards(reward.total, reward.bonus ? 'boss first kill' : 'boss kill');
    burstParticles(this, boss.x, boss.y, boss.color, 40, { speed: 320, ttl: 0.9, size: 3 });
    burstParticles(this, boss.x, boss.y, '#fff', 18, { speed: 200, ttl: 0.7, size: 2 });

    // Drop 3 guaranteed runes + a big pile of gold.
    const pool = this._floorRunePool(this.floor);
    for (let i = 0; i < 3; i++) {
      const runeId = pick(pool);
      this.pickups.push(createPickup(
        boss.x + randRange(-22, 22),
        boss.y + randRange(-22, 22),
        runeId,
      ));
    }
    const goldAmt = 25 + Math.floor(Math.random() * 16);
    this.pickups.push(createGoldPickup(boss.x, boss.y, goldAmt));

    // Place stairs at the boss's spawn center so they're always reachable.
    const world = this.world;
    if (world.bossRoom) {
      const [bx, by] = [world.bossRoom.cx, world.bossRoom.cy];
      world.set(bx, by, TILE.STAIRS);
      world.stairsX = bx; world.stairsY = by;
    }

    // Drop the barrier, restore default music, clear engagement state.
    this.bossBarrier = null;
    this.activeBoss = null;
    this.bossEngaged = false;
    setMusicTheme('default');
  }
}

// Helpers (module-private). ===========================================

// Build collision rects for each doorway segment so the player can be blocked
// out of the boss room until the boss dies.
function buildBossBarrier(doorways, boss) {
  const segments = doorways.map(d => {
    const rectX = d.x * TILE_SIZE;
    const rectY = d.y * TILE_SIZE;
    const rectW = d.axis === 'h' ? d.tileLen * TILE_SIZE : TILE_SIZE;
    const rectH = d.axis === 'h' ? TILE_SIZE : d.tileLen * TILE_SIZE;
    return { ...d, rectX, rectY, rectW, rectH };
  });
  return { segments, color: boss.color, glow: boss.glow };
}

function circleVsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Pick the elemental status to credit a kill to. Statuses live on enemy
// `statuses` (burn/chill/shock/poison/arcane_mark); first match wins.
function dominantElementOnKill(enemy) {
  const s = enemy.statuses;
  if (!s) return null;
  if (s.burn) return 'fire';
  if (s.chill) return 'ice';
  if (s.shock) return 'lightning';
  if (s.poison) return 'poison';
  if (s.arcane_mark) return 'arcane';
  return null;
}
