// Effect entities: Projectile, Beam, Nova, Aura, Wall, Explosion, Particle, EnemyProjectile.
// Each effect carries onHit/onExpire hooks; modifiers (in spells.js) register into these.

import { dist, normalize, randRange, randInt, TAU, angleTo, rotate } from './util.js';

let FX_ID = 1;
const fxId = () => FX_ID++;

// ----- Particles -----
export function spawnParticle(state, x, y, color, opts = {}) {
  const angle = opts.angle ?? Math.random() * TAU;
  const speed = opts.speed ?? randRange(20, 100);
  state.particles.push({
    id: fxId(),
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    color,
    ttl: opts.ttl ?? randRange(0.3, 0.7),
    life: opts.ttl ?? 0.5,
    size: opts.size ?? randRange(1.5, 3),
    fade: opts.fade ?? 0.95,
  });
}

export function burstParticles(state, x, y, color, count = 8, opts = {}) {
  for (let i = 0; i < count; i++) {
    spawnParticle(state, x, y, color, { ...opts, angle: (i / count) * TAU + Math.random() * 0.3 });
  }
}

export function updateParticles(particles, dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= p.fade;
    p.vy *= p.fade;
    p.ttl -= dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].ttl <= 0) particles.splice(i, 1);
  }
}

// ===== Spawners =====
// Each spawner takes (state, origin {x,y}, dir {dx,dy}, spec). Spec is built in spells.js.
// Returns the effect (or array) that was added.

export function spawnProjectile(state, origin, dir, spec) {
  const speed = spec.speed ?? 380;
  const fx = {
    id: fxId(),
    type: 'projectile',
    x: origin.x, y: origin.y,
    vx: dir.dx * speed,
    vy: dir.dy * speed,
    radius: spec.radius ?? 6,
    damage: spec.damage,
    element: spec.element,
    color: spec.color,
    glow: spec.glow,
    ttl: spec.ttl ?? 1.4,
    age: 0,
    pierces: spec.pierces ?? false,
    hits: new Set(),
    maxHits: spec.pierces ? Infinity : 1,
    hitCount: 0,
    homing: spec.homing ?? 0,    // rate in rad/sec
    splitAt: spec.splitAt,        // distance at which to split
    didSplit: false,
    splitOnHit: spec.splitOnHit, // bool
    splitsLeft: spec.splitsLeft ?? 0,
    chainsLeft: spec.chainsLeft ?? 0,
    explodes: spec.explodes,
    onHit: spec.onHit,
    onExpire: spec.onExpire,
    spec,
    trailColor: spec.color,
  };
  state.effects.push(fx);
  return fx;
}

export function spawnNova(state, origin, dir, spec) {
  const fx = {
    id: fxId(),
    type: 'nova',
    x: origin.x, y: origin.y,
    radius: 8,
    targetRadius: spec.radius ?? 140,
    growSpeed: spec.growSpeed ?? 360,
    damage: spec.damage,
    element: spec.element,
    color: spec.color,
    glow: spec.glow,
    ttl: spec.ttl ?? 0.6,
    age: 0,
    hits: new Set(),
    pierces: spec.pierces ?? true, // novas naturally pass through
    chainsLeft: spec.chainsLeft ?? 0,
    explodes: spec.explodes,
    homing: spec.homing ?? 0,
    vx: 0, vy: 0,
    onHit: spec.onHit,
    onExpire: spec.onExpire,
    spec,
  };
  state.effects.push(fx);
  return fx;
}

export function spawnBeam(state, origin, dir, spec) {
  const len = spec.length ?? 480;
  const fx = {
    id: fxId(),
    type: 'beam',
    x: origin.x, y: origin.y,
    dx: dir.dx, dy: dir.dy,
    length: len,
    damage: spec.damage,
    element: spec.element,
    color: spec.color,
    glow: spec.glow,
    ttl: spec.ttl ?? 0.18,
    age: 0,
    hits: new Set(),
    chainsLeft: spec.chainsLeft ?? 0,
    onHit: spec.onHit,
    onExpire: spec.onExpire,
    spec,
    // single-tick damage applied on first update
    applied: false,
  };
  state.effects.push(fx);
  return fx;
}

