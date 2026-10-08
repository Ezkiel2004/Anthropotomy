'use strict';
// Layered anatomy viewer. Each body system is its own GLB layer in a shared body frame.
// A layer loads the first time it is switched on; any combination of layers can be shown.
const AnatomyViewer = {
    dracoPath: '../assets/vendor/three/draco/',
    layers: new Map(), materialCache: new Map(),
    focusedPart: null, hoveredPart: null, savedView: null, tween: null, pendingHover: null, lastHover: 0,
    onPartClick: null, labelFor: null,
    init(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#101c2e');
        this.camera = new THREE.PerspectiveCamera(40, 1, .01, 10000);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536077, 1.6));
        const light = new THREE.DirectionalLight(0xffffff, 1.4); light.position.set(4, 8, 6); this.scene.add(light);
        this.world = new THREE.Group(); this.scene.add(this.world);
        this.controls = new THREE.OrbitControls(this.camera, canvas); this.controls.enableDamping = true;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        this.controls.listenToKeyEvents(canvas);
        this.controls.addEventListener('start', () => { this.tween = null; if (!this.focusedPart) this.restoreMinDistance(); });
        // Keep panning near the model: the orbit target never leaves the bounds set by resetView.
        this.controls.addEventListener('change', () => { if (this.panBounds) this.panBounds.clampPoint(this.controls.target, this.controls.target); });
        this.raycaster = new THREE.Raycaster();
        const draco = new THREE.DRACOLoader(); draco.setDecoderPath(this.dracoPath);
        this.loader = new THREE.GLTFLoader(); this.loader.setDRACOLoader(draco);
        this.label = document.createElement('div'); this.label.className = 'part-hover-label'; this.label.hidden = true;
        canvas.parentElement.append(this.label);
        // Intercept wheel zoom before OrbitControls' center-based wheel handler.
        // Moving camera and orbit target around the same anchor keeps it under the pointer.
        canvas.addEventListener('wheel', event => {
            if (!this.hasVisibleLayer() || !this.controls.enabled || !this.controls.enableZoom) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
            const delta = Math.max(-200, Math.min(200, event.deltaY * units));
            this.zoom(Math.exp(delta * .002), this.pointerAnchor(event.clientX, event.clientY));
        }, {capture: true, passive: false});
        this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
        let pointerStart = null;
        canvas.addEventListener('pointerdown', e => { pointerStart = {x: e.clientX, y: e.clientY}; });
        canvas.addEventListener('pointerup', e => {
            const start = pointerStart; pointerStart = null;
            if (e.button !== 0 || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
            this.onPartClick?.(this.partAt(e.clientX, e.clientY));
        });
        canvas.addEventListener('pointermove', e => {
            if (e.buttons) { this.pendingHover = null; this.setHover(null); return; }
            this.pendingHover = {x: e.clientX, y: e.clientY};
        });
        canvas.addEventListener('pointerleave', () => { this.pendingHover = null; this.setHover(null); });
        this.animate = () => {
            this.frame = requestAnimationFrame(this.animate);
            if (document.hidden) return;
            const now = performance.now();
            this.stepTween(now);
            this.stepViewInset();
            if (this.pendingHover && now - this.lastHover > 50) { // at most ~20 hover raycasts per second
                const {x, y} = this.pendingHover; this.pendingHover = null; this.lastHover = now;
                this.setHover(this.partAt(x, y), x, y);
            }
            this.controls.update(); this.renderer.render(this.scene, this.camera);
        };
        // Stop the render loop while the tab is hidden and start a single new one when it returns.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(this.frame); this.frame = null; }
            else if (this.frame == null) this.animate();
        });
        this.animate();
    },
    resize() { const rect = this.canvas.parentElement.getBoundingClientRect(); this.renderer.setSize(rect.width, rect.height, false); this.camera.aspect = rect.width / Math.max(rect.height, 1); this.viewSize = {width: rect.width, height: rect.height}; this.applyViewInset(); },

    // ── View inset: overlays covering the right or bottom edge shift the projection centre into the
    //    uncovered area, so the canvas never resizes but the model stays visible beside the panel. ──
    viewInset: {right: 0, bottom: 0}, viewInsetTarget: {right: 0, bottom: 0}, viewSize: null,
    setViewInset(right, bottom) {
        this.viewInsetTarget = {right: Math.max(0, right), bottom: Math.max(0, bottom)};
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.viewInset = {...this.viewInsetTarget}; this.applyViewInset(); }
    },
    stepViewInset() {
        const current = this.viewInset, target = this.viewInsetTarget;
        if (current.right === target.right && current.bottom === target.bottom) return;
        const approach = (from, to) => (Math.abs(to - from) < 0.5 ? to : from + (to - from) * 0.2);
        this.viewInset = {right: approach(current.right, target.right), bottom: approach(current.bottom, target.bottom)};
        this.applyViewInset();
    },
    applyViewInset() {
        if (!this.viewSize) return;
        const {width, height} = this.viewSize, {right, bottom} = this.viewInset;
        if (right || bottom) this.camera.setViewOffset(width, height, right / 2, bottom / 2, width, height);
        else this.camera.clearViewOffset(); // both update the projection matrix
    },

    // ── Layers ──
    layerState(id) { return this.layers.get(id) || null; },
    visibleRoots() { return [...this.layers.values()].filter(layer => layer.root && layer.root.visible).map(layer => layer.root); },
    hasVisibleLayer() { return this.visibleRoots().length > 0; },
    createLayer(id) {
        const layer = {id, status: 'idle', progress: null, layered: false, wanted: false, root: null, parts: new Map(), loading: null};
        this.layers.set(id, layer); return layer;
    },
    async setLayerVisible(system, visible, onProgress) {
        const layer = this.layers.get(system.id) || this.createLayer(system.id);
        layer.wanted = visible;
        if (layer.root) layer.root.visible = visible;
        if (!visible) {
            if (this.focusedPart && this.focusedPart.userData.layerId === system.id) this.clearFocus();
            if (this.hoveredPart && this.hoveredPart.userData.layerId === system.id) this.setHover(null);
            return layer;
        }
        if (layer.root) { this.applyMaterials(); return layer; }
        if (!system.modelUrl) return layer;
        if (!layer.loading) layer.loading = this.loadLayer(layer, system, onProgress);
        await layer.loading;
        return layer;
    },
    async loadLayer(layer, system, onProgress) {
        layer.status = 'loading'; layer.progress = null; onProgress?.(layer);
        try {
            const gltf = await new Promise((resolve, reject) => this.loader.load(system.modelUrl, resolve, event => {
                layer.progress = event.total ? Math.round(event.loaded / event.total * 100) : null; onProgress?.(layer);
            }, reject));
            this.adoptLayer(layer, system, gltf.scene);
            layer.status = 'ready';
        } catch (error) {
            layer.status = 'error'; console.warn('Anatomy layer could not be loaded:', system.modelUrl, error);
        } finally { layer.loading = null; }
        onProgress?.(layer);
    },
    adoptLayer(layer, system, root) {
        if (layer.disposed) { this.disposeObject(root); return; } // switched off and disposed while downloading
        let layered = false;
        root.traverse(node => { if (node.userData && node.userData.anatomy_schema) layered = true; });
        layer.layered = layered;
        root.traverse(node => {
            if (node.isMesh) node.userData.baseMaterial = node.material;
            if (!layered && node.isMesh) {
                // Models made outside the layered export: only meshes named in a structure are selectable, as before.
                const structure = (system.structures || []).find(s => s.mesh_name && (s.mesh_name === node.name || s.mesh_name === node.parent?.name));
                if (structure) Object.assign(node.userData, {part_id: 'legacy:' + node.uuid, name: structure.name, system_id: system.id, structure});
            }
            if (node.userData.part_id) { node.userData.layerId = system.id; layer.parts.set(node.userData.part_id, node); }
            node.updateMatrix(); node.matrixAutoUpdate = false; // the anatomy never moves; skip per-frame matrix work
        });
        root.visible = layer.wanted;
        this.world.add(root); root.updateMatrixWorld(true);
        layer.root = root;
        if (root.visible && this.focusedPart) this.applyMaterials(root);
        if (root.visible && this.visibleRoots().length === 1) this.resetView();
    },
    // Frees a layer's GPU resources. Switching the system on again reloads it (the browser cache serves the file).
    disposeLayer(id) {
        const layer = this.layers.get(id); if (!layer) return;
        layer.disposed = true; this.layers.delete(id);
        if (this.focusedPart && this.focusedPart.userData.layerId === id) this.clearFocus();
        if (this.hoveredPart && this.hoveredPart.userData.layerId === id) this.setHover(null);
        if (layer.root) { this.world.remove(layer.root); this.disposeObject(layer.root); layer.root = null; }
        layer.parts.clear();
    },
    disposeObject(root) {
        const materials = new Set();
        root.traverse(node => {
            if (!node.isMesh) return;
            if (node.geometry) node.geometry.dispose();
            [].concat(node.userData.baseMaterial || node.material).forEach(material => material && materials.add(material));
        });
        for (const material of materials) {
            const variants = this.materialCache.get(material.uuid);
            if (variants) { Object.values(variants).forEach(variant => variant.dispose()); this.materialCache.delete(material.uuid); }
            Object.values(material).forEach(value => { if (value && value.isTexture) value.dispose(); });
            material.dispose();
        }
    },
    findPart(meshName) {
        if (!meshName) return null;
        for (const layer of this.layers.values()) {
            if (!layer.root || !layer.root.visible) continue;
            if (layer.parts.has(meshName)) return layer.parts.get(meshName);
            for (const part of layer.parts.values()) if (part.name === meshName || part.parent?.name === meshName) return part;
        }
        return null;
    },

    // ── Picking and hover ──
    rayFrom(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    },
    partAt(x, y) {
        const roots = this.visibleRoots(); if (!roots.length) return null;
        this.rayFrom(x, y);
        return AnatomyLayersCore.pickPart(this.raycaster.intersectObjects(roots, true), this.focusedPart?.userData.part_id);
    },
    setHover(part, x, y) {
        if (part !== this.hoveredPart) {
            const previous = this.hoveredPart; this.hoveredPart = part;
            if (previous) this.applyMaterials(previous);
            if (part) this.applyMaterials(part);
            this.canvas.style.cursor = part ? 'pointer' : '';
        }
        if (part && x !== undefined) {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.label.textContent = this.labelFor?.(part) || part.userData.name || '';
            this.label.style.left = (x - rect.left + 14) + 'px'; this.label.style.top = (y - rect.top + 14) + 'px';
            this.label.hidden = !this.label.textContent;
        } else if (!part) this.label.hidden = true;
    },

    // ── Materials: base, hover glow, faded ghost (a focused part keeps its base material) ──
    variant(material, kind) {
        let entry = this.materialCache.get(material.uuid);
        if (!entry) { entry = {}; this.materialCache.set(material.uuid, entry); }
        if (!entry[kind]) {
            const copy = material.clone();
            const glow = AnatomyLayersCore.glowFor(kind);
            if (kind === 'ghost') { copy.transparent = true; copy.opacity = 0.12; copy.depthWrite = false; }
            else if (glow && copy.emissive) { copy.emissive.setHex(glow.color); copy.emissiveIntensity = glow.intensity; }
            entry[kind] = copy;
        }
        return entry[kind];
    },
    materialFor(mesh, part) {
        const base = mesh.userData.baseMaterial;
        const kind = part && part === this.focusedPart ? 'focus' : this.focusedPart ? 'ghost' : part && part === this.hoveredPart ? 'hover' : null;
        if (!kind || (kind === 'focus' && !AnatomyLayersCore.glowFor(kind))) return base;
        return Array.isArray(base) ? base.map(m => this.variant(m, kind)) : this.variant(base, kind);
    },
    applyMaterials(scope) {
        for (const root of scope ? [scope] : this.visibleRoots()) root.traverse(node => {
            if (node.isMesh && node.userData.baseMaterial) node.material = this.materialFor(node, AnatomyLayersCore.resolvePart(node));
        });
    },

    // ── Focus ──
    focusPart(part) {
        if (!part) return;
        if (!this.focusedPart) this.savedView = {position: this.camera.position.clone(), target: this.controls.target.clone()};
        this.focusedPart = part;
        this.applyMaterials();
        const sphere = new THREE.Box3().setFromObject(part).getBoundingSphere(new THREE.Sphere());
        const direction = this.camera.position.clone().sub(this.controls.target);
        if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
        const distance = AnatomyLayersCore.fitDistance(sphere.radius, this.camera.fov, this.camera.aspect);
        // Small parts may come closer than the model-wide limit; it returns once the view leaves the part.
        if (this.baseMinDistance != null) this.controls.minDistance = Math.min(this.baseMinDistance, distance * .5);
        direction.normalize().multiplyScalar(distance);
        this.moveCamera(sphere.center.clone().add(direction), sphere.center);
    },
    clearFocus() {
        if (!this.focusedPart) return;
        this.focusedPart = null; this.applyMaterials();
        if (this.savedView) this.moveCamera(this.savedView.position, this.savedView.target);
        else this.restoreMinDistance();
        this.savedView = null;
    },
    restoreMinDistance() { if (this.baseMinDistance != null) this.controls.minDistance = this.baseMinDistance; },
    moveCamera(position, target, duration = 800) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.tween = null; this.camera.position.copy(position); this.controls.target.copy(target);
            if (!this.focusedPart) this.restoreMinDistance();
            this.controls.update(); return;
        }
        this.tween = {start: performance.now(), duration, fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPosition: position.clone(), toTarget: target.clone()};
    },
    stepTween(now) {
        const tween = this.tween; if (!tween) return;
        const k = Math.min(1, (now - tween.start) / tween.duration), eased = AnatomyLayersCore.easeInOutCubic(k);
        this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
        this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        if (k >= 1) { this.tween = null; if (!this.focusedPart) this.restoreMinDistance(); }
    },

    // ── View ──
    resetView(animate = false) {
        const roots = this.visibleRoots(); if (!roots.length) return;
        const box = new THREE.Box3(); roots.forEach(root => box.expandByObject(root));
        const extent = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3()); const size = extent.length() || 1;
        this.tween = null; this.savedView = null;
        const limits = AnatomyLayersCore.distanceLimits(size);
        this.baseMinDistance = limits.min; this.controls.minDistance = limits.min; this.controls.maxDistance = limits.max;
        this.panBounds = box.clone().expandByVector(extent.multiplyScalar(.25)); // 50% larger than the model overall
        const position = center.clone().add(new THREE.Vector3(0, size * .1, size * 1.4));
        this.camera.near = Math.max(size / 1000, .001); this.camera.far = size * 100; this.camera.updateProjectionMatrix();
        if (animate) { this.moveCamera(position, center); return; }
        this.camera.position.copy(position); this.controls.target.copy(center); this.controls.update();
    },
    pointerAnchor(x, y) {
        this.rayFrom(x, y);
        // Raycast every visible mesh, including ones without part data.
        const hit = this.raycaster.intersectObjects(this.visibleRoots(), true)[0];
        if (hit) return hit.point;
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), this.controls.target);
        return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || this.controls.target.clone();
    },
    zoom(factor, anchor = this.controls.target.clone(), animate = false) {
        if (!this.hasVisibleLayer() || !Number.isFinite(factor) || factor <= 0) return;
        this.tween = null;
        const distance = this.camera.position.distanceTo(this.controls.target);
        const next = THREE.MathUtils.clamp(distance * factor, Math.max(this.camera.near * 10, this.controls.minDistance), Math.min(this.camera.far * .5, this.controls.maxDistance));
        const scale = next / Math.max(distance, Number.EPSILON);
        const position = this.camera.position.clone().sub(anchor).multiplyScalar(scale).add(anchor);
        const target = this.controls.target.clone().sub(anchor).multiplyScalar(scale).add(anchor);
        if (animate) { this.moveCamera(position, target, 200); return; }
        this.camera.position.copy(position); this.controls.target.copy(target);
        this.controls.update();
    },
    screenshot() { const link = document.createElement('a'); link.download = 'anatomy-view.png'; link.href = this.canvas.toDataURL('image/png'); link.click(); }
};
