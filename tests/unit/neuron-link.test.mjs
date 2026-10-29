import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS, STARS, ROUND_SECONDS, SOLVE_PAUSE, N, E, S, W, turn, tapsNeeded, litTiles, isSolved, generateBoard, boardScore, createRound} from '../../assets/js/games/neuron-link.js';

const lcg = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const bits = mask => [N, E, S, W].filter(b => mask & b).length;
// Taps every path tile until it matches the solved board, stopping at the solve.
function solve(round) {
    const events = [];
    const {board} = round.state;
    for (const i of board.path) {
        for (let k = tapsNeeded(board.tiles[i], board.want[i]); k > 0; k--) {
            events.push(...round.tap(Math.floor(i / board.n), i % board.n));
            if (events.some(e => e.type === 'solve')) return events;
        }
    }
    return events;
}

test('levels, stars and limits match the spec', () => {
    assert.deepEqual(LEVELS, {easy: {first: 4, largest: 6}, medium: {first: 5, largest: 7}, hard: {first: 6, largest: 8}});
    assert.deepEqual(STARS, [1200, 3000, 6000]);
    assert.deepEqual([ROUND_SECONDS, SOLVE_PAUSE, N, E, S, W], [120, 1.2, 1, 2, 4, 8]);
});

test('turn goes clockwise and four turns come back', () => {
    assert.equal(turn(N), E);
    assert.equal(turn(W), N);
    assert.equal(turn(N | E), E | S);
    assert.equal(turn(turn(turn(turn(N | E | S)))), N | E | S);
});

test('tapsNeeded: the fewest clockwise turns; a straight has two right ways up', () => {
    assert.equal(tapsNeeded(N | E, W | N), 3);
    assert.equal(tapsNeeded(N | S, E | W), 1);
    assert.equal(tapsNeeded(E | W, E | W), 0);
    assert.equal(tapsNeeded(N | S, N | S), 0);
    assert.equal(tapsNeeded(N | E | S, N | E), Infinity);
});

test('the glow follows openings that meet, from a brain tile that opens up', () => {
    const board = {n: 2, tiles: [N | S, 0, N | S, 0], brainCol: 0, muscleCol: 0};
    assert.deepEqual(litTiles(board), [true, false, true, false]);
    assert.equal(isSolved(board), true);
    board.tiles[0] = E | W;
    assert.deepEqual(litTiles(board), [false, false, false, false]);
    assert.equal(isSolved(board), false);
    board.tiles[0] = N | S; board.tiles[2] = N | E;
    assert.equal(isSolved(board), false, 'the muscle tile must open downward');
});

test('Review Focus 3: a decoy chain also solves the board', () => {
    // The generated path goes 0 → 1 → 3, but the tiles already make 0 → 2, which reaches the muscle under column 0.
    const board = {n: 2, tiles: [N | S, W | E, N | S, N | E], want: [N | E, W | S, null, N | S], path: [0, 1, 3], brainCol: 0, muscleCol: 0};
    assert.equal(isSolved(board), true);
});

test('generated boards: a connected path, solvable, never already solved, par right', () => {
    for (let seed = 1; seed <= 200; seed++) {
        const n = 4 + (seed % 5);
        const board = generateBoard(n, lcg(seed));
        assert.equal(board.n, n);
        assert.equal(board.tiles.length, n * n);
        assert.equal(board.path[0], board.brainCol);
        assert.equal(board.path.at(-1), (n - 1) * n + board.muscleCol);
        assert.equal(new Set(board.path).size, board.path.length, 'no tile twice');
        for (let k = 1; k < board.path.length; k++) {
            const [a, b] = [board.path[k - 1], board.path[k]];
            const d = Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n));
            assert.equal(d, 1, 'path steps are to a neighbour');
        }
        for (const mask of board.tiles) assert.ok(bits(mask) === 2 || bits(mask) === 3, 'straight, bend or fork');
        for (const i of board.path) assert.equal(bits(board.tiles[i]), 2, 'no fork on the path');
        assert.equal(isSolved(board), false, 'a fresh board is not solved');
        assert.equal(board.par, board.path.reduce((sum, i) => sum + tapsNeeded(board.tiles[i], board.want[i]), 0));
        const fixed = {...board, tiles: board.tiles.map((mask, i) => board.want[i] ?? mask)};
        assert.equal(isSolved(fixed), true, 'the generated path solves it');
    }
});

test('a seeded board is repeatable', () => {
    assert.deepEqual(generateBoard(6, lcg(5)), generateBoard(6, lcg(5)));
});

test('boardScore: 100 per side plus 25 per tap under twice par', () => {
    assert.equal(boardScore(4, 8, 8), 600);
    assert.equal(boardScore(4, 8, 20), 400);
    assert.equal(boardScore(8, 30, 25), 800 + 25 * 35);
});

