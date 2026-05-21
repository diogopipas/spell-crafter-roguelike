// Player, enemies, pickups.

import { dist, normalize, randRange, chance, pick, clamp, angleTo, TAU } from './util.js';
import { TILE_SIZE, tileToPixel } from './world.js';
import { playSound } from './audio.js';

let ENT_ID = 1;
const nextId = () => ENT_ID++;

// ===== Player =====
export function createPlayer(x, y) {
  return {
    id: nextId(),
    kind: 'player',
    x, y,
    radius: 9,
    speed: 160,
    hp: 3,
    maxHp: 3,
    mana: 100,
    maxMana: 100,
    manaRegen: 14,
    inventory: {},           // runeId -> count
    spellSlots: [null, null, null],  // each: { runes: [id,id,id], spell: composed }
    activeSlot: 0,
    cooldowns: [0, 0, 0],
    statuses: {},
    iframes: 0,
    dead: false,
    gold: 0,
    trinkets: [null, null, null],   // equipped trinket ids
  };
}

export function damagePlayer(player, amount) {
  if (player.iframes > 0 || player.dead) return;
  player.hp -= amount;
  player.iframes = 0.6;
  playSound('playerHurt');
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
  }
}

export function addRuneToInventory(player, runeId, amount = 1) {
  player.inventory[runeId] = (player.inventory[runeId] || 0) + amount;
}

// ===== Enemies =====
const ENEMY_TYPES = {
  chaser: {
    kind: 'enemy', subtype: 'chaser',
    radius: 10, color: '#d24a4a', glow: '#ff7a7a',
    speed: 70, hp: 18, damage: 1, contactDamage: true,
    sightRange: 280,
  },
  shooter: {
    kind: 'enemy', subtype: 'shooter',
    radius: 9, color: '#7a5aff', glow: '#a8a0ff',
    speed: 40, hp: 14, damage: 1, contactDamage: false,
    sightRange: 380, attackCooldown: 1.6,
    projectileSpeed: 200, projectileLife: 1.6, projectileDamage: 1,
  },
  exploder: {
    kind: 'enemy', subtype: 'exploder',
    radius: 11, color: '#e88a3a', glow: '#ffb868',
    speed: 90, hp: 10, damage: 1, contactDamage: true,
    sightRange: 240, explodeRadius: 70, explodeDamage: 2,
  },
};

export function createEnemy(subtype, x, y, hpScale = 1) {
  const proto = ENEMY_TYPES[subtype];
  return {
    id: nextId(),
    kind: 'enemy',
    subtype,
    x, y,
    radius: proto.radius,
    color: proto.color,
    glow: proto.glow,
    speed: proto.speed,
    hp: proto.hp * hpScale,
    maxHp: proto.hp * hpScale,
    damage: proto.damage,
    contactDamage: proto.contactDamage,
    sightRange: proto.sightRange,
    attackCooldown: proto.attackCooldown || 0,
    cooldownTimer: randRange(0, proto.attackCooldown || 0),
    projectileSpeed: proto.projectileSpeed,
    projectileLife: proto.projectileLife,
    projectileDamage: proto.projectileDamage,
    explodeRadius: proto.explodeRadius,
    explodeDamage: proto.explodeDamage,
    statuses: {},
    dead: false,
    aggro: false,
    hitFlash: 0,
  };
}

// Tick all status effects on an enemy/boss: status DoTs, chill decay, hit-flash, death.
// Returns the speed multiplier from chill (1 if none). After this call, callers
// must early-return if e.dead is true.
export function tickStatuses(e, dt) {
  let speedMul = 1;
  if (e.statuses.chill) {
    e.statuses.chill.ttl -= dt;
    if (e.statuses.chill.ttl <= 0) delete e.statuses.chill;
    else speedMul *= e.statuses.chill.factor;
  }
  if (e.statuses.burn) {
    e.statuses.burn.ttl -= dt;
    e.hp -= e.statuses.burn.dps * dt;
    if (e.statuses.burn.ttl <= 0) delete e.statuses.burn;
  }
  if (e.statuses.poison) {
    e.statuses.poison.ttl -= dt;
    e.hp -= e.statuses.poison.dps * dt;
    if (e.statuses.poison.ttl <= 0) delete e.statuses.poison;
  }
  if (e.statuses.shock) {
    e.statuses.shock.ttl -= dt;
    e.hp -= e.statuses.shock.dps * dt;
    if (e.statuses.shock.ttl <= 0) delete e.statuses.shock;
  }
  if (e.statuses.arcane_mark) {
    e.statuses.arcane_mark.ttl -= dt;
    if (e.statuses.arcane_mark.ttl <= 0) delete e.statuses.arcane_mark;
  }
  if (e.hp <= 0) { e.dead = true; return speedMul; }
  if (e.hitFlash > 0) e.hitFlash -= dt;
  return speedMul;
}

