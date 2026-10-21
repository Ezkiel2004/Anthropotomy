// Wiring for student/games.html: the pool and difficulty pickers, one card per game, the weekly
// leaderboard and the badges. A round takes over the page (runner.js) and its results screen leads back
// here. Set titles, terms, names and badge titles are user-supplied, so they only ever reach the page
// through textContent and attribute setters.

import {games, gameByKey} from './registry.js';
import {allSystemsPool, systemPool, setPool} from './cards.js';
import {DIFFICULTIES, MULTIPLIER} from './runner-core.js';
import {difficultyLabel, iconNode, runRound} from './runner.js';
import {el} from './play-kit.js';

const STORE_KEY = 'anthropotomy_game_difficulty';
const DEFAULT_DIFFICULTY = 'medium';
const LABELS = {easy: 'Easy', medium: 'Medium', hard: 'Hard'};

const BLURBS = {
    'match-pairs': 'Flip two tiles at a time and match each term with its clue.',
    'sort-it': 'Put every term into the group it belongs to.',
    'beat-the-clock': 'Read the clue and pick the right term before time runs out.',
    'unscramble': 'Type the term from its shuffled letters, with the clue as a hint.',
    'hunt-3d': 'Turn the 3D model and click the part that is named.',
};

// Units for a badge's progress line ("7 / 10 games"); percentages read "40% / 75%".
const UNITS = {
    completed_lessons: 'lessons', quizzes_taken: 'quizzes', quizzes_passed: 'quizzes passed',
    systems_explored: 'systems explored', total_time_hours: 'hours', games_played: 'games',
    perfect_rounds: 'perfect rounds', best_game_streak: 'in a row', game_systems_played: 'systems played',
    total_points: 'points',
};
const PERCENT_METRICS = new Set(['avg_quiz_score', 'overall_progress']);

const $ = id => document.getElementById(id);

async function getData(path) {
    const response = await fetch(`${API_BASE}/${path}`, {credentials: 'same-origin'});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || `Could not load ${path}`);
    return result.data;
}

async function getParts() {
    const response = await fetch('../system_model/layers/parts.json', {credentials: 'same-origin'});
    if (!response.ok) throw new Error('Could not load the part index');
    return response.json();
}

function savedDifficulty() {
    try {
        const value = localStorage.getItem(STORE_KEY);
        return DIFFICULTIES.includes(value) ? value : DEFAULT_DIFFICULTY;
    } catch {
        return DEFAULT_DIFFICULTY;
    }
}

function storeDifficulty(value) {
    try { localStorage.setItem(STORE_KEY, value); } catch { /* storage unavailable: the choice lasts this visit */ }
}

const number = value => Number(value).toLocaleString('en-PH', {maximumFractionDigits: 1});
const dateOf = value => new Date(String(value).replace(' ', 'T')).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric'});

// Every pool the student can play from: All systems, each active system and each set. A pool keeps the
// cards for the four card games and, when it is one body system with a model, a separate 3D Hunt pool
// of sided parts with that system's row (3D Hunt loads its model from it).
function buildPools(systems, sets, parts) {
    const pools = [{id: 'all', label: 'All systems', group: null, cards: allSystemsPool(systems, parts), hunt: null, source: {}, system: null}];
    for (const system of systems) {
        const own = parts[system.system_code];
        pools.push({
            id: `sys:${system.system_code}`, label: system.system_name, group: 'Body systems',
            cards: systemPool(system, own), hunt: {cards: systemPool(system, own, {sided: true}), system},
            source: {system_code: system.system_code}, system,
        });
    }
    for (const set of sets) {
        const cards = setPool(set);
        const system = set.system_id == null ? null : systems.find(s => s.system_id === set.system_id) || null;
        pools.push({
            id: `set:${set.set_id}`, label: set.title, group: 'Teacher sets',
            cards, hunt: system ? {cards, system} : null, source: {set_id: set.set_id}, system,
        });
    }
    return pools.filter(pool => pool.cards.length || pool.hunt?.cards.length);
}

