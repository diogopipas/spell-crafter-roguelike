// DOM-based UI: HUD bars, spell slot panels, crafter overlay with drag-and-drop.

import { RUNES, CATEGORY, ELEMENTS, FORMS, MODIFIERS } from './runes.js';
import { composeSpell, validateRunes } from './spells.js';
import { setInputSuspended } from './input.js';
import { TRINKETS, allTrinketIds, applyTrinket, unapplyTrinket } from './trinkets.js';
import { getMeta, isUnlocked, unlock, unlockCost, resetMeta } from './meta.js';

const els = {};
let state = null;
let craftSlots = [null, null, null];  // rune ids in [element, form, modifier] positions
let dragRune = null;
let onClose = null;
let pendingPurchase = null;     // trinket id awaiting a swap-target slot click

export function initUI(gameState) {
  state = gameState;
  els.hp = document.getElementById('hp-fill');
  els.hpText = document.getElementById('hp-text');
  els.mp = document.getElementById('mp-fill');
  els.mpText = document.getElementById('mp-text');
  els.floor = document.getElementById('floor-indicator');
  els.slots = document.querySelectorAll('.spell-slot');
  els.crafter = document.getElementById('crafter');
  els.crafterClose = document.getElementById('crafter-close');
  els.craftSlots = document.querySelectorAll('.craft-slot');
  els.recipeName = document.getElementById('recipe-name');
  els.recipeStats = document.getElementById('recipe-stats');
  els.equipButtons = document.querySelectorAll('[data-equip]');
  els.craftClear = document.getElementById('craft-clear');
  els.gameOver = document.getElementById('game-over');
  els.gameOverText = document.getElementById('game-over-text');
  els.restartBtn = document.getElementById('restart-btn');
  els.messageLog = document.getElementById('message-log');
  els.goldIndicator = document.getElementById('gold-indicator');
  els.trinketSlots = document.querySelectorAll('.trinket-slot');
  els.shop = document.getElementById('shop');
  els.shopClose = document.getElementById('shop-close');
  els.shopGold = document.getElementById('shop-gold');
  els.shopItems = document.getElementById('shop-items');
  els.shopEquipped = document.querySelectorAll('.trinket-equip-slot');
  els.shopHint = document.getElementById('shop-hint');
  els.bossBar = document.getElementById('boss-bar');
  els.bossName = document.getElementById('boss-name');
  els.bossFill = document.getElementById('boss-fill');
  els.metaMenu = document.getElementById('meta-menu');
  els.metaShards = document.getElementById('meta-shards');
  els.metaClose = document.getElementById('meta-close');
  els.metaGroups = {
    element: document.querySelector('[data-meta-group="element"]'),
    form: document.querySelector('[data-meta-group="form"]'),
    modifier: document.querySelector('[data-meta-group="modifier"]'),
    trinket: document.querySelector('[data-meta-group="trinket"]'),
  };
  els.statsScreen = document.getElementById('stats-screen');
  els.statsBody = document.getElementById('stats-body');
  els.statsClose = document.getElementById('stats-close');
  els.statsReset = document.getElementById('stats-reset');

  if (els.metaClose) els.metaClose.addEventListener('click', () => closeMetaMenu());
  if (els.statsClose) els.statsClose.addEventListener('click', () => closeStats());
  if (els.statsReset) els.statsReset.addEventListener('click', () => {
    const confirmation = prompt('Type DELETE to wipe all progress.');
    if (confirmation === 'DELETE') {
      resetMeta();
      renderStats();
      flashMessage('All progress reset.');
    }
  });

  els.crafterClose.addEventListener('click', () => closeCrafter());
  els.craftClear.addEventListener('click', () => {
    craftSlots = [null, null, null];
    renderCrafter();
  });

  els.equipButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const slotIdx = parseInt(btn.dataset.equip, 10);
      equipCurrentRecipe(slotIdx);
    });
  });

  els.craftSlots.forEach((slotEl) => {
    slotEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      slotEl.classList.add('drag-over');
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', (e) => {
      e.preventDefault();
      slotEl.classList.remove('drag-over');
      if (!dragRune) return;
      placeRuneInRecipe(dragRune);
      dragRune = null;
      renderCrafter();
    });
    slotEl.addEventListener('click', () => {
      const idx = parseInt(slotEl.dataset.craft, 10);
      if (craftSlots[idx]) {
        craftSlots[idx] = null;
        renderCrafter();
      }
    });
  });

  els.restartBtn.addEventListener('click', () => state.restart());

  els.shopClose.addEventListener('click', () => closeShop());
  els.shopEquipped.forEach((slotEl) => {
    slotEl.addEventListener('click', () => {
      const idx = parseInt(slotEl.dataset.equip, 10);
      handleEquipSlotClick(idx);
    });
  });
}

