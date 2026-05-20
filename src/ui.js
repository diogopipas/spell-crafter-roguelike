// DOM-based UI: HUD bars, spell slot panels, crafter overlay with drag-and-drop.

import { RUNES, CATEGORY } from './runes.js';
import { composeSpell, validateRunes } from './spells.js';
import { setInputSuspended } from './input.js';

const els = {};
let state = null;
let craftSlots = [null, null, null];  // rune ids in [element, form, modifier] positions
let dragRune = null;
let onClose = null;

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
