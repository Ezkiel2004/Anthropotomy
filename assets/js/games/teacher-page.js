// Wiring for teacher/games.html: this week's leaderboard for one section (all games by points, or one game
// by each student's best score), the badge rules, and a Try link that opens each game in preview.
// Student names and badge titles are user-supplied, so they only ever reach the page through textContent,
// input values and attribute setters, never parsed as HTML.
// Importing this module touches no DOM; main() runs only in a page.

import {GAMES} from './shell.js';

const SPRITE = '../assets/icons/interface.svg?v=20261012-icons3';

// The only icons a badge can use, in picker order.
export const BADGE_ICONS = [
    ['game-controller', 'Game controller'], ['trophy', 'Trophy'], ['check-circle', 'Check mark'],
    ['target', 'Target'], ['flag', 'Flag'], ['medal', 'Medal'],
];

// Every metric api/helpers.php accepts (BADGE_METRICS), with a plain label; unit words the target hint.
export const METRICS = [
    {key: 'completed_lessons', label: 'Lessons completed', group: 'Learning', unit: 'lessons'},
    {key: 'avg_quiz_score', label: 'Average quiz score', group: 'Learning', unit: '%'},
    {key: 'quizzes_taken', label: 'Quizzes taken', group: 'Learning', unit: 'quizzes'},
    {key: 'quizzes_passed', label: 'Quizzes passed', group: 'Learning', unit: 'quizzes'},
    {key: 'systems_explored', label: 'Body systems explored in 3D', group: 'Learning', unit: 'systems'},
    {key: 'total_time_hours', label: 'Hours spent learning', group: 'Learning', unit: 'hours'},
    {key: 'overall_progress', label: 'Overall lesson progress', group: 'Learning', unit: '%'},
    {key: 'games_played', label: 'Games played', group: 'Games', unit: 'games'},
    {key: 'best_game_streak', label: 'Best combo in one round', group: 'Games', unit: 'hits in a row'},
    {key: 'total_points', label: 'Total game points', group: 'Games', unit: 'points'},
    {key: 'games_variety', label: 'Different games played', group: 'Games', unit: 'different games'},
];

