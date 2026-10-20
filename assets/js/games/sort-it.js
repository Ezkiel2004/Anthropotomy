// Sort It: put every term into the bin of its group. Tap a term, then tap a bin (or drag it there).
// The first placement decides the card; a wrong one shows the right bin, and the term moves into it.

import {countTerms, pickCards, shuffled} from './runner-core.js';
import {el, startRound} from './play-kit.js';

const REVEAL_MS = 1200;      // how long the right bin stays lit after a wrong placement
const FINISH_MS = 600;       // the last placement stays on screen this long

const groupOf = card => String(card.group ?? 'Other');

// The round's bins are its groups, so choose at most maxBins groups at random and draw the cards from them.
function choose(pool, level, stats, rng = Math.random) {
    const grouped = (pool || []).filter(card => card.group);
    const groups = shuffled([...new Set(grouped.map(card => card.group))], rng).slice(0, level.maxBins);
    return pickCards(grouped.filter(card => groups.includes(card.group)), level.roundSize, stats, rng);
}

function play(root, cards, level, report) {
    const round = startRound(root, cards, report);
    if (round.isOver()) return round.done;
    const stage = round.frame('sort-it');
    const termList = el('ul', 'game-terms');
    const binArea = el('div', 'game-bins');
    stage.append(termList, binArea);

    const bins = new Map();                  // group -> {box, button, list}
    for (const group of new Set(cards.map(groupOf))) {
        const box = el('div', 'game-bin');
        const button = el('button', 'game-bin-button', group, {type: 'button'});
        const list = el('ul', 'game-bin-items');
        box.append(button, list);
        binArea.append(box);
        bins.set(group, {box, button, list});
    }
    const binOf = new Map([...bins].map(([group, bin]) => [bin.box, group]));

    const terms = new Map();                 // card -> its <li><button> in the term list
    for (const card of shuffled(cards)) {
        const button = el('button', 'game-term', String(card.term ?? ''), {type: 'button', draggable: 'true', 'aria-pressed': 'false'});
        const item = el('li', 'game-term-item');
        item.append(button);
        termList.append(item);
        terms.set(card, button);
    }
    const cardOf = new Map([...terms].map(([card, button]) => [button, card]));

    let selected = null, dragged = null;

    function select(card) {
        if (selected) terms.get(selected).setAttribute('aria-pressed', 'false');
        selected = card;
        for (const button of terms.values()) button.classList.toggle('is-selected', cardOf.get(button) === card);
        if (card) {
            terms.get(card).setAttribute('aria-pressed', 'true');
            round.say(`Selected ${card.term}. Now choose its group.`);
        }
    }

    function place(card, group) {
        if (!round.isPending(card)) return;
        const right = groupOf(card) === group;
        const home = bins.get(groupOf(card));
        const hadFocus = root.contains(document.activeElement);
        terms.get(card).closest('li').remove();
        const placed = el('li', right ? 'game-placed' : 'game-placed is-missed', String(card.term ?? ''));
        home.list.append(placed);
        if (selected === card) select(null);
        if (right) {
            round.say(`Correct. ${card.term} belongs in ${group}.`);
        } else {
            round.say(`Not quite. ${card.term} belongs in ${groupOf(card)}.`);
            home.box.classList.add('is-reveal');
            round.later(() => home.box.classList.remove('is-reveal'), REVEAL_MS);
        }
        const next = termList.querySelector('.game-term');
        if (hadFocus && next) next.focus({preventScroll: true});
        round.report(card, right, right ? FINISH_MS : REVEAL_MS);
    }

    round.listen(termList, 'click', event => {
        const card = cardOf.get(event.target.closest('.game-term'));
        if (!card || !round.isPending(card)) return;
        select(selected === card ? null : card);
        // A keyboard click has detail 0: send the focus on to the bins so Enter can place the term.
        if (selected && event.detail === 0) bins.values().next().value.button.focus({preventScroll: true});
    });
    round.listen(binArea, 'click', event => {
        const box = event.target.closest('.game-bin');
        if (!box) return;
        if (selected) place(selected, binOf.get(box));
        else round.say('Pick a term first.');
    });

    round.listen(termList, 'dragstart', event => {
        const card = cardOf.get(event.target.closest('.game-term'));
        if (!card) return;
        dragged = card;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(card.term ?? ''));
    });
    round.listen(termList, 'dragend', () => { dragged = null; });
    round.listen(binArea, 'dragover', event => {
        const box = event.target.closest('.game-bin');
        if (!box || !dragged) return;
        event.preventDefault();
        box.classList.add('is-over');
    });
    round.listen(binArea, 'dragleave', event => {
        const box = event.target.closest('.game-bin');
        if (box && !box.contains(event.relatedTarget)) box.classList.remove('is-over');
    });
    round.listen(binArea, 'drop', event => {
        const box = event.target.closest('.game-bin');
        if (!box || !dragged) return;
        event.preventDefault();
        box.classList.remove('is-over');
        place(dragged, binOf.get(box));
        dragged = null;
    });

    if (level.limitSec) round.countdown(level.limitSec, () => round.end());
    return round.done;
}

export default {
    key: 'sort-it',
    name: 'Sort It',
    icon: 'hand-grabbing',
    levels: {
        easy: {roundSize: 6, maxBins: 2},
        medium: {roundSize: 10, maxBins: 3},
        hard: {roundSize: 14, maxBins: 5, limitSec: 60},
    },
    available: (cards, level) => {
        const grouped = (cards || []).filter(card => card.group);
        return new Set(grouped.map(card => card.group)).size >= 2 && countTerms(grouped) >= level.roundSize;
    },
    choose,
    play,
};
