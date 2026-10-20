// Match Pairs: a memory game. Every card is two face-down tiles, its term and its clue. Flip two; a term
// with its own clue stays up. A card scores when it is matched with no earlier mismatch involving it.

import {countTerms, shuffled} from './runner-core.js';
import {el, startRound} from './play-kit.js';

const MISMATCH_MS = 900;     // how long a wrong pair stays visible
const FINISH_MS = 600;       // the last match stays on screen this long

function play(root, cards, level, report) {
    const round = startRound(root, cards, report);
    if (round.isOver()) return round.done;
    const stage = round.frame('match-pairs');
    const board = el('div', 'game-tiles');
    stage.append(board);

    const missed = new Set();               // cards that took part in a mismatch
    const info = new Map();                 // tile -> {card, kind, text, number}
    const matched = new Set();
    let faceUp = [], locked = true;         // locked while previewing or showing a mismatch

    const tiles = shuffled(cards.flatMap(card => [
        {card, kind: 'term', text: String(card.term ?? '')},
        {card, kind: 'clue', text: String(card.clue ?? '')},
    ])).map((detail, i) => {
        const tile = el('button', 'game-tile', null, {type: 'button'});
        info.set(tile, {...detail, number: i + 1});
        return tile;
    });
    board.append(...tiles);

    function show(tile, up) {
        const {kind, text, number} = info.get(tile);
        tile.textContent = up ? text : '';
        tile.classList.toggle('is-up', up);
        if (up) tile.dataset.kind = kind; else delete tile.dataset.kind;
        tile.setAttribute('aria-label', up ? `${kind === 'term' ? 'Term' : 'Clue'}: ${text}` : `Face-down tile ${number} of ${tiles.length}`);
    }
    tiles.forEach(tile => show(tile, false));

    round.listen(board, 'click', event => {
        const tile = event.target.closest('.game-tile');
        if (!tile || locked || faceUp.includes(tile) || matched.has(tile)) return;
        show(tile, true);
        faceUp.push(tile);
        if (faceUp.length < 2) return;
        const [first, second] = faceUp.map(t => info.get(t));
        if (first.card === second.card) {
            for (const t of faceUp) {
                matched.add(t);
                t.classList.add('is-matched');
                t.setAttribute('aria-label', t.getAttribute('aria-label') + ', matched');
            }
            faceUp = [];
            round.say(`Matched: ${first.card.term}.`);
            round.report(first.card, !missed.has(first.card), FINISH_MS);
            return;
        }
        missed.add(first.card);
        missed.add(second.card);
        locked = true;
        round.say('Not a match.');
        round.later(() => {
            faceUp.forEach(t => show(t, false));
            faceUp = [];
            locked = false;
        }, MISMATCH_MS);
    });

    const startClock = () => {
        locked = false;
        if (level.limitSec) round.countdown(level.limitSec, () => round.end());
    };
    if (level.previewSec) {
        tiles.forEach(tile => show(tile, true));
        round.say('Memorise the tiles.');
        round.countdown(level.previewSec, () => {
            tiles.forEach(tile => show(tile, false));
            round.say('Find the pairs.');
            startClock();
        });
    } else {
        startClock();
    }
    return round.done;
}

export default {
    key: 'match-pairs',
    name: 'Match Pairs',
    icon: 'stack',
    levels: {
        easy: {roundSize: 4, previewSec: 3},
        medium: {roundSize: 6},
        hard: {roundSize: 8, limitSec: 90},
    },
    available: (cards, level) => countTerms(cards) >= level.roundSize,
    play,
};
