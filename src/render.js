// Canvas rendering: tiles, fog, entities, effects, particles. Camera follows player.

import { TILE, TILE_SIZE } from './world.js';
import { TAU, clamp, hexWithAlpha } from './util.js';

export const VIEW_W = 1280;
export const VIEW_H = 720;

export class Camera {
  constructor() { this.x = 0; this.y = 0; }
  follow(target, dt) {
    const tx = target.x - VIEW_W / 2;
    const ty = target.y - VIEW_H / 2;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);
  }
}

export function render(ctx, state) {
  const cam = state.camera;
  let shakeX = 0, shakeY = 0;
  if (state.screenShake > 0) {
    shakeX = (Math.random() - 0.5) * state.screenShake;
    shakeY = (Math.random() - 0.5) * state.screenShake;
  }

  ctx.save();
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.translate(-cam.x + shakeX, -cam.y + shakeY);

  renderTiles(ctx, state);
  renderBossBarrier(ctx, state);
  renderPickups(ctx, state);
  renderShopkeeper(ctx, state);
  renderPlayer(ctx, state);
  renderEnemies(ctx, state);
  renderEnemyEffects(ctx, state);
  renderEffects(ctx, state);
  renderParticles(ctx, state);
  renderFog(ctx, state);

  ctx.restore();
}

function renderTiles(ctx, state) {
  const { world, camera } = state;
  const startTx = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const endTx = Math.min(world.w, Math.ceil((camera.x + VIEW_W) / TILE_SIZE) + 1);
  const startTy = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endTy = Math.min(world.h, Math.ceil((camera.y + VIEW_H) / TILE_SIZE) + 1);

  // Themed floor colors keyed off world.decor (1 = fire, 2 = ice, 3 = arcane).
  const DECOR_FLOOR = ['#181826', '#2a1414', '#142233', '#211a2e'];
  const DECOR_GRID = ['rgba(255,255,255,0.02)', 'rgba(255,140,90,0.06)', 'rgba(160,210,255,0.06)', 'rgba(220,160,255,0.06)'];

  for (let ty = startTy; ty < endTy; ty++) {
    for (let tx = startTx; tx < endTx; tx++) {
      const idx = ty * world.w + tx;
      const seen = world.seen[idx];
      if (seen === 0) continue;     // unseen — black

      const t = world.get(tx, ty);
      const x = tx * TILE_SIZE, y = ty * TILE_SIZE;

      if (t === TILE.FLOOR) {
        const decor = world.decor ? world.decor[idx] : 0;
        ctx.fillStyle = DECOR_FLOOR[decor] || DECOR_FLOOR[0];
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // Subtle grid
        ctx.fillStyle = DECOR_GRID[decor] || DECOR_GRID[0];
        ctx.fillRect(x, y, TILE_SIZE, 1);
        ctx.fillRect(x, y, 1, TILE_SIZE);
      } else if (t === TILE.WALL) {
        ctx.fillStyle = '#2a2a3e';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#1c1c2a';
        ctx.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE, 4);
      } else if (t === TILE.STAIRS) {
        ctx.fillStyle = '#181826';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#d4c47a';
        ctx.fillRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        ctx.fillStyle = '#08080c';
        for (let i = 0; i < 4; i++) ctx.fillRect(x + 6, y + 6 + i * 5, TILE_SIZE - 12, 2);
      }
    }
  }
}

