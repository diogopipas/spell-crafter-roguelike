// Spell composition: takes 3 rune ids (one Element, one Form, one Modifier) and
// returns a spell descriptor with a cast(state, origin, dir) function.

import { RUNES, CATEGORY } from './runes.js';
import { spawnProjectile, spawnNova, spawnBeam, spawnAura, spawnWall, spawnExplosion, nearestEnemy } from './effects.js';
import { normalize, angleTo, TAU, dist } from './util.js';

// Validate that the trio covers each category exactly once.
export function validateRunes(runeIds) {
  if (!runeIds || runeIds.length !== 3) return false;
  const cats = new Set();
  for (const id of runeIds) {
    const r = RUNES[id];
    if (!r) return false;
    cats.add(r.category);
  }
  return cats.size === 3;
}

export function composeSpell(runeIds) {
  if (!validateRunes(runeIds)) return null;

  let element, form, modifier;
  for (const id of runeIds) {
    const r = RUNES[id];
    if (r.category === CATEGORY.ELEMENT) element = r;
    else if (r.category === CATEGORY.FORM) form = r;
    else if (r.category === CATEGORY.MODIFIER) modifier = r;
  }

  const name = `${modifier.adjective} ${element.adjective} ${form.noun}`;
  const baseDamage = element.damage;

  // Form-specific mana / cooldown baseline; modifier increases cost.
  const modifierCostMul = {
    splits: 1.25,
    chains: 1.25,
    pierces: 1.15,
    homing: 1.2,
    explodes: 1.3,
  }[modifier.id];

  const manaCost = Math.round(form.manaCost * modifierCostMul);
  const cooldown = form.cooldown;

  // Build a spec object that the cast function will instantiate per shot.
  const cast = (state, origin, dir) => {
    castSpell(state, origin, dir, element, form, modifier, baseDamage);
  };

  return {
    name,
    element,
    form,
    modifier,
    damage: baseDamage,
    manaCost,
    cooldown,
    cast,
    runeIds,
  };
}

function castSpell(state, origin, dir, element, form, modifier, baseDamage) {
  // Compose a spec that captures everything the spawned effect needs.
  const spec = {
    damage: baseDamage,
    element,
    color: element.color,
    glow: element.glow,
  };

  // Apply modifier flags.
  switch (modifier.id) {
    case 'splits':
      spec.splitOnHit = true;
      spec.splitsLeft = 1;        // each spawned shot can split once more
      spec.splitAt = 0.18;        // projectile splits at ~0.18s of flight if no hit
      spec.onSplitTrigger = (fx, state, atPos, targetHit) => triggerSplit(fx, state, element, form, modifier, baseDamage, atPos);
      break;
    case 'chains':
      spec.chainsLeft = 3;
      // chains use onHit hook for projectile/beam/nova
      break;
    case 'pierces':
      spec.pierces = true;
      break;
    case 'homing':
      spec.homing = 5.5;          // radians/sec turn speed (used by projectile & wall drift)
      break;
    case 'explodes':
      spec.explodes = { radius: 70, damage: Math.round(baseDamage * 0.6) };
      break;
  }

  // onHit registers chain behavior if applicable.
  if (modifier.id === 'chains') {
    spec.onHit = (fx, target, state) => {
      if (fx.chainsLeft > 0 && fx.type !== 'aura') {
        fx.chainsLeft--;
        // Find nearest unhit enemy within range and zap.
        const excludeIds = fx.hits ? new Set(fx.hits) : new Set();
        excludeIds.add(target.id);
        const next = nearestEnemy(state, target.x, target.y, 220, excludeIds);
        if (next) {
          // Spawn a quick beam from target -> next as the "chain arc".
          spawnChainArc(state, target, next, element, Math.round(baseDamage * 0.7), fx.chainsLeft);
        }
      }
    };
  }

  // Form-specific spawn.
  switch (form.id) {
    case 'projectile':
      spec.speed = 420;
      spec.ttl = 1.6;
      spec.radius = 7;
      spawnProjectile(state, origin, dir, spec);
      break;
    case 'nova':
      spec.radius = 150;
      spec.growSpeed = 360;
      spec.ttl = 0.6;
      spawnNova(state, origin, dir, spec);
      break;
    case 'beam':
      spec.length = 520;
      spec.ttl = 0.18;
      spec.damage = Math.round(baseDamage * 1.2);
      spawnBeam(state, origin, dir, spec);
      break;
    case 'aura':
      spec.orbs = 3;
      spec.orbitRadius = 75;
      spec.angularSpeed = 2.6;
      spec.ttl = 4.0;
      spec.radius = 14;
      spec.damage = Math.round(baseDamage * 0.55);
      spawnAura(state, origin, dir, spec);
      break;
    case 'wall':
      spec.length = 140;
      spec.thickness = 14;
      spec.ttl = 3.0;
      spec.damage = Math.round(baseDamage * 0.6);
      spec.placeDistance = 70;
      spawnWall(state, origin, dir, spec);
      break;
  }
}