const ALL_GAMES = 'all';
const PERCENT = new Set(METRICS.filter(m => m.unit === '%').map(m => m.key));
const metricOf = key => METRICS.find(m => m.key === key);
const length = text => [...text].length;             // the server counts characters, not UTF-16 units
const number = value => Number(value).toLocaleString('en-PH', {maximumFractionDigits: 2});
const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many}`;
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

// A request to the API. Resolves with the data; otherwise throws an Error whose message can be shown.
async function request(path, {method = 'GET', body} = {}) {
    let response, result = null;
    try {
        response = await fetch(`${API_BASE}/${path}`, {
            method, credentials: 'same-origin',
            headers: body === undefined ? {} : {'Content-Type': 'application/json'},
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new Error('Couldn’t reach the server. Check your connection and try again.');
    }
    try { result = await response.json(); } catch { /* not JSON: reported below */ }
    if (!response.ok || !result?.success) throw new Error(result?.message || 'Something went wrong. Please try again.');
    return result.data;
}

function goalText(badge) {
    const metric = metricOf(badge.metric);
    const target = number(badge.threshold);
    if (!metric) return `${badge.metric}: ${target}`;
    return `${metric.label}: ${target}${PERCENT.has(badge.metric) ? '%' : ''}`;
}

function button(className, label, icon, attrs = {}) {
    const node = el('button', `btn btn-secondary btn-sm ${className}`.trim(), null, {type: 'button', ...attrs});
    if (icon) node.append(iconNode(icon));
    node.append(el('span', '', label));
    return node;
}

function statusCell(on) {
    const cell = el('td', 'tg-status-cell');
    cell.append(el('span', `badge ${on ? 'badge-success' : 'badge-neutral'} tg-status`, on ? 'On' : 'Off'));
    return cell;
}

// Show one of a list's states: loading, the table, or the empty/error message.
function showList(prefix, view) {
    $(`${prefix}Loading`).hidden = view !== 'loading';
    $(`${prefix}TableWrap`).hidden = view !== 'table';
    $(`${prefix}Empty`).hidden = view !== 'empty';
}

function emptyText(prefix, title, text) {
    $(`${prefix}EmptyTitle`).textContent = title;
    $(`${prefix}EmptyText`).textContent = text;
    showList(prefix, 'empty');
}

function main() {
    if (!Auth.getUser()) return;
    const state = {badges: [], section: '', game: ALL_GAMES};
    let boardToken = 0;

    // ── Try links: each game opens on its own page, in preview for teachers ──
    $('tryGames').replaceChildren(...Object.entries(GAMES).map(([key, game]) => {
        const link = el('a', 'btn btn-secondary btn-sm tg-try', null, {href: `../student/play.html?game=${encodeURIComponent(key)}`});
        link.append(iconNode('game-controller'), el('span', '', `Try ${game.title}`));
        return link;
    }));

    // ── Tabs: a tablist with arrow-key movement; the chosen tab is kept in the address ──
    const tabList = $('gamesTabs');
    const tabs = [...tabList.querySelectorAll('[role="tab"]')];
    function selectTab(tab, {focus = false, remember = true} = {}) {
        for (const other of tabs) {
            const on = other === tab;
            other.setAttribute('aria-selected', String(on));
            other.classList.toggle('active', on);
            other.tabIndex = on ? 0 : -1;
            $(other.getAttribute('aria-controls')).hidden = !on;
        }
        if (focus) tab.focus();
        if (remember) {
            try { history.replaceState(null, '', `#${tab.id.slice(4)}`); } catch { /* the address stays as it is */ }
        }
    }
    tabList.addEventListener('click', event => {
        const tab = event.target.closest('[role="tab"]');
        if (tab) selectTab(tab);
    });
    tabList.addEventListener('keydown', event => {
        const index = tabs.indexOf(document.activeElement);
        const next = {ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1}[event.key];
        if (index < 0 || next === undefined) return;
        event.preventDefault();
        selectTab(tabs[(next + tabs.length) % tabs.length], {focus: true});
    });
    selectTab(tabs.find(tab => location.hash === `#${tab.id.slice(4)}`) || tabs[0], {remember: false});

    // ── Dialogs: focus moves in, Tab stays inside, Escape or the backdrop closes, focus goes back ──
    let dialog = null;
    const focusables = root => [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
        .filter(node => node.getClientRects().length > 0);
    function openDialog(id, trigger, first, {returnTo = null} = {}) {
        dialog = {id, trigger, returnTo};
        openModal(id);
        (first || focusables($(id))[0])?.focus();
    }
    function closeDialog() {
        if (!dialog) return;
        const {id, trigger, returnTo} = dialog;
        dialog = null;
        closeModal(id);
        // A list may have been redrawn while the dialog was open; then focus its new copy of the trigger.
        const target = trigger?.isConnected ? trigger : (returnTo && document.querySelector(returnTo));
        target?.focus();
    }
    const badgeOverlay = $('badgeModal');
    badgeOverlay.addEventListener('click', event => {
        if (event.target === badgeOverlay || event.target.closest('[data-close]')) closeDialog();
    });
    document.addEventListener('keydown', event => {
        if (!dialog) return;
        if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
        if (event.key !== 'Tab') return;
        const items = focusables($(dialog.id).querySelector('.modal-box'));
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    // ── The leaderboard: one section at a time; All games ranks total points, one game ranks weekly bests ──
    const gameTitle = key => GAMES[key]?.title ?? key;
    function boardRow(row, byGame) {
        const item = el('tr');
        item.append(
            el('td', 'tg-rank', `#${row.rank}`),
            el('th', 'tg-board-name', row.full_name, {scope: 'row'}),
            el('td', 'tg-board-value', byGame ? number(row.score) : `${number(row.points)} pts`),
        );
        return item;
    }
    async function loadBoard() {
        const {section, game} = state, token = ++boardToken;
        const byGame = game !== ALL_GAMES;
        $('boardValueHead').textContent = byGame ? 'Best score' : 'Points';
        $('boardNote').textContent = byGame ? `The top 10 by best ${gameTitle(game)} score this week.` : 'The top 10 by game points this week.';
        $('boardCaption').textContent = byGame ? `This week's best ${gameTitle(game)} scores` : 'This week\'s leaderboard';
        showList('board', 'loading');
        try {
            const query = `section=${encodeURIComponent(section)}` + (byGame ? `&game=${encodeURIComponent(game)}` : '');
            const board = await request(`games/leaderboard.php?${query}`);
            if (token !== boardToken) return;
            const since = new Date(String(board.week_start).replace(' ', 'T'));
            $('boardWeek').textContent = Number.isNaN(since.getTime()) ? '' : `The week began ${since.toLocaleDateString('en-PH', {weekday: 'long', month: 'short', day: 'numeric'})}.`;
            $('boardRows').replaceChildren(...board.top.map(row => boardRow(row, byGame)));
            if (board.top.length) showList('board', 'table');
            else if (byGame) emptyText('board', 'No scores yet this week', `No one in ${section} has finished a round of ${gameTitle(game)} since the week began.`);
            else emptyText('board', 'No points yet this week', `No one in ${section} has scored points in the games since the week began.`);
        } catch (error) {
            if (token !== boardToken) return;
            $('boardRows').replaceChildren();
            emptyText('board', 'The leaderboard couldn’t load', `${error.message} Choose the section again to retry.`);
        }
    }

    const sectionPicker = $('boardSection'), gamePicker = $('boardGame');
    gamePicker.replaceChildren(new Option('All games', ALL_GAMES), ...Object.entries(GAMES).map(([key, game]) => new Option(game.title, key)));
    gamePicker.value = ALL_GAMES;
    gamePicker.addEventListener('change', () => { state.game = gamePicker.value; loadBoard(); });
    sectionPicker.addEventListener('change', () => { state.section = sectionPicker.value; loadBoard(); });
    async function loadSections() {
        const config = typeof SiteConfig === 'undefined' ? {} : await SiteConfig.ready;
        const sections = Array.isArray(config?.sections) ? config.sections.map(String) : [];
        state.section = sections[0] || '';
        sectionPicker.replaceChildren(...sections.map(section => new Option(section, section)));
        sectionPicker.disabled = !sections.length;
        if (!state.section) {
            emptyText('board', 'Sections couldn’t load', 'Refresh the page to try again.');
            return;
        }
        loadBoard();
    }

    // ── Badges: built-in ones can be edited or turned off, never deleted (the migration would bring them
    // back); badges the teacher adds can also be deleted. Rules whose goal was retired with the quiz games
    // (perfect rounds, body systems played) can never be earned again, so they are left out. ──
    const isOn = badge => badge.is_active === true || Number(badge.is_active) === 1;
    const isBuiltIn = badge => badge.badge_key != null && badge.badge_key !== '';
    function badgeRow(badge) {
        const builtIn = isBuiltIn(badge), on = isOn(badge);
        const row = el('tr', [builtIn ? 'is-builtin' : '', on ? '' : 'is-off'].filter(Boolean).join(' '), null, {'data-badge-id': String(badge.achievement_id)});
        const head = el('th', 'tg-name-cell', null, {scope: 'row'});
        const wrap = el('div', 'tg-badge');
        const mark = el('span', 'tg-badge-icon');
        mark.append(iconNode(badge.icon));
        const copy = el('div', 'tg-badge-copy');
        copy.append(el('span', 'tg-badge-title', badge.title), el('span', 'tg-sub', builtIn ? 'Built-in' : 'Added by you'));
        wrap.append(mark, copy);
        head.append(wrap);
        const actions = el('td', 'tg-actions-cell');
        const group = el('div', 'tg-actions');
        group.append(
            button('', 'Edit', 'pencil-simple', {'data-action': 'edit', 'aria-label': `Edit ${badge.title}`}),
            button('', on ? 'Turn off' : 'Turn on', on ? 'eye-slash' : 'eye', {'data-action': 'toggle', 'aria-label': `${on ? 'Turn off' : 'Turn on'} ${badge.title}`}),
        );
        if (!builtIn) group.append(button('tg-danger', 'Delete', 'trash', {'data-action': 'delete', 'aria-label': `Delete ${badge.title}`}));
        actions.append(group);
        row.append(head, el('td', 'tg-count-cell', goalText(badge)), statusCell(on), actions);
        return row;
    }
    function renderBadges() {
        const listed = state.badges.filter(badge => metricOf(badge.metric));
        $('badgeRows').replaceChildren(...listed.map(badgeRow));
        const on = listed.filter(isOn).length;
        $('badgeCount').textContent = listed.length ? `${plural(listed.length, 'badge', 'badges')}, ${number(on)} on.` : '';
        if (listed.length) showList('badges', 'table');
        else emptyText('badges', 'No badges yet', 'Choose Add badge to set a goal for students.');
    }
    async function loadBadges() {
        try {
            state.badges = await request('achievements.php');
            renderBadges();
        } catch (error) {
            $('badgeCount').textContent = '';
            emptyText('badges', 'Badges couldn’t load', `${error.message} Refresh the page to try again.`);
        }
    }
    const badgeById = id => state.badges.find(badge => Number(badge.achievement_id) === Number(id));
    $('badgeRows').addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        const badge = control && badgeById(control.closest('tr').dataset.badgeId);
        if (!badge) return;
        if (control.dataset.action === 'edit') openBadgeEditor(badge, control);
        else if (control.dataset.action === 'toggle') toggleBadge(badge, control);
        else if (control.dataset.action === 'delete' && !isBuiltIn(badge)) deleteBadge(badge);
    });
    async function toggleBadge(badge, control) {
        const on = !isOn(badge);
        control.disabled = true;
        try {
            await request(`achievements.php?id=${badge.achievement_id}`, {method: 'PUT', body: {is_active: on}});
            badge.is_active = on;
            renderBadges();
            $('badgeRows').querySelector(`tr[data-badge-id="${badge.achievement_id}"] [data-action="toggle"]`)?.focus();
            showToast(on ? `${badge.title} is on. Students can earn it.` : `${badge.title} is off. Students no longer see it.`, 'success');
        } catch (error) {
            control.disabled = false;
            showToast(error.message, 'error');
        }
    }
    async function deleteBadge(badge) {
        if (!confirm(`Delete the badge “${badge.title}”? Students who earned it will no longer have it.`)) return;
        try {
            await request(`achievements.php?id=${badge.achievement_id}`, {method: 'DELETE'});
            state.badges = state.badges.filter(other => other !== badge);
            renderBadges();
            $('newBadgeBtn').focus();
            showToast(`${badge.title} was deleted.`, 'success');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    // ── Badge editor: title, goal (metric and target) and one of the six icons ──
    const badgeEditor = {id: null};
    const metricSelect = $('badgeMetric');
    for (const groupName of ['Learning', 'Games']) {
        const group = el('optgroup', '', null, {label: groupName});
        for (const metric of METRICS.filter(m => m.group === groupName)) group.append(new Option(metric.label, metric.key));
        metricSelect.append(group);
    }
    for (const [id, label] of BADGE_ICONS) {
        const option = el('label', 'tg-icon-option');
        option.append(el('input', 'sr-only', null, {type: 'radio', name: 'badgeIcon', value: id}), iconNode(id), el('span', '', label));
        $('badgeIcons').append(option);
    }
    const unitHint = () => {
        const metric = metricOf(metricSelect.value);
        $('badgeUnit').textContent = !metric ? '' : metric.unit === '%' ? 'A percentage, up to 100.' : `How many ${metric.unit} a student needs.`;
    };
    metricSelect.addEventListener('change', unitHint);

    function clearFormErrors(form, box) {
        box.hidden = true;
        box.textContent = '';
        form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    }
    function badgeFormError(message, field) {
        const box = $('badgeError');
        box.textContent = message;
        box.hidden = false;
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }
    }
    function openBadgeEditor(badge, trigger) {
        badgeEditor.id = badge ? badge.achievement_id : null;
        $('badgeModalTitle').textContent = badge ? 'Edit badge' : 'Add a badge';
        $('badgeTitle').value = badge ? badge.title : '';
        // A metric outside the list leaves the goal unchosen, and saving asks for one.
        metricSelect.value = badge ? badge.metric : 'games_played';
        $('badgeThreshold').value = badge ? String(Number(badge.threshold)) : '';
        const icon = badge ? badge.icon : 'medal';
        for (const radio of document.querySelectorAll('input[name="badgeIcon"]')) radio.checked = radio.value === icon;
        unitHint();
        clearFormErrors($('badgeForm'), $('badgeError'));
        openDialog('badgeModal', trigger, $('badgeTitle'), {
            returnTo: badge ? `#badgeRows tr[data-badge-id="${badge.achievement_id}"] [data-action="edit"]` : '#newBadgeBtn',
        });
    }
    $('newBadgeBtn').addEventListener('click', event => openBadgeEditor(null, event.currentTarget));
    $('badgeForm').addEventListener('submit', async event => {
        event.preventDefault();
        clearFormErrors($('badgeForm'), $('badgeError'));
        const title = $('badgeTitle').value.trim(), metric = metricSelect.value;
        const raw = $('badgeThreshold').value.trim(), threshold = Number(raw);
        if (!title) return badgeFormError('Give the badge a title.', $('badgeTitle'));
        if (length(title) > 100) return badgeFormError('Keep the title to 100 characters or fewer.', $('badgeTitle'));
        if (!metric) return badgeFormError('Choose a goal.', metricSelect);
        if (!raw || !Number.isFinite(threshold) || threshold <= 0) return badgeFormError('Enter a target above 0.', $('badgeThreshold'));
        if (threshold > 99999999) return badgeFormError('Enter a target of 99,999,999 or less.', $('badgeThreshold'));
        if (PERCENT.has(metric) && threshold > 100) return badgeFormError('A percentage target can be at most 100.', $('badgeThreshold'));
        const body = {title, metric, threshold};
        const icon = document.querySelector('input[name="badgeIcon"]:checked')?.value;
        if (icon) body.icon = icon;
        const save = $('badgeSave');
        save.disabled = true;
        try {
            const creating = badgeEditor.id == null;
            if (creating) await request('achievements.php', {method: 'POST', body});
            else await request(`achievements.php?id=${badgeEditor.id}`, {method: 'PUT', body});
            await loadBadges();
            closeDialog();
            showToast(creating ? `${title} was added.` : `${title} was saved.`, 'success');
        } catch (error) {
            badgeFormError(error.message, null);
        } finally {
            save.disabled = false;
        }
    });

    loadBadges();
    loadSections();
}

if (typeof document !== 'undefined') main();
