// Entry point of the 3D Anatomy Explorer on the student and teacher pages.
// Loads anatomy content, builds the system chips, wires the in-viewer toolbar and keyboard shortcuts,
// shows the viewer's state overlay, records student exploration analytics, and connects the viewer
// (viewer.js) to the info panel (panel.js). Relies on the classic-script globals AnatomyData,
// AnatomyLayersCore, AnatomyViewer, API_BASE and Auth that the page loads before this module.
import * as viewer from './viewer.js';
import {initPanel, setOpen, isOpen, togglePanel, renderHeader, renderPanel, renderSelection, setPressedStructure} from './panel.js';
import {icon} from './icons.js';
import {mergeSystem} from './data.js';
import {shortcutAction, stageState, panelDefault} from './format.js';

const $ = id => document.getElementById(id);
const teacherExplorer = document.body.dataset.anatomyRole === 'teacher';
const studentPreview = teacherExplorer && new URLSearchParams(location.search).get('preview') === 'student';
const explorer = $('explorer'), chipBox = $('systemChips'), stateBox = $('viewerState'), live = $('explorerLive');
const systemsMenu = $('systemsMenu'), systemsToggle = $('systemsToggle'), systemsCount = $('systemsCount');
const toolbar = explorer.querySelector('.toolbar');
const toolButtons = [...toolbar.querySelectorAll('.tool-btn')];
const tool = action => toolbar.querySelector(`[data-action="${action}"]`);
const VIEW_TOOLS = ['zoom-in', 'zoom-out', 'reset', 'rotate', 'save'];
const TOOL_ICONS = {'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', reset: 'reset', rotate: 'rotate', save: 'save', fullscreen: 'maximize', info: 'info'};
const LEGACY_NOTE = "This model isn't part of the layered body, so it's shown on its own.";

let merged = new Map(), contextSystem = null, viewerReady = false;
let stageMessage = 'Loading anatomy content…', failedId = null;
let activeSeconds = 0, lastTick = Date.now(), interactions = 0, contextVersion = 0, focusVersion = 0, rovingIndex = 0;
const viewed = new Set();
const enabledOrder = []; // ids of switched-on systems, oldest first
let teacherHooks = {onContext() {}};

function announce(message) {
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = message; });
}

// ── State overlay and tool availability ──
const stateSpinner = Object.assign(document.createElement('span'), {className: 'viewer__spinner'});
stateSpinner.setAttribute('aria-hidden', 'true');
const stateText = Object.assign(document.createElement('p'), {className: 'viewer__message'});
const retryButton = Object.assign(document.createElement('button'), {type: 'button', className: 'viewer__retry', textContent: 'Retry'});
retryButton.addEventListener('click', () => {
    const system = AnatomyData.getSystem(retryButton.dataset.system);
    failedId = null;
    if (system) toggleSystem(system);
});
stateBox.append(stateSpinner, stateText, retryButton);

function updateStage() {
    const loading = enabledOrder.map(id => viewer.layerState(id)).find(state => state && state.status === 'loading') || null;
    const state = stageMessage ? {kind: 'message', message: stageMessage}
        : stageState({viewerReady, hasVisible: viewer.hasVisibleLayer(), loading, contextHasModel: !contextSystem || Boolean(contextSystem.modelUrl), failedId});
    const retryHadFocus = document.activeElement === retryButton;
    stateBox.hidden = state.kind === 'ready';
    stateBox.dataset.kind = state.kind;
    stateSpinner.hidden = state.kind !== 'loading';
    retryButton.hidden = state.kind !== 'error';
    if (retryHadFocus && retryButton.hidden) $('anatomyCanvas').focus(); // Retry hides while the model reloads
    retryButton.dataset.system = state.retryId || '';
    if (stateText.textContent !== state.message) stateText.textContent = state.message;
    setViewToolsEnabled(state.kind === 'ready');
}

function setViewToolsEnabled(enabled) {
    VIEW_TOOLS.forEach(action => {
        const button = tool(action);
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', String(!enabled));
    });
    syncRoving();
}

