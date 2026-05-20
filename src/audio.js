// Procedural Web Audio: SFX synthesis + ambient music.
// All sounds are generated at runtime — no audio assets required.

const STORAGE_KEY = 'spellcaster:audio';
const DEFAULTS = { muted: false, musicVol: 0.55, sfxVol: 0.75 };

const settings = loadSettings();

let ctx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicStarted = false;
let musicState = null;

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function initAudio() {
  if (ctx) {
    // Resume if suspended (some browsers suspend on tab switch).
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  masterGain = ctx.createGain();
  masterGain.gain.value = settings.muted ? 0 : 1;
  masterGain.connect(ctx.destination);

  musicGain = ctx.createGain();
  musicGain.gain.value = settings.musicVol;
  musicGain.connect(masterGain);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = settings.sfxVol;
  sfxGain.connect(masterGain);

  startMusic();

  // Browsers may suspend the context when the tab loses focus. Resume on return.
  document.addEventListener('visibilitychange', () => {
    if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume();
  });
}

export function getAudioSettings() {
  return { ...settings };
}

export function setMuted(m) {
  settings.muted = !!m;
  if (masterGain) masterGain.gain.setTargetAtTime(settings.muted ? 0 : 1, ctx.currentTime, 0.02);
  saveSettings();
}

export function setMusicVolume(v) {
  settings.musicVol = clamp01(v);
  if (musicGain) musicGain.gain.setTargetAtTime(settings.musicVol, ctx.currentTime, 0.02);
  saveSettings();
}

export function setSfxVolume(v) {
  settings.sfxVol = clamp01(v);
  if (sfxGain) sfxGain.gain.setTargetAtTime(settings.sfxVol, ctx.currentTime, 0.02);
  saveSettings();
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// Wire the DOM audio controls. Safe to call before initAudio() — slider
// changes will just update saved settings until the AudioContext exists.
export function bindAudioUI() {
  const root = document.getElementById('audio-controls');
  const muteBtn = document.getElementById('audio-mute');
  const musicSlider = document.getElementById('audio-music');
  const sfxSlider = document.getElementById('audio-sfx');
  if (!root || !muteBtn || !musicSlider || !sfxSlider) return;

  musicSlider.value = Math.round(settings.musicVol * 100);
  sfxSlider.value = Math.round(settings.sfxVol * 100);
  root.classList.toggle('muted', settings.muted);

  muteBtn.addEventListener('click', () => {
    setMuted(!settings.muted);
    root.classList.toggle('muted', settings.muted);
  });
  musicSlider.addEventListener('input', () => setMusicVolume(musicSlider.value / 100));
  sfxSlider.addEventListener('input', () => setSfxVolume(sfxSlider.value / 100));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      // Don't toggle mute if the user is typing in an input.
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      setMuted(!settings.muted);
      root.classList.toggle('muted', settings.muted);
    }
  });
}

// ===== SFX =====

export function playSound(name, opts = {}) {
  if (!ctx || settings.muted) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try {
    fn(opts);
  } catch (e) {
    // Swallow audio errors so a bad SFX never crashes the game.
    console.warn('audio: error playing', name, e);
  }
}

// Tiny helper: short noise buffer (reused).
let _noiseBuf = null;
function noiseBuffer() {
  if (_noiseBuf) return _noiseBuf;
  const len = ctx.sampleRate * 1.0;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _noiseBuf = buf;
  return buf;
}

function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  return src;
}

// Build an ADSR-ish envelope on a gain node.
function envGain(peak, attack, decay, sustain, release, t0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.linearRampToValueAtTime(sustain * peak, t0 + attack + decay);
  g.gain.linearRampToValueAtTime(0, t0 + attack + decay + release);
  return g;
}

function shortEnv(peak, attack, decay, t0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return g;
}

