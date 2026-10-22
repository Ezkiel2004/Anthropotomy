// Cell field: a decorative canvas of drifting cells behind the landing and sign-in
// pages. It aims to read as a microscope slide rather than a screensaver: every cell has
// an irregular organic outline, lit from the top left (a bright rim on that side, a soft
// shade on the other), an irregular nucleus with chromatin and a few organelles. Cells sit
// in loose clusters, not an even scatter; far ones are dim and soft, and a few very large,
// out-of-focus ones pass in front like bokeh. Tiny specks of debris drift behind them.
// The tint is mostly a pale cool white, with muted versions of the stage accents now and
// then. Cells drift with parallax depth, breathe, and part around the pointer.
//
// Markup: <body data-cell-field> puts one viewport-fixed field behind the whole
// page; any other element (position:relative, isolation:isolate, overflow:hidden)
// gets one covering just that element. Options go in the attribute as JSON, e.g.
// data-cell-field='{"count":24}'; see cellField().
// The canvas is prepended at z-index:-1, behind the page's own content, so anything
// with an opaque background covers it. It only animates while the host is on screen
// and the tab is visible; with reduced motion it draws one still frame.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const MIN_COUNT = 6;
const MAX_COUNT = 120;
const SMALL_VIEWPORT_WIDTH = 640;
const SMALL_VIEWPORT_RATIO = 0.6;

// Tints in sRGB: pale cool white, light blue, then muted teal, coral and amber from the
// stage accents. TINT_PICK lists tint indexes with repeats, so the pale ones dominate.
const TINTS = [[184, 208, 236], [146, 188, 238], [104, 196, 180], [226, 148, 146], [226, 198, 140]];
const TINT_PICK = [0, 0, 0, 0, 1, 1, 2, 3, 4];
const SHAPES = 3; // Outline variants painted per tint.

// Sprite geometry as fractions of the sprite's half-width.
const SPRITE_PX = 224;
const BODY = 0.62;
const SOFT_BLUR_PX = 5; // Far cells: a shallow depth of field.
const BOKEH_BLUR_PX = 12; // Foreground cells: far out of focus.
const SOFT_DEPTH = 0.3;

// Depth shaping: `random ** DEPTH_BIAS` skews the pool towards small, far, dim cells.
const DEPTH_BIAS = 1.7;
const FAR_SIZE = 0.3;
const NEAR_SIZE = 1.15;
const SIZE_JITTER = 0.45;
const FAR_ALPHA = 0.2;
const NEAR_ALPHA = 0.8;
const BOKEH_COUNT = 2;
const BOKEH_SIZE = 3.4; // Times the cell size.
const BOKEH_ALPHA = 0.11;

// Clusters: most cells are placed around a few loose centres, the rest anywhere.
const CLUSTERS = 4;
const CLUSTERED = 0.65;

// Debris: specks far behind the cells.
const SPECK_COUNT = 70;

// Ambient motion. Nearer cells drift faster: the parallax that sells the depth.
const DRIFT_SPEED = 7;
const FAR_DRIFT = 0.25;
const SWAY_SPEED = 3;
const SWAY_RATE = 0.3;
const BREATHE = 0.04;
const BREATHE_RATE = 0.8;
const RATE_SPREAD = 0.6;
const MAX_SPIN = 0.035;

// Pointer: cells inside the reach are pushed straight away, harder the closer they
// are, then the drag lets them settle back into the drift.
const POINTER_RANGE = 170;
const POINTER_PUSH = 1400;
const FAR_PUSH = 0.45;
const MAX_SPEED = 420;
const MAX_DELTA = 0.05;
const REFERENCE_FPS = 60;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, amount) => from + (to - from) * amount;
// Wraps with a margin, so a cell leaves the edge whole before it reappears opposite.
const wrap = (value, size, margin) => (value < -margin ? value + size + margin * 2 : value > size + margin ? value - size - margin * 2 : value);
const pick = list => list[Math.floor(Math.random() * list.length)];
// Normal-distributed random, for the clusters.
const gaussian = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random());

// A small seeded generator, so each sprite's outline is the same on every visit.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An irregular closed outline: a circle whose radius is wobbled by a few harmonics,
// squashed along one axis and tilted.
function blob(cx, cy, radius, harmonics, rng, squash, tilt) {
  const phases = harmonics.map(() => rng() * TAU);
  const path = new Path2D();
  const steps = 90;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * TAU;
    let r = 1;
    harmonics.forEach(([k, amount], j) => { r += amount * Math.cos(k * t + phases[j]); });
    const ex = Math.cos(t) * radius * r * squash;
    const ey = (Math.sin(t) * radius * r) / squash;
    const x = cx + ex * cos - ey * sin;
    const y = cy + ex * sin + ey * cos;
    if (s) path.lineTo(x, y); else path.moveTo(x, y);
  }
  path.closePath();
  return path;
}