export function spawnAura(state, origin, dir, spec) {
  // Spawns N orbiting orbs around the player.
  const orbs = spec.orbs ?? 3;
  const radius = spec.orbitRadius ?? 70;
  const ttl = spec.ttl ?? 4.5;
  const fx = {
    id: fxId(),
    type: 'aura',
    x: origin.x, y: origin.y,
    radius: spec.radius ?? 12,
    orbitRadius: radius,
    orbs,
    angle: 0,
    angularSpeed: spec.angularSpeed ?? 2.4,
    damage: spec.damage,
    element: spec.element,
    color: spec.color,
    glow: spec.glow,
    ttl,
    age: 0,
    follow: state.player,   // orbits player
    hitCooldown: new Map(), // enemyId -> seconds until next hit
    hitInterval: 0.4,
    chainsLeft: spec.chainsLeft ?? 0,
    explodes: spec.explodes,
    splitOnHit: spec.splitOnHit,
    splitsLeft: spec.splitsLeft ?? 0,
    onHit: spec.onHit,
    onExpire: spec.onExpire,
    spec,
  };
  state.effects.push(fx);
  return fx;
}

export function spawnWall(state, origin, dir, spec) {
  // Place wall in front of caster, perpendicular to aim.
  const dist0 = spec.placeDistance ?? 60;
  const cx = origin.x + dir.dx * dist0;
  const cy = origin.y + dir.dy * dist0;
  const fx = {
    id: fxId(),
    type: 'wall',
    x: cx, y: cy,
    dx: -dir.dy, dy: dir.dx,    // perpendicular
    vx: 0, vy: 0,
    angle: Math.atan2(dir.dy, dir.dx),
    length: spec.length ?? 130,
    thickness: spec.thickness ?? 12,
    damage: spec.damage,
    element: spec.element,
    color: spec.color,
    glow: spec.glow,
    ttl: spec.ttl ?? 3.5,
    age: 0,
    hits: new Map(),       // enemyId -> seconds until rehit
    hitInterval: 0.5,
    homing: spec.homing ?? 0,
    chainsLeft: spec.chainsLeft ?? 0,
    explodes: spec.explodes,
    splitOnHit: spec.splitOnHit,
    splitsLeft: spec.splitsLeft ?? 0,
    onHit: spec.onHit,
    onExpire: spec.onExpire,
    spec,
  };
  state.effects.push(fx);
  return fx;
}

// Spawns a damage burst (used by Explodes modifier on hit/expire).
export function spawnExplosion(state, x, y, radius, damage, color, element, onHit) {
  const fx = {
    id: fxId(),
    type: 'explosion',
    x, y,
    radius: 4,
    targetRadius: radius,
    growSpeed: radius * 3.5,
    damage,
    element,
    color,
    glow: color,
    ttl: 0.35,
    age: 0,
    hits: new Set(),
    onHit,
  };
  state.effects.push(fx);
  // Particle burst.
  burstParticles(state, x, y, color, 14, { speed: 200, ttl: 0.5, size: 2.5 });
  state.screenShake = Math.max(state.screenShake, 4);
  return fx;
}

// Enemy projectile (separate from player effects — hits player only).
export function spawnEnemyProjectile(state, origin, target) {
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const [nx, ny] = normalize(dx, dy);
  const sp = origin.projectileSpeed || 200;
  state.enemyEffects.push({
    id: fxId(),
    type: 'enemyProjectile',
    x: origin.x, y: origin.y,
    vx: nx * sp, vy: ny * sp,
    radius: 5,
    damage: origin.projectileDamage || 1,
    color: '#a8a0ff',
    glow: '#c8c0ff',
    ttl: origin.projectileLife || 1.6,
  });
}

