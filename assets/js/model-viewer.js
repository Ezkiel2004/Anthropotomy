'use strict';
// Layered anatomy viewer. Each body system is its own GLB layer in a shared body frame.
// A layer loads the first time it is switched on; any combination of layers can be shown.
const AnatomyViewer = {
    dracoPath: '../assets/vendor/three/draco/',
    layers: new Map(), materialCache: new Map(),
    focusedPart: null, focusedParts: new Set(), hoveredPart: null, savedView: null, tween: null, pendingHover: null, lastHover: 0,
    onPartClick: null, labelFor: null,
    init(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        // Realistic colour: sRGB output with filmic tone mapping, lit mainly by a soft studio environment.
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.6;
        // The page's --navy sets the backdrop, so the Stage student explorer stays on its dark stage.
        this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(getComputedStyle(canvas).getPropertyValue('--navy').trim() || '#101c2e');
        this.scene.environment = this.studioEnvironment();
        this.camera = new THREE.PerspectiveCamera(40, 1, .01, 10000);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536077, 0.4));
        const light = new THREE.DirectionalLight(0xffffff, 1.0); light.position.set(4, 8, 6); this.scene.add(light);
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
        let pointerStart = null, spinFrom = null;
        canvas.addEventListener('pointerdown', e => { pointerStart = {x: e.clientX, y: e.clientY}; spinFrom = {x: e.clientX, y: e.clientY}; });
        canvas.addEventListener('pointerup', e => {
            const start = pointerStart; pointerStart = null; spinFrom = null;
            if (this.tray || e.button !== 0 || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
            this.onPartClick?.(this.partAt(e.clientX, e.clientY));
        });
        canvas.addEventListener('pointermove', e => {
            // With the tray open, dragging turns every tray part about its own centre (the view itself stays put).
            if (this.tray && spinFrom && e.buttons & 1) { this.spinTray(e.clientX - spinFrom.x, e.clientY - spinFrom.y); spinFrom = {x: e.clientX, y: e.clientY}; }
            if (e.buttons) { this.pendingHover = null; this.setHover(null); return; }
            this.pendingHover = {x: e.clientX, y: e.clientY};
        });
        canvas.addEventListener('pointerleave', () => { this.pendingHover = null; this.setHover(null); });
        this.animate = () => {
            this.frame = requestAnimationFrame(this.animate);
            if (document.hidden) return;
            const now = performance.now();
            this.stepTween(now);
            this.stepTray(now);
            this.stepViewInset();
            if (this.pendingHover && now - this.lastHover > 50) { // at most ~20 hover raycasts per second
                const {x, y} = this.pendingHover; this.pendingHover = null; this.lastHover = now;
                this.setHover(this.partAt(x, y), x, y);
            }
            this.controls.update(); this.renderer.render(this.scene, this.camera);
            if (this.tray) this.placeTrayLabels();
        };
        // Stop the render loop while the tab is hidden and start a single new one when it returns.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(this.frame); this.frame = null; }
            else if (this.frame == null) this.animate();
        });
        this.animate();
    },
    // A small studio room (soft overhead panel, side fill, rim) pre-filtered into an environment map.
    // Built in code, like Three.js's RoomEnvironment, so no extra file is needed.
    studioEnvironment() {
        const room = new THREE.Scene(), box = new THREE.BoxGeometry(), materials = [];
        const add = (material, position, scale) => {
            const mesh = new THREE.Mesh(box, material); mesh.position.set(...position); mesh.scale.set(...scale);
            room.add(mesh); materials.push(material);
        };
        add(new THREE.MeshBasicMaterial({color: 0x15181d, side: THREE.BackSide}), [0, 0, 0], [12, 9, 12]);
        const panel = intensity => new THREE.MeshBasicMaterial({color: new THREE.Color().setScalar(intensity)});
        add(panel(2), [0, 4.3, 0], [7, 0.1, 7]);      // key: soft light from above
        add(panel(0.8), [-5.9, 1, 2], [0.1, 4, 5]);   // fill from the left
        add(panel(1.1), [5.9, 2, -3], [0.1, 3, 3]);   // rim from the right and behind
        add(panel(0.4), [0, 1, 5.9], [5, 3, 0.1]);    // gentle front fill
        const generator = new THREE.PMREMGenerator(this.renderer);
        const texture = generator.fromScene(room, 0.04).texture;
        generator.dispose(); box.dispose(); materials.forEach(material => material.dispose());
        return texture;
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
        if (layered) this.applySystemLooks(root, system.id); // uploaded models keep their authored materials
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
    // Gives each part natural tissue colour and finish (AnatomyLayersCore.tissueLook, falling back to the
    // system's materialLook). Parts share Z-Anatomy materials, so each distinct look gets its own copy.
    applySystemLooks(root, fallbackSystem) {
        const copies = new Map(), replaced = new Set();
        root.traverse(node => {
            if (!node.isMesh) return;
            const part = AnatomyLayersCore.resolvePart(node);
            const system = part?.userData.system_id || fallbackSystem;
            const restyle = material => {
                if (!material || !material.isMeshStandardMaterial) return material;
                const look = AnatomyLayersCore.tissueLook(system, material.name, part?.userData.name || node.name) || AnatomyLayersCore.materialLook(system);
                const key = `${material.uuid}|${look.color || ''}|${look.roughness}|${look.opacity ?? 1}`;
                if (!copies.has(key)) {
                    const copy = material.clone();
                    if (look.color) copy.color.set(look.color).convertSRGBToLinear();
                    else if (look.colorScale && look.colorScale !== 1) copy.color.multiplyScalar(look.colorScale);
                    copy.roughness = look.roughness; copy.metalness = look.metalness || 0;
                    if (look.opacity < 1) { copy.transparent = true; copy.opacity = look.opacity; copy.depthWrite = false; copy.userData.seeThrough = true; }
                    // Z-Anatomy materials export with full white emission (and some clearcoat), which washes
                    // every part out to white; real tissue does not glow.
                    if (copy.emissive) copy.emissive.setRGB(0, 0, 0);
                    if ('clearcoat' in copy) copy.clearcoat = 0;
                    copies.set(key, copy);
                }
                replaced.add(material);
                return copies.get(key);
            };
            node.material = Array.isArray(node.material) ? node.material.map(restyle) : restyle(node.material);
        });
        replaced.forEach(material => material.dispose()); // no mesh uses the originals any more
    },
    // Frees a layer's GPU resources. Switching the system on again reloads it (the browser cache serves the file).
    disposeLayer(id) {
        const layer = this.layers.get(id); if (!layer) return;
        layer.disposed = true; this.layers.delete(id);
        if (this.focusedPart && this.focusedPart.userData.layerId === id) this.clearFocus();
        if (this.tray?.items[0].part.userData.layerId === id) this.disposeTray(); // its copies use this layer's geometry
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
        const roots = this.visibleRoots(); if (!roots.length || this.tray) return null;
        this.rayFrom(x, y);
        return AnatomyLayersCore.pickPart(this.raycaster.intersectObjects(roots, true), this.focusedPart?.userData.part_id, mesh => this.isSeeThrough(mesh));
    },
    // Where a world point sits on screen, in pixels from the canvas parent's top left.
    screenPoint(point) {
        const p = point.clone().project(this.camera), canvas = this.canvas.getBoundingClientRect(), box = this.canvas.parentElement.getBoundingClientRect();
        return {x: canvas.left - box.left + (p.x + 1) / 2 * canvas.width, y: canvas.top - box.top + (1 - p.y) / 2 * canvas.height, behind: p.z > 1};
    },
    isSeeThrough(mesh) { return [].concat(mesh.userData.baseMaterial || mesh.material).every(material => material?.userData.seeThrough); },
    setHover(part, x, y) {
        if (part !== this.hoveredPart) {
            const previous = this.hoveredPart; this.hoveredPart = part;
            if (previous) this.applyMaterials(previous);
            if (part) this.applyMaterials(part);
            this.canvas.style.cursor = part ? 'pointer' : '';
        }
        if (part && x !== undefined) {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            // labelFor may return a plain name or {title, subtitle}; the subtitle shows on a second line.
            const text = this.labelFor?.(part) || part.userData.name || '';
            const {title = text, subtitle = ''} = typeof text === 'object' ? text : {};
            const small = document.createElement('small'); small.textContent = subtitle;
            this.label.replaceChildren(title, ...(subtitle ? [small] : []));
            this.label.style.left = (x - rect.left + 22) + 'px'; this.label.style.top = (y - rect.top) + 'px';
            this.label.hidden = !title;
        } else if (!part) this.label.hidden = true;
    },

    // ── Materials: base, hover glow, faded ghost (a focused part keeps its base material; a focused
    //    see-through part turns mostly opaque so it stands out from the faded parts) ──
    variant(material, kind) {
        let entry = this.materialCache.get(material.uuid);
        if (!entry) { entry = {}; this.materialCache.set(material.uuid, entry); }
        if (!entry[kind]) {
            const copy = material.clone();
            const glow = AnatomyLayersCore.glowFor(kind);
            if (kind === 'ghost') { copy.transparent = true; copy.opacity = 0.12; copy.depthWrite = false; }
            else if (kind === 'focus' && material.userData.seeThrough) copy.opacity = 0.6;
            else if (glow && copy.emissive) { copy.emissive.setHex(glow.color); copy.emissiveIntensity = glow.intensity; }
            entry[kind] = copy;
        }
        return entry[kind];
    },
    materialFor(mesh, part) {
        const base = mesh.userData.baseMaterial;
        const kind = part && this.focusedParts.has(part) ? 'focus' : this.focusedPart ? 'ghost' : part && part === this.hoveredPart ? 'hover' : null;
        if (!kind || (kind === 'focus' && !AnatomyLayersCore.glowFor(kind) && !this.isSeeThrough(mesh))) return base;
        return Array.isArray(base) ? base.map(m => this.variant(m, kind)) : this.variant(base, kind);
    },
    applyMaterials(scope) {
        for (const root of scope ? [scope] : this.visibleRoots()) root.traverse(node => {
            if (node.isMesh && node.userData.baseMaterial) node.material = this.materialFor(node, AnatomyLayersCore.resolvePart(node));
        });
    },

    // ── Focus ──
    // Takes one part or a list (a study cluster): every listed part stays solid, the rest fade.
    focusPart(target) {
        const parts = [].concat(target || []);
        if (!parts.length) return;
        if (!this.focusedPart) this.savedView = {position: this.camera.position.clone(), target: this.controls.target.clone()};
        this.focusedPart = parts[0]; this.focusedParts = new Set(parts);
        this.applyMaterials();
        const box = new THREE.Box3();
        parts.forEach(part => box.expandByObject(part));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
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
        this.closeTray();
        this.focusedPart = null; this.focusedParts = new Set(); this.applyMaterials();
        if (this.savedView) this.moveCamera(this.savedView.position, this.savedView.target);
        else this.restoreMinDistance();
        this.savedView = null;
    },
    restoreMinDistance() { if (this.baseMinDistance != null) this.controls.minDistance = this.baseMinDistance; },

    // ── Section tray: a study cluster's parts fly out of the faded body into a grid beside it, facing the
    //    viewer, each scaled to the same cell size (not to scale) with its name underneath. The tray holds
    //    copies that share the parts' geometry; the originals hide until the copies fly back. ──
    openTray(parts, names) {
        this.closeTray(true);
        if (!parts.length) return;
        if (!this.focusedPart) this.savedView = {position: this.camera.position.clone(), target: this.controls.target.clone()};
        this.focusedPart = parts[0]; this.focusedParts = new Set(parts);
        this.applyMaterials(); this.setHover(null); this.tween = null;
        const facing = this.camera.quaternion.clone();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(facing), up = new THREE.Vector3(0, 1, 0).applyQuaternion(facing);
        const body = new THREE.Box3(); this.visibleRoots().forEach(root => body.expandByObject(root));
        const center = body.getCenter(new THREE.Vector3());
        const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? body.max.x : body.min.x, i & 2 ? body.max.y : body.min.y, i & 4 ? body.max.z : body.min.z).sub(center));
        const halfWidth = Math.max(...corners.map(c => Math.abs(c.dot(right)))), halfHeight = Math.max(...corners.map(c => Math.abs(c.dot(up))));
        // A near-square grid as tall as the body; three rows at least, so a short section still gets sensible cells.
        // A portrait screen (a phone) gets a narrow grid and frames the tray alone: the body would leave no room.
        const portrait = this.camera.aspect < .9;
        const cols = portrait ? Math.min(3, Math.ceil(Math.sqrt(parts.length * .4))) : Math.min(6, Math.ceil(Math.sqrt(parts.length * .8)));
        const rows = Math.ceil(parts.length / cols);
        const cell = halfHeight * 2 / Math.max(rows, 3);
        const group = new THREE.Group();
        group.position.copy(center).addScaledVector(right, -(halfWidth + cell * .5 + cols * cell / 2)); // left of the body: the info panel covers the right
        group.quaternion.copy(facing);
        this.scene.add(group); group.updateMatrixWorld(true);
        const box = document.createElement('div'); box.className = 'part-tray';
        const note = Object.assign(document.createElement('div'), {className: 'part-tray__note', textContent: 'Not to scale'});
        box.append(note); this.canvas.parentElement.append(box);
        const unturn = facing.clone().invert();
        const items = parts.map((part, i) => {
            const content = new THREE.Group();
            part.updateMatrixWorld(true);
            part.traverse(node => {
                if (!node.isMesh || !node.userData.baseMaterial) return;
                const copy = new THREE.Mesh(node.geometry, node.userData.baseMaterial);
                copy.applyMatrix4(node.matrixWorld); content.add(copy);
            });
            const sphere = new THREE.Box3().setFromObject(content).getBoundingSphere(new THREE.Sphere());
            content.position.copy(sphere.center).negate();
            // pivot (tray frame: position, size, spin) > align (undoes the tray's turn) > content (centred on the part)
            const align = new THREE.Group(); align.quaternion.copy(unturn); align.add(content);
            const pivot = new THREE.Group(); pivot.add(align); group.add(pivot);
            const col = i % cols, row = Math.floor(i / cols);
            const to = new THREE.Vector3((col - (cols - 1) / 2) * cell, ((rows - 1) / 2 - row) * cell + cell * .14, 0);
            const from = group.worldToLocal(sphere.center.clone());
            pivot.position.copy(from);
            part.visible = false;
            const label = Object.assign(document.createElement('div'), {className: 'part-tray__label', textContent: names[i]});
            box.append(label);
            return {part, pivot, from, to, size: cell * .55 / Math.max(sphere.radius * 2, 1e-6), label};
        });
        this.tray = {group, items, cell, rows, box, note, start: performance.now(), closing: false, done: false, panBounds: this.panBounds};
        // Frame the body and the tray together, keeping the viewing direction so the tray still faces the viewer.
        // Fit the area's own width and height (a bounding sphere would leave half the view empty).
        const left = -(halfWidth + cell * .5 + cols * cell), halfSpanX = portrait ? cols * cell / 2 : (halfWidth - left) / 2;
        const halfSpanY = portrait ? rows * cell / 2 + cell * .3 : Math.max(halfHeight, rows * cell / 2 + cell * .3);
        const middle = portrait ? group.position.clone() : center.clone().addScaledVector(right, (halfWidth + left) / 2);
        const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(facing);
        const depth = Math.max(...corners.map(c => Math.abs(c.dot(forward))));
        const distance = Math.max(halfSpanY / tan, halfSpanX / (tan * this.camera.aspect)) * 1.12 + depth;
        const frame = body.clone();
        for (const x of [-1, 1]) for (const y of [-1, 1]) frame.expandByPoint(group.localToWorld(new THREE.Vector3(x * cols * cell / 2, y * halfSpanY, 0)));
        this.panBounds = frame.clone().expandByScalar(halfSpanX);
        this.controls.enableRotate = false;
        this.moveCamera(middle.clone().addScaledVector(forward, -distance), middle);
    },
    stepTray(now) {
        const tray = this.tray; if (!tray || tray.done) return;
        const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const k = instant ? 1 : Math.min(1, (now - tray.start) / 800), t = AnatomyLayersCore.easeInOutCubic(k);
        for (const item of tray.items) {
            if (tray.closing) {
                item.pivot.position.lerpVectors(item.at, item.from, t);
                item.pivot.scale.setScalar(THREE.MathUtils.lerp(item.atSize, 1, t));
                item.pivot.quaternion.slerpQuaternions(item.atTurn, new THREE.Quaternion(), t);
            } else {
                item.pivot.position.lerpVectors(item.from, item.to, t);
                item.pivot.scale.setScalar(THREE.MathUtils.lerp(1, item.size, t));
            }
        }
        if (k < 1) return;
        if (tray.closing) this.disposeTray(); else tray.done = true;
    },
    spinTray(dx, dy) {
        if (!this.tray?.done || this.tray.closing) return;
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * .01)
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * .01));
        this.tray.items.forEach(item => item.pivot.quaternion.premultiply(turn));
    },
    placeTrayLabels() {
        const tray = this.tray;
        tray.box.hidden = !tray.done;
        if (!tray.done) return;
        const onScreen = (x, y) => this.screenPoint(tray.group.localToWorld(new THREE.Vector3(x, y, 0)));
        const a = onScreen(0, 0), b = onScreen(tray.cell, 0), cellPx = Math.hypot(b.x - a.x, b.y - a.y);
        const width = cellPx * .96 + 'px', fontSize = Math.max(10, Math.min(14, cellPx / 9)) + 'px'; // smaller type in tight grids
        for (const item of tray.items) {
            const p = onScreen(item.to.x, item.to.y - tray.cell * .31);
            Object.assign(item.label.style, {left: p.x + 'px', top: p.y + 'px', width, fontSize});
        }
        const top = onScreen(0, tray.rows * tray.cell / 2 + tray.cell * .12);
        Object.assign(tray.note.style, {left: top.x + 'px', top: top.y + 'px'});
    },
    // Sends the copies back into the body; instant also skips the flight (e.g. when another section opens).
    closeTray(instant = false) {
        const tray = this.tray; if (!tray || tray.closing) { if (tray && instant) this.disposeTray(); return; }
        this.controls.enableRotate = true; this.panBounds = tray.panBounds;
        if (instant) { this.disposeTray(); return; }
        tray.items.forEach(item => { item.at = item.pivot.position.clone(); item.atSize = item.pivot.scale.x; item.atTurn = item.pivot.quaternion.clone(); });
        Object.assign(tray, {closing: true, done: false, start: performance.now()});
    },
    disposeTray() {
        const tray = this.tray; if (!tray) return;
        this.scene.remove(tray.group); // the copies share geometry and materials with the parts, so nothing is disposed
        tray.items.forEach(item => { item.part.visible = true; });
        tray.box.remove();
        // closeTray already handed rotation and pan limits back; restoring again could undo a newer resetView.
        if (!tray.closing) { this.controls.enableRotate = true; this.panBounds = tray.panBounds; }
        this.tray = null;
    },
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
