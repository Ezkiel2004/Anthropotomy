// Thin wrapper over the global layered engine `AnatomyViewer` (assets/js/model-viewer.js, Three.js r128).
// Adds the explorer's toolbar behavior: animated zoom and reset, auto-rotate that pauses while the user
// drags, PNG export, fullscreen with a pseudo-fullscreen fallback, and structure highlighting.
import {saveFileName} from './format.js';

// A top-level const in a classic script is a global binding but not a window property, so use the bare name.
const engine = AnatomyViewer;
const RESUME_DELAY = 3000;
let viewerReady = false, rotateWanted = false, resumeTimer = null;

export function init(canvas, {onPartClick, labelFor}) {
    try { engine.init(canvas); } catch (error) { console.warn('3D viewing is unavailable.', error); return false; }
    engine.onPartClick = onPartClick; engine.labelFor = labelFor;
    // Auto rotate pauses while the user drags and resumes after 3 s of idle time.
    engine.controls.addEventListener('start', () => { clearTimeout(resumeTimer); engine.controls.autoRotate = false; });
    engine.controls.addEventListener('end', () => {
        clearTimeout(resumeTimer);
        if (rotateWanted) resumeTimer = setTimeout(() => { engine.controls.autoRotate = rotateWanted; }, RESUME_DELAY);
    });
    viewerReady = true;
    return true;
}

export const ready = () => viewerReady;
export const layerState = id => (viewerReady ? engine.layerState(id) : null);
export const hasVisibleLayer = () => viewerReady && engine.hasVisibleLayer();

// Switching a layer off also frees its GPU resources. The off path is synchronous on purpose:
// a click that switches the system back on right away must find the old layer already gone.
export function setLayer(raw, on, onProgress) {
    if (on) return engine.setLayerVisible(raw, true, onProgress);
    engine.setLayerVisible(raw, false); // hiding has no awaits; its side effects happen now
    engine.disposeLayer(raw.id);
    return Promise.resolve(null);
}

// Pixels of canvas covered by the info panel (right) or bottom sheet (bottom).
export const setViewInset = (right, bottom) => { if (viewerReady) engine.setViewInset(right, bottom); };
export const zoomStep = direction => engine.zoom(direction > 0 ? .85 : 1.15, undefined, true);
export const reset = () => engine.resetView(true);
export const fit = () => engine.resetView(false);

export function toggleRotate() {
    rotateWanted = !rotateWanted;
    clearTimeout(resumeTimer);
    engine.controls.autoRotate = rotateWanted;
    return rotateWanted;
}

// Renders the current view once and downloads it as a PNG. Resolves false when the browser cannot export.
export function saveImage(systemCode) {
    return new Promise(resolve => {
        try {
            engine.renderer.render(engine.scene, engine.camera);
            engine.canvas.toBlob(blob => {
                if (!blob) { resolve(false); return; }
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = saveFileName(systemCode, new Date());
                document.body.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                resolve(true);
            }, 'image/png');
        } catch (error) { console.warn('Image could not be saved.', error); resolve(false); }
    });
}

// ── Fullscreen: native API first, then a fixed-position fallback (e.g. iPhone Safari) ──
const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
export const isFullscreen = el => nativeElement() === el || el.classList.contains('is-pseudo-fullscreen');

function setPseudo(el, on) {
    el.classList.toggle('is-pseudo-fullscreen', on);
    el.dispatchEvent(new Event('pseudofullscreenchange'));
}

export function onFullscreenChange(el, callback) {
    const handler = () => callback(isFullscreen(el));
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    el.addEventListener('pseudofullscreenchange', handler);
}

export async function toggleFullscreen(el) {
    if (el.classList.contains('is-pseudo-fullscreen')) { setPseudo(el, false); return; }
    if (nativeElement()) {
        try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (error) { console.warn('Fullscreen could not be closed.', error); }
        return;
    }
    const request = typeof el.requestFullscreen === 'function' ? el.requestFullscreen
        : typeof el.webkitRequestFullscreen === 'function' ? el.webkitRequestFullscreen : null;
    if (request) {
        try { await request.call(el); return; } catch { /* refused, e.g. without a user gesture: use the fallback */ }
    }
    setPseudo(el, true);
}

export function exitPseudoFullscreen(el) {
    if (!el.classList.contains('is-pseudo-fullscreen')) return false;
    setPseudo(el, false);
    return true;
}

// ── Highlight ──
export function highlightStructure(meshName) {
    const part = viewerReady ? engine.findPart(meshName) : null;
    if (part) engine.focusPart(part);
    return part;
}
export const focusPart = part => engine.focusPart(part);
export const clearHighlight = () => { if (viewerReady) engine.clearFocus(); };
export const focusedPart = () => (viewerReady ? engine.focusedPart : null);
