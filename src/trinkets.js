// Trinkets: small passive accessories sold by the shopkeeper.
// Each trinket either mutates player stats on equip (kind: 'mutator') or
// contributes a multiplier read at use sites (kind: 'multiplier').

export const TRINKETS = {
  healthLocket: {
    name: 'Health Locket',
    cost: 40,
    color: '#ff7a7a',
    icon: '♥',
    desc: '+1 Max HP. Heals 1 HP when equipped.',
    kind: 'mutator',
    apply(p) { p.maxHp += 1; p.hp = Math.min(p.hp + 1, p.maxHp); },
    unapply(p) { p.maxHp -= 1; if (p.hp > p.maxHp) p.hp = p.maxHp; },
  },
  manaCrystal: {
    name: 'Mana Crystal',
    cost: 30,
    color: '#7fbfff',
    icon: '◆',
    desc: '+25 Max Mana.',
    kind: 'mutator',
    apply(p) { p.maxMana += 25; p.mana = Math.min(p.mana + 25, p.maxMana); },
    unapply(p) { p.maxMana -= 25; if (p.mana > p.maxMana) p.mana = p.maxMana; },
  },
  focusStone: {
    name: 'Focus Stone',
    cost: 35,
    color: '#a8a0ff',
    icon: '◇',
    desc: '+5 Mana Regen per second.',
    kind: 'mutator',
    apply(p) { p.manaRegen += 5; },
    unapply(p) { p.manaRegen -= 5; },
  },
  springBoots: {
    name: 'Spring Boots',
    cost: 35,
    color: '#7be84a',
    icon: '➤',
    desc: '+20 Move Speed.',
    kind: 'mutator',
    apply(p) { p.speed += 20; },
    unapply(p) { p.speed -= 20; },
  },
  emberCharm: {
    name: 'Ember Charm',
    cost: 30,
    color: '#ff7a4a',
    icon: '✦',
    desc: '+15% Fire damage.',
    kind: 'multiplier',
    multiplier: { type: 'element', element: 'fire', value: 0.15 },
  },
  frostCharm: {
    name: 'Frost Charm',
    cost: 30,
    color: '#5acaff',
    icon: '✦',
    desc: '+15% Ice damage.',
    kind: 'multiplier',
    multiplier: { type: 'element', element: 'ice', value: 0.15 },
  },
  stormCharm: {
    name: 'Storm Charm',
    cost: 30,
    color: '#ffd84a',
    icon: '✦',
    desc: '+15% Lightning damage.',
    kind: 'multiplier',
    multiplier: { type: 'element', element: 'lightning', value: 0.15 },
  },
  quickstepBand: {
    name: 'Quickstep Band',
    cost: 45,
    color: '#d4c47a',
    icon: '◌',
    desc: '-10% Spell Cooldowns.',
    kind: 'multiplier',
    multiplier: { type: 'cooldown', value: 0.10 },
  },
};

export function allTrinketIds() { return Object.keys(TRINKETS); }

export function applyTrinket(player, id) {
  const t = TRINKETS[id];
  if (!t) return;
  if (t.kind === 'mutator') t.apply(player);
}

export function unapplyTrinket(player, id) {
  const t = TRINKETS[id];
  if (!t) return;
  if (t.kind === 'mutator') t.unapply(player);
}

// Sum elemental damage bonus from equipped trinkets.
// Returns a damage multiplier (e.g. 1.30 = +30%).
export function getElementMultiplier(player, elementId) {
  if (!player || !player.trinkets || !elementId) return 1;
  let bonus = 0;
  for (const id of player.trinkets) {
    if (!id) continue;
    const t = TRINKETS[id];
    if (t && t.kind === 'multiplier' && t.multiplier.type === 'element' && t.multiplier.element === elementId) {
      bonus += t.multiplier.value;
    }
  }
  return 1 + bonus;
}

// Returns a cooldown multiplier (e.g. 0.90 = -10%).
export function getCooldownMultiplier(player) {
  if (!player || !player.trinkets) return 1;
  let reduction = 0;
  for (const id of player.trinkets) {
    if (!id) continue;
    const t = TRINKETS[id];
    if (t && t.kind === 'multiplier' && t.multiplier.type === 'cooldown') {
      reduction += t.multiplier.value;
    }
  }
  return Math.max(0.2, 1 - reduction);
}
