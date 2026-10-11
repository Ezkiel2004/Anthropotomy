// Renders the layer models in system_model/layers/ for the landing page:
//   assets/img/systems/<system>-<width>.avif|webp   gallery cards (3:4)
//   assets/img/hero-skeletal-<width>.avif|webp      hero poster (4:5), plus a PNG fallback
// The repository is served over a local HTTP server and drawn in headless Chromium through
// render/render.html, which uses the landing page's own 3D stage. Run from landing-src/:
//   npm run build:renders
// Uses the Chromium that Playwright finds, or CHROMIUM_PATH if set. WebGL runs on SwiftShader, so no
// GPU is needed.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const SYSTEMS = ['skeletal', 'muscular', 'circulatory', 'respiratory', 'digestive', 'urinary', 'nervous', 'reproductive', 'reproductive-female', 'endocrine', 'lymphatic'];
const WIDTHS = [480, 800, 1200];
const OVERSAMPLE = 1.5; // drawn larger, then scaled down, for smoother edges
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

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

async function report(file) {
  const { size } = await fs.stat(file);
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${path.relative(root, file)}`);
}

async function write(png, stem, width, { fallback = false } = {}) {
  const resized = sharp(png).resize({ width });
  await resized.clone().avif({ quality: 50, effort: 7 }).toFile(`${stem}-${width}.avif`);
  await resized.clone().webp({ quality: 78, effort: 6 }).toFile(`${stem}-${width}.webp`);
  await report(`${stem}-${width}.avif`);
  await report(`${stem}-${width}.webp`);
  if (fallback) {
    await resized.clone().png({ palette: true, quality: 85, colours: 160, effort: 10 }).toFile(`${stem}-${width}.png`);
    await report(`${stem}-${width}.png`);
  }
}

const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

const server = await serve();
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (process.getuid?.() === 0) args.push('--no-sandbox'); // Chromium refuses to start as root otherwise
const browser = await chromium.launch({ args, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log(`[page] ${message.text()}`); });
  page.on('pageerror', error => console.log(`[page] ${error.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/landing-src/render/render.html`);
  await page.waitForFunction(() => window.harnessReady === true);
  const info = await page.evaluate(() => window.harness.setup());
  console.log(`body bounds: ${JSON.stringify(info.body)}`);

  await fs.mkdir(path.join(root, 'assets', 'img', 'systems'), { recursive: true });
  const cardWidth = Math.round(Math.max(...WIDTHS) * OVERSAMPLE), cardHeight = Math.round(cardWidth * 4 / 3);
  for (const id of SYSTEMS) {
    const png = decode(await page.evaluate(([system, w, h]) => window.harness.renderSystem(system, w, h), [id, cardWidth, cardHeight]));
    for (const width of WIDTHS) await write(png, path.join(root, 'assets', 'img', 'systems', id), width);
  }

  const posterWidth = cardWidth, posterHeight = Math.round(posterWidth * 5 / 4);
  const poster = decode(await page.evaluate(([w, h]) => window.harness.renderPoster(w, h), [posterWidth, posterHeight]));
  for (const width of WIDTHS) await write(poster, path.join(root, 'assets', 'img', 'hero-skeletal'), width, { fallback: width === 800 });
} finally {
  await browser.close();
  server.close();
}
