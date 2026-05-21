// Bosses: Cinder Warden (floor 3), Frost Sovereign (floor 6), Void Lich (floor 9).
// Bosses live inside state.enemies so the damage/render/cull pipeline treats
// them like enemies. Their per-frame AI is driven by updateBoss; we still tick
// statuses through entities.js:tickStatuses so DoTs/chill work normally.

import { tickStatuses, createEnemy } from './entities.js';
import { spawnEnemyProjectile, spawnEnemyExplosion, spawnBossNova, spawnBossHazard, spawnBossBeam, burstParticles } from './effects.js';
import { dist, normalize, randRange, TAU, clamp } from './util.js';
import { TILE_SIZE, tileToPixel } from './world.js';

let BOSS_ID = 9000;
const nextId = () => BOSS_ID++;

// ===== Boss registry =====
export const BOSSES = {
  cinderWarden: {
    id: 'cinderWarden',
    name: 'Cinder Warden',
    theme: 'fire',
    hp: 280,
    radius: 22,
    color: '#ff6a3a',
    glow: '#ffb868',
    speed: 60,
    contactDamage: 1,
    buildMoves: buildCinderMoves,
  },
  frostSovereign: {
    id: 'frostSovereign',
    name: 'Frost Sovereign',
    theme: 'ice',
    hp: 420,
    radius: 22,
    color: '#5acaff',
    glow: '#aee4ff',
    speed: 70,
    contactDamage: 1,
    buildMoves: buildFrostMoves,
  },
  voidLich: {
    id: 'voidLich',
    name: 'Void Lich',
    theme: 'arcane',
    hp: 600,
    radius: 22,
    color: '#c084ff',
    glow: '#e0a8ff',
    speed: 50,
    contactDamage: 1,
    buildMoves: buildVoidMoves,
  },
};

// Pick the boss for a given floor (3 -> cinder, 6 -> frost, 9 -> void).
export function bossForFloor(floor) {
  if (floor === 3) return BOSSES.cinderWarden;
  if (floor === 6) return BOSSES.frostSovereign;
  if (floor === 9) return BOSSES.voidLich;
  return null;
}

export function createBoss(id, x, y) {
  const proto = BOSSES[id];
  if (!proto) return null;
  return {
    id: nextId(),
    kind: 'enemy',
    subtype: 'boss',
    isBoss: true,
    bossId: proto.id,
    name: proto.name,
    theme: proto.theme,
    x, y,
    spawnX: x, spawnY: y,
    radius: proto.radius,
    color: proto.color,
    glow: proto.glow,
    speed: proto.speed,
    hp: proto.hp,
    maxHp: proto.hp,
    damage: proto.contactDamage,
    contactDamage: true,
    sightRange: 9999,
    aggro: true,
    statuses: {},
    hitFlash: 0,
    dead: false,
    moves: proto.buildMoves(),
    moveIndex: 0,
    moveTimer: 1.0,     // delay before first move so player can read the room
    currentMove: null,
    phase: 1,
    lastPhaseTriggered: 0,
  };
}

// Per-frame boss tick. Statuses always tick; movement / attacks branch by boss.
export function updateBoss(b, dt, state) {
  if (b.dead) return;
  const speedMul = tickStatuses(b, dt);
  if (b.dead) return;

  // Drive the move queue.
  if (b.currentMove) {
    b.currentMove.elapsed += dt;
    b.currentMove.update(b, dt, state);
    if (b.currentMove.elapsed >= b.currentMove.duration) {
      b.currentMove.done?.(b, state);
      b.currentMove = null;
      b.moveTimer = randRange(0.6, 1.0);     // brief breather between attacks
    }
  } else {
    b.moveTimer -= dt;
    if (b.moveTimer <= 0) {
      // Advance to next move.
      const move = b.moves[b.moveIndex];
      b.moveIndex = (b.moveIndex + 1) % b.moves.length;
      b.currentMove = move.spawn(b, state);
      b.currentMove.update ??= () => {};
    }
  }

  // Slow drift toward player when not in a move that handles motion.
  if (!b.currentMove?.handlesMotion) {
    const player = state.player;
    if (player) {
      const d = dist(b.x, b.y, player.x, player.y);
      if (d > 80) {
        const [nx, ny] = normalize(player.x - b.x, player.y - b.y);
        const sp = b.speed * speedMul * dt;
        moveBossWithCollision(b, nx * sp, ny * sp, state);
      }
    }
  }

  // Confine the boss to its arena.
  const room = state.world?.bossRoom;
  if (room) {
    const minX = (room.x + 1) * TILE_SIZE + b.radius;
    const maxX = (room.x + room.w - 1) * TILE_SIZE - b.radius;
    const minY = (room.y + 1) * TILE_SIZE + b.radius;
    const maxY = (room.y + room.h - 1) * TILE_SIZE - b.radius;
    b.x = clamp(b.x, minX, maxX);
    b.y = clamp(b.y, minY, maxY);
  }
}

