# Entertainment games, sub-project 3: Neuron Link — design

Date: 2026-10-30
Builds on `2026-10-25-entertainment-games-design.md` (the game shell, scoring, leaderboard, badges) and `2026-10-30-cell-runner-design.md` (HUD fields, game settings). Everything there still applies unless this document changes it.

## Goal

Neuron Link is the third game, a calm puzzle after two action games. The student rotates tiles of nerve fibre to connect a path from the brain to a muscle. When the path is complete, the signal fires down it and the muscle contracts. A new, larger board follows. The student solves as many boards as possible in 2 minutes; fewer turns earn more points.

**Done means:**
- Neuron Link plays smoothly on phone and desktop, from the menu through to game over.
- It saves scores to its own High Scores and to the weekly leaderboard.
- It appears as a third card in the Games gallery.
- Germ Smash and Cell Runner still work exactly as before.

## Decisions

The user said "continue the next game" with the recommended options (their standing instruction), and reviews afterwards. The recommended choices:

1. **A timed round, not a level campaign.** A 120-second "puzzle rush" fits the shell as it is: one score per round, the weekly leaderboard, stars by score. A level campaign would need saved progress per student (a new table and endpoints) for little extra fun.
2. **The signal flows top to bottom.** The brain sits above the board and the muscle below it, so the board can use the full width of a portrait phone (an 8×8 board gets 41 px tiles at 360 px wide).
3. **Tap to turn.** A tap turns a tile 90° clockwise. Keyboard: the arrow keys move a highlighted tile, and Space or Enter turns it. Swipes and on-screen buttons are not needed.
4. **No shell changes** beyond one debug hook for the browser tests.

## 1. Gameplay

**The board** is an n×n grid of tiles. Each tile is a piece of nerve fibre:

| Tile | Openings |
|---|---|
| Straight | 2 opposite sides |
| Bend | 2 neighbouring sides |
| Fork | 3 sides (only as a decoy, never on the generated path) |

**The ends:**
- The brain sits above one column of the top row; the signal enters that tile from its top side.
- The muscle sits below one column of the bottom row; the signal leaves that tile through its bottom side.

**Generating a board** (seeded by `api.rng`, so a seeded round is repeatable):
1. Pick the brain column and the muscle column at random.
2. Find a random path from the brain tile to the muscle tile: a depth-first search with shuffled neighbours, never visiting a tile twice.
3. Each tile on the path becomes the straight or the bend that joins its two neighbours (the first tile also opens upward, the last also opens downward).
4. Every other tile is a random decoy: 45% bends, 30% straights, 25% forks.
5. Turn every tile a random 0–3 quarter turns. If that leaves the board already solved, turn them again.
6. **Par** is the fewest clockwise taps that put every path tile back: for a bend (one right way up) 0–3 taps; for a straight (two right ways up) 0–1 tap.

**Playing:**
- Tiles connected to the brain, through openings that meet, glow. Everything else is dim. The glow updates after every tap.
- The board is solved as soon as a glowing chain reaches the muscle's opening, by the generated path or any other.
- While solved, input is ignored for 1.2 s:
  - the signal runs down the glowing chain (0.5 s);
  - the muscle contracts and relaxes (0.4 s);
  - the next board fades in (0.3 s).
- The clock keeps running through this.

**Board sizes** grow by 1 after every 2 boards solved, up to the level's largest:

| | Easy | Medium | Hard |
|---|---|---|---|
| First board | 4×4 | 5×5 | 6×6 |
| Largest board | 6×6 | 7×7 | 8×8 |

**Score:**
- Each solved board scores `100 × n + 25 × max(0, 2 × par − moves)`, where n is the side and moves is the taps on that board.
- A board solved in at most par moves is **perfect**: a "Perfect!" label and a brighter signal.

**Round:**
- `roundSeconds: 120`.
- When the time runs out, the board in progress is dropped, and the game calls `api.gameOver({score, stats})` with:
  - `stats.hits` = boards solved
  - `stats.misses` = taps beyond par, summed over solved boards
  - `stats.friendly_hits` = 0
  - `stats.best_combo` = most perfect boards in a row

  This fits `plays.php`, including its rule that `best_combo ≤ hits`.

**Stars:** 1★ 1,200 / 2★ 3,000 / 3★ 6,000.

## 2. Look and feel

