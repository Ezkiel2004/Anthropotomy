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
