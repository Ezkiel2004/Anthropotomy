// Card pools for the practice games. Every game plays from {key, term, clue, group, mesh}.
// Pure (no DOM, no fetch) so browser pages and Node unit tests can both import it.

import {firstSentence} from '../explorer/format.js';

const SIDE_SUFFIX = /\s*\((?:left|right)\)\s*$/i;
const MIN_CURATED = 4;

export const cardKey = (source, term) => `${source}:${String(term).trim()}`.toLowerCase().slice(0, 200);

export const baseTerm = name => String(name || '').replace(SIDE_SUFFIX, '').trim();

function unique(cards) {
    const seen = new Set();
    return cards.filter(card => {
        if (seen.has(card.key)) return false;
        seen.add(card.key);
        return true;
    });
}

// Uses the curated structures at 4 or more, else the part index. Sided pools keep every
// left/right part and its mesh (3D Hunt); the others merge each pair into one card.
export function systemPool(system, parts, {sided = false} = {}) {
    const source = `sys:${system.system_code}`, group = system.system_name;
    const make = (term, clue, mesh) => ({key: cardKey(source, term), term, clue, group, mesh});
    const structures = (system.structures || []).filter(s => String(s.name || '').trim());
    if (structures.length >= MIN_CURATED) {
        return unique(structures.map(s => make(String(s.name).trim(), firstSentence(s.desc), s.mesh_name || null)));
    }
    return unique((parts || []).map(p => sided
        ? make(p.name, firstSentence(p.description), p.id)
        : make(baseTerm(p.name), firstSentence(p.description), null)));
}

export const allSystemsPool = (systems, partsIndex) =>
    systems.flatMap(system => systemPool(system, (partsIndex || {})[system.system_code]));

export function setPool(set) {
    const source = `set:${set.set_id}`;
    return (set.cards || []).map(card => ({
        key: cardKey(source, card.term),
        term: card.term,
        clue: card.clue,
        group: card.group || set.system_name || null,
        mesh: card.mesh || null,
    }));
}
