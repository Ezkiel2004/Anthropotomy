// Captures the real 3D explorer with the left femur selected, for the landing page:
//   assets/img/explorer-part-<width>.avif|webp   (800 and 1200 px wide)
// Needs a running copy of the site whose body systems are connected to the layer models
// (php database/integrate_layers.php) and a student account. Run from landing-src/:
//   ANATOMIQ_TEST_URL=http://127.0.0.1:8091 ANATOMIQ_CAPTURE_USER=<username> ANATOMIQ_CAPTURE_PASSWORD=<password> npm run build:explorer
// Only the explorer area is captured: no sidebar, top bar or account name. Use a test account on a
// test database, never a real student. Uses the Chromium that Playwright finds, or CHROMIUM_PATH.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const base = (process.env.ANATOMIQ_TEST_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
const username = process.env.ANATOMIQ_CAPTURE_USER;
const password = process.env.ANATOMIQ_CAPTURE_PASSWORD;
const PART = 'za_femur_l';
// The portal loads Plus Jakarta Sans from Google Fonts; serve the same files from @fontsource so the
// capture looks the same without network access.
const FONT_FILES = path.join(import.meta.dirname, '..', 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files');
const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800];
const WIDTHS = [800, 1200];
if (!username || !password) {
  console.error('Set ANATOMIQ_CAPTURE_USER and ANATOMIQ_CAPTURE_PASSWORD to a test student account.');
  process.exit(1);
}

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (process.getuid?.() === 0) args.push('--no-sandbox');
const browser = await chromium.launch({ args, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  page.on('pageerror', error => console.log(`[page] ${error.message}`));
  await page.route(/^https:\/\/fonts\.googleapis\.com\//, route => route.fulfill({
    contentType: 'text/css',
    body: FONT_WEIGHTS.map(weight => `@font-face{font-family:"Plus Jakarta Sans";font-weight:${weight};font-display:block;src:url(https://fonts.gstatic.com/local/${weight}.woff2) format("woff2")}`).join('\n'),
  }));
  await page.route(/^https:\/\/fonts\.gstatic\.com\/local\/(\d+)\.woff2$/, async route => {
    const weight = route.request().url().match(/(\d+)\.woff2$/)[1];
    route.fulfill({ contentType: 'font/woff2', body: await fs.readFile(path.join(FONT_FILES, `plus-jakarta-sans-latin-${weight}-normal.woff2`)) });
  });

  await page.goto(`${base}/login.html#login`);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#loginBtn');
  await page.waitForURL(/\/index\.html$/, { timeout: 20000 });

  await page.goto(`${base}/student/anatomy.html?system=skeletal`);
  await page.waitForFunction(id => typeof AnatomyViewer !== 'undefined' && Boolean(AnatomyViewer.findPart(id)), PART, { timeout: 120000 });
  await page.waitForTimeout(1000);

  // Click the femur where it appears on screen, so the explorer goes through its normal selection.
  const point = await page.evaluate(id => {
    const part = AnatomyViewer.findPart(id);
    const center = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
    AnatomyViewer.camera.updateMatrixWorld();
    const ndc = center.project(AnatomyViewer.camera);
    const rect = AnatomyViewer.canvas.getBoundingClientRect();
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }, PART);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => /Femur \(left\)/.test(document.getElementById('infoPanel')?.textContent || ''), null, { timeout: 15000 });
  await page.mouse.move(1, 1); // no hover label in the picture
  await page.evaluate(() => document.activeElement?.blur()); // no focus ring in the picture
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500); // camera move and panel layout

  const png = await page.locator('.explorer').screenshot();
  const { width, height } = await sharp(png).metadata();
  console.log(`explorer area: ${width} × ${height} px`);
  for (const target of WIDTHS) {
    const stem = path.join(root, 'assets', 'img', `explorer-part-${target}`);
    const resized = sharp(png).resize({ width: target });
    await resized.clone().avif({ quality: 55, effort: 7 }).toFile(`${stem}.avif`);
    await resized.clone().webp({ quality: 80, effort: 6 }).toFile(`${stem}.webp`);
    for (const ext of ['avif', 'webp']) {
      const { size } = await fs.stat(`${stem}.${ext}`);
      console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${path.relative(root, `${stem}.${ext}`)}  (${target} × ${Math.round(height * target / width)})`);
    }
  }
} finally {
  await browser.close();
}
