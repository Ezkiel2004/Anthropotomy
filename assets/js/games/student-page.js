// Wiring for student/games.html: one card per finished game (GAMES in shell.js) with the student's best
// score, this week's points board for their section, and the badges. Names and badge titles are
// user-supplied, so they only ever reach the page through textContent and attribute setters.

import {GAMES, bestScore} from './shell.js';

const SPRITE = '../assets/icons/interface.svg?v=20261012-icons3';

// Units for a badge's progress line ("7 / 10 games"); percentages read "40% / 75%".
const UNITS = {
    completed_lessons: 'lessons', quizzes_taken: 'quizzes', quizzes_passed: 'quizzes passed',
    systems_explored: 'systems explored', total_time_hours: 'hours', games_played: 'games',
    best_game_streak: 'in a row', total_points: 'points', games_variety: 'games',
};
const PERCENT_METRICS = new Set(['avg_quiz_score', 'overall_progress']);

const $ = id => document.getElementById(id);

function el(tag, className = '', text = null, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
}

function iconNode(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `${SPRITE}#${String(id ?? '').replace(/[^a-z0-9-]/g, '') || 'medal'}`);
    svg.append(use);
    return svg;
}

async function getData(path) {
    const response = await fetch(`${API_BASE}/${path}`, {credentials: 'same-origin'});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || `Could not load ${path}`);
    return result.data;
}

const number = value => Number(value).toLocaleString('en-PH', {maximumFractionDigits: 1});
const dateOf = value => new Date(String(value).replace(' ', 'T')).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric'});

function badgeProgress(badge) {
    const value = number(Math.max(0, Number(badge.value) || 0)), target = number(badge.threshold);
    if (PERCENT_METRICS.has(badge.metric)) return `${value}% / ${target}%`;
    return `${value} / ${target}${UNITS[badge.metric] ? ' ' + UNITS[badge.metric] : ''}`;
}

// One game's card: its art (card.webp once it exists; until then, and whenever it fails, a drawn skin panel
// with the title), the title and tagline, the student's best score and a Play link to the game's page.
function gameCard(key, game) {
    const card = el('article', 'game-card', null, {'data-game': key, 'aria-labelledby': `gameTitle-${key}`});
    const art = el('div', 'game-card-art');
    const drawn = el('div', 'game-card-fallback', null, {'aria-hidden': 'true'});
    const [first, ...rest] = game.title.split(' ');
    drawn.append(el('span', '', first), el('span', 'is-accent', rest.join(' ')));
    const image = el('img', '', null, {alt: '', width: '1280', height: '720', decoding: 'async'});
    image.addEventListener('load', () => art.classList.add('has-image'), {once: true});
    image.addEventListener('error', () => image.remove(), {once: true});
    image.src = game.card;
    art.append(drawn, image);

    const body = el('div', 'game-card-body');
    body.append(el('h3', 'game-card-title', game.title, {id: `gameTitle-${key}`}), el('p', 'game-card-desc', game.tagline));
    const foot = el('div', 'game-card-foot');
    const best = el('p', 'game-card-best');
    best.append(el('span', 'game-card-best-label', 'Your best'), el('b', 'game-card-best-value', '…'));
    const play = el('a', 'sd-go sd-go--yellow game-play', null, {href: `play.html?game=${encodeURIComponent(key)}`});
    play.append(el('span', '', 'Play'), el('span', 'sr-only', ` ${game.title}`));
    const disc = el('span', 'sd-go-disc');
    disc.append(iconNode('play'));
    play.append(disc);
    foot.append(best, play);
    body.append(foot);
    card.append(art, body);
    return {card, best};
}

function main() {
    if (!Auth.getUser()) return;
    const me = Number(Auth.getUser()?.user_id);

    // ── The gallery: each finished game, with the student's best from its board ──
    function renderGallery() {
        const gallery = $('gameGallery');
        gallery.textContent = '';
        for (const [key, game] of Object.entries(GAMES)) {
            const {card, best} = gameCard(key, game);
            gallery.append(card);
            loadBest(key, best);
        }
    }

    async function loadBest(key, box) {
        const value = box.querySelector('.game-card-best-value');
        try {
            const board = await getData(`games/leaderboard.php?game=${encodeURIComponent(key)}`);
            const best = bestScore(board.best);
            value.textContent = best === null ? 'No score yet' : number(best);
            box.classList.toggle('is-empty', best === null);
        } catch {
            value.textContent = 'Couldn’t load';
            box.classList.add('is-empty');
        }
        box.dataset.loaded = 'true';
    }

    // ── This week in your section: total points across games ──
    async function loadBoard() {
        const list = $('leaderboardList'), mine = $('leaderboardMe'), empty = $('leaderboardEmpty');
        try {
            const board = await getData('games/leaderboard.php');
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

    renderGallery();
    loadBoard();
    loadBadges();
}

main();
