// Checks every text/background and UI/background pair used on the public pages.
// Colours are read from the @theme block in src/public.css, so this stays in sync
// with the tokens. Run from landing-src/: npm run check:contrast
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'public.css'), 'utf8');
const tokens = Object.fromEntries([...source.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2]]));

const luminance = hex => {
  const channel = i => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum, where it is used]
const TEXT = 4.5, UI = 3;
const pairs = [
  ['text', 'page', TEXT, 'body text on the page'],
  ['text', 'surface', TEXT, 'text on cards and the 3D stage'],
  ['text', 'raised', TEXT, 'text in inputs, toggles and the part card'],
  ['muted', 'page', TEXT, 'secondary text on the page'],
  ['muted', 'surface', TEXT, 'secondary text on cards'],
  ['muted', 'raised', TEXT, 'secondary text in inputs and the part card'],
  ['accent', 'page', TEXT, 'links and the quiet button on the page'],
  ['accent', 'surface', TEXT, 'accent text on cards'],
  ['accent', 'raised', TEXT, 'accent text on raised controls'],
  ['on-accent', 'accent', TEXT, 'main button label'],
  ['on-accent', 'accent-strong', TEXT, 'main button label, hover'],
  ['line', 'page', UI, 'input and secondary button borders on the page'],
  ['line', 'surface', UI, 'borders on cards'],
  ['line', 'raised', UI, 'borders on raised controls'],
  ['accent', 'page', UI, 'focus ring on the page'],
  ['accent', 'surface', UI, 'focus ring on cards'],
  ['accent', 'raised', UI, 'focus ring on raised controls'],
  ['error', 'surface', TEXT, 'field errors in the form card'],
  ['error', 'raised', TEXT, 'field errors next to inputs'],
  ['error', 'error-tint', TEXT, 'error notice'],
  ['accent', 'success-tint', TEXT, 'success notice'],
  ['text', 'success-tint', TEXT, 'text in the success notice'],
  ['text', 'error-tint', TEXT, 'text in the error notice'],
];

let failed = 0;
for (const [fg, bg, min, use] of pairs) {
  if (!tokens[fg] || !tokens[bg]) { console.error(`Missing token: ${tokens[fg] ? bg : fg}`); failed++; continue; }
  const value = ratio(tokens[fg], tokens[bg]);
  const ok = value >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg}: ${use}`);
}
if (failed) { console.error(`${failed} pair(s) below the minimum.`); process.exit(1); }
console.log(`All ${pairs.length} pairs pass.`);