test('a round: taps turn tiles and count, out-of-range taps do nothing, a solve scores', () => {
    const round = createRound('easy', lcg(9));
    const {state} = round;
    assert.equal(state.size, 4);
    assert.equal(state.timeLeft, 120);
    assert.deepEqual(round.tap(-1, 0), []);
    assert.deepEqual(round.tap(0, 4), []);
    assert.equal(state.moves, 0);
    const before = state.board.tiles[5];
    assert.deepEqual(round.tap(1, 1), [{type: 'turn', r: 1, c: 1}]);
    assert.equal(state.board.tiles[5], turn(before));
    assert.equal(state.moves, 1);
    for (let k = 0; k < 3; k++) round.tap(1, 1);   // back as it was
    const par = state.board.par;
    const solved = solve(round).find(e => e.type === 'solve');
    assert.ok(solved, 'the board solves');
    assert.equal(solved.points, boardScore(4, par, state.moves));
    assert.equal(solved.perfect, state.moves <= par);
    assert.equal(state.score, solved.points);
    assert.equal(state.boardsSolved, 1);
});

test('Review Focus 1: taps in the solve pause are ignored, then a fresh board starts at 0 moves', () => {
    const round = createRound('easy', lcg(11));
    solve(round);
    const tiles = [...round.state.board.tiles];
    assert.deepEqual(round.tap(0, 0), []);
    assert.deepEqual(round.state.board.tiles, tiles);
    round.tick(SOLVE_PAUSE / 2);
    assert.deepEqual(round.tap(0, 0), []);
    const events = round.tick(SOLVE_PAUSE / 2 + 0.01);
    assert.deepEqual(events.filter(e => e.type === 'board'), [{type: 'board', n: 4}]);
    assert.equal(round.state.moves, 0);
    assert.equal(round.state.pause, 0);
});

test('boards grow by 1 every 2 solves up to the level\'s largest', () => {
    const sizes = level => {
        const round = createRound(level, lcg(3));
        const seen = [round.state.size];
        for (let k = 0; k < 8; k++) { solve(round); round.tick(SOLVE_PAUSE + 0.01); seen.push(round.state.size); }
        return seen;
    };
    assert.deepEqual(sizes('easy'), [4, 4, 5, 5, 6, 6, 6, 6, 6]);
    assert.deepEqual(sizes('hard'), [6, 6, 7, 7, 8, 8, 8, 8, 8]);
});

test('the perfect streak and taps beyond par', () => {
    const round = createRound('easy', lcg(21));
    const {state} = round;
    solve(round);
    assert.equal(state.perfectStreak, 1);
    round.tick(SOLVE_PAUSE + 0.01);
    for (let k = 0; k < 4; k++) round.tap(0, 0);   // four wasted turns
    const par = state.board.par;
    solve(round);
    const sloppy = state.moves - par;
    assert.ok(sloppy >= 4);
    assert.equal(state.perfectStreak, 0);
    assert.equal(state.bestPerfectStreak, 1);
    assert.equal(state.extraTaps, sloppy);
});

test('Review Focus 4: time running out in the solve pause keeps the points, starts no board and ends once', () => {
    const round = createRound('easy', lcg(13));
    round.tick(ROUND_SECONDS - 0.5);
    solve(round);
    const score = round.state.score;
    assert.ok(score > 0);
    const events = round.tick(1);
    assert.deepEqual(events.map(e => e.type), ['end']);
    assert.equal(round.state.over, true);
    assert.equal(round.state.timeLeft, 0);
    assert.equal(round.state.score, score);
    assert.deepEqual(round.tick(1), []);
    assert.deepEqual(round.tap(0, 0), []);
});

test('bad time steps are ignored', () => {
    const round = createRound('easy', lcg(1));
    for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(round.tick(dt), []);
    assert.equal(round.state.time, 0);
});

test('a bot tapping par moves 10 times a second stays under the server cap on every level', () => {
    for (const level of Object.keys(LEVELS)) {
        const round = createRound(level, lcg(7));
        while (!round.state.over) {
            if (round.state.pause > 0) { round.tick(0.1); continue; }
            const {board} = round.state;
            const i = board.path.find(p => tapsNeeded(board.tiles[p], board.want[p]) > 0);
            round.tap(Math.floor(i / board.n), i % board.n);
            round.tick(0.1);
        }
        assert.ok(round.state.boardsSolved > 5, level + ' solved boards');
        assert.ok(round.state.score < 100000, `${level}: ${round.state.score}`);
    }
});

test('the default export follows the game module contract', async () => {
    const {default: game} = await import('../../assets/js/games/neuron-link.js');
    const {readFile} = await import('node:fs/promises');
    const sprite = await readFile(new URL('../../assets/icons/interface.svg', import.meta.url), 'utf8');
    assert.equal(game.key, 'neuron-link');
    assert.equal(game.title, 'Neuron Link');
    assert.equal(game.tagline, 'Connect the brain to the muscle and fire the signal.');
    assert.equal(game.roundSeconds, 120);
    assert.equal(game.stars, STARS);
    assert.deepEqual(Object.keys(game.levels), ['easy', 'medium', 'hard']);
    assert.equal(game.howToPlay.length, 4);
    for (const step of game.howToPlay) assert.ok(sprite.includes(`<symbol id="${step.icon}"`), 'How to Play icon is in the sprite: ' + step.icon);
    assert.equal(game.assets.images.brain, 'brain.webp');
    for (const absent of ['maxLives', 'touchButtons', 'settings']) assert.equal(game[absent], undefined, absent);
    assert.equal(typeof game.create, 'function');
    assert.equal(typeof game.drawBackdrop, 'function');
});