// ── Toolbar: one Tab stop, arrow keys move between enabled buttons ──
function syncRoving() {
    const enabled = toolButtons.filter(button => !button.disabled);
    if (!enabled.includes(toolButtons[rovingIndex])) rovingIndex = toolButtons.indexOf(enabled[0]);
    toolButtons.forEach((button, index) => { button.tabIndex = index === rovingIndex ? 0 : -1; });
}
toolbar.addEventListener('focusin', event => {
    const index = toolButtons.indexOf(event.target);
    if (index >= 0) { rovingIndex = index; syncRoving(); }
});
toolbar.addEventListener('keydown', event => {
    const steps = toolbar.getAttribute('aria-orientation') === 'vertical' ? {ArrowUp: -1, ArrowDown: 1} : {ArrowLeft: -1, ArrowRight: 1};
    const enabled = toolButtons.filter(button => !button.disabled);
    const index = enabled.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key in steps) next = (index + steps[event.key] + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    enabled[next].focus();
});
const narrow = matchMedia('(max-width: 767.98px)'); // bottom sheet and horizontal toolbar
const syncOrientation = () => toolbar.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
narrow.addEventListener('change', syncOrientation);

// Keep the model centred in the part of the canvas the open panel (or bottom sheet) leaves visible.
function updateViewInset() {
    const panel = $('infoPanel');
    if (!isOpen()) viewer.setViewInset(0, 0);
    else if (narrow.matches) viewer.setViewInset(0, panel.offsetHeight);
    else viewer.setViewInset(panel.offsetWidth + parseFloat(getComputedStyle(panel).right || '0'), 0);
}
new ResizeObserver(updateViewInset).observe(explorer);

const actions = {
    'zoom-in': () => viewer.zoomStep(1),
    'zoom-out': () => viewer.zoomStep(-1),
    reset: () => { if (viewer.focusedPart()) exitFocus(); viewer.reset(); },
    rotate: () => tool('rotate').setAttribute('aria-pressed', String(viewer.toggleRotate())),
    save: async () => {
        if (await viewer.saveImage(contextSystem?.id)) return;
        console.warn('Image could not be saved.');
        announce('Image could not be saved.');
    },
    fullscreen: () => viewer.toggleFullscreen(explorer),
    info: () => togglePanel()
};
toolbar.addEventListener('click', event => {
    const button = event.target.closest('.tool-btn');
    if (button && !button.disabled) actions[button.dataset.action]?.();
});
viewer.onFullscreenChange(explorer, on => {
    const button = tool('fullscreen');
    button.innerHTML = icon(on ? 'minimize' : 'maximize');
    button.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    button.dataset.tip = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
});

// ── Keyboard: shortcuts, then Escape leaves part focus before pseudo-fullscreen ──
document.addEventListener('keydown', event => {
    const action = shortcutAction(event);
    const button = action && tool(action);
    if (!button || button.disabled) return;
    event.preventDefault();
    actions[action]();
});
window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewer.focusedPart()) { event.stopImmediatePropagation(); exitFocus(); }
}, true);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewer.exitPseudoFullscreen(explorer)) tool('fullscreen').focus();
});

// ── Part focus ──
function structureFor(part) {
    if (part.userData.structure) return part.userData.structure;
    return AnatomyLayersCore.matchStructure(AnatomyData.getSystem(part.userData.system_id)?.structures, part);
}
// Matches the id mergeSystem() gives a database structure, so the right structure chip shows as pressed.
function structureId(structure) {
    if (!structure) return null;
    if (structure.mesh_name) return structure.mesh_name;
    const owner = AnatomyData.systems.find(system => system.structures.includes(structure));
    return owner ? `structure-${owner.structures.indexOf(structure)}` : null;
}
const systemNames = () => Object.fromEntries(AnatomyData.systems.map(system => [system.id, system.name]));
function recordView(name) { if (name) { viewed.add(name); interactions++; } }
// `chosen` is the structure chip the user clicked; it wins over matching by the part's own system,
// and keeps the panel on the current system.
async function afterFocus(part, chosen = null) {
    const version = ++focusVersion;
    const system = AnatomyData.getSystem(part.userData.system_id);
    if (!chosen && system && system.id !== contextSystem?.id) await setContext(system);
    if (version !== focusVersion) return;
    const structure = chosen ? {name: chosen.name, desc: chosen.description} : structureFor(part);
    renderSelection({...AnatomyLayersCore.partInfo(part.userData, systemNames(), structure), focused: true});
    setPressedStructure(chosen ? chosen.id : structureId(structure));
    recordView(structure?.name || part.userData.name);
}
function exitFocus() {
    focusVersion++;
    viewer.clearHighlight();
    renderSelection(null);
}
// A structure chip focuses its 3D part when that part is loaded; otherwise it only shows the description.
function showStructure(structure) {
    const part = viewer.highlightStructure(structure.meshName);
    if (part) { afterFocus(part, structure); return; }
    focusVersion++;
    viewer.clearHighlight();
    renderSelection({title: structure.name, description: structure.description || 'No description provided.', systemName: contextSystem?.name || '', func: '', alsoPartOf: [], reference: '', unidentified: false, focused: false});
    setPressedStructure(structure.id);
    recordView(structure.name);
}
function handlePartClick(part) {
    if (part) {
        viewer.focusPart(part);
        if (!isOpen()) setOpen(true, {persist: false});
        afterFocus(part);
    } else if (viewer.focusedPart()) exitFocus();
}