const SOUNDS = {
  cast: (opts) => {
    const t = ctx.currentTime;
    const element = opts.element?.id || 'fire';
    if (element === 'fire') {
      // Sawtooth sweep up + noise crackle.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      const g = shortEnv(0.18, 0.005, 0.22, t);
      osc.connect(g).connect(sfxGain);
      osc.start(t); osc.stop(t + 0.28);

      const noise = noiseSource();
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = 1800;
      nFilter.Q.value = 2;
      const nG = shortEnv(0.12, 0.005, 0.18, t);
      noise.connect(nFilter).connect(nG).connect(sfxGain);
      noise.start(t); noise.stop(t + 0.22);
    } else if (element === 'ice') {
      // Sine glissando down + filtered shimmer.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(360, t + 0.25);
      const g = shortEnv(0.22, 0.005, 0.3, t);
      osc.connect(g).connect(sfxGain);
      osc.start(t); osc.stop(t + 0.35);

      const noise = noiseSource();
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'highpass';
      nFilter.frequency.value = 3500;
      const nG = shortEnv(0.08, 0.01, 0.22, t);
      noise.connect(nFilter).connect(nG).connect(sfxGain);
      noise.start(t); noise.stop(t + 0.25);
    } else if (element === 'lightning') {
      // Square burst + noise zap.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(680, t);
      osc.frequency.linearRampToValueAtTime(220, t + 0.12);
      const g = shortEnv(0.15, 0.002, 0.14, t);
      osc.connect(g).connect(sfxGain);
      osc.start(t); osc.stop(t + 0.18);

      const noise = noiseSource();
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = 2400;
      nFilter.Q.value = 0.8;
      const nG = shortEnv(0.18, 0.001, 0.12, t);
      noise.connect(nFilter).connect(nG).connect(sfxGain);
      noise.start(t); noise.stop(t + 0.15);
    } else if (element === 'poison') {
      // Detuned triangles, queasy.
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const base = 240 + i * 18;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base * 0.6, t + 0.28);
        const g = shortEnv(0.12, 0.01, 0.32, t);
        osc.connect(g).connect(sfxGain);
        osc.start(t); osc.stop(t + 0.36);
      }
    } else {
      // arcane: FM bell.
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      carrier.type = 'sine'; mod.type = 'sine';
      carrier.frequency.setValueAtTime(440, t);
      mod.frequency.setValueAtTime(660, t);
      modGain.gain.setValueAtTime(220, t);
      modGain.gain.exponentialRampToValueAtTime(2, t + 0.5);
      mod.connect(modGain).connect(carrier.frequency);
      const g = shortEnv(0.18, 0.005, 0.5, t);
      carrier.connect(g).connect(sfxGain);
      carrier.start(t); carrier.stop(t + 0.55);
      mod.start(t); mod.stop(t + 0.55);
    }
  },

  hit: (opts) => {
    const t = ctx.currentTime;
    const intensity = Math.min(2, Math.max(0.3, (opts.intensity || 10) / 14));
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.08);
    const g = shortEnv(0.18 * intensity, 0.001, 0.09, t);
    noise.connect(filter).connect(g).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.12);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const og = shortEnv(0.1 * intensity, 0.001, 0.1, t);
    osc.connect(og).connect(sfxGain);
    osc.start(t); osc.stop(t + 0.12);
  },

  enemyDeath: () => {
    const t = ctx.currentTime;
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    const g = shortEnv(0.18, 0.005, 0.3, t);
    noise.connect(filter).connect(g).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.35);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const startF = 300 + Math.random() * 80;
    osc.frequency.setValueAtTime(startF, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.3);
    const og = shortEnv(0.1, 0.005, 0.32, t);
    osc.connect(og).connect(sfxGain);
    osc.start(t); osc.stop(t + 0.36);
  },

  playerHurt: () => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.linearRampToValueAtTime(70, t + 0.22);
    const g = shortEnv(0.22, 0.005, 0.28, t);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    osc.connect(filter).connect(g).connect(sfxGain);
    osc.start(t); osc.stop(t + 0.32);

    const noise = noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 500;
    const ng = shortEnv(0.16, 0.001, 0.2, t);
    noise.connect(nf).connect(ng).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.24);
  },

  pickup: () => {
    const t = ctx.currentTime;
    const notes = [880, 1320];
    notes.forEach((f, i) => {
      const start = t + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, start);
      const g = shortEnv(0.16, 0.005, 0.2, start);
      osc.connect(g).connect(sfxGain);
      osc.start(start); osc.stop(start + 0.25);
    });
  },

  gameOver: () => {
    const t = ctx.currentTime;
    // Descending minor triad pad.
    const notes = [330, 277, 220, 165];
    notes.forEach((f, i) => {
      const start = t + i * 0.22;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.08);
      g.gain.linearRampToValueAtTime(0, start + 0.6);
      osc.connect(g).connect(sfxGain);
      osc.start(start); osc.stop(start + 0.65);
    });
  },

  shatter: () => {
    const t = ctx.currentTime;
    // Glass-break noise with sweeping bandpass.
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(4500, t);
    filter.frequency.exponentialRampToValueAtTime(1200, t + 0.4);
    const g = shortEnv(0.25, 0.005, 0.45, t);
    noise.connect(filter).connect(g).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.5);

    // Bass thump.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const og = shortEnv(0.3, 0.005, 0.3, t);
    osc.connect(og).connect(sfxGain);
    osc.start(t); osc.stop(t + 0.35);
  },

  detonate: () => detonateBoom(0.45, 90),
  exploderBoom: () => detonateBoom(0.5, 70),

  conduct: () => {
    const t = ctx.currentTime;
    // Quick square arpeggio with random jitter — electric chain.
    const baseFreqs = [520, 720, 900, 660, 820];
    baseFreqs.forEach((f, i) => {
      const start = t + i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f * (0.9 + Math.random() * 0.2), start);
      const g = shortEnv(0.12, 0.001, 0.08, start);
      osc.connect(g).connect(sfxGain);
      osc.start(start); osc.stop(start + 0.1);
    });
    // Crackle layer.
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2200;
    const ng = shortEnv(0.1, 0.001, 0.3, t);
    noise.connect(filter).connect(ng).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.32);
  },

  corrode: () => {
    const t = ctx.currentTime;
    // Acid hiss + sour detuned tone.
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 1.2;
    const ng = shortEnv(0.16, 0.01, 0.4, t);
    noise.connect(filter).connect(ng).connect(sfxGain);
    noise.start(t); noise.stop(t + 0.45);

    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = 180 + i * 11;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * 0.85, t + 0.4);
      const og = shortEnv(0.08, 0.01, 0.42, t);
      const oFilter = ctx.createBiquadFilter();
      oFilter.type = 'lowpass';
      oFilter.frequency.value = 1100;
      osc.connect(oFilter).connect(og).connect(sfxGain);
      osc.start(t); osc.stop(t + 0.45);
    }
  },

  resonance: () => {
    const t = ctx.currentTime;
    // FM bell with longer decay.
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    carrier.type = 'sine'; mod.type = 'sine';
    carrier.frequency.setValueAtTime(520, t);
    mod.frequency.setValueAtTime(780, t);
    modGain.gain.setValueAtTime(340, t);
    modGain.gain.exponentialRampToValueAtTime(2, t + 0.8);
    mod.connect(modGain).connect(carrier.frequency);
    const g = shortEnv(0.22, 0.005, 0.9, t);
    carrier.connect(g).connect(sfxGain);
    carrier.start(t); carrier.stop(t + 0.95);
    mod.start(t); mod.stop(t + 0.95);

    // Higher harmonic shimmer.
    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(1040, t);
    const hg = shortEnv(0.08, 0.01, 0.7, t);
    harm.connect(hg).connect(sfxGain);
    harm.start(t); harm.stop(t + 0.75);
  },

  floorDown: () => {
    const t = ctx.currentTime;
    // Descending sine sweep.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.9);
    const g = shortEnv(0.22, 0.02, 1.0, t);
    osc.connect(g).connect(sfxGain);
    osc.start(t); osc.stop(t + 1.05);

    // Low rumble.
    const noise = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    const ng = shortEnv(0.18, 0.05, 0.95, t);
    noise.connect(filter).connect(ng).connect(sfxGain);
    noise.start(t); noise.stop(t + 1.05);
  },
};

