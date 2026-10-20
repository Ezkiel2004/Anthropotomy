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

// Number of different terms (case and surrounding space ignored) among the cards that pass `keep`.
export const countTerms = (cards, keep = () => true) =>
    new Set((cards || []).filter(keep).map(termOf).filter(Boolean)).size;

// Fisher-Yates on a copy.
export function shuffled(items, rng = Math.random) {
    const out = Array.from(items);
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(rng() * (i + 1)));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Typed answers match ignoring case, surrounding space and repeated spaces.
export const normalizeAnswer = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Shuffles the letters inside each word. Spaces, hyphens and other non-letters keep their positions,
// and the result is never the term itself unless every word is made of one repeated letter.
export function scrambleWords(term, rng = Math.random) {
    const text = String(term ?? '');
    const LETTER = /\p{L}\p{M}*/gu;
    const lettersOf = word => word.match(LETTER) || [];
    const refill = (word, letters) => { let i = 0; return word.replace(LETTER, () => letters[i++]); };
    const parts = text.split(/([\s-]+)/);                       // separators sit at the odd indexes
    const out = parts.map((part, i) => i % 2 ? part : refill(part, shuffled(lettersOf(part), rng)));
    if (out.join('').toLowerCase() !== text.toLowerCase()) return out.join('');
    // The shuffle landed on the term: rotate the letters of the first word that has two different ones.
    const at = parts.findIndex((part, i) => i % 2 === 0 && new Set(lettersOf(part).map(l => l.toLowerCase())).size > 1);
    if (at < 0) return text;
    const letters = lettersOf(parts[at]);
    out[at] = refill(parts[at], [...letters.slice(1), letters[0]]);
    return out.join('');
}