// Place rune in the slot matching its category.
function placeRuneInRecipe(runeId) {
  const rune = RUNES[runeId];
  if (!rune) return;
  const idx = rune.category === CATEGORY.ELEMENT ? 0
            : rune.category === CATEGORY.FORM ? 1 : 2;
  craftSlots[idx] = runeId;
}

function equipCurrentRecipe(slotIdx) {
  const ids = craftSlots.slice();
  if (!validateRunes(ids)) {
    flashMessage('Recipe incomplete.');
    return;
  }
  for (const id of ids) {
    if ((state.player.inventory[id] || 0) <= 0) {
      flashMessage(`Out of ${RUNES[id].name} runes.`);
      return;
    }
  }
  const spell = composeSpell(ids);
  for (const id of ids) state.player.inventory[id]--;
  state.player.spellSlots[slotIdx] = { runes: ids, spell };
  craftSlots = [null, null, null];
  flashMessage(`Equipped ${spell.name} to slot ${slotIdx + 1}.`);
  renderCrafter();
  updateHUD();
}

export function updateHUD() {
  if (!state || !state.player) return;
  const p = state.player;

  els.hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
  els.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;
  els.mp.style.width = `${(p.mana / p.maxMana) * 100}%`;
  els.mpText.textContent = `${Math.floor(p.mana)} / ${p.maxMana}`;
  els.floor.textContent = `Floor ${state.floor}`;

  els.slots.forEach((slotEl, i) => {
    const slot = p.spellSlots[i];
    slotEl.classList.toggle('active', i === p.activeSlot);
    const runesContainer = slotEl.querySelector('.slot-runes');
    const nameEl = slotEl.querySelector('.slot-name');
    runesContainer.innerHTML = '';
    if (slot && slot.spell) {
      for (const id of slot.runes) {
        const r = RUNES[id];
        const gem = document.createElement('div');
        gem.className = 'rune-gem';
        gem.style.color = r.color;
        gem.title = r.name;
        runesContainer.appendChild(gem);
      }
      nameEl.textContent = slot.spell.name;
    } else {
      nameEl.textContent = '—';
    }
  });

  updateBossBar();

  if (els.goldIndicator) els.goldIndicator.textContent = `Gold: ${p.gold || 0}`;
  if (els.trinketSlots && p.trinkets) {
    els.trinketSlots.forEach((slotEl, i) => {
      const id = p.trinkets[i];
      slotEl.innerHTML = '';
      if (id) {
        const t = TRINKETS[id];
        slotEl.classList.add('filled');
        slotEl.style.color = t.color;
        slotEl.title = `${t.name} — ${t.desc}`;
        const icon = document.createElement('span');
        icon.textContent = t.icon;
        icon.style.color = '#11111c';
        slotEl.appendChild(icon);
      } else {
        slotEl.classList.remove('filled');
        slotEl.style.color = '';
        slotEl.title = '';
      }
    });
  }
}

export function openCrafter() {
  els.crafter.classList.remove('hidden');
  setInputSuspended(true);
  renderCrafter();
}

export function closeCrafter() {
  els.crafter.classList.add('hidden');
  setInputSuspended(false);
}

export function toggleCrafter() {
  if (els.crafter.classList.contains('hidden')) openCrafter();
  else closeCrafter();
}