function detonateBoom(decay, centerFreq) {
  const t = ctx.currentTime;
  // Big noise burst, lowpass.
  const noise = noiseSource();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + decay);
  const g = shortEnv(0.32, 0.003, decay, t);
  noise.connect(filter).connect(g).connect(sfxGain);
  noise.start(t); noise.stop(t + decay + 0.05);

  // Sub bass drop.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(centerFreq * 2, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + decay);
  const og = shortEnv(0.36, 0.002, decay, t);
  osc.connect(og).connect(sfxGain);
  osc.start(t); osc.stop(t + decay + 0.05);
}

// ===== Music =====
// Two-layer ambient: a sustained drone pair + a sparse pentatonic arp.
// Scheduled via look-ahead on the AudioContext clock for glitch-free playback.

const SCHEDULE_INTERVAL_MS = 100;
const SCHEDULE_AHEAD_S = 0.25;

// Minor pentatonic in A (A C D E G), spread across octaves.
const PENTA_A = [220, 261.63, 293.66, 329.63, 392.00, 440, 523.25, 587.33, 659.25, 783.99];

function startMusic() {
  if (musicStarted) return;
  musicStarted = true;

  // Drone: two detuned sawtooths through a slowly sweeping lowpass.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 320;
  droneFilter.Q.value = 4;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.06;
  droneFilter.connect(droneGain).connect(musicGain);

  const droneBase = 55; // A1
  const d1 = ctx.createOscillator();
  d1.type = 'sawtooth';
  d1.frequency.value = droneBase;
  d1.connect(droneFilter);
  d1.start();
  const d2 = ctx.createOscillator();
  d2.type = 'sawtooth';
  d2.frequency.value = droneBase * 1.005;
  d2.connect(droneFilter);
  d2.start();
  const d3 = ctx.createOscillator();
  d3.type = 'sawtooth';
  d3.frequency.value = droneBase * 1.5; // perfect fifth
  d3.connect(droneFilter);
  d3.start();

  // LFO on the filter cutoff for slow movement.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(droneFilter.frequency);
  lfo.start();

  musicState = {
    drone: { d1, d2, d3, baseFreq: droneBase, filter: droneFilter },
    nextNoteTime: ctx.currentTime + 0.5,
    beatIndex: 0,
  };

  setInterval(scheduleArp, SCHEDULE_INTERVAL_MS);
}

