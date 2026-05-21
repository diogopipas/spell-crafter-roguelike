// Entry point.

import { Game } from './game.js';
import { initInput } from './input.js';
import { initUI, openMetaMenu, openStats, closeMetaMenu, closeStats } from './ui.js';
import { initAudio, bindAudioUI } from './audio.js';
import { hasRun } from './meta.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);

initUI(game);
bindAudioUI();

// expose for debugging
window.__game = game;

let started = false;
const titleScreen = document.getElementById('title-screen');
const playBtn = document.getElementById('play-btn');
const continueBtn = document.getElementById('continue-btn');
const metaBtn = document.getElementById('meta-btn');
const statsBtn = document.getElementById('stats-btn');

function refreshTitleButtons() {
  if (hasRun()) {
    continueBtn.classList.remove('hidden');
    playBtn.textContent = 'New Run';
  } else {
    continueBtn.classList.add('hidden');
    playBtn.textContent = 'Play (Space)';
  }
}

function startGame({ resume = false } = {}) {
  if (started) return;
  if (!resume && hasRun()) {
    if (!confirm('Start a new run? Your saved run will be discarded.')) return;
  }
  started = true;
  titleScreen.classList.add('hidden');
  window.removeEventListener('keydown', onTitleKey);
  initAudio();
  initInput(canvas);
  game.start({ resume });
}

function onTitleKey(e) {
  const metaOpen = !document.getElementById('meta-menu').classList.contains('hidden');
  const statsOpen = !document.getElementById('stats-screen').classList.contains('hidden');
  if (e.key === 'Escape') {
    if (metaOpen) { closeMetaMenu(); return; }
    if (statsOpen) { closeStats(); return; }
  }
  if (metaOpen || statsOpen) return;
  if (e.key === 'Enter' || e.key === ' ') {
    if (e.key === ' ') e.preventDefault();
    // Space/Enter resumes if a save exists, otherwise starts new.
    startGame({ resume: hasRun() });
  }
}

refreshTitleButtons();

playBtn.addEventListener('click', () => startGame({ resume: false }));
continueBtn.addEventListener('click', () => startGame({ resume: true }));
metaBtn.addEventListener('click', () => openMetaMenu());
statsBtn.addEventListener('click', () => openStats());

window.addEventListener('keydown', onTitleKey);
