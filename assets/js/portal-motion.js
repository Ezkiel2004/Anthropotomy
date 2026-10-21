// Portal motion: movement that reports something, on every teacher and student page.
// Headline numbers (COUNT_SELECTOR) count up to whatever value a page script writes
// into them, so a loaded number reads as having just arrived. A list or table that
// fills from empty (or from one placeholder row) gets .pm-arrive for a moment, and
// stage-portal.css lets its rows rise in one after another. The page entrance, bar
// fill and press feedback are CSS only, also in stage-portal.css.
// With reduced motion numbers and rows simply appear.
// parseCount and formatCount are pure and the DOM work is guarded, so the unit tests
// can import this module in Node.

export const COUNT_SELECTOR = '.sd-stat-value, .stat-value';
const ARRIVE_SELECTOR = 'tbody, .row-list';
const COUNT_MS = 800;
const ARRIVE_MS = 1000;
const MAX_PREFIX = 3;

// "72%", "1,240", "4.5 pts" → the parts needed to redraw the text at any value.
// Null for text that is not exactly one number: "Not yet", "3 / 5", "–", "Grade 11".
export function parseCount(text) {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/.exec(String(text).trim());
  if (!match) return null;
  const [, prefix, digits, suffix] = match;
  if (prefix.length > MAX_PREFIX) return null;
  if (digits.includes(',') && !/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(digits)) return null;
  return {
    prefix,
    suffix,
    value: Number(digits.replace(/,/g, '')),
    decimals: (digits.split('.')[1] || '').length,
    grouped: digits.includes(','),
  };
}

export function formatCount({prefix, suffix, decimals, grouped}, value) {
  return prefix + value.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped}) + suffix;
}

if (typeof document !== 'undefined') {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const written = new WeakMap(); // element → the text this module last wrote into it
  const shown = new WeakMap(); // element → the number it last settled on
  const frames = new WeakMap();
  const arriveTimers = new WeakMap();

  // Runs as a microtask right after the page script's write, before the next paint,
  // so the first frame replaces the final value before it is ever seen.
  const countUp = element => {
    const text = element.textContent;
    if (written.get(element) === text) return; // A frame of our own.
    cancelAnimationFrame(frames.get(element));
    const target = parseCount(text);
    if (!target) { shown.delete(element); return; }
    const from = shown.get(element) ?? 0;
    shown.set(element, target.value);
    if (reducedMotion.matches || document.hidden || target.value === from) return;
    const startedAt = performance.now();
    const frame = now => {
      // A frame's timestamp is when the frame began, which can be just before startedAt.
      const progress = Math.max(0, Math.min(1, (now - startedAt) / COUNT_MS));
      const eased = 1 - (1 - progress) ** 3;
      const next = progress < 1 ? formatCount(target, from + (target.value - from) * eased) : text;
      written.set(element, next);
      element.textContent = next;
      if (progress < 1) frames.set(element, requestAnimationFrame(frame));
    };
    frame(startedAt);
  };

  const arrive = list => {
    if (reducedMotion.matches) return;
    list.classList.add('pm-arrive');
    clearTimeout(arriveTimers.get(list));
    arriveTimers.set(list, setTimeout(() => list.classList.remove('pm-arrive'), ARRIVE_MS));
  };

  const elementCount = nodes => [...nodes].filter(node => node.nodeType === Node.ELEMENT_NODE).length;

  const observer = new MutationObserver(records => {
    const counters = new Set();
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (!target) continue;
      const counter = target.closest(COUNT_SELECTOR);
      if (counter) counters.add(counter);
      if (record.type !== 'childList') continue;
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(COUNT_SELECTOR)) counters.add(node);
        for (const inner of node.querySelectorAll(COUNT_SELECTOR)) counters.add(inner);
      }
      if (target.matches(ARRIVE_SELECTOR)) {
        const before = target.children.length - elementCount(record.addedNodes) + elementCount(record.removedNodes);
        if (before <= 1 && target.children.length > before) arrive(target);
      }
    }
    counters.forEach(countUp);
  });
  observer.observe(document.getElementById('mainContent') || document.body, {subtree: true, childList: true, characterData: true});
}
