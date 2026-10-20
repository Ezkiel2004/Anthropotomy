// Beat the Clock: read the clue, pick the term before the time runs out. The first choice decides the card;
// a time-out counts as a miss. The wrong choices are other terms from the same round.

import {countTerms, normalizeAnswer, shuffled} from './runner-core.js';
import {el, startRound} from './play-kit.js';

const HIT_MS = 700;          // feedback after a right answer
const MISS_MS = 1500;        // longer after a miss, to read the right term

function play(root, cards, level, report) {
    const round = startRound(root, cards, report);
    if (round.isOver()) return round.done;
    const stage = round.frame('beat-the-clock');
    let index = 0, current = null;                       // current: {buttons, answer} of the open question

    // The right term plus up to choices - 1 other terms of this round, shuffled.
    function optionsFor(card) {
        const seen = new Set([normalizeAnswer(card.term)]), others = [];
        for (const other of shuffled(cards)) {
            const term = normalizeAnswer(other.term);
            if (seen.has(term) || others.length >= level.choices - 1) continue;
            seen.add(term);
            others.push(other);
        }
        return shuffled([card, ...others]);
    }

    function ask() {
        const card = cards[index];
        const hadFocus = root.contains(document.activeElement);
        const buttons = new Map();                       // button -> card it stands for
        const group = el('div', 'game-choices', null, {role: 'group', 'aria-label': 'Choose the term'});
        for (const option of optionsFor(card)) {
            const button = el('button', 'game-choice', String(option.term ?? ''), {type: 'button'});
            buttons.set(button, option);
            group.append(button);
        }
        stage.textContent = '';
        stage.append(
            el('p', 'game-question', `Question ${index + 1} of ${cards.length}`),
            el('p', 'game-clue', String(card.clue ?? '')),
            group,
        );
        if (hadFocus) group.firstChild.focus({preventScroll: true});

        let answered = false;
        function answer(choice) {
            if (answered || round.isOver()) return;
            answered = true;
            round.stopCountdown();
            const right = choice === card;
            for (const [button, option] of buttons) {
                button.setAttribute('aria-disabled', 'true');
                if (option === card) button.classList.add('is-correct');
                else if (option === choice) button.classList.add('is-wrong');
            }
            round.say(right ? `Correct: ${card.term}.`
                : choice ? `Not quite. The answer was ${card.term}.`
                : `Time's up. The answer was ${card.term}.`);
            const pause = right ? HIT_MS : MISS_MS;
            round.report(card, right, pause);
            if (++index < cards.length) round.later(ask, pause);
        }
        current = {buttons, answer};
        round.countdown(level.perCardSec, () => answer(null));
    }

    round.listen(stage, 'click', event => {
        const button = event.target.closest('.game-choice');
        if (button && current?.buttons.has(button)) current.answer(current.buttons.get(button));
    });
    ask();
    return round.done;
}

export default {
    key: 'beat-the-clock',
    name: 'Beat the Clock',
    icon: 'clock',
    levels: {
        easy: {roundSize: 6, choices: 3, perCardSec: 12},
        medium: {roundSize: 10, choices: 4, perCardSec: 8},
        hard: {roundSize: 12, choices: 5, perCardSec: 5},
    },
    available: (cards, level) => countTerms(cards) >= level.choices,
    play,
};
