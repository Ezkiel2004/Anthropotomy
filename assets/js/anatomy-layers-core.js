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

    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function contextAfterDisable(enabledOrder, disabledId, current) {
        if (current !== disabledId) return current;
        const remaining = enabledOrder.filter(id => id !== disabledId);
        return remaining.length ? remaining[remaining.length - 1] : current;
    }

    return {UNIDENTIFIED_TEXT, resolvePart, pickPart, matchStructure, partInfo, toggleStatus, fitDistance, distanceLimits, glowFor, easeInOutCubic, contextAfterDisable};
})();
if (typeof module === 'object' && module.exports) module.exports = AnatomyLayersCore;
