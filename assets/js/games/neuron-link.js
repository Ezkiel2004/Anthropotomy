// Neuron Link: turn tiles of nerve fibre until a glowing path joins the brain (above the board) to the
// muscle (below it). The signal fires, the muscle contracts and a new board follows; solve as many as
// you can in 2 minutes. The round logic below is pure (no DOM at the top level), so the unit tests run it in Node.

export const LEVELS = {
    easy:   {first: 4, largest: 6},
    medium: {first: 5, largest: 7},
    hard:   {first: 6, largest: 8}
};
export const STARS = [1200, 3000, 6000];
export const ROUND_SECONDS = 120;
export const SOLVE_PAUSE = 1.2;    // seconds the signal and the muscle play before the next board; taps are ignored
// A tile's openings, as bits.
export const N = 1, E = 2, S = 4, W = 8;
const STEPS = [[N, -1, 0], [E, 0, 1], [S, 1, 0], [W, 0, -1]];
const OPPOSITE = {[N]: S, [E]: W, [S]: N, [W]: E};
// Decoy tiles: 45% bends, 30% straights, 25% forks.
const DECOYS = [[0.45, N | E], [0.75, N | S], [1, N | E | S]];

// A quarter turn clockwise: N → E → S → W → N.
export const turn = mask => ((mask << 1) | (mask >> 3)) & 15;
const spin = (mask, times) => { for (let k = 0; k < times; k++) mask = turn(mask); return mask; };

// The fewest clockwise taps that make `mask` match `want` (a straight matches either way up).
export function tapsNeeded(mask, want) {
    for (let k = 0; k < 4; k++) if (spin(mask, k) === want) return k;
    return Infinity;
}

// How many steps from the brain each tile is along fibre whose openings meet (-1: not connected).
export function litDepths({n, tiles, brainCol}) {
    const depth = new Array(n * n).fill(-1);
    if (!(tiles[brainCol] & N)) return depth;
    depth[brainCol] = 0;
    const queue = [brainCol];
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head], r = Math.floor(i / n), c = i % n;
        for (const [dir, dr, dc] of STEPS) {
            const rr = r + dr, cc = c + dc;
            if (!(tiles[i] & dir) || rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            const j = rr * n + cc;
            if (depth[j] < 0 && tiles[j] & OPPOSITE[dir]) { depth[j] = depth[i] + 1; queue.push(j); }
        }
    }
    return depth;
}
export const litTiles = board => litDepths(board).map(d => d >= 0);

// Solved: the muscle's tile is connected and opens downward, whichever chain got there.
export function isSolved(board, lit = litTiles(board)) {
    const goal = (board.n - 1) * board.n + board.muscleCol;
    return lit[goal] && (board.tiles[goal] & S) !== 0;
}

export function generateBoard(n, rng) {
    const brainCol = Math.floor(rng() * n), muscleCol = Math.floor(rng() * n);
    const goal = (n - 1) * n + muscleCol;
    // A depth-first search with shuffled neighbours; the visited set is shared, so it never revisits a tile.
    const visited = new Array(n * n).fill(false), path = [];
    const walk = i => {
        visited[i] = true;
        path.push(i);
        if (i === goal) return true;
        const steps = STEPS.slice();
        for (let k = steps.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [steps[k], steps[j]] = [steps[j], steps[k]];
        }
        const r = Math.floor(i / n), c = i % n;
        for (const [, dr, dc] of steps) {
            const rr = r + dr, cc = c + dc;
            if (rr >= 0 && rr < n && cc >= 0 && cc < n && !visited[rr * n + cc] && walk(rr * n + cc)) return true;
        }
        path.pop();
        return false;
    };
    walk(brainCol);
    const toward = (a, b) => (b === a - n ? N : b === a + 1 ? E : b === a + n ? S : W);
    const want = new Array(n * n).fill(null);
    path.forEach((i, k) => {
        want[i] = (k === 0 ? N : toward(i, path[k - 1])) | (k === path.length - 1 ? S : toward(i, path[k + 1]));
    });
    const solved = want.map(mask => {
        if (mask !== null) return mask;
        const roll = rng();
        return DECOYS.find(([share]) => roll < share)[1];
    });
    let tiles;
    do tiles = solved.map(mask => spin(mask, Math.floor(rng() * 4)));
    while (isSolved({n, tiles, brainCol, muscleCol}));
    const par = path.reduce((sum, i) => sum + tapsNeeded(tiles[i], want[i]), 0);
    return {n, tiles, want, path, brainCol, muscleCol, par};
}