function renderFog(ctx, state) {
  const { world, camera } = state;
  const startTx = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const endTx = Math.min(world.w, Math.ceil((camera.x + VIEW_W) / TILE_SIZE) + 1);
  const startTy = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endTy = Math.min(world.h, Math.ceil((camera.y + VIEW_H) / TILE_SIZE) + 1);

  for (let ty = startTy; ty < endTy; ty++) {
    for (let tx = startTx; tx < endTx; tx++) {
      const seen = world.seen[ty * world.w + tx];
      const x = tx * TILE_SIZE, y = ty * TILE_SIZE;
      if (seen === 0) {
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      } else if (seen === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function renderPlayer(ctx, state) {
  const p = state.player;
  drawGlowCircle(ctx, p.x, p.y, p.radius, '#9aceff', '#d4e8ff', 0.9);

  // Aim arrow.
  const dx = state.aim.x - p.x, dy = state.aim.y - p.y;
  const m = Math.hypot(dx, dy);
  if (m > 0.1) {
    const nx = dx / m, ny = dy / m;
    ctx.strokeStyle = 'rgba(212, 196, 122, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x + nx * (p.radius + 4), p.y + ny * (p.radius + 4));
    ctx.lineTo(p.x + nx * (p.radius + 18), p.y + ny * (p.radius + 18));
    ctx.stroke();
  }

  // iframes flash.
  if (p.iframes > 0 && Math.floor(p.iframes * 20) % 2 === 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 2, 0, TAU);
    ctx.stroke();
  }
}

function renderEnemies(ctx, state) {
  for (const e of state.enemies) {
    if (e.dead) continue;
    let color = e.color, glow = e.glow;
    // Tint by statuses.
    if (e.statuses.burn) glow = '#ff7a4a';
    if (e.statuses.poison) color = blendColor(color, '#7be84a', 0.4);
    if (e.statuses.chill) color = blendColor(color, '#5acaff', 0.4);
    if (e.statuses.shock) color = blendColor(color, '#ffd84a', 0.3);
    if (e.statuses.arcane_mark) glow = '#e0a8ff';

    const glowStrength = e.isBoss ? 1.4 : 0.85;
    drawGlowCircle(ctx, e.x, e.y, e.radius, color, glow, glowStrength);

    // Boss extra: a slowly-rotating outer ring to make them feel distinct.
    if (e.isBoss) {
      const t = performance.now() / 400;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(t);
      ctx.strokeStyle = hexWithAlpha(e.glow, 0.5);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 8, a, a + 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (e.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(e.hitFlash * 3, 0, 1)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, TAU);
      ctx.fill();
    }

    // Per-enemy HP bar — suppressed for bosses (the DOM bar handles it).
    if (!e.isBoss) {
      const hpw = e.radius * 2;
      const ratio = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(e.x - hpw / 2, e.y - e.radius - 8, hpw, 3);
      ctx.fillStyle = ratio > 0.5 ? '#7be84a' : ratio > 0.25 ? '#ffd84a' : '#e84545';
      ctx.fillRect(e.x - hpw / 2, e.y - e.radius - 8, hpw * ratio, 3);
    }
  }
}

function renderBossBarrier(ctx, state) {
  const bar = state.bossBarrier;
  if (!bar) return;
  const t = performance.now() / 200;
  for (const seg of bar.segments) {
    const { rectX, rectY, rectW, rectH } = seg;
    // Outer soft glow.
    ctx.fillStyle = hexWithAlpha(bar.glow, 0.18);
    ctx.fillRect(rectX - 4, rectY - 4, rectW + 8, rectH + 8);
    // Core curtain.
    ctx.fillStyle = hexWithAlpha(bar.color, 0.55);
    ctx.fillRect(rectX, rectY, rectW, rectH);
    // Animated bright bands across the segment.
    const isHorizontal = seg.axis === 'h';
    const stride = 14;
    ctx.fillStyle = hexWithAlpha(bar.glow, 0.85);
    if (isHorizontal) {
      const span = rectW;
      for (let x = (t * 30) % stride - stride; x < span; x += stride) {
        ctx.fillRect(rectX + x, rectY + 2, 4, rectH - 4);
      }
    } else {
      const span = rectH;
      for (let y = (t * 30) % stride - stride; y < span; y += stride) {
        ctx.fillRect(rectX + 2, rectY + y, rectW - 4, 4);
      }
    }
  }
}

function renderPickups(ctx, state) {
  const t = performance.now() / 600;
  for (const p of state.pickups) {
    if (p.consumed) continue;
    const tile = state.world.seen[Math.floor(p.y / TILE_SIZE) * state.world.w + Math.floor(p.x / TILE_SIZE)];
    if (tile === 0) continue;
    const bob = Math.sin(t + p.bobPhase) * 2;

    if (p.goldAmount) {
      // Gold coin pickup.
      const r = p.radius;
      drawGlowCircle(ctx, p.x, p.y + bob, r, '#ffd84a', '#fff09a', 0.9);
      ctx.fillStyle = '#7a5d10';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', p.x, p.y + bob + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      continue;
    }

    // Rune pickup.
    const rune = state.runesById[p.runeId];
    const color = rune?.color || '#fff';
    const glow = rune?.glow || '#fff';
    drawGlowCircle(ctx, p.x, p.y + bob, p.radius, color, glow, 1.0);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + 0.2 * Math.sin(t * 2 + p.bobPhase)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, p.radius + 4, 0, TAU);
    ctx.stroke();
  }
}

function renderShopkeeper(ctx, state) {
  const s = state.shopkeeper;
  if (!s) return;
  const tile = state.world.seen[Math.floor(s.y / TILE_SIZE) * state.world.w + Math.floor(s.x / TILE_SIZE)];
  if (tile === 0) return;
  const t = performance.now() / 500;
  const bob = Math.sin(t) * 1.5;
  drawGlowCircle(ctx, s.x, s.y + bob, s.radius, '#d4c47a', '#ffe88a', 1.0);
  ctx.fillStyle = '#11111c';
  ctx.font = 'bold 14px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', s.x, s.y + bob + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (state._nearShop) {
    ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
    ctx.fillRect(s.x - 50, s.y - s.radius - 24, 100, 16);
    ctx.fillStyle = '#ffe88a';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Press E to shop', s.x, s.y - s.radius - 16);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function renderEffects(ctx, state) {
  for (const fx of state.effects) {
    if (fx.type === 'projectile') {
      drawGlowCircle(ctx, fx.x, fx.y, fx.radius + 2, fx.color, fx.glow, 1.0);
    } else if (fx.type === 'nova') {
      ctx.strokeStyle = hexWithAlpha(fx.color, clamp(fx.ttl / 0.6, 0, 1));
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.glow, clamp(fx.ttl / 0.6, 0, 1) * 0.5);
      ctx.lineWidth = 12;
      ctx.stroke();
    } else if (fx.type === 'beam') {
      const ex = fx.x + fx.dx * fx.length, ey = fx.y + fx.dy * fx.length;
      const alpha = clamp(fx.ttl / 0.18, 0, 1);
      ctx.strokeStyle = hexWithAlpha(fx.glow, alpha * 0.4);
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.color, alpha);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y); ctx.lineTo(ex, ey); ctx.stroke();
    } else if (fx.type === 'aura') {
      for (let i = 0; i < fx.orbs; i++) {
        const a = fx.angle + (i / fx.orbs) * TAU;
        const ox = fx.x + Math.cos(a) * fx.orbitRadius;
        const oy = fx.y + Math.sin(a) * fx.orbitRadius;
        drawGlowCircle(ctx, ox, oy, fx.radius, fx.color, fx.glow, 0.9);
      }
      // Faint orbit ring.
      ctx.strokeStyle = hexWithAlpha(fx.glow, 0.15);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.orbitRadius, 0, TAU);
      ctx.stroke();
    } else if (fx.type === 'wall') {
      const half = fx.length / 2;
      const ax = fx.x - fx.dx * half, ay = fx.y - fx.dy * half;
      const bx = fx.x + fx.dx * half, by = fx.y + fx.dy * half;
      const alpha = clamp(fx.ttl / 1.0, 0.2, 1);
      ctx.strokeStyle = hexWithAlpha(fx.glow, alpha * 0.35);
      ctx.lineWidth = fx.thickness * 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.color, alpha);
      ctx.lineWidth = fx.thickness;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (fx.type === 'explosion') {
      const t = fx.radius / fx.targetRadius;
      ctx.fillStyle = hexWithAlpha(fx.glow, (1 - t) * 0.4);
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexWithAlpha(fx.color, 1 - t);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.stroke();
    } else if (fx.type === 'chainArc') {
      const alpha = clamp(fx.ttl / 0.18, 0, 1);
      ctx.strokeStyle = hexWithAlpha(fx.glow, alpha * 0.6);
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.tx, fx.ty); ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.color, alpha);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.tx, fx.ty); ctx.stroke();
    }
  }
}

