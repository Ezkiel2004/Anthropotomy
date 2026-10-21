// Wiring for teacher/games.html: game sets (with paste-to-add), the most-missed terms and this week's
// leaderboard for one section, and the badge rules. Set titles, terms, clues, student names and badge
// titles are user-supplied, so they only ever reach the page through textContent, input values and
// attribute setters, never parsed as HTML.
// Importing this module touches no DOM (the unit tests import parsePastedCards); main() runs only in a page.

import {el} from './play-kit.js';
import {iconNode} from './runner.js';

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
    {key: 'perfect_rounds', label: 'Perfect rounds', group: 'Games', unit: 'rounds'},
    {key: 'best_game_streak', label: 'Best streak in one round', group: 'Games', unit: 'correct in a row'},
    {key: 'game_systems_played', label: 'Body systems played in games', group: 'Games', unit: 'systems'},
    {key: 'total_points', label: 'Total game points', group: 'Games', unit: 'points'},
];

// One card per line. Two fields give term and clue; three or more give the term, then the clue
// (everything between the first and the last comma), then the group (after the last comma). Blank lines
// are skipped, every field is trimmed, and an empty group is left out. A line without a comma becomes a
// term with an empty clue, so the editor can show it to be finished rather than drop it.
export function parsePastedCards(text) {
    const cards = [];
    for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
        if (!line.trim()) continue;
        const first = line.indexOf(','), last = line.lastIndexOf(',');
        if (first === -1) {
            cards.push({term: line.trim(), clue: ''});
        } else if (first === last) {
            cards.push({term: line.slice(0, first).trim(), clue: line.slice(first + 1).trim()});
        } else {
            const card = {term: line.slice(0, first).trim(), clue: line.slice(first + 1, last).trim()};
            const group = line.slice(last + 1).trim();
            if (group) card.group = group;
            cards.push(card);
        }
    }
    return cards;
}

