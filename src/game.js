// Top-level game state + main loop.

import { generateDungeon, TILE, TILE_SIZE, tileToPixel, pixelToTile } from './world.js';
import { createPlayer, addRuneToInventory, damagePlayer, updateEnemy, spawnEnemiesForFloor, spawnChestsForFloor } from './entities.js';
import { updateEffects, updateParticles, spawnEnemyProjectile, spawnEnemyExplosion, burstParticles } from './effects.js';
import { composeSpell, defaultStarterSpells } from './spells.js';
import { input, consumePressed, isSuspended, endFrameInput } from './input.js';
import { RUNES, CATEGORY, allRuneIds } from './runes.js';
import { Camera, render, VIEW_W, VIEW_H } from './render.js';
import { updateHUD, openCrafter, closeCrafter, toggleCrafter, showGameOver, hideGameOver, flashMessage, resetCrafter } from './ui.js';
import { playSound } from './audio.js';
import { clamp, normalize, dist, chance, pick, randRange } from './util.js';

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

  start() {
    this._initRun();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._tick(t));
  }

  restart() {
    hideGameOver();
    this._initRun();
    this.state = 'playing';
  }

  _initRun() {
    this.floor = 1;
    this.particles.length = 0;
    this.effects.length = 0;
    this.enemyEffects.length = 0;
    this.screenShake = 0;
    this.player = null;

    this._buildFloor(this.floor);

    // Starter inventory + spells.
    const starter = ['fire', 'ice', 'projectile', 'beam', 'splits', 'pierces'];
    for (const id of starter) addRuneToInventory(this.player, id);
    this.player.spellSlots = defaultStarterSpells();
    resetCrafter();
    updateHUD();
  }

  _buildFloor(floor) {
    const world = generateDungeon(floor);
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

    // Clear active effects between floors.
    this.effects.length = 0;
    this.enemyEffects.length = 0;
    this.particles.length = 0;

    world.updateFov(spawn.cx, spawn.cy);
    flashMessage(`Floor ${floor}.`);
  }

  _floorRunePool(floor) {
    // Make every rune reachable but bias toward those the player has not yet seen.
    const all = allRuneIds();
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
    if (consumePressed('Escape')) closeCrafter();

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

    for (const e of this.enemies) updateEnemy(e, dt, this);
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
    if (dx || dy) {
      [dx, dy] = normalize(dx, dy);
      const sp = p.speed * dt;
      const nx = p.x + dx * sp;
      if (!this.world.pixelBlocked(nx, p.y, p.radius)) p.x = nx;
      const ny = p.y + dy * sp;
      if (!this.world.pixelBlocked(p.x, ny, p.radius)) p.y = ny;
    }

    if (p.iframes > 0) p.iframes = Math.max(0, p.iframes - dt);
    p.mana = clamp(p.mana + p.manaRegen * dt, 0, p.maxMana);

    // Statuses on player (e.g., burn from enemy)
    if (p.statuses.burn) {
      p.statuses.burn.ttl -= dt;
      // (No DoT on player for v1 — would be brutal.)
      if (p.statuses.burn.ttl <= 0) delete p.statuses.burn;
    }

    // Cooldowns tick down.
    for (let i = 0; i < p.cooldowns.length; i++) {
      if (p.cooldowns[i] > 0) p.cooldowns[i] = Math.max(0, p.cooldowns[i] - dt);
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
    p.cooldowns[p.activeSlot] = slot.spell.cooldown;

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
        addRuneToInventory(this.player, p.runeId);
        const rune = RUNES[p.runeId];
        flashMessage(`Picked up ${rune.name} rune.`);
        burstParticles(this, p.x, p.y, rune.color, 12, { speed: 180, ttl: 0.5 });
        playSound('pickup');
      }
    }
    this.pickups = this.pickups.filter(p => !p.consumed);
  }

  _checkStairs() {
    const [tx, ty] = pixelToTile(this.player.x, this.player.y);
    if (this.world.get(tx, ty) === TILE.STAIRS) {
      playSound('floorDown');
      this.floor++;
      this._buildFloor(this.floor);
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
    // Drop runes from killed enemies.
    for (const e of this.enemies) {
      if (e.dead && !e._dropped) {
        e._dropped = true;
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
        burstParticles(this, e.x, e.y, e.color, 14, { speed: 220, ttl: 0.6, size: 3 });
      }
    }
    this.enemies = this.enemies.filter(e => !e.dead);
  }
}
