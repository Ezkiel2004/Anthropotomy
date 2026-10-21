// Cell field: a decorative canvas of drifting cells behind the landing and sign-in
// pages. Each cell is a translucent body with a membrane and an off-centre nucleus,
// tinted from the stage accents. Cells drift with parallax depth, slowly turn and
// squash as they go, and part around the pointer like cells pushed through fluid.
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

// The stage accents in sRGB: sky, teal, coral, purple and yellow.
const PALETTE = [[63, 184, 245], [44, 207, 154], [242, 84, 91], [139, 92, 246], [247, 201, 72]];

// Sprite geometry as fractions of the sprite's half-width. The membrane sits inside
// a faint halo; the nucleus is off centre, so turning a cell turns its nucleus too.
const SPRITE_PX = 160;
const MEMBRANE = 0.62;
const NUCLEUS = 0.24;
const NUCLEUS_X = 0.16;
const NUCLEUS_Y = -0.1;
const NUCLEOLUS = 0.06;
// Far cells use a blurred copy of the sprite: a shallow depth of field.
const SOFT_BLUR_PX = 7;
const SOFT_DEPTH = 0.35;

// Depth shaping: `random ** DEPTH_BIAS` skews the pool towards small, far, dim cells.
const DEPTH_BIAS = 1.5;
const FAR_SIZE = 0.35;
const NEAR_SIZE = 1.25;
const FAR_ALPHA = 0.2;
const NEAR_ALPHA = 0.72;
const SIZE_JITTER = 0.4;

// Ambient motion. Nearer cells drift faster: the parallax that sells the depth.
const DRIFT_SPEED = 11;
const FAR_DRIFT = 0.25;
const SWAY_SPEED = 5;
const SWAY_RATE = 0.35;
const BREATHE = 0.05;
const BREATHE_RATE = 0.9;
const RATE_SPREAD = 0.6;
const MAX_SPIN = 0.14;

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

function paintSprite([r, g, b]) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE_PX;
  const context = sprite.getContext('2d');
  const rgba = alpha => `rgba(${r}, ${g}, ${b}, ${alpha})`;
  const center = SPRITE_PX / 2;
  const membrane = center * MEMBRANE;

  const halo = context.createRadialGradient(center, center, membrane * 0.9, center, center, center);
  halo.addColorStop(0, rgba(0.14));
  halo.addColorStop(1, rgba(0));
  context.fillStyle = halo;
  context.fillRect(0, 0, SPRITE_PX, SPRITE_PX);

  // Clear in the middle and denser towards the membrane, as a cell looks under a microscope.
  const body = context.createRadialGradient(center, center, 0, center, center, membrane);
  body.addColorStop(0, rgba(0.05));
  body.addColorStop(0.7, rgba(0.1));
  body.addColorStop(1, rgba(0.24));
  context.fillStyle = body;
  context.beginPath();
  context.arc(center, center, membrane, 0, TAU);
  context.fill();
  context.lineWidth = SPRITE_PX * 0.018;
  context.strokeStyle = rgba(0.7);
  context.stroke();

  const nucleusX = center + center * NUCLEUS_X;
  const nucleusY = center + center * NUCLEUS_Y;
  context.beginPath();
  context.arc(nucleusX, nucleusY, center * NUCLEUS, 0, TAU);
  context.fillStyle = rgba(0.3);
  context.fill();
  context.lineWidth = SPRITE_PX * 0.012;
  context.strokeStyle = rgba(0.6);
  context.stroke();
  context.beginPath();
  context.arc(nucleusX + center * 0.04, nucleusY - center * 0.03, center * NUCLEOLUS, 0, TAU);
  context.fillStyle = rgba(0.75);
  context.fill();
  return sprite;
}

// The sprite redrawn through a blur filter. Browsers without canvas filters get
// the sharp sprite back, which only loses the depth-of-field touch.
function softenSprite(sprite) {
  const soft = document.createElement('canvas');
  soft.width = soft.height = SPRITE_PX;
  const context = soft.getContext('2d');
  if (!('filter' in context)) return sprite;
  context.filter = `blur(${SOFT_BLUR_PX}px)`;
  context.drawImage(sprite, 0, 0);
  return soft;
}

export function cellField(host, {
  count = 34, // Cells; 60% of this below 640px wide.
  cellSize = 26, // Membrane radius in CSS pixels of the nearest cells, before jitter.
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

  const sharp = PALETTE.map(paintSprite);
  const soft = sharp.map(softenSprite);

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
  const hue = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const z = Math.random() ** DEPTH_BIAS;
    depth[i] = z;
    radius[i] = cellSize * mix(FAR_SIZE, NEAR_SIZE, z) * (1 + (Math.random() - 0.5) * SIZE_JITTER);
    phase[i] = Math.random() * TAU;
    rate[i] = 1 + (Math.random() - 0.5) * RATE_SPREAD;
    angle[i] = Math.random() * TAU;
    spin[i] = (Math.random() - 0.5) * 2 * MAX_SPIN;
    hue[i] = Math.floor(Math.random() * PALETTE.length);
    const heading = Math.random() * TAU;
    driftX[i] = Math.cos(heading) * DRIFT_SPEED * mix(FAR_DRIFT, 1, z);
    driftY[i] = Math.sin(heading) * DRIFT_SPEED * mix(FAR_DRIFT, 1, z);
  }
  // Painted far to near, so near cells pass in front of far ones.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => depth[a] - depth[b]);

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
      for (let i = 0; i < activeCount; i++) {
        posX[i] = Math.random() * width;
        posY[i] = Math.random() * height;
        velX[i] = velY[i] = 0;
      }
      return;
    }
    for (let i = 0; i < activeCount; i++) {
      posX[i] *= scaleX;
      posY[i] *= scaleY;
    }
  };

  const step = delta => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const damping = (1 - drag) ** (delta * REFERENCE_FPS);
    for (let i = 0; i < activeCount; i++) {
      const z = depth[i];
      let ax = 0;
      let ay = 0;
      if (pointerActive) {
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
      const margin = radius[i] / MEMBRANE;
      posX[i] = wrap(posX[i] + (vx + (driftX[i] - driftY[i] / DRIFT_SPEED * sway) * speed) * delta, width, margin);
      posY[i] = wrap(posY[i] + (vy + (driftY[i] + driftX[i] / DRIFT_SPEED * sway) * speed) * delta, height, margin);
      angle[i] += spin[i] * speed * delta;
    }
  };

  // Each cell breathes on its own phase and rate: it squashes along one axis while
  // stretching along the other. Still frames freeze every cell at rest.
  const draw = () => {
    const still = reducedMotion.matches;
    const elapsed = (performance.now() - startedAt) / 1000;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const i of order) {
      if (i >= activeCount) continue;
      const z = depth[i];
      const breathe = still ? 0 : BREATHE * Math.sin(elapsed * BREATHE_RATE * rate[i] + phase[i]);
      const half = radius[i] / MEMBRANE;
      const cos = Math.cos(angle[i]);
      const sin = Math.sin(angle[i]);
      const sx = 1 + breathe;
      const sy = 1 - breathe;
      context.setTransform(dpr * cos * sx, dpr * sin * sx, -dpr * sin * sy, dpr * cos * sy, dpr * posX[i], dpr * posY[i]);
      context.globalAlpha = mix(FAR_ALPHA, NEAR_ALPHA, z);
      context.drawImage((z < SOFT_DEPTH ? soft : sharp)[hue[i]], -half, -half, half * 2, half * 2);
    }
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