function renderCrafter() {
  // Render inventory grouped by category.
  const groups = {
    [CATEGORY.ELEMENT]: document.querySelector('.rune-inventory[data-category="element"]'),
    [CATEGORY.FORM]: document.querySelector('.rune-inventory[data-category="form"]'),
    [CATEGORY.MODIFIER]: document.querySelector('.rune-inventory[data-category="modifier"]'),
  };
  for (const k in groups) groups[k].innerHTML = '';

  for (const [runeId, count] of Object.entries(state.player.inventory)) {
    if (count <= 0) continue;
    const rune = RUNES[runeId];
    if (!rune) continue;
    const container = groups[rune.category];
    const card = document.createElement('div');
    card.className = 'rune-card';
    card.draggable = true;
    card.innerHTML = `<div class="rune-gem" style="color:${rune.color}"></div><div class="rune-name">${rune.name}</div><div class="rune-count">×${count}</div>`;
    card.addEventListener('dragstart', () => { dragRune = runeId; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { dragRune = null; card.classList.remove('dragging'); });
    card.addEventListener('click', () => {
      placeRuneInRecipe(runeId);
      renderCrafter();
    });
    container.appendChild(card);
  }

  // Render craft slots.
  els.craftSlots.forEach((slotEl, i) => {
    const runeId = craftSlots[i];
    slotEl.querySelectorAll('.rune-gem, .rune-name-mini').forEach(o => o.remove());
    if (runeId) {
      const rune = RUNES[runeId];
      slotEl.classList.add('filled');
      const gem = document.createElement('div');
      gem.className = 'rune-gem';
      gem.style.color = rune.color;
      slotEl.appendChild(gem);
      const lab = document.createElement('div');
      lab.className = 'rune-name-mini';
      lab.style.fontSize = '10px';
      lab.style.color = '#aaa';
      lab.textContent = rune.name;
      slotEl.appendChild(lab);
    } else {
      slotEl.classList.remove('filled');
    }
  });

  // Recipe preview.
  if (validateRunes(craftSlots)) {
    const spell = composeSpell(craftSlots);
    els.recipeName.textContent = spell.name;
    els.recipeStats.innerHTML = `
      <div>Damage: ${spell.damage}</div>
      <div>Mana cost: ${spell.manaCost}</div>
      <div>Cooldown: ${spell.cooldown.toFixed(2)}s</div>
      <div style="margin-top:6px; color:${spell.element.color}">Element: ${spell.element.name}</div>
      <div style="color:#bbb">Form: ${spell.form.name}</div>
      <div style="color:${spell.modifier.color}">Modifier: ${spell.modifier.name}</div>
    `;
    els.equipButtons.forEach(b => b.disabled = false);
  } else {
    els.recipeName.textContent = 'Pick one rune from each category…';
    els.recipeStats.innerHTML = '';
    els.equipButtons.forEach(b => b.disabled = true);
  }
}

export function showGameOver(text) {
  els.gameOverText.textContent = text;
  els.gameOver.classList.remove('hidden');
}
export function hideGameOver() {
  els.gameOver.classList.add('hidden');
}

export function flashMessage(text) {
  const div = document.createElement('div');
  div.className = 'log-msg';
  div.textContent = text;
  els.messageLog.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// Maps boss theme → CSS custom properties applied to the boss bar (color +
// glow). The boss must be `engaged` (player is inside the room) for the bar
// to show — pre-engagement we don't want to spoil the encounter.
const BOSS_BAR_THEMES = {
  fire:   { a: '#ff6a3a', b: '#ffb868', border: '#ff8c5a', glow: 'rgba(255, 138, 90, 0.7)', name: '#ffd2a8' },
  ice:    { a: '#5acaff', b: '#aee4ff', border: '#7cd6ff', glow: 'rgba(124, 214, 255, 0.7)', name: '#d8efff' },
  arcane: { a: '#c084ff', b: '#e0a8ff', border: '#d09bff', glow: 'rgba(208, 155, 255, 0.7)', name: '#f0d8ff' },
};

function updateBossBar() {
  if (!els.bossBar) return;
  const boss = state && state.activeBoss;
  const engaged = state && state.bossEngaged;
  if (!boss || !engaged) {
    if (!els.bossBar.classList.contains('hidden')) els.bossBar.classList.add('hidden');
    return;
  }
  els.bossBar.classList.remove('hidden');
  els.bossName.textContent = boss.name;
  const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  els.bossFill.style.width = `${ratio * 100}%`;
  const theme = BOSS_BAR_THEMES[boss.theme] || BOSS_BAR_THEMES.arcane;
  const style = els.bossBar.style;
  style.setProperty('--boss-a', theme.a);
  style.setProperty('--boss-b', theme.b);
  style.setProperty('--boss-border', theme.border);
  style.setProperty('--boss-glow', theme.glow);
  style.setProperty('--boss-name-color', theme.name);
}

export function flashReaction(text) {
  const div = document.createElement('div');
  div.className = 'log-msg log-reaction';
  div.textContent = text;
  els.messageLog.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

export function resetCrafter() {
  craftSlots = [null, null, null];
}

// ===== Shop =====

export function openShop() {
  if (!els.shop) return;
  pendingPurchase = null;
  els.shop.classList.remove('hidden');
  setInputSuspended(true);
  renderShop();
}

export function closeShop() {
  if (!els.shop) return;
  pendingPurchase = null;
  els.shop.classList.add('hidden');
  setInputSuspended(false);
}

export function toggleShop() {
  if (!els.shop) return;
  if (els.shop.classList.contains('hidden')) openShop();
  else closeShop();
}

function renderShop() {
  if (!state || !state.player) return;
  const p = state.player;
  els.shopGold.textContent = `Gold: ${p.gold || 0}`;

  // Items grid.
  els.shopItems.innerHTML = '';
  for (const id of allTrinketIds()) {
    if (!isUnlocked('trinket', id)) continue;
    const t = TRINKETS[id];
    const equipped = p.trinkets.includes(id);
    const affordable = (p.gold || 0) >= t.cost;
    const card = document.createElement('div');
    card.className = 'trinket-card' + (equipped ? ' equipped' : affordable ? ' affordable' : '');
    card.innerHTML = `
      <div class="trinket-card-head">
        <div class="trinket-icon" style="color:${t.color}"><span>${t.icon}</span></div>
        <div>${t.name}</div>
      </div>
      <div class="trinket-desc">${t.desc}</div>
      <div class="trinket-cost">${t.cost} gold</div>
    `;
    const btn = document.createElement('button');
    btn.className = 'trinket-buy';
    if (equipped) {
      btn.textContent = 'Equipped';
      btn.disabled = true;
    } else if (!affordable) {
      btn.textContent = `Need ${t.cost - (p.gold || 0)} more`;
      btn.disabled = true;
    } else {
      btn.textContent = 'Buy';
      btn.addEventListener('click', () => attemptBuy(id));
    }
    card.appendChild(btn);
    els.shopItems.appendChild(card);
  }

  // Equipped slots.
  els.shopEquipped.forEach((slotEl, i) => {
    slotEl.innerHTML = '';
    const id = p.trinkets[i];
    const isSwapTarget = pendingPurchase !== null;
    slotEl.classList.toggle('swap-target', isSwapTarget);
    if (id) {
      const t = TRINKETS[id];
      slotEl.classList.add('filled');
      slotEl.style.color = t.color;
      const icon = document.createElement('div');
      icon.className = 'trinket-icon';
      icon.style.color = t.color;
      icon.innerHTML = `<span>${t.icon}</span>`;
      const name = document.createElement('div');
      name.className = 'trinket-equip-slot-name';
      name.textContent = t.name;
      slotEl.appendChild(icon);
      slotEl.appendChild(name);
    } else {
      slotEl.classList.remove('filled');
      slotEl.style.color = '';
      slotEl.textContent = isSwapTarget ? 'Click to place' : 'Empty';
    }
  });

  if (pendingPurchase) {
    const t = TRINKETS[pendingPurchase];
    els.shopHint.textContent = `Click a slot to equip ${t.name} (replaces existing).`;
    els.shopHint.classList.add('swap-mode');
  } else {
    els.shopHint.textContent = 'Click an equipped trinket to unequip it.';
    els.shopHint.classList.remove('swap-mode');
  }
}

function attemptBuy(id) {
  const p = state.player;
  const t = TRINKETS[id];
  if (!t) return;
  if (p.trinkets.includes(id)) {
    flashMessage('Already equipped.');
    return;
  }
  if ((p.gold || 0) < t.cost) {
    flashMessage('Not enough gold.');
    return;
  }

  // Find a free slot.
  const freeIdx = p.trinkets.indexOf(null);
  if (freeIdx !== -1) {
    p.gold -= t.cost;
    p.trinkets[freeIdx] = id;
    applyTrinket(p, id);
    flashMessage(`Equipped ${t.name}.`);
    renderShop();
    updateHUD();
  } else {
    // All slots full — enter swap mode.
    pendingPurchase = id;
    flashMessage(`Click a slot to replace with ${t.name}.`);
    renderShop();
  }
}

function handleEquipSlotClick(idx) {
  const p = state.player;
  if (pendingPurchase) {
    const buyId = pendingPurchase;
    const t = TRINKETS[buyId];
    if ((p.gold || 0) < t.cost) {
      flashMessage('Not enough gold.');
      pendingPurchase = null;
      renderShop();
      return;
    }
    const oldId = p.trinkets[idx];
    if (oldId) {
      unapplyTrinket(p, oldId);
    }
    p.gold -= t.cost;
    p.trinkets[idx] = buyId;
    applyTrinket(p, buyId);
    pendingPurchase = null;
    flashMessage(oldId ? `Swapped ${TRINKETS[oldId].name} → ${t.name}.` : `Equipped ${t.name}.`);
    renderShop();
    updateHUD();
    return;
  }
  // No pending purchase: clicking an equipped slot unequips it.
  const id = p.trinkets[idx];
  if (id) {
    unapplyTrinket(p, id);
    p.trinkets[idx] = null;
    flashMessage(`Unequipped ${TRINKETS[id].name}.`);
    renderShop();
    updateHUD();
  }
}

// ===== Meta menu =====

export function openMetaMenu() {
  if (!els.metaMenu) return;
  els.metaMenu.classList.remove('hidden');
  setInputSuspended(true);
  renderMetaMenu();
}

export function closeMetaMenu() {
  if (!els.metaMenu) return;
  els.metaMenu.classList.add('hidden');
  setInputSuspended(false);
}

function renderMetaMenu() {
  const meta = getMeta();
  els.metaShards.textContent = `Soul Shards: ${meta.shards}`;

  renderMetaGroup('element', ELEMENTS, 'rune');
  renderMetaGroup('form', FORMS, 'rune');
  renderMetaGroup('modifier', MODIFIERS, 'rune');
  renderMetaTrinkets();
}

function renderMetaGroup(groupKey, runeList, unlockKind) {
  const container = els.metaGroups[groupKey];
  if (!container) return;
  container.innerHTML = '';
  for (const rune of runeList) {
    container.appendChild(buildMetaCard({
      name: rune.name,
      color: rune.color,
      kind: unlockKind,
      id: rune.id,
    }));
  }
}

function renderMetaTrinkets() {
  const container = els.metaGroups.trinket;
  if (!container) return;
  container.innerHTML = '';
  for (const id of allTrinketIds()) {
    const t = TRINKETS[id];
    container.appendChild(buildMetaCard({
      name: t.name,
      color: t.color,
      kind: 'trinket',
      id,
      icon: t.icon,
      desc: t.desc,
    }));
  }
}

function buildMetaCard({ name, color, kind, id, icon, desc }) {
  const meta = getMeta();
  const unlocked = isUnlocked(kind, id);
  const cost = unlockCost(kind, id);
  const card = document.createElement('div');
  card.className = 'meta-card' + (unlocked ? ' unlocked' : '');
  card.style.borderColor = color;

  const title = document.createElement('div');
  title.className = 'meta-card-name';
  title.style.color = color;
  title.textContent = icon ? `${icon} ${name}` : name;
  card.appendChild(title);

  if (desc) {
    const d = document.createElement('div');
    d.className = 'meta-card-desc';
    d.textContent = desc;
    card.appendChild(d);
  }

  const btn = document.createElement('button');
  btn.className = 'meta-card-btn';
  if (unlocked) {
    btn.textContent = '✓ Unlocked';
    btn.disabled = true;
  } else if (cost == null) {
    btn.textContent = 'Default';
    btn.disabled = true;
  } else if (meta.shards < cost) {
    btn.textContent = `${cost} shards (need ${cost - meta.shards} more)`;
    btn.disabled = true;
  } else {
    btn.textContent = `Unlock — ${cost} shards`;
    btn.addEventListener('click', () => {
      if (unlock(kind, id)) {
        flashMessage(`Unlocked ${name}.`);
        renderMetaMenu();
      }
    });
  }
  card.appendChild(btn);
  return card;
}

// ===== Stats screen =====

export function openStats() {
  if (!els.statsScreen) return;
  els.statsScreen.classList.remove('hidden');
  setInputSuspended(true);
  renderStats();
}

export function closeStats() {
  if (!els.statsScreen) return;
  els.statsScreen.classList.add('hidden');
  setInputSuspended(false);
}

function renderStats() {
  const meta = getMeta();
  const s = meta.stats;
  const rows = [
    ['Runs', s.runs],
    ['Deaths', s.deaths],
    ['Floors cleared', s.floorsCleared],
    ['Bosses killed', s.bossesKilled],
    ['Deepest floor', s.deepestFloor],
    ['Best gold (single run)', s.bestGold],
    ['Soul shards earned', s.shardsEarned],
    ['Soul shards spent', s.shardsSpent],
    ['Soul shards held', meta.shards],
  ];
  for (const elementId of ['fire', 'ice', 'lightning', 'poison', 'arcane']) {
    rows.push([`Kills — ${elementId}`, s.kills?.[elementId] || 0]);
  }
  if (s.kills?.unflagged) rows.push(['Kills — no element', s.kills.unflagged]);

  els.statsBody.innerHTML = rows.map(([k, v]) =>
    `<div class="stat-row"><span>${k}</span><span>${v}</span></div>`
  ).join('');
}

// Called by the game when shards are awarded mid-run so the player sees it.
export function flashShards(n, reason) {
  if (n <= 0) return;
  flashReaction(`+${n} Soul Shard${n === 1 ? '' : 's'}${reason ? ` (${reason})` : ''}`);
}
