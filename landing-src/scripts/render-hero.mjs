// Renders hero stills in assets/img/hero/ from the layer models in system_model/layers/, through
// render/hero.html, which uses the explorer's own renderer settings and tissue looks. Run from
// landing-src/:
//   npm run build:hero                       every shot below
//   npm run build:hero -- respiratory        only the named shots
//   npm run build:hero -- --out <dir>        write somewhere else, to compare before replacing
// Uses the Chromium that Playwright finds, or CHROMIUM_PATH if set. WebGL runs on SwiftShader, so no
// GPU is needed.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const OVERSAMPLE = 2; // drawn larger, then scaled down, for smoother edges

// yaw turns the camera towards the body's left (+x), pitch raises it; margins are fractions of the image.
const SHOTS = {
  respiratory: { system: 'respiratory', hide: ['Pleura', 'Epiglottis', 'Mucosa of nasal cavity'], yaw: 28, pitch: 6, width: 560, height: 640, margin: { top: 0.15, bottom: 0.11, side: 0.15 } },
  urinary: { system: 'urinary', yaw: 12, pitch: 4, width: 560, height: 640, margin: { top: 0.03, bottom: -0.04, side: 0.2 } },
  'decor-kidney': { system: 'urinary', only: ['Kidney (left)', 'Renal pelvis (left)'], yaw: -25, pitch: 6, width: 360, height: 360, margin: { top: 0.04, bottom: 0.04, side: 0.2 } },
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

// Static files from the repository root only; nothing outside it is served.
function serve() {
  const server = http.createServer(async (request, response) => {
    const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
const names = positionals.length ? positionals : Object.keys(SHOTS);
const unknown = names.filter(name => !SHOTS[name]);
if (unknown.length) throw new Error(`Unknown shot: ${unknown.join(', ')}. Shots: ${Object.keys(SHOTS).join(', ')}`);
const outDir = path.resolve(values.out || path.join(root, 'assets', 'img', 'hero'));
await fs.mkdir(outDir, { recursive: true });

const server = await serve();
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (process.getuid?.() === 0) args.push('--no-sandbox'); // Chromium refuses to start as root otherwise
const browser = await chromium.launch({ args, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log(`[page] ${message.text()}`); });
  page.on('pageerror', error => console.log(`[page] ${error.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/landing-src/render/hero.html`);
  await page.waitForFunction(() => window.harnessReady === true);
  for (const name of names) {
    const shot = SHOTS[name];
    const url = await page.evaluate(([s, w, h]) => window.harness.renderShot(s, w, h), [shot, shot.width * OVERSAMPLE, shot.height * OVERSAMPLE]);
    const file = path.join(outDir, `${name}.webp`);
    await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
      .resize({ width: shot.width, height: shot.height })
      .webp({ quality: 80, alphaQuality: 90, effort: 6 })
      .toFile(file);
    const { size } = await fs.stat(file);
    console.log(`${(size / 1024).toFixed(1).padStart(6)} KB  ${path.relative(root, file)}`);
  }
} finally {
  await browser.close();
  server.close();
}
