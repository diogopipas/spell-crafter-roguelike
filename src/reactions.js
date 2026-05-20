// Elemental reactions. When a new element hits a target already carrying a
// status from a different element, trigger a burst effect.
//
// Priority: Shatter > Detonate > Conduct > Corrode > Resonance.

import { spawnExplosion, burstParticles, nearestEnemy } from './effects.js';
import { flashReaction } from './ui.js';
import { playSound } from './audio.js';

export function applyElement(element, target, state, fx) {
  target.statuses ||= {};

  let reaction = null;

  if ((element.id === 'fire' && target.statuses.chill) ||
      (element.id === 'ice'  && target.statuses.burn)) {
    shatter(target, state, fx, element);
    reaction = 'shatter';
  } else if ((element.id === 'fire'   && target.statuses.poison) ||
             (element.id === 'poison' && target.statuses.burn)) {
    detonate(target, state, fx, element);
    reaction = 'detonate';
  } else if ((element.id === 'lightning' && target.statuses.chill) ||
             (element.id === 'ice'       && target.statuses.shock)) {
    conduct(target, state, fx, element);
    reaction = 'conduct';
  } else if ((element.id === 'lightning' && target.statuses.poison) ||
             (element.id === 'poison'    && target.statuses.shock)) {
    corrode(target, state, fx, element);
    reaction = 'corrode';
  } else if (element.id !== 'arcane' && target.statuses.arcane_mark) {
    resonance(target, state, fx, element);
    reaction = 'resonance';
  }

  // Shatter consumes both elements outright; every other reaction lets the
  // new element apply its own status normally.
  if (reaction !== 'shatter' && element.onHit) {
    element.onHit(target, fx);
  }
}

function hitDamage(fx, element) {
  return fx?.damage ?? element.damage;
}

function shatter(target, state, fx, element) {
  playSound('shatter');
  delete target.statuses.burn;
  delete target.statuses.chill;
  const base = hitDamage(fx, element);
  target.hp -= Math.min(60, 3 * base);
  if (target.hp <= 0) target.dead = true;
  spawnExplosion(state, target.x, target.y, 80, Math.round(base * 1.2), '#ffffff', element, null);
  state.screenShake = Math.max(state.screenShake, 6);
  flashReaction('Shatter!');
}

function detonate(target, state, fx, element) {
  playSound('detonate');
  const stacks = target.statuses.poison?.stack ?? 1;
  const dmg = stacks * 8;
  delete target.statuses.poison;
  spawnExplosion(state, target.x, target.y, 70, dmg, '#c8ff5a', element, null);
  flashReaction('Detonate!');
}

function conduct(target, state, fx, element) {
  playSound('conduct');
  delete target.statuses.chill;
  delete target.statuses.shock;

  const dmg = Math.round(hitDamage(fx, element) * 0.6);
  const excludeIds = new Set([target.id]);
  for (let i = 0; i < 2; i++) {
    const next = nearestEnemy(state, target.x, target.y, 220, excludeIds);
    if (!next) break;
    excludeIds.add(next.id);
    next.hp -= dmg;
    next.hitFlash = 0.12;
    next.statuses ||= {};
    next.statuses.chill = { ttl: 0.8, factor: 0.6, color: '#9ee0ff' };
    if (next.hp <= 0) next.dead = true;
    state.effects.push({
      id: -1,
      type: 'chainArc',
      x: target.x, y: target.y,
      tx: next.x, ty: next.y,
      color: '#ffd84a', glow: '#fff09a',
      ttl: 0.22, age: 0,
    });
  }
  flashReaction('Conduct!');
}

function corrode(target, state, fx, element) {
  playSound('corrode');
  const stacks = target.statuses.poison?.stack ?? 1;
  const halved = Math.max(1, Math.floor(stacks / 2));
  const excludeIds = new Set([target.id]);
  for (let i = 0; i < 2; i++) {
    const next = nearestEnemy(state, target.x, target.y, 180, excludeIds);
    if (!next) break;
    excludeIds.add(next.id);
    next.statuses ||= {};
    next.statuses.poison = { ttl: 3, dps: 3 * halved, stack: halved, color: '#aaff88' };
    burstParticles(state, next.x, next.y, '#7be84a', 8, { speed: 150, ttl: 0.5, size: 2 });
  }
  flashReaction('Corrode!');
}

function resonance(target, state, fx, element) {
  playSound('resonance');
  target.hp -= element.damage;
  delete target.statuses.arcane_mark;
  burstParticles(state, target.x, target.y, '#c478ff', 12, { speed: 180, ttl: 0.5, size: 2.5 });
  if (target.hp <= 0) target.dead = true;
  flashReaction('Resonance!');
}
