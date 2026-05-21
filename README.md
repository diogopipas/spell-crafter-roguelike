# Spell Crafter

A rune-crafting roguelike for the browser. Combine **5 elements**, **5 forms**, and **5 modifiers** into 125 different spells, trigger elemental reactions (Shatter, Detonate, Conduct, Corrode, Resonance), and descend a procedurally generated dungeon. Persistent meta-progression unlocks new runes and trinkets between runs.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Aim |
| Left click | Cast active spell |
| 1 / 2 / 3 | Select spell slot |
| Q | Open the spell crafter |
| E | Open the shop (when in range of the merchant) |
| M | Mute / unmute |
| Esc | Close menus |
| R | Restart after death |

## Run locally

The game is vanilla JS — no build step. Because it uses ES modules, you need a static file server (it won't work over `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Tech

- Vanilla JavaScript, no framework, no bundler.
- HTML5 Canvas for rendering, Web Audio API for procedurally generated music and SFX (no audio asset files).
- localStorage for meta-progression and mid-run saves.

For a full tour of the code, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## License

MIT — see [`LICENSE`](./LICENSE).