export const boardScore = (n, par, moves) => 100 * n + 25 * Math.max(0, 2 * par - moves);

export function createRound(level, rng) {
    const config = LEVELS[level];
    if (!config || !Object.prototype.hasOwnProperty.call(LEVELS, level)) throw new Error(`Unknown level: ${level}`);
    const state = {
        time: 0, timeLeft: ROUND_SECONDS, size: config.first, board: null, lit: null, moves: 0, boardsSolved: 0,
        score: 0, perfectStreak: 0, bestPerfectStreak: 0, extraTaps: 0, pause: 0, over: false, lastSolve: null
    };
    function deal() {
        state.size = Math.min(config.largest, config.first + Math.floor(state.boardsSolved / 2));
        state.board = generateBoard(state.size, rng);
        state.lit = litTiles(state.board);
        state.moves = 0;
    }
    deal();

    function tap(r, c) {
        const {board} = state;
        if (state.over || state.pause > 0 || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= board.n || c >= board.n) return [];
        const i = r * board.n + c;
        board.tiles[i] = turn(board.tiles[i]);
        state.moves += 1;
        state.lit = litTiles(board);
        const events = [{type: 'turn', r, c}];
        if (isSolved(board, state.lit)) {
            const perfect = state.moves <= board.par;
            const points = boardScore(board.n, board.par, state.moves);
            state.score += points;
            state.boardsSolved += 1;
            state.extraTaps += Math.max(0, state.moves - board.par);
            state.perfectStreak = perfect ? state.perfectStreak + 1 : 0;
            state.bestPerfectStreak = Math.max(state.bestPerfectStreak, state.perfectStreak);
            state.pause = SOLVE_PAUSE;
            state.lastSolve = {points, perfect, par: board.par, moves: state.moves, n: board.n};
            events.push({type: 'solve', ...state.lastSolve});
        }
        return events;
    }

    // The clock runs through the solve pause; when it reaches 0 the round ends, even mid-pause.
    function tick(dt) {
        if (state.over || !(dt > 0) || !Number.isFinite(dt)) return [];
        state.time += dt;
        state.timeLeft = Math.max(0, ROUND_SECONDS - state.time);
        if (state.timeLeft === 0) {
            state.over = true;
            state.pause = 0;
            return [{type: 'end'}];
        }
        if (state.pause > 0) {
            state.pause = Math.max(0, state.pause - dt);
            if (state.pause === 0) {
                deal();
                return [{type: 'board', n: state.size}];
            }
        }
        return [];
    }

    return {state, tap, tick};
}

// ── Drawing: Canvas 2D in CSS px, only inside create() and drawBackdrop. ──
const TILE_COLOR = '#1b1f3a', DIM = '#8a8fb5', LIT = '#f7c948', BRIGHT = '#fff3b0';
const TURN_SECONDS = 0.12, SIGNAL_SECONDS = 0.5, FLEX_SECONDS = 0.4, FADE_SECONDS = 0.3;
const OPENINGS = [[N, 0, -1], [E, 1, 0], [S, 0, 1], [W, -1, 0]];

// Where an n×n board goes: under the HUD row, with 1.1 tiles above it for the brain and below it for the muscle.
function layoutOf(w, h, n) {
    const tile = Math.min(96, Math.floor(Math.min((w - 32) / n, (h - 88) / (n + 2.2))));
    const slack = Math.max(0, (h - 88 - (n + 2.2) * tile) / 2);
    return {w, h, n, tile, left: (w - n * tile) / 2, top: 72 + 1.1 * tile + slack};
}

