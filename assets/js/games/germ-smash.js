// Germ Smash: pure round logic. No DOM or window access at import time,
// so Node unit tests can load this module directly (tests/unit/germ-smash.test.mjs).

export const ROUND_SECONDS = 60;
export const STARS = [300, 700, 1200];
export const LEVELS = {
    easy: {cols: 3, rows: 3, upTime: 1.4, spawnEvery: 0.9, friendly: 0.10, tough: 0},
    medium: {cols: 4, rows: 3, upTime: 1.0, spawnEvery: 0.7, friendly: 0.15, tough: 0.10},
    hard: {cols: 4, rows: 4, upTime: 0.75, spawnEvery: 0.5, friendly: 0.20, tough: 0.20}
};
export const SKIN_TONES = ['#F6D9C5', '#EAC2A5', '#D9A47F', '#C68A63', '#A86F4C', '#8A5A3C', '#6B442B', '#4A2F20'];

const BASE = {germ: 10, tough: 25};
const FRIENDLY_PENALTY = 15;
const KEYPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];
const LETTER_ROWS = [['KeyQ', 'KeyW', 'KeyE', 'KeyR'], ['KeyA', 'KeyS', 'KeyD', 'KeyF'], ['KeyZ', 'KeyX', 'KeyC', 'KeyV']];
const DIGIT_ROW = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

export function comboMultiplier(streak) {
    return streak >= 20 ? 4 : streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
}

// Stay-up time and spawn interval shrink linearly to 70% of their base by the end of the round.
export function ramp(base, t) {
    return base * (1 - 0.3 * Math.min(t / ROUND_SECONDS, 1));
}

// Maps a KeyboardEvent.code to a pore index. 3x3 uses the phone keypad (numpad or top row);
// 4-wide grids use QWER/ASDF/ZXCV, and the 4x4 grid adds the digits 1-4 as its top row.
export function keyToPore(code, cols, rows) {
    if (cols === 3 && rows === 3) {
        const match = /^(?:Digit|Numpad)(\d)$/.exec(code || '');
        const index = match ? KEYPAD.indexOf(match[1]) : -1;
        return index < 0 ? null : index;
    }
    if (cols !== 4 || (rows !== 3 && rows !== 4)) return null;
    const index = (rows === 4 ? [DIGIT_ROW, ...LETTER_ROWS] : LETTER_ROWS).flat().indexOf(code);
    return index < 0 ? null : index;
}

export function pickSkinTone(rng) {
    return SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)];
}

const emptyPore = () => ({kind: null, variant: 0, cracked: false, age: 0, upFor: 0});

// state is a plain object the renderer reads each frame; tick() and tap() mutate it.
export function createRound(level, rng) {
    const config = LEVELS[level];
    if (!config) throw new Error(`Unknown Germ Smash level: ${level}`);
    const state = {
        score: 0, streak: 0, bestCombo: 0, hits: 0, misses: 0, friendlyHits: 0, time: 0, over: false,
        pores: Array.from({length: config.cols * config.rows}, emptyPore)
    };
    let spawnTimer = 0;

    const spawn = events => {
        const free = [];
        state.pores.forEach((pore, i) => { if (!pore.kind) free.push(i); });
        if (!free.length) return;
        const index = free[Math.floor(rng() * free.length)];
        const draw = rng();
        const kind = draw < config.friendly ? 'friendly' : draw < config.friendly + config.tough ? 'tough' : 'germ';
        const variant = kind === 'germ' ? Math.floor(rng() * 3) : 0;
        state.pores[index] = {kind, variant, cracked: false, age: 0, upFor: ramp(config.upTime, state.time)};
        events.push({type: 'spawn', pore: index});
    };

    const award = base => {
        state.streak++;
        state.hits++;
        state.bestCombo = Math.max(state.bestCombo, state.streak);
        const multiplier = comboMultiplier(state.streak);
        const value = base * multiplier;
        state.score += value;
        return {value, multiplier};
    };

    function tick(dt) {
        const events = [];
        if (state.over) return events;
        state.time += dt;
        state.pores.forEach((pore, i) => {
            if (!pore.kind) return;
            pore.age += dt;
            if (pore.age < pore.upFor) return;
            if (pore.kind !== 'friendly') { state.misses++; state.streak = 0; }
            state.pores[i] = emptyPore();
            events.push({type: 'escape', pore: i});
        });
        spawnTimer += dt;
        const interval = ramp(config.spawnEvery, state.time);
        while (spawnTimer >= interval) {
            spawnTimer -= interval;
            spawn(events);
        }
        if (state.time >= ROUND_SECONDS) {
            state.over = true;
            events.push({type: 'end', pore: null});
        }
        return events;
    }

    function tap(index) {
        const pore = state.over ? null : state.pores[index];
        if (!pore || !pore.kind) return {type: 'empty', value: 0, multiplier: comboMultiplier(state.streak)};
        if (pore.kind === 'tough' && !pore.cracked) {
            pore.cracked = true;
            return {type: 'crack', value: 0, multiplier: comboMultiplier(state.streak)};
        }
        const kind = pore.kind;
        state.pores[index] = emptyPore();
        if (kind === 'friendly') {
            const before = state.score;
            state.friendlyHits++;
            state.score = Math.max(0, state.score - FRIENDLY_PENALTY);
            state.streak = 0;
            return {type: 'friendly', value: state.score - before, multiplier: 1};
        }
        return {type: kind === 'tough' ? 'kill' : 'hit', ...award(BASE[kind])};
    }

    return {state, tick, tap};
}
