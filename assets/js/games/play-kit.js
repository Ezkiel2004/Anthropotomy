// Plumbing shared by the DOM games. Terms and clues are teacher-supplied text, so everything is built
// with createElement + textContent and nothing is ever parsed as HTML.
// Importing this file touches no DOM; only el() and a round's frame() need a document.

export function el(tag, className = '', text = null, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
}

// One round of one game. It owns every timer and listener the game adds, reports each card exactly once,
// and resolves `done` when every card is reported or the game calls end(). Cards still unreported at the
// end are reported as missed. The root is emptied on the way out.
//
// Markup from frame(): div.game-board.game-<key> > [ div.game-hud > span.game-progress + span.game-timer ,
// div.game-stage , p.game-feedback[aria-live=polite] ]. The games render into the stage.
export function startRound(root, cards, report) {
    const pending = new Set(cards), total = pending.size;
    const timers = new Set(), listeners = [];
    let over = false, resolve, clock = null, progressEl = null, timerEl = null, feedbackEl = null;
    const done = new Promise(r => { resolve = r; });

    // setTimeout and setInterval ids share one pool; clearTimeout clears either.
    const later = (fn, ms) => {
        const id = setTimeout(() => { timers.delete(id); if (!over) fn(); }, ms);
        timers.add(id);
        return id;
    };
    const stopTimer = id => { clearTimeout(id); timers.delete(id); };

    const say = text => { if (feedbackEl) feedbackEl.textContent = text; };

    function stopCountdown() {
        if (!clock) return;
        stopTimer(clock.tick);
        stopTimer(clock.expire);
        clock = null;
        if (timerEl) { timerEl.textContent = ''; timerEl.hidden = true; }
    }

    // Counts down on screen and calls onExpire at zero. A new countdown replaces the old one. The visible
    // timer is not a live region (it would be read every second); long countdowns announce 30 and 10 s left.
    function countdown(seconds, onExpire) {
        stopCountdown();
        const deadline = Date.now() + seconds * 1000;
        let shown = -1;
        const paint = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (left === shown) return;
            shown = left;
            if (timerEl) { timerEl.hidden = false; timerEl.textContent = left + 's'; }
            if (seconds > 30 && (left === 30 || left === 10)) say(left + ' seconds left');
        };
        paint();
        const tick = setInterval(paint, 250);
        timers.add(tick);
        clock = {tick, expire: later(() => { stopCountdown(); onExpire(); }, seconds * 1000)};
    }

    function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listeners.push([target, type, handler, options]);
    }

    // Reports a card once. When it is the last one, the round ends after lingerMs so feedback can be seen.
    function reportCard(card, correct, lingerMs = 0) {
        if (over || !pending.delete(card)) return false;
        report(card, Boolean(correct));
        if (progressEl) progressEl.textContent = `${total - pending.size} of ${total} done`;
        if (!pending.size) {
            stopCountdown();
            if (lingerMs > 0) later(end, lingerMs); else end();
        }
        return true;
    }

    function end() {
        if (over) return;
        over = true;
        for (const id of timers) clearTimeout(id);
        timers.clear();
        for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
        listeners.length = 0;
        try {
            for (const card of cards) if (pending.delete(card)) report(card, false);
        } finally {
            root.textContent = '';
            resolve();
        }
    }

    function frame(key) {
        const stage = el('div', 'game-stage');
        progressEl = el('span', 'game-progress', `0 of ${total} done`);
        timerEl = el('span', 'game-timer', '', {role: 'timer'});
        timerEl.hidden = true;
        feedbackEl = el('p', 'game-feedback', '', {'aria-live': 'polite'});
        const hud = el('div', 'game-hud'), board = el('div', `game-board game-${key}`);
        hud.append(progressEl, timerEl);
        board.append(hud, stage, feedbackEl);
        root.append(board);
        return stage;
    }

    const round = {done, frame, say, later, listen, countdown, stopCountdown, end, report: reportCard,
        isOver: () => over, isPending: card => pending.has(card)};
    root.textContent = '';
    if (!total) end();
    return round;
}
