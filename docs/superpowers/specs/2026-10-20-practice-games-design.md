# Practice games, points and badges — design

Date: 2026-10-20

## Goal

Students in the single Grade 11 class get anatomy practice games that are fun to replay. Teachers can see which terms students keep missing. The games are **practice only**: they never touch quiz grades or the gradebook. Engagement comes from points, a weekly leaderboard for each section, and badges.

## Decisions (agreed in brainstorming)

- The games are for practice and engagement, not graded assessment.
- Two content sources:
  - **default cards** generated from the anatomy content, so every student has something to play on day one
  - **teacher game sets**, made only for games
- Games are tied to **body systems**, never to lessons, because lessons are still being prepared.
- Approach 1: every game plays from one shared card shape, and each game is one module. Adding a game later takes one file and one registry line.
- The first release has 5 games: Match Pairs, Sort It, Beat the Clock, Unscramble and 3D Hunt.
- Badges are rows in `achievement_rules`. A built-in set is seeded, and teachers can edit it, turn badges off or add their own.
- Points, a weekly leaderboard per section, and per-card mastery stats are all included.

## Scope

- **New:**
  - `student/games.html`
  - `teacher/games.html`
  - `assets/js/games/` (registry, runner, card builder, 5 game modules)
  - `assets/css/games.css`
  - `api/games/` (`sets.php`, `plays.php`, `leaderboard.php`, `mastery.php`, `badges.php`)
  - `tools/build-part-index.mjs` and its output `system_model/layers/parts.json`
- **Changed:**
  - `database/migrate.php`: new tables, columns and badge seed
  - `api/helpers.php`: `gameMetrics()` and `awardBadges()`
  - `api/achievements.php`: new metrics and `icon`
  - `api/dashboard/student-stats.php`: uses `awardBadges()`
  - `assets/js/sidebar.js`: a **Games** link in both portals
  - `assets/icons/interface.svg`: only if a Phosphor icon is missing
- **Out of scope:**
  - quizzes, assessments, grading and lessons
  - games beyond the first five
  - real-time multiplayer

## 1. Cards: the one shape every game uses

```js
{ key, term, clue, group, mesh }   // mesh may be null
```

- **term**: the name to recall, for example "Femur".
- **clue**: its description or definition. Only the first sentence is kept, using `firstSentence` from `explorer/format.js`.
- **group**: the bin used by Sort It. For default cards this is the system name; teacher cards may set it.
- **mesh**: a part ID in the 3D model (for example `za_femur_l`). Only 3D Hunt uses it.
- **key**: a stable ID used for mastery stats:
  - `sys:<system_code>:<term>` for default cards
  - `set:<set_id>:<term>` for teacher cards
  - The term is lowercased and trimmed, and the key is at most 200 characters.

`assets/js/games/cards.js` is pure and unit-tested. It builds cards from three sources.

1. **Model part index.** `tools/build-part-index.mjs` reads the glTF JSON chunk of each `system_model/layers/*.glb` file. It doesn't need to decode geometry. It writes `parts.json`, shaped as `{ system_code: [{ id, name, description }] }`, taken from each node's `extras` (`part_id`, `name`, `description`). Parts without a description are skipped. The script is run again after every model export; the README's layer section gets one line about this.
2. **Teacher-curated structures** from `anatomy_content.structures`, served by `api/anatomy-content.php`: `name`, `desc` and `mesh_name`.
3. **Teacher game sets.** A card without a `group` takes the name of the set's system; if the set has no system, the card has no group.

The pool for each choice:

| Choice | Pool |
|---|---|
| One system | That system's curated structures if there are at least 4 of them. Otherwise, the part index for that system. |
| All systems | All the system pools above, each card grouped by its system. This is what makes Sort It possible. |
| A teacher set | The set's cards. |

**Left/right duplicates.** Parts like "Femur (left)" and "Femur (right)" are merged into a single "Femur" card for every game except 3D Hunt, which keeps sided parts because the student clicks an actual mesh.

**Known limit:** the part index includes obscure structures, such as small named vessels. Curated structures replace it once a teacher adds at least 4 for a system, and teacher sets are the way to control difficulty precisely.

## 2. Game modules

`assets/js/games/registry.js` exports the list of games. Each module follows this contract:

```js
export default {
  key: 'match-pairs',          // [a-z0-9-], stored in game_plays.game_key
  name: 'Match Pairs',
  icon: 'stack',               // Phosphor icon ID in interface.svg
  roundSize: 6,                // cards per round
  available(cards) { ... },    // true when this pool can be played
  play(root, cards, report),   // report(card, correct) once per card; resolves when the round ends
};
```

