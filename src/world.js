// Procedural dungeon generation: rooms + L-shaped corridors.
// Tile types:
//   0 = wall
//   1 = floor
//   2 = stairs down

import { randInt, randRange, pick, clamp, lineCells } from './util.js';

export const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };
export const TILE_SIZE = 28;

export class World {
  constructor(width, height, floor = 1) {
    this.w = width;
    this.h = height;
    this.floor = floor;
    this.tiles = new Uint8Array(width * height);
    this.seen = new Uint8Array(width * height);   // 0 = unseen, 1 = seen, 2 = visible now
    this.rooms = [];
    this.stairsX = 0;
    this.stairsY = 0;
    this._fovRange = 8;
  }

  idx(x, y) { return y * this.w + x; }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TILE.WALL;
    return this.tiles[this.idx(x, y)];
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[this.idx(x, y)] = v;
  }
  isWalkable(x, y) {
    const t = this.get(x, y);
    return t === TILE.FLOOR || t === TILE.STAIRS;
  }

  // World-pixel collision check (axis-aligned circle vs walls).
  pixelBlocked(px, py, radius = 8) {
    // Sample tiles around the position.
    const minTx = Math.floor((px - radius) / TILE_SIZE);
    const maxTx = Math.floor((px + radius) / TILE_SIZE);
    const minTy = Math.floor((py - radius) / TILE_SIZE);
    const maxTy = Math.floor((py + radius) / TILE_SIZE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!this.isWalkable(tx, ty)) {
          // closest point on tile rect
          const rx = clamp(px, tx * TILE_SIZE, (tx + 1) * TILE_SIZE);
          const ry = clamp(py, ty * TILE_SIZE, (ty + 1) * TILE_SIZE);
          const dx = px - rx, dy = py - ry;
          if (dx * dx + dy * dy < radius * radius) return true;
        }
      }
    }
    return false;
  }

  // Recompute visibility from player tile.
  updateFov(px, py) {
    // Decay all currently-visible to "seen".
    for (let i = 0; i < this.seen.length; i++) {
      if (this.seen[i] === 2) this.seen[i] = 1;
    }
    const r = this._fovRange;
    const cx = px, cy = py;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        // Cast a line from player; stop at first wall after marking it.
        let blocked = false;
        for (const [lx, ly] of lineCells(cx, cy, tx, ty)) {
          if (blocked) break;
          this.seen[this.idx(lx, ly)] = 2;
          if (this.get(lx, ly) === TILE.WALL) blocked = true;
        }
      }
    }
  }
}

export function generateDungeon(floor) {
  const w = 70, h = 44;
  const world = new World(w, h, floor);
  world.tiles.fill(TILE.WALL);
  world.seen.fill(0);

  const rooms = [];
  const targetRooms = clamp(8 + floor, 8, 14);
  let attempts = 0;

  while (rooms.length < targetRooms && attempts < 240) {
    attempts++;
    const rw = randInt(5, 10);
    const rh = randInt(4, 8);
    const rx = randInt(1, w - rw - 2);
    const ry = randInt(1, h - rh - 2);
    const r = { x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) };
    let overlap = false;
    for (const o of rooms) {
      if (rx <= o.x + o.w + 1 && rx + rw + 1 >= o.x &&
          ry <= o.y + o.h + 1 && ry + rh + 1 >= o.y) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    rooms.push(r);
    carveRoom(world, r);
  }

  // Sort rooms by x for stable corridor sequence.
  rooms.sort((a, b) => a.cx - b.cx);
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(world, rooms[i - 1], rooms[i]);
  }
  // A few extra corridors for loops.
  for (let i = 0; i < 2; i++) {
    const a = pick(rooms), b = pick(rooms);
    if (a !== b) carveCorridor(world, a, b);
  }

  // Stairs in the last room.
  const last = rooms[rooms.length - 1];
  world.set(last.cx, last.cy, TILE.STAIRS);
  world.stairsX = last.cx;
  world.stairsY = last.cy;

  world.rooms = rooms;
  return world;
}

function carveRoom(world, r) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      world.set(x, y, TILE.FLOOR);
    }
  }
}

function carveCorridor(world, a, b) {
  let x = a.cx, y = a.cy;
  // Random L-shape: horizontal first or vertical first.
  if (Math.random() < 0.5) {
    while (x !== b.cx) { world.set(x, y, TILE.FLOOR); x += x < b.cx ? 1 : -1; }
    while (y !== b.cy) { world.set(x, y, TILE.FLOOR); y += y < b.cy ? 1 : -1; }
  } else {
    while (y !== b.cy) { world.set(x, y, TILE.FLOOR); y += y < b.cy ? 1 : -1; }
    while (x !== b.cx) { world.set(x, y, TILE.FLOOR); x += x < b.cx ? 1 : -1; }
  }
  world.set(b.cx, b.cy, TILE.FLOOR);
}

// Convert tile coords to world-pixel center.
export function tileToPixel(tx, ty) {
  return [tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2];
}
export function pixelToTile(px, py) {
  return [Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE)];
}
