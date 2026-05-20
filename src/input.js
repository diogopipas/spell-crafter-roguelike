// Keyboard + mouse state singleton.
// Events populate input.pressed / input.mouseClicked directly; the game reads
// them during the frame and calls endFrameInput() at the end to clear.

export const input = {
  keys: new Set(),
  pressed: new Set(),       // keys that went down since last endFrameInput
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
  mouseClicked: false,
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    const k = normalizeKey(e);
    if (!input.keys.has(k)) input.pressed.add(k);
    input.keys.add(k);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    input.keys.delete(normalizeKey(e));
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    input.mouseX = (e.clientX - rect.left) * scaleX;
    input.mouseY = (e.clientY - rect.top) * scaleY;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      input.mouseDown = true;
      input.mouseClicked = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function normalizeKey(e) {
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

export function endFrameInput() {
  input.pressed.clear();
  input.mouseClicked = false;
}

export function consumePressed(k) {
  if (input.pressed.has(k)) {
    input.pressed.delete(k);
    return true;
  }
  return false;
}

let suspended = false;
export function setInputSuspended(v) { suspended = v; }
export function isSuspended() { return suspended; }