| Game | key | Round | Available when | Play |
|---|---|---|---|---|
| Match Pairs | `match-pairs` | 6 | ≥ 6 distinct terms | Flip and match term ↔ clue cards |
| Sort It | `sort-it` | 10 | ≥ 2 groups and ≥ 6 cards | Drag each term (or tap it and then a bin) into its group |
| Beat the Clock | `beat-the-clock` | 10 | ≥ 4 distinct terms | Read the clue and pick the term from 4 choices within 8 s each |
| Unscramble | `unscramble` | 8 | ≥ 4 terms of 4–20 letters | Type the term from shuffled letters with the clue as a hint |
| 3D Hunt | `hunt-3d` | 5 | ≥ 5 cards with `mesh` (one system only) | Rotate the model and click the named part, using the existing `AnatomyViewer` `partAt` and `findPart` methods; a miss highlights the correct part |

- A card shown on the game list for a pool is greyed out with the reason ("Needs at least 6 terms") when `available` is false.
- Every game must also work with a keyboard: Sort It accepts tap-to-place, and Match Pairs uses buttons.

## 3. Runner and scoring

`assets/js/games/runner.js` handles everything that isn't specific to one game.

- **Choosing cards.** It picks `roundSize` cards from the pool by weighted random choice:
  - weight 3 for cards the student has missed before (`seen > correct`)
  - weight 2 for cards the student has never seen
  - weight 1 for everything else
- **During the round:** a timer and a running streak counter.
- **Results screen:** correct out of total, points, best streak, a "Play again" button, and the cards the student missed along with their clues.
- **Saving:** it posts the round to `api/games/plays.php`, then shows a popup for each new badge the response returns.

**Points are calculated on the server** from the ordered results, not trusted from the browser:

- `points = 10 × correct + 2 × best_streak`
- A **perfect round** means `correct = total` and `total ≥ 4`.

## 4. Data (added by `database/migrate.php`; repeatable and non-destructive)

```sql
game_sets (
  set_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  system_id INT UNSIGNED NULL,                 -- FK body_systems, ON DELETE SET NULL
  cards LONGTEXT NOT NULL,                     -- JSON [{term, clue, group?, mesh?}]
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NOT NULL,            -- FK users
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
game_plays (
  play_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,            -- FK users, ON DELETE CASCADE
  game_key VARCHAR(40) NOT NULL,
  set_id INT UNSIGNED NULL,                    -- FK game_sets, ON DELETE SET NULL
  system_id INT UNSIGNED NULL,                 -- FK body_systems, ON DELETE SET NULL; NULL = all systems
  correct SMALLINT UNSIGNED NOT NULL, total SMALLINT UNSIGNED NOT NULL,
  best_streak SMALLINT UNSIGNED NOT NULL, points INT UNSIGNED NOT NULL,
  duration_sec SMALLINT UNSIGNED NOT NULL,
  played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY (student_id, played_at), KEY (played_at)
)
game_card_stats (
  user_id INT UNSIGNED NOT NULL,               -- FK users, ON DELETE CASCADE
  card_key VARCHAR(200) NOT NULL,
  term VARCHAR(100) NOT NULL,
  seen INT UNSIGNED NOT NULL DEFAULT 0, correct INT UNSIGNED NOT NULL DEFAULT 0,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_key)
)
student_badges (
  user_id INT UNSIGNED NOT NULL,               -- FK users, ON DELETE CASCADE
  achievement_id INT UNSIGNED NOT NULL,        -- FK achievement_rules, ON DELETE CASCADE
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id)
)
achievement_rules
  + badge_key VARCHAR(40) NULL UNIQUE          -- set only on built-in badges
  + icon VARCHAR(40) NOT NULL DEFAULT 'medal'
```

**Validating game sets** (`api/games/sets.php`):
- a title of 1–100 characters
- 4–200 cards
- `term` 1–100 characters, `clue` 1–300, `group` ≤ 60, `mesh` ≤ 150
- terms unique within the set, ignoring case

## 5. Badges

**New metrics.** `gameMetrics($userId)` works these out in one query over `game_plays`:

| Metric | Value |
|---|---|
| `games_played` | `COUNT(*)` |
| `perfect_rounds` | rounds with `correct = total AND total >= 4` |
| `best_game_streak` | `MAX(best_streak)` |
| `game_systems_played` | `COUNT(DISTINCT system_id)` |
| `total_points` | `SUM(points)` |

`api/achievements.php` accepts these five metrics alongside the existing ones, plus `icon` (lowercase letters and hyphens, ≤ 40 characters).

**Built-in seed.** The seed uses `INSERT IGNORE` keyed on `badge_key`, so running the migration again never overwrites a teacher's edits.

| badge_key | Title | Metric | Threshold | Icon |
|---|---|---|---|---|
| first-game | First Game | games_played | 1 | game-controller |
| games-10 | Regular | games_played | 10 | game-controller |
| games-50 | Dedicated | games_played | 50 | trophy |
| perfect-1 | Flawless | perfect_rounds | 1 | check-circle |
| streak-10 | On a Roll | best_game_streak | 10 | target |
| streak-25 | Unstoppable | best_game_streak | 25 | target |
| explorer-3 | Explorer | game_systems_played | 3 | flag |
| explorer-6 | Globetrotter | game_systems_played | 6 | flag |
| points-500 | Rising Star | total_points | 500 | medal |
| points-2000 | High Scorer | total_points | 2000 | medal |
| points-10000 | Anatomy Ace | total_points | 10000 | trophy |

