'use strict';
// Pure helpers for the layered anatomy viewer. No DOM or WebGL access, so Node can unit test them.
const AnatomyLayersCore = (() => {
    const UNIDENTIFIED_TEXT = "This part hasn't been identified yet. Its description and function will be added after review.";

    // Three.js copies glTF node extras into userData. A multi-material part is a Group of meshes,
    // so walk up from the hit mesh to the object that carries the part ID.
    function resolvePart(object) {
        for (let node = object; node; node = node.parent) {
            if (node.userData && node.userData.part_id) return node;
        }
        return null;
    }

    function pickPart(hits, focusedPartId) {
        let first = null;
        for (const hit of hits) {
            const part = resolvePart(hit.object);
            if (!part) continue;
            if (focusedPartId && part.userData.part_id === focusedPartId) return part;
            if (!first) first = part;
        }
        return first;
    }

    function matchStructure(structures, part) {
        if (!part) return null;
        const keys = [part.userData.part_id, part.name, part.parent && part.parent.name].filter(Boolean);
        return (structures || []).find(s => s.mesh_name && keys.includes(s.mesh_name)) || null;
    }

    function partInfo(data, systemNames, structure) {
        const names = systemNames || {};
        const systems = Array.isArray(data.systems) ? data.systems : [];
        const unidentified = !structure && data.identity_status === 'source_identity_required';
        return {
            title: (structure && structure.name) || data.name || 'Unnamed part',
            systemName: names[data.system_id] || data.system_id || '',
            alsoPartOf: systems.filter(id => id !== data.system_id).map(id => names[id] || id),
            description: (structure && structure.desc) || data.description || (unidentified ? UNIDENTIFIED_TEXT : 'No description provided.'),
            func: data.function || '',
            reference: /^https?:\/\//i.test(data.reference || '') ? data.reference : '',
            unidentified
        };
    }

    function toggleStatus(system, state) {
        if (!system.modelUrl) return 'No 3D model yet';
        if (!state) return '';
        if (state.status === 'loading') return state.progress == null ? 'Loading…' : `Loading ${state.progress}%`;
        if (state.status === 'error') return "Couldn't load — select to retry";
        return '';
    }

    // Distance at which a sphere of this radius fits the narrower of the two fields of view.
    function fitDistance(radius, fovDeg, aspect, margin = 1.3) {
        const vfov = fovDeg * Math.PI / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
        return Math.max(radius, 1e-6) / Math.sin(Math.min(vfov, hfov) / 2) * margin;
    }

    // Orbit distance limits for a model: close enough for small parts, never lost in space.
    function distanceLimits(diagonal) {
        const size = Number.isFinite(diagonal) && diagonal > 0 ? diagonal : 1;
        return {min: size * 0.02, max: size * 4};
    }

    // Emissive glow per material state. Only hovering glows; a selected (focused) part keeps its own
    // colour and stands out because everything else fades.
    function glowFor(kind) {
        return kind === 'hover' ? {color: 0x1d6f6a, intensity: 1} : null;
    }

    // Surface finish per body system for the layered models: matte bone, slightly glossy and deeper
    // red muscle, wet-looking vessels and organs. colorScale darkens the base colour.
    const ORGAN_LOOK = {roughness: 0.4, metalness: 0, colorScale: 1};
    const LOOKS = {
        skeletal: {roughness: 0.8, metalness: 0, colorScale: 1},
        muscular: {roughness: 0.5, metalness: 0, colorScale: 0.65},
        circulatory: {roughness: 0.35, metalness: 0, colorScale: 1},
        digestive: ORGAN_LOOK, respiratory: ORGAN_LOOK, urinary: ORGAN_LOOK,
        reproductive: ORGAN_LOOK, endocrine: ORGAN_LOOK, lymphatic: ORGAN_LOOK
    };
    function materialLook(systemId) {
        return {...(LOOKS[systemId] || {roughness: 0.6, metalness: 0, colorScale: 1})};
    }

    // Natural tissue colours (sRGB) and surface roughness. Z-Anatomy colour-codes many structures
    // (muscles by action, blue veins, cyan bursae, purple capsules); the explorer shows how they look instead.
    const tissue = (color, roughness) => ({color, roughness, metalness: 0});
    const TISSUE = {
        bone: tissue('#ddd0b3', 0.75), cartilage: tissue('#d9ddd6', 0.35), ligament: tissue('#e2dccb', 0.4),
        tendon: tissue('#e8e1d2', 0.35), capsule: tissue('#ddd5c6', 0.45), bursa: tissue('#e4e0d8', 0.3),
        fat: tissue('#e3c477', 0.5), teeth: tissue('#efe7d2', 0.3), toothRoot: tissue('#e2d6bb', 0.5),
        muscle: tissue('#7c2d26', 0.55), heart: tissue('#702823', 0.5),
        artery: tissue('#a6342d', 0.4), vein: tissue('#4e2538', 0.4),
        nerve: tissue('#e5d7ad', 0.45), greyMatter: tissue('#c4a49b', 0.6), whiteMatter: tissue('#e8e0d4', 0.6),
        nucleus: tissue('#b38b7e', 0.6), cerebellum: tissue('#b89087', 0.6), csf: tissue('#d8e2e2', 0.3),
        dura: tissue('#dcd3c4', 0.45), choroid: tissue('#9e4d4a', 0.5),
        sclera: tissue('#ece8df', 0.35), cornea: tissue('#d3dbdc', 0.15), iris: tissue('#5c3c2a', 0.5), retina: tissue('#b5634f', 0.5),
        tympanic: tissue('#e6ddce', 0.35), mucosa: tissue('#c47c7e', 0.4), intestine: tissue('#cf8f86', 0.45),
        liver: tissue('#7a3026', 0.4), gallbladder: tissue('#506b3a', 0.35), pancreas: tissue('#dcb28a', 0.5),
        gland: tissue('#c98b70', 0.5), thyroid: tissue('#9c4a3b', 0.45), adrenal: tissue('#d0a04c', 0.5),
        spleen: tissue('#6c2a37', 0.45), lymph: tissue('#c99e88', 0.5), thymus: tissue('#d6b49c', 0.5),
        lung: tissue('#d39a95', 0.55), bronchi: tissue('#ded5c8', 0.4), pleura: tissue('#e3d6cf', 0.35),
        kidney: tissue('#7a3429', 0.4), bladder: tissue('#d2a090', 0.45), duct: tissue('#d8c5a6', 0.45),
        peritoneum: tissue('#e0c07e', 0.45), testis: tissue('#e0cdc1', 0.45), erectile: tissue('#b06a6c', 0.45),
        fascia: tissue('#e0d9cd', 0.45)
    };
    const FIBROUS_MATERIALS = {bone: 'bone', suture: 'bone', cartilage: 'cartilage', ligament: 'ligament', tendon: 'tendon',
        'articular capsule': 'capsule', bursa: 'bursa', fat: 'fat', teeth: 'teeth', 'teeth-roots': 'toothRoot', dentine: 'toothRoot'};
    const NAME_RULES = [
        [/falx|tentorium|\bdura\b/, 'dura'], [/choroid plexus/, 'choroid'], [/zonular/, 'ligament'],
        [/liver/, 'liver'], [/gallbladder|bile duct|cystic duct|hepatic duct/, 'gallbladder'], [/spleen/, 'spleen'],
        [/pancrea/, 'pancreas'], [/kidney/, 'kidney'], [/urinary bladder/, 'bladder'], [/thyroid/, 'thyroid'],
        [/suprarenal|adrenal/, 'adrenal'], [/thymus/, 'thymus'], [/hypophysis|pineal/, 'gland'],
        [/testis|epididymis/, 'testis'], [/corpus cavernosum|corpus spongiosum|glans/, 'erectile'],
        [/lobe of (left|right) lung/, 'lung'], [/retina/, 'retina'], [/\biris\b/, 'iris'],
        [/cornea|\blens\b|anterior chamber|vitreous/, 'cornea'], [/segment of eyeball|sclera/, 'sclera'],
        [/tympanic membrane/, 'tympanic'], [/pleura/, 'pleura']
    ];
    const SYSTEM_NAME_RULES = {
        circulatory: [[/papillary|atrium|ventricle|myocard|heart/, 'heart']],
        nervous: [[/corpus callosum|commissure|tract|fasciculus|peduncle|internal capsule|fornix|white matter/, 'whiteMatter']]
    };
    const MATERIAL_RULES = [
        [/^pulmonary artery/, 'vein'], [/^pulmonary vein/, 'artery'], [/^artery/, 'artery'], [/^vein/, 'vein'],
        [/^nerve/, 'nerve'], [/^white matter/, 'whiteMatter'], [/^nucleus/, 'nucleus'], [/^cerebellum/, 'cerebellum'],
        [/^brain|lobe$|insula|sulci/, 'greyMatter'], [/^lcr/, 'csf'], [/^cornea/, 'cornea'], [/^iris/, 'iris'], [/^eye/, 'sclera'],
        [/^mucosa/, 'mucosa'], [/^intestine/, 'intestine'], [/^gallbladder/, 'gallbladder'], [/^gland/, 'gland'],
        [/^peritoneum/, 'peritoneum'], [/^ductus/, 'duct'], [/^lung/, 'lung'], [/^bronchi/, 'bronchi'],
        [/^fascia/, 'fascia'], [/^lymph/, 'lymph']
    ];
    const SYSTEM_FALLBACK = {muscular: 'muscle', circulatory: 'heart', skeletal: 'bone', nervous: 'greyMatter',
        lymphatic: 'lymph', respiratory: 'lung', digestive: 'intestine', urinary: 'kidney', reproductive: 'mucosa', endocrine: 'gland'};

    // The tissue look for one material on one part, or null for systems the palette does not cover.
    function tissueLook(systemId, materialName, partName) {
        const material = String(materialName || '').toLowerCase().replace(/-\d+$/, '').trim();
        const name = String(partName || '').toLowerCase();
        const pick = key => ({...TISSUE[key]});
        if (/\bnerves?\b/.test(name) && !/nucle|artery|vein/.test(name)) return pick('nerve');
        if (/falx|tentorium|\bdura\b/.test(name)) return pick('dura');
        if (FIBROUS_MATERIALS[material]) return pick(FIBROUS_MATERIALS[material]);
        for (const [pattern, key] of [...NAME_RULES, ...(SYSTEM_NAME_RULES[systemId] || [])]) if (pattern.test(name)) return pick(key);
        for (const [pattern, key] of MATERIAL_RULES) if (pattern.test(material)) return pick(key);
        return SYSTEM_FALLBACK[systemId] ? pick(SYSTEM_FALLBACK[systemId]) : null;
    }

    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function contextAfterDisable(enabledOrder, disabledId, current) {
        if (current !== disabledId) return current;
        const remaining = enabledOrder.filter(id => id !== disabledId);
        return remaining.length ? remaining[remaining.length - 1] : current;
    }

    return {UNIDENTIFIED_TEXT, resolvePart, pickPart, matchStructure, partInfo, toggleStatus, fitDistance, distanceLimits, glowFor, materialLook, TISSUE, tissueLook, easeInOutCubic, contextAfterDisable};
})();
if (typeof module === 'object' && module.exports) module.exports = AnatomyLayersCore;
