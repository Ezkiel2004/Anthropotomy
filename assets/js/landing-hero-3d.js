// Live 3D demo for the landing hero. landing.js imports it when the device can afford it, or when the
// visitor asks for it. It shows the explorer's own layer models through landing-stage.js: switch
// systems on, turn the body, click a part to read its name and definition from the model.
//
// It never blocks page scrolling: the mouse wheel is left alone (zoom is off), and on touch screens
// OrbitControls stands aside so vertical swipes scroll while sideways drags turn the body.
// Any failure removes the canvas and controls and leaves the poster, with one console message.
import {loadEngine, createStage, loadLayer, boxOf, frame, turn, disposeObject, VIEW, DEMO_FRAME} from './landing-stage.js?v=20261011-atlas1';

const SYSTEM_NAMES = {skeletal: 'Skeletal system', muscular: 'Muscular system', circulatory: 'Circulatory system'};
const FEATURED_PART = 'za_femur_l';   // what "Show me a part" selects, when the model has it
const CLICK_SLOP = 6;                 // px a press may move and still count as a click, as in the explorer
const KEY_TURN = Math.PI / 12;        // 15 degrees per arrow key press
const INTRO = {angle: 25 * Math.PI / 180, duration: 2600};
const SHIFT_MS = 300;
const TEXT = {
    hint: 'Click any part to see its name.',
    empty: 'Turn on a system to see it.',
    noDefinition: 'This part has no definition in the model yet.',
    loadError: 'Couldn’t load, try again',
    canvas: 'Interactive 3D model of the human body. Drag sideways, or use the left and right arrow keys, to turn it. Click a part to see its name.',
};

