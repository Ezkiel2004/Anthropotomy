// Shared 3D scene for the landing page. The live demo (landing-hero-3d.js) and the build-time renders
// (landing-src/render/render.html) both use it, so the poster, the gallery images and the demo match.
//
// It reuses the explorer's engine pieces without starting the explorer: the vendored Three.js r128
// scripts, AnatomyLayersCore, AnatomyViewer.applySystemLooks and AnatomyViewer.studioEnvironment. The
// explorer's viewer itself is not used because it captures the mouse wheel and blocks touch scrolling.

// Our own scripts carry the version this module was imported with. Three.js, the Draco decoder and the
// layer models use the same URLs as the explorer, so the browser cache serves them to both pages.
const version = new URL(import.meta.url).search;
const own = path => new URL(path + version, import.meta.url).href;
const shared = path => new URL(path, import.meta.url).href;

// AnatomyLayersCore and AnatomyViewer are top-level consts in classic scripts: global bindings but not
// window properties, so they are checked with typeof. Each check lets a page that already has the
// script skip it (loading model-viewer.js twice would throw).
const ENGINE = [
    [shared('../vendor/three/three.min.js'), () => typeof THREE !== 'undefined'],
    [shared('../vendor/three/OrbitControls.js'), () => Boolean(window.THREE?.OrbitControls)],
    [shared('../vendor/three/GLTFLoader.js'), () => Boolean(window.THREE?.GLTFLoader)],
    [shared('../vendor/three/DRACOLoader.js'), () => Boolean(window.THREE?.DRACOLoader)],
    [own('./anatomy-layers-core.js'), () => typeof AnatomyLayersCore !== 'undefined'],
    [own('./model-viewer.js'), () => typeof AnatomyViewer !== 'undefined'],
];
const DRACO_PATH = shared('../vendor/three/draco/');
const layerUrl = id => shared(`../../system_model/layers/${encodeURIComponent(id)}.glb`);

// The explorer viewer's navy, used behind every render so images, poster and canvas are seamless.
export const SURFACE = '#101C2E';

// Front three-quarter view: turned towards the body's left side, slightly above, with a long lens so
// the tall figure is not distorted.
export const VIEW = {azimuth: 30 * Math.PI / 180, elevation: 6 * Math.PI / 180, fov: 30};

