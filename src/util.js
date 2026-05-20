// Math, RNG, color, and small helpers.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
export const angleTo = (fromX, fromY, toX, toY) => Math.atan2(toY - fromY, toX - fromX);

export function randRange(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function chance(p) { return Math.random() < p; }

export function normalize(x, y) {
  const m = Math.hypot(x, y);
  if (m < 1e-9) return [0, 0];
  return [x / m, y / m];
}

// Shortest signed angle delta from a to b.
export function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// Rotate a point around the origin.
export function rotate(x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

// Hex color helpers (#rrggbb)
export function hexWithAlpha(hex, alpha) {
  const a = clamp(alpha, 0, 1);
  if (hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return hex;
}

// AABB overlap.
export function rectsOverlap(a, b, pad = 0) {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x ||
           a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

// Bresenham line for line-of-sight checks. Returns list of [x,y] cells.
export function* lineCells(x0, y0, x1, y1) {
  x0 = x0 | 0; y0 = y0 | 0; x1 = x1 | 0; y1 = y1 | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