// Whether a game can be played from a pool at a level, and with which cards; otherwise why not.
function gameState(game, pool, level) {
    if (game.key === 'hunt-3d') {
        if (!pool.hunt) return {ok: false, reason: 'Choose one body system to play'};
        if (!String(pool.hunt.system.model_url ?? '').trim()) return {ok: false, reason: 'This system has no 3D model yet'};
        if (!game.available(pool.hunt.cards, level)) return {ok: false, reason: `Needs at least ${level.roundSize} parts on the 3D model`};
        return {ok: true, cards: pool.hunt.cards, system: pool.hunt.system};
    }
    if (game.available(pool.cards, level)) return {ok: true, cards: pool.cards, system: pool.system};
    if (game.key === 'sort-it' && new Set(pool.cards.filter(c => c.group).map(c => c.group)).size < 2) {
        return {ok: false, reason: 'Needs terms from at least 2 groups'};
    }
    const needed = game.key === 'beat-the-clock' ? level.choices : level.roundSize;
    return {ok: false, reason: game.key === 'unscramble' ? `Needs at least ${needed} terms of 4 to 20 letters` : `Needs at least ${needed} terms`};
}

// What a round at this level holds, from the game's own level settings.
function levelSummary(key, level) {
    const parts = [];
    const each = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (key === 'match-pairs') {
        parts.push(each(level.roundSize, 'pair', 'pairs'));
        if (level.previewSec) parts.push(`shown for ${level.previewSec} s first`);
    } else if (key === 'sort-it') {
        parts.push(each(level.roundSize, 'term', 'terms'), `up to ${level.maxBins} groups`);
    } else if (key === 'beat-the-clock') {
        parts.push(each(level.roundSize, 'question', 'questions'), `${level.choices} choices`, `${level.perCardSec} s each`);
    } else if (key === 'unscramble') {
        parts.push(each(level.roundSize, 'word', 'words'));
        if (level.firstLetter) parts.push('first letter given');
        if (level.perCardSec) parts.push(`${level.perCardSec} s each`);
    } else if (key === 'hunt-3d') {
        parts.push(each(level.roundSize, 'part', 'parts'), each(level.tries, 'try', 'tries') + ' each');
    } else {
        parts.push(each(level.roundSize, 'card', 'cards'));
    }
    if (level.limitSec) parts.push(`${level.limitSec} s limit`);
    return parts.join(' · ');
}

function badgeProgress(badge) {
    const value = number(Math.max(0, Number(badge.value) || 0)), target = number(badge.threshold);
    if (PERCENT_METRICS.has(badge.metric)) return `${value}% / ${target}%`;
    return `${value} / ${target}${UNITS[badge.metric] ? ' ' + UNITS[badge.metric] : ''}`;
}