// Free space kept around the body in the demo and its poster: the toggles sit at the top left and the
// part card at the bottom.
export const DEMO_FRAME = {top: 0.06, bottom: 0.14, side: 0.06};

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}`)); };
        document.head.append(script);
    });
}

let engine = null;
export function loadEngine() {
    engine ??= (async () => {
        for (const [src, ready] of ENGINE) if (!ready()) await loadScript(src);
        return window.THREE;
    })().catch(error => { engine = null; throw error; });
    return engine;
}

// Frees geometry, materials (including tinted copies kept in userData) and their textures.
export function disposeObject(root) {
    const materials = new Set();
    root.traverse(node => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        for (const material of [node.material, node.userData.baseMaterial, node.userData.tintMaterial].flat()) if (material) materials.add(material);
    });
    for (const material of materials) {
        for (const value of Object.values(material)) if (value && value.isTexture) value.dispose();
        material.dispose();
    }
}

// Renderer, lights and camera matching the explorer: sRGB output, ACES filmic tone mapping at exposure
// 0.6, the explorer's studio environment, hemisphere and key lights. Call after loadEngine().
export function createStage(canvas, {background = SURFACE, pixelRatio, preserveDrawingBuffer = false} = {}) {
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer});
    renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    // studioEnvironment only reads this.renderer, so it runs without initialising AnatomyViewer.
    scene.environment = AnatomyViewer.studioEnvironment.call({renderer});
    scene.add(new THREE.HemisphereLight(0xffffff, 0x536077, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(4, 8, 6);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.01, 100);
    const body = new THREE.Group();
    scene.add(body);

    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    const raycaster = new THREE.Raycaster();

    const stage = {
        THREE, canvas, renderer, scene, camera, body, loader,
        target: new THREE.Vector3(), lensShift: 0, extraShift: 0, disposed: false,
        render() { renderer.render(scene, camera); },
        setSize(width, height) {
            renderer.setSize(width, height, false);
            camera.aspect = width / Math.max(height, 1);
            stage.applyLens();
        },
        // Moves the picture up by a fraction of its height without moving the camera, so the framing
        // can leave more room at the bottom than at the top. setViewOffset also sets the aspect.
        applyLens() {
            const shift = stage.lensShift + stage.extraShift;
            if (shift) camera.setViewOffset(camera.aspect, 1, 0, shift, camera.aspect, 1);
            else camera.clearViewOffset(); // both update the projection matrix
        },
        setExtraShift(fraction) { stage.extraShift = fraction; stage.applyLens(); },
        visibleRoots() { return body.children.filter(root => root.visible); },
        // The part under a viewport point, resolved the way the explorer does it.
        pick(clientX, clientY) {
            const roots = stage.visibleRoots();
            if (!roots.length) return null;
            const rect = canvas.getBoundingClientRect();
            const point = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
            camera.updateMatrixWorld();
            raycaster.setFromCamera(point, camera);
            return AnatomyLayersCore.pickPart(raycaster.intersectObjects(roots, true));
        },
        dispose() {
            if (stage.disposed) return;
            stage.disposed = true;
            for (const root of [...body.children]) { body.remove(root); disposeObject(root); }
            scene.environment?.dispose();
            draco.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
    return stage;
}

// Loads system_model/layers/<id>.glb and gives it the explorer's tissue colours. The caller decides
// when to add it to stage.body. onProgress receives a fraction from 0 to 1 when the size is known.
export function loadLayer(stage, id, {onProgress} = {}) {
    return new Promise((resolve, reject) => {
        stage.loader.load(layerUrl(id), gltf => resolve(gltf.scene), event => {
            if (onProgress && event.lengthComputable && event.total) onProgress(event.loaded / event.total);
        }, reject);
    }).then(root => {
        if (stage.disposed) { disposeObject(root); throw new DOMException('The 3D view was closed', 'AbortError'); }
        AnatomyViewer.applySystemLooks(root, id);
        root.traverse(node => {
            if (node.isMesh) node.userData.baseMaterial = node.material;
            node.updateMatrix();
            node.matrixAutoUpdate = false; // the anatomy never moves
        });
        root.userData.layerId = id;
        root.updateMatrixWorld(true);
        return root;
    });
}

// Bounding box of an object, grown around its centre to at least the given size, so a small organ
// system is not blown up to fill the frame.
export function boxOf(stage, object, minSize) {
    const {THREE} = stage;
    const box = new THREE.Box3().setFromObject(object);
    if (minSize) {
        const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        box.setFromCenterAndSize(center, size.max(minSize));
    }
    return box;
}

// Points the camera at the box from the standard view and fits the box exactly, keeping the given
// fractions of the frame free at the top, bottom and sides. The frame's aspect must already be set.
export function frame(stage, box, {top = 0.06, bottom = 0.06, side = 0.06} = {}) {
    const {THREE, camera} = stage;
    const center = box.getCenter(new THREE.Vector3());
    const back = new THREE.Vector3(Math.sin(VIEW.azimuth) * Math.cos(VIEW.elevation), Math.sin(VIEW.elevation), Math.cos(VIEW.azimuth) * Math.cos(VIEW.elevation));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    const tanV = Math.tan(VIEW.fov * Math.PI / 360);
    const tanTop = tanV * (1 - top - bottom), tanSide = tanV * camera.aspect * (1 - 2 * side);
    let distance = 0;
    for (let i = 0; i < 8; i++) {
        const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
        const depth = corner.dot(back);
        distance = Math.max(distance, depth + Math.abs(corner.dot(up)) / tanTop, depth + Math.abs(corner.dot(right)) / tanSide);
    }
    stage.target.copy(center);
    camera.position.copy(center).addScaledVector(back, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    camera.near = Math.max(distance - radius * 2, distance * 0.02);
    camera.far = distance + radius * 4;
    // Centre the target in the free area: positive shifts move the picture up.
    stage.lensShift = (bottom - top) / 2;
    stage.applyLens();
    return distance;
}

// Turns the camera around the vertical axis through the target, like a sideways drag.
export function turn(stage, angle) {
    const {THREE, camera, target} = stage;
    const offset = camera.position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
}
