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
export const MAX_SECONDS = 899;   // a run ends here, inside the server's 900 s limit, so a long run still saves
const FIRST_ROW = 40;
const GATE_CLEARANCE = 8;          // no hazard row this close to a gate, so the gate stays readable
const ORGANS = ['heart', 'lungs', 'kidney', 'brain'];

// x1, then x2 from the 2nd delivery in a row, then x3 from the 4th.
export const deliveryMultiplier = streak => (streak >= 4 ? 3 : streak >= 2 ? 2 : 1);

// Gates first (they span the tube, and their organ would hide the hazards behind it), then far to near.
export const drawOrder = objects => [...objects].sort((a, b) => (b.kind === 'gate') - (a.kind === 'gate') || b.z - a.z);

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
        if (state.lives <= 0 || state.time >= MAX_SECONDS) {
            state.lives = Math.max(0, state.lives);
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

// ── Drawing: a tunnel seen from just behind the cell. Canvas 2D in CSS px, only inside create() and drawBackdrop. ──
const F = 12;                      // a thing z metres ahead is drawn at F / (z + F) of its near size
const RING_EVERY = 6;
const CELL_SIZE = 0.85;           // the cell is this many lane widths wide
const TUBE = 1.35;                 // tube radius, in units of the floor's depth below the tunnel's centre
const FAR_COLOR = [58, 10, 16], NEAR_COLOR = [179, 38, 47];
const clamp01 = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function viewOf(w, h) {
    const vpY = h * 0.40, unit = h * 0.46;
    return {w, h, cx: w / 2, vpY, unit, laneGap: Math.min(0.5, (w * 0.30) / unit)};
}
function project(view, x, y, z) {
    const s = F / (Math.max(z, -F * 0.9) + F);
    return {x: view.cx + x * view.unit * s, y: view.vpY + y * view.unit * s, s};
}

function drawTunnel(ctx, view, distance, t, calm, particles) {
    const {w, h, cx, vpY, unit} = view;
    const back = ctx.createRadialGradient(cx, vpY, 0, cx, vpY, Math.max(w, h) * 0.75);
    back.addColorStop(0, '#12030a');
    back.addColorStop(0.45, '#2c070d');
    back.addColorStop(1, '#5a111b');
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, w, h);
    const pulse = calm ? 1 : 1 + 0.03 * Math.sin((t * Math.PI * 2) / 1.1);
    const offset = distance % RING_EVERY;
    for (let k = Math.ceil(SPAWN_Z / RING_EVERY); k >= 0; k--) {
        const z = k * RING_EVERY - offset;
        const s = F / (z + F), depth = clamp01(1 - z / SPAWN_Z);
        const [r, g, b] = mix(FAR_COLOR, NEAR_COLOR, depth);
        ctx.strokeStyle = `rgba(${r},${g},${b},${(0.12 + 0.5 * depth).toFixed(3)})`;
        ctx.lineWidth = 1 + 9 * s;
        ctx.beginPath();
        ctx.arc(cx, vpY, TUBE * unit * s * pulse, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,190,190,0.10)';
    ctx.lineWidth = 2;
    for (const edge of [-1.5, -0.5, 0.5, 1.5]) {
        const a = project(view, edge * view.laneGap, 1, SPAWN_Z), b = project(view, edge * view.laneGap, 1, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const p of particles) {
        const q = project(view, p.x, p.y, p.z);
        ctx.fillStyle = `rgba(255,170,170,${(0.15 + 0.45 * q.s).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, 1 + 3.5 * q.s, 0, Math.PI * 2); ctx.fill();
    }
}

// Code drawings for the things without an image (and for the cell and clot until their renders exist).
function drawClot(ctx, px) {
    for (const [x, y, r] of [[-0.18, 0.05, 0.26], [0.16, 0.08, 0.24], [0, -0.14, 0.24], [0.02, 0.16, 0.2], [-0.22, -0.12, 0.16], [0.24, -0.1, 0.16]]) {
        const g = ctx.createRadialGradient(x * px - r * px * 0.3, y * px - r * px * 0.3, 1, x * px, y * px, r * px);
        g.addColorStop(0, '#c0392b'); g.addColorStop(1, '#5a0d12');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x * px, y * px, r * px, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,235,200,0.75)'; ctx.lineWidth = Math.max(1.5, px * 0.025);
    for (const [a, b] of [[-0.4, 0.3], [0.35, -0.3], [-0.3, -0.35]]) {
        ctx.beginPath(); ctx.moveTo(a * px, b * px); ctx.quadraticCurveTo(0, 0, -a * px * 0.8, -b * px * 0.9); ctx.stroke();
    }
}
function drawBubble(ctx, px) {
    const g = ctx.createRadialGradient(-px * 0.15, -px * 0.18, px * 0.05, 0, 0, px * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(160,220,255,0.55)'); g.addColorStop(1, 'rgba(63,184,245,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, px * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(220,245,255,0.9)'; ctx.lineWidth = Math.max(1.5, px * 0.05); ctx.stroke();
    ctx.fillStyle = '#0b3550';
    ctx.font = `700 ${Math.max(9, Math.round(px * 0.3))}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('O₂', 0, px * 0.02);
}
function drawCellShape(ctx, px) {
    const g = ctx.createRadialGradient(-px * 0.12, -px * 0.12, px * 0.05, 0, 0, px * 0.5);
    g.addColorStop(0, '#ff6b6b'); g.addColorStop(1, '#a3121c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, px * 0.5, px * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(90,6,12,0.55)';
    ctx.beginPath(); ctx.ellipse(0, -px * 0.02, px * 0.24, px * 0.14, 0, 0, Math.PI * 2); ctx.fill();
}
function drawOrganShape(ctx, px) {
    ctx.fillStyle = '#e8566b';
    ctx.beginPath(); ctx.arc(0, 0, px * 0.35, 0, Math.PI * 2); ctx.fill();
}
// An image (once loaded) or its code drawing, centred on (x, y) and px wide.
function drawThing(ctx, image, shape, x, y, px, alpha = 1, angle = 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (image) { const iw = (px * image.width) / image.height; ctx.drawImage(image, -iw / 2, -px / 2, iw, px); }
    else shape(ctx, px);
    ctx.restore();
}

function drawBackdrop(ctx, t, w, h, images = {}) {
    const view = viewOf(w, h);
    drawTunnel(ctx, view, t * 14, t, false, []);
    const size = view.laneGap * CELL_SIZE;
    const cell = project(view, Math.sin(t * 0.8) * view.laneGap * 0.6, 1 - size * 0.55, 0);
    drawThing(ctx, images.cell, drawCellShape, cell.x, cell.y, size * view.unit, 1, Math.cos(t * 0.8) * 0.08);
}

function create(canvas, api) {
    const ctx = api.ctx;
    const random = Math.random;    // looks only: the seeded api.rng stays with the run
    let run = null, view = null, viewKey = '', visualLane = 1, clock = 0, ended = false;
    let particles = [], sparks = [], floats = [], flash = 0, shake = 0, gateGlow = 0;
    const ensureView = () => {
        const key = `${api.width}x${api.height}`;
        if (key !== viewKey) { viewKey = key; view = viewOf(api.width, api.height); }
        return view;
    };
    const plasma = (z = random() * SPAWN_Z) => ({x: (random() * 2 - 1) * TUBE * 0.8, y: (random() * 2 - 1) * TUBE * 0.8, z});
    const imageFor = object => (object.kind === 'virus' ? api.images['germ' + (object.variant + 1)] : object.kind === 'gate' ? api.images[object.organ] : api.images[object.kind]);
    const sizeOf = kind => view.laneGap * (kind === 'gate' ? 3.2 : kind === 'bubble' ? 0.55 : 0.75);
    const cellAt = () => {
        const size = view.laneGap * CELL_SIZE;
        return {p: project(view, (visualLane - 1) * view.laneGap, 1 - size * 0.55, 0), px: size * view.unit};
    };
    const hud = () => api.hud({score: run.state.score, lives: run.state.lives, distance: run.state.distance});
    function burst(x, y, color, count) {
        for (let i = 0; i < (api.reducedMotion ? Math.ceil(count / 4) : count); i++) {
            const a = random() * Math.PI * 2, v = 60 + random() * 160;
            sparks.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + random() * 0.3, color});
        }
    }
    function move(direction) {
        if (!run || run.state.over) return false;
        if (run.move(direction)) api.sound('move');
        return true;
    }
    function handle(events) {
        const {p} = cellAt();
        for (const event of events) {
            if (event.type === 'bubble') {
                api.sound('bubble');
                burst(p.x, p.y - 20, '#bfe9ff', 12);
                floats.push({x: p.x, y: p.y - 40, text: '+20', color: '#bfe9ff', life: 0.9});
            } else if (event.type === 'crash') {
                api.sound('crash');
                api.vibrate(120);
                flash = 0.35;
                if (!api.reducedMotion) shake = 0.15;
                burst(p.x, p.y, '#f2545b', 14);
            } else if (event.type === 'deliver') {
                api.sound('deliver');
                gateGlow = 0.6;
                const times = event.multiplier > 1 ? ` ×${event.multiplier}` : '';
                floats.push({x: view.cx, y: view.vpY + view.unit * 0.2, text: `+${event.value.toLocaleString('en-PH')}${times}`, color: '#f7c948', life: 1.3});
            }
        }
    }
    // The oxygen the cell carries, as 5 pips on the floor under the cell (clear of the HUD and the buttons).
    function drawOxygen(state) {
        const y = view.vpY + view.unit + 16, left = view.cx - ((MAX_OXYGEN - 1) * 24) / 2;
        for (let i = 0; i < MAX_OXYGEN; i++) {
            ctx.beginPath(); ctx.arc(left + i * 24, y, 9, 0, Math.PI * 2);
            ctx.fillStyle = i < state.oxygen ? 'rgba(160,220,255,0.95)' : 'rgba(18,18,18,0.6)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(220,245,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        if (state.deliveryStreak < 1) return;
        ctx.font = '400 14px Bungee, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f7c948';
        ctx.fillText(`Next delivery ×${deliveryMultiplier(state.deliveryStreak + 1)}`, view.cx, y + 24);
    }
    function drawRun() {
        const {state} = run, {w, h} = view;
        ctx.save();
        if (shake > 0) ctx.translate((random() - 0.5) * 12, (random() - 0.5) * 12);
        drawTunnel(ctx, view, state.distance, clock, api.reducedMotion, particles);
        for (const object of drawOrder(state.objects)) {
            if (object.z > SPAWN_Z) continue;
            const size = sizeOf(object.kind), alpha = clamp01((SPAWN_Z - object.z) / 18);
            if (object.kind === 'gate') {
                const q = project(view, 0, 0.25, object.z);
                ctx.save();
                ctx.globalAlpha = alpha * 0.8;
                ctx.strokeStyle = gateGlow > 0 ? '#f7c948' : 'rgba(63,184,245,0.9)';
                ctx.lineWidth = 3 + 10 * q.s;
                ctx.beginPath(); ctx.arc(view.cx, view.vpY, TUBE * view.unit * q.s * 0.92, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
                drawThing(ctx, imageFor(object), drawOrganShape, q.x, q.y, size * view.unit * q.s, alpha);
                continue;
            }
            const q = project(view, (object.lane - 1) * view.laneGap, 1 - size * (object.kind === 'bubble' ? 0.9 : 0.5), object.z);
            const shape = object.kind === 'bubble' ? drawBubble : drawClot;
            drawThing(ctx, object.kind === 'bubble' ? null : imageFor(object), shape, q.x, q.y, size * view.unit * q.s, alpha);
        }
        const {p, px} = cellAt();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(p.x, view.vpY + view.unit, px * 0.45, px * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        const blink = state.invulnerable > 0 && Math.floor(state.invulnerable * 10) % 2 === 0;
        drawThing(ctx, api.images.cell, drawCellShape, p.x, p.y, px, blink ? 0.35 : 1, (state.lane - visualLane) * 0.14);
        for (const s of sparks) {
            ctx.globalAlpha = clamp01(s.life * 2); ctx.fillStyle = s.color;
            ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.font = '400 26px Bungee, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const f of floats) {
            ctx.globalAlpha = clamp01(f.life * 2);
            ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(f.text, f.x, f.y);
            ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        }
        ctx.restore();
        if (flash > 0) {
            const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
            edge.addColorStop(0, 'rgba(242,84,91,0)');
            edge.addColorStop(1, `rgba(242,84,91,${(flash / 0.35 * 0.6).toFixed(3)})`);
            ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
        }
        drawOxygen(state);
    }

    return {
        get state() { return run ? run.state : null; },
        start(difficulty) {
            run = createRun(difficulty, api.rng);
            visualLane = 1; clock = 0; ended = false;
            particles = Array.from({length: api.reducedMotion ? 12 : 40}, () => plasma());
            sparks = []; floats = []; flash = shake = gateGlow = 0;
            ensureView();
            hud();
        },
        update(dt) {
            if (!run || run.state.over) return;
            ensureView();
            clock += dt;
            handle(run.tick(dt));
            const {state} = run;
            const step = dt / 0.12;    // a lane change takes 0.12 s on screen
            visualLane += Math.max(-step, Math.min(step, state.lane - visualLane));
            for (const p of particles) { p.z -= state.speed * dt * 1.4; if (p.z < -F * 0.5) Object.assign(p, plasma(SPAWN_Z)); }
            for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 300 * dt; s.life -= dt; }
            sparks = sparks.filter(s => s.life > 0);
            for (const f of floats) { f.y -= 40 * dt; f.life -= dt; }
            floats = floats.filter(f => f.life > 0);
            flash = Math.max(0, flash - dt); shake = Math.max(0, shake - dt); gateGlow = Math.max(0, gateGlow - dt);
            hud();
            if (state.over && !ended) {
                ended = true;
                api.sound('gameover');
                api.gameOver({score: state.score, stats: {hits: state.bubbles, misses: state.hits, friendly_hits: 0, best_combo: state.bestCombo}});
            }
        },
        draw() {
            if (run) { ensureView(); drawRun(); }
        },
        key(code) {
            if (code === 'ArrowLeft' || code === 'KeyA') return move(-1);
            if (code === 'ArrowRight' || code === 'KeyD') return move(1);
            return false;
        },
        swipe(direction) { move(direction === 'left' ? -1 : 1); },
        pointer() {},
        // Where the cell is drawn, in CSS px: the browser tests check it is on screen and clear of the buttons.
        cellBox() {
            if (!run) return null;
            ensureView();
            const {p, px} = cellAt();
            return {x: p.x - px / 2, y: p.y - px / 2, w: px, h: px};
        },
        destroy() {
            run = null;
            particles = []; sparks = []; floats = [];
        }
    };
}

export default {
    key: 'cell-runner',
    title: 'Cell Runner',
    tagline: 'Race through the bloodstream and deliver oxygen.',
    theme: {accent: '#f2545b'},
    howToPlay: [
        {icon: 'arrows-clockwise', color: 'sky', title: 'Switch lanes', text: 'with ← and → (or A and D), a swipe, or the on-screen buttons from Settings.'},
        {icon: 'warning-circle', color: 'coral', title: 'Dodge clots and viruses.', text: 'Each hit costs one of your 3 lives.'},
        {icon: 'circle', color: 'teal', title: 'Grab oxygen bubbles:', text: '+20 each, and you can carry up to 5.'},
        {icon: 'target', color: 'yellow', title: 'Deliver at the organs:', text: '100 points per bubble, ×2 from the 2nd delivery in a row and ×3 from the 4th.'}
    ],
    levels: {easy: 'Slower start · one lane blocked at a time', medium: 'Faster · sometimes two lanes blocked', hard: 'Fastest · crowded rows'},
    assets: {
        images: {cell: 'cell.webp', clot: 'clot.webp', germ1: 'germ-1.webp', germ2: 'germ-2.webp', germ3: 'germ-3.webp', heart: 'heart.webp', lungs: 'lungs.webp', kidney: 'kidney.webp', brain: 'brain.webp'},
        sounds: {move: 'move.ogg', bubble: 'bubble.ogg', crash: 'crash.ogg', deliver: 'deliver.ogg', beep: 'beep.ogg', gameover: 'gameover.ogg'}
    },
    stars: STARS,
    roundSeconds: null,
    maxLives: MAX_LIVES,
    touchButtons: ['left', 'right'],
    settings: [{key: 'controls', label: 'Controls', options: [['swipe', 'Swipe'], ['buttons', 'On-screen buttons']], default: 'swipe'}],
    drawBackdrop,
    create
};
