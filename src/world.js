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
    this.decor = new Uint8Array(width * height);  // 0 = none, 1 = fire floor, 2 = ice floor, 3 = arcane floor
    this.rooms = [];
    this.stairsX = -1;
    this.stairsY = -1;
    this._fovRange = 8;
    this.bossRoom = null;
    this.shopRoom = null;
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

// theme: 'fire' | 'ice' | 'arcane'  → maps to decor codes 1/2/3.
const THEME_DECOR = { fire: 1, ice: 2, arcane: 3 };

export function generateDungeon(floor, opts = {}) {
  const isBossFloor = !!opts.bossFloor;
  const theme = opts.theme || null;

  const w = 70, h = 44;
  const world = new World(w, h, floor);
  world.tiles.fill(TILE.WALL);
  world.seen.fill(0);
  world.decor.fill(0);

  const rooms = [];
  const targetRooms = clamp(8 + floor, 8, 14);
  let attempts = 0;

  // Boss floors: reserve room for a big themed arena in the right half of the map.
  let bossRoom = null;
  if (isBossFloor) {
    const bw = 18, bh = 12;
    // Place it in the right portion of the map so it ends up the "last" room after sort.
    const bx = clamp(w - bw - 4, 2, w - bw - 2);
    const by = randInt(2, h - bh - 2);
    bossRoom = { x: bx, y: by, w: bw, h: bh, cx: bx + (bw >> 1), cy: by + (bh >> 1), isBoss: true };
    rooms.push(bossRoom);
    carveRoom(world, bossRoom);
  }

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

  // Sort rooms by x for stable corridor sequence. Boss room ends up last because
  // we placed it in the rightmost slot.
  rooms.sort((a, b) => a.cx - b.cx);
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(world, rooms[i - 1], rooms[i]);
  }
  // A few extra corridors for loops — but never to/from the boss room (we want a
  // single entry to seal with a barrier).
  for (let i = 0; i < 2; i++) {
    const a = pick(rooms), b = pick(rooms);
    if (a === b) continue;
    if (a.isBoss || b.isBoss) continue;
    carveCorridor(world, a, b);
  }

  const last = rooms[rooms.length - 1];
  if (isBossFloor && bossRoom) {
    // Stairs are placed later, after the boss is defeated. Decorate floor tiles
    // and scatter a few cover pillars in the arena.
    const decor = THEME_DECOR[theme] || 0;
    if (decor) {
      for (let y = bossRoom.y; y < bossRoom.y + bossRoom.h; y++) {
        for (let x = bossRoom.x; x < bossRoom.x + bossRoom.w; x++) {
          world.decor[world.idx(x, y)] = decor;
        }
      }
    }
    addBossPillars(world, bossRoom);
    world.bossRoom = bossRoom;
    // Compute the doorway tiles connecting the boss room to the rest of the dungeon.
    bossRoom.doorways = computeDoorways(world, bossRoom);
  } else {
    world.set(last.cx, last.cy, TILE.STAIRS);
    world.stairsX = last.cx;
    world.stairsY = last.cy;
  }

  world.rooms = rooms;

  // Pick a middle room (not spawn, not boss/stairs) to host the shop.
  const middle = rooms.filter(r => r !== rooms[0] && r !== last && !r.isBoss);
  if (middle.length > 0) {
    world.shopRoom = middle[Math.floor(Math.random() * middle.length)];
  } else {
    world.shopRoom = null;
  }

  return world;
}

// Drop 2-4 single-tile wall pillars inside the boss arena, leaving a clear ring
// near walls and a clear center spot for the boss.
function addBossPillars(world, room) {
  const count = 2 + Math.floor(Math.random() * 3);   // 2..4
  const placed = [];
  let tries = 0;
  while (placed.length < count && tries < 40) {
    tries++;
    const px = randInt(room.x + 2, room.x + room.w - 3);
    const py = randInt(room.y + 2, room.y + room.h - 3);
    // Keep the center open for the boss + a 1-tile breathing radius.
    if (Math.abs(px - room.cx) <= 1 && Math.abs(py - room.cy) <= 1) continue;
    // Don't crowd existing pillars.
    let tooClose = false;
    for (const [qx, qy] of placed) {
      if (Math.abs(qx - px) <= 1 && Math.abs(qy - py) <= 1) { tooClose = true; break; }
    }
    if (tooClose) continue;
    world.set(px, py, TILE.WALL);
    placed.push([px, py]);
  }
}

// Scan the boss room's perimeter for floor tiles that connect to a floor tile
// outside the room — those are doorway tiles. Coalesce adjacent ones into
// axis-aligned segments suitable for collision + rendering.
function computeDoorways(world, room) {
  const doorTiles = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const onEdge = (x === room.x || x === room.x + room.w - 1 ||
                       y === room.y || y === room.y + room.h - 1);
      if (!onEdge) continue;
      if (world.get(x, y) !== TILE.FLOOR) continue;
      // Check whether any 4-neighbor is outside the room AND floor.
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbors) {
        const outsideRoom = nx < room.x || nx >= room.x + room.w ||
                            ny < room.y || ny >= room.y + room.h;
        if (outsideRoom && world.get(nx, ny) === TILE.FLOOR) {
          doorTiles.push({ x, y });
          break;
        }
      }
    }
  }
  // Coalesce adjacent door tiles into segments.
  const segments = [];
  const used = new Set();
  for (const t of doorTiles) {
    const key = `${t.x},${t.y}`;
    if (used.has(key)) continue;
    // Try to extend along x first, then along y.
    let len = 1, axis = 'h';
    while (doorTiles.some(o => o.x === t.x + len && o.y === t.y)) { len++; }
    if (len === 1) {
      axis = 'v';
      while (doorTiles.some(o => o.x === t.x && o.y === t.y + len)) { len++; }
    }
    for (let i = 0; i < len; i++) {
      const kx = axis === 'h' ? t.x + i : t.x;
      const ky = axis === 'h' ? t.y : t.y + i;
      used.add(`${kx},${ky}`);
    }
    segments.push({ x: t.x, y: t.y, axis, tileLen: len });
  }
  return segments;
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
