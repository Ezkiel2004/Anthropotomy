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
  ['text-on-dark', 'ink', TEXT, 'body text on hero, header, CTA band, footer'],
  ['muted-on-dark', 'ink', TEXT, 'secondary text and plate captions on dark'],
  ['glow', 'ink', TEXT, 'links and quiet CTA on dark'],
  ['ink', 'glow', TEXT, 'primary button label on dark'],
  ['ink', 'glow-strong', TEXT, 'primary button label on dark, hover'],
  ['text-on-dark', 'forest', TEXT, 'text on raised dark surfaces'],
  ['muted-on-dark', 'forest', TEXT, 'captions on raised dark surfaces'],
  ['glow', 'forest', TEXT, 'accent text on raised dark surfaces'],
  ['line-on-dark', 'ink', UI, 'secondary button and input borders on dark'],
  ['line-on-dark', 'forest', UI, 'borders on raised dark surfaces'],
  ['text-on-paper', 'paper', TEXT, 'body text on paper'],
  ['muted-on-paper', 'paper', TEXT, 'secondary text and captions on paper'],
  ['brand', 'paper', TEXT, 'links and accents on paper'],
  ['white', 'brand', TEXT, 'primary button label on paper'],
  ['white', 'brand-strong', TEXT, 'primary button label on paper, hover'],
  ['text-on-paper', 'paper-raised', TEXT, 'text in mock screens and form fields'],
  ['muted-on-paper', 'paper-raised', TEXT, 'secondary text in mock screens and fields'],
  ['brand', 'paper-raised', TEXT, 'accents in mock screens'],
  ['brand', 'brand-tint', TEXT, 'selected answer and badges in mock screens'],
  ['text-on-paper', 'brand-tint', TEXT, 'text on selected answer'],
  ['line-on-paper', 'paper', UI, 'input and secondary button borders on paper'],
  ['line-on-paper', 'paper-raised', UI, 'input borders inside raised panels'],
  ['brand', 'paper', UI, 'focus ring on paper'],
  ['glow', 'ink', UI, 'focus ring on dark'],
  ['error', 'paper', TEXT, 'field errors on paper'],
  ['error', 'paper-raised', TEXT, 'field errors inside the form panel'],
  ['error', 'error-tint', TEXT, 'error notice'],
  ['brand-strong', 'success-tint', TEXT, 'success notice'],
];

let failed = 0;
for (const [fg, bg, min, use] of pairs) {
  if (!tokens[fg] || !tokens[bg]) { console.error(`Missing token: ${tokens[fg] ? bg : fg}`); failed++; continue; }
  const value = ratio(tokens[fg], tokens[bg]);
  const ok = value >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg} — ${use}`);
}
if (failed) { console.error(`${failed} pair(s) below the minimum.`); process.exit(1); }
console.log(`All ${pairs.length} pairs pass.`);
