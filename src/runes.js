// Rune definitions: 5 Elements x 5 Forms x 5 Modifiers = 125 unique combos.

export const CATEGORY = {
  ELEMENT: 'element',
  FORM: 'form',
  MODIFIER: 'modifier',
};

export const RUNES = {
  // ===== Elements =====
  fire: {
    id: 'fire', name: 'Fire', category: CATEGORY.ELEMENT,
    color: '#ff5a2a', glow: '#ff7a4a',
    damage: 14, adjective: 'Fiery', short: 'F',
    onHit: (target, eff) => {
      // Apply burn DoT.
      target.statuses ||= {};
      target.statuses.burn = { ttl: 2.5, dps: 6, color: '#ff7a4a' };
    },
  },
  ice: {
    id: 'ice', name: 'Ice', category: CATEGORY.ELEMENT,
    color: '#5acaff', glow: '#9ee0ff',
    damage: 10, adjective: 'Frost', short: 'I',
    onHit: (target) => {
      target.statuses ||= {};
      target.statuses.slow = { ttl: 1.5, factor: 0.45, color: '#9ee0ff' };
    },
  },
  lightning: {
    id: 'lightning', name: 'Lightning', category: CATEGORY.ELEMENT,
    color: '#ffd84a', glow: '#fff09a',
    damage: 22, adjective: 'Shock', short: 'L',
    onHit: () => {},
  },
  poison: {
    id: 'poison', name: 'Poison', category: CATEGORY.ELEMENT,
    color: '#7be84a', glow: '#aaff88',
    damage: 8, adjective: 'Venom', short: 'P',
    onHit: (target) => {
      target.statuses ||= {};
      const cur = target.statuses.poison;
      const stack = cur ? Math.min(5, cur.stack + 1) : 1;
      target.statuses.poison = { ttl: 4, dps: 3 * stack, stack, color: '#aaff88' };
    },
  },
  arcane: {
    id: 'arcane', name: 'Arcane', category: CATEGORY.ELEMENT,
    color: '#c478ff', glow: '#e0a8ff',
    damage: 18, adjective: 'Arcane', short: 'A',
    onHit: () => {},
  },

  // ===== Forms =====
  projectile: {
    id: 'projectile', name: 'Projectile', category: CATEGORY.FORM,
    color: '#aaaaaa', glow: '#dddddd',
    noun: 'Bolt', short: 'Pr',
    manaCost: 12, cooldown: 0.25,
  },
  nova: {
    id: 'nova', name: 'Nova', category: CATEGORY.FORM,
    color: '#aaaaaa', glow: '#dddddd',
    noun: 'Nova', short: 'No',
    manaCost: 25, cooldown: 0.8,
  },
  beam: {
    id: 'beam', name: 'Beam', category: CATEGORY.FORM,
    color: '#aaaaaa', glow: '#dddddd',
    noun: 'Beam', short: 'Be',
    manaCost: 18, cooldown: 0.4,
  },
  aura: {
    id: 'aura', name: 'Aura', category: CATEGORY.FORM,
    color: '#aaaaaa', glow: '#dddddd',
    noun: 'Aura', short: 'Au',
    manaCost: 30, cooldown: 1.2,
  },
  wall: {
    id: 'wall', name: 'Wall', category: CATEGORY.FORM,
    color: '#aaaaaa', glow: '#dddddd',
    noun: 'Wall', short: 'Wa',
    manaCost: 22, cooldown: 0.9,
  },

  // ===== Modifiers =====
  splits: {
    id: 'splits', name: 'Splits', category: CATEGORY.MODIFIER,
    color: '#ff9aff', glow: '#ffc8ff',
    adjective: 'Forking', short: 'Sp',
  },
  chains: {
    id: 'chains', name: 'Chains', category: CATEGORY.MODIFIER,
    color: '#9affff', glow: '#c8ffff',
    adjective: 'Chaining', short: 'Ch',
  },
  pierces: {
    id: 'pierces', name: 'Pierces', category: CATEGORY.MODIFIER,
    color: '#ffe88a', glow: '#fff5b8',
    adjective: 'Piercing', short: 'Pi',
  },
  homing: {
    id: 'homing', name: 'Homing', category: CATEGORY.MODIFIER,
    color: '#ff8aaa', glow: '#ffb8c8',
    adjective: 'Seeking', short: 'Ho',
  },
  explodes: {
    id: 'explodes', name: 'Explodes', category: CATEGORY.MODIFIER,
    color: '#ffaa5a', glow: '#ffd098',
    adjective: 'Volatile', short: 'Ex',
  },
};

export const ELEMENTS = Object.values(RUNES).filter(r => r.category === CATEGORY.ELEMENT);
export const FORMS = Object.values(RUNES).filter(r => r.category === CATEGORY.FORM);
export const MODIFIERS = Object.values(RUNES).filter(r => r.category === CATEGORY.MODIFIER);

export function getRune(id) { return RUNES[id]; }

export function allRuneIds() { return Object.keys(RUNES); }
