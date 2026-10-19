// Gravity stars: a decorative canvas starfield. Stars drift with parallax depth,
// twinkle, link up with faint lines and fall into a gravity well around the
// pointer. Vanilla port of the gravity-stars React component.
//
// Markup: <body data-gravity-stars> puts one viewport-fixed starfield behind the
// whole page; any other element (position:relative, isolation:isolate,
// overflow:hidden) gets one covering just that element. Options go in the
// attribute as JSON, e.g. data-gravity-stars='{"count":120}'; see gravityStars().
// The canvas is prepended at z-index:-1, behind the page's own content, so
// anything with an opaque background covers it. It only animates while the host
// is on screen and the tab is visible; with reduced motion it draws one still frame.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const MAX_COUNT = 600;
const MIN_COUNT = 8;
const SMALL_VIEWPORT_WIDTH = 640;
const SMALL_VIEWPORT_RATIO = 0.6;

// Star colours in sRGB: a near-neutral base, oklch(0.93 0.004 265), and the cool
// oklch(0.92 0.028 255) and warm oklch(0.92 0.055 75) ends that `tint` spreads
// stars towards. Lightness is equal, so the spread reads as hue, not brightness.
const BASE = [232, 233, 238];
const COOL = [221, 233, 247];
const WARM = [243, 226, 194];

// Gravity well. Softening keeps the inverse square finite as the distance nears 0.
const POINTER_RANGE = 260;
const POINTER_ACCEL = 4_000_000;
const SOFTENING_SQ = 676;
const MAX_ACCEL = 5000;
const MAX_SPEED = 1200;
const SWIRL = 0.85;
const DRIFT_SPEED = 12;
const MAX_DELTA = 0.05;
const REFERENCE_FPS = 60;
const MIN_GRID_CELL = 24;
const MAX_LINKS_PER_STAR = 8;

// Depth shaping: `random ** DEPTH_BIAS` skews the pool towards small, far stars.
const DEPTH_BIAS = 1.7;
const NEAR_SIZE_GAIN = 1.9;
const FAR_SIZE_FLOOR = 0.42;
const NEAR_ALPHA_GAIN = 0.82;
const FAR_ALPHA_FLOOR = 0.18;
const NEAR_HALO_GAIN = 0.7;
const FAR_HALO_FLOOR = 0.6;
const NEAR_REACH_GAIN = 0.8;
const FAR_REACH_FLOOR = 0.6;
const NEAR_PULL_GAIN = 1;
const FAR_PULL_FLOOR = 0.35;
const MIN_VISIBLE_ALPHA = 0.01;

const LINE_LEVELS = 6;
const LINE_BASE_ALPHA = 0.3;
const LINE_MIN_WIDTH = 0.3;
const LINE_WIDTH_STEP = 0.12;
const LINE_CLOSENESS_CURVE = 1.5;
const LINE_DEPTH_FLOOR = 0.25;
const LINE_DEPTH_GAIN = 0.75;

const TWINKLE_RATE = 1.15;
const TWINKLE_RATE_SPREAD = 0.8;
const TWINKLE_DEPTH = 0.5;
const SIZE_JITTER = 0.5;

const SPRITE_PX = 128;
const SPRITE_LEVELS = 5;

// Half the neighbourhood as flat (dCol, dRow) pairs, so every pair of grid cells
// is compared exactly once.
const FORWARD_NEIGHBOURS = [1, 0, -1, 1, 0, 1, 1, 1];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, amount) => from + (to - from) * amount;
const wrap = (value, size) => (value < 0 ? value + size : value > size ? value - size : value);

// Any colour the canvas understands (hex, rgb(), oklch(), names) as [r, g, b].
function toRgb(css) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data.subarray(0, 3)];
}

