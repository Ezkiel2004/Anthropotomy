// Game shell: the game list, settings storage, seeded random and star rating, then boot(), which runs
// the play page. No DOM or window access at import time, so Node unit tests and the gallery/teacher
// pages can import it.

export const GAMES = {
    'germ-smash': {
        title: 'Germ Smash',
        tagline: 'Smash the germs, spare the good bacteria.',
        card: '../assets/games/germ-smash/card.webp',
        load: () => import('./germ-smash.js')
    }
};

export const DEFAULT_SETTINGS = {sfx: true, sfxVolume: 80, music: true, musicVolume: 50, reduceMotion: false, vibration: true};

const SETTINGS_KEY = 'anthropotomy_game_settings';
const FLAGS = ['sfx', 'music', 'reduceMotion', 'vibration'];
const VOLUMES = ['sfxVolume', 'musicVolume'];

const volume = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback);

export function loadSettings(storage, prefersReducedMotion) {
    const settings = {...DEFAULT_SETTINGS, reduceMotion: !!prefersReducedMotion};
    let stored;
    try {
        stored = JSON.parse(storage.getItem(SETTINGS_KEY));
    } catch {
        return settings;
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return settings;
    for (const key of FLAGS) if (typeof stored[key] === 'boolean') settings[key] = stored[key];
    for (const key of VOLUMES) settings[key] = volume(stored[key], DEFAULT_SETTINGS[key]);
    return settings;
}

export function saveSettings(storage, settings) {
    try {
        const known = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) known[key] = settings[key];
        storage.setItem(SETTINGS_KEY, JSON.stringify(known));
        return true;
    } catch {
        return false;
    }
}

// mulberry32
export function makeRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function starsFor(score, thresholds) {
    return thresholds.filter((threshold) => score >= threshold).length;
}