export function spawnEnemyExplosion(state, e) {
  state.enemyEffects.push({
    id: fxId(),
    type: 'enemyExplosion',
    x: e.x, y: e.y,
    radius: 4,
    targetRadius: e.explodeRadius || 70,
    growSpeed: 250,
    damage: e.explodeDamage || 2,
    color: '#ffb868',
    ttl: 0.4,
    applied: false,
  });
  burstParticles(state, e.x, e.y, '#ffb868', 20, { speed: 250, ttl: 0.6, size: 2.5 });
  state.screenShake = Math.max(state.screenShake, 8);
}

// ===== Effect update / collision =====
// Returns list of dead effect ids? We mutate the array — caller filters.

export function updateEffects(state, dt) {
  const { effects, enemies, player, world } = state;

  for (const fx of effects) {
    fx.age += dt;
    fx.ttl -= dt;

    if (fx.type === 'projectile') {
      updateProjectile(fx, state, dt);
    } else if (fx.type === 'nova') {
      updateNova(fx, state, dt);
    } else if (fx.type === 'beam') {
      updateBeam(fx, state, dt);
    } else if (fx.type === 'aura') {
      updateAura(fx, state, dt);
    } else if (fx.type === 'wall') {
      updateWall(fx, state, dt);
    } else if (fx.type === 'explosion') {
      updateExplosion(fx, state, dt);
    }
  }

  // Cull expired.
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    if (fx.ttl <= 0 || fx.dead) {
      if (fx.onExpire && !fx._expired) {
        fx._expired = true;
        fx.onExpire(fx, state);
      }
      effects.splice(i, 1);
    }
  }

  // Enemy effects.
  for (const fx of state.enemyEffects) {
    fx.age = (fx.age || 0) + dt;
    fx.ttl -= dt;
    if (fx.type === 'enemyProjectile') {
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      if (world.pixelBlocked(fx.x, fx.y, fx.radius)) { fx.dead = true; continue; }
      if (dist(fx.x, fx.y, player.x, player.y) < fx.radius + player.radius) {
        state.damagePlayer(fx.damage);
        fx.dead = true;
      }
    } else if (fx.type === 'enemyExplosion') {
      const t = Math.min(1, fx.age / 0.2);
      fx.radius = fx.radius + fx.growSpeed * dt;
      if (fx.radius > fx.targetRadius) fx.radius = fx.targetRadius;
      if (!fx.applied && fx.age > 0.05) {
        fx.applied = true;
        if (dist(fx.x, fx.y, player.x, player.y) < fx.targetRadius) {
          state.damagePlayer(fx.damage);
        }
      }
    }
  }
  for (let i = state.enemyEffects.length - 1; i >= 0; i--) {
    if (state.enemyEffects[i].ttl <= 0 || state.enemyEffects[i].dead) state.enemyEffects.splice(i, 1);
  }
}

function applyHit(fx, target, state) {
  if (fx.hits && fx.hits.has(target.id)) return false;
  if (fx.hits) fx.hits.add(target.id);
  target.hp -= fx.damage;
  target.hitFlash = 0.12;
  if (fx.element && fx.element.onHit) fx.element.onHit(target, fx);
  if (fx.onHit) fx.onHit(fx, target, state);
  if (target.hp <= 0) target.dead = true;
  // Small impact particles.
  burstParticles(state, target.x, target.y, fx.color || '#fff', 6, { speed: 140, ttl: 0.35, size: 2 });
  return true;
}