const cssColor = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// Resolves to a controller with dispose(), or to null when the demo could not start (the poster stays).
export async function mountDemo(root, {automatic = false, wideViewport, reducedMotion, onProgress, onEnd} = {}) {
    const q = selector => root.querySelector(selector);
    const container = q('.demo-stage');
    const poster = q('.demo-stage img');
    const toggleBar = q('[data-demo-toggles]');
    const toggles = new Map([...toggleBar.querySelectorAll('.toggle')].map(button => [button.dataset.system, button]));
    const labels = new Map([...toggles].map(([id, button]) => [id, button.querySelector('span').textContent]));
    const card = q('[data-demo-card]');
    const hint = q('[data-card-hint]');
    const hintText = q('[data-hint-text]');
    const showButton = q('[data-show-part]');
    const partView = q('[data-card-part]');
    const systemText = q('[data-card-system]');
    const nameText = q('[data-card-name]');
    const definitionText = q('[data-card-def]');
    const credit = q('.card-credit');
    const closeButton = q('[data-card-close]');
    const status = q('[data-demo-status]');

    const cleanups = [];
    const listen = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    const layers = new Map(); // id -> {root, loading, wanted}
    let stage = null, canvas = null, controls = null, accent = null;
    let ended = false, onScreen = true, frameId = 0, intro = null, shift = null, selected = null, press = null;

    const announce = message => {
        status.textContent = '';
        setTimeout(() => { if (!ended) status.textContent = message; }, 50);
    };

    // ── Rendering on demand: a frame only when something changed, while the hero is visible. ──
    const requestRender = () => {
        if (!frameId && controls && !ended && onScreen && !document.hidden) frameId = requestAnimationFrame(draw);
    };
    function draw(now) {
        frameId = 0;
        const introRunning = stepIntro(now), shifting = stepShift(now);
        const moved = controls.update(); // keeps damping going after a drag
        stage.render();
        if (moved || introRunning || shifting) requestRender();
    }

    // A slow swing out and back once the demo appears, so it reads as 3D. Never with reduced motion.
    function startIntro() {
        if (ended || reducedMotion?.matches) return;
        intro = {start: null, applied: 0};
        requestRender();
    }
    function stepIntro(now) {
        if (!intro) return false;
        intro.start ??= now;
        const progress = Math.min(1, (now - intro.start) / INTRO.duration);
        const angle = INTRO.angle * Math.sin(Math.PI * progress);
        turn(stage, angle - intro.applied);
        intro.applied = angle;
        if (progress >= 1) intro = null;
        return Boolean(intro);
    }
    const stopIntro = () => { intro = null; };

    // Moves the picture up so a selected part is not hidden behind the card.
    function shiftTo(fraction) {
        if (reducedMotion?.matches) { shift = null; stage.setExtraShift(fraction); requestRender(); return; }
        shift = {from: stage.extraShift, to: fraction, start: null};
        requestRender();
    }
    function stepShift(now) {
        if (!shift) return false;
        shift.start ??= now;
        const progress = Math.min(1, (now - shift.start) / SHIFT_MS);
        stage.setExtraShift(shift.from + (shift.to - shift.from) * (1 - Math.pow(1 - progress, 3)));
        if (progress >= 1) shift = null;
        return Boolean(shift);
    }
    function keepVisible(part) {
        const {THREE, camera} = stage;
        const center = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
        const current = stage.extraShift;
        stage.setExtraShift(0);
        camera.updateMatrixWorld();
        const height = container.clientHeight;
        const y = (1 - center.project(camera).y) / 2 * height; // px from the top without any shift
        stage.setExtraShift(current);
        const free = card.offsetTop - 16; // the card covers everything below this
        shiftTo(y <= free - 24 ? 0 : (y - free / 2) / height);
    }

    // ── Selection: the part is tinted with the accent and the card shows the model's own text. ──
    function tint(part) {
        part.traverse(node => {
            if (!node.isMesh) return;
            const make = material => {
                const copy = material.clone();
                copy.color.lerp(accent, 0.65);
                if (copy.emissive) { copy.emissive.copy(accent); copy.emissiveIntensity = 0.18; }
                return copy;
            };
            const base = node.userData.baseMaterial;
            node.userData.tintMaterial = Array.isArray(base) ? base.map(make) : make(base);
            node.material = node.userData.tintMaterial;
        });
    }
    function untint(part) {
        part.traverse(node => {
            if (!node.isMesh || !node.userData.tintMaterial) return;
            node.material = node.userData.baseMaterial;
            [node.userData.tintMaterial].flat().forEach(material => material.dispose());
            delete node.userData.tintMaterial;
        });
    }
    function select(part, {focusCard = false} = {}) {
        if (!part) { clearSelection(); return; }
        if (part === selected) return;
        if (selected) untint(selected);
        selected = part;
        tint(part);
        const data = part.userData;
        const system = SYSTEM_NAMES[data.system_id] || '';
        const name = data.name || 'Unnamed part';
        const definition = typeof data.description === 'string' ? data.description.trim() : '';
        systemText.textContent = system;
        nameText.textContent = name;
        definitionText.textContent = definition || TEXT.noDefinition;
        credit.hidden = !definition;
        hint.hidden = true;
        partView.hidden = false;
        announce(system ? `${name}, ${system.toLowerCase()}.` : `${name}.`);
        keepVisible(part);
        if (focusCard) closeButton.focus();
        requestRender();
    }
    function clearSelection({focusHint = false} = {}) {
        if (!selected) return;
        untint(selected);
        selected = null;
        partView.hidden = true;
        hint.hidden = false;
        shiftTo(0);
        if (focusHint) showButton.focus();
        requestRender();
    }

    // ── Systems: each layer downloads the first time it is switched on. ──
    const layerFor = id => {
        if (!layers.has(id)) layers.set(id, {root: null, loading: null, wanted: false});
        return layers.get(id);
    };
    const setLabel = (id, text, accessibleName) => {
        const button = toggles.get(id);
        button.querySelector('span').textContent = text;
        if (accessibleName) button.setAttribute('aria-label', accessibleName);
        else button.removeAttribute('aria-label');
    };
    const updateHint = () => { hintText.textContent = stage.visibleRoots().length ? TEXT.hint : TEXT.empty; };
    function show(layer) {
        if (!layer.root.parent) stage.body.add(layer.root);
        layer.root.visible = true;
        updateHint();
        requestRender();
    }
    async function load(id, layer) {
        const button = toggles.get(id), label = labels.get(id);
        button.setAttribute('aria-busy', 'true');
        setLabel(id, `${label} 0%`, `${label}, loading`);
        try {
            layer.root = await loadLayer(stage, id, {
                onProgress: fraction => { if (layer.wanted) setLabel(id, `${label} ${Math.round(fraction * 100)}%`, `${label}, loading`); },
            });
            setLabel(id, label);
            // Switched off while it downloaded: keep it for later, but do not add it to the scene.
            if (layer.wanted) show(layer);
            return layer.root;
        } catch (error) {
            if (ended || error?.name === 'AbortError') return null;
            layer.wanted = false;
            button.setAttribute('aria-pressed', 'false');
            button.dataset.state = 'error';
            setLabel(id, TEXT.loadError, `${label}: ${TEXT.loadError}`);
            announce(`${label} couldn’t load. Try again.`);
            return null;
        } finally {
            layer.loading = null;
            button.removeAttribute('aria-busy');
        }
    }
    function setSystem(id, on) {
        const layer = layerFor(id), button = toggles.get(id);
        layer.wanted = on;
        button.setAttribute('aria-pressed', String(on));
        delete button.dataset.state;
        if (!layer.loading) setLabel(id, labels.get(id));
        if (!on) {
            if (layerOf(selected) === id) clearSelection();
            if (layer.root) layer.root.visible = false;
            updateHint();
            requestRender();
            return Promise.resolve(null);
        }
        if (layer.root) { show(layer); return Promise.resolve(layer.root); }
        layer.loading ??= load(id, layer);
        return layer.loading;
    }
    const layerOf = part => {
        for (let node = part; node; node = node.parent) if (node.userData?.layerId) return node.userData.layerId;
        return null;
    };

    async function showPart() {
        stopIntro();
        const skeleton = await setSystem('skeletal', true);
        if (!skeleton || ended) return;
        let featured = null, firstDescribed = null;
        skeleton.traverse(node => {
            if (!node.userData.part_id) return;
            if (node.userData.part_id === FEATURED_PART) featured ??= node;
            else if (node.userData.description) firstDescribed ??= node;
        });
        select(featured || firstDescribed, {focusCard: true});
    }

    // ── Teardown: frees the GPU and puts the poster back. ──
    function end(reason, message) {
        if (ended) return;
        ended = true;
        cancelAnimationFrame(frameId);
        frameId = 0;
        cleanups.splice(0).forEach(cleanup => cleanup());
        try { controls?.dispose(); } catch (_) { /* already gone */ }
        for (const layer of layers.values()) if (layer.root && !layer.root.parent) disposeObject(layer.root);
        try { stage?.dispose(); } catch (_) { /* the context may already be lost */ }
        canvas?.remove();
        root.classList.remove('is-live');
        poster?.removeAttribute('aria-hidden');
        toggleBar.hidden = true;
        card.hidden = true;
        for (const [id, button] of toggles) {
            button.setAttribute('aria-pressed', String(id === 'skeletal'));
            delete button.dataset.state;
            button.removeAttribute('aria-busy');
            setLabel(id, labels.get(id));
        }
        partView.hidden = true;
        hint.hidden = false;
        hintText.textContent = TEXT.hint;
        if (reason === 'error') console.info('3D demo unavailable; the poster stays.', message || '');
        onEnd?.(reason);
    }

    try {
        const THREE = await loadEngine();
        if (ended) return null;
        accent = new THREE.Color(cssColor('--color-accent', '#3DDC97')).convertSRGBToLinear();

        canvas = document.createElement('canvas');
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', TEXT.canvas);
        q('.demo-stage picture').after(canvas);
        stage = createStage(canvas);
        const size = container.getBoundingClientRect();
        stage.setSize(size.width, size.height);

        listen(window, 'pagehide', () => end('pagehide'));
        listen(canvas, 'webglcontextlost', () => end('error', 'The graphics context was lost.'));

        const skeleton = layerFor('skeletal');
        skeleton.wanted = true;
        skeleton.loading = loadLayer(stage, 'skeletal', {onProgress});
        skeleton.root = await skeleton.loading;
        skeleton.loading = null;
        if (ended) return null;
        if (automatic && wideViewport && !wideViewport.matches) { end('narrow'); return null; }
        stage.body.add(skeleton.root);
        // The same framing as the poster (render.html), so the crossfade does not jump.
        frame(stage, boxOf(stage, skeleton.root), DEMO_FRAME);

        // Mouse and pen turn the body through OrbitControls; zoom and pan stay off so the wheel scrolls.
        controls = new THREE.OrbitControls(stage.camera, canvas);
        controls.target.copy(stage.target);
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.6;
        const polar = Math.PI / 2 - VIEW.elevation;
        controls.minPolarAngle = polar - 0.3;
        controls.maxPolarAngle = polar + 0.3;
        controls.update();
        listen(controls, 'change', requestRender);

        // Touch: OrbitControls would cancel scrolling, so it is switched off for touch presses (this
        // listener runs before its own) and a sideways drag turns the body instead.
        listen(canvas, 'pointerdown', event => {
            stopIntro();
            canvas.dataset.pointerFocus = ''; // OrbitControls focuses the canvas; the ring is for keyboard focus
            controls.enabled = event.pointerType !== 'touch';
            press = {id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, lastX: event.clientX};
        }, {capture: true});
        listen(canvas, 'pointermove', event => {
            if (!press || event.pointerId !== press.id || press.type !== 'touch') return;
            // The same speed as a mouse drag in OrbitControls: a full turn per canvas height, times rotateSpeed.
            turn(stage, -2 * Math.PI * (event.clientX - press.lastX) / canvas.clientHeight * controls.rotateSpeed);
            press.lastX = event.clientX;
            requestRender();
        });
        listen(canvas, 'pointerup', event => {
            if (!press || event.pointerId !== press.id) return;
            const start = press;
            press = null;
            if (event.button > 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;
            select(stage.pick(event.clientX, event.clientY)); // empty space clears the selection
        });
        listen(canvas, 'pointercancel', event => { if (press?.id === event.pointerId) press = null; });
        listen(canvas, 'blur', () => { delete canvas.dataset.pointerFocus; });
        listen(canvas, 'keydown', event => {
            delete canvas.dataset.pointerFocus;
            const direction = {ArrowLeft: 1, ArrowRight: -1}[event.key];
            if (!direction) return;
            event.preventDefault();
            stopIntro();
            turn(stage, direction * KEY_TURN);
            requestRender();
        });
        listen(root, 'keydown', event => {
            if (event.key !== 'Escape' || !selected) return;
            event.preventDefault();
            clearSelection({focusHint: partView.contains(document.activeElement)});
        });
        for (const [id, button] of toggles) listen(button, 'click', () => { stopIntro(); setSystem(id, button.getAttribute('aria-pressed') !== 'true'); });
        listen(showButton, 'click', showPart);
        listen(closeButton, 'click', () => clearSelection({focusHint: true}));

        const visibility = new IntersectionObserver(entries => {
            onScreen = entries[entries.length - 1].isIntersecting;
            if (onScreen) requestRender();
        });
        visibility.observe(container);
        cleanups.push(() => visibility.disconnect());
        listen(document, 'visibilitychange', requestRender);
        const resizer = new ResizeObserver(() => {
            const {width, height} = container.getBoundingClientRect();
            if (!width || !height) return;
            stage.setSize(width, height);
            if (selected) keepVisible(selected);
            requestRender();
        });
        resizer.observe(container);
        cleanups.push(() => resizer.disconnect());
        if (automatic && wideViewport) listen(wideViewport, 'change', event => { if (!event.matches) end('narrow'); });
        if (reducedMotion) listen(reducedMotion, 'change', event => { if (event.matches) stopIntro(); });

        // First frame, then the crossfade from the poster, then the intro swing.
        stage.render();
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (ended) return null;
        root.classList.add('is-live');
        poster?.setAttribute('aria-hidden', 'true');
        toggleBar.hidden = false;
        card.hidden = false;
        updateHint();
        setTimeout(startIntro, 400);
        return {dispose: () => end('closed')};
    } catch (error) {
        end('error', error?.message || String(error));
        return null;
    }
}