// ── Context system: the panel shows the last clicked part's system, otherwise the last one switched on ──
async function flushExploration() {
    if (teacherExplorer || !contextSystem || activeSeconds < 1) return;
    const payload = {system_id: contextSystem.system_id, duration_secs: Math.floor(activeSeconds), interactions, structures_viewed: [...viewed]};
    activeSeconds = 0; interactions = 0; viewed.clear();
    try {
        const response = await fetch(API_BASE + '/analytics/exploration.php', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), credentials: 'same-origin', keepalive: true});
        if (!response.ok) console.warn('Exploration progress could not be saved.');
    } catch { console.warn('Exploration progress could not be saved.'); }
}
async function setContext(raw) {
    const version = ++contextVersion;
    await flushExploration();
    if (version !== contextVersion) return;
    contextSystem = merged.get(raw.id);
    renderPanel(contextSystem, {onStructure: showStructure});
    if (!viewer.focusedPart()) renderSelection(null);
    teacherHooks.onContext(contextSystem);
    updateStage();
}

// ── Body systems panel: its header collapses or expands the list in place; the choice is remembered ──
const SYSTEMS_KEY = 'anatomy.systemsOpen';
function setSystemsOpen(open, {persist = true} = {}) {
    systemsMenu.classList.toggle('is-collapsed', !open);
    chipBox.inert = !open; // out of the tab order and accessibility tree at once, not after the slide
    systemsToggle.setAttribute('aria-expanded', String(open));
    if (persist) { try { localStorage.setItem(SYSTEMS_KEY, open ? '1' : '0'); } catch { /* storage blocked: keep the in-memory state */ } }
}
systemsToggle.addEventListener('click', () => setSystemsOpen(systemsMenu.classList.contains('is-collapsed')));
let storedSystemsOpen = null;
try { storedSystemsOpen = localStorage.getItem(SYSTEMS_KEY); } catch { /* storage blocked */ }
setSystemsOpen(panelDefault(storedSystemsOpen, !narrow.matches), {persist: false});

function createChip(system) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'system-chip'; button.dataset.system = system.id;
    if (!system.modelUrl) button.dataset.model = 'none';
    button.setAttribute('role', 'switch'); button.setAttribute('aria-checked', 'false');
    const dot = document.createElement('span'); dot.className = 'system-chip__dot'; dot.style.setProperty('--system-color', system.color || '#64748b');
    const text = document.createElement('span'); text.className = 'system-chip__text';
    const name = document.createElement('span'); name.className = 'system-chip__name';
    name.textContent = system.name + (teacherExplorer && !studentPreview && !system.isActive ? ' (hidden)' : '');
    const status = document.createElement('span'); status.className = 'system-chip__status';
    text.append(name, status);
    const toggle = document.createElement('span'); toggle.className = 'system-chip__switch'; toggle.setAttribute('aria-hidden', 'true');
    button.append(dot, text, toggle);
    button.addEventListener('click', () => toggleSystem(system));
    return button;
}
function renderChip(system) {
    const button = chipBox.querySelector(`[data-system="${CSS.escape(system.id)}"]`);
    if (!button) return;
    button.setAttribute('aria-checked', String(enabledOrder.includes(system.id)));
    button.querySelector('.system-chip__status').textContent = AnatomyLayersCore.toggleStatus(system, viewer.layerState(system.id));
}
function renderAll() {
    AnatomyData.systems.forEach(renderChip);
    systemsCount.textContent = enabledOrder.length ? ` · ${enabledOrder.length} on` : ' · none on';
    updateStage();
}