function paintCell(tint, seed) {
  const rng = seeded(seed);
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE_PX;
  const context = sprite.getContext('2d');
  const lift = tint.map(v => Math.round(v + (255 - v) * 0.6));
  const deep = tint.map(v => Math.round(v * 0.35));
  const rgba = (colour, alpha) => `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;
  const center = SPRITE_PX / 2;
  const radius = center * BODY;

  const body = blob(center, center, radius, [[2, 0.055], [3, 0.045], [4, 0.03], [5, 0.02]], rng, 0.88 + rng() * 0.2, rng() * TAU);
  const nucleusX = center + radius * 0.16;
  const nucleusY = center - radius * 0.1;
  const nucleusR = radius * 0.36;

  // Clear in the middle and denser towards the membrane, as a cell looks under a microscope.
  const fill = context.createRadialGradient(center + radius * 0.15, center + radius * 0.2, radius * 0.1, center, center, radius * 1.15);
  fill.addColorStop(0, rgba(tint, 0.05));
  fill.addColorStop(0.6, rgba(tint, 0.1));
  fill.addColorStop(1, rgba(tint, 0.24));
  context.fillStyle = fill;
  context.fill(body);

  // Light from the top left: a soft sheen there, a soft shade opposite, and organelles between.
  context.save();
  context.clip(body);
  const sheen = context.createRadialGradient(center - radius * 0.5, center - radius * 0.55, 0, center - radius * 0.5, center - radius * 0.55, radius * 0.95);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = sheen;
  context.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  const shade = context.createRadialGradient(center + radius * 0.65, center + radius * 0.7, 0, center + radius * 0.65, center + radius * 0.7, radius * 0.9);
  shade.addColorStop(0, rgba(deep, 0.22));
  shade.addColorStop(1, rgba(deep, 0));
  context.fillStyle = shade;
  context.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  for (let n = 0; n < 7; n++) {
    const angle = rng() * TAU;
    const distance = radius * (0.28 + rng() * 0.46);
    const x = center + Math.cos(angle) * distance;
    const y = center + Math.sin(angle) * distance;
    if (Math.hypot(x - nucleusX, y - nucleusY) < nucleusR * 1.35) continue;
    const length = radius * (0.05 + rng() * 0.05);
    context.beginPath();
    context.ellipse(x, y, length, length * 0.5, rng() * TAU, 0, TAU);
    context.fillStyle = rgba(tint, 0.26 + rng() * 0.12);
    context.fill();
  }
  context.restore();

  // The membrane is brightest where the light hits it and fades away from it.
  const rim = context.createLinearGradient(center - radius, center - radius, center + radius, center + radius);
  rim.addColorStop(0, rgba(lift, 0.85));
  rim.addColorStop(0.45, rgba(tint, 0.5));
  rim.addColorStop(1, rgba(tint, 0.16));
  context.lineWidth = SPRITE_PX * 0.012;
  context.strokeStyle = rim;
  context.stroke(body);

  // An irregular nucleus, with chromatin specks and a brighter nucleolus.
  const nucleus = blob(nucleusX, nucleusY, nucleusR, [[2, 0.08], [3, 0.06], [4, 0.035]], rng, 0.9 + rng() * 0.15, rng() * TAU);
  const nucleusFill = context.createRadialGradient(nucleusX - nucleusR * 0.3, nucleusY - nucleusR * 0.3, 0, nucleusX, nucleusY, nucleusR * 1.1);
  nucleusFill.addColorStop(0, rgba(lift, 0.36));
  nucleusFill.addColorStop(1, rgba(tint, 0.2));
  context.fillStyle = nucleusFill;
  context.fill(nucleus);
  context.lineWidth = SPRITE_PX * 0.009;
  context.strokeStyle = rgba(tint, 0.5);
  context.stroke(nucleus);
  for (let n = 0; n < 9; n++) {
    const angle = rng() * TAU;
    const distance = nucleusR * 0.75 * Math.sqrt(rng());
    context.beginPath();
    context.arc(nucleusX + Math.cos(angle) * distance, nucleusY + Math.sin(angle) * distance, SPRITE_PX * (0.004 + rng() * 0.004), 0, TAU);
    context.fillStyle = rgba(lift, 0.55);
    context.fill();
  }
  context.beginPath();
  context.arc(nucleusX + nucleusR * 0.12, nucleusY - nucleusR * 0.06, nucleusR * 0.26, 0, TAU);
  context.fillStyle = rgba(lift, 0.7);
  context.fill();
  return sprite;
}

// The sprite redrawn through a blur filter. Browsers without canvas filters get
// the sharp sprite back, which only loses the depth-of-field touch.
function blurSprite(sprite, pixels) {
  const blurred = document.createElement('canvas');
  blurred.width = blurred.height = SPRITE_PX;
  const context = blurred.getContext('2d');
  if (!('filter' in context)) return sprite;
  context.filter = `blur(${pixels}px)`;
  context.drawImage(sprite, 0, 0);
  return blurred;
}

export function cellField(host, {
  count = 26, // Cells, bokeh included; 60% of this below 640px wide.
  cellSize = 27, // Body radius in CSS pixels of the nearest sharp cells, before jitter.
  drag = 0.04, // Velocity damping per frame, 0 (frictionless) to 1 (frozen).
  push = 1, // Strength of the pointer's push.
  speed = 1, // Ambient drift multiplier.
} = {}) {
  count = clamp(Math.round(count), MIN_COUNT, MAX_COUNT);
  cellSize = Math.max(cellSize, 4);
  drag = clamp(drag, 0, 1);
  push = Math.max(push, 0);
  speed = Math.max(speed, 0);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:${host === document.body ? 'fixed' : 'absolute'};inset:0;z-index:-1;width:100%;height:100%;pointer-events:none`;
  host.prepend(canvas);

  const sharp = [];
  TINTS.forEach((tint, t) => { for (let s = 0; s < SHAPES; s++) sharp.push(paintCell(tint, t * 31 + s * 7 + 13)); });
  const soft = sharp.map(sprite => blurSprite(sprite, SOFT_BLUR_PX));
  const bokeh = sharp.map(sprite => blurSprite(sprite, BOKEH_BLUR_PX));

  const posX = new Float32Array(count);
  const posY = new Float32Array(count);
  const velX = new Float32Array(count);
  const velY = new Float32Array(count);
  const driftX = new Float32Array(count);
  const driftY = new Float32Array(count);
  const depth = new Float32Array(count);
  const radius = new Float32Array(count);
  const phase = new Float32Array(count);
  const rate = new Float32Array(count);
  const angle = new Float32Array(count);
  const spin = new Float32Array(count);
  const variant = new Uint8Array(count);
  const kind = new Uint8Array(count); // 0 far and soft, 1 sharp, 2 foreground bokeh.
  for (let i = 0; i < count; i++) {
    const isBokeh = i < BOKEH_COUNT;
    const z = isBokeh ? 1 : Math.random() ** DEPTH_BIAS * 0.96;
    depth[i] = z;
    kind[i] = isBokeh ? 2 : z < SOFT_DEPTH ? 0 : 1;
    radius[i] = isBokeh
      ? cellSize * BOKEH_SIZE * (0.8 + Math.random() * 0.5)
      : cellSize * mix(FAR_SIZE, NEAR_SIZE, z) * (1 + (Math.random() - 0.5) * SIZE_JITTER);
    phase[i] = Math.random() * TAU;
    rate[i] = 1 + (Math.random() - 0.5) * RATE_SPREAD;
    angle[i] = Math.random() * TAU;
    spin[i] = (Math.random() - 0.5) * 2 * MAX_SPIN;
    variant[i] = pick(TINT_PICK) * SHAPES + Math.floor(Math.random() * SHAPES);
    const heading = Math.random() * TAU;
    const slow = isBokeh ? 0.6 : 1;
    driftX[i] = Math.cos(heading) * DRIFT_SPEED * mix(FAR_DRIFT, 1, z) * slow;
    driftY[i] = Math.sin(heading) * DRIFT_SPEED * mix(FAR_DRIFT, 1, z) * slow;
  }
  // Painted far to near, so near cells pass in front of far ones.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => depth[a] - depth[b]);

  // Debris specks: far behind, slow, never pushed.
  const speckX = new Float32Array(SPECK_COUNT);
  const speckY = new Float32Array(SPECK_COUNT);
  const speckR = new Float32Array(SPECK_COUNT);
  const speckZ = new Float32Array(SPECK_COUNT);
  const speckVX = new Float32Array(SPECK_COUNT);
  const speckVY = new Float32Array(SPECK_COUNT);
  for (let i = 0; i < SPECK_COUNT; i++) {
    speckR[i] = 0.5 + Math.random() * 1;
    speckZ[i] = Math.random();
    const heading = Math.random() * TAU;
    speckVX[i] = Math.cos(heading) * 3 * (0.3 + speckZ[i]);
    speckVY[i] = Math.sin(heading) * 3 * (0.3 + speckZ[i]);
  }

  const startedAt = performance.now();
  let width = 1;
  let height = 1;
  let dpr = 1;
  let activeCount = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let lastFrameAt = startedAt;
  let frame = 0;
  let running = false;

  // Starting places: most cells gather around a few loose centres.
  const place = () => {
    const centres = Array.from({ length: CLUSTERS }, () => [Math.random() * width, Math.random() * height]);
    const spread = Math.min(width, height) * 0.14 + 40;
    for (let i = 0; i < activeCount; i++) {
      if (kind[i] !== 2 && Math.random() < CLUSTERED) {
        const [cx, cy] = pick(centres);
        posX[i] = cx + gaussian() * spread;
        posY[i] = cy + gaussian() * spread;
      } else {
        posX[i] = Math.random() * width;
        posY[i] = Math.random() * height;
      }
      velX[i] = velY[i] = 0;
    }
    for (let i = 0; i < SPECK_COUNT; i++) {
      speckX[i] = Math.random() * width;
      speckY[i] = Math.random() * height;
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = Math.max(1, rect.width) / width;
    const scaleY = Math.max(1, rect.height) / height;
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const next = width < SMALL_VIEWPORT_WIDTH ? Math.max(MIN_COUNT, Math.round(count * SMALL_VIEWPORT_RATIO)) : count;
    if (next !== activeCount) {
      activeCount = next;
      place();
      return;
    }
    for (let i = 0; i < activeCount; i++) {
      posX[i] *= scaleX;
      posY[i] *= scaleY;
    }
    for (let i = 0; i < SPECK_COUNT; i++) {
      speckX[i] *= scaleX;
      speckY[i] *= scaleY;
    }
  };

  const step = delta => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const damping = (1 - drag) ** (delta * REFERENCE_FPS);
    for (let i = 0; i < activeCount; i++) {
      const z = depth[i];
      let ax = 0;
      let ay = 0;
      if (pointerActive && kind[i] !== 2) {
        const reach = POINTER_RANGE + radius[i];
        const dx = posX[i] - pointerX;
        const dy = posY[i] - pointerY;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance < reach) {
          const strength = POINTER_PUSH * push * mix(FAR_PUSH, 1, z) * (1 - distance / reach) ** 2;
          ax = (dx / distance) * strength;
          ay = (dy / distance) * strength;
        }
      }
      let vx = (velX[i] + ax * delta) * damping;
      let vy = (velY[i] + ay * delta) * damping;
      const speedSq = vx * vx + vy * vy;
      if (speedSq > MAX_SPEED * MAX_SPEED) {
        const scale = MAX_SPEED / Math.sqrt(speedSq);
        vx *= scale;
        vy *= scale;
      }
      velX[i] = vx;
      velY[i] = vy;
      // Drift and sway sit outside the damped velocity, so a pushed cell bleeds off
      // its momentum and settles back into the calm parallax layer. Sway runs across
      // the drift; dividing the drift by DRIFT_SPEED carries its depth scaling over.
      const sway = Math.sin(elapsed * SWAY_RATE * rate[i] + phase[i]) * SWAY_SPEED;
      const margin = radius[i] / BODY;
      posX[i] = wrap(posX[i] + (vx + (driftX[i] - driftY[i] / DRIFT_SPEED * sway) * speed) * delta, width, margin);
      posY[i] = wrap(posY[i] + (vy + (driftY[i] + driftX[i] / DRIFT_SPEED * sway) * speed) * delta, height, margin);
      angle[i] += spin[i] * speed * delta;
    }
    for (let i = 0; i < SPECK_COUNT; i++) {
      speckX[i] = wrap(speckX[i] + speckVX[i] * speed * delta, width, 4);
      speckY[i] = wrap(speckY[i] + speckVY[i] * speed * delta, height, 4);
    }
  };

  // Each cell breathes on its own phase and rate: it squashes along one axis while
  // stretching along the other. Still frames freeze every cell at rest.
  const draw = () => {
    const still = reducedMotion.matches;
    const elapsed = (performance.now() - startedAt) / 1000;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < SPECK_COUNT; i++) {
      context.globalAlpha = 0.06 + speckZ[i] * 0.2;
      context.fillStyle = '#c4d6ee';
      context.beginPath();
      context.arc(speckX[i], speckY[i], speckR[i], 0, TAU);
      context.fill();
    }
    for (const i of order) {
      if (i >= activeCount) continue;
      const z = depth[i];
      const breathe = still ? 0 : BREATHE * Math.sin(elapsed * BREATHE_RATE * rate[i] + phase[i]);
      const half = radius[i] / BODY;
      const cos = Math.cos(angle[i]);
      const sin = Math.sin(angle[i]);
      const sx = 1 + breathe;
      const sy = 1 - breathe;
      context.setTransform(dpr * cos * sx, dpr * sin * sx, -dpr * sin * sy, dpr * cos * sy, dpr * posX[i], dpr * posY[i]);
      context.globalAlpha = kind[i] === 2 ? BOKEH_ALPHA : kind[i] === 0 ? mix(FAR_ALPHA, NEAR_ALPHA * 0.45, z / SOFT_DEPTH) : mix(NEAR_ALPHA * 0.45, NEAR_ALPHA, (z - SOFT_DEPTH) / (1 - SOFT_DEPTH));
      context.drawImage((kind[i] === 2 ? bokeh : kind[i] === 0 ? soft : sharp)[variant[i]], -half, -half, half * 2, half * 2);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
  };

  const tick = () => {
    const now = performance.now();
    step(Math.min((now - lastFrameAt) / 1000, MAX_DELTA));
    lastFrameAt = now;
    draw();
    frame = requestAnimationFrame(tick);
  };

  let onScreen = true;
  const sync = () => {
    const run = onScreen && document.visibilityState === 'visible' && !reducedMotion.matches;
    if (run === running) return;
    running = run;
    if (run) {
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      draw();
    }
  };

  resize();
  draw();
  sync();
  new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
  new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; sync(); }).observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);

  // Pointer events on the window: the page's content sits over the canvas, so the
  // canvas itself never gets them. A dragged finger pushes cells as well as a mouse.
  window.addEventListener('pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    pointerX = event.clientX - rect.left;
    pointerY = event.clientY - rect.top;
    pointerActive = pointerX >= 0 && pointerY >= 0 && pointerX <= rect.width && pointerY <= rect.height;
  }, { passive: true });
  const release = () => { pointerActive = false; };
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) release(); });
  window.addEventListener('pointercancel', release);
}

