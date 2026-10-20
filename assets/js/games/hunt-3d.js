// 3D Hunt: find the named part on the 3D model of one body system. A card scores when its part is clicked
// within the level's tries. A wrong part uses a try. When the tries run out, or on Skip, the part is shown
// for 1.5 s and the card counts as missed. Dragging turns the model; only a click (a press that hardly
// moves, which the engine tells apart) is an answer.
//
// play(root, cards, level, report, ctx) takes a fifth argument, ctx = {system}: the anatomy-content.php row
// of the round's one body system. It uses
//   system_code  the layer id, which also picks the tissue colours ('endocrine')
//   model_url    the layer's GLB, relative to the page ('../system_model/layers/endocrine.glb')
//   structures   optional; only models made outside the layered export use their mesh_name entries
// play() rejects before any card is reported, leaving root empty, so the runner can say why and post nothing:
//   Error('model-unavailable')  no system or model_url, no AnatomyViewer, 3D could not start (no WebGL),
//                               or the model failed to load
//   Error('parts-missing')      the model loaded but lacks some cards' parts (a typo in a teacher set's mesh
//                               or a curated mesh_name, say); error.meshes lists those mesh ids, each once
//
// The page loads the engine first, as classic scripts: assets/vendor/three/three.min.js, OrbitControls.js,
// GLTFLoader.js and DRACOLoader.js, then assets/js/anatomy-layers-core.js and assets/js/model-viewer.js.
// AnatomyViewer is a page-wide singleton with no teardown, so 3D Hunt owns it on the Games page: it is set
// up once on a canvas that every round reuses (one WebGL context per page). Each round loads its system's
// layer and, at the end, switches it off and disposes it as the explorer does; the render loop stops
// between rounds.
//
// Markup: the play-kit frame, its stage holding p.game-prompt, div.game-viewer > canvas.game-canvas and
// div.game-hunt-controls > p.game-tries + button.game-skip. While the model loads, the board has the class
// is-loading and the stage holds the viewer and span.game-loading-progress. The engine sizes the drawing
// buffer only, so the stylesheet must give .game-viewer a height and the canvas width and height 100%
// (the explorer also uses display: block and touch-action: none).

import {countTerms, pickCards} from './runner-core.js';
import {el, startRound} from './play-kit.js';

const HIT_MS = 900;          // a found part's "Correct" stays this long
const REVEAL_MS = 1500;      // a missed part is shown this long

const meshOf = card => String(card?.mesh ?? '').trim();
const hasMesh = card => meshOf(card) !== '';

// Every rejection leaves the root empty.
function failure(root, message, fields = {}) {
    root.textContent = '';
    return Object.assign(new Error(message), fields);
}

// What AnatomyViewer.setLayerVisible needs, from the anatomy-content row; null when there is no model.
function layerFor(system) {
    const id = String(system?.system_code ?? '').trim(), modelUrl = String(system?.model_url ?? '').trim();
    if (!id || !modelUrl) return null;
    return {id, modelUrl, structures: Array.isArray(system.structures) ? system.structures : []};
}

// A top-level const in a classic script is a global binding but not a window property: use the bare name.
const engineGlobal = () => (typeof AnatomyViewer === 'undefined' ? null : AnatomyViewer);

// The page's one viewer, {engine, holder, animate}: null until the first round, false if it could not start.
let viewer = null;
const idle = () => {};

function openViewer(stage) {
    if (viewer) {
        stage.append(viewer.holder);
        const {engine, animate} = viewer;
        if (engine.animate !== animate) {
            engine.animate = animate;
            if (!document.hidden) animate();        // a hidden tab starts it from the engine's visibility handler
        }
        return viewer;
    }
    const engine = engineGlobal();
    const holder = el('div', 'game-viewer');
    const canvas = el('canvas', 'game-canvas', null, {role: 'img', 'aria-label': '3D model. Drag to turn it, click a part to answer.'});
    holder.append(canvas);
    stage.append(holder);                            // attached first: init reads the page colours and sizes from it
    try {
        engine.init(canvas);
    } catch (error) {
        console.warn('3D Hunt: 3D viewing is unavailable.', error);
        holder.remove();
        viewer = false;
        return null;
    }
    engine.label?.remove();                          // the hover label names the part, which would give answers away
    viewer = {engine, holder, animate: engine.animate};
    return viewer;
}

// Frees the round's layer the way explorer/viewer.js switches one off, takes the canvas off the page and
// stops the render loop. Each frame is scheduled through engine.animate, and the engine's visibility
// handler restarts the loop by calling it, so a no-op there keeps the loop stopped until openViewer.
function closeViewer(layer) {
    const {engine, holder} = viewer;
    engine.onPartClick = null;
    engine.setLayerVisible(layer, false);            // hiding has no awaits; its side effects happen now
    engine.disposeLayer(layer.id);
    holder.remove();
    cancelAnimationFrame(engine.frame);
    engine.frame = null;
    engine.animate = idle;
}

