// Portal pages ask questions with the in-app confirmToast / promptToast (assets/js/app.js),
// never the browser's own alert, confirm or prompt boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skip = new Set(['vendor']);
const files = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const rel = join(dir, entry.name);
  if (entry.isDirectory()) return skip.has(entry.name) ? [] : files(rel);
  return /\.(html|m?js)$/.test(entry.name) ? [rel] : [];
});
const NATIVE = /(?:^|[^.\w$])(?:alert|confirm|prompt)\s*\(|\b(?:window|globalThis|self|top)\.(?:alert|confirm|prompt)\s*\(/;

test('no page or script opens a native alert, confirm or prompt box', () => {
  const sources = ['teacher', 'student', 'assets/js'].flatMap(files).concat(['index.html', 'login.html']);
  const offenders = sources.flatMap(file => readFileSync(join(root, file), 'utf8').split('\n')
    .map((line, i) => NATIVE.test(line) ? `${file}:${i + 1}: ${line.trim()}` : null).filter(Boolean));
  assert.deepEqual(offenders, []);
});