// Budge: decorations marked data-budge (the floating models) are knocked away
// from the pointer while it is over them, then spring back through their CSS
// transition on translate and rotate. They keep pointer-events:none, so the hit
// test uses each one's layout box, which ignores the budge and float animation.
const BUDGE_PX = 26;
const BUDGE_TILT = 0.35; // Degrees of tilt per pixel of sideways push.

export function budge(elements) {
  window.addEventListener('pointermove', event => {
    if (reducedMotion.matches) return;
    const pushes = elements.map(element => {
      const parent = element.offsetParent;
      if (!parent) return null; // Hidden, e.g. the hero's floats on phones.
      const box = parent.getBoundingClientRect();
      const radius = element.offsetWidth / 2;
      const dx = box.left + element.offsetLeft + radius - event.clientX;
      const dy = box.top + element.offsetTop + element.offsetHeight / 2 - event.clientY;
      const distance = Math.hypot(dx, dy) || 1;
      const push = Math.max(0, 1 - distance / radius) * BUDGE_PX;
      return [(dx / distance) * push, (dy / distance) * push];
    });
    elements.forEach((element, i) => {
      const [x, y] = pushes[i] || [0, 0];
      element.style.translate = x || y ? `${x}px ${y}px` : '';
      element.style.rotate = x ? `${x * BUDGE_TILT}deg` : '';
    });
  }, { passive: true });
  document.addEventListener('pointerout', event => {
    if (!event.relatedTarget) elements.forEach(element => { element.style.translate = element.style.rotate = ''; });
  });
}

document.querySelectorAll('[data-cell-field]').forEach(host => cellField(host, JSON.parse(host.dataset.cellField || '{}')));
const budgers = [...document.querySelectorAll('[data-budge]')];
if (budgers.length) budge(budgers);