function renderEnemyEffects(ctx, state) {
  for (const fx of state.enemyEffects) {
    if (fx.type === 'enemyProjectile') {
      drawGlowCircle(ctx, fx.x, fx.y, fx.radius + 1, fx.color, fx.glow, 0.85);
    } else if (fx.type === 'enemyExplosion') {
      const t = fx.radius / fx.targetRadius;
      ctx.fillStyle = `rgba(255, 184, 104, ${(1 - t) * 0.35})`;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255, 184, 104, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.stroke();
    } else if (fx.type === 'bossNova') {
      if (fx.age < fx.telegraph) {
        // Telegraph ring: pulsing dashed circle at target radius.
        const pulse = 0.5 + 0.5 * Math.sin(fx.age * 16);
        ctx.strokeStyle = hexWithAlpha(fx.glow, 0.25 + 0.35 * pulse);
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.targetRadius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const t = fx.radius / fx.targetRadius;
        ctx.fillStyle = hexWithAlpha(fx.glow, (1 - t) * 0.35);
        ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.fill();
        ctx.strokeStyle = hexWithAlpha(fx.color, 1 - t);
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius, 0, TAU); ctx.stroke();
      }
    } else if (fx.type === 'bossHazard') {
      const alpha = clamp(fx.ttl / 2.5, 0.2, 1);
      const half = fx.length / 2;
      const ax = fx.x - fx.dx * half, ay = fx.y - fx.dy * half;
      const bx = fx.x + fx.dx * half, by = fx.y + fx.dy * half;
      ctx.strokeStyle = hexWithAlpha(fx.glow, alpha * 0.4);
      ctx.lineWidth = fx.thickness * 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.color, alpha);
      ctx.lineWidth = fx.thickness;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (fx.type === 'bossBeam') {
      const isTele = fx.age < fx.telegraph;
      const alpha = isTele ? 0.4 + 0.4 * Math.sin(fx.age * 14) : clamp(fx.ttl / 1.6, 0.3, 1);
      const dx = Math.cos(fx.angle), dy = Math.sin(fx.angle);
      const ex = fx.x + dx * fx.length, ey = fx.y + dy * fx.length;
      ctx.strokeStyle = hexWithAlpha(fx.glow, alpha * 0.45);
      ctx.lineWidth = (isTele ? fx.thickness * 0.6 : fx.thickness * 2.4);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = hexWithAlpha(fx.color, alpha);
      ctx.lineWidth = (isTele ? 2 : fx.thickness);
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }
}

function renderParticles(ctx, state) {
  for (const p of state.particles) {
    const alpha = clamp(p.ttl / p.life, 0, 1);
    ctx.fillStyle = hexWithAlpha(p.color, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha + 0.5, 0, TAU);
    ctx.fill();
  }
}

function drawGlowCircle(ctx, x, y, r, color, glow, glowStrength = 1) {
  // Soft outer glow.
  const outerR = r * (2.2 + glowStrength * 0.6);
  const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, outerR);
  grad.addColorStop(0, hexWithAlpha(glow, 0.55 * glowStrength));
  grad.addColorStop(1, hexWithAlpha(glow, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, TAU);
  ctx.fill();

  // Core.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  // Highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, TAU);
  ctx.fill();
}

function blendColor(hexA, hexB, t) {
  const pa = parseHex(hexA), pb = parseHex(hexB);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const b = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${b})`;
}
function parseHex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
