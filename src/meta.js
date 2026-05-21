// Persistent meta-progression: cross-run unlocks, soul shards, lifetime stats,
// and mid-run save snapshots. All state lives in localStorage; the rest of the
// game reads it via the small API at the bottom of this file.

const META_KEY = 'spellcaster:meta';
const RUN_KEY = 'spellcaster:run';

const DEFAULT_UNLOCKED_RUNES = ['fire', 'ice', 'projectile', 'beam', 'splits', 'pierces'];
const DEFAULT_UNLOCKED_TRINKETS = ['healthLocket', 'manaCrystal'];

// Cost in soul shards to permanently unlock each gated item.
export const UNLOCK_COSTS = {
  rune: {
    lightning: 3, poison: 3, arcane: 6,
    nova: 2, aura: 3, wall: 3,
    chains: 2, homing: 3, explodes: 3,
  },
  trinket: {
    focusStone: 2, springBoots: 2,
    emberCharm: 2, frostCharm: 2, stormCharm: 3,
    quickstepBand: 4,
  },
};

const DEFAULT_META = {
  shards: 0,
  unlockedRunes: [...DEFAULT_UNLOCKED_RUNES],
  unlockedTrinkets: [...DEFAULT_UNLOCKED_TRINKETS],
  bossesKilled: {},   // bossId -> true (first-kill ledger for bonus shards)
  stats: {
    runs: 0,
    deaths: 0,
    floorsCleared: 0,
    bossesKilled: 0,
    deepestFloor: 1,
    bestGold: 0,
    shardsEarned: 0,
    shardsSpent: 0,
    kills: {},        // elementId -> count, plus 'unflagged' for non-status kills
  },
};

let meta = loadMeta();

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return clone(DEFAULT_META);
    const parsed = JSON.parse(raw);
    return mergeDefaults(parsed);
  } catch {
    return clone(DEFAULT_META);
  }
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Older saves may lack newer fields; merge in DEFAULT_META keys without
// clobbering anything the user already has.
function mergeDefaults(parsed) {
  const out = clone(DEFAULT_META);
  if (typeof parsed.shards === 'number') out.shards = parsed.shards;
  if (Array.isArray(parsed.unlockedRunes)) out.unlockedRunes = parsed.unlockedRunes.slice();
  if (Array.isArray(parsed.unlockedTrinkets)) out.unlockedTrinkets = parsed.unlockedTrinkets.slice();
  if (parsed.bossesKilled && typeof parsed.bossesKilled === 'object') out.bossesKilled = { ...parsed.bossesKilled };
  if (parsed.stats && typeof parsed.stats === 'object') {
    out.stats = { ...out.stats, ...parsed.stats };
    if (parsed.stats.kills && typeof parsed.stats.kills === 'object') {
      out.stats.kills = { ...parsed.stats.kills };
    }
  }
  // Anyone who already has a save and never saw the defaults gets them too.
  for (const id of DEFAULT_UNLOCKED_RUNES) if (!out.unlockedRunes.includes(id)) out.unlockedRunes.push(id);
  for (const id of DEFAULT_UNLOCKED_TRINKETS) if (!out.unlockedTrinkets.includes(id)) out.unlockedTrinkets.push(id);
  return out;
}

// ===== Public API =====

export function getMeta() {
  return meta;
}

export function isUnlocked(kind, id) {
  if (kind === 'rune') return meta.unlockedRunes.includes(id);
  if (kind === 'trinket') return meta.unlockedTrinkets.includes(id);
  return false;
}

export function unlockCost(kind, id) {
  return UNLOCK_COSTS[kind]?.[id] ?? null;
}

// Spend shards and add the id to the unlock list. Returns true on success.
export function unlock(kind, id) {
  if (isUnlocked(kind, id)) return false;
  const cost = unlockCost(kind, id);
  if (cost == null) return false;
  if (meta.shards < cost) return false;
  meta.shards -= cost;
  meta.stats.shardsSpent += cost;
  if (kind === 'rune') meta.unlockedRunes.push(id);
  else if (kind === 'trinket') meta.unlockedTrinkets.push(id);
  saveMeta();
  return true;
}

// Returns the number of shards actually added (after first-time bonuses).
export function addShards(n) {
  meta.shards += n;
  meta.stats.shardsEarned += n;
  saveMeta();
  return n;
}

// Award shards for a floor clear. First time clearing a new depth grants +1.
// Returns { total, base, bonus } for HUD messaging.
export function awardFloorClear(floor) {
  const base = 1;
  let bonus = 0;
  if (floor > meta.stats.deepestFloor) {
    bonus = 1;
    meta.stats.deepestFloor = floor;
  }
  meta.stats.floorsCleared += 1;
  addShards(base + bonus);
  return { total: base + bonus, base, bonus };
}

// Award shards for a boss kill. First time killing that boss grants +5.
// Returns { total, base, bonus } for HUD messaging.
export function awardBossKill(bossId) {
  const base = 3;
  let bonus = 0;
  if (!meta.bossesKilled[bossId]) {
    bonus = 5;
    meta.bossesKilled[bossId] = true;
  }
  meta.stats.bossesKilled += 1;
  addShards(base + bonus);
  return { total: base + bonus, base, bonus };
}

export function recordStat(key, delta = 1) {
  meta.stats[key] = (meta.stats[key] || 0) + delta;
  saveMeta();
}

export function recordMax(key, value) {
  if (value > (meta.stats[key] || 0)) {
    meta.stats[key] = value;
    saveMeta();
  }
}

export function recordKillByElement(elementId) {
  const key = elementId || 'unflagged';
  meta.stats.kills[key] = (meta.stats.kills[key] || 0) + 1;
  saveMeta();
}

// Wipe all meta-progression — used by the Stats screen reset button.
export function resetMeta() {
  meta = clone(DEFAULT_META);
  saveMeta();
  clearRun();
}

// ===== Mid-run save =====

// Serialize the minimum needed to resume mid-run. The world is regenerated
// from `floor`; enemies and effects are dropped. Spell closures (`spell.cast`)
// can't be serialized — we save the rune triplet per slot and recompose on load.
export function saveRun(game) {
  if (!game || !game.player) return;
  const p = game.player;
  const snapshot = {
    floor: game.floor,
    player: {
      hp: p.hp, maxHp: p.maxHp,
      mana: p.mana, maxMana: p.maxMana,
      manaRegen: p.manaRegen,
      speed: p.speed, radius: p.radius,
      gold: p.gold,
      inventory: { ...p.inventory },
      activeSlot: p.activeSlot,
      spellSlots: p.spellSlots.map(s => s && s.runes ? { runes: s.runes.slice() } : null),
      trinkets: p.trinkets.slice(),
    },
  };
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(snapshot));
  } catch {}
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {}
}

export function hasRun() {
  try {
    return !!localStorage.getItem(RUN_KEY);
  } catch {
    return false;
  }
}