// Split trigger: spawn 2 extra projectiles at ±30°. The form determines what's spawned.
function triggerSplit(fx, state, element, form, modifier, baseDamage, atPos = null) {
  const origin = atPos || { x: fx.x, y: fx.y };
  // Direction = current velocity if projectile, else aim direction.
  let baseDx = 1, baseDy = 0;
  if (fx.vx !== undefined && (fx.vx !== 0 || fx.vy !== 0)) {
    const m = Math.hypot(fx.vx, fx.vy);
    baseDx = fx.vx / m; baseDy = fx.vy / m;
  } else if (fx.dx !== undefined) {
    baseDx = fx.dx; baseDy = fx.dy;
  }

  const angles = [-Math.PI / 6, Math.PI / 6];
  for (const a of angles) {
    const ndx = baseDx * Math.cos(a) - baseDy * Math.sin(a);
    const ndy = baseDx * Math.sin(a) + baseDy * Math.cos(a);
    // Spawn a smaller projectile that does NOT re-split.
    const childSpec = {
      damage: Math.round(baseDamage * 0.6),
      element,
      color: element.color,
      glow: element.glow,
      speed: 360,
      ttl: 1.0,
      radius: 5,
    };
    spawnProjectile(state, origin, { dx: ndx, dy: ndy }, childSpec);
  }
}

// Chain arc — a short beam-like effect between two enemies that applies damage on creation.
function spawnChainArc(state, fromEnt, toEnt, element, damage, chainsLeft) {
  const dx = toEnt.x - fromEnt.x, dy = toEnt.y - fromEnt.y;
  const [nx, ny] = normalize(dx, dy);
  const len = Math.hypot(dx, dy);

  // Direct damage to the next target.
  toEnt.hp -= damage;
  toEnt.hitFlash = 0.12;
  if (element.onHit) element.onHit(toEnt, null);
  if (toEnt.hp <= 0) toEnt.dead = true;

  // Visual: short-lived beam from-to-target.
  state.effects.push({
    id: -1,
    type: 'chainArc',
    x: fromEnt.x, y: fromEnt.y,
    tx: toEnt.x, ty: toEnt.y,
    color: element.color,
    glow: element.glow,
    ttl: 0.18,
    age: 0,
  });

  // Particle burst on hit.
  for (let i = 0; i < 6; i++) {
    state.particles.push({
      x: toEnt.x, y: toEnt.y,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      color: element.color,
      ttl: 0.35, life: 0.35, size: 2, fade: 0.92,
    });
  }

  if (chainsLeft > 0) {
    const excludeIds = new Set([toEnt.id]);
    const next = nearestEnemy(state, toEnt.x, toEnt.y, 220, excludeIds);
    if (next) spawnChainArc(state, toEnt, next, element, Math.round(damage * 0.85), chainsLeft - 1);
  }
}

// Default starter spells (used as fallback so the player can cast something on floor 1).
export function defaultStarterSpells() {
  return [
    composeSpell(['fire', 'projectile', 'splits']),
    composeSpell(['ice', 'nova', 'pierces']),
    composeSpell(['lightning', 'beam', 'chains']),
  ];
}
