// Runs one round of one game on the Games page: chooses the cards, plays the game, times it, saves the
// results to api/games/plays.php and shows the results screen. Terms, clues and badge titles are
// teacher-supplied text, so every node is built with createElement and textContent, never parsed as HTML.
//
// runRound({game, pool, level, difficulty, source, root, stats, system, onPlayAgain, onBack, onSaved})
//   pool       the cards the game may use (for 3D Hunt, the sided pool of one system)
//   source     {set_id} for a teacher set, {system_code} for one body system, {} for All systems
//   system     the anatomy-content.php row passed to play() as ctx.system (3D Hunt loads its model)
//   onSaved    called with (response, body) every time a round is saved, including after Retry
// Resolves after the first save attempt with {saved, response?}; a round that cannot start resolves
// {saved: false, error}. While a round runs there is no way back except leaving the page: play-kit has
// no abort, and 3D Hunt only releases its model when the round ends.

import {pickCards, streaks, MULTIPLIER} from './runner-core.js';
import {el} from './play-kit.js';

const SPRITE = '../assets/icons/interface.svg?v=20261012-icons3';
const TOAST_MS = 6000;
const LABELS = {easy: 'Easy', medium: 'Medium', hard: 'Hard'};

// Why a round could not start, by the error a game's play() rejects with.
const PROBLEMS = {
    'model-unavailable': "This model couldn't load. Try another game or system.",
    'parts-missing': "Some parts in this set don't match the 3D model, so 3D Hunt can't use it.",
};

const apiBase = () => (typeof API_BASE === 'undefined' ? '../api' : API_BASE);

export const difficultyLabel = difficulty => `${LABELS[difficulty] || difficulty} ×${MULTIPLIER[difficulty] ?? 1}`;

// A Phosphor icon from the sprite. The id comes from the server (badge icons), so it is reduced to sprite-id characters.
export function iconNode(id, className = 'ui-icon') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `${SPRITE}#${String(id ?? '').replace(/[^a-z0-9-]/g, '') || 'medal'}`);
    svg.append(use);
    return svg;
}

const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function button(className, text, icon) {
    const node = el('button', className, null, {type: 'button'});
    node.append(el('span', '', text));
    if (icon) {
        const disc = el('span', 'sd-go-disc');
        disc.append(iconNode(icon));
        node.append(disc);
    }
    return node;
}

function ghost(className, text, icon) {
    const node = el('button', `sd-ghost ${className}`, null, {type: 'button'});
    if (icon) node.append(iconNode(icon));
    node.append(el('span', '', text));
    return node;
}

// Saves a round. Network errors and 5xx answers can be retried; any other refusal (a 4xx) cannot.
async function post(payload) {
    try {
        const response = await fetch(`${apiBase()}/games/plays.php`, {
            method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: payload,
        });
        let result = null;
        try { result = await response.json(); } catch { /* not JSON: treat as a server failure */ }
        if (response.ok && result?.success) return {kind: 'saved', data: result.data};
        if (response.status >= 500 || !result) return {kind: 'retry'};
        return {kind: 'refused', message: String(result.message || '')};
    } catch {
        return {kind: 'retry'};
    }
}

let toastRegion = null;