function updateProjectile(fx, state, dt) {
  // Homing.
  if (fx.homing > 0) {
    const target = nearestEnemy(state, fx.x, fx.y, 400);
    if (target) {
      const desired = angleTo(fx.x, fx.y, target.x, target.y);
      const cur = Math.atan2(fx.vy, fx.vx);
      let delta = desired - cur;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      const maxTurn = fx.homing * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
      const speed = Math.hypot(fx.vx, fx.vy);
      const ang = cur + turn;
      fx.vx = Math.cos(ang) * speed;
      fx.vy = Math.sin(ang) * speed;
    }
  }

  fx.x += fx.vx * dt;
  fx.y += fx.vy * dt;

  // Splits-by-distance.
  if (fx.splitAt && !fx.didSplit && fx.age > fx.splitAt) {
    fx.didSplit = true;
    if (fx.spec.onSplitTrigger) fx.spec.onSplitTrigger(fx, state);
  }

  // Wall collision.
  if (state.world.pixelBlocked(fx.x, fx.y, fx.radius)) {
    if (fx.explodes) {
      spawnExplosion(state, fx.x, fx.y, fx.explodes.radius, fx.explodes.damage, fx.color, fx.element, null);
    }
    fx.dead = true;
    return;
  }

  // Particle trail.
  if (Math.random() < 0.6) {
    state.particles.push({
      id: fxId(),
      x: fx.x, y: fx.y,
      vx: -fx.vx * 0.08 + randRange(-20, 20),
      vy: -fx.vy * 0.08 + randRange(-20, 20),
      color: fx.trailColor,
      ttl: 0.4, life: 0.4,
      size: randRange(1.5, 3),
      fade: 0.92,
    });
  }

  // Enemy collision.
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (dist(fx.x, fx.y, e.x, e.y) < fx.radius + e.radius) {
      if (applyHit(fx, e, state)) {
        fx.hitCount++;
        if (!fx.pierces) {
          if (fx.explodes) {
            spawnExplosion(state, fx.x, fx.y, fx.explodes.radius, fx.explodes.damage, fx.color, fx.element, null);
          }
          fx.dead = true;
          return;
        }
      }
    }
  }
}

function updateNova(fx, state, dt) {
  fx.radius = Math.min(fx.targetRadius, fx.radius + fx.growSpeed * dt);

  // Optional homing — moves nova center.
  if (fx.homing > 0) {
    const target = nearestEnemy(state, fx.x, fx.y, 400);
    if (target) {
      const [nx, ny] = normalize(target.x - fx.x, target.y - fx.y);
      const driftSpeed = 90;
      fx.x += nx * driftSpeed * dt;
      fx.y += ny * driftSpeed * dt;
    }
  }

  // Check enemies along the ring (anyone within radius but not too far inside).
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (fx.hits.has(e.id)) continue;
    const d = dist(fx.x, fx.y, e.x, e.y);
    if (d <= fx.radius + e.radius) {
      applyHit(fx, e, state);
    }
  }
}

function updateBeam(fx, state, dt) {
  if (fx.applied) return;
  fx.applied = true;

  // Single-shot: scan line segment for enemy collisions.
  const targetsHit = [];
  for (const e of state.enemies) {
    if (e.dead) continue;
    // Distance from enemy center to the line segment.
    const ex = e.x - fx.x, ey = e.y - fx.y;
    const t = Math.max(0, Math.min(fx.length, ex * fx.dx + ey * fx.dy));
    const cx = fx.x + fx.dx * t, cy = fx.y + fx.dy * t;
    const d = dist(cx, cy, e.x, e.y);
    if (d < e.radius + 7) {
      targetsHit.push(e);
    }
  }
  for (const e of targetsHit) applyHit(fx, e, state);
}

