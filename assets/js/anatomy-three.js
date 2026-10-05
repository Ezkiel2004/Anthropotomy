/**
 * Anthropotomy – Production Three.js 3D Anatomy Explorer Engine
 * 
 * Architecture:
 * - Three.js WebGLRenderer with soft shadows, ToneMapping, and pixelRatio capping
 * - THREE.OrbitControls with damping, distance clamping, and auto-rotation
 * - Dynamic GLTFLoader supporting drop-in production .glb/.gltf models
 * - THREE.Box3 auto-centering and bounding-sphere camera framing for any model
 * - Modular procedural 3D anatomical mannequins for all 9 human body systems
 * - Interactive raycaster mesh picking on hover and click with material caching
 * - Dynamic layer visibility toggles (Skin, Muscle, Skeleton, Organs, Vessels, Nerves)
 * - Complete WebGL memory disposal on system change to prevent GPU leaks
 * - Synchronized Info Panel inspection and Web Speech API audio pronunciation
 */

'use strict';

const AnatomyViewer = {
  // ── Engine Core Properties ──
  canvas: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  raycaster: null,
  mouse: null,
  animFrameId: null,

  // ── Multi-System Layer Hierarchy ──
  currentSystem: 'skeletal',
  activeSystems: new Set(['skeletal']),
  systemSubgroups: new Map(), // systemId -> THREE.Group
  ghostSilhouette: null,      // Base shared outer mannequin silhouette
  materialsCache: null,
  modelGroup: null,
  interactiveMeshes: [],
  meshMaterialCache: new Map(), // uuid -> { origMaterial, origEmissive, origIntensity }

  // ── Interaction & State ──
  isModelLoaded: false,
  isProcedural: true,
  hoveredMesh: null,
  selectedMesh: null,
  highlightActive: false,
  showLabels: true,
  autoRotate: false,
  isPointerDown: false,
  pointerDownPos: { x: 0, y: 0 },

  // Backward-compatibility getters/setters for existing UI scripts
  get zoom() {
    return this.camera ? (6.5 / this.camera.position.length()) : 1;
  },
  set zoom(val) {
    if (!this.camera || !val) return;
    const targetDist = 6.5 / Math.max(0.2, Math.min(val, 3));
    this.camera.position.setLength(targetDist);
    if (this.controls) this.controls.update();
  },
  get rotation() {
    return this.modelGroup ? { x: this.modelGroup.rotation.x, y: this.modelGroup.rotation.y } : { x: 0, y: 0 };
  },
  set rotation(val) {
    if (!this.modelGroup || !val) return;
    if (typeof val.y === 'number') this.modelGroup.rotation.y = val.y * (Math.PI / 180);
    if (typeof val.x === 'number') this.modelGroup.rotation.x = val.x * (Math.PI / 180);
  },

  // ── Layer Visibility Configuration ──
  layers: {
    skin: true,
    muscle: true,
    skeleton: true,
    organs: true,
    vessels: true,
    nerves: false
  },

  // ── Initialization ──
  init(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error('[Anthropotomy 3D] Canvas element not found:', canvasId);
      return;
    }

    // Verify Three.js availability
    if (typeof THREE === 'undefined') {
      console.error('[Anthropotomy 3D] Three.js is not loaded.');
      this.displayWebGLError('Three.js 3D library failed to load. Please check your network connection or local vendor files.');
      return;
    }

    try {
      this.setupRenderer();
      this.setupScene();
      this.setupCamera();
      this.setupLights();
      this.setupControls();
      this.setupRaycaster();
      this.bindWindowEvents();
      this.startRenderLoop();

      console.log('[Anthropotomy 3D] Three.js WebGL Engine initialized successfully.');
    } catch (err) {
      console.error('[Anthropotomy 3D] WebGL Initialization Error:', err);
      this.displayWebGLError('WebGL is not supported or encountered an initialization error in your browser.');
    }
  },

  // ── WebGL Renderer Setup ──
  setupRenderer() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 550;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true // Required for high-res PNG export
    });

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  },

  // ── Scene Setup ──
  setupScene() {
    this.scene = new THREE.Scene();
    // Subtle anatomical staging fog
    this.scene.fog = new THREE.FogExp2(0x0d1220, 0.035);

    // Root model group
    this.modelGroup = new THREE.Group();
    this.modelGroup.name = 'AnatomicalModelRoot';
    this.scene.add(this.modelGroup);
  },

  // ── Perspective Camera Setup ──
  setupCamera() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.camera.position.set(0, 0.5, 6.5);
  },

  // ── Anatomical Lighting Rig ──
  setupLights() {
    // 1. Balanced Hemisphere Light (Sky: soft blue-white, Ground: deep slate)
    const hemiLight = new THREE.HemisphereLight(0xedf2f7, 0x1a202c, 0.85);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    // 2. Key Directional Light (Crisp front-top-right lighting)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(5, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.bias = -0.001;
    this.scene.add(keyLight);

    // 3. Fill Directional Light (Soft cooler fill from opposite side)
    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.55);
    fillLight.position.set(-6, 4, -3);
    this.scene.add(fillLight);

    // 4. Rim / Contouring Light (Teal rim defining anatomical borders)
    const rimLight = new THREE.DirectionalLight(0x14b8a6, 0.65);
    rimLight.position.set(0, -4, -6);
    this.scene.add(rimLight);
  },

  // ── OrbitControls Setup ──
  setupControls() {
    if (typeof THREE.OrbitControls === 'undefined') {
      console.warn('[Anthropotomy 3D] OrbitControls not available. Standard rotation controls disabled.');
      return;
    }

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 14.0;
    this.controls.maxPolarAngle = Math.PI * 0.92; // Prevent flipping under ground
    this.controls.minPolarAngle = 0.08;
    this.controls.target.set(0, 0, 0);
  },

  // ── Raycaster & Picking Setup ──
  setupRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
  },

  // ── Window & Pointer Event Binding ──
  bindWindowEvents() {
    const dom = this.renderer.domElement;

    // Responsive Canvas Resizing
    window.addEventListener('resize', () => this.onResize());

    // Pointer Coordinates Tracking
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => {
      this.isPointerDown = true;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      this.isPointerDown = false;
      const dx = Math.abs(e.clientX - this.pointerDownPos.x);
      const dy = Math.abs(e.clientY - this.pointerDownPos.y);
      // Treat as click only if movement is under 6 pixels (prevent click during orbit drag)
      if (dx < 6 && dy < 6) {
        this.onPointerClick(e);
      }
    });

    // Reset hover on pointer leave
    dom.addEventListener('pointerleave', () => {
      this.mouse.set(-999, -999);
      this.clearHover();
      this.hideTooltip();
    });
  },

  // ── Resize Handler ──
  onResize() {
    if (!this.canvas || !this.renderer || !this.camera) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight || 550;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  },

  // ── Pointer Move (Raycasting & Hover) ──
  onPointerMove(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Check intersections
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const visibleMeshes = this.interactiveMeshes.filter(m => m.visible && this.isMeshLayerVisible(m));
    const intersects = this.raycaster.intersectObjects(visibleMeshes, false);

    if (intersects.length > 0) {
      const topMesh = intersects[0].object;
      if (topMesh !== this.hoveredMesh) {
        this.setHoveredMesh(topMesh);
      }
      this.renderer.domElement.style.cursor = 'pointer';

      // Update Floating HUD Tooltip if labels are active
      if (this.showLabels && topMesh.userData && topMesh.userData.structureName) {
        this.showTooltip(e.clientX, e.clientY, topMesh.userData.structureName, topMesh.userData.desc);
      }
    } else {
      if (this.hoveredMesh) {
        this.clearHover();
      }
      this.renderer.domElement.style.cursor = 'grab';
      this.hideTooltip();
    }
  },

  // ── Pointer Click (Selection & Inspection) ──
  onPointerClick(e) {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const visibleMeshes = this.interactiveMeshes.filter(m => m.visible && this.isMeshLayerVisible(m));
    const intersects = this.raycaster.intersectObjects(visibleMeshes, false);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object;
      this.selectMesh(clickedMesh);

      const stName = clickedMesh.userData.structureName;
      if (stName) {
        if (typeof window.inspectStructure === 'function') {
          window.inspectStructure(stName);
        }
        if (typeof window.speakStructure === 'function') {
          window.speakStructure(stName);
        }
        this.focusOnStructureCard(stName);
      }
    }
  },

  // ── Hover Mesh Highlight ──
  setHoveredMesh(mesh) {
    this.clearHover();
    this.hoveredMesh = mesh;

    if (!mesh.material) return;
    this.cacheMeshMaterial(mesh);

    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(0x14b8a6); // Teal hover glow
      mesh.material.emissiveIntensity = 0.55;
    }
  },

  clearHover() {
    if (this.hoveredMesh) {
      if (this.hoveredMesh !== this.selectedMesh) {
        this.restoreMeshMaterial(this.hoveredMesh);
      }
      this.hoveredMesh = null;
    }
  },

  // ── Select Mesh ──
  selectMesh(mesh) {
    if (this.selectedMesh && this.selectedMesh !== mesh) {
      this.restoreMeshMaterial(this.selectedMesh);
    }

    this.selectedMesh = mesh;
    this.cacheMeshMaterial(mesh);

    if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0xf59e0b); // Gold selection glow
      mesh.material.emissiveIntensity = 0.85;
    }
  },

  // ── Material Caching & Clean Restoration ──
  cacheMeshMaterial(mesh) {
    if (!this.meshMaterialCache.has(mesh.uuid)) {
      this.meshMaterialCache.set(mesh.uuid, {
        origEmissive: mesh.material.emissive ? mesh.material.emissive.clone() : new THREE.Color(0x000000),
        origIntensity: mesh.material.emissiveIntensity || 0,
        origColor: mesh.material.color ? mesh.material.color.clone() : new THREE.Color(0xffffff)
      });
    }
  },

  restoreMeshMaterial(mesh) {
    if (!mesh || !mesh.material) return;
    const cached = this.meshMaterialCache.get(mesh.uuid);
    if (cached) {
      if (mesh.material.emissive) {
        mesh.material.emissive.copy(cached.origEmissive);
        mesh.material.emissiveIntensity = cached.origIntensity;
      }
    }
  },

  // ── Layer Visibility Check ──
  isMeshLayerVisible(mesh) {
    const layer = mesh.userData.layer;
    if (!layer) return true;
    return this.layers[layer] !== false;
  },

  // ── Structure Card Sync ──
  focusOnStructureCard(name) {
    const list = document.getElementById('structureList');
    if (!list) return;

    const cards = list.querySelectorAll('div[onclick]');
    cards.forEach(card => {
      if (card.textContent.toLowerCase().includes(name.toLowerCase())) {
        card.style.borderColor = 'var(--brand)';
        card.style.background = 'var(--brand-light)';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => {
          card.style.borderColor = 'var(--border)';
          card.style.background = 'var(--bg-surface)';
        }, 2200);
      }
    });
  },

  // ── Floating HUD Tooltip ──
  showTooltip(clientX, clientY, title, desc) {
    let tooltip = document.getElementById('anatomyHudTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'anatomyHudTooltip';
      tooltip.className = 'anatomy-hud-tooltip';
      document.body.appendChild(tooltip);
    }

    tooltip.innerHTML = `
      <div class="hud-tooltip-title">${this.escapeHtml(title)}</div>
      ${desc ? `<div class="hud-tooltip-desc">${this.escapeHtml(desc)}</div>` : ''}
    `;

    tooltip.style.left = `${clientX + 14}px`;
    tooltip.style.top = `${clientY + 14}px`;
    tooltip.style.display = 'block';
  },

  hideTooltip() {
    const tooltip = document.getElementById('anatomyHudTooltip');
    if (tooltip) tooltip.style.display = 'none';
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // ── Multi-System Model Layering Pipeline ──
  getMaterials() {
    if (!this.materialsCache) {
      this.materialsCache = {
        bone: new THREE.MeshStandardMaterial({
          color: 0xede8d0,
          roughness: 0.38,
          metalness: 0.05,
          name: 'BoneMaterial'
        }),
        muscle: new THREE.MeshStandardMaterial({
          color: 0xb91c1c,
          roughness: 0.55,
          metalness: 0.02,
          name: 'MuscleMaterial'
        }),
        artery: new THREE.MeshStandardMaterial({
          color: 0xdc2626,
          roughness: 0.3,
          metalness: 0.1,
          emissive: 0x550000,
          emissiveIntensity: 0.2,
          name: 'ArteryMaterial'
        }),
        vein: new THREE.MeshStandardMaterial({
          color: 0x2563eb,
          roughness: 0.3,
          metalness: 0.1,
          emissive: 0x001144,
          emissiveIntensity: 0.2,
          name: 'VeinMaterial'
        }),
        nerve: new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          roughness: 0.4,
          metalness: 0.1,
          emissive: 0x665500,
          emissiveIntensity: 0.3,
          name: 'NerveMaterial'
        }),
        organ: new THREE.MeshStandardMaterial({
          color: 0x854d0e,
          roughness: 0.45,
          metalness: 0.05,
          name: 'OrganMaterial'
        }),
        ghost: new THREE.MeshStandardMaterial({
          color: 0x475569,
          roughness: 0.8,
          metalness: 0.0,
          transparent: true,
          opacity: 0.14,
          name: 'GhostReferenceMaterial'
        })
      };
    }
    return this.materialsCache;
  },

  ensureGhostSilhouette() {
    if (!this.ghostSilhouette) {
      const mats = this.getMaterials();
      this.ghostSilhouette = this.createGhostSilhouette(mats.ghost);
      this.ghostSilhouette.name = 'BaseGhostSilhouette';
      this.modelGroup.add(this.ghostSilhouette);
    }
    this.ghostSilhouette.visible = true;
  },

  getOrCreateSystemGroup(systemId) {
    if (this.systemSubgroups.has(systemId)) {
      return this.systemSubgroups.get(systemId);
    }

    const sysGroup = new THREE.Group();
    sysGroup.name = `SystemLayer_${systemId}`;
    sysGroup.userData = { systemId: systemId };

    const mats = this.getMaterials();

    switch (systemId) {
      case 'skeletal':
        this.buildSkeletalModel(sysGroup, mats.bone);
        break;
      case 'muscular':
        this.buildMuscularModel(sysGroup, mats.muscle, mats.bone);
        break;
      case 'circulatory':
        this.buildCirculatoryModel(sysGroup, mats.artery, mats.vein, mats.bone);
        break;
      case 'respiratory':
        this.buildRespiratoryModel(sysGroup, mats.bone);
        break;
      case 'digestive':
        this.buildDigestiveModel(sysGroup, mats.organ, mats.bone);
        break;
      case 'urinary':
        this.buildUrinaryModel(sysGroup, mats.organ, mats.artery, mats.vein);
        break;
      case 'nervous':
        this.buildNervousModel(sysGroup, mats.nerve, mats.bone);
        break;
      case 'reproductive':
        this.buildReproductiveModel(sysGroup, mats.organ, mats.bone);
        break;
      case 'endocrine':
        this.buildEndocrineModel(sysGroup, mats.organ, mats.nerve);
        break;
      default:
        this.buildSkeletalModel(sysGroup, mats.bone);
        break;
    }

    // Tag systemId on all child meshes for tooltip & inspection
    sysGroup.traverse((child) => {
      if (child.isMesh && child.userData) {
        if (!child.userData.systemId) child.userData.systemId = systemId;
      }
    });

    this.systemSubgroups.set(systemId, sysGroup);
    this.modelGroup.add(sysGroup);
    return sysGroup;
  },

  // ── Multi-System Layer Toggling ──
  toggleSystem(systemId) {
    this.ensureGhostSilhouette();
    let isNowActive = false;

    if (this.activeSystems.has(systemId)) {
      if (this.activeSystems.size <= 1) {
        return {
          changed: false,
          reason: 'min_limit',
          activeSystems: Array.from(this.activeSystems)
        };
      }
      this.activeSystems.delete(systemId);
      const group = this.systemSubgroups.get(systemId);
      if (group) group.visible = false;
      isNowActive = false;
    } else {
      this.activeSystems.add(systemId);
      const group = this.getOrCreateSystemGroup(systemId);
      group.visible = true;
      isNowActive = true;
    }

    this.currentSystem = Array.from(this.activeSystems)[this.activeSystems.size - 1] || 'skeletal';
    this.refreshInteractiveMeshes();
    return {
      changed: true,
      activeSystems: Array.from(this.activeSystems),
      isNowActive: isNowActive,
      primarySystem: this.currentSystem
    };
  },

  setSystemLayer(systemId, makeActive) {
    this.ensureGhostSilhouette();
    if (makeActive) {
      this.activeSystems.add(systemId);
      const group = this.getOrCreateSystemGroup(systemId);
      group.visible = true;
    } else {
      if (this.activeSystems.size > 1) {
        this.activeSystems.delete(systemId);
        const group = this.systemSubgroups.get(systemId);
        if (group) group.visible = false;
      }
    }
    this.currentSystem = Array.from(this.activeSystems)[this.activeSystems.size - 1] || 'skeletal';
    this.refreshInteractiveMeshes();
    return Array.from(this.activeSystems);
  },

  async setSystem(systemId) {
    this.currentSystem = systemId;
    this.clearHover();
    this.selectedMesh = null;
    this.hideTooltip();
    this.updatePlaceholderBadge();

    this.ensureGhostSilhouette();
    this.activeSystems.clear();
    this.activeSystems.add(systemId);

    // Hide all existing system groups except the target one
    this.systemSubgroups.forEach((group, id) => {
      group.visible = (id === systemId);
    });

    const group = this.getOrCreateSystemGroup(systemId);
    group.visible = true;

    this.autoCenterAndFrame(this.modelGroup);
    this.refreshInteractiveMeshes();
    this.applyLayerVisibility();
    this.isModelLoaded = true;

    return Array.from(this.activeSystems);
  },

  getActiveSystems() {
    return Array.from(this.activeSystems);
  },

  isSystemActive(systemId) {
    return this.activeSystems.has(systemId);
  },

  // ── GLTF / GLB Loader Helper ──
  loadGLTF(url) {
    return new Promise((resolve) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          resolve(gltf.scene || gltf.scenes[0]);
        },
        undefined,
        (err) => {
          console.warn(`[Anthropotomy 3D] Failed to load GLB from ${url}:`, err);
          resolve(null);
        }
      );
    });
  },

  tagGLTFMeshes(root, systemId) {
    root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (!child.userData.layer) {
          child.userData.layer = this.inferLayer(child.name, systemId);
        }
        if (!child.userData.structureName) {
          child.userData.structureName = child.name || `${systemId} structure`;
        }
      }
    });
  },

  inferLayer(name, systemId) {
    const n = (name || '').toLowerCase();
    if (n.includes('bone') || n.includes('skel') || n.includes('vertebra') || n.includes('femur')) return 'skeleton';
    if (n.includes('muscle') || n.includes('bicep') || n.includes('deltoid')) return 'muscle';
    if (n.includes('artery') || n.includes('vein') || n.includes('aorta') || n.includes('vessel')) return 'vessels';
    if (n.includes('nerve') || n.includes('brain') || n.includes('cord')) return 'nerves';
    if (n.includes('skin') || n.includes('surface')) return 'skin';
    return 'organs';
  },

  // ── Auto-Centering and Camera Framing (THREE.Box3) ──
  autoCenterAndFrame(object) {
    // 1. Compute exact model bounding box
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    // 2. Reposition object so its bounding box center rests at (0, 0, 0)
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);

    // 3. Compute bounding sphere radius
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // 4. Position camera based on field of view so the entire model fits prominently
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2)) * 0.96;
    cameraZ = Math.max(cameraZ, 5.0);

    this.camera.position.set(0, 0.2, cameraZ);
    this.camera.lookAt(0, 0, 0);

    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = cameraZ * 0.3;
      this.controls.maxDistance = cameraZ * 3.0;
      this.controls.update();
    }
  },

  // ── Memory Disposal & Cleanup ──
  disposeCurrentModel() {
    if (!this.modelGroup) return;

    this.systemSubgroups.forEach((group) => {
      this.disposeHierarchy(group);
      this.modelGroup.remove(group);
    });
    this.systemSubgroups.clear();

    if (this.ghostSilhouette) {
      this.disposeHierarchy(this.ghostSilhouette);
      this.modelGroup.remove(this.ghostSilhouette);
      this.ghostSilhouette = null;
    }

    if (this.materialsCache) {
      Object.values(this.materialsCache).forEach(m => this.disposeMaterial(m));
      this.materialsCache = null;
    }

    this.interactiveMeshes = [];
    this.meshMaterialCache.clear();
  },

  disposeHierarchy(obj) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => this.disposeMaterial(m));
          else this.disposeMaterial(child.material);
        }
      }
    });
  },

  disposeMaterial(mat) {
    if (!mat) return;
    if (mat.map) mat.map.dispose();
    if (mat.normalMap) mat.normalMap.dispose();
    if (mat.roughnessMap) mat.roughnessMap.dispose();
    if (mat.emissiveMap) mat.emissiveMap.dispose();
    mat.dispose();
  },

  // ── Interactive Mesh Registry ──
  refreshInteractiveMeshes() {
    this.interactiveMeshes = [];
    this.modelGroup.traverse((child) => {
      if (child.isMesh && child.userData && child.userData.structureName) {
        // Only register if all parent containers are visible
        let p = child;
        let isVis = true;
        while (p && p !== this.modelGroup) {
          if (p.visible === false) { isVis = false; break; }
          p = p.parent;
        }
        if (isVis) {
          this.interactiveMeshes.push(child);
        }
      }
    });
  },

  // ── Layer Visibility ──
  applyLayerVisibility() {
    this.modelGroup.traverse((child) => {
      if (child.isMesh && child.userData && child.userData.layer) {
        const isVisible = this.layers[child.userData.layer] !== false;
        child.visible = isVisible;
      }
    });
  },

  setLayer(layerId, isVisible) {
    this.layers[layerId] = isVisible;
    this.applyLayerVisibility();
  },

  // ── Procedural Anatomical 3D Mannequin Generator ──
  buildProceduralSystem(systemId) {
    const sysGroup = new THREE.Group();
    sysGroup.name = `Procedural_${systemId}`;

    // Standard high-quality physical materials
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xede8d0,
      roughness: 0.38,
      metalness: 0.05,
      name: 'BoneMaterial'
    });

    const muscleMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      roughness: 0.55,
      metalness: 0.02,
      name: 'MuscleMaterial'
    });

    const arteryMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x550000,
      emissiveIntensity: 0.2,
      name: 'ArteryMaterial'
    });

    const veinMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x001144,
      emissiveIntensity: 0.2,
      name: 'VeinMaterial'
    });

    const nerveMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0x665500,
      emissiveIntensity: 0.3,
      name: 'NerveMaterial'
    });

    const organMat = new THREE.MeshStandardMaterial({
      color: 0x854d0e,
      roughness: 0.45,
      metalness: 0.05,
      name: 'OrganMaterial'
    });

    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.8,
      metalness: 0.0,
      transparent: true,
      opacity: 0.14,
      name: 'GhostReferenceMaterial'
    });

    // 1. Build Base Body Ghost Reference (for anatomical spatial orientation)
    const ghostBody = this.createGhostSilhouette(ghostMat);
    sysGroup.add(ghostBody);

    // 2. Build Specialized High-Fidelity Structures per System
    switch (systemId) {
      case 'skeletal':
        this.buildSkeletalModel(sysGroup, boneMat);
        break;
      case 'muscular':
        this.buildMuscularModel(sysGroup, muscleMat, boneMat);
        break;
      case 'circulatory':
        this.buildCirculatoryModel(sysGroup, arteryMat, veinMat, boneMat);
        break;
      case 'respiratory':
        this.buildRespiratoryModel(sysGroup, boneMat);
        break;
      case 'digestive':
        this.buildDigestiveModel(sysGroup, organMat, boneMat);
        break;
      case 'urinary':
        this.buildUrinaryModel(sysGroup, organMat, arteryMat, veinMat);
        break;
      case 'nervous':
        this.buildNervousModel(sysGroup, nerveMat, boneMat);
        break;
      case 'reproductive':
        this.buildReproductiveModel(sysGroup, organMat, boneMat);
        break;
      case 'endocrine':
        this.buildEndocrineModel(sysGroup, organMat, nerveMat);
        break;
      default:
        this.buildSkeletalModel(sysGroup, boneMat);
        break;
    }

    return sysGroup;
  },

  // ── Ghost Silhouette (Anatomical Context) ──
  createGhostSilhouette(mat) {
    const group = new THREE.Group();
    group.name = 'GhostSilhouette';

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 20), mat);
    head.scale.set(0.9, 1.15, 0.95);
    head.position.set(0, 3.4, 0);
    head.userData.layer = 'skin';
    group.add(head);

    // Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 2.5, 20), mat);
    torso.position.set(0, 1.5, 0);
    torso.userData.layer = 'skin';
    group.add(torso);

    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.9, 18), mat);
    pelvis.position.set(0, -0.2, 0);
    pelvis.userData.layer = 'skin';
    group.add(pelvis);

    // Limbs
    [-1, 1].forEach(side => {
      // Arm
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 2.4, 12), mat);
      arm.position.set(side * 1.35, 1.3, 0);
      arm.rotation.z = side * -0.15;
      arm.userData.layer = 'skin';
      group.add(arm);

      // Leg
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.22, 3.2, 14), mat);
      leg.position.set(side * 0.5, -2.1, 0);
      leg.userData.layer = 'skin';
      group.add(leg);
    });

    return group;
  },

  // ── 1. Skeletal System ──
  buildSkeletalModel(parent, boneMat) {
    // Cranium
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.68, 24, 24), boneMat);
    skull.scale.set(0.9, 1.1, 1.0);
    skull.position.set(0, 3.42, 0.05);
    skull.castShadow = true;
    skull.userData = {
      layer: 'skeleton',
      structureName: 'Skull',
      desc: 'Protects the brain and supports facial structures. Composed of 22 bones.'
    };
    parent.add(skull);

    // Mandible (Jawbone)
    const mandible = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.55), boneMat);
    mandible.position.set(0, 2.86, 0.18);
    mandible.castShadow = true;
    mandible.userData = {
      layer: 'skeleton',
      structureName: 'Mandible',
      desc: 'The lower jawbone, enabling mastication (chewing) and speech.'
    };
    parent.add(mandible);

    // Vertebral Column (Spine)
    const spineGroup = new THREE.Group();
    spineGroup.name = 'VertebralColumn';
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.08, 12), boneMat);
      v.position.set(0, 2.7 - (i * 0.12), -0.15 + Math.sin(i * 0.3) * 0.08);
      v.rotation.x = 0.1;
      v.castShadow = true;
      v.userData = {
        layer: 'skeleton',
        structureName: 'Vertebral Column',
        desc: '33 vertebrae forming the spine, protecting the spinal cord.'
      };
      spineGroup.add(v);
    }
    parent.add(spineGroup);

    // Rib Cage
    const ribcageGroup = new THREE.Group();
    ribcageGroup.name = 'RibCage';
    // Sternum
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.1, 0.08), boneMat);
    sternum.position.set(0, 1.5, 0.52);
    sternum.castShadow = true;
    sternum.userData = {
      layer: 'skeleton',
      structureName: 'Rib Cage',
      desc: '12 pairs of ribs and sternum protecting the heart and lungs.'
    };
    ribcageGroup.add(sternum);

    // Rib Rings
    for (let r = 0; r < 9; r++) {
      const yPos = 2.0 - (r * 0.13);
      const radius = 0.55 + Math.sin((r / 8) * Math.PI) * 0.3;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.038, 8, 24, Math.PI * 1.8), boneMat);
      rib.position.set(0, yPos, 0.05);
      rib.rotation.x = Math.PI / 2 + 0.15;
      rib.rotation.z = Math.PI * 0.1;
      rib.castShadow = true;
      rib.userData = {
        layer: 'skeleton',
        structureName: 'Rib Cage',
        desc: '12 pairs of ribs protecting thoracic viscera.'
      };
      ribcageGroup.add(rib);
    }
    parent.add(ribcageGroup);

    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.18, 12, 20, Math.PI * 1.4), boneMat);
    pelvis.position.set(0, 0.05, 0);
    pelvis.rotation.x = Math.PI / 2;
    pelvis.rotation.z = Math.PI * 0.3;
    pelvis.castShadow = true;
    pelvis.userData = {
      layer: 'skeleton',
      structureName: 'Pelvis',
      desc: 'Supports the spine and connects the trunk to the lower limbs.'
    };
    parent.add(pelvis);

    // Bilateral Limbs (Femur, Humerus, etc.)
    [-1, 1].forEach(side => {
      // Humerus (Upper arm)
      const humerus = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.25, 12), boneMat);
      humerus.position.set(side * 1.25, 1.4, 0);
      humerus.rotation.z = side * -0.12;
      humerus.castShadow = true;
      humerus.userData = {
        layer: 'skeleton',
        structureName: 'Humerus',
        desc: 'Long bone of the upper arm connecting shoulder to elbow.'
      };
      parent.add(humerus);

      // Femur (Thigh bone)
      const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.6, 14), boneMat);
      femur.position.set(side * 0.48, -1.0, 0);
      femur.rotation.z = side * 0.06;
      femur.castShadow = true;
      femur.userData = {
        layer: 'skeleton',
        structureName: 'Femur',
        desc: 'The longest and strongest bone in the human body.'
      };
      parent.add(femur);

      // Tibia & Fibula (Lower leg)
      const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 1.5, 12), boneMat);
      tibia.position.set(side * 0.46, -2.6, 0);
      tibia.castShadow = true;
      tibia.userData = {
        layer: 'skeleton',
        structureName: 'Tibia',
        desc: 'The larger, weight-bearing bone of the lower leg (shin bone).'
      };
      parent.add(tibia);
    });
  },

  // ── 2. Muscular System ──
  buildMuscularModel(parent, muscleMat, boneMat) {
    this.buildSkeletalModel(parent, boneMat);

    // Pectoralis Major (Chest)
    [-1, 1].forEach(side => {
      const pec = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.18), muscleMat);
      pec.position.set(side * 0.36, 1.65, 0.48);
      pec.rotation.z = side * 0.15;
      pec.castShadow = true;
      pec.userData = {
        layer: 'muscle',
        structureName: 'Skeletal Muscle',
        desc: 'Pectoralis major: voluntary muscle powering arm adduction and flexion.'
      };
      parent.add(pec);

      // Deltoid (Shoulder cap)
      const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 14), muscleMat);
      deltoid.scale.set(1.1, 1.4, 1.0);
      deltoid.position.set(side * 1.15, 2.05, 0);
      deltoid.castShadow = true;
      deltoid.userData = {
        layer: 'muscle',
        structureName: 'Skeletal Muscle',
        desc: 'Deltoid muscle forming the rounded contour of the shoulder.'
      };
      parent.add(deltoid);

      // Biceps Brachii (Arm)
      const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.75, 12), muscleMat);
      bicep.position.set(side * 1.25, 1.45, 0.08);
      bicep.castShadow = true;
      bicep.userData = {
        layer: 'muscle',
        structureName: 'Biceps Brachii',
        desc: 'Muscle in the anterior compartment of the arm that flexes the elbow.'
      };
      parent.add(bicep);

      // Quadriceps (Thigh)
      const quad = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 1.35, 14), muscleMat);
      quad.position.set(side * 0.5, -0.9, 0.12);
      quad.castShadow = true;
      quad.userData = {
        layer: 'muscle',
        structureName: 'Quadriceps',
        desc: 'Group of four anterior thigh muscles that extend the knee joint.'
      };
      parent.add(quad);
    });

    // Rectus Abdominis (Abs)
    for (let a = 0; a < 3; a++) {
      [-1, 1].forEach(side => {
        const ab = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.12), muscleMat);
        ab.position.set(side * 0.17, 1.2 - (a * 0.28), 0.46);
        ab.castShadow = true;
        ab.userData = {
          layer: 'muscle',
          structureName: 'Skeletal Muscle',
          desc: 'Rectus abdominis: flexes the lumbar spine and stabilizes core.'
        };
        parent.add(ab);
      });
    }

    // Cardiac Muscle (Heart)
    const heart = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 1), muscleMat);
    heart.position.set(-0.12, 1.45, 0.28);
    heart.castShadow = true;
    heart.userData = {
      layer: 'muscle',
      structureName: 'Cardiac Muscle',
      desc: 'Involuntary, specialized striated muscle tissue found only in the heart.'
    };
    parent.add(heart);
  },

  // ── 3. Circulatory System ──
  buildCirculatoryModel(parent, arteryMat, veinMat, boneMat) {
    // Ghost skeleton for spatial context
    this.buildSkeletalModel(parent, boneMat);

    // Heart (4 Chambers)
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 18), arteryMat);
    heart.scale.set(0.9, 1.15, 0.95);
    heart.position.set(-0.14, 1.45, 0.32);
    heart.rotation.z = -0.25;
    heart.castShadow = true;
    heart.userData = {
      layer: 'organs',
      structureName: 'Heart',
      desc: 'Muscular organ pumping blood throughout the body. Features 4 chambers.'
    };
    parent.add(heart);

    // Aorta (Major systemic artery arch)
    const aortaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.08, 1.6, 0.3),
      new THREE.Vector3(-0.05, 1.95, 0.2),
      new THREE.Vector3(0.05, 1.85, -0.05),
      new THREE.Vector3(0.06, 1.3, -0.1),
      new THREE.Vector3(0.04, 0.2, -0.1),
      new THREE.Vector3(0.0, -0.2, -0.08)
    ]);
    const aortaGeo = new THREE.TubeGeometry(aortaCurve, 32, 0.075, 12, false);
    const aorta = new THREE.Mesh(aortaGeo, arteryMat);
    aorta.castShadow = true;
    aorta.userData = {
      layer: 'vessels',
      structureName: 'Aorta',
      desc: 'Largest artery; carries oxygenated blood under high pressure from the heart.'
    };
    parent.add(aorta);

    // Vena Cava (Major systemic vein)
    const vcCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.16, 2.1, 0.0),
      new THREE.Vector3(0.14, 1.5, 0.15),
      new THREE.Vector3(0.15, 0.3, -0.08),
      new THREE.Vector3(0.12, -0.2, -0.08)
    ]);
    const vcGeo = new THREE.TubeGeometry(vcCurve, 24, 0.08, 12, false);
    const venaCava = new THREE.Mesh(vcGeo, veinMat);
    venaCava.castShadow = true;
    venaCava.userData = {
      layer: 'vessels',
      structureName: 'Veins',
      desc: 'Superior and inferior vena cava returning deoxygenated blood to the heart.'
    };
    parent.add(venaCava);

    // Peripheral Vessels (Carotids, Brachial, Iliac, Femoral)
    [-1, 1].forEach(side => {
      // Carotid Artery (Neck)
      const carotid = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), arteryMat);
      carotid.position.set(side * 0.18, 2.55, 0.05);
      carotid.userData = {
        layer: 'vessels',
        structureName: 'Aorta',
        desc: 'Common carotid artery carrying oxygenated blood to head and brain.'
      };
      parent.add(carotid);

      // Jugular Vein (Neck)
      const jugular = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.85, 8), veinMat);
      jugular.position.set(side * 0.28, 2.55, 0.04);
      jugular.userData = {
        layer: 'vessels',
        structureName: 'Veins',
        desc: 'Internal jugular vein draining blood from the brain and face.'
      };
      parent.add(jugular);

      // Femoral Artery & Vein (Thigh)
      const femArt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 2.6, 8), arteryMat);
      femArt.position.set(side * 0.38, -1.6, 0.05);
      femArt.userData = {
        layer: 'vessels',
        structureName: 'Capillaries',
        desc: 'Major femoral vascular conduit delivering systemic flow to limbs.'
      };
      parent.add(femArt);

      const femVein = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 2.6, 8), veinMat);
      femVein.position.set(side * 0.48, -1.6, 0.03);
      femVein.userData = {
        layer: 'vessels',
        structureName: 'Veins',
        desc: 'Femoral vein carrying deoxygenated blood from the leg back to the inferior vena cava.'
      };
      parent.add(femVein);
    });
  },

  // ── 4. Respiratory System ──
  buildRespiratoryModel(parent, boneMat) {
    this.buildSkeletalModel(parent, boneMat);

    const lungMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.45,
      metalness: 0.05,
      name: 'LungMaterial'
    });

    const tracheaMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.1,
      name: 'TracheaMaterial'
    });

    const diaphragmMat = new THREE.MeshStandardMaterial({
      color: 0x0d9488,
      roughness: 0.5,
      metalness: 0.05,
      name: 'DiaphragmMaterial'
    });

    // Trachea (Windpipe with cartilage rings)
    const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.05, 16), tracheaMat);
    trachea.position.set(0, 2.25, 0.2);
    trachea.castShadow = true;
    trachea.userData = {
      layer: 'organs',
      structureName: 'Trachea',
      desc: 'Windpipe connecting larynx to bronchi, reinforced with C-shaped cartilage rings.'
    };
    parent.add(trachea);

    // Primary Bronchi
    [-1, 1].forEach(side => {
      const bronchus = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 10), tracheaMat);
      bronchus.position.set(side * 0.18, 1.62, 0.18);
      bronchus.rotation.z = side * -0.55;
      bronchus.castShadow = true;
      bronchus.userData = {
        layer: 'organs',
        structureName: 'Bronchi',
        desc: 'Branching airways conducting air from trachea into the lung lobes.'
      };
      parent.add(bronchus);
    });

    // Right Lung (3 Lobes)
    const rightLung = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 18), lungMat);
    rightLung.scale.set(0.85, 1.45, 0.95);
    rightLung.position.set(0.52, 1.4, 0.2);
    rightLung.castShadow = true;
    rightLung.userData = {
      layer: 'organs',
      structureName: 'Lungs',
      desc: 'Paired spongy organs facilitating gas exchange. Right lung has 3 lobes.'
    };
    parent.add(rightLung);

    // Left Lung (2 Lobes with cardiac notch)
    const leftLung = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 18), lungMat);
    leftLung.scale.set(0.78, 1.4, 0.9);
    leftLung.position.set(-0.52, 1.4, 0.2);
    leftLung.castShadow = true;
    leftLung.userData = {
      layer: 'organs',
      structureName: 'Lungs',
      desc: 'Left lung with 2 lobes and cardiac notch accommodating the heart.'
    };
    parent.add(leftLung);

    // Diaphragm (Dome Muscle)
    const diaphragm = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), diaphragmMat);
    diaphragm.position.set(0, 0.65, 0.1);
    diaphragm.rotation.x = Math.PI;
    diaphragm.castShadow = true;
    diaphragm.userData = {
      layer: 'muscle',
      structureName: 'Diaphragm',
      desc: 'Dome-shaped primary muscle of respiration separating thorax from abdomen.'
    };
    parent.add(diaphragm);
  },

  // ── 5. Digestive System ──
  buildDigestiveModel(parent, organMat, boneMat) {
    this.buildSkeletalModel(parent, boneMat);

    const stomachMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.4,
      metalness: 0.05,
      name: 'StomachMaterial'
    });

    const liverMat = new THREE.MeshStandardMaterial({
      color: 0x854d0e,
      roughness: 0.35,
      metalness: 0.02,
      name: 'LiverMaterial'
    });

    const intestineMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.5,
      metalness: 0.02,
      name: 'IntestineMaterial'
    });

    // Stomach (J-Shape Pouch)
    const stomachCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.1, 1.35, 0.18),
      new THREE.Vector3(-0.35, 1.1, 0.32),
      new THREE.Vector3(-0.25, 0.75, 0.35),
      new THREE.Vector3(0.08, 0.78, 0.3)
    ]);
    const stomachGeo = new THREE.TubeGeometry(stomachCurve, 24, 0.22, 14, false);
    const stomach = new THREE.Mesh(stomachGeo, stomachMat);
    stomach.castShadow = true;
    stomach.userData = {
      layer: 'organs',
      structureName: 'Stomach',
      desc: 'J-shaped muscular organ churning food and secreting gastric acid (pH 1.5-3.5).'
    };
    parent.add(stomach);

    // Liver (Triangular right lobe)
    const liver = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 0.65, 16), liverMat);
    liver.scale.set(1.4, 0.9, 0.95);
    liver.position.set(0.42, 1.05, 0.28);
    liver.rotation.z = -0.3;
    liver.castShadow = true;
    liver.userData = {
      layer: 'organs',
      structureName: 'Liver',
      desc: 'Largest internal gland producing bile, storing glycogen, and detoxifying blood.'
    };
    parent.add(liver);

    // Pancreas
    const pancreas = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.16), stomachMat);
    pancreas.position.set(0.05, 0.7, 0.18);
    pancreas.rotation.z = 0.15;
    pancreas.userData = {
      layer: 'organs',
      structureName: 'Pancreas',
      desc: 'Exocrine and endocrine gland producing digestive enzymes, insulin, and glucagon.'
    };
    parent.add(pancreas);

    // Small Intestine (Coiled Mass)
    const smallInt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.35, 0.085, 48, 12), intestineMat);
    smallInt.position.set(0, 0.25, 0.32);
    smallInt.castShadow = true;
    smallInt.userData = {
      layer: 'organs',
      structureName: 'Small Intestine',
      desc: '6-7 meter tubular site where 90% of nutrient absorption occurs.'
    };
    parent.add(smallInt);

    // Large Intestine (Surrounding Colon Frame)
    const colonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.5, -0.2, 0.28),   // Cecum
      new THREE.Vector3(0.52, 0.55, 0.28),  // Ascending
      new THREE.Vector3(0.0, 0.62, 0.32),   // Transverse
      new THREE.Vector3(-0.52, 0.55, 0.28), // Descending
      new THREE.Vector3(-0.4, -0.2, 0.26)   // Sigmoid
    ]);
    const colonGeo = new THREE.TubeGeometry(colonCurve, 32, 0.11, 12, false);
    const colon = new THREE.Mesh(colonGeo, intestineMat);
    colon.castShadow = true;
    colon.userData = {
      layer: 'organs',
      structureName: 'Large Intestine',
      desc: 'Absorbs water and electrolytes, housing the gut microbiome.'
    };
    parent.add(colon);
  },

  // ── 6. Urinary System ──
  buildUrinaryModel(parent, organMat, arteryMat, veinMat) {
    const kidneyMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.35,
      metalness: 0.05,
      name: 'KidneyMaterial'
    });

    const bladderMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.4,
      metalness: 0.05,
      name: 'BladderMaterial'
    });

    // Kidneys (Left and Right Bean-Shaped Organs)
    [-1, 1].forEach((side, idx) => {
      const kidney = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), kidneyMat);
      kidney.scale.set(0.7, 1.25, 0.85);
      // Right kidney sits slightly lower due to the liver
      const yPos = idx === 1 ? 0.72 : 0.88;
      kidney.position.set(side * 0.48, yPos, -0.05);
      kidney.rotation.z = side * -0.15;
      kidney.castShadow = true;
      kidney.userData = {
        layer: 'organs',
        structureName: 'Kidneys',
        desc: 'Bean-shaped retroperitoneal organs filtering metabolic waste and producing urine.'
      };
      parent.add(kidney);

      // Ureters (Tubes descending to bladder)
      const ureterCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.42, yPos - 0.15, -0.02),
        new THREE.Vector3(side * 0.28, 0.2, 0.05),
        new THREE.Vector3(side * 0.12, -0.22, 0.18)
      ]);
      const ureterGeo = new THREE.TubeGeometry(ureterCurve, 16, 0.028, 8, false);
      const ureter = new THREE.Mesh(ureterGeo, bladderMat);
      ureter.userData = {
        layer: 'organs',
        structureName: 'Ureters',
        desc: 'Muscular tubes propelling urine from renal pelvis to bladder via peristalsis.'
      };
      parent.add(ureter);
    });

    // Urinary Bladder
    const bladder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), bladderMat);
    bladder.position.set(0, -0.32, 0.22);
    bladder.castShadow = true;
    bladder.userData = {
      layer: 'organs',
      structureName: 'Urinary Bladder',
      desc: 'Elastic muscular sac with detrusor muscle storing 300-500 mL of urine.'
    };
    parent.add(bladder);

    // Urethra
    const urethra = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 8), bladderMat);
    urethra.position.set(0, -0.58, 0.2);
    urethra.userData = {
      layer: 'organs',
      structureName: 'Urethra',
      desc: 'Terminal conduit discharging urine from bladder outside the body.'
    };
    parent.add(urethra);
  },

  // ── 7. Nervous System ──
  buildNervousModel(parent, nerveMat, boneMat) {
    this.buildSkeletalModel(parent, boneMat);

    const brainMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      roughness: 0.4,
      metalness: 0.05,
      emissive: 0x3b0764,
      emissiveIntensity: 0.2,
      name: 'BrainMaterial'
    });

    // Cerebrum (Hemispheres)
    [-1, 1].forEach(side => {
      const hemisphere = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 20), brainMat);
      hemisphere.scale.set(0.72, 0.95, 1.15);
      hemisphere.position.set(side * 0.24, 3.48, 0.05);
      hemisphere.castShadow = true;
      hemisphere.userData = {
        layer: 'nerves',
        structureName: 'Cerebrum',
        desc: 'Largest brain region; controls higher cognitive functions, thought, and sensory input.'
      };
      parent.add(hemisphere);
    });

    // Cerebellum
    const cerebellum = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), brainMat);
    cerebellum.position.set(0, 3.02, -0.25);
    cerebellum.castShadow = true;
    cerebellum.userData = {
      layer: 'nerves',
      structureName: 'Cerebellum',
      desc: 'Coordinates voluntary movement, posture, and fine motor precision.'
    };
    parent.add(cerebellum);

    // Spinal Cord
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 2.7, 12), nerveMat);
    cord.position.set(0, 1.45, -0.15);
    cord.castShadow = true;
    cord.userData = {
      layer: 'nerves',
      structureName: 'Spinal Cord',
      desc: 'Nerve superhighway transmitting sensory and motor impulses between brain and body.'
    };
    parent.add(cord);

    // Peripheral Nerves (Brachial & Sciatic)
    [-1, 1].forEach(side => {
      // Brachial Plexus into arm
      const armNerve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 2.1, 8), nerveMat);
      armNerve.position.set(side * 1.15, 1.35, 0);
      armNerve.rotation.z = side * -0.12;
      armNerve.userData = {
        layer: 'nerves',
        structureName: 'Neurons',
        desc: 'Peripheral nerves conducting rapid electrical action potentials to extremities.'
      };
      parent.add(armNerve);

      // Sciatic Nerve into leg
      const legNerve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 3.1, 8), nerveMat);
      legNerve.position.set(side * 0.44, -1.65, -0.05);
      legNerve.userData = {
        layer: 'nerves',
        structureName: 'Neurons',
        desc: 'Sciatic nerve: longest and widest single nerve in the human body.'
      };
      parent.add(legNerve);
    });
  },

  // ── 8. Reproductive System ──
  buildReproductiveModel(parent, organMat, boneMat) {
    this.buildSkeletalModel(parent, boneMat);

    const reproMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      roughness: 0.4,
      metalness: 0.05,
      name: 'ReproductiveMaterial'
    });

    // Uterus
    const uterus = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 14), reproMat);
    uterus.rotation.x = Math.PI;
    uterus.position.set(0, -0.22, 0.15);
    uterus.castShadow = true;
    uterus.userData = {
      layer: 'organs',
      structureName: 'Uterus',
      desc: 'Hollow, pear-shaped muscular organ where embryo implants and gestation occurs.'
    };
    parent.add(uterus);

    // Ovaries / Gonads
    [-1, 1].forEach(side => {
      const ovary = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), reproMat);
      ovary.position.set(side * 0.38, -0.12, 0.12);
      ovary.castShadow = true;
      ovary.userData = {
        layer: 'organs',
        structureName: 'Ovaries',
        desc: 'Female gonads producing ova and sex hormones (estrogen and progesterone).'
      };
      parent.add(ovary);
    });
  },

  // ── 9. Endocrine System ──
  buildEndocrineModel(parent, organMat, nerveMat) {
    const glandMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x0f766e,
      emissiveIntensity: 0.35,
      name: 'EndocrineGlandMaterial'
    });

    // Pituitary Gland (Base of Brain)
    const pituitary = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), glandMat);
    pituitary.position.set(0, 3.25, 0.08);
    pituitary.castShadow = true;
    pituitary.userData = {
      layer: 'organs',
      structureName: 'Pituitary Gland',
      desc: '"Master gland" secreting TSH, ACTH, GH, and LH/FSH regulating all other endocrine glands.'
    };
    parent.add(pituitary);

    // Thyroid Gland (Neck Butterfly)
    const thyroid = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.07, 10, 16, Math.PI * 1.3), glandMat);
    thyroid.position.set(0, 2.45, 0.28);
    thyroid.rotation.z = Math.PI * 0.85;
    thyroid.castShadow = true;
    thyroid.userData = {
      layer: 'organs',
      structureName: 'Thyroid Gland',
      desc: 'Butterfly-shaped cervical gland regulating cellular metabolic rate, T3, and T4.'
    };
    parent.add(thyroid);

    // Adrenal Glands (On top of kidneys)
    [-1, 1].forEach((side, idx) => {
      const adrenal = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 8), glandMat);
      const yPos = idx === 1 ? 0.98 : 1.12;
      adrenal.position.set(side * 0.48, yPos, -0.05);
      adrenal.castShadow = true;
      adrenal.userData = {
        layer: 'organs',
        structureName: 'Adrenal Glands',
        desc: 'Crescent caps secreting adrenaline, noradrenaline, cortisol, and aldosterone.'
      };
      parent.add(adrenal);
    });

    // Pancreas (Islets of Langerhans)
    const pancreas = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.12), glandMat);
    pancreas.position.set(0.04, 0.72, 0.18);
    pancreas.userData = {
      layer: 'organs',
      structureName: 'Pancreas',
      desc: 'Contains endocrine Islets of Langerhans secreting insulin and glucagon.'
    };
    parent.add(pancreas);
  },

  // ── Animation & Render Loop ──
  startRenderLoop() {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);

      if (this.controls) {
        // Only auto-rotate if enabled and student is not currently dragging
        if (this.autoRotate && !this.isPointerDown) {
          this.modelGroup.rotation.y += 0.007;
        }
        this.controls.update();
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  },

  // ── Public Camera & Rotation Control Shortcuts (Invoked by UI) ──
  setRotation(isRotating) {
    this.autoRotate = !!isRotating;
    return this.autoRotate;
  },

  toggleRotation() {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
  },

  zoomIn() {
    if (!this.camera) return;
    this.camera.position.multiplyScalar(0.85);
    if (this.controls) this.controls.update();
  },

  zoomOut() {
    if (!this.camera) return;
    this.camera.position.multiplyScalar(1.18);
    if (this.controls) this.controls.update();
  },

  resetView() {
    if (!this.modelGroup) return;
    this.modelGroup.rotation.set(0, 0, 0);
    this.autoCenterAndFrame(this.modelGroup);
  },

  toggleLabels() {
    this.showLabels = !this.showLabels;
    if (!this.showLabels) this.hideTooltip();
    return this.showLabels;
  },

  toggleHighlight() {
    this.highlightActive = !this.highlightActive;
    this.interactiveMeshes.forEach(mesh => {
      if (mesh.material && mesh.material.emissive) {
        if (this.highlightActive) {
          mesh.material.emissive.setHex(0x14b8a6);
          mesh.material.emissiveIntensity = 0.35;
        } else if (mesh !== this.selectedMesh && mesh !== this.hoveredMesh) {
          this.restoreMeshMaterial(mesh);
        }
      }
    });
    return this.highlightActive;
  },

  // ── Placeholder UI Badge Management ──
  updatePlaceholderBadge() {
    let badge = document.getElementById('placeholderBadge');
    if (!badge && this.canvas && this.canvas.parentElement) {
      badge = document.createElement('div');
      badge.id = 'placeholderBadge';
      badge.className = 'anatomy-placeholder-badge';
      badge.innerHTML = `
        <div class="placeholder-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="placeholder-icon">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span class="placeholder-label">3D Model Placeholder (Three.js WebGL Engine Ready for GLB Drop-in)</span>
          <button type="button" class="placeholder-info-btn" onclick="openEngineSpecsModal()" title="View WebGL Engine Specs">Details</button>
        </div>
      `;
      this.canvas.parentElement.appendChild(badge);
    }
    if (badge) {
      badge.style.display = this.isProcedural ? 'block' : 'none';
    }
  },

  // ── WebGL Error Display ──
  displayWebGLError(msg) {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const errBox = document.createElement('div');
    errBox.className = 'webgl-error-fallback';
    errBox.innerHTML = `
      <div style="text-align:center;padding:var(--space-6);color:var(--text-primary);">
        <div style="font-size:2rem;margin-bottom:var(--space-2);">⚠️</div>
        <h3 style="font-size:1.125rem;font-weight:600;margin-bottom:var(--space-2);">3D Engine Notice</h3>
        <p style="font-size:0.875rem;color:var(--text-secondary);max-width:420px;margin:0 auto var(--space-4);line-height:1.5;">${this.escapeHtml(msg)}</p>
        <button class="btn btn-primary" onclick="window.location.reload()">Reload Viewer</button>
      </div>
    `;
    parent.appendChild(errBox);
  }
};

// Expose globally
window.AnatomyViewer = AnatomyViewer;