// A popup for each badge the round earned: its icon and title.
export function badgeToast(badge) {
    if (!toastRegion?.isConnected) {
        toastRegion = el('div', 'game-toasts', null, {role: 'status', 'aria-live': 'polite'});
        document.body.append(toastRegion);
    }
    const toast = el('div', 'game-toast');
    const mark = el('span', 'game-toast-icon');
    mark.append(iconNode(badge.icon));
    const copy = el('span', 'game-toast-copy');
    copy.append(el('span', 'game-toast-kicker', 'Badge earned'), el('strong', 'game-toast-title', String(badge.title ?? '')));
    toast.append(mark, copy);
    toastRegion.append(toast);
    const remove = () => { toast.classList.add('is-leaving'); setTimeout(() => toast.remove(), 250); };
    const timer = setTimeout(remove, TOAST_MS);
    toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

function showProblem(root, message, onBack) {
    root.textContent = '';
    const box = el('div', 'sd-empty game-problem', null, {role: 'alert'});
    const back = ghost('game-back', 'Choose another game', 'arrow-left');
    back.addEventListener('click', () => onBack?.());
    box.append(el('p', 'sd-empty-title', "This round can't start"), el('p', 'game-problem-text', message), back);
    root.append(box);
    back.focus({preventScroll: true});
    box.scrollIntoView({block: 'nearest'});
}

export async function runRound({game, pool, level, difficulty, source = {}, root, stats = {}, system = null,
    onPlayAgain, onBack, onSaved}) {
    const cards = game.choose ? game.choose(pool, level, stats) : pickCards(pool, level.roundSize, stats);
    root.textContent = '';
    if (!cards.length) {
        showProblem(root, 'There are no cards to play here. Try another game or pool.', onBack);
        return {saved: false, error: 'no-cards'};
    }

    // During the round: the game below a strip with the time so far and the current streak.
    const results = [], clues = new Map();
    const strip = el('div', 'game-run-hud');
    const timeText = el('span', '', '0:00'), streakText = el('span', '', 'Streak 0');
    const timeStat = el('span', 'game-run-stat game-run-clock', null, {title: 'Time so far'});
    const streakStat = el('span', 'game-run-stat game-run-streak', null, {title: 'Correct in a row'});
    timeStat.append(iconNode('clock'), el('span', 'sr-only', 'Time so far: '), timeText);
    streakStat.append(iconNode('target'), streakText);
    strip.append(timeStat, streakStat);
    const stage = el('div', 'game-root');
    root.append(strip, stage);

    let run = 0;
    const report = (card, correct) => {
        const ok = Boolean(correct);
        results.push({card_key: card.key, term: String(card.term ?? ''), correct: ok});
        clues.set(results.length - 1, String(card.clue ?? ''));
        run = ok ? run + 1 : 0;
        streakText.textContent = `Streak ${run}`;
    };

    const started = performance.now();
    const ticker = setInterval(() => { timeText.textContent = clock((performance.now() - started) / 1000); }, 1000);
    try {
        await game.play(stage, cards, level, report, {system});
    } catch (error) {
        const code = error?.message || 'error';
        if (Array.isArray(error?.meshes)) console.warn('3D Hunt: parts missing from the model:', error.meshes);
        else if (!PROBLEMS[code]) console.warn('The round stopped:', error);
        showProblem(root, PROBLEMS[code] || 'Something went wrong with this round. Try another game.', onBack);
        return {saved: false, error: code};
    } finally {
        clearInterval(ticker);
    }
    const duration = Math.max(1, Math.ceil((performance.now() - started) / 1000));
    if (!results.length) {
        showProblem(root, 'No cards were played in this round.', onBack);
        return {saved: false, error: 'no-results'};
    }

    const body = {game_key: game.key, difficulty};
    if (source.set_id != null) body.set_id = source.set_id;
    else if (source.system_code) body.system_code = source.system_code;
    body.duration_sec = duration;
    body.results = results;
    const payload = JSON.stringify(body);       // Retry sends exactly this

    const view = renderResults(root, {game, difficulty, results, clues, onPlayAgain, onBack});
    let busy = false;
    const attempt = async () => {
        if (busy) return null;
        busy = true;
        view.saving();
        const outcome = await post(payload);
        busy = false;
        if (outcome.kind === 'saved') {
            view.saved(outcome.data);
            for (const badge of outcome.data.new_badges || []) badgeToast(badge);
            onSaved?.(outcome.data, body);
        } else {
            view.failed(outcome);
        }
        return outcome;
    };
    view.onRetry(attempt);
    const first = await attempt();
    return first.kind === 'saved' ? {saved: true, response: first.data} : {saved: false};
}

// The results screen: correct of total, points, best streak, the save status, the missed cards and their
// clues, then Play again and Choose another game. Points come from the server, so they show once saved.
function renderResults(root, {game, difficulty, results, clues, onPlayAgain, onBack}) {
    root.textContent = '';
    const correct = results.filter(r => r.correct).length;
    const section = el('section', 'game-results', null, {'aria-labelledby': 'gameResultsTitle'});
    const title = el('h3', 'game-results-title', 'Round complete', {id: 'gameResultsTitle', tabindex: '-1'});
    const head = el('div', 'game-results-head');
    head.append(title, el('p', 'game-results-sub', `${game.name} · ${difficultyLabel(difficulty)}`));

    const stats = el('dl', 'sd-stats sd-stats--three game-result-stats');
    const stat = (key, label, value) => {
        const item = el('div', 'sd-stat'), dd = el('dd'), shown = el('span', 'sd-stat-value', value, {'data-stat': key});
        dd.append(shown);
        item.append(el('dt', '', label), dd);
        stats.append(item);
        return shown;
    };
    stat('correct', 'Correct', `${correct} / ${results.length}`);
    const points = stat('points', 'Points', '–');
    const streak = stat('streak', 'Best streak', String(streaks(results.map(r => r.correct))));
    points.classList.add('is-pending');

    const saveRow = el('div', 'game-save-row');
    const status = el('p', 'game-save', 'Saving…', {role: 'status'});
    const retry = ghost('game-retry', 'Retry', 'arrows-clockwise');
    retry.hidden = true;
    saveRow.append(status, retry);

    const missedRows = results.map((r, i) => [r, clues.get(i)]).filter(([r]) => !r.correct);
    const review = el('div', 'game-review');
    if (missedRows.length) {
        review.append(el('h4', 'game-review-title', missedRows.length === 1 ? 'The card to review' : `${missedRows.length} cards to review`));
        const list = el('ul', 'sd-review game-missed');
        for (const [row, clue] of missedRows) {
            const item = el('li', 'sd-review-item is-wrong');
            const mark = el('span', 'sd-review-mark');
            mark.append(iconNode('x'), el('span', 'sr-only', 'Missed'));
            const copy = el('span', 'sd-review-copy');
            copy.append(el('strong', 'game-missed-term', row.term), el('span', 'game-missed-clue', clue));
            item.append(mark, copy);
            list.append(item);
        }
        review.append(list);
    } else {
        review.append(el('p', 'game-review-none', 'Every card right. Nothing to review this time.'));
    }

    const actions = el('div', 'sd-actions game-results-actions');
    const again = button('sd-go sd-go--yellow sd-go--sm game-again', 'Play again', 'arrows-clockwise');
    const back = ghost('game-back', 'Choose another game', 'arrow-left');
    again.addEventListener('click', () => onPlayAgain?.());
    back.addEventListener('click', () => onBack?.());
    actions.append(again, back);

    section.append(head, stats, saveRow, review, actions);
    root.append(section);
    title.focus({preventScroll: true});
    section.scrollIntoView({block: 'nearest'});         // a tall round may have left the page scrolled past it

    let retryHandler = null;
    retry.addEventListener('click', () => retryHandler?.());
    return {
        onRetry(handler) { retryHandler = handler; },
        saving() {
            status.textContent = 'Saving…';
            status.className = 'game-save';
        },
        saved(data) {
            points.textContent = String(data.points);
            points.classList.remove('is-pending');
            streak.textContent = String(data.best_streak);
            status.textContent = `Saved. ${data.points} ${data.points === 1 ? 'point' : 'points'} added to this week.`;
            status.className = 'game-save is-saved';
            const hadFocus = document.activeElement === retry;
            retry.hidden = true;
            if (hadFocus) again.focus({preventScroll: true});
        },
        failed(outcome) {
            status.className = 'game-save is-failed';
            if (outcome.kind === 'retry') {
                status.textContent = "Couldn't save this round. Check your connection, then try again.";
                retry.hidden = false;
            } else {
                status.textContent = `Couldn't save this round. ${outcome.message}`.trim();
                retry.hidden = true;
            }
        },
    };
}