function disableSystem(id) {
    const index = enabledOrder.indexOf(id);
    if (index < 0) return;
    const next = AnatomyLayersCore.contextAfterDisable(enabledOrder, id, contextSystem?.id);
    const focusedHere = viewer.focusedPart()?.userData.layerId === id;
    enabledOrder.splice(index, 1);
    viewer.setLayer(AnatomyData.getSystem(id), false);
    if (focusedHere) exitFocus();
    if (next && next !== contextSystem?.id) setContext(AnatomyData.getSystem(next));
}
async function toggleSystem(system) {
    if (!viewerReady || !system.modelUrl) { await setContext(system); return; }
    if (enabledOrder.includes(system.id)) { disableSystem(system.id); renderAll(); return; }
    enabledOrder.push(system.id);
    setContext(system);
    renderAll();
    const layer = await viewer.setLayer(system, true, () => { renderChip(system); updateStage(); });
    // Switched off while loading, or off and on again: a newer load now owns this system.
    if (!enabledOrder.includes(system.id) || viewer.layerState(system.id) !== layer) { renderAll(); return; }
    if (layer.status === 'error') {
        enabledOrder.splice(enabledOrder.indexOf(system.id), 1);
        failedId = system.id;
    } else if (layer.status === 'ready') {
        failedId = null;
        // A model made outside the layered export has its own frame, so it is never mixed with other layers.
        let replacedLegacy = false;
        for (const other of [...enabledOrder]) {
            if (other === system.id) continue;
            const state = viewer.layerState(other);
            if (state && state.status === 'ready' && !state.layered) replacedLegacy = true;
            if (!layer.layered || (state && state.status === 'ready' && !state.layered)) disableSystem(other);
        }
        if (!layer.layered) { viewer.fit(); announce(LEGACY_NOTE); }
        else if (replacedLegacy) viewer.fit(); // the view was framed for the other model's own coordinates
    }
    renderAll();
}

// ── Analytics timers (students only) ──
if (!teacherExplorer) {
    setInterval(() => { const now = Date.now(); if (!document.hidden && contextSystem) activeSeconds += Math.min((now - lastTick) / 1000, 2); lastTick = now; }, 1000);
    setInterval(flushExploration, 45000);
    window.addEventListener('pagehide', flushExploration);
    document.addEventListener('visibilitychange', () => { lastTick = Date.now(); if (document.hidden) flushExploration(); });
}

// Test and debugging hook.
window.AnatomyExplorer = {
    get contextSystem() { return contextSystem; },
    set activeSeconds(value) { activeSeconds = value; },
    flushExploration
};

// ── Start ──
Object.entries(TOOL_ICONS).forEach(([action, name]) => { tool(action).innerHTML = icon(name); });
initPanel({panel: $('infoPanel'), toggle: tool('info'), explorer, onBack: exitFocus, onChange: updateViewInset});
syncOrientation();
updateStage();
(async () => {
    if (!await Auth.requireAuth(teacherExplorer ? 'teacher' : 'student')) return;
    try {
        await AnatomyData.load();
        if (studentPreview) AnatomyData.systems = AnatomyData.systems.filter(s => s.isActive);
        if (teacherExplorer) teacherHooks = (await import('./teacher.js')).initTeacher({preview: studentPreview});
        const systems = AnatomyData.systems;
        if (!systems.length) {
            chipBox.textContent = 'No body systems yet.';
            stageMessage = 'No anatomy content has been published yet.';
            renderHeader('Anatomy content is coming soon', '');
            updateStage();
            return;
        }
        viewerReady = viewer.init($('anatomyCanvas'), {onPartClick: handlePartClick, labelFor: part => structureFor(part)?.name || part.userData.name});
        updateViewInset();
        const params = new URLSearchParams(location.search);
        const lessonId = studentPreview ? null : params.get('lesson_id');
        if (lessonId) {
            const response = await fetch(API_BASE + '/lessons.php?id=' + encodeURIComponent(lessonId));
            const result = await response.json();
            if (result.success && /\.glb$/i.test(result.data.media_url || '')) {
                const system = AnatomyData.getSystem(result.data.system_code);
                if (system) { system.modelUrl = result.data.media_url; system.name = result.data.title; }
            }
        }
        merged = new Map(systems.map(s => [s.id, mergeSystem(s)]));
        chipBox.replaceChildren(...systems.map(createChip));
        stageMessage = '';
        const first = AnatomyData.getSystem(params.get('system')) || systems.find(s => s.modelUrl) || systems[0];
        await toggleSystem(first);
        renderAll();
    } catch (error) {
        console.warn('Unable to load anatomy content.', error);
        stageMessage = 'Unable to load anatomy content. Reload the page to try again.';
        updateStage();
    }
})();