// A field of faint neurons: soft cell bodies with a few dendrites, drifting slowly.
const NEURONS = Array.from({length: 18}, (_, i) => {
    const hash = k => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    return {x: hash(1), y: hash(2), r: 4 + hash(3) * 6, phase: hash(4) * Math.PI * 2, arms: [0, 1, 2, 3].map(k => [hash(5 + k) * Math.PI * 2, 18 + hash(9 + k) * 40])};
});
function drawField(ctx, w, h, t, calm) {
    const back = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    back.addColorStop(0, '#141a4a');
    back.addColorStop(1, '#05061a');
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (const cell of NEURONS) {
        const drift = calm ? 0 : Math.sin(t * 0.3 + cell.phase) * 12;
        const x = cell.x * w + drift, y = cell.y * h - drift * 0.6;
        const glow = calm ? 0.25 : 0.2 + 0.12 * Math.sin(t * 1.3 + cell.phase);
        ctx.strokeStyle = `rgba(138,143,181,${(glow * 0.6).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        for (const [angle, length] of cell.arms) {
            ctx.beginPath(); ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + Math.cos(angle + 0.4) * length * 0.6, y + Math.sin(angle + 0.4) * length * 0.6, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
            ctx.stroke();
        }
        ctx.fillStyle = `rgba(160,165,215,${glow.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, cell.r, 0, Math.PI * 2); ctx.fill();
    }
}

// One tile's fibre, centred on (x, y): a thick rounded line to each opening and a node in the middle.
function drawFibre(ctx, mask, x, y, size, color, glow) {
    ctx.lineCap = 'round';
    for (const [width, style] of glow ? [[0.42, 'rgba(247,201,72,0.22)'], [0.18, color]] : [[0.18, color]]) {
        ctx.strokeStyle = style;
        ctx.lineWidth = size * width;
        for (const [bit, dx, dy] of OPENINGS) {
            if (!(mask & bit)) continue;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (dx * size) / 2, y + (dy * size) / 2); ctx.stroke();
        }
    }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, size * 0.13, 0, Math.PI * 2); ctx.fill();
}

// A rounded square path centred on (x, y) (arcTo, since ctx.roundRect is missing on older iPhones).
function roundedTile(ctx, x, y, size, radius) {
    const r = Math.max(3, radius), a = x - size / 2, b = y - size / 2;
    ctx.beginPath();
    ctx.moveTo(a + r, b);
    ctx.arcTo(a + size, b, a + size, b + size, r);
    ctx.arcTo(a + size, b + size, a, b + size, r);
    ctx.arcTo(a, b + size, a, b, r);
    ctx.arcTo(a, b, a + size, b, r);
    ctx.closePath();
}
function drawMuscleShape(ctx, width, height) {
    ctx.strokeStyle = '#e9dcc4'; ctx.lineWidth = height * 0.14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-width * 0.5, 0); ctx.lineTo(width * 0.5, 0); ctx.stroke();
    const g = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
    g.addColorStop(0, '#e05563'); g.addColorStop(1, '#8e1b2b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, width * 0.36, height * 0.42, 0, 0, Math.PI * 2); ctx.fill();
}
function drawImage(ctx, image, x, y, height) {
    const width = (height * image.width) / image.height;
    ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
}

