// Checks the sample lesson content files (content/<system>.json) before anything is built from them.
//   node tools/sample-lessons/validate.mjs            check the content
//   node tools/sample-lessons/validate.mjs --files    also check that every picture the content names exists
// Every statement in a deck, a PDF or a quiz must point at a fact, and every fact at a cited source, so the "information must be
// true" rule can be checked by reading one list per system. Exits 1 and prints every problem it finds.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const SYSTEMS = ['skeletal', 'circulatory', 'respiratory', 'digestive', 'nervous'];
const checkFiles = process.argv.includes('--files');
const problems = [];
const bad = (where, message) => problems.push(`${where}: ${message}`);
const text = v => typeof v === 'string' && v.trim().length > 0;

for (const code of SYSTEMS) {
    const file = path.join(here, 'content', `${code}.json`);
    if (!fs.existsSync(file)) { bad(code, 'content file is missing (tools/sample-lessons/content/' + code + '.json)'); continue; }
    let c;
    try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { bad(code, 'not valid JSON: ' + e.message); continue; }
    const at = part => `${code} ${part}`;

    if (c.system_code !== code) bad(code, `system_code must be "${code}"`);
    if (!text(c.module?.title) || !text(c.module?.description)) bad(at('module'), 'needs a title and a description');

    // Sources and facts: the chain every statement is checked against.
    const sources = new Map();
    if (!Array.isArray(c.sources) || !c.sources.length) bad(at('sources'), 'needs at least one cited source');
    for (const s of c.sources || []) {
        if (!text(s.id) || !text(s.title) || !/^https:\/\/openstax\.org\//.test(s.url || '')) bad(at('sources'), `source ${JSON.stringify(s.id)} needs an id, a title and an openstax.org address`);
        sources.set(s.id, s);
    }
    const facts = new Map();
    for (const f of c.facts || []) {
        if (!text(f.id) || facts.has(f.id)) bad(at('facts'), `fact id ${JSON.stringify(f.id)} is missing or repeated`);
        if (!text(f.text) || f.text.length < 20) bad(at('facts'), `fact ${f.id} needs a full sentence`);
        if (!sources.has(f.source)) bad(at('facts'), `fact ${f.id} cites source ${JSON.stringify(f.source)}, which is not in sources`);
        if (!text(f.where)) bad(at('facts'), `fact ${f.id} needs "where": the chapter section it was checked against`);
        facts.set(f.id, f);
    }
    if (facts.size < 12) bad(at('facts'), `needs at least 12 checked facts (has ${facts.size})`);
    const cites = (where, id) => { if (!facts.has(id)) bad(where, `points at unknown fact ${JSON.stringify(id)}`); };

    // Deck
    const slides = c.deck?.slides;
    if (!text(c.deck?.title) || !text(c.deck?.subtitle)) bad(at('deck'), 'needs a title and a subtitle');
    if (!Array.isArray(slides) || slides.length < 7 || slides.length > 9) bad(at('deck'), `needs 7 to 9 slides, plus the sources slide that is added automatically (has ${slides?.length ?? 0})`);
    const kinds = new Set();
    (slides || []).forEach((s, i) => {
        const where = at(`slide ${i + 1}`);
        kinds.add(s.type);
        if (!text(s.title)) bad(where, 'needs a title');
        if (s.type !== 'title') {
            if (!Array.isArray(s.bullets) || s.bullets.length < 2 || s.bullets.length > 6) bad(where, 'needs 2 to 6 bullets');
            for (const b of s.bullets || []) { if (!text(b.text) || b.text.length > 150) bad(where, `bullet ${JSON.stringify(b.text)} must be text of at most 150 characters`); cites(where, b.fact); }
        }
        if (s.image) {
            if (!/^[a-z-]+-[a-z0-9-]+\.png$/.test(s.image)) bad(where, `image ${s.image} must be named <system>-<view>.png`);
            if (checkFiles && !fs.existsSync(path.join(root, 'database', 'samples', 'images', s.image))) bad(where, `image ${s.image} has not been rendered yet`);
        }
    });
    if (!kinds.has('title') || (slides && slides[0]?.type !== 'title')) bad(at('deck'), 'the first slide must be the title slide');
    if (!(slides || []).some(s => s.image)) bad(at('deck'), 'needs at least one picture from the 3D model');

    // PDF study notes
    const n = c.notes;
    if (!text(n?.title) || !text(n?.intro)) bad(at('notes'), 'needs a title and an intro');
    if (!Array.isArray(n?.terms) || n.terms.length < 5) bad(at('notes'), 'needs at least 5 key terms');
    for (const t of n?.terms || []) { if (!text(t.term) || !text(t.meaning)) bad(at('notes'), 'every term needs a term and a meaning'); cites(at('notes'), t.fact); }
    if (!Array.isArray(n?.keyFacts) || n.keyFacts.length < 5) bad(at('notes'), 'needs at least 5 key facts');
    for (const id of n?.keyFacts || []) cites(at('notes'), id);
    if (n?.image && checkFiles && !fs.existsSync(path.join(root, 'database', 'samples', 'images', n.image))) bad(at('notes'), `image ${n.image} has not been rendered yet`);

    // Quiz: 10 questions, 6 multiple choice + 2 true/false + 2 identification
    const q = c.quiz;
    if (!text(q?.title) || !text(q?.instructions)) bad(at('quiz'), 'needs a title and instructions');
    const qs = q?.questions || [];
    if (qs.length !== 10) bad(at('quiz'), `needs exactly 10 questions (has ${qs.length})`);
    const count = type => qs.filter(x => x.type === type).length;
    if (count('multiple_choice') !== 6 || count('true_false') !== 2 || count('identification') !== 2) bad(at('quiz'), 'needs 6 multiple choice, 2 true or false and 2 identification questions');
    if (new Set(qs.map(x => x.text)).size !== qs.length) bad(at('quiz'), 'two questions have the same text');
    const spread = [0, 0, 0, 0];
    qs.forEach((x, i) => {
        const where = at(`question ${i + 1}`);
        if (!text(x.text)) bad(where, 'needs text');
        cites(where, x.fact);
        if (x.type === 'multiple_choice') {
            if (!Array.isArray(x.options) || x.options.length !== 4 || new Set(x.options).size !== 4 || !x.options.every(text)) bad(where, 'needs 4 different options');
            else if (!Number.isInteger(x.correct) || x.correct < 0 || x.correct > 3) bad(where, 'correct must be the index (0 to 3) of the right option');
            else spread[x.correct]++;
        } else if (x.type === 'true_false') {
            if (typeof x.answer !== 'boolean') bad(where, 'answer must be true or false');
        } else if (x.type === 'identification') {
            if (!text(x.answer) || x.answer.trim().split(/\s+/).length > 2 || /\d/.test(x.answer)) bad(where, 'answer must be one or two words (it is matched letter for letter, ignoring case)');
        } else bad(where, `unknown question type ${JSON.stringify(x.type)}`);
    });
    if (Math.max(...spread) > 3) bad(at('quiz'), `too many multiple choice answers sit in the same position (${spread.join('/')}): spread them out`);
    if (qs.filter(x => x.type === 'true_false').length === 2 && qs.filter(x => x.type === 'true_false').every(x => x.answer === qs.find(y => y.type === 'true_false').answer)) bad(at('quiz'), 'the two true or false questions should not have the same answer');
}

if (problems.length) {
    console.error(`${problems.length} problem(s) in the sample lesson content:\n- ` + problems.join('\n- '));
    process.exit(1);
}
console.log(`Sample lesson content is valid for ${SYSTEMS.length} systems (${SYSTEMS.join(', ')}).`);