function main() {
    if (!Auth.getUser()) return;
    const state = {pools: [], stats: {}, difficulty: savedDifficulty(), playing: false};
    const picker = $('gamesPicker'), side = $('gamesSide'), playView = $('gamePlay'), runRoot = $('gameRun');
    const poolSelect = $('gamePool'), cardGrid = $('gameCards');

    // ── Difficulty: a radio group, one option per level with its points multiplier ──
    const options = $('difficultyOptions');
    for (const difficulty of DIFFICULTIES) {
        const label = el('label', 'game-seg-option');
        const input = el('input', 'sr-only', null, {type: 'radio', name: 'gameDifficulty', value: difficulty});
        input.checked = difficulty === state.difficulty;
        label.append(input, el('span', 'game-seg-name', LABELS[difficulty]), ' ', el('span', 'game-seg-mult', `×${MULTIPLIER[difficulty]}`));
        options.append(label);
    }
    options.addEventListener('change', event => {
        if (event.target.name !== 'gameDifficulty') return;
        state.difficulty = event.target.value;
        storeDifficulty(state.difficulty);
        renderCards();
    });

    const currentPool = () => state.pools.find(pool => pool.id === poolSelect.value) || state.pools[0];
    poolSelect.addEventListener('change', renderCards);

    function renderPools() {
        poolSelect.textContent = '';
        const groups = new Map();
        for (const pool of state.pools) {
            const option = el('option', '', pool.label, {value: pool.id});
            if (!pool.group) { poolSelect.append(option); continue; }
            if (!groups.has(pool.group)) {
                const group = el('optgroup', '', null, {label: pool.group});
                groups.set(pool.group, group);
                poolSelect.append(group);
            }
            groups.get(pool.group).append(option);
        }
    }

    // ── One card per game; a game the pool can't fill at this level is greyed out with the reason ──
    function renderCards() {
        const pool = currentPool();
        cardGrid.textContent = '';
        if (!pool) return;
        $('poolCount').textContent = `${number(pool.cards.length || pool.hunt?.cards.length || 0)} cards`;
        for (const game of games) {
            const level = game.levels[state.difficulty];
            const status = gameState(game, pool, level);
            const card = el('article', `game-card${status.ok ? '' : ' is-unavailable'}`, null, {'data-game': game.key});
            const top = el('div', 'game-card-top');
            const mark = el('span', 'game-card-icon');
            mark.append(iconNode(game.icon));
            top.append(mark);
            const copy = el('div', 'game-card-copy');
            copy.append(el('h3', 'game-card-title', game.name), el('p', 'game-card-desc', BLURBS[game.key] || ''));
            const foot = el('div', 'game-card-foot');
            foot.append(el('p', 'game-card-level', levelSummary(game.key, level)));
            const play = el('button', 'sd-go sd-go--sm game-play', null, {type: 'button'});
            play.append(el('span', '', 'Play'), el('span', 'sr-only', ` ${game.name}`));
            const disc = el('span', 'sd-go-disc');
            disc.append(iconNode('play'));
            play.append(disc);
            if (status.ok) {
                play.addEventListener('click', () => start(game.key));
            } else {
                const reasonId = `gameReason-${game.key}`;
                const reason = el('p', 'game-card-reason', null, {id: reasonId});
                reason.append(iconNode('lock-key'), el('span', '', status.reason));
                foot.append(reason);
                play.disabled = true;
                play.setAttribute('aria-describedby', reasonId);
            }
            foot.append(play);
            card.append(top, copy, foot);
            cardGrid.append(card);
        }
    }

    // ── Playing: the round takes over the page; its results screen leads back to the picker ──
    function showLobby(focusGame) {
        state.playing = false;
        runRoot.textContent = '';
        playView.hidden = true;
        picker.hidden = false;
        side.hidden = false;
        renderCards();
        const target = focusGame && cardGrid.querySelector(`.game-card[data-game="${focusGame}"] .game-play`);
        (target && !target.disabled ? target : poolSelect).focus({preventScroll: true});
        target?.scrollIntoView({block: 'center'});
    }

    function start(key) {
        if (state.playing) return;
        const game = gameByKey(key), pool = currentPool(), level = game?.levels[state.difficulty];
        const status = game && pool ? gameState(game, pool, level) : {ok: false};
        if (!status.ok) return;
        state.playing = true;
        picker.hidden = true;
        side.hidden = true;
        playView.hidden = false;
        $('gamePlayTitle').textContent = game.name;
        $('gamePlayMeta').textContent = `${pool.label} · ${difficultyLabel(state.difficulty)}`;
        playView.scrollIntoView({block: 'start'});      // the round, not the page header, fills the screen
        $('gamePlayTitle').focus({preventScroll: true});
        runRound({
            game, pool: status.cards, level, difficulty: state.difficulty, source: pool.source, root: runRoot,
            stats: state.stats, system: status.system,
            onPlayAgain: () => { state.playing = false; start(key); },
            onBack: () => showLobby(key),
            onSaved: (response, body) => {
                // Keep the card weighting current without another request, then refresh the board and badges.
                for (const result of body.results) {
                    const [seen = 0, correct = 0] = state.stats[result.card_key] || [];
                    state.stats[result.card_key] = [seen + 1, correct + (result.correct ? 1 : 0)];
                }
                loadBoard();
                loadBadges();
            },
        }).catch(error => {
            // runRound reports a game's own failures on the results area; this is anything else.
            console.error('The round could not run:', error);
            const message = $('gamesError');
            message.textContent = 'That game couldn’t start. Please try again.';
            message.hidden = false;
            showLobby(key);
        });
        // The results screen (or the reason the round couldn't start) stays until Play again or Back.
    }

    // ── This week in your section ──
    async function loadBoard() {
        const list = $('leaderboardList'), mine = $('leaderboardMe'), empty = $('leaderboardEmpty');
        try {
            const board = await getData('games/leaderboard.php');
            const me = Number(Auth.getUser()?.user_id);
            const inTop = board.top.some(row => Number(row.user_id) === me);
            $('leaderboardSection').textContent = board.section ? `Section ${board.section}` : '';
            list.textContent = '';
            for (const row of board.top) {
                const own = Number(row.user_id) === me;
                const item = el('li', `game-rank-row${own ? ' is-me' : ''}`);
                item.append(el('span', 'game-rank-pos', `#${row.rank}`), el('span', 'game-rank-name', row.full_name));
                if (own) item.append(el('span', 'sd-chip game-rank-you', 'You'));
                item.append(el('span', 'game-rank-points', `${number(row.points)} pts`));
                list.append(item);
            }
            list.hidden = !board.top.length;
            empty.hidden = board.top.length > 0;
            empty.textContent = 'No points yet this week. Finish a round to get on the board.';
            // A student outside the list gets one line with their own rank; inside it, their row is highlighted instead.
            mine.hidden = !(board.me && !inTop);
            mine.textContent = mine.hidden ? '' : `You: #${board.me.rank} · ${number(board.me.points)} points`;
        } catch {
            list.hidden = true;
            mine.hidden = true;
            empty.hidden = false;
            empty.textContent = 'The leaderboard couldn’t load. Refresh to try again.';
        }
    }

    // ── Badges: earned ones with their date, locked ones greyed with progress toward the goal ──
    async function loadBadges() {
        const list = $('badgeList'), empty = $('badgesEmpty');
        try {
            const badges = await getData('games/badges.php');
            list.textContent = '';
            for (const badge of badges) {
                const earned = Boolean(badge.earned_at);
                const item = el('li', `sd-ach game-badge${earned ? ' is-earned' : ''}`);
                const mark = el('span', 'sd-ach-icon');
                mark.append(iconNode(badge.icon));
                item.append(mark, el('span', 'sd-ach-name', badge.title));
                if (earned) {
                    item.append(el('span', 'sd-ach-state', `Earned ${dateOf(badge.earned_at)}`));
                } else {
                    const share = Math.min(100, Math.max(0, (Number(badge.value) || 0) / Number(badge.threshold) * 100)) || 0;
                    const meter = el('span', 'sd-meter game-badge-meter', null, {'aria-hidden': 'true'});
                    const fill = el('i');
                    fill.style.width = `${share}%`;
                    meter.append(fill);
                    item.append(el('span', 'sd-ach-state', badgeProgress(badge)), meter);
                }
                list.append(item);
            }
            $('badgeCount').textContent = badges.length ? `${badges.filter(b => b.earned_at).length} of ${badges.length} earned` : '';
            list.hidden = !badges.length;
            empty.hidden = badges.length > 0;
            empty.textContent = 'No badges have been set up yet.';
        } catch {
            list.hidden = true;
            empty.hidden = false;
            empty.textContent = 'Badges couldn’t load. Refresh to try again.';
        }
    }

    // ── Content: systems, sets and the part index build the pools; mastery weights the cards ──
    async function loadContent() {
        const [systems, sets, parts, mastery] = await Promise.allSettled([
            getData('anatomy-content.php?games=1'), getData('games/sets.php'), getParts(), getData('games/mastery.php'),
        ]);
        const value = (result, fallback) => (result.status === 'fulfilled' && result.value ? result.value : fallback);
        state.stats = value(mastery, {});
        state.pools = buildPools(value(systems, []), value(sets, []), value(parts, {}));
        const failed = [systems, sets].some(result => result.status === 'rejected');
        const error = $('gamesError');
        if (!state.pools.length) {
            picker.hidden = true;
            if (failed) {
                error.textContent = 'Unable to load the games. Please refresh to try again.';
                error.hidden = false;
            } else {
                $('gamesEmpty').hidden = false;
            }
            return;
        }
        if (failed) {
            error.textContent = 'Some game content couldn’t load. Refresh to see everything.';
            error.hidden = false;
        }
        renderPools();
        renderCards();
    }

    loadContent();
    loadBoard();
    loadBadges();
}

main();