function moveBossWithCollision(b, dx, dy, state) {
  const world = state.world;
  const nx = b.x + dx;
  if (!world.pixelBlocked(nx, b.y, b.radius)) b.x = nx;
  const ny = b.y + dy;
  if (!world.pixelBlocked(b.x, ny, b.radius)) b.y = ny;
}

// Returns a random walkable pixel position inside the boss room.
function randInRoom(state, padding = 2) {
  const room = state.world.bossRoom;
  for (let i = 0; i < 30; i++) {
    const tx = room.x + padding + Math.floor(Math.random() * (room.w - padding * 2));
    const ty = room.y + padding + Math.floor(Math.random() * (room.h - padding * 2));
    const [px, py] = tileToPixel(tx, ty);
    if (!state.world.pixelBlocked(px, py, 18)) return { x: px, y: py };
  }
  const [px, py] = tileToPixel(room.cx, room.cy);
  return { x: px, y: py };
}

// ===== Move helpers =====
// A move definition is { spawn(b, state) -> instance }. An instance owns
// `elapsed`, `duration`, `update(b, dt, state)`, optional `done(b, state)`.

function makeMove(duration, update, opts = {}) {
  return {
    elapsed: 0,
    duration,
    update,
    done: opts.done,
    handlesMotion: !!opts.handlesMotion,
  };
}

// ===== Cinder Warden moves =====
function buildCinderMoves() {
  return [
    { spawn: cinder_tripleBolt },
    { spawn: cinder_infernoNova },
    { spawn: cinder_tripleBolt },
    { spawn: cinder_fireWalls },
  ];
}

function cinder_tripleBolt(b, state) {
  // Three fire projectiles in a ±18° spread, fired in quick succession over 0.6s.
  let firedAt = -1;
  const shots = 3;
  return makeMove(0.9, (b, dt, state) => {
    const t = b.currentMove.elapsed;
    const slot = Math.floor(t / 0.2);
    if (slot > firedAt && slot < shots) {
      firedAt = slot;
      const spread = (slot - 1) * (Math.PI / 9);   // -20°, 0, 20°
      spawnEnemyProjectile(state, b, state.player, {
        color: '#ff6a3a', glow: '#ffb868',
        radius: 7, speed: 280, life: 1.6, damage: 1,
        angleOffset: spread,
      });
    }
  });
}

function cinder_infernoNova(b, state) {
  // Telegraph + expanding ring centered on boss.
  let spawned = false;
  return makeMove(1.5, (b, dt, state) => {
    if (!spawned) {
      spawned = true;
      spawnBossNova(state, b.x, b.y, {
        radius: 180,
        damage: 2,
        color: '#ff6a3a',
        glow: '#ffae74',
        telegraph: 0.7,
      });
    }
  });
}

function cinder_fireWalls(b, state) {
  // Two short fire hazard walls placed near the player.
  let spawned = false;
  return makeMove(0.5, (b, dt, state) => {
    if (spawned) return;
    spawned = true;
    const room = state.world.bossRoom;
    const p = state.player;
    const positions = [
      { x: p.x, y: p.y, angle: 0 },
      { x: p.x + randRange(-60, 60), y: p.y + randRange(-60, 60), angle: Math.PI / 2 },
    ];
    for (const pos of positions) {
      // Clamp to room interior.
      const cx = clamp(pos.x, (room.x + 2) * TILE_SIZE, (room.x + room.w - 2) * TILE_SIZE);
      const cy = clamp(pos.y, (room.y + 2) * TILE_SIZE, (room.y + room.h - 2) * TILE_SIZE);
      const dx = Math.cos(pos.angle), dy = Math.sin(pos.angle);
      spawnBossHazard(state, cx, cy, dx, dy, {
        length: 140, thickness: 10,
        damage: 1,
        ttl: 2.5,
        color: '#ff6a3a',
        glow: '#ffae74',
        hitInterval: 0.6,
        status: { type: 'burn', ttl: 1.0 },
      });
    }
  });
}

// ===== Frost Sovereign moves =====
function buildFrostMoves() {
  return [
    { spawn: frost_iceBarrage },
    { spawn: frost_chillField },
    { spawn: frost_iceBarrage },
    { spawn: frost_shatterDash },
  ];
}

function frost_iceBarrage(b, state) {
  // 8 ice shards in a fan, fired over 1.2s.
  let lastSlot = -1;
  return makeMove(1.4, (b, dt, state) => {
    const t = b.currentMove.elapsed;
    const slot = Math.floor(t / 0.15);
    if (slot > lastSlot && slot < 8) {
      lastSlot = slot;
      const spread = (slot - 3.5) * (Math.PI / 18);
      spawnEnemyProjectile(state, b, state.player, {
        color: '#5acaff', glow: '#aee4ff',
        radius: 6, speed: 260, life: 1.4, damage: 1,
        angleOffset: spread,
        status: { type: 'chill', factor: 0.5, ttl: 1.0 },
      });
    }
  });
}