export function updateEnemy(e, dt, state) {
  if (e.dead) return;

  const speedMul = tickStatuses(e, dt);
  if (e.dead) return;

  const player = state.player;
  const d = dist(e.x, e.y, player.x, player.y);

  if (d < e.sightRange) e.aggro = true;
  if (!e.aggro) return;

  const sp = e.speed * speedMul;

  if (e.subtype === 'chaser') {
    const [nx, ny] = normalize(player.x - e.x, player.y - e.y);
    moveWithCollision(e, nx * sp * dt, ny * sp * dt, state);
  } else if (e.subtype === 'shooter') {
    // Stay at preferred range ~220.
    const preferred = 220;
    const [nx, ny] = normalize(player.x - e.x, player.y - e.y);
    if (d > preferred + 20) moveWithCollision(e, nx * sp * dt, ny * sp * dt, state);
    else if (d < preferred - 20) moveWithCollision(e, -nx * sp * dt, -ny * sp * dt, state);
    // Strafe slightly.
    const tx = -ny, ty = nx;
    moveWithCollision(e, tx * sp * 0.3 * dt, ty * sp * 0.3 * dt, state);

    e.cooldownTimer -= dt;
    if (e.cooldownTimer <= 0) {
      e.cooldownTimer = e.attackCooldown;
      // Spawn an enemy projectile.
      state.spawnEnemyProjectile(e, player);
    }
  } else if (e.subtype === 'exploder') {
    const [nx, ny] = normalize(player.x - e.x, player.y - e.y);
    moveWithCollision(e, nx * sp * dt, ny * sp * dt, state);
    if (d < 28) {
      // Explode.
      state.spawnEnemyExplosion(e);
      e.dead = true;
    }
  }
}

function moveWithCollision(e, dx, dy, state) {
  const world = state.world;
  const nx = e.x + dx;
  if (!world.pixelBlocked(nx, e.y, e.radius)) e.x = nx;
  const ny = e.y + dy;
  if (!world.pixelBlocked(e.x, ny, e.radius)) e.y = ny;
}

// ===== Pickups =====
export function createPickup(x, y, runeId) {
  return {
    id: nextId(),
    kind: 'pickup',
    x, y,
    radius: 9,
    runeId,
    bobPhase: Math.random() * TAU,
    consumed: false,
  };
}

export function createGoldPickup(x, y, amount) {
  return {
    id: nextId(),
    kind: 'pickup',
    x, y,
    radius: 8,
    goldAmount: amount,
    bobPhase: Math.random() * TAU,
    consumed: false,
  };
}

// ===== Shopkeeper =====
export function createShopkeeper(x, y) {
  return {
    id: nextId(),
    kind: 'shopkeeper',
    x, y,
    radius: 12,
  };
}

// ===== Spawning helpers =====
export function spawnEnemiesForFloor(world, floor, rng = Math.random) {
  // skip room 0 (player spawn), populate the rest.
  const enemies = [];
  const hpScale = 1 + (floor - 1) * 0.25;
  const subtypes = ['chaser'];
  if (floor >= 2) subtypes.push('shooter');
  if (floor >= 3) subtypes.push('exploder');

  for (let i = 1; i < world.rooms.length; i++) {
    const r = world.rooms[i];
    if (r === world.shopRoom) continue;   // no enemies inside the shop
    if (r === world.bossRoom) continue;   // boss room only contains the boss
    const count = clamp(1 + Math.floor((floor + i) / 3), 1, 4);
    for (let j = 0; j < count; j++) {
      const tx = r.x + 1 + Math.floor(rng() * (r.w - 2));
      const ty = r.y + 1 + Math.floor(rng() * (r.h - 2));
      const [px, py] = tileToPixel(tx, ty);
      const sub = subtypes[Math.floor(rng() * subtypes.length)];
      enemies.push(createEnemy(sub, px, py, hpScale));
    }
  }
  return enemies;
}

export function spawnChestsForFloor(world, runeIds, rng = Math.random) {
  const pickups = [];
  // 1–2 chests per floor in non-spawn, non-shop rooms.
  const candidates = world.rooms.slice(1).filter(r => r !== world.shopRoom && r !== world.bossRoom);
  for (let i = 0; i < 2; i++) {
    if (candidates.length === 0) break;
    const r = candidates[Math.floor(rng() * candidates.length)];
    const [px, py] = tileToPixel(r.cx, r.cy);
    const runeId = runeIds[Math.floor(rng() * runeIds.length)];
    pickups.push(createPickup(px + randRange(-12, 12), py + randRange(-12, 12), runeId));
  }
  return pickups;
}