function drawBackdrop(ctx, t, w, h, images = {}) {
    drawField(ctx, w, h, t, false);
    // A sample signal running along a curved nerve.
    const point = s => ({x: w * (0.08 + 0.84 * s), y: h * (0.62 + 0.12 * Math.sin(s * Math.PI * 2))});
    ctx.strokeStyle = 'rgba(138,143,181,0.45)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let s = 0; s <= 1.0001; s += 0.02) { const p = point(s); s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
    ctx.stroke();
    const head = (t * 0.35) % 1;
    for (let k = 0; k < 8; k++) {
        const p = point(Math.max(0, head - k * 0.012));
        ctx.fillStyle = `rgba(247,201,72,${(1 - k / 8).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7 - k * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (images.brain) drawImage(ctx, images.brain, point(0).x + 20, point(0).y - 60, Math.min(140, h * 0.2));
}

function create(canvas, api) {
    const ctx = api.ctx;
    let round = null, view = null, clock = 0, ended = false, chimed = false;
    let spin = [], floats = [], cursor = {r: 0, c: 0, shown: false};
    const ensureView = () => {
        const n = round.state.board.n;
        if (!view || view.w !== api.width || view.h !== api.height || view.n !== n) view = layoutOf(api.width, api.height, n);
        return view;
    };
    const centre = (r, c) => ({x: view.left + (c + 0.5) * view.tile, y: view.top + (r + 0.5) * view.tile});
    const hud = () => api.hud({score: round.state.score, timeLeft: round.state.timeLeft});

    function tap(r, c) {
        const events = round.tap(r, c);
        for (const event of events) {
            if (event.type === 'turn') {
                api.sound('turn');
                if (!api.reducedMotion) spin[r * round.state.board.n + c] = TURN_SECONDS;
            } else if (event.type === 'solve') {
                api.sound('zap');
                api.vibrate(40);
                chimed = false;
                const mid = {x: view.left + (view.n * view.tile) / 2, y: view.top + (view.n * view.tile) / 2};
                floats.push({x: mid.x, y: mid.y, text: `+${event.points.toLocaleString('en-PH')}`, color: LIT, life: 1.2});
                if (event.perfect) floats.push({x: mid.x, y: mid.y + 40, text: 'Perfect!', color: BRIGHT, life: 1.2});
            }
        }
        hud();
        return events.length > 0;
    }

    function drawRound() {
        const {state} = round, {board} = state, {tile, left, top, n, w} = view;
        drawField(ctx, view.w, view.h, clock, api.reducedMotion);
        const elapsed = state.pause > 0 ? SOLVE_PAUSE - state.pause : -1;
        const depths = elapsed >= 0 ? litDepths(board) : null;
        const reach = depths ? Math.max(...depths) : 0;
        const front = elapsed >= 0 ? (Math.min(elapsed, SIGNAL_SECONDS) / SIGNAL_SECONDS) * (reach + 1) : -1;
        const fade = elapsed > SOLVE_PAUSE - FADE_SECONDS ? 1 - (elapsed - (SOLVE_PAUSE - FADE_SECONDS)) / FADE_SECONDS : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        // The brain above its column and the muscle below its column, each joined to the board by a stub of fibre.
        const brain = centre(0, board.brainCol), muscle = centre(n - 1, board.muscleCol);
        const brainLit = state.lit[board.brainCol];
        ctx.strokeStyle = brainLit ? LIT : DIM; ctx.lineWidth = tile * 0.18; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(brain.x, top - tile * 0.35); ctx.lineTo(brain.x, top); ctx.stroke();
        ctx.strokeStyle = state.pause > 0 ? LIT : DIM;
        ctx.beginPath(); ctx.moveTo(muscle.x, top + n * tile); ctx.lineTo(muscle.x, top + n * tile + tile * 0.3); ctx.stroke();
        if (api.images.brain) drawImage(ctx, api.images.brain, brain.x, top - tile * 0.6, tile * 1.05);
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                const i = r * n + c, {x, y} = centre(r, c);
                ctx.fillStyle = TILE_COLOR;
                roundedTile(ctx, x, y, tile - 2, tile * 0.14); ctx.fill();
                const lit = state.lit[i], signal = depths && depths[i] >= 0 && depths[i] <= front;
                ctx.save();
                ctx.translate(x, y);
                if (spin[i] > 0) ctx.rotate((-Math.PI / 2) * (spin[i] / TURN_SECONDS));
                drawFibre(ctx, board.tiles[i], 0, 0, tile, signal ? BRIGHT : lit ? LIT : DIM, lit);
                ctx.restore();
            }
        }
        if (cursor.shown && state.pause === 0) {
            const {x, y} = centre(cursor.r, cursor.c);
            ctx.strokeStyle = '#3fb8f5'; ctx.lineWidth = 3;
            roundedTile(ctx, x, y, tile - 4, tile * 0.14); ctx.stroke();
        }
        // The muscle contracts once the signal reaches it: shorter and thicker.
        const flex = elapsed > SIGNAL_SECONDS ? Math.sin(Math.min(1, (elapsed - SIGNAL_SECONDS) / FLEX_SECONDS) * Math.PI) : 0;
        const mx = Math.min(w - tile, Math.max(tile, muscle.x)), my = top + n * tile + tile * 0.62;
        ctx.save();
        ctx.translate(mx, my);
        ctx.scale(1 - 0.2 * flex, 1 + 0.25 * flex);
        if (api.images.muscle) drawImage(ctx, api.images.muscle, 0, 0, tile * 0.95);
        else drawMuscleShape(ctx, tile * 1.9, tile * 0.95);
        ctx.restore();
        ctx.restore();
        // Board, size, moves and par along the bottom edge, which this game leaves free (the HUD and buttons hold the top).
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`Board ${state.boardsSolved + (state.pause > 0 ? 0 : 1)} · ${n}×${n} · Moves ${state.moves} / Par ${board.par}`, w / 2, view.h - 20);
        ctx.font = '400 26px Bungee, sans-serif';
        for (const f of floats) {
            ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2));
            ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(f.text, f.x, f.y);
            ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        }
        ctx.globalAlpha = 1;
    }

    return {
        get state() { return round ? round.state : null; },
        start(difficulty) {
            round = createRound(difficulty, api.rng);
            clock = 0; ended = false; chimed = false;
            spin = []; floats = []; cursor = {r: 0, c: 0, shown: false};
            view = null;
            ensureView();
            hud();
        },
        update(dt) {
            if (!round || round.state.over) return;
            clock += dt;
            for (const event of round.tick(dt)) {
                if (event.type === 'board') {
                    spin = [];
                    cursor.r = Math.min(cursor.r, event.n - 1); cursor.c = Math.min(cursor.c, event.n - 1);
                } else if (event.type === 'end' && !ended) {
                    ended = true;
                    const {state} = round;
                    api.sound('gameover');
                    api.gameOver({score: state.score, stats: {hits: state.boardsSolved, misses: state.extraTaps, friendly_hits: 0, best_combo: state.bestPerfectStreak}});
                }
            }
            const {state} = round;
            if (state.pause > 0 && !chimed && SOLVE_PAUSE - state.pause >= SIGNAL_SECONDS) { chimed = true; api.sound('solve'); }
            spin = spin.map(s => Math.max(0, (s || 0) - dt));
            for (const f of floats) { f.y -= 40 * dt; f.life -= dt; }
            floats = floats.filter(f => f.life > 0);
            hud();
        },
        draw() {
            if (!round) return;
            ensureView();
            drawRound();
        },
        pointer(x, y) {
            if (!round) return;
            ensureView();
            const c = Math.floor((x - view.left) / view.tile), r = Math.floor((y - view.top) / view.tile);
            tap(r, c);
        },
        key(code) {
            if (!round) return false;
            const n = round.state.board.n;
            const moves = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]};
            if (moves[code]) {
                // The first arrow key shows the highlight; every arrow key moves it.
                cursor.shown = true;
                cursor.r = Math.max(0, Math.min(n - 1, cursor.r + moves[code][0]));
                cursor.c = Math.max(0, Math.min(n - 1, cursor.c + moves[code][1]));
                return true;
            }
            if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
                cursor.shown = true;
                ensureView();
                tap(cursor.r, cursor.c);
                return true;
            }
            return false;
        },
        // Where a tile is drawn, in CSS px: the browser tests click there.
        tileCenter(r, c) {
            if (!round) return null;
            ensureView();
            return centre(r, c);
        },
        destroy() {
            round = null;
            spin = []; floats = [];
        }
    };
}

export default {
    key: 'neuron-link',
    title: 'Neuron Link',
    tagline: 'Connect the brain to the muscle and fire the signal.',
    theme: {accent: '#f7c948'},
    howToPlay: [
        {icon: 'arrows-clockwise', color: 'sky', title: 'Tap a tile', text: 'to turn it a quarter turn. On a keyboard, move with the arrows and turn with Space.'},
        {icon: 'pulse', color: 'yellow', title: 'Connect the brain to the muscle.', text: 'Glowing fibre is connected to the brain.'},
        {icon: 'target', color: 'teal', title: 'Fewer turns score more.', text: 'Solve a board within par for a Perfect.'},
        {icon: 'clock', color: 'coral', title: 'You have 2 minutes.', text: 'Solve as many boards as you can; they grow as you go.'}
    ],
    levels: {easy: 'Boards from 4×4 to 6×6', medium: 'Boards from 5×5 to 7×7', hard: 'Boards from 6×6 to 8×8'},
    assets: {
        images: {brain: 'brain.webp', muscle: 'muscle.webp'},
        sounds: {turn: 'turn.ogg', zap: 'zap.ogg', solve: 'solve.ogg', beep: 'beep.ogg', gameover: 'gameover.ogg'}
    },
    stars: STARS,
    roundSeconds: ROUND_SECONDS,
    drawBackdrop,
    create
};