**Awarding.** `awardBadges($userId)` works like this:
- It reuses the evaluation in `student-stats.php`: the profile metrics plus `gameMetrics`.
- For every active rule the student meets and doesn't already hold, it runs `INSERT IGNORE` into `student_badges`.
- It returns the badges just earned.

It's called from two places:
- `plays.php`, after a round is saved
- `student-stats.php`, which then marks badges as earned from `student_badges` rather than recalculating them, so earned badges never disappear

## 6. API (`api/games/`, every endpoint signed-in)

| Endpoint | Who | What |
|---|---|---|
| `GET sets.php` | student | Active sets including their cards |
| `GET sets.php` | teacher | All sets |
| `POST` / `PUT ?id` / `DELETE ?id sets.php` | teacher | Create, edit or delete a set |
| `POST plays.php` | student | Body: `{game_key, set_id?, system_code?, duration_sec, results:[{card_key, term, correct}]}`. Validated, saved, card stats upserted, badges awarded. Returns `{points, correct, total, best_streak, new_badges:[{title, icon}]}` |
| `GET leaderboard.php` | student | Their own section only; any `section` parameter is ignored |
| `GET leaderboard.php?section=` | teacher | Section required, and must be in `SECTIONS` |
| `GET mastery.php` | student | Their own `{card_key: [seen, correct]}`, used for weighting |
| `GET mastery.php?section=` | teacher | The 20 most-missed terms (seen ≥ 3, sorted by miss rate) |
| `GET badges.php` | student | Every active rule with `earned_at` or null, plus the current value toward each one |

**`plays.php` rejects a round (422)** when any of these hold:
- `game_key` doesn't match `^[a-z0-9-]{2,40}$`
- `results` has fewer than 1 or more than 50 entries
- `duration_sec` is less than the number of results or more than 3600
- the set or system named in the round doesn't exist

`best_streak` is worked out from the order of `results`.

**Leaderboard:**
- covers the current week, from Monday 00:00 in the server's time zone
- returns the top 10 by points (ties go to whoever reached the score first), plus the student's own rank and points if they're outside the top 10
- shows full names, only within the student's own section

**Known limit:** results come from the browser, so a determined student could post fake rounds and inflate their points. That's acceptable for practice. If the leaderboard ever matters more, the fix is to issue rounds from the server.

## 7. Pages

**`student/games.html`**, with a "Games" link in the sidebar using the `game-controller` icon:
- **Pool picker:** All systems, each active body system, and each active teacher set.
- **Game cards** for the chosen pool, where unavailable games are greyed out with a reason.
- **This week in your section:** the leaderboard.
- **Badges:** earned ones show their date; locked ones are greyed out and show the goal and current progress ("7 / 10 games").
- **Playing** happens on the same page: the game takes over the main area, and the results screen returns to the picker.
- **Empty states:**
  - no part index and no structures: "No game content yet"
  - a failed save: the result still shows, along with a "Couldn't save this round" message and a Retry button

**`teacher/games.html`**, with a "Games" link in the sidebar:
- **Game sets:**
  - a list with a toggle to turn each set on or off
  - an editor with title, optional system, and a card table
  - "Paste cards", which turns `term, clue[, group]` lines into cards
- **Most-missed terms:** a section picker (as on the Students page) and the top 20 list.
- **Leaderboard:** the same section picker.
- **Badges:** list, add, edit, turn on or off, and delete rules, with a metric dropdown and an icon picker limited to the sprite's badge icons. `api/achievements.php` already exists, but no teacher page uses it yet; this is its first UI.

Both pages follow the Stage look already used in the portals. Icons come only from the Phosphor sprite: no emoji and no pastel icon tiles.

## 8. Testing

- **Unit** (`tests/unit/games.test.mjs`, `node --test`):
  - `cards.js`: building pools, merging left/right parts, curated cards replacing the part index, key format
  - each game's `available()`
  - runner weighting (seeded random)
- **Integration** (`tests/integration.mjs`):
  - set CRUD and validation
  - a round saved with server-side points and streak
  - impossible rounds rejected
  - a badge awarded exactly once
  - a student can't see another section's leaderboard
  - a teacher needs a valid section
  - most-missed terms appear after repeated misses
- **Browser** (`tests/browser.mjs` and `tests/navigation.mjs`):
  - both Games pages load
  - a full Match Pairs round can be played by script
  - the sidebar has the new links

## Later (not in this release)

- More games, one module each: Odd One Out, Swipe True/False, Streak Survival, Pin It (needs 2D diagram cards), Who Am I?, Save the Skeleton, Order Up, Crossword, Case Detective.
- Rounds issued by the server, if the leaderboard ever needs protection against cheating.
- A teacher screen for managing sections (sections are the `SECTIONS` constant in `api/helpers.php` today).