function scheduleArp() {
  if (!ctx || !musicState) return;
  const now = ctx.currentTime;
  // If the tab was backgrounded, setInterval is throttled and we'd otherwise
  // burst-schedule dozens of past-due notes all at once on refocus.
  if (musicState.nextNoteTime < now) musicState.nextNoteTime = now + 0.05;

  // Read current floor for subtle music shifts.
  const floor = (window.__game && window.__game.floor) || 1;
  // Each floor: slightly faster tempo + lower drone.
  const bpm = 60 + Math.min(40, (floor - 1) * 3);
  const beatLen = 60 / bpm;

  // Adjust drone base pitch (slow target — avoids zipper noise).
  const targetBase = 55 * Math.pow(2, -(floor - 1) * 0.05); // ~half-step down per floor
  if (musicState.drone) {
    musicState.drone.d1.frequency.setTargetAtTime(targetBase, now, 1.5);
    musicState.drone.d2.frequency.setTargetAtTime(targetBase * 1.005, now, 1.5);
    musicState.drone.d3.frequency.setTargetAtTime(targetBase * 1.5, now, 1.5);
  }

  while (musicState.nextNoteTime < now + SCHEDULE_AHEAD_S) {
    // Sparse: only play on some beats.
    const density = 0.35 + Math.min(0.35, (floor - 1) * 0.04);
    if (Math.random() < density) {
      const freq = PENTA_A[Math.floor(Math.random() * PENTA_A.length)];
      playArpNote(freq, musicState.nextNoteTime);
    }
    musicState.nextNoteTime += beatLen / 2;
    musicState.beatIndex++;
  }
}

function playArpNote(freq, when) {
  // Soft triangle pluck with a quick filter sweep.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, when);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 4, when);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.5, when + 0.5);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.08, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.7);

  osc.connect(filter).connect(g).connect(musicGain);
  osc.start(when);
  osc.stop(when + 0.75);
}
