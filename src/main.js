// Entry point.

import { Game } from './game.js';
import { initInput } from './input.js';
import { initUI } from './ui.js';
import { initAudio, bindAudioUI } from './audio.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);

initUI(game);
bindAudioUI();

// expose for debugging
window.__game = game;

let started = false;
const titleScreen = document.getElementById('title-screen');
const playBtn = document.getElementById('play-btn');

function startGame() {
  if (started) return;
  started = true;
  titleScreen.classList.add('hidden');
  window.removeEventListener('keydown', onTitleKey);
  initAudio();
  initInput(canvas);
  game.start();
}

function onTitleKey(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    if (e.key === ' ') e.preventDefault();
    startGame();
  }
}

playBtn.addEventListener('click', startGame);
window.addEventListener('keydown', onTitleKey);
