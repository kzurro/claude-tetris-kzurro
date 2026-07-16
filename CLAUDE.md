# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Classic Tetris, vanilla JavaScript + HTML5 Canvas + CSS. No dependencies, no build step, no package.json.

## Running

Open `index.html` directly, or serve statically:

```bash
python3 -m http.server 8000
# or
npx serve .
```

No test suite, no linter, no build/bundle step configured.

## Architecture

Three files, all logic in `game.js` (~300 lines, single global scope, no modules):

- **`index.html`** — DOM shell: `#board` canvas (300×600, 10×20 grid at `BLOCK=30`px), `#next-canvas` preview, HUD spans (`#score`/`#lines`/`#level`), `#overlay` for pause/game-over.
- **`style.css`** — dark/retro theme, no logic.
- **`game.js`** — everything else:
  - **Board**: `ROWS×COLS` matrix, each cell `0` (empty) or `1–7` (piece color index).
  - **Pieces**: `PIECES` array of square matrices; `rotateCW` does transpose+reverse for rotation; `tryRotate` applies wall-kick offsets `[0,-1,1,-2,2]` on collision.
  - **Collision**: `collide(shape, ox, oy)` checks bounds and existing board cells.
  - **Game loop**: `loop(ts)` via `requestAnimationFrame`, accumulates `dt` and advances the piece when `dropAccum >= dropInterval`.
  - **Locking**: `lockPiece` → `merge` (bakes piece into board) → `clearLines` (bottom-up scan, splices full rows) → `spawn` (promotes `next` to `current`, generates new `next`; if the new piece immediately collides, `endGame()` fires).
  - **Scoring**: `LINE_SCORES = [0,100,300,500,800]` × `level`; hard drop = 2 pts/row dropped, soft drop = 1 pt/row.
  - **Leveling**: level = `floor(lines/10)+1`; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
  - **Ghost piece**: `ghostY()` projects `current` straight down to its landing row; drawn at `globalAlpha=0.2`.
  - **Input**: single `keydown` listener switches on `e.code` (arrows, `KeyX` rotate, `Space` hard drop, `KeyP` pause).

When changing `COLS`, `ROWS`, or `BLOCK` in `game.js`, also update the `#board` canvas `width`/`height` in `index.html` to match (`COLS*BLOCK` × `ROWS*BLOCK`).
