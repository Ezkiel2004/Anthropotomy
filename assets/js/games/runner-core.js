// Pure helpers shared by the game runner and the five games (no DOM, no fetch).
// Points are scored on the server; MULTIPLIER is only shown on the difficulty picker.

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const MULTIPLIER = {easy: 1, medium: 1.5, hard: 2};

// stats is {[card_key]: [seen, correct]}: missed cards weigh 3, never-seen 2, known 1.
export function cardWeight(card, stats) {
    const [seen = 0, correct = 0] = (stats || {})[card.key] || [];
    return seen > correct ? 3 : seen === 0 ? 2 : 1;
}

const termOf = card => String(card.term ?? '').trim().toLowerCase();

// Weighted draw without repeats (Efraimidis-Spirakis keys). Skips repeated terms, so a short pool yields fewer than n.
export function pickCards(pool, n, stats = {}, rng = Math.random) {
    const ranked = (pool || [])
        .map(card => ({card, key: rng() ** (1 / cardWeight(card, stats))}))
        .sort((a, b) => b.key - a.key);
    const taken = new Set(), picked = [];
    for (const {card} of ranked) {
        if (picked.length >= n) break;
        const term = termOf(card);
        if (taken.has(term)) continue;
        taken.add(term);
        picked.push(card);
    }
    return picked;
}

export function streaks(results) {
    let best = 0, run = 0;
    for (const ok of results) best = Math.max(best, run = ok ? run + 1 : 0);
    return best;
}