// The HUD clock: whole seconds left, rounded up, as m:ss (60 -> 1:00, 59.2 -> 1:00, 59 -> 0:59).
export function formatTime(seconds) {
    const whole = Math.ceil(Math.max(0, seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// What a plays.php answer means for the game over screen. Network errors (handled by the caller), 5xx and
// non-JSON refusals can be retried with the same body; any other refusal (a 422) cannot. A 2xx answer that
// isn't JSON still reached the server, so it counts as saved: a retry could save the round twice.
export function saveOutcome(status, result) {
    const ok = status >= 200 && status < 300;
    if (ok && result && result.success) return {kind: 'saved', data: result.data ?? null};
    if (ok && !result) return {kind: 'saved', data: null};
    if (status >= 500 || !result) return {kind: 'retry'};
    return {kind: 'refused'};
}

// The best score to show from a game board's `best`: the all-time best once the student has a score on
// record, otherwise null ("No score yet"). Teachers get best = null.
// The game for a ?game= key, ignoring inherited keys such as "constructor".
export function gameEntry(key) {
    return Object.prototype.hasOwnProperty.call(GAMES, key) ? GAMES[key] : null;
}

// Safari has not always decoded Ogg Vorbis, so each .ogg sound ships with an .m4a (AAC) copy.
export function soundUrl(base, file, canPlayOgg) {
    return base + (canPlayOgg ? file : file.replace(/\.ogg$/, '.m4a'));
}

// iOS suspends audio until a tap and "interrupts" it after a lock or a call; each start and resume wakes it.
export function wakeAudio(ctx) {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return false;
    ctx.resume().catch(() => {});
    return true;
}

// A round's id for plays.php: Retry resends it, so a save whose answer got lost is never stored twice.
export function newRoundId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bestScore(best) {
    if (!best || typeof best.all_time !== 'number') return null;
    return best.all_time > 0 || best.week !== null ? best.all_time : null;
}

// A game board ready to list: each row says whether it is the viewer's own. `you` is the viewer's rank and
// score when they are ranked but outside the list; inside it, their row is highlighted instead.
export function boardView(board, userId) {
    const own = row => userId !== null && userId !== undefined && Number(row.user_id) === Number(userId);
    const rows = ((board && board.top) || []).map(row => ({rank: row.rank, name: row.full_name, score: row.score, own: own(row)}));
    const me = board && board.me;
    return {rows, you: me && !rows.some(row => row.own) ? {rank: me.rank, score: me.score} : null};
}

// ── The play page (student/play.html) ─────────────────────────────
// Nothing below runs until the page calls boot(); it owns every screen, the settings, sound,
// the one requestAnimationFrame loop and saving the score.

const ICONS = '../assets/icons/interface.svg?v=20261012-icons3';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DT = 0.05;                      // a long frame never jumps the game ahead
const COUNTDOWN = ['3', '2', '1', 'Go'];
const COUNT_SECONDS = 0.7;                // each of 3, 2 and 1; play starts as "Go" shows
const PANEL_SCREENS = ['loading', 'tap', 'menu', 'new', 'how', 'settings', 'scores', 'pause', 'over', 'error', 'missing'];
const BRAND_SCREENS = new Set(['loading', 'tap', 'menu']);
const SUB_SCREENS = new Set(['new', 'how', 'settings', 'scores']);
const LEVEL_NAMES = {easy: 'Easy', medium: 'Medium', hard: 'Hard'};
const OVER_EXITS = ['playAgain', 'overMenu', 'overExit'];
const SAVE_TIMEOUT_MS = 30000;            // a save still unanswered by then is offered Retry
const PREVIEW_SECTION = 'Rizal';
const formatScore = n => Number(n).toLocaleString('en-US');
const iconId = id => (typeof id === 'string' && /^[a-z0-9-]+$/.test(id) ? id : 'medal');

function icon(id) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `${ICONS}#${id}`);
    svg.append(use);
    return svg;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function boot() {
    const $ = id => document.getElementById(id);
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    if (typeof Auth !== 'undefined' && !user) return;   // Auth.requireAuthSync() is already redirecting to sign-in
    const params = new URLSearchParams(location.search);
    const key = params.get('game') || '';
    const entry = gameEntry(key);
    const isStudent = !!user && user.role === 'student';
    const preview = !isStudent;               // teachers and admins play, but nothing is saved
    const exitUrl = isStudent ? 'games.html' : '../teacher/games.html';
    const apiBase = typeof API_BASE === 'undefined' ? '../api' : API_BASE;
    const seedText = params.get('seed');
    const seeded = seedText !== null && /^\d{1,10}$/.test(seedText);
    let storage = null;
    try { storage = window.localStorage; } catch { /* site data blocked: settings last for this visit only */ }
    const settings = loadSettings(storage, !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    const canVibrate = typeof navigator.vibrate === 'function';

    const canvas = $('playCanvas');
    const ctx = canvas.getContext('2d');
    const panel = $('panel');
    const countdownEl = $('countdown');
    const announcer = $('announcer');
    const view = {w: 0, h: 0, dpr: 1};
    let screen = 'loading';
    let mode = 'none';                        // 'backdrop' (menu), 'round' (countdown and play) or 'still'
    let game = null, instance = null, round = null, roundSeq = 0, overRoundId = 0, pendingSave = null;
    let saveState = 'none', leaveAction = null, scoresToken = 0, sections = null;
    let best = null, difficulty = 'medium', settingsFrom = 'menu', clock = 0, last = 0;
    const returnFocus = {};
    let audio = null, unlocked = false, musicBuffer = null, musicNode = null, musicGain = null;
    // A game without music has no Music setting, so its sound effects alone decide whether it is muted.
    const hasMusic = () => !!(game && game.assets && game.assets.music);
    const isMuted = () => !settings.sfx && (!hasMusic() || !settings.music);
    const buffers = {};

    // ── Sound and vibration (both follow the settings) ──
    function sound(name) {
        if (!settings.sfx || !audio || !unlocked || !buffers[name]) return;
        try {
            const source = audio.createBufferSource();
            const gain = audio.createGain();
            source.buffer = buffers[name];
            gain.gain.value = settings.sfxVolume / 100;
            source.connect(gain).connect(audio.destination);
            source.start();
        } catch { /* a sound that cannot play is skipped */ }
    }

    function syncMusic() {
        const wanted = !!(musicBuffer && audio && unlocked && settings.music && !(round && round.paused));
        try {
            if (wanted && !musicNode) {
                musicNode = audio.createBufferSource();
                musicNode.buffer = musicBuffer;
                musicNode.loop = true;
                musicGain = audio.createGain();
                musicNode.connect(musicGain).connect(audio.destination);
                musicNode.start();
            } else if (!wanted && musicNode) {
                musicNode.stop();
                musicNode = null;
            }
            if (musicGain) musicGain.gain.value = settings.musicVolume / 100;
        } catch { musicNode = null; }
    }

    async function fetchAudio(url) {
        if (!audio) return null;   // no Web Audio: the game plays silently
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Couldn't load ${url}`);
        return audio.decodeAudioData(await response.arrayBuffer());
    }

    function announce(text) {
        announcer.textContent = '';
        setTimeout(() => { announcer.textContent = text; }, 40);
    }

    // ── The api handed to the game (spec section 1) ──
    const api = {
        ctx,
        images: {},
        get width() { return view.w; },
        get height() { return view.h; },
        get dpr() { return view.dpr; },
        get reducedMotion() { return settings.reduceMotion; },
        rng: seeded ? makeRng(Number(seedText)) : Math.random,
        sound,
        vibrate(ms) {
            if (!settings.vibration || !canVibrate) return;
            try { navigator.vibrate(ms); } catch { /* not allowed here */ }
        },
        hud,
        gameOver
    };

    // ── Screens ──
    function panelScreen() {
        return screen === 'paused' ? 'pause' : screen;
    }

    function show(name, focusTarget) {
        screen = name;
        const inPanel = PANEL_SCREENS.includes(panelScreen());
        panel.hidden = !inPanel;
        for (const id of PANEL_SCREENS) $('s-' + id).hidden = id !== panelScreen();
        $('brand').hidden = !BRAND_SCREENS.has(name);
        const live = name === 'countdown' || name === 'playing';
        const pausedView = name === 'paused' || (name === 'settings' && settingsFrom === 'pause');
        const roundShown = !!round && round.phase !== 'over' && (live || pausedView);
        $('hud').hidden = !roundShown;
        $('hudTime').hidden = !roundShown;
        $('pauseBtn').hidden = !live;
        document.body.classList.toggle('is-round', !!round && (roundShown || name === 'over'));
        document.body.classList.toggle('is-dim', pausedView || name === 'over');
        if (inPanel) {
            const section = $('s-' + panelScreen());
            const target = focusTarget || (name === 'new' && section.querySelector('[aria-checked="true"]')) || section.querySelector('.back') || section.querySelector('.btn.primary') || section.querySelector('button');
            if (target) target.focus({preventScroll: true});
        } else if (live) {
            $('pauseBtn').focus({preventScroll: true});
        }
    }

    function paintBrand() {
        const [first, ...rest] = game.title.split(' ');
        const spans = $('gameTitle').children;
        spans[0].textContent = first;
        spans[1].textContent = rest.join(' ');
        $('gameTagline').textContent = game.tagline;
        document.title = `${game.title} | Anthropotomy`;
        for (const card of document.querySelectorAll('#s-new [data-level]')) card.querySelector('small').textContent = (game.levels && game.levels[card.dataset.level]) || '';
        const steps = (game.howToPlay || []).map(step => {
            const item = element('li');
            const dot = element('span', `dot tone-${step.color || 'yellow'}`);
            dot.append(icon(step.icon));
            const text = element('span');
            if (step.title) text.append(element('b', '', step.title), ' ');
            text.append(step.text);
            item.append(dot, text);
            return item;
        });
        $('howSteps').replaceChildren(...steps);
        const keys = $('howKeys');
        keys.replaceChildren();
        if (game.keys) {
            // Each grid's keys laid out like its pores, one small block per difficulty.
            keys.append(element('p', 'keys-title', 'Keyboard'));
            const sets = element('div', 'keys-sets');
            for (const [level, rows] of Object.entries(game.keys)) {
                const set = element('div', 'keys-set');
                const grid = element('div', 'keys-grid');
                grid.style.gridTemplateColumns = `repeat(${rows[0].length}, auto)`;
                for (const code of rows.flat()) grid.append(element('kbd', '', code.replace(/^(?:Key|Digit|Numpad)/, '')));
                set.append(element('span', 'keys-level', LEVEL_NAMES[level] || level), grid);
                sets.append(set);
            }
            keys.append(sets, element('p', 'keys-note', 'Easy also takes the keypad. Esc or P pauses.'));
        }
    }

    function renderStars(target, count) {
        target.replaceChildren(...[0, 1, 2].map(i => {
            const star = icon('medal');
            if (i < count) star.classList.add('on');
            return star;
        }));
        target.setAttribute('aria-label', `${count} of 3 stars`);
    }

    function renderMenuBest() {
        $('menuBestRow').hidden = best === null || !game;
        if (best === null || !game) return;
        $('menuBest').textContent = formatScore(best);
        renderStars($('menuStars'), starsFor(best, game.stars));
    }

    // A best from the server only ever raises the one known on this page.
    function learnBest(board) {
        const known = bestScore(board && board.best);
        if (known === null || (best !== null && best >= known)) return;
        best = known;
        renderMenuBest();
    }

    // ── Scores from the server: this game's weekly board for the student's section (teachers pick one) ──
    async function getJson(path) {
        const response = await fetch(`${apiBase}/${path}`, {credentials: 'same-origin'});
        const result = await response.json();
        if (!response.ok || !result || !result.success) throw new Error((result && result.message) || `Couldn't load ${path}`);
        return result.data;
    }

    function fetchBoard(section) {
        const query = `game=${encodeURIComponent(key)}` + (section ? `&section=${encodeURIComponent(section)}` : '');
        return getJson(`games/leaderboard.php?${query}`);
    }

    // Preview only: the class sections, from the site config, with Rizal first chosen.
    async function loadSections() {
        let list = [PREVIEW_SECTION];
        try {
            const config = await getJson('config.php');
            if (Array.isArray(config.sections) && config.sections.length) list = config.sections.map(String);
        } catch { /* the default section still works */ }
        const select = $('scoresSection');
        select.replaceChildren(...list.map(name => new Option(name, name)));
        select.value = list.includes(PREVIEW_SECTION) ? PREVIEW_SECTION : list[0];
        return list;
    }

    function scoresStatus(text, failed = false) {
        const status = $('scoresStatus');
        status.hidden = !text;
        status.textContent = text;
        status.classList.toggle('is-failed', failed);
        $('scoresRetry').hidden = !failed;
    }

    async function loadScores() {
        const token = ++scoresToken;
        $('scoresSectionRow').hidden = !preview;
        $('scoresList').replaceChildren();
        $('scoresYou').hidden = true;
        $('scoresEmpty').hidden = true;
        scoresStatus('Loading scores…');
        try {
            if (preview && !sections) sections = await loadSections();
            const board = await fetchBoard(preview ? $('scoresSection').value : null);
            if (token !== scoresToken) return;
            renderScores(board);
        } catch {
            if (token !== scoresToken) return;
            scoresStatus("Scores couldn't load.", true);
        }
    }

    function renderScores(board) {
        learnBest(board);
        $('scoresBest').hidden = !board.best;
        if (board.best) {
            $('scoresAllTime').textContent = formatScore(board.best.all_time);
            $('scoresWeek').textContent = board.best.week === null ? '–' : formatScore(board.best.week);
        }
        $('scoresListTitle').textContent = board.section ? `This week in ${board.section}` : 'This week';
        const view = boardView(board, isStudent ? user.user_id : null);
        $('scoresList').replaceChildren(...view.rows.map(row => {
            const item = element('li', row.own ? 'is-me' : '');
            item.append(element('span', 'rank-pos', `#${row.rank}`), element('span', 'rank-name', row.name));
            if (row.own) item.append(element('span', 'sr-only', ' (you)'));
            item.append(element('span', 'rank-score', formatScore(row.score)));
            return item;
        }));
        $('scoresYou').hidden = !view.you;
        $('scoresYou').textContent = view.you ? `You: #${view.you.rank} · ${formatScore(view.you.score)}` : '';
        $('scoresEmptyText').textContent = isStudent ? 'No scores yet this week. Finish a round to get on the board.' : `No scores yet this week in ${board.section}.`;
        $('scoresEmpty').hidden = view.rows.length > 0;
        scoresStatus('');
    }

    function selectLevel(level) {
        difficulty = level;
        for (const card of document.querySelectorAll('#s-new [data-level]')) {
            const on = card.dataset.level === level;
            card.classList.toggle('sel', on);
            card.setAttribute('aria-checked', String(on));
        }
    }

    function back() {
        if (screen === 'settings' && settingsFrom === 'pause') return show('paused', $('pauseSettingsBtn'));
        show('menu', returnFocus[screen]);
    }

    function exit() {
        location.assign(exitUrl);
    }

    // ── Settings ──
    function renderSettings() {
        $('setSfx').checked = settings.sfx;
        $('setSfxVolume').value = settings.sfxVolume;
        $('sfxVolumeText').textContent = `Volume ${settings.sfxVolume}`;
        $('setMusic').checked = settings.music;
        $('setMusicVolume').value = settings.musicVolume;
        $('musicVolumeText').textContent = `Volume ${settings.musicVolume}`;
        $('setMotion').checked = settings.reduceMotion;
        $('setVibration').checked = settings.vibration;
        $('vibrationRow').hidden = !canVibrate;
        $('musicRow').hidden = $('musicVolumeRow').hidden = !hasMusic();
        $('muteBtn').setAttribute('aria-pressed', String(isMuted()));
        document.body.classList.toggle('reduce-motion', settings.reduceMotion);
    }

    function changeSettings(changes) {
        Object.assign(settings, changes);
        saveSettings(storage, settings);
        renderSettings();
        syncMusic();
    }

    // ── The heads-up display ──
    function hud({score, combo, timeLeft}) {
        if (!round) return;
        const shown = round.hud;
        if (score !== shown.score) {
            shown.score = score;
            $('hudScore').textContent = formatScore(score);
        }
        if (combo !== shown.combo) {
            const rose = shown.combo !== undefined && combo > shown.combo;
            shown.combo = combo;
            const badge = $('hudCombo');
            $('hudComboText').textContent = `×${combo}`;
            badge.classList.toggle('is-hot', combo > 1);
            if (rose) { badge.classList.remove('pulse'); void badge.offsetWidth; badge.classList.add('pulse'); }
        }
        const time = formatTime(timeLeft);
        if (time !== shown.time) {
            shown.time = time;
            $('hudTimeText').textContent = time;
        }
        const low = timeLeft > 0 && timeLeft <= 10;
        if (low !== shown.low) {
            shown.low = low;
            $('hudTime').classList.toggle('is-low', low);
        }
    }

    // ── A round: countdown, play, pause, game over ──
    function showCount(step) {
        const text = COUNTDOWN[step];
        const number = element('span', step === 3 ? 'go' : '', text);
        countdownEl.hidden = false;
        countdownEl.replaceChildren(number);
        const frames = settings.reduceMotion
            ? [{opacity: 0}, {opacity: 1, offset: 0.2}, {opacity: 1, offset: 0.75}, {opacity: 0}]
            : [{opacity: 0, transform: 'scale(1.8)'}, {opacity: 1, transform: 'scale(1)', offset: 0.3}, {opacity: 1, transform: 'scale(1)', offset: 0.75}, {opacity: 0, transform: 'scale(.92)'}];
        if (number.animate) number.animate(frames, {duration: COUNT_SECONDS * 1000, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards'});
        sound('beep');
        announce(text);
    }

    function stepCountdown(dt) {
        round.countdown -= dt;
        if (round.countdown > 0) return;
        round.step++;
        showCount(round.step);
        if (round.step < 3) {
            round.countdown += COUNT_SECONDS;
        } else {
            round.phase = 'playing';
            show('playing');
        }
    }

    function startRound(level) {
        wakeAudio(audio);
        selectLevel(level);
        if (!instance) instance = game.create(canvas, api);
        round = {id: ++roundSeq, uid: newRoundId(), difficulty: level, phase: 'countdown', paused: false, step: 0, countdown: COUNT_SECONDS, playSeconds: 0, hud: {}};
        $('hudTime').classList.remove('is-low');
        instance.start(level);
        mode = 'round';
        show('countdown');
        showCount(0);
        syncMusic();
    }

    function pause() {
        if (!round || mode !== 'round' || round.paused || round.phase === 'over') return;
        round.paused = true;
        countdownEl.hidden = true;
        show('paused');
        announce('Paused');
        syncMusic();
    }

    function resume() {
        if (!round || !round.paused) return;
        wakeAudio(audio);
        round.paused = false;
        if (round.phase === 'countdown') {
            show('countdown');
            showCount(round.step);
        } else {
            show('playing');
        }
        syncMusic();
    }

    function toMenu(focusTarget) {
        round = null;
        mode = 'backdrop';
        countdownEl.hidden = true;
        renderMenuBest();
        show('menu', focusTarget);
        syncMusic();
    }

    function gameOver({score, stats}) {
        if (!round || round.phase === 'over') return;
        round.phase = 'over';
        mode = 'still';
        countdownEl.hidden = true;
        const previous = best;
        best = previous === null ? score : Math.max(previous, score);
        const stars = starsFor(score, game.stars);
        $('overScore').textContent = formatScore(score);
        $('overBest').textContent = formatScore(best);
        $('overNewBest').hidden = !(previous !== null && score > previous);
        renderStars($('overStars'), stars);
        overRoundId = round.id;
        pendingSave = null;
        $('overRank').hidden = true;
        $('overBadges').hidden = true;
        $('overBadges').replaceChildren();
        hideLeave();
        show('over');
        announce(`Time's up. Score ${formatScore(score)}, ${stars} of 3 stars.`);
        const body = JSON.stringify({game_key: key, difficulty: round.difficulty, score, duration_sec: Math.round(round.playSeconds), stats, round_id: round.uid});
        if (preview) setSave(round.id, 'preview');
        else save(round.id, body);
    }

    // Posts a finished round once. Only a retryable failure offers Retry, which resends the same body.
    async function save(id, body) {
        pendingSave = null;
        hideLeave();
        setSave(id, 'saving');
        let outcome;
        const abort = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = abort ? setTimeout(() => abort.abort(), SAVE_TIMEOUT_MS) : 0;
        try {
            const response = await fetch(`${apiBase}/games/plays.php`, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body, signal: abort ? abort.signal : undefined});
            let result = null;
            try { result = await response.json(); } catch { /* not JSON */ }
            outcome = saveOutcome(response.status, result);
        } catch {
            outcome = {kind: 'retry'};
        }
        clearTimeout(timer);
        if (outcome.kind === 'retry') pendingSave = {id, body};
        setSave(id, outcome.kind, outcome.data);
    }

    function setSave(id, kind, data) {
        if (id !== overRoundId) return;   // a later round's game over is showing
        saveState = kind;
        const points = data && Number.isFinite(data.points) ? data.points : null;
        const text = {
            saving: 'Saving…',
            preview: "Preview: scores aren't saved",
            saved: points === null ? 'Saved' : `Saved. ${formatScore(points)} ${points === 1 ? 'point' : 'points'} added to this week.`,
            retry: "Couldn't save this score",
            refused: "This score couldn't be saved"
        }[kind];
        const status = $('saveStatus');
        status.textContent = text;
        status.className = 'save' + (kind === 'saved' ? ' is-saved' : kind === 'retry' || kind === 'refused' ? ' is-failed' : '');
        $('retrySave').hidden = kind !== 'retry';
        // Leaving waits for the save to settle, so Play again can never start a round over an unsettled one.
        for (const exitId of OVER_EXITS) $(exitId).setAttribute('aria-disabled', String(kind === 'saving'));
        if (kind === 'saved') showRewards(id, data);
    }

    // After a save: the badges it earned, then the weekly rank from the game board.
    async function showRewards(id, data) {
        const earned = data && Array.isArray(data.new_badges) ? data.new_badges : [];
        $('overBadges').replaceChildren(...earned.map(badge => {
            const item = element('li');
            const mark = element('span', 'dot tone-yellow');
            mark.append(icon(iconId(badge.icon)));
            const copy = element('span', 'badge-copy');
            copy.append(element('span', 'sub', 'New badge'), element('b', '', String(badge.title ?? '')));
            item.append(mark, copy);
            return item;
        }));
        $('overBadges').hidden = !earned.length;
        try {
            const board = await fetchBoard();
            if (id !== overRoundId) return;
            learnBest(board);
            if (!board.me) return;   // a score of 0 is not ranked
            $('overRank').textContent = `#${board.me.rank} this week in ${board.section}`;
            $('overRank').hidden = false;
        } catch { /* the score is saved; only the rank is missing */ }
    }

    // Play again, Main menu and Exit wait while a save is in flight; after a failure that Retry could fix,
    // they ask first, so a score is only dropped when the student chooses to.
    function leaveOver(action) {
        if (saveState === 'saving') return;
        if (saveState !== 'retry') { hideLeave(); action(); return; }
        leaveAction = action;
        $('leaveConfirm').hidden = false;
        $('leaveStay').focus({preventScroll: true});
    }

    function hideLeave() {
        leaveAction = null;
        $('leaveConfirm').hidden = true;
    }

    // ── Canvas and the frame loop (the shell owns requestAnimationFrame) ──
    function paint() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        if (mode === 'backdrop' && game) game.drawBackdrop(ctx, clock, view.w, view.h, api.images);
        else if ((mode === 'round' || mode === 'still') && instance) instance.draw();
        else { ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, view.w, view.h); }   // before a game has loaded
    }

    function resize() {
        view.dpr = Math.min(window.devicePixelRatio || 1, 2);
        view.w = window.innerWidth;
        view.h = window.innerHeight;
        canvas.width = Math.round(view.w * view.dpr);
        canvas.height = Math.round(view.h * view.dpr);
        paint();   // resizing clears the canvas, so redraw even while paused
    }

    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(last ? Math.max(0, (now - last) / 1000) : 0, MAX_DT);
        last = now;
        if (mode === 'backdrop') {
            clock += dt * (settings.reduceMotion ? 0.4 : 1);
            paint();
        } else if (mode === 'round' && !round.paused) {
            if (round.phase === 'countdown') stepCountdown(dt);
            if (round.phase === 'playing' && dt > 0) {
                round.playSeconds += dt;   // the same capped clock the round runs on; pauses and the countdown never count
                instance.update(dt);
            }
            paint();
        }
    }

    // ── Loading ──
    function setProgress(fraction) {
        const percent = Math.round(fraction * 100);
        document.querySelector('#s-loading [role="progressbar"]').setAttribute('aria-valuenow', String(percent));
        $('progressFill').style.width = `${percent}%`;
    }

    async function load() {
        show('loading');
        setProgress(0);
        try {
            if (!game) game = (await entry.load()).default;
            paintBrand();
            renderMenuBest();
            if (mode === 'none') mode = 'backdrop';
            const base = `../assets/games/${key}/`;
            let canPlayOgg = false;
            try { canPlayOgg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== ''; } catch { /* no media element: use the .m4a copies */ }
            const assets = game.assets || {};
            renderSettings();
            const images = Object.entries(assets.images || {});
            const sounds = Object.entries(assets.sounds || {});
            const total = 1 + images.length + sounds.length + (assets.music ? 1 : 0);
            let done = 0;
            const tick = () => setProgress(++done / total);
            if ((sounds.length || assets.music) && !audio) {
                const Context = window.AudioContext || window.webkitAudioContext;
                if (Context) audio = new Context();
            }
            const loaded = {};
            const fonts = document.fonts ? Promise.all([document.fonts.load('400 32px Bungee'), document.fonts.load('700 16px "Plus Jakarta Sans"')]) : Promise.resolve();
            await Promise.all([
                Promise.race([fonts, new Promise(resolve => setTimeout(resolve, 3000))]).catch(() => {}).then(tick),
                ...images.map(async ([name, file]) => {
                    const image = new Image();
                    image.src = base + file;
                    await image.decode();
                    loaded[name] = image;
                    tick();
                }),
                // A sound that won't load or decode is skipped: the game plays without it rather than not at all.
                ...sounds.map(async ([name, file]) => {
                    try { buffers[name] = await fetchAudio(soundUrl(base, file, canPlayOgg)); } catch { delete buffers[name]; }
                    tick();
                }),
                ...(assets.music ? [fetchAudio(soundUrl(base, assets.music, canPlayOgg)).then(buffer => { musicBuffer = buffer; }, () => {}).then(tick)] : [])
            ]);
            api.images = loaded;
            show('tap');
        } catch {
            show('error');
        }
    }

    // ── Wiring ──
    $('previewTag').hidden = !preview;
    renderSettings();
    selectLevel(difficulty);
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
    if (seeded) {
        window.__gameDebug = {
            get state() { return instance ? instance.state : null; },
            poreCenter: i => (instance && instance.poreCenter ? instance.poreCenter(i) : null),
            get screen() { return screen; },
            get sounds() { return Object.keys(buffers); }
        };
    }

    $('tapStart').addEventListener('click', () => {
        unlocked = true;
        wakeAudio(audio);
        syncMusic();
        show('menu');
    });
    $('s-menu').addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'exit') return exit();
        if (action === 'settings') settingsFrom = 'menu';
        returnFocus[action] = button;
        show(action);
        if (action === 'scores') loadScores();
    });
    $('scoresSection').addEventListener('change', loadScores);
    $('scoresRetry').addEventListener('click', loadScores);
    for (const button of document.querySelectorAll('.panel .back')) button.addEventListener('click', back);
    for (const card of document.querySelectorAll('#s-new [data-level]')) card.addEventListener('click', () => selectLevel(card.dataset.level));
    $('startRound').addEventListener('click', () => startRound(difficulty));
    $('pauseBtn').addEventListener('click', pause);
    $('resumeBtn').addEventListener('click', resume);
    $('restartBtn').addEventListener('click', () => startRound(round ? round.difficulty : difficulty));
    $('pauseSettingsBtn').addEventListener('click', () => { settingsFrom = 'pause'; show('settings'); });
    $('quitBtn').addEventListener('click', () => toMenu());
    $('playAgain').addEventListener('click', () => leaveOver(() => startRound(round ? round.difficulty : difficulty)));
    $('overMenu').addEventListener('click', () => leaveOver(() => toMenu()));
    $('overExit').addEventListener('click', () => leaveOver(exit));
    $('retrySave').addEventListener('click', () => { if (pendingSave && pendingSave.id === overRoundId) save(pendingSave.id, pendingSave.body); });
    $('leaveStay').addEventListener('click', () => { hideLeave(); $('retrySave').focus({preventScroll: true}); });
    $('leaveGo').addEventListener('click', () => {
        const action = leaveAction;
        pendingSave = null;   // the student chose to drop this score
        saveState = 'none';
        hideLeave();
        if (action) action();
    });
    for (const id of ['errorExit', 'missingExit']) $(id).addEventListener('click', exit);
    $('errorRetry').addEventListener('click', load);
    $('muteBtn').addEventListener('click', () => {
        const muted = isMuted();
        changeSettings({sfx: muted, music: muted});
    });
    $('setSfx').addEventListener('change', event => changeSettings({sfx: event.target.checked}));
    $('setMusic').addEventListener('change', event => changeSettings({music: event.target.checked}));
    $('setMotion').addEventListener('change', event => changeSettings({reduceMotion: event.target.checked}));
    $('setVibration').addEventListener('change', event => {
        changeSettings({vibration: event.target.checked});
        if (event.target.checked) api.vibrate(40);
    });
    $('setSfxVolume').addEventListener('input', event => changeSettings({sfxVolume: Number(event.target.value)}));
    $('setSfxVolume').addEventListener('change', () => sound('pop'));
    $('setMusicVolume').addEventListener('input', event => changeSettings({musicVolume: Number(event.target.value)}));

    canvas.addEventListener('pointerdown', event => {
        if (screen !== 'playing' || !instance) return;
        event.preventDefault();
        const box = canvas.getBoundingClientRect();
        instance.pointer(event.clientX - box.left, event.clientY - box.top);
    });

    // Up and Down move through the open screen's controls; Enter and Space press them as usual.
    panel.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const section = $('s-' + panelScreen());
        const items = [...section.querySelectorAll('button, input')].filter(item => !item.disabled && item.getClientRects().length);
        const index = items.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        next.focus();
        if (next.getAttribute('role') === 'radio') selectLevel(next.dataset.level);
    });

    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const pauseKey = event.key === 'Escape' || event.code === 'KeyP';
        if (screen === 'countdown' || screen === 'playing') {
            if (pauseKey) { event.preventDefault(); pause(); return; }
            if (screen === 'playing' && !event.repeat && instance.key(event.code)) event.preventDefault();
            return;
        }
        if (screen === 'paused' && pauseKey) { event.preventDefault(); resume(); return; }
        if (screen === 'over' && event.key === 'Escape' && leaveAction) { event.preventDefault(); $('leaveStay').click(); return; }
        if (event.key === 'Escape' && SUB_SCREENS.has(screen)) { event.preventDefault(); back(); }
    });

    // A tab switch, a minimised window or a locked phone pauses the round.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') pause();
    });

    if (!entry) {
        document.querySelector('.play-top').hidden = true;   // no game: nothing to mute or preview
        $('previewTag').hidden = true;
        show('missing');
        return;
    }
    // A student's saved best, for the menu footer and "New best!"; it never blocks the game.
    if (isStudent) fetchBoard().then(learnBest).catch(() => {});
    load();
}
