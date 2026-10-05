// Live 3D upgrade for the landing hero. landing.js imports this only when the
// device can afford it. It reuses the vendored Three.js build; on any failure the
// static poster simply stays, with no message, because the hero is already finished.
//
// The model is the same project-relative file the anatomy explorer uses for the
// skeletal system. It is one combined mesh, so it is only rotated here: no parts
// are selected or labelled.
const MODEL_URL = new URL('../../system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb', import.meta.url).href;

const VENDOR_SCRIPTS = ['three.min.js', 'OrbitControls.js', 'GLTFLoader.js']
  .map(name => new URL(`../vendor/three/${name}`, import.meta.url).href);
const LOADING_LABEL_DELAY_MS = 300;
const LOAD_TIMEOUT_MS = 20000;
const ICONS = 'assets/icons/interface.svg?v=20261005-landing1';

const cssColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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

// An X-ray look: surfaces facing the camera are faint, edges glow in --color-glow.
const VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }`;
const FRAGMENT_SHADER = `
  uniform vec3 glow;
  uniform vec3 core;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 2.0);
    vec3 color = mix(glow * 0.22, mix(glow, core, 0.45), rim);
    gl_FragColor = vec4(color, 0.16 + rim * 0.7);
  }`;

function createView(container, model, canvasLabelledBy) {
  const THREE = window.THREE;
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive 3D model of a human skeleton. Drag sideways, or use the left and right arrow keys, to rotate it.');
  canvas.setAttribute('aria-describedby', canvasLabelledBy);
  container.querySelector('picture').after(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(cssColor('--color-ink')), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      glow: { value: new THREE.Color(cssColor('--color-glow')) },
      core: { value: new THREE.Color(cssColor('--color-text-on-dark')) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // Replace the model's own materials with the X-ray material and free the originals.
  model.traverse(child => {
    if (!child.isMesh) return;
    for (const original of Array.isArray(child.material) ? child.material : [child.material]) {
      for (const value of Object.values(original || {})) if (value?.isTexture) value.dispose();
      original?.dispose?.();
    }
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    child.material = material;
  });

  // Centre the model, stand it upright and scale it to a height of 2 units.
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  if (size.z > size.y * 1.2) { model.rotation.x = -Math.PI / 2; box = new THREE.Box3().setFromObject(model); size = box.getSize(new THREE.Vector3()); }
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.scale.setScalar(2 / Math.max(size.y, 1e-6));
  scene.add(pivot);
  camera.position.set(0, 0, 1.06 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  // Mouse and pen use OrbitControls (rotate only; the wheel keeps scrolling the page).
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.minPolarAngle = Math.PI / 2 - 0.25;
  controls.maxPolarAngle = Math.PI / 2 + 0.25;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1;

  // Touch: OrbitControls would cancel page scrolling, so it stands aside and a
  // horizontal drag turns the model instead. With touch-action: pan-y the browser
  // keeps vertical swipes for scrolling.
  let touchId = null;
  let touchX = 0;
  const onPointerDown = event => {
    controls.enabled = event.pointerType !== 'touch';
    if (event.pointerType === 'touch') { touchId = event.pointerId; touchX = event.clientX; }
  };
  const onPointerMove = event => {
    if (event.pointerId !== touchId) return;
    pivot.rotation.y += (event.clientX - touchX) * 0.012;
    touchX = event.clientX;
  };
  const onPointerEnd = event => { if (event.pointerId === touchId) touchId = null; };
  const onKeyDown = event => {
    const step = { ArrowLeft: -0.2, ArrowRight: 0.2 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    pivot.rotation.y += step;
  };
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('keydown', onKeyDown);

  // Render only while the hero is on screen and the tab is visible.
  let frame = 0;
  let running = false;
  let onScreen = true;
  let resolveFirstFrame;
  const firstFrame = new Promise(resolve => { resolveFirstFrame = resolve; });
  const render = () => { controls.update(); renderer.render(scene, camera); resolveFirstFrame(); };
  const tick = () => { frame = requestAnimationFrame(tick); render(); };
  const start = () => { if (!running && onScreen && !document.hidden) { running = true; frame = requestAnimationFrame(tick); } };
  const stop = () => { running = false; cancelAnimationFrame(frame); };
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  const visibility = new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; onScreen ? start() : stop(); });
  visibility.observe(container);
  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running) render();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(container);
  resize();
  start();

  return {
    canvas,
    controls,
    firstFrame,
    dispose() {
      stop();
      visibility.disconnect();
      resizer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      model.traverse(child => { if (child.isMesh) child.geometry.dispose(); });
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export async function mountHero3d(plate, { wideViewport, reducedMotion }) {
  const container = plate.querySelector('.plate-media');
  const controlsBar = plate.querySelector('[data-hero-controls]');
  const loading = plate.querySelector('[data-hero-loading]');
  const pause = plate.querySelector('[data-hero-pause]');
  const hint = plate.querySelector('[data-hero-hint]');
  let view = null;

  const teardown = () => {
    view?.dispose();
    view = null;
    plate.classList.remove('is-live');
    controlsBar.hidden = true;
    loading.hidden = true;
    pause.hidden = true;
    hint.hidden = true;
    wideViewport.removeEventListener('change', onWidth);
    reducedMotion.removeEventListener('change', onMotion);
    window.removeEventListener('pagehide', teardown);
  };
  const onWidth = event => { if (!event.matches) teardown(); };
  const setRotating = rotating => {
    if (!view) return;
    view.controls.autoRotate = rotating;
    pause.setAttribute('aria-pressed', String(!rotating));
    pause.querySelector('span').textContent = rotating ? 'Pause rotation' : 'Resume rotation';
    pause.querySelector('use').setAttribute('href', `${ICONS}#${rotating ? 'pause' : 'play'}`);
  };
  const onMotion = event => { if (event.matches) setRotating(false); };
  wideViewport.addEventListener('change', onWidth);
  reducedMotion.addEventListener('change', onMotion);
  window.addEventListener('pagehide', teardown);

  controlsBar.hidden = false;
  const loadingTimer = setTimeout(() => { loading.hidden = false; }, LOADING_LABEL_DELAY_MS);
  try {
    if (!window.THREE?.GLTFLoader || !window.THREE?.OrbitControls) {
      for (const src of VENDOR_SCRIPTS) await loadScript(src);
    }
    const gltf = await withTimeout(new Promise((resolve, reject) => new window.THREE.GLTFLoader().load(MODEL_URL, resolve, undefined, reject)), LOAD_TIMEOUT_MS);
    if (!wideViewport.matches || reducedMotion.matches) throw new Error('The display changed while the model was loading');
    view = createView(container, gltf.scene, hint.id);
    view.canvas.addEventListener('webglcontextlost', teardown);
    await view.firstFrame;
    clearTimeout(loadingTimer);
    loading.hidden = true;
    plate.classList.add('is-live');
    // The hint overlays the plate, so showing it never moves the layout.
    hint.hidden = false;
    pause.hidden = false;
    pause.addEventListener('click', () => setRotating(!view.controls.autoRotate));
  } catch (error) {
    clearTimeout(loadingTimer);
    teardown();
    console.info('3D preview unavailable; the poster stays in place.', error?.message || error);
  }
}
