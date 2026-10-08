// Pure helpers for the 3D Anatomy Explorer. No DOM or WebGL access at import time,
// so Node unit tests can load this module directly (tests/unit/explorer.test.mjs).

const SENTENCE_END = /[.!?](?=\s|$)/;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const URL_TRAILING = /[.,;:!?)]+$/;
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const SHORTCUTS = {'+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', r: 'reset', a: 'rotate', f: 'fullscreen', i: 'info', s: 'save'};
const REPEATABLE = new Set(['zoom-in', 'zoom-out']);

export function firstSentence(text) {
    const value = String(text || '').trim();
    const match = SENTENCE_END.exec(value);
    return match ? value.slice(0, match.index + 1) : value;
}

// Splits text into plain and link segments. Trailing punctuation and a closing
// parenthesis stay outside the link, so "(https://x.org), more" links only the URL.
export function splitLinks(text) {
    const value = String(text || '');
    const segments = [];
    let plain = '', last = 0;
    for (const match of value.matchAll(URL_PATTERN)) {
        const trailing = (match[0].match(URL_TRAILING) || [''])[0];
        const url = match[0].slice(0, match[0].length - trailing.length);
        plain += value.slice(last, match.index);
        if (plain) segments.push({text: plain});
        segments.push({text: url, href: url});
        plain = trailing;
        last = match.index + match[0].length;
    }
    plain += value.slice(last);
    if (plain) segments.push({text: plain});
    return segments;
}

export function safeUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

export function saveFileName(systemCode, date) {
    const pad = n => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    return `anatomy-${systemCode || 'view'}-${day}.png`;
}

// Maps a keydown to a toolbar action. Typing, browser shortcuts and held-down toggles are ignored.
export function shortcutAction(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    const target = event.target || {};
    if (TYPING_TAGS.has(String(target.tagName || '').toUpperCase()) || target.isContentEditable) return null;
    const action = SHORTCUTS[String(event.key || '').toLowerCase()] || null;
    if (action && event.repeat && !REPEATABLE.has(action)) return null;
    return action;
}

export function panelDefault(stored, wide) {
    if (stored === '1') return true;
    if (stored === '0') return false;
    return wide;
}

// Decides what the viewer's state overlay shows, in priority order.
export function stageState({viewerReady, hasVisible, loading, contextHasModel, failedId}) {
    if (!viewerReady) return {kind: 'unavailable', message: '3D viewing is unavailable on this device. You can still read the anatomy content.'};
    if (hasVisible) return {kind: 'ready', message: ''};
    if (loading) return {kind: 'loading', message: loading.progress == null ? 'Loading model…' : `Loading model: ${loading.progress}%`};
    if (!contextHasModel) return {kind: 'empty', message: 'No 3D model has been added for this system. You can read the available content alongside the viewer.'};
    if (failedId) return {kind: 'error', message: "The model couldn't be loaded.", retryId: failedId};
    return {kind: 'idle', message: 'Switch on a body system to begin.'};
}
