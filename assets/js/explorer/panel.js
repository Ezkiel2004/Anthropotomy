// Info panel overlay: open/close with a remembered preference, the header, and the body sections.
// The body skeleton is built once; later renders only fill and show or hide its sections.
import {icon} from './icons.js';
import {panelDefault, splitLinks, safeUrl} from './format.js';

const STORAGE_KEY = 'anatomy.panelOpen';
let els = null, trivia = [], triviaIndex = 0, practiceEntries = [];
const byId = id => els.panel.querySelector('#' + id);

function readPreference() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writePreference(open) {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch { /* storage blocked: keep the in-memory state */ }
}

function create(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}
function section(id, heading) {
    const node = create('section', {id, className: 'info-section', hidden: true});
    if (heading) node.append(create('h3', {className: 'info-section__title', textContent: heading}));
    return node;
}

function buildSkeleton(body, onBack) {
    const exit = create('button', {type: 'button', id: 'exitFocus', className: 'panel-btn', textContent: 'Back to full body'});
    exit.addEventListener('click', onBack);
    const selected = section('selectedPart');
    selected.classList.add('selected-card');
    selected.setAttribute('aria-live', 'polite');
    selected.append(
        create('h3', {id: 'selectedPartTitle', className: 'selected-card__title'}),
        create('p', {id: 'selectedPartSystem', className: 'selected-card__system'}),
        create('span', {id: 'selectedPartBadge', className: 'selected-card__badge', textContent: 'Awaiting identification', hidden: true}),
        create('p', {id: 'selectedPartDescription'}),
        create('p', {id: 'selectedPartFunction', hidden: true}),
        create('p', {id: 'selectedPartAlso', className: 'selected-card__also', hidden: true}),
        create('a', {id: 'selectedPartReference', target: '_blank', rel: 'noopener noreferrer', textContent: 'Reference', hidden: true}),
        exit
    );
    const description = section('sysDescription', 'Description');
    const functions = section('sysFunctions', 'Functions');
    functions.append(create('ul', {className: 'info-list'}));
    const structures = section('sysStructures', 'Structures');
    structures.append(create('div', {className: 'structure-list'}));
    const trivia = section('sysTrivia', 'Did you know?');
    trivia.classList.add('trivia-card');
    trivia.append(create('p', {id: 'triviaText'}), create('button', {type: 'button', id: 'triviaNext', className: 'panel-btn', textContent: 'Next fact'}));
    const practice = section('practice', 'Quick practice');
    practice.append(
        create('p', {className: 'info-hint', textContent: "Practice with your teacher's structure descriptions. This activity is ungraded."}),
        create('button', {type: 'button', id: 'practiceButton', className: 'panel-btn', textContent: 'Practice a structure'}),
        create('p', {id: 'practicePrompt'}),
        create('div', {id: 'practiceChoices', className: 'practice-choices'}),
        create('p', {id: 'practiceResult', className: 'practice-result', role: 'status'})
    );
    const related = section('relatedContent', 'Related lessons');
    related.append(
        create('p', {className: 'info-hint', textContent: 'Open a module to view and manage its lessons.'}),
        create('div', {id: 'relatedModules', className: 'related-list', role: 'status'})
    );
    const sources = section('sysSources', 'Sources');
    sources.append(create('ul', {className: 'info-list info-list--links'}), create('p', {className: 'source-note', hidden: true}));
    body.replaceChildren(section('teacherTools'), selected, description, functions, structures, trivia, practice, related, sources);
    body.querySelector('#triviaNext').addEventListener('click', nextFact);
    body.querySelector('#practiceButton').addEventListener('click', startPractice);
}

const externalLink = (href, text) => create('a', {href, target: '_blank', rel: 'noopener noreferrer', textContent: text});

function nextFact() {
    if (!trivia.length) return;
    triviaIndex = (triviaIndex + 1) % trivia.length;
    byId('triviaText').textContent = trivia[triviaIndex];
}

// Quick practice (ungraded): show one structure's description and pick its name from up to four choices.
function startPractice() {
    if (practiceEntries.length < 2) return;
    const target = practiceEntries[Math.floor(Math.random() * practiceEntries.length)];
    const others = practiceEntries.filter(entry => entry !== target);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const choices = [target, ...others.slice(0, 3)];
    for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
    byId('practicePrompt').textContent = target.description;
    byId('practiceResult').textContent = '';
    byId('practiceChoices').replaceChildren(...choices.map(choice => {
        const button = create('button', {type: 'button', className: 'panel-btn', textContent: choice.name});
        button.addEventListener('click', () => {
            byId('practiceResult').textContent = choice === target ? 'Correct. ' + target.description : 'Try again. Read the description carefully.';
        });
        return button;
    }));
}

