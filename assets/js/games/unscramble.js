// Unscramble: type the term from its shuffled letters, with the clue as the hint. A word scores when the
// answer matches within two tries (and, on Hard, within the time). A second wrong try, Skip or a time-out
// is a miss and the term is shown.

import {countTerms, normalizeAnswer, scrambleWords} from './runner-core.js';
import {el, startRound} from './play-kit.js';

const MAX_TRIES = 2;
const HIT_MS = 700;
const MISS_MS = 1800;

const letterCount = term => (String(term ?? '').match(/\p{L}/gu) || []).length;
const playable = card => { const n = letterCount(card.term); return n >= 4 && n <= 20; };

function play(root, cards, level, report) {
    const round = startRound(root, cards, report);
    if (round.isOver()) return round.done;
    const stage = round.frame('unscramble');

    const word = el('p', 'game-word', '');
    const clue = el('p', 'game-clue', '');
    const hint = el('p', 'game-hint', '');
    const scramble = el('p', 'game-scramble', '', {role: 'img'});
    const reveal = el('p', 'game-reveal', '');
    const form = el('form', 'game-answer-form', null, {novalidate: ''});
    const label = el('label', 'game-answer-label');
    const input = el('input', 'game-answer', null, {type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false'});
    const check = el('button', 'game-check', 'Check', {type: 'submit'});
    const skip = el('button', 'game-skip', 'Skip', {type: 'button'});
    label.append(el('span', 'game-answer-text', 'Your answer'), input);
    form.append(label, check, skip);
    stage.append(word, clue, hint, scramble, form, reveal);

    let index = 0, tries = 0, locked = true;

    function ask() {
        const card = cards[index], term = String(card.term ?? '');
        const letters = scrambleWords(term).toLowerCase();
        tries = 0;
        locked = false;
        word.textContent = `Word ${index + 1} of ${cards.length}`;
        clue.textContent = String(card.clue ?? '');
        hint.textContent = level.firstLetter ? `Starts with ${[...term.trim()][0] ?? ''}` : '';
        scramble.textContent = letters;
        scramble.setAttribute('aria-label', `Scrambled letters: ${[...letters].join(' ')}`);
        reveal.textContent = '';
        reveal.className = 'game-reveal';
        input.value = '';
        input.readOnly = false;
        check.disabled = skip.disabled = false;
        input.focus({preventScroll: true});
        if (level.perCardSec) round.countdown(level.perCardSec, () => settle(false));
    }

    function settle(right) {
        if (locked || round.isOver()) return;
        const card = cards[index];
        locked = true;
        round.stopCountdown();
        input.readOnly = true;
        check.disabled = skip.disabled = true;
        reveal.textContent = String(card.term ?? '');
        reveal.className = right ? 'game-reveal is-correct' : 'game-reveal is-missed';
        round.say(right ? `Correct: ${card.term}.` : `The answer was ${card.term}.`);
        const pause = right ? HIT_MS : MISS_MS;
        round.report(card, right, pause);
        if (++index < cards.length) round.later(ask, pause);
    }

    round.listen(form, 'submit', event => {
        event.preventDefault();
        if (locked) return;
        const answer = normalizeAnswer(input.value);
        if (!answer) { round.say('Type an answer first.'); return; }
        tries += 1;
        if (answer === normalizeAnswer(cards[index].term)) settle(true);
        else if (tries >= MAX_TRIES) settle(false);
        else { round.say('Not quite. One more try.'); input.select(); }
    });
    round.listen(skip, 'click', () => settle(false));

    ask();
    return round.done;
}

export default {
    key: 'unscramble',
    name: 'Unscramble',
    icon: 'textbox',
    levels: {
        easy: {roundSize: 6, firstLetter: true},
        medium: {roundSize: 8},
        hard: {roundSize: 10, perCardSec: 20},
    },
    available: (cards, level) => countTerms(cards, playable) >= level.roundSize,
    play,
};