// A hot core dissolving into a wide, faint halo. Built once per tint and blitted
// per star: far cheaper, and softer, than a path fill or shadowBlur per star.
function paintSprite([r, g, b]) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE_PX;
  const context = sprite.getContext('2d');
  const center = SPRITE_PX / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  for (const [stop, alpha] of [[0, 1], [0.06, 0.95], [0.14, 0.5], [0.28, 0.16], [0.55, 0.04], [1, 0]]) {
    gradient.addColorStop(stop, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return sprite;
}

export function gravityStars(host, {
  color, // Base star colour, any CSS colour except var(); defaults to BASE.
  connect = true, // Faint links between stars that are close together.
  connectDistance = 120, // Link distance in CSS pixels.
  count = 240, // Stars; 60% of this below 640px wide.
  drag = 0.03, // Velocity damping per frame, 0 (frictionless) to 1 (frozen).
  glow = 5.5, // Halo radius multiplier: 1 is a bare dot, 8 a bloom.
  gravity = 1, // Strength of the pointer gravity well.
  speed = 1, // Ambient drift multiplier.
  starSize = 1.5, // Base radius in CSS pixels, before depth.
  tint = 0.65, // Spread from the base colour towards blue-white and amber, 0 to 1.
  twinkle = 0.55, // Brightness oscillation, 0 (steady) to 1 (strong).
} = {}) {
  count = clamp(Math.round(count), MIN_COUNT, MAX_COUNT);
  connectDistance = Math.max(connectDistance, 1);
  drag = clamp(drag, 0, 1);
  glow = Math.max(glow, 1);
  gravity = Math.max(gravity, 0);
  speed = Math.max(speed, 0);
  starSize = Math.max(starSize, 0.2);
  tint = clamp(tint, 0, 1);
  twinkle = clamp(twinkle, 0, 1);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:${host === document.body ? 'fixed' : 'absolute'};inset:0;z-index:-1;width:100%;height:100%;pointer-events:none`;
  host.prepend(canvas);

  // One sprite per tint step, cool end to warm end. tint 0 collapses them all
  // onto the base colour.
  const base = color ? toRgb(color) : BASE;
  const sprites = Array.from({ length: SPRITE_LEVELS }, (_, level) => {
    const ramp = level / (SPRITE_LEVELS - 1);
    return paintSprite(base.map((channel, i) => Math.round(mix(channel, mix(COOL[i], WARM[i], ramp), tint))));
  });

  const posX = new Float32Array(count);
  const posY = new Float32Array(count);
  const velX = new Float32Array(count);
  const velY = new Float32Array(count);
  const driftX = new Float32Array(count);
  const driftY = new Float32Array(count);
  const depth = new Float32Array(count);
  const phase = new Float32Array(count);
  const rate = new Float32Array(count);
  const jitter = new Float32Array(count);
  const tintLevel = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const z = Math.random() ** DEPTH_BIAS;
    depth[i] = z;
    phase[i] = Math.random() * TAU;
    rate[i] = TWINKLE_RATE * (1 + (Math.random() - 0.5) * TWINKLE_RATE_SPREAD);
    jitter[i] = 1 + (Math.random() - 0.5) * SIZE_JITTER;
    // Averaging two draws weights the spread to the centre: most stars stay near
    // the neutral base and only a few reach the blue or amber ends.
    tintLevel[i] = Math.min(SPRITE_LEVELS - 1, Math.floor(((Math.random() + Math.random()) / 2) * SPRITE_LEVELS));
    // Nearer stars drift faster: the parallax that sells the depth.
    const angle = Math.random() * TAU;
    driftX[i] = Math.cos(angle) * DRIFT_SPEED * (0.15 + z);
    driftY[i] = Math.sin(angle) * DRIFT_SPEED * (0.15 + z);
  }

  const maxSegments = count * MAX_LINKS_PER_STAR;
  const segments = new Float32Array(maxSegments * 4);
  const segmentLevel = new Uint8Array(maxSegments);
  const cellItems = new Int32Array(count);
  let cellStart = new Int32Array(1);
  let cellCursor = new Int32Array(1);

  const startedAt = performance.now();
  let width = 1;
  let height = 1;
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
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    const damping = (1 - drag) ** (delta * REFERENCE_FPS);
    for (let i = 0; i < activeCount; i++) {
      let ax = 0;
      let ay = 0;
      if (pointerActive) {
        // Softened inverse square plus a tangential swirl: stars fall in, whip
        // round the pointer and fly back out. Near stars feel a wider, stronger well.
        const z = depth[i];
        const reach = POINTER_RANGE * (FAR_REACH_FLOOR + z * NEAR_REACH_GAIN);
        const dx = pointerX - posX[i];
        const dy = pointerY - posY[i];
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= reach * reach) {
          const softened = Math.sqrt(distanceSq + SOFTENING_SQ);
          const fade = 1 - Math.sqrt(distanceSq) / reach;
          const pull = FAR_PULL_FLOOR + z * NEAR_PULL_GAIN;
          const strength = Math.min((gravity * POINTER_ACCEL * pull) / (softened * softened), MAX_ACCEL) * fade * fade;
          const nx = dx / softened;
          const ny = dy / softened;
          ax = (nx - ny * SWIRL) * strength;
          ay = (ny + nx * SWIRL) * strength;
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
      // Drift sits outside the damped velocity, so a flung star bleeds off its
      // momentum and settles back into the calm parallax layer.
      posX[i] = wrap(posX[i] + (vx + driftX[i] * speed) * delta, width);
      posY[i] = wrap(posY[i] + (vy + driftY[i] * speed) * delta, height);
    }
  };

  // Counting sort into a grid of connectDistance cells, then test each star only
  // against its own and the forward neighbouring cells. Returns the link count.
  const buildLinks = () => {
    const cell = Math.max(connectDistance, MIN_GRID_CELL);
    const cols = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(height / cell));
    const total = cols * rows;
    if (cellStart.length < total + 1) {
      cellStart = new Int32Array(total + 1);
      cellCursor = new Int32Array(total + 1);
    }
    cellStart.fill(0, 0, total + 1);
    const cellOf = i => clamp(Math.floor(posY[i] / cell), 0, rows - 1) * cols + clamp(Math.floor(posX[i] / cell), 0, cols - 1);
    for (let i = 0; i < activeCount; i++) cellStart[cellOf(i) + 1]++;
    for (let c = 0; c < total; c++) {
      cellStart[c + 1] += cellStart[c];
      cellCursor[c] = cellStart[c];
    }
    for (let i = 0; i < activeCount; i++) cellItems[cellCursor[cellOf(i)]++] = i;

    const limit = connectDistance * connectDistance;
    let segmentTotal = 0;
    const consider = (a, b) => {
      if (segmentTotal >= maxSegments) return;
      const dx = posX[a] - posX[b];
      const dy = posY[a] - posY[b];
      const d2 = dx * dx + dy * dy;
      if (d2 > limit || d2 === 0) return;
      // Alpha falls off with distance and with how far back the ends sit, so the
      // links read as depth rather than a web of grey sticks.
      const closeness = (1 - Math.sqrt(d2) / connectDistance) ** LINE_CLOSENESS_CURVE;
      const depthWeight = LINE_DEPTH_FLOOR + ((depth[a] + depth[b]) / 2) * LINE_DEPTH_GAIN;
      const offset = segmentTotal * 4;
      segments[offset] = posX[a];
      segments[offset + 1] = posY[a];
      segments[offset + 2] = posX[b];
      segments[offset + 3] = posY[b];
      segmentLevel[segmentTotal++] = Math.min(LINE_LEVELS - 1, Math.floor(closeness * depthWeight * LINE_LEVELS));
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const end = cellStart[index + 1];
        for (let a = cellStart[index]; a < end; a++) {
          const i = cellItems[a];
          for (let b = a + 1; b < end; b++) consider(i, cellItems[b]);
          for (let n = 0; n < FORWARD_NEIGHBOURS.length; n += 2) {
            const nc = col + FORWARD_NEIGHBOURS[n];
            const nr = row + FORWARD_NEIGHBOURS[n + 1];
            if (nc < 0 || nc >= cols || nr >= rows) continue;
            const nIndex = nr * cols + nc;
            for (let b = cellStart[nIndex]; b < cellStart[nIndex + 1]; b++) consider(i, cellItems[b]);
          }
        }
      }
    }
    return segmentTotal;
  };

  // One path and stroke per alpha bucket: stroking each link alone would blow
  // the frame budget on its own.
  const drawLinks = segmentTotal => {
    const [r, g, b] = base;
    for (let level = 0; level < LINE_LEVELS; level++) {
      context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(LINE_BASE_ALPHA * (level + 1)) / LINE_LEVELS})`;
      context.lineWidth = LINE_MIN_WIDTH + level * LINE_WIDTH_STEP;
      context.beginPath();
      for (let s = 0; s < segmentTotal; s++) {
        if (segmentLevel[s] !== level) continue;
        const offset = s * 4;
        context.moveTo(segments[offset], segments[offset + 1]);
        context.lineTo(segments[offset + 2], segments[offset + 3]);
      }
      context.stroke();
    }
  };

  // Each star has its own twinkle phase and rate, so the field never pulses in
  // unison. Still frames freeze the wave at each star's starting phase.
  const drawStars = still => {
    const elapsed = (performance.now() - startedAt) / 1000;
    for (let i = 0; i < activeCount; i++) {
      const z = depth[i];
      const wave = Math.sin(still ? phase[i] : elapsed * rate[i] + phase[i]);
      const alpha = clamp((FAR_ALPHA_FLOOR + z * NEAR_ALPHA_GAIN) * (1 - twinkle * TWINKLE_DEPTH * (1 - wave)), 0, 1);
      if (alpha <= MIN_VISIBLE_ALPHA) continue;
      const halo = starSize * (FAR_SIZE_FLOOR + z * NEAR_SIZE_GAIN) * jitter[i] * glow * (FAR_HALO_FLOOR + z * NEAR_HALO_GAIN);
      context.globalAlpha = alpha;
      context.drawImage(sprites[tintLevel[i]], posX[i] - halo, posY[i] - halo, halo * 2, halo * 2);
    }
    context.globalAlpha = 1;
  };

  const draw = () => {
    const segmentTotal = connect ? buildLinks() : 0;
    context.clearRect(0, 0, width, height);
    if (segmentTotal) drawLinks(segmentTotal);
    drawStars(reducedMotion.matches);
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
  // canvas itself never gets them. The well follows a dragged finger as well as a mouse.
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

document.querySelectorAll('[data-gravity-stars]').forEach(host => gravityStars(host, JSON.parse(host.dataset.gravityStars || '{}')));
const budgers = [...document.querySelectorAll('[data-budge]')];
if (budgers.length) budge(budgers);
