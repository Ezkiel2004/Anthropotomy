// Cell Runner: a red blood cell races down a blood vessel in three lanes. Dodge clots and viruses, grab
// oxygen bubbles, and deliver them at the organ gates. The run speeds up until the cell has lost its 3 lives.
// The round logic below is pure (no DOM at the top level), so the unit tests run it in Node.

export const LEVELS = {
    easy:   {startSpeed: 12, ramp: 0.15, topSpeed: 30, rowGap: 1.4,  twoLane: 0,    virusShare: 0.30, bubbleChance: 0.60},
    medium: {startSpeed: 16, ramp: 0.25, topSpeed: 38, rowGap: 1.1,  twoLane: 0.25, virusShare: 0.45, bubbleChance: 0.50},
    hard:   {startSpeed: 20, ramp: 0.35, topSpeed: 46, rowGap: 0.85, twoLane: 0.45, virusShare: 0.60, bubbleChance: 0.40}
};
export const STARS = [1500, 4000, 8000];
export const MAX_LIVES = 3;
export const MAX_OXYGEN = 5;
export const GATE_EVERY = 400;     // metres between organ gates
export const SPAWN_Z = 120;        // rows and gates appear this far ahead of the cell (metres)
export const INVULNERABLE = 1.5;   // seconds of blinking after a hit
const FIRST_ROW = 40;
const GATE_CLEARANCE = 8;          // no hazard row this close to a gate, so the gate stays readable
const ORGANS = ['heart', 'lungs', 'kidney', 'brain'];

// x1, then x2 from the 2nd delivery in a row, then x3 from the 4th.
export const deliveryMultiplier = streak => (streak >= 4 ? 3 : streak >= 2 ? 2 : 1);

export function createRun(level, rng) {
    const config = LEVELS[level];
    if (!config || !Object.prototype.hasOwnProperty.call(LEVELS, level)) throw new Error(`Unknown level: ${level}`);
    const state = {
        time: 0, distance: 0, speed: config.startSpeed, lane: 1, lives: MAX_LIVES, invulnerable: 0,
        oxygen: 0, oxygenStreak: 0, bestCombo: 0, deliveryStreak: 0, bubbles: 0, hits: 0,
        bubblePoints: 0, deliveryPoints: 0, score: 0, over: false, objects: []
    };
    let nextRowAt = FIRST_ROW, nextGateAt = GATE_EVERY, nextId = 1, organ = 0;
    const add = object => { state.objects.push({id: nextId++, variant: 0, organ: null, ...object}); };

    function resolve(object, events) {
        if (object.kind === 'gate') {
            if (state.oxygen < 1) { state.deliveryStreak = 0; return; }
            state.deliveryStreak += 1;
            const multiplier = deliveryMultiplier(state.deliveryStreak);
            const value = 100 * state.oxygen * multiplier;
            events.push({type: 'deliver', value, multiplier, oxygen: state.oxygen});
            state.deliveryPoints += value;
            state.oxygen = 0;
            return;
        }
        if (object.lane !== state.lane) return;
        if (object.kind === 'bubble') {
            state.oxygen = Math.min(MAX_OXYGEN, state.oxygen + 1);
            state.bubbles += 1;
            state.bubblePoints += 20;
            state.oxygenStreak += 1;
            state.bestCombo = Math.max(state.bestCombo, state.oxygenStreak);
            events.push({type: 'bubble', lane: object.lane});
            return;
        }
        if (state.invulnerable > 0) return;
        state.lives -= 1;
        state.hits += 1;
        state.invulnerable = INVULNERABLE;
        state.oxygenStreak = 0;
        state.deliveryStreak = 0;
        events.push({type: 'crash', kind: object.kind, lane: object.lane});
    }

    function spawnRow(at, events) {
        const lanes = [0, 1, 2];
        for (let i = lanes.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
        }
        const blocked = lanes.slice(0, rng() < config.twoLane ? 2 : 1);
        const z = at - state.distance;
        for (const lane of blocked) {
            if (rng() < config.virusShare) add({kind: 'virus', lane, z, at, variant: Math.floor(rng() * 3)});
            else add({kind: 'clot', lane, z, at});
        }
        let bubble = null;
        if (rng() < config.bubbleChance) {
            const free = lanes.slice(blocked.length);
            bubble = free[Math.floor(rng() * free.length)];
            add({kind: 'bubble', lane: bubble, z, at});
        }
        events.push({type: 'spawn', kind: 'row', z, at, speed: state.speed, blocked, bubble});
    }

    function tick(dt) {
        const events = [];
        if (state.over || !(dt > 0) || !Number.isFinite(dt)) return events;
        state.time += dt;
        state.speed = Math.min(config.topSpeed, config.startSpeed + config.ramp * state.time);
        const step = state.speed * dt;
        state.distance += step;
        for (const object of state.objects) object.z -= step;
        state.invulnerable = Math.max(0, state.invulnerable - dt);

        const passed = state.objects.filter(object => object.z <= 0);
        if (passed.length) {
            state.objects = state.objects.filter(object => object.z > 0);
            for (const object of passed) resolve(object, events);
        }

        // Gates first, so a row about to land on a gate can be skipped.
        while (state.distance + SPAWN_Z >= nextGateAt) {
            const at = nextGateAt;
            const name = ORGANS[organ++ % ORGANS.length];
            add({kind: 'gate', lane: null, z: at - state.distance, at, organ: name});
            events.push({type: 'spawn', kind: 'gate', z: at - state.distance, at, organ: name});
            nextGateAt += GATE_EVERY;
        }
        while (state.distance + SPAWN_Z >= nextRowAt) {
            const at = nextRowAt;
            nextRowAt += config.rowGap * state.speed;
            if (state.objects.some(object => object.kind === 'gate' && Math.abs(object.at - at) < GATE_CLEARANCE)) continue;
            spawnRow(at, events);
        }

        state.score = Math.floor(state.distance) + state.bubblePoints + state.deliveryPoints;
        if (state.lives <= 0) {
            state.lives = 0;
            state.over = true;
            events.push({type: 'end'});
        }
        return events;
    }

    function move(direction) {
        if (state.over) return false;
        const lane = state.lane + Math.sign(direction);
        if (lane < 0 || lane > 2 || lane === state.lane) return false;
        state.lane = lane;
        return true;
    }

    return {state, tick, move};
}
