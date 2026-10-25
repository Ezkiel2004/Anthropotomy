// Germ Smash: the pure round logic (createRound and its helpers), then the canvas renderer and the
// game module the shell loads. No DOM or window access at import time, so Node unit tests can load
// this module directly (tests/unit/germ-smash.test.mjs).

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
        events.push({type: 'spawn', pore: index, kind});
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
        // A non-number, zero, negative or non-finite dt is ignored (the shell also caps dt at 0.05 s).
        if (state.over || typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return events;
        state.time += dt;
        state.pores.forEach((pore, i) => {
            if (!pore.kind) return;
            pore.age += dt;
            if (pore.age < pore.upFor) return;
            if (pore.kind !== 'friendly') { state.misses++; state.streak = 0; }
            state.pores[i] = emptyPore();
            events.push({type: 'escape', pore: i, kind: pore.kind});
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

// ── Rendering ─────────────────────────────────────────────────────
// Everything below runs only inside drawBackdrop() and create(), never at import time.
// Characters are drawn in code until the Blender renders exist; a loaded image of the same
// name (api.images.germ1 … friendly) replaces its drawing.

const GERM_COLORS = ['#7bd389', '#b388f5', '#ff9f43'];
const TOUGH_COLOR = '#e8695a';
const ARMOR_COLOR = '#6b7488';
const FRIENDLY_COLOR = '#3fb8f5';
const INK = '#121212';
const YELLOW = '#f7c948';
const CORAL = '#f2545b';
const RISE = 0.16;        // seconds to rise out of the pore
const SINK = 0.14;        // seconds to sink back before escaping
const CELL_H = 0.78;      // a board cell is 100 units wide and 78 tall
const TOUGH_SCALE = 1.15;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = k => 1 - (1 - k) ** 3;
const smooth = k => k * k * (3 - 2 * k);
const scaleOf = kind => (kind === 'tough' ? TOUGH_SCALE : 1);
const keyLabel = code => code.replace(/^(?:Key|Digit|Numpad)/, '');

function hash(a, b = 0) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
function mix(a, b, k) {
    const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
    return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`;
}
const shade = (hex, f) => mix(hex, f < 0 ? '#000000' : '#ffffff', Math.abs(f));

function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

function starPath(g, points, inner, outer) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? inner : outer;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
}

// Fills the current path with a light glow, then gives it a soft dark outline,
// so a character reads on the lightest and the deepest skin tone alike.
function glowFill(g, color, px) {
    g.fillStyle = color;
    g.shadowColor = 'rgba(255,255,255,.7)';
    g.shadowBlur = 9 * px;
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.stroke();
}

function eyes(g, y, r, pupil, look = 1) {
    g.fillStyle = '#fff';
    circle(g, -7, y, r);
    circle(g, 7, y, r);
    g.fillStyle = INK;
    circle(g, -7 + look, y + 1, pupil);
    circle(g, 7 + look, y + 1, pupil);
}

// Unit space: a germ's spikes reach 28 units from its centre.
function drawGerm(g, color, px) {
    starPath(g, 12, 20, 28);
    glowFill(g, color, px);
    g.fillStyle = shade(color, -0.28);
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        circle(g, Math.cos(a) * 27, Math.sin(a) * 27, 2.8);
    }
    g.fillStyle = 'rgba(255,255,255,.3)';
    circle(g, -8, -10, 5.5);
    eyes(g, -1, 5, 2.5);
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-6, 11); g.lineTo(0, 8); g.lineTo(6, 11); g.stroke();
}

function drawTough(g, cracked, px) {
    starPath(g, 14, 21, 28);
    glowFill(g, TOUGH_COLOR, px);
    // An armored helmet over the top half.
    g.beginPath();
    g.arc(0, -2, 22, Math.PI, 0);
    g.closePath();
    g.fillStyle = ARMOR_COLOR;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 2;
    for (const x of [-8, 8]) { g.beginPath(); g.moveTo(x, -2); g.lineTo(x, -2 - Math.sqrt(22 * 22 - x * x)); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath(); g.arc(0, -2, 18, Math.PI * 1.1, Math.PI * 1.45); g.lineTo(0, -2); g.closePath(); g.fill();
    g.fillStyle = '#c9cfdb';
    for (const x of [-15, 0, 15]) circle(g, x, -6, 1.8);
    eyes(g, 5, 4.5, 2.2, 0.5);
    g.strokeStyle = INK;
    g.lineCap = 'round';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-12, -0.5); g.lineTo(-3, 2); g.moveTo(12, -0.5); g.lineTo(3, 2); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-6, 14); g.lineTo(6, 14); g.stroke();
    if (cracked) {
        g.lineJoin = 'miter';
        for (const [color, width] of [['rgba(0,0,0,.6)', 4], ['#fff', 2]]) {
            g.strokeStyle = color;
            g.lineWidth = width;
            g.beginPath();
            g.moveTo(3, -23); g.lineTo(-3, -15); g.lineTo(4, -10); g.lineTo(-1, -3);
            g.moveTo(-3, -15); g.lineTo(-12, -13);
            g.stroke();
        }
    }
}

// Round and smooth: a different shape from the spiky germs, not only a different color.
function drawFriendly(g, px) {
    g.beginPath();
    g.arc(0, 0, 24, 0, Math.PI * 2);
    glowFill(g, FRIENDLY_COLOR, px);
    g.fillStyle = 'rgba(255,255,255,.35)';
    circle(g, -8, -10, 7);
    g.fillStyle = 'rgba(255,140,170,.5)';
    circle(g, -13, 5, 3.5);
    circle(g, 13, 5, 3.5);
    g.fillStyle = '#0b3550';
    circle(g, -7, -2, 3);
    circle(g, 7, -2, 3);
    g.strokeStyle = '#0b3550';
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath(); g.arc(0, 4, 7, 0.2, Math.PI - 0.2); g.stroke();
}

// [sprite key, api.images name, code drawing used when that image is missing]
const SPRITES = [
    ['germ0', 'germ1', (g, px) => drawGerm(g, GERM_COLORS[0], px)],
    ['germ1', 'germ2', (g, px) => drawGerm(g, GERM_COLORS[1], px)],
    ['germ2', 'germ3', (g, px) => drawGerm(g, GERM_COLORS[2], px)],
    ['tough', 'tough', (g, px) => drawTough(g, false, px)],
    ['toughCracked', 'toughCracked', (g, px) => drawTough(g, true, px)],
    ['friendly', 'friendly', (g, px) => drawFriendly(g, px)]
];
const spriteKey = pore => (pore.kind === 'germ' ? 'germ' + pore.variant : pore.kind === 'tough' && pore.cracked ? 'toughCracked' : pore.kind);
const colorOf = (kind, variant) => (kind === 'germ' ? GERM_COLORS[variant] || GERM_COLORS[0] : kind === 'tough' ? TOUGH_COLOR : FRIENDLY_COLOR);

// Pre-renders each character once per size, so a frame is only drawImage calls.
function buildSprites(unit, dpr, images) {
    const sprites = {};
    for (const [key, imageName, paint] of SPRITES) {
        const scale = unit * (key.startsWith('tough') ? TOUGH_SCALE : 1);
        const half = 40 * scale;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.max(2, Math.ceil(half * 2 * dpr));
        const g = canvas.getContext('2d');
        g.setTransform(dpr * scale, 0, 0, dpr * scale, canvas.width / 2, canvas.height / 2);
        const image = images && images[imageName];
        if (image) {
            g.shadowColor = 'rgba(255,255,255,.7)';
            g.shadowBlur = 9 * dpr * scale;
            g.drawImage(image, -32, -32, 64, 64);
        } else {
            paint(g, dpr * scale);
        }
        sprites[key] = {canvas, half};
    }
    return sprites;
}

function drawSprite(ctx, sprite, x, y, sx = 1, sy = 1, rotation = 0, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.scale(sx, sy);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite.canvas, -sprite.half, -sprite.half, sprite.half * 2, sprite.half * 2);
    ctx.restore();
}

// Grain, fine pores, creases, the game pores and a vignette, drawn once per size in black and
// white at low alpha, so laid over any skin tone they come out as darker and lighter shades of it.
function buildTexture(w, h, dpr, pores, center, seed) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let n = 0;
    const rand = () => hash(seed, n++);
    g.lineWidth = 1;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.028)';
    for (let i = Math.round((w + h) / 140); i > 0; i--) {
        const x = rand() * w, y = rand() * h, length = 50 + rand() * 120, a = (rand() - 0.5) * 0.9, bend = (rand() - 0.5) * 24;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * length * 0.5, y + Math.sin(a) * length * 0.5 + bend, x + Math.cos(a) * length, y + Math.sin(a) * length);
        g.stroke();
    }
    for (let i = Math.round((w * h) / 650); i > 0; i--) {
        const dark = rand() < 0.72, alpha = rand(), size = 1 + rand() * 1.2;
        g.fillStyle = dark ? `rgba(0,0,0,${(alpha * 0.07).toFixed(3)})` : `rgba(255,255,255,${(alpha * 0.06).toFixed(3)})`;
        g.fillRect(rand() * w, rand() * h, size, size);
    }
    g.fillStyle = 'rgba(0,0,0,.07)';
    for (let i = Math.round((w * h) / 9000); i > 0; i--) {
        const x = rand() * w, y = rand() * h;
        g.beginPath();
        g.ellipse(x, y, 1.6 + rand() * 1.4, 1 + rand() * 0.8, 0, 0, Math.PI * 2);
        g.fill();
    }
    for (const p of pores) {
        g.fillStyle = 'rgba(255,255,255,.2)';
        g.beginPath(); g.ellipse(p.x, p.y + p.ry * 0.3, p.rx * 1.08, p.ry * 1.18, 0, 0, Math.PI * 2); g.fill();
        const hole = g.createLinearGradient(0, p.y - p.ry, 0, p.y + p.ry);
        hole.addColorStop(0, 'rgba(0,0,0,.68)');
        hole.addColorStop(1, 'rgba(0,0,0,.5)');
        g.fillStyle = hole;
        g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2); g.fill();
    }
    const vignette = g.createRadialGradient(center.x, center.y, Math.min(w, h) * 0.22, center.x, center.y, Math.max(w, h) * 0.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, w, h);
    return canvas;
}

// The round's board: centred, as large as fits below the heads-up display, in both orientations.
function boardLayout(w, h, cols, rows) {
    const top = 84, bottom = 20, side = 16;
    const availW = Math.max(120, w - side * 2), availH = Math.max(120, h - top - bottom);
    const cellW = Math.min(availW / cols, availH / (rows * CELL_H), 200);
    const cellH = cellW * CELL_H;
    const unit = cellW / 100;
    const x0 = (w - cellW * cols) / 2, y0 = top + (availH - cellH * rows) / 2;
    const pores = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) pores.push({x: x0 + (c + 0.5) * cellW, y: y0 + r * cellH + 58 * unit, rx: 30 * unit, ry: 11 * unit});
    }
    return {unit, pores, center: {x: w / 2, y: y0 + (cellH * rows) / 2}};
}

// The menu's board, as in the approved mockup: right of the panel on wide screens, above the sheet on phones.
function backdropLayout(w, h) {
    const wide = w > 700;
    const cols = wide ? 6 : 3, rows = wide ? 4 : 3, r = wide ? 34 : 28;
    const x0 = wide ? w * 0.42 : w * 0.12, x1 = w * 0.92, y0 = wide ? h * 0.16 : h * 0.12, y1 = wide ? h * 0.88 : h * 0.36;
    const pores = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const i = pores.length;
            pores.push({x: x0 + (x1 - x0) * (col + 0.5) / cols + (hash(i, 1) - 0.5) * 20, y: y0 + (y1 - y0) * (row + 0.5) / rows + (hash(i, 2) - 0.5) * 16, rx: r, ry: r * 0.36});
        }
    }
    return {unit: r / 30, pores, center: {x: w * 0.6, y: h * 0.45}};
}

// Draws one character rising out of (or sinking into) its pore; e runs from 0 (hidden) to 1 (fully up).
function drawRisen(ctx, sprite, p, unit, kind, e, sx = 1, sy = 1, rotation = 0, alpha = 1) {
    const s = scaleOf(kind);
    const y = p.y - 18 * s * unit + (1 - e) * 46 * s * unit;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x - 52 * unit, p.y - 90 * unit, 104 * unit, 90 * unit);
    ctx.clip();
    drawSprite(ctx, sprite, p.x, y, sx, sy, rotation, alpha);
    ctx.restore();
}

let backdrop = null;
let backdropTone = -1;

// The menu backdrop: the same skin, cycling slowly through the tones, with germs popping up and
// sinking back. It depends only on t (no stored round), so the shell can call it every frame.
function drawBackdrop(ctx, t, w, h, images) {
    const dpr = (ctx.getTransform && ctx.getTransform().a) || 1;
    const key = `${w}x${h}@${dpr}`;
    if (!backdrop || backdrop.key !== key || backdrop.images !== images) {
        const layout = backdropLayout(w, h);
        backdrop = {key, images, layout, texture: buildTexture(w, h, dpr, layout.pores, layout.center, 3), sprites: buildSprites(layout.unit, dpr, images)};
    }
    if (backdropTone < 0) backdropTone = Math.floor(Math.random() * SKIN_TONES.length);
    const span = 9;
    const step = Math.floor(t / span), f = t / span - step;
    const from = SKIN_TONES[(backdropTone + step) % SKIN_TONES.length];
    const to = SKIN_TONES[(backdropTone + step + 1) % SKIN_TONES.length];
    ctx.fillStyle = mix(from, to, smooth(clamp01((f - 0.8) / 0.2)));
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(backdrop.texture, 0, 0, w, h);
    const {layout, sprites} = backdrop;
    layout.pores.forEach((p, i) => {
        const period = 2.4 + hash(i, 3) * 2.6;
        const local = t + hash(i, 4) * period;
        const cycle = Math.floor(local / period);
        if (hash(i, cycle * 7 + 5) > 0.4) return;
        const life = 1.4 + hash(i, cycle * 7 + 6) * 0.9;
        const k = (local - cycle * period) / life;
        if (k >= 1) return;
        const e = easeOut(clamp01(k / 0.18)) * smooth(clamp01((1 - k) / 0.18));
        const pore = hash(i, cycle * 7 + 8) < 0.18 ? {kind: 'friendly'} : {kind: 'germ', variant: Math.floor(hash(i, cycle * 7 + 9) * 3)};
        drawRisen(ctx, sprites[spriteKey(pore)], p, layout.unit, pore.kind, e, 1, 1, Math.sin(t * 3 + i) * 0.06);
    });
}

const KEY_ROWS = {
    easy: [0, 3, 6].map(start => KEYPAD.slice(start, start + 3).map(n => 'Digit' + n)),
    medium: LETTER_ROWS,
    hard: [DIGIT_ROW, ...LETTER_ROWS]
};

function create(canvas, api) {
    const ctx = api.ctx;
    const random = Math.random;   // effects only; the round itself draws from the seeded api.rng
    let round = null, config = null, level = null, tone = SKIN_TONES[0];
    let layout = null, layoutKey = '', texture = null, sprites = null, keyLabels = [];
    let looks = [], bumps = [], particles = [], floats = [], ghosts = [], rings = [];
    let flash = 0, shake = 0, clock = 0, lastCeil = ROUND_SECONDS, lastMultiplier = 1, ended = false, showKeys = false;

    // Lays the board out again whenever the size changes. Positions come from the pore indexes,
    // so the round state is untouched and a tap after a rotation still finds its germ.
    function ensureLayout() {
        if (!config) return false;
        const dpr = api.dpr || 1;
        const key = `${api.width}x${api.height}@${dpr}:${level}`;
        if (key !== layoutKey) {
            layoutKey = key;
            layout = boardLayout(api.width, api.height, config.cols, config.rows);
            texture = buildTexture(api.width, api.height, dpr, layout.pores, layout.center, 7);
            sprites = buildSprites(layout.unit, dpr, api.images);
        }
        return true;
    }

    const riseOf = pore => Math.min(easeOut(clamp01(pore.age / RISE)), smooth(clamp01((pore.upFor - pore.age) / SINK)));

    function centerOf(i, pore, e = 1) {
        const p = layout.pores[i], s = scaleOf(pore && pore.kind);
        return {x: p.x, y: p.y - 18 * s * layout.unit + (1 - e) * 46 * s * layout.unit};
    }

    function burst(x, y, color, big) {
        const count = api.reducedMotion ? (big ? 2 + Math.floor(random() * 3) : 1) : (big ? 8 + Math.floor(random() * 7) : 4);
        for (let i = 0; i < count; i++) {
            const a = random() * Math.PI * 2, v = 120 + random() * 240;
            particles.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, size: (2 + random() * 3) * Math.max(1, layout.unit), life: 0.6, color});
        }
    }

    function hud() {
        const {state} = round;
        api.hud({score: state.score, combo: comboMultiplier(state.streak), timeLeft: Math.max(0, ROUND_SECONDS - state.time)});
    }

    function tapPore(i) {
        const before = round.state.pores[i];
        if (!before || !before.kind) return round.tap(i);
        const {kind, variant, cracked} = before;
        const at = centerOf(i, before, riseOf(before));
        const result = round.tap(i);
        const unit = layout.unit;
        if (result.type === 'crack') {
            bumps[i] = 0.15;
            burst(at.x, at.y - 12 * unit, '#c9cfdb', false);
            api.sound('pop');
        } else if (result.type === 'hit' || result.type === 'kill') {
            burst(at.x, at.y, colorOf(kind, variant), true);
            ghosts.push({i, key: spriteKey({kind, variant, cracked}), kind, life: 0.2});
            floats.push({x: at.x, y: at.y - 30 * unit, text: `+${result.value}${result.multiplier > 1 ? ` ×${result.multiplier}` : ''}`, color: YELLOW, life: 0.9});
            if (result.type === 'kill') {
                api.sound('thud');
                if (!api.reducedMotion) shake = 0.12;
            } else {
                api.sound('pop');
            }
            if (result.multiplier > lastMultiplier) api.sound('chime');
            lastMultiplier = result.multiplier;
        } else if (result.type === 'friendly') {
            burst(at.x, at.y, FRIENDLY_COLOR, true);
            ghosts.push({i, key: 'friendly', kind, life: 0.2});
            floats.push({x: at.x, y: at.y - 30 * unit, text: result.value < 0 ? `−${-result.value}` : '0', color: CORAL, life: 0.9});
            flash = 0.35;
            lastMultiplier = 1;
            api.sound('buzz');
            api.vibrate(80);
        }
        hud();
        return result;
    }

    function stepEffects(dt) {
        for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.life -= dt; }
        for (const f of floats) { f.y -= (api.reducedMotion ? 12 : 40) * dt; f.life -= dt; }
        for (const g of ghosts) g.life -= dt;
        for (const r of rings) r.life -= dt;
        particles = particles.filter(p => p.life > 0);
        floats = floats.filter(f => f.life > 0);
        ghosts = ghosts.filter(g => g.life > 0);
        rings = rings.filter(r => r.life > 0);
        bumps = bumps.map(b => Math.max(0, b - dt));
        flash = Math.max(0, flash - dt);
        shake = Math.max(0, shake - dt);
    }

    function drawBoard() {
        const w = api.width, h = api.height, unit = layout.unit;
        ctx.save();
        if (shake > 0 && !api.reducedMotion) {
            const m = 4 * (shake / 0.12);
            ctx.translate((random() * 2 - 1) * m, (random() * 2 - 1) * m);
        }
        ctx.fillStyle = tone;
        ctx.fillRect(-8, -8, w + 16, h + 16);
        ctx.drawImage(texture, 0, 0, w, h);
        round.state.pores.forEach((pore, i) => {
            if (!pore.kind) return;
            let rotation = 0;
            if (!api.reducedMotion) rotation = Math.sin(pore.age * 18 + looks[i]) * 0.16 * Math.max(0, 1 - pore.age / 0.45) + Math.sin(clock * 3 + looks[i]) * 0.04;
            const bump = bumps[i] / 0.15;
            drawRisen(ctx, sprites[spriteKey(pore)], layout.pores[i], unit, pore.kind, riseOf(pore), 1 + 0.12 * bump, 1 - 0.08 * bump, rotation);
        });
        for (const g of ghosts) {
            const k = 1 - g.life / 0.2;   // squash and stretch, then gone
            drawRisen(ctx, sprites[g.key], layout.pores[g.i], unit, g.kind, 1 - 0.25 * k, 1 + 0.45 * k, 1 - 0.55 * k, 0, 1 - k);
        }
        ctx.lineWidth = 3;
        for (const r of rings) {
            const p = layout.pores[r.i], k = 1 - r.life / 0.4;
            ctx.strokeStyle = `rgba(242,84,91,${(0.8 * (1 - k)).toFixed(3)})`;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx * (1 + 0.35 * k), p.ry * (1 + 0.35 * k), 0, 0, Math.PI * 2); ctx.stroke();
        }
        if (showKeys) {
            ctx.font = `700 ${Math.round(Math.max(11, 13 * unit))}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            layout.pores.forEach((p, i) => {
                const y = p.y + p.ry + 10 * unit;
                ctx.fillStyle = 'rgba(18,18,18,.72)';
                circle(ctx, p.x, y, Math.max(9, 10 * unit));
                ctx.fillStyle = '#fff';
                ctx.fillText(keyLabels[i] || '', p.x, y + 0.5);
            });
        }
        for (const p of particles) {
            ctx.globalAlpha = clamp01(p.life * 2);
            ctx.fillStyle = p.color;
            circle(ctx, p.x, p.y, p.size);
        }
        ctx.globalAlpha = 1;
        if (floats.length) {
            ctx.font = `${Math.round(Math.min(30, Math.max(18, 22 * unit)))}px Bungee, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            for (const f of floats) {
                ctx.globalAlpha = clamp01(f.life * 2);
                ctx.strokeStyle = 'rgba(0,0,0,.6)';
                ctx.strokeText(f.text, f.x, f.y);
                ctx.fillStyle = f.color;
                ctx.fillText(f.text, f.x, f.y);
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        if (flash > 0) {
            const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
            edge.addColorStop(0, 'rgba(242,84,91,0)');
            edge.addColorStop(1, `rgba(242,84,91,${(0.6 * flash / 0.35).toFixed(3)})`);
            ctx.fillStyle = edge;
            ctx.fillRect(0, 0, w, h);
        }
    }

    return {
        get state() { return round ? round.state : null; },
        get tone() { return tone; },
        start(difficulty) {
            config = LEVELS[difficulty];
            if (!config) throw new Error(`Unknown Germ Smash level: ${difficulty}`);
            level = difficulty;
            tone = pickSkinTone(api.rng);
            round = createRound(difficulty, api.rng);
            looks = Array(config.cols * config.rows).fill(0);
            bumps = Array(config.cols * config.rows).fill(0);
            keyLabels = KEY_ROWS[difficulty].flat().map(keyLabel);
            particles = []; floats = []; ghosts = []; rings = [];
            flash = shake = clock = 0;
            lastCeil = ROUND_SECONDS;
            lastMultiplier = 1;
            ended = false;
            layoutKey = '';
            hud();
        },
        update(dt) {
            if (!round || round.state.over) return;
            clock += dt;
            for (const event of round.tick(dt)) {
                if (event.type === 'spawn') looks[event.pore] = random() * Math.PI * 2;
                else if (event.type === 'escape' && event.kind !== 'friendly') rings.push({i: event.pore, life: 0.4});
            }
            stepEffects(dt);
            const {state} = round;
            lastMultiplier = comboMultiplier(state.streak);
            const ceil = Math.ceil(Math.max(0, ROUND_SECONDS - state.time));
            if (ceil < lastCeil && ceil <= 10 && ceil > 0) api.sound('tick');
            lastCeil = ceil;
            hud();
            if (state.over && !ended) {
                ended = true;
                api.sound('gameover');
                api.gameOver({score: state.score, stats: {hits: state.hits, misses: state.misses, friendly_hits: state.friendlyHits, best_combo: state.bestCombo}});
            }
        },
        draw() {
            if (round && ensureLayout()) drawBoard();
        },
        // Hit-tests a tap (CSS px) against where each character is drawn right now.
        pointer(x, y) {
            if (!round || round.state.over || !ensureLayout()) return false;
            let best = -1, bestDistance = Infinity;
            round.state.pores.forEach((pore, i) => {
                if (!pore.kind) return;
                const e = riseOf(pore);
                if (e < 0.12) return;
                const p = layout.pores[i], top = centerOf(i, pore, e).y;
                const dy = y < top ? y - top : y > p.y ? y - p.y : 0;
                const distance = Math.hypot(x - p.x, dy);
                if (distance <= Math.max(22, 34 * scaleOf(pore.kind) * layout.unit) && distance < bestDistance) { best = i; bestDistance = distance; }
            });
            if (best < 0) return false;
            tapPore(best);
            return true;
        },
        key(code) {
            if (!round || round.state.over || !ensureLayout()) return false;
            const index = keyToPore(code, config.cols, config.rows);
            if (index === null) return false;
            showKeys = true;
            tapPore(index);
            return true;
        },
        // Where a fully risen character's body sits, in CSS px (the browser tests tap here).
        poreCenter(i) {
            if (!round || !ensureLayout() || !layout.pores[i]) return null;
            return centerOf(i, round.state.pores[i]);
        },
        destroy() {
            round = null;
            particles = []; floats = []; ghosts = []; rings = [];
        }
    };
}

export default {
    key: 'germ-smash',
    title: 'Germ Smash',
    tagline: 'Smash the germs, spare the good bacteria.',
    theme: {accent: '#2ccf9a'},
    howToPlay: [
        {icon: 'target', color: 'coral', title: 'Tap a germ', text: 'before it sinks back into its pore. +10 each; an armored germ takes two taps and is worth 25.'},
        {icon: 'chart-line', color: 'yellow', title: 'Keep a streak going:', text: '×2 after 5 hits in a row, ×3 after 10 and ×4 after 20.'},
        {icon: 'circle', color: 'sky', title: 'Spare the round blue bacteria.', text: 'Tapping one costs 15 and ends your streak.'},
        {icon: 'clock', color: 'teal', title: 'You have 60 seconds.', text: 'Germs speed up as time runs out.'}
    ],
    levels: {easy: '3×3 pores · slower germs', medium: '4×3 pores · tough germs appear', hard: '4×4 pores · fast and crowded'},
    keys: KEY_ROWS,
    // Filled in when the Blender renders (Task 6) and the Kenney sounds (Task 7) are added.
    assets: {images: {}, sounds: {}},
    stars: STARS,
    roundSeconds: ROUND_SECONDS,
    settings: [],
    drawBackdrop,
    create
};
