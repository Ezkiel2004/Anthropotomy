// Live 3D for the hero's Skeletal card. landing.js imports this only on wide screens
// with WebGL that have not asked for less motion or data. The card's still render stays
// until the first 3D frame is drawn, and comes back on any failure with no message,
// because the card is already finished without it.
//
// The canvas sits inside the card's button, so it takes no input: clicks, keys and
// swipes stay with the deck. The skeleton turns slowly, and only while its card is at
// the front of the fan, the hero is on screen and the tab is visible.
//
// The model is the project-relative skeleton file, one combined mesh, drawn in a plain
// bone material under soft light to match the still render it replaces.
const MODEL_URL = new URL('../../system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb', import.meta.url).href;

const VENDOR_SCRIPTS = ['three.min.js', 'GLTFLoader.js']
  .map(name => new URL(`../vendor/three/${name}`, import.meta.url).href);
const LOAD_TIMEOUT_MS = 20000;

const BONE = 0xe2dccd;
const TURN_SPEED = 0.35; // Radians per second.
const START_ANGLE = -0.45; // A three-quarter view, as in the still render.
const MAX_DELTA = 0.1;

// Framing, in model units once the skeleton is scaled to a height of 2 (y from -1 to 1):
// like the still render, the skull at the top down to the top of the pelvis.
const FOV = 26;
const VIEW_TOP = 1.06;
const VIEW_BOTTOM = 0.06;
const CAMERA_LIFT = 0.2;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out loading the 3D model')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function createView(card, model) {
  const THREE = window.THREE;
  const canvas = document.createElement('canvas');
  canvas.className = 'hx-card-3d';
  canvas.setAttribute('aria-hidden', 'true');
  card.querySelector('.hx-card-art').after(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a70, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(2.5, 3, 2.5);
  scene.add(key);

  // Replace the model's own tinted material with plain bone and free the original.
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(BONE).convertSRGBToLinear(), roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  model.traverse(child => {
    if (!child.isMesh) return;
    for (const original of Array.isArray(child.material) ? child.material : [child.material]) original?.dispose?.();
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    child.material = material;
  });

  // Centre the model and scale it to a height of 2 units, standing it up if it lies along z.
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  if (size.z > size.y * 1.2) {
    model.rotation.x = -Math.PI / 2;
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3());
  }
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.scale.setScalar(2 / Math.max(size.y, 1e-6));
  pivot.rotation.y = START_ANGLE;
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  const centreY = (VIEW_TOP + VIEW_BOTTOM) / 2;
  const distance = (VIEW_TOP - VIEW_BOTTOM) / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  camera.position.set(0, centreY + CAMERA_LIFT, distance);
  camera.lookAt(0, centreY, 0);

  let frame = 0;
  let running = false;
  let onScreen = true;
  let lastFrameAt = 0;
  let resolveFirstFrame;
  const firstFrame = new Promise(resolve => { resolveFirstFrame = resolve; });
  const render = () => { renderer.render(scene, camera); resolveFirstFrame(); };
  const tick = now => {
    pivot.rotation.y += TURN_SPEED * Math.min(Math.max(now - lastFrameAt, 0) / 1000, MAX_DELTA);
    lastFrameAt = now;
    render();
    frame = requestAnimationFrame(tick);
  };
  const atFront = () => card.getAttribute('aria-current') === 'true';
  const sync = () => {
    const run = onScreen && !document.hidden && atFront();
    if (run === running) return;
    running = run;
    if (run) {
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', sync);
  const visibility = new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; sync(); });
  visibility.observe(card);
  // The deck marks the front card with aria-current; turning stops while another system is in front.
  const front = new MutationObserver(sync);
  front.observe(card, { attributes: true, attributeFilter: ['aria-current'] });
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running) render();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(canvas);
  resize();
  render();
  sync();

  return {
    canvas,
    firstFrame,
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      visibility.disconnect();
      front.disconnect();
      resizer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      model.traverse(child => { if (child.isMesh) child.geometry.dispose(); });
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export async function mountCard3d(card, { wideViewport, reducedMotion }) {
  let view = null;
  const teardown = () => {
    card.classList.remove('is-live');
    view?.dispose();
    view = null;
    wideViewport.removeEventListener('change', onChange);
    reducedMotion.removeEventListener('change', onChange);
    window.removeEventListener('pagehide', teardown);
  };
  const onChange = () => { if (!wideViewport.matches || reducedMotion.matches) teardown(); };
  wideViewport.addEventListener('change', onChange);
  reducedMotion.addEventListener('change', onChange);
  window.addEventListener('pagehide', teardown);

  try {
    if (!window.THREE?.GLTFLoader) {
      for (const src of VENDOR_SCRIPTS) await loadScript(src);
    }
    const gltf = await withTimeout(new Promise((resolve, reject) => new window.THREE.GLTFLoader().load(MODEL_URL, resolve, undefined, reject)), LOAD_TIMEOUT_MS);
    if (!wideViewport.matches || reducedMotion.matches) throw new Error('The display changed while the model was loading');
    view = createView(card, gltf.scene);
    view.canvas.addEventListener('webglcontextlost', teardown);
    await view.firstFrame;
    card.classList.add('is-live');
  } catch (error) {
    teardown();
    console.info('3D card unavailable; the still render stays in place.', error?.message || error);
  }
}