function frost_chillField(b, state) {
  // 3s pulsing nova that slows the player while inside. Implemented as a
  // continuous bossHazard refresh (renders as overlapping circles).
  let elapsed = 0;
  let lastPulse = -100;
  return makeMove(3.0, (b, dt, state) => {
    elapsed += dt;
    if (elapsed - lastPulse >= 0.6) {
      lastPulse = elapsed;
      // Drop a chill ring at the boss's feet.
      spawnBossNova(state, b.x, b.y, {
        radius: 140,
        damage: 1,
        color: '#5acaff',
        glow: '#aee4ff',
        telegraph: 0.2,
        status: { type: 'chill', factor: 0.45, ttl: 1.4 },
      });
    }
  });
}

function frost_shatterDash(b, state) {
  // Telegraph a line toward the player's current position, then dash.
  const p = state.player;
  const [dx, dy] = normalize(p.x - b.x, p.y - b.y);
  const targetX = p.x, targetY = p.y;
  let phase = 'telegraph';
  let telegraphSpawned = false;
  return makeMove(1.3, (b, dt, state) => {
    const t = b.currentMove.elapsed;
    if (phase === 'telegraph') {
      if (!telegraphSpawned) {
        telegraphSpawned = true;
        const mid = { x: (b.x + targetX) / 2, y: (b.y + targetY) / 2 };
        const len = dist(b.x, b.y, targetX, targetY);
        spawnBossHazard(state, mid.x, mid.y, dx, dy, {
          length: len, thickness: 6,
          damage: 0,                  // telegraph only — doesn't deal damage
          ttl: 0.6,
          color: '#aee4ff',
          glow: '#5acaff',
          hitInterval: 99,
        });
      }
      if (t >= 0.6) phase = 'dash';
    } else if (phase === 'dash') {
      // Charge along (dx, dy) at high speed.
      const dashSpeed = 700;
      const nx = b.x + dx * dashSpeed * dt;
      const ny = b.y + dy * dashSpeed * dt;
      b.x = nx; b.y = ny;
      // Damage the player if we overlap during the dash.
      if (dist(b.x, b.y, state.player.x, state.player.y) < b.radius + state.player.radius + 4) {
        // Reuse contact damage path via direct call.
        state.damagePlayer(2);
        state.player.statuses = state.player.statuses || {};
        state.player.statuses.chill = { factor: 0.5, ttl: 1.4 };
      }
      // Leave a brief ice trail.
      burstParticles(state, b.x, b.y, '#aee4ff', 4, { speed: 100, ttl: 0.35, size: 2 });
    }
  }, { handlesMotion: true });
}

// ===== Void Lich moves =====
function buildVoidMoves() {
  return [
    { spawn: void_arcaneSeeker },
    { spawn: void_arcaneSeeker },
    { spawn: void_drainBeam },
    { spawn: void_phaseShift },
  ];
}

function void_arcaneSeeker(b, state) {
  // Fire two slow homing arcane orbs.
  let lastSlot = -1;
  return makeMove(1.0, (b, dt, state) => {
    const t = b.currentMove.elapsed;
    const slot = Math.floor(t / 0.45);
    if (slot > lastSlot && slot < 2) {
      lastSlot = slot;
      spawnEnemyProjectile(state, b, state.player, {
        color: '#c084ff', glow: '#e0a8ff',
        radius: 7, speed: 160, life: 4.0, damage: 1,
        homing: 1.6,
      });
    }
  });
}

function void_drainBeam(b, state) {
  // Sweeping beam that orbits the boss for 1.6s.
  let spawned = false;
  return makeMove(1.9, (b, dt, state) => {
    if (!spawned) {
      spawned = true;
      const startAngle = Math.atan2(state.player.y - b.y, state.player.x - b.x) - 0.7;
      spawnBossBeam(state, b.x, b.y, startAngle, {
        angularSpeed: 1.0,
        length: 360,
        thickness: 16,
        damage: 1,
        ttl: 1.8,
        telegraph: 0.35,
        color: '#c084ff',
        glow: '#e0a8ff',
        hitInterval: 0.4,
      });
    }
  });
}

function void_phaseShift(b, state) {
  // Teleport + summon two arcane wisp adds (small enemies).
  let did = false;
  return makeMove(0.4, (b, dt, state) => {
    if (did) return;
    did = true;
    burstParticles(state, b.x, b.y, '#c084ff', 22, { speed: 240, ttl: 0.5, size: 2 });
    const dest = randInRoom(state);
    b.x = dest.x; b.y = dest.y;
    burstParticles(state, b.x, b.y, '#c084ff', 22, { speed: 240, ttl: 0.5, size: 2 });
    // Summon two wisps.
    for (let i = 0; i < 2; i++) {
      const spot = randInRoom(state);
      const wisp = createEnemy('shooter', spot.x, spot.y, 0.5);
      wisp.color = '#c084ff';
      wisp.glow = '#e0a8ff';
      wisp.attackCooldown = 1.8;
      wisp.cooldownTimer = randRange(0.3, 1.2);
      wisp.maxHp = wisp.hp = 8;
      state.enemies.push(wisp);
    }
  });
}
