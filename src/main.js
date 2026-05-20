// Entry point.

import { Game } from './game.js';
import { initInput } from './input.js';
import { initUI } from './ui.js';

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);

initInput(canvas);
initUI(game);

game.start();

// expose for debugging
window.__game = game;