const PERCENT = new Set(METRICS.filter(m => m.unit === '%').map(m => m.key));
const metricOf = key => METRICS.find(m => m.key === key);
const length = text => [...text].length;             // the server counts characters, not UTF-16 units
const number = value => Number(value).toLocaleString('en-PH', {maximumFractionDigits: 2});
const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many}`;
const $ = id => document.getElementById(id);

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
    const state = {sets: [], systems: [], badges: [], sections: [], section: ''};
    const tokens = {missed: 0, board: 0};

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
    function openDialog(id, trigger, first, {returnTo = null, canClose = () => true} = {}) {
        dialog = {id, trigger, returnTo, canClose};
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
    const requestClose = () => { if (dialog && dialog.canClose()) closeDialog(); };
    for (const id of ['setModal', 'badgeModal']) {
        const overlay = $(id);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-close]')) requestClose();
        });
    }
    document.addEventListener('keydown', event => {
        if (!dialog) return;
        if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
        if (event.key !== 'Tab') return;
        const items = focusables($(dialog.id).querySelector('.modal-box'));
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    // ── Game sets ──
    function setRow(set) {
        const row = el('tr', set.is_active ? '' : 'is-off', null, {'data-set-id': String(set.set_id)});
        const head = el('th', 'tg-name-cell', null, {scope: 'row'});
        head.append(el('span', 'tg-set-title', set.title), el('span', 'tg-sub', set.system_name || 'No body system'));
        const actions = el('td', 'tg-actions-cell');
        const group = el('div', 'tg-actions');
        group.append(
            button('', 'Edit', 'pencil-simple', {'data-action': 'edit', 'aria-label': `Edit ${set.title}`}),
            button('', set.is_active ? 'Turn off' : 'Turn on', set.is_active ? 'eye-slash' : 'eye', {'data-action': 'toggle', 'aria-label': `${set.is_active ? 'Turn off' : 'Turn on'} ${set.title}`}),
            button('tg-danger', 'Delete', 'trash', {'data-action': 'delete', 'aria-label': `Delete ${set.title}`}),
        );
        actions.append(group);
        row.append(head, el('td', 'tg-count-cell', plural(set.cards.length, 'card', 'cards')), statusCell(set.is_active), actions);
        return row;
    }
    function renderSets() {
        $('setRows').replaceChildren(...state.sets.map(setRow));
        const on = state.sets.filter(set => set.is_active).length;
        $('setCount').textContent = state.sets.length ? `${plural(state.sets.length, 'set', 'sets')}, ${number(on)} on.` : '';
        if (state.sets.length) showList('sets', 'table');
        else emptyText('sets', 'No game sets yet', 'Choose New set to make one. Paste a list of terms and clues to fill it quickly.');
    }
    async function loadSets() {
        try {
            state.sets = await request('games/sets.php');
            renderSets();
        } catch (error) {
            $('setCount').textContent = '';
            emptyText('sets', 'Game sets couldn’t load', `${error.message} Refresh the page to try again.`);
        }
    }
    const setById = id => state.sets.find(set => set.set_id === Number(id));
    $('setRows').addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        const set = control && setById(control.closest('tr').dataset.setId);
        if (!set) return;
        if (control.dataset.action === 'edit') openSetEditor(set, control);
        else if (control.dataset.action === 'toggle') toggleSet(set, control);
        else if (control.dataset.action === 'delete') deleteSet(set);
    });
    async function toggleSet(set, control) {
        control.disabled = true;
        try {
            await request(`games/sets.php?id=${set.set_id}`, {method: 'PUT', body: {is_active: !set.is_active}});
            set.is_active = !set.is_active;
            renderSets();
            $('setRows').querySelector(`tr[data-set-id="${set.set_id}"] [data-action="toggle"]`)?.focus();
            showToast(set.is_active ? `${set.title} is on. Students can play it.` : `${set.title} is off. Students no longer see it.`, 'success');
        } catch (error) {
            control.disabled = false;
            showToast(error.message, 'error');
        }
    }
    async function deleteSet(set) {
        if (!confirm(`Delete the set “${set.title}”? Students can no longer play it. Points already earned are kept.`)) return;
        try {
            await request(`games/sets.php?id=${set.set_id}`, {method: 'DELETE'});
            state.sets = state.sets.filter(other => other !== set);
            renderSets();
            $('newSetBtn').focus();
            showToast(`${set.title} was deleted.`, 'success');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    // ── Set editor: title, optional system and a card table, filled by hand or by pasting lines ──
    const editor = {setId: null, dirty: false};
    const cardRows = $('cardRows');
    const valueOf = (row, field) => row.querySelector(`.tg-${field}`).value.trim();
    const isBlank = row => ['term', 'clue', 'group'].every(field => !valueOf(row, field));

    function fillSystems(set) {
        const options = [new Option('None', '')];
        for (const system of state.systems) {
            options.push(new Option(system.is_active ? system.system_name : `${system.system_name} (hidden from students)`, String(system.system_id)));
        }
        if (set?.system_id != null && !state.systems.some(system => system.system_id === set.system_id)) {
            options.push(new Option(set.system_name || 'The set’s current system', String(set.system_id)));
        }
        $('setSystem').replaceChildren(...options);
        $('setSystem').value = set?.system_id == null ? '' : String(set.system_id);
    }

    function addCardRow(card = {}) {
        const row = el('tr', 'tg-card');
        if (card.mesh) row.dataset.mesh = card.mesh;    // not edited here, but kept for 3D Hunt
        const field = (name, value, max, hint) => {
            const cell = el('td', `tg-cell-${name}`);
            const input = el('input', `tg-${name}`, null, {type: 'text', maxlength: String(max), autocomplete: 'off', spellcheck: 'false', placeholder: hint});
            input.value = value ?? '';
            cell.append(input);
            return cell;
        };
        const remove = el('td', 'tg-cell-remove');
        const removeButton = el('button', 'tg-remove', null, {type: 'button'});
        removeButton.append(iconNode('trash'));
        remove.append(removeButton);
        row.append(el('td', 'tg-card-num'), field('term', card.term, 100, 'Term'), field('clue', card.clue, 300, 'Clue'), field('group', card.group, 60, 'Group (optional)'), remove);
        cardRows.append(row);
        return row;
    }

    function renumberCards() {
        const rows = [...cardRows.rows];
        rows.forEach((row, index) => {
            const n = index + 1;
            row.querySelector('.tg-card-num').textContent = String(n);
            row.querySelector('.tg-term').setAttribute('aria-label', `Card ${n} term`);
            row.querySelector('.tg-clue').setAttribute('aria-label', `Card ${n} clue`);
            row.querySelector('.tg-group').setAttribute('aria-label', `Card ${n} group (optional)`);
            row.querySelector('.tg-remove').setAttribute('aria-label', `Remove card ${n}`);
        });
        $('cardCount').textContent = plural(rows.length, 'card', 'cards');
        $('cardsEmpty').hidden = rows.length > 0;
    }

    function setFormError(message, field) {
        const box = $('setError');
        box.textContent = message;
        box.hidden = false;
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        } else {
            box.scrollIntoView({block: 'nearest'});
        }
    }
    function clearFormErrors(form, box) {
        box.hidden = true;
        box.textContent = '';
        form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    }

    function openSetEditor(set, trigger) {
        editor.setId = set ? set.set_id : null;
        editor.dirty = false;
        $('setModalTitle').textContent = set ? 'Edit game set' : 'New game set';
        $('setTitle').value = set ? set.title : '';
        fillSystems(set);
        cardRows.replaceChildren();
        // A new set starts with the 4 rows it needs; pasted cards take the place of rows left empty.
        for (const card of set ? set.cards : [{}, {}, {}, {}]) addCardRow(card);
        renumberCards();
        $('pasteText').value = '';
        $('pasteNote').textContent = '';
        $('pasteBox').open = !set;
        clearFormErrors($('setForm'), $('setError'));
        openDialog('setModal', trigger, $('setTitle'), {
            returnTo: set ? `#setRows tr[data-set-id="${set.set_id}"] [data-action="edit"]` : '#newSetBtn',
            canClose: () => !editor.dirty || confirm('Close without saving? Your changes to this set will be lost.'),
        });
    }

    $('newSetBtn').addEventListener('click', event => openSetEditor(null, event.currentTarget));
    $('setForm').addEventListener('input', () => { editor.dirty = true; });
    $('addCardBtn').addEventListener('click', () => {
        const row = addCardRow();
        renumberCards();
        editor.dirty = true;
        row.querySelector('.tg-term').focus();
    });
    cardRows.addEventListener('click', event => {
        const remove = event.target.closest('.tg-remove');
        if (!remove) return;
        const row = remove.closest('tr');
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        renumberCards();
        editor.dirty = true;
        (next?.querySelector('.tg-term') || $('addCardBtn')).focus();
    });
    $('pasteAdd').addEventListener('click', () => {
        const cards = parsePastedCards($('pasteText').value);
        if (!cards.length) {
            $('pasteNote').textContent = 'Paste at least one line: a term, a comma, then its clue.';
            $('pasteText').focus();
            return;
        }
        for (const row of [...cardRows.rows]) if (isBlank(row)) row.remove();
        for (const card of cards) addCardRow(card);
        renumberCards();
        editor.dirty = true;
        $('pasteText').value = '';
        const unfinished = cards.filter(card => !card.clue).length;
        $('pasteNote').textContent = `Added ${plural(cards.length, 'card', 'cards')}.` + (unfinished ? ` ${plural(unfinished, 'card needs', 'cards need')} a clue.` : '');
    });

    $('setForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = $('setForm');
        clearFormErrors(form, $('setError'));
        const title = $('setTitle').value.trim();
        if (!title) return setFormError('Give the set a title.', $('setTitle'));
        if (length(title) > 100) return setFormError('Keep the title to 100 characters or fewer.', $('setTitle'));
        for (const row of [...cardRows.rows]) if (isBlank(row)) row.remove();
        renumberCards();
        const rows = [...cardRows.rows];
        if (rows.length < 4) {
            return setFormError(`A set needs at least 4 cards. This one has ${number(rows.length)}.`, null);
        }
        if (rows.length > 200) return setFormError(`A set can hold up to 200 cards. This one has ${number(rows.length)}.`, rows[200].querySelector('.tg-term'));
        const cards = [], terms = new Map();
        for (const [index, row] of rows.entries()) {
            const n = index + 1, input = name => row.querySelector(`.tg-${name}`);
            const term = valueOf(row, 'term'), clue = valueOf(row, 'clue'), group = valueOf(row, 'group');
            if (!term) return setFormError(`Card ${n} needs a term.`, input('term'));
            if (length(term) > 100) return setFormError(`Card ${n}: keep the term to 100 characters or fewer.`, input('term'));
            if (!clue) return setFormError(`Card ${n} needs a clue.`, input('clue'));
            if (length(clue) > 300) return setFormError(`Card ${n}: keep the clue to 300 characters or fewer.`, input('clue'));
            if (length(group) > 60) return setFormError(`Card ${n}: keep the group to 60 characters or fewer.`, input('group'));
            const key = term.toLowerCase();
            if (terms.has(key)) return setFormError(`Card ${n} repeats card ${terms.get(key)}, “${term}”. Each term can appear once, whatever its capitals.`, input('term'));
            terms.set(key, n);
            const card = {term, clue};
            if (group) card.group = group;
            if (row.dataset.mesh) card.mesh = row.dataset.mesh;
            cards.push(card);
        }
        const system = $('setSystem').value;
        const body = {title, system_id: system === '' ? null : Number(system), cards};
        const save = $('setSave');
        save.disabled = true;
        try {
            const creating = editor.setId == null;
            if (creating) await request('games/sets.php', {method: 'POST', body});
            else await request(`games/sets.php?id=${editor.setId}`, {method: 'PUT', body});
            editor.dirty = false;
            await loadSets();
            closeDialog();
            showToast(creating ? `${title} was created. Students can play it now.` : `${title} was saved.`, 'success');
        } catch (error) {
            setFormError(error.message, null);
        } finally {
            save.disabled = false;
        }
    });

    async function loadSystems() {
        try { state.systems = await request('anatomy-content.php'); } catch { state.systems = []; }
    }

    // ── Most-missed terms and the leaderboard: one section at a time, the same section in both ──
    function missedRow(row, index) {
        const share = Math.round(Math.min(1, Math.max(0, Number(row.miss_rate) || 0)) * 100);
        const missed = el('td', 'tg-missed-cell');
        const meter = el('span', 'sd-meter tg-meter', null, {'aria-hidden': 'true'});
        const fill = el('i');
        fill.style.width = `${share}%`;
        meter.append(fill);
        missed.append(el('span', 'tg-pct', `${share}%`), meter);
        const item = el('tr');
        item.append(el('td', 'tg-rank', String(index + 1)), el('th', 'tg-term-name', row.term, {scope: 'row'}), missed,
            el('td', 'tg-muted', `${number(row.correct)} of ${number(row.seen)}`));
        return item;
    }
    async function loadMissed() {
        const section = state.section, token = ++tokens.missed;
        showList('missed', 'loading');
        try {
            const list = await request(`games/mastery.php?section=${encodeURIComponent(section)}`);
            if (token !== tokens.missed) return;
            $('missedRows').replaceChildren(...list.map(missedRow));
            if (list.length) showList('missed', 'table');
            else emptyText('missed', 'No missed terms yet', `Nothing to show for ${section}. A term is listed here once students in this section have answered it at least 3 times in the games.`);
        } catch (error) {
            if (token !== tokens.missed) return;
            $('missedRows').replaceChildren();
            emptyText('missed', 'Most-missed terms couldn’t load', `${error.message} Choose the section again to retry.`);
        }
    }

    function boardRow(row) {
        const item = el('tr');
        item.append(el('td', 'tg-rank', `#${row.rank}`), el('th', 'tg-board-name', row.full_name, {scope: 'row'}), el('td', 'tg-points', `${number(row.points)} pts`));
        return item;
    }
    async function loadBoard() {
        const section = state.section, token = ++tokens.board;
        showList('board', 'loading');
        try {
            const board = await request(`games/leaderboard.php?section=${encodeURIComponent(section)}`);
            if (token !== tokens.board) return;
            const since = new Date(String(board.week_start).replace(' ', 'T'));
            $('boardWeek').textContent = Number.isNaN(since.getTime()) ? '' : `The week began ${since.toLocaleDateString('en-PH', {weekday: 'long', month: 'short', day: 'numeric'})}.`;
            $('boardRows').replaceChildren(...board.top.map(boardRow));
            if (board.top.length) showList('board', 'table');
            else emptyText('board', 'No points yet this week', `No one in ${section} has scored points in the games since the week began.`);
        } catch (error) {
            if (token !== tokens.board) return;
            $('boardRows').replaceChildren();
            emptyText('board', 'The leaderboard couldn’t load', `${error.message} Choose the section again to retry.`);
        }
    }

    const sectionPickers = [$('missedSection'), $('boardSection')];
    for (const picker of sectionPickers) {
        picker.addEventListener('change', () => {
            state.section = picker.value;
            for (const other of sectionPickers) other.value = state.section;
            loadMissed();
            loadBoard();
        });
    }
    async function loadSections() {
        const config = typeof SiteConfig === 'undefined' ? {} : await SiteConfig.ready;
        state.sections = Array.isArray(config?.sections) ? config.sections.map(String) : [];
        state.section = state.sections[0] || '';
        for (const picker of sectionPickers) {
            picker.replaceChildren(...state.sections.map(section => new Option(section, section)));
            picker.disabled = !state.sections.length;
        }
        if (!state.section) {
            emptyText('missed', 'Sections couldn’t load', 'Refresh the page to try again.');
            emptyText('board', 'Sections couldn’t load', 'Refresh the page to try again.');
            return;
        }
        loadMissed();
        loadBoard();
    }

    // ── Badges: built-in ones can be edited or turned off, never deleted (the migration would bring them
    // back); badges the teacher adds can also be deleted ──
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
        $('badgeRows').replaceChildren(...state.badges.map(badgeRow));
        const on = state.badges.filter(isOn).length;
        $('badgeCount').textContent = state.badges.length ? `${plural(state.badges.length, 'badge', 'badges')}, ${number(on)} on.` : '';
        if (state.badges.length) showList('badges', 'table');
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

    loadSets();
    loadSystems();
    loadBadges();
    loadSections();
}

if (typeof document !== 'undefined') main();