**The world:**
- Deep indigo neural tissue, drawn in code.
- Faint neurons (soft dots with thin dendrites) drift and pulse slowly behind the board.
- The menu backdrop is the same scene, with a sample signal running along a curved nerve.

**The board:**
- Rounded dark tiles (#1b1f3a) with a 2 px gap between them.
- Each tile's fibre is a thick rounded line from the centre to each opening, with a small node at the centre.
- Dim fibre is a pale lilac (#8a8fb5). Glowing fibre is electric yellow (#f7c948) with a soft glow.
- A tap turns the tile with a 0.12 s ease. Under Reduce motion the turn is instant and the neurons don't drift.

**The ends:**
- **The brain** reuses the landing page's `nervous.webp` render (copied as `brain.webp`). It sits above the board, centred on the brain column.
- **The muscle** is a new Blender render, `muscle.webp`: a red striated spindle with pale tendons, 512×256 with transparency. It lies below the board, centred on the muscle column. It contracts on a solve: shorter and thicker, 0.4 s.

**Text:**
- A line above the board, drawn on the canvas: "Board 3 · 5×5 · Moves 4 / Par 9".
- The HUD is the shell's: score and timer. There is no combo badge and no hearts.

**Feedback:**
- **A solve:** the `zap` sound, the signal pulse, "+650" floating up, then the `solve` chime.
- **A perfect solve:** also shows "Perfect!".

**Layout:**
- `tile = floor(min((w − 32) / n, (h − 88) / (n + 2.2)))`, capped at 96 px.
- The board is centred horizontally. The brain and muscle each take 1.1 tiles of height above and below it, under the HUD.

**Controls and How to Play:**
- **Tap or click** a tile to turn it.
- **Keyboard:** the arrow keys move the highlight and Space or Enter turns the tile. The highlight shows only after the first arrow key, so touch players never see it.
- **How to Play** (4 steps, sprite icons):
  1. tap a tile to turn it;
  2. connect the brain to the muscle (glowing fibre is connected);
  3. fewer turns score more, and a par run is Perfect;
  4. solve as many boards as you can in 2 minutes; they grow as you go.

**Art:**
- **Blender** (factory scene in background mode, nothing saved), producing `muscle.webp`.
- **The gallery card** `card.webp` (1280×720) is a screenshot of the game's own solved-board scene with the signal running. Its look matches the game exactly, and it needs no extra modelling.
- **Reused:** `nervous.webp` as `brain.webp`.

**Sounds** (copies of Germ Smash's Kenney CC0 effects, each with an `.m4a` copy):
- `turn` ← tick
- `zap` ← buzz
- `solve` ← chime
- `beep` (the countdown)
- `gameover`

No music.

## 3. Server and pages

**Server:**
- `GAMES` in `api/helpers.php` gains:

  ```php
  'neuron-link' => ['title' => 'Neuron Link', 'max_score' => 100000, 'min_sec' => 115, 'max_sec' => 135]
  ```

  100,000 is above a 2-minute Hard round played by a bot tapping par moves at 10 taps a second. A unit test checks that bound.
- `GAMES` in `shell.js` gains `'neuron-link'` with its title, tagline ("Connect the brain to the muscle and fire the signal.") and card.
- Nothing else on the server changes.
- "All-Rounder" (play every game) becomes earnable.

**Pages:**
- **Gallery:** shows three cards.
- **Teacher page:** its game filter and "Try" links list all three games.

## 4. Testing

- **Unit:**
  - turning a tile;
  - the glow (connected set);
  - solved detection, including through a decoy path;
  - generation: the path is connected, every board is solvable, a fresh board is never already solved, par is correct, a seeded round is repeatable;
  - size growth and caps per level;
  - board score and the perfect streak;
  - the stats mapping;
  - the score cap bot;
  - the module contract.
- **Integration:**
  - `neuron-link` rounds save;
  - durations of 115 and 135 s are accepted, and 114 and 136 are rejected;
  - the score cap;
  - the game leaderboard.
- **Browser:**
  - `play.html?game=neuron-link&seed=1` loads and shows the menu;
  - a round solves boards by clicking tiles (positions from `__gameDebug.tileCenter`), and the score and board counter rise;
  - the keyboard turns a tile;
  - the HUD shows the timer and no hearts, distance or combo;
  - the round ends at 2:00 and saves;
  - the gallery shows 3 cards;
  - the other games' checks still pass.

## Out of scope

Levels saved between rounds, hints, undo, counter-clockwise turns, music, and anti-cheat beyond the score and duration limits.