// Fills every section for a system (ExplorerSystem from data.js). Empty sections hide, except Structures.
export function renderPanel(system, {onStructure}) {
    renderHeader(system.name, system.summary);

    const description = byId('sysDescription');
    description.querySelectorAll('p').forEach(p => p.remove());
    description.append(...system.description.split(/\n\s*\n/).filter(Boolean).map(text => create('p', {textContent: text.trim()})));
    description.hidden = !system.description;

    byId('sysFunctions').querySelector('ul').replaceChildren(...system.functions.map(text => create('li', {textContent: text})));
    byId('sysFunctions').hidden = !system.functions.length;

    const list = byId('sysStructures').querySelector('.structure-list');
    list.replaceChildren(...system.structures.map(structure => {
        const check = create('span', {className: 'structure-chip__check'});
        check.innerHTML = icon('check');
        const button = create('button', {type: 'button', className: 'structure-chip'}, check, document.createTextNode(structure.name));
        button.dataset.structure = structure.id;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => onStructure(structure));
        return button;
    }));
    if (!system.structures.length) list.append(create('p', {className: 'info-hint', textContent: 'No structures added yet.'}));
    byId('sysStructures').hidden = false;

    trivia = system.trivia;
    byId('sysTrivia').hidden = !trivia.length;
    if (trivia.length) {
        triviaIndex = Math.floor(Math.random() * trivia.length);
        byId('triviaText').textContent = trivia[triviaIndex];
    }
    byId('triviaNext').hidden = trivia.length < 2;

    practiceEntries = system.structures.filter(structure => structure.description);
    byId('practice').hidden = practiceEntries.length < 2;
    byId('practicePrompt').textContent = '';
    byId('practiceResult').textContent = '';
    byId('practiceChoices').replaceChildren();

    const sources = byId('sysSources');
    const links = sources.querySelector('ul');
    links.replaceChildren(...system.sources.filter(source => safeUrl(source.url)).map(source => create('li', {}, externalLink(source.url, source.title || source.url))));
    links.hidden = !links.children.length;
    const note = sources.querySelector('.source-note');
    note.replaceChildren(...splitLinks(system.sourceNote).map(part => (part.href && safeUrl(part.href) ? externalLink(part.href, part.text) : document.createTextNode(part.text))));
    note.hidden = !system.sourceNote;
    sources.hidden = links.hidden && note.hidden;
}

// Shows the selected part or structure card, or hides it with null.
export function renderSelection(info) {
    const card = byId('selectedPart');
    if (!info) {
        const hadFocus = card.contains(document.activeElement);
        card.hidden = true;
        setPressedStructure(null);
        if (hadFocus) byId('sysName').focus(); // keep keyboard users in the panel, not back at the page start
        return;
    }
    byId('selectedPartTitle').textContent = info.title;
    const system = byId('selectedPartSystem');
    system.textContent = info.systemName ? 'System: ' + info.systemName : '';
    system.hidden = !info.systemName;
    byId('selectedPartBadge').hidden = !info.unidentified;
    byId('selectedPartDescription').textContent = info.description;
    const func = byId('selectedPartFunction');
    func.replaceChildren(create('strong', {textContent: 'Function: '}), document.createTextNode(info.func || ''));
    func.hidden = !info.func;
    const also = byId('selectedPartAlso');
    also.textContent = info.alsoPartOf.length ? 'Also part of: ' + info.alsoPartOf.join(', ') : '';
    also.hidden = !info.alsoPartOf.length;
    const reference = byId('selectedPartReference');
    const url = safeUrl(info.reference);
    if (url) reference.href = url; else reference.removeAttribute('href');
    reference.hidden = !url;
    byId('exitFocus').hidden = !info.focused;
    card.hidden = false;
    // Scroll only the panel (never its overflow-hidden ancestors) so the card is visible below the sticky header.
    const header = els.panel.querySelector('.info-panel__header');
    if (card.getBoundingClientRect().top < header.getBoundingClientRect().bottom) {
        els.panel.scrollTo({top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    }
}

export function setPressedStructure(id) {
    els.panel.querySelectorAll('.structure-chip').forEach(button => button.setAttribute('aria-pressed', String(id != null && button.dataset.structure === id)));
}

export function initPanel({panel, toggle, explorer, onBack, onChange}) {
    els = {panel, toggle, explorer, onChange};
    buildSkeleton(panel.querySelector('#infoBody'), onBack);
    panel.querySelector('#sysName').tabIndex = -1; // focus target when the selected card closes
    const close = panel.querySelector('[data-action="info-close"]');
    close.innerHTML = icon('x');
    close.addEventListener('click', () => setOpen(false, {returnFocus: true}));
    setOpen(panelDefault(readPreference(), matchMedia('(min-width: 768px)').matches), {persist: false});
}

export function setOpen(open, {persist = true, returnFocus = false} = {}) {
    const hadFocus = els.panel.contains(document.activeElement);
    els.panel.classList.toggle('is-open', open);
    els.explorer.classList.toggle('is-panel-open', open);
    els.toggle.setAttribute('aria-expanded', String(open));
    if (persist) writePreference(open);
    if (!open && (returnFocus || hadFocus)) els.toggle.focus();
    els.onChange?.(open);
}

export const isOpen = () => els.panel.classList.contains('is-open');
export const togglePanel = () => setOpen(!isOpen());

export function renderHeader(name, summary) {
    els.panel.querySelector('#sysName').textContent = name;
    const line = els.panel.querySelector('#sysSummary');
    line.textContent = summary || '';
    line.hidden = !summary;
}