async function play(root, cards, level, report, ctx) {
    const list = Array.from(cards || []);
    if (!list.length) return startRound(root, list, report).done;
    const layer = layerFor(ctx?.system);
    if (!layer || viewer === false || !engineGlobal()) throw failure(root, 'model-unavailable');

    root.textContent = '';
    const board = el('div', 'game-board game-hunt-3d is-loading');
    const stage = el('div', 'game-stage');
    const status = el('p', 'game-feedback', '', {'aria-live': 'polite'});
    board.append(stage, status);
    root.append(board);
    status.textContent = 'Loading the 3D model…';          // set once the live region is on the page, so it is read
    const view = openViewer(stage);
    if (!view) throw failure(root, 'model-unavailable');
    const percent = el('span', 'game-loading-progress', '', {'aria-hidden': 'true'});
    stage.append(percent);

    let loaded = null;
    try {
        loaded = await view.engine.setLayerVisible(layer, true, state => {
            percent.textContent = state.progress == null ? '' : `${state.progress}%`;
        });
    } catch (error) {
        console.warn('3D Hunt: the model could not be loaded.', error);
    }
    if (loaded?.status !== 'ready' || !loaded.root) {
        closeViewer(layer);
        throw failure(root, 'model-unavailable');
    }
    const targets = list.map(card => view.engine.findPart(meshOf(card)));
    const missing = [...new Set(list.filter((card, i) => !targets[i]).map(meshOf))];
    if (missing.length) {
        closeViewer(layer);
        throw failure(root, 'parts-missing', {meshes: missing});
    }
    return hunt(root, list, level, report, view, layer, targets);
}

function hunt(root, cards, level, report, view, layer, targets) {
    const {engine} = view;
    const round = startRound(root, cards, report);    // replaces the loading board
    const stage = round.frame('hunt-3d');
    const prompt = el('p', 'game-prompt', '');
    const triesLeft = el('p', 'game-tries', '');
    const skip = el('button', 'game-skip', 'Skip', {type: 'button'});
    const controls = el('div', 'game-hunt-controls');
    controls.append(triesLeft, skip);
    stage.append(prompt, view.holder, controls);

    const maxTries = Math.max(1, Math.floor(Number(level.tries)) || 1);
    let index = 0, tries = 0, locked = true;        // locked between a card's answer and the next prompt

    const left = () => { const n = maxTries - tries; return `${n} ${n === 1 ? 'try' : 'tries'} left`; };

    function ask() {
        const term = String(cards[index].term ?? '');
        tries = 0;
        locked = false;
        prompt.textContent = `Find: ${term}`;
        triesLeft.textContent = left();
        round.say(`Find: ${term}`);
    }

    function found() {
        const card = cards[index];
        locked = true;
        triesLeft.textContent = '';
        round.say(`Correct: ${card.term}.`);
        round.report(card, true, HIT_MS);
        if (++index < cards.length) round.later(ask, HIT_MS);
    }

    // Shows where the part is, then counts the card as missed.
    function reveal(message) {
        const card = cards[index];
        locked = true;
        triesLeft.textContent = '';
        engine.focusPart(targets[index]);
        round.say(`${message} Here is ${card.term}.`);
        round.later(() => {
            engine.clearFocus();
            round.report(card, false);
            if (++index < cards.length) ask();
        }, REVEAL_MS);
    }

    engine.onPartClick = part => {
        if (locked || round.isOver()) return;
        if (!part) { round.say('Click a part of the model.'); return; }
        if (part === targets[index] || part.userData.part_id === cards[index].mesh) { found(); return; }
        tries += 1;
        const name = String(part.userData.name || 'another part');
        if (tries >= maxTries) { reveal(`Not that one: ${name}.`); return; }
        triesLeft.textContent = left();
        round.say(`Not that one: ${name}. ${left()}.`);
    };
    round.listen(skip, 'click', () => { if (!locked && !round.isOver()) reveal('Skipped.'); });

    ask();
    return round.done.then(() => {
        try { closeViewer(layer); } catch (error) { console.warn('3D Hunt: the model could not be released.', error); }
    });
}

export default {
    key: 'hunt-3d',
    name: '3D Hunt',
    icon: 'crosshair',
    levels: {
        easy: {roundSize: 3, tries: 3},
        medium: {roundSize: 5, tries: 2},
        hard: {roundSize: 7, tries: 1},
    },
    available: (cards, level) => countTerms(cards, hasMesh) >= level.roundSize,
    // Only cards with a part on the model, the same ones available() counts.
    choose: (pool, level, stats, rng = Math.random) => pickCards((pool || []).filter(hasMesh), level.roundSize, stats, rng),
    play,
};