function updateAura(fx, state, dt) {
  fx.angle += fx.angularSpeed * dt;
  if (fx.follow) {
    fx.x = fx.follow.x;
    fx.y = fx.follow.y;
  }
  // Decay per-enemy hit cooldowns.
  for (const [k, v] of fx.hitCooldown) {
    if (v - dt <= 0) fx.hitCooldown.delete(k);
    else fx.hitCooldown.set(k, v - dt);
  }

  // For each orb, check collision.
  for (let i = 0; i < fx.orbs; i++) {
    const a = fx.angle + (i / fx.orbs) * TAU;
    const ox = fx.x + Math.cos(a) * fx.orbitRadius;
    const oy = fx.y + Math.sin(a) * fx.orbitRadius;

    for (const e of state.enemies) {
      if (e.dead) continue;
      if (fx.hitCooldown.has(e.id)) continue;
      if (dist(ox, oy, e.x, e.y) < fx.radius + e.radius) {
        // Manufacture an ephemeral hit-effect using the parent fx as carrier.
        const prevHits = fx.hits;
        fx.hits = null;     // bypass hit-tracking for cooldown-based aura
        applyHit(fx, e, state);
        fx.hits = prevHits;
        fx.hitCooldown.set(e.id, fx.hitInterval);
        // Optional: explode on orb impact
        if (fx.explodes) {
          spawnExplosion(state, ox, oy, fx.explodes.radius, fx.explodes.damage, fx.color, fx.element, null);
        }
        // Optional split on hit — spawn small projectile from orb.
        if (fx.splitOnHit && fx.splitsLeft > 0) {
          fx.splitsLeft--;
          if (fx.spec.onSplitTrigger) fx.spec.onSplitTrigger(fx, state, { x: ox, y: oy }, e);
        }
      }
    }
  }
}

function updateWall(fx, state, dt) {
  // Homing applied to wall center.
  if (fx.homing > 0) {
    const target = nearestEnemy(state, fx.x, fx.y, 600);
    if (target) {
      const [nx, ny] = normalize(target.x - fx.x, target.y - fx.y);
      const driftSpeed = 60;
      fx.x += nx * driftSpeed * dt;
      fx.y += ny * driftSpeed * dt;
    }
  }

  // Decay hit cooldowns.
  for (const [k, v] of fx.hits) {
    if (v - dt <= 0) fx.hits.delete(k);
    else fx.hits.set(k, v - dt);
  }

  // Wall segment from (x,y) along (dx,dy) total length.
  const half = fx.length / 2;
  const ax = fx.x - fx.dx * half, ay = fx.y - fx.dy * half;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (fx.hits.has(e.id)) continue;
    const ex = e.x - ax, ey = e.y - ay;
    const t = Math.max(0, Math.min(fx.length, ex * fx.dx + ey * fx.dy));
    const cx = ax + fx.dx * t, cy = ay + fx.dy * t;
    const d = dist(cx, cy, e.x, e.y);
    if (d < e.radius + fx.thickness) {
      // Damage and add cooldown.
      const prevHits = fx.hits;
      fx.hits = null;
      applyHit(fx, e, state);
      fx.hits = prevHits;
      fx.hits.set(e.id, fx.hitInterval);
      if (fx.explodes) {
        spawnExplosion(state, e.x, e.y, fx.explodes.radius, fx.explodes.damage, fx.color, fx.element, null);
      }
      if (fx.splitOnHit && fx.splitsLeft > 0) {
        fx.splitsLeft--;
        if (fx.spec.onSplitTrigger) fx.spec.onSplitTrigger(fx, state, { x: e.x, y: e.y }, e);
      }
    }
  }
}

function updateExplosion(fx, state, dt) {
  fx.radius = Math.min(fx.targetRadius, fx.radius + fx.growSpeed * dt);
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (fx.hits.has(e.id)) continue;
    if (dist(fx.x, fx.y, e.x, e.y) < fx.radius + e.radius) {
      applyHit(fx, e, state);
    }
  }
}

// ===== Helpers =====
export function nearestEnemy(state, x, y, maxDist, excludeIds = null) {
  let best = null, bestD = maxDist;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (excludeIds && excludeIds.has(e.id)) continue;
    const d = dist(x, y, e.x, e.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
