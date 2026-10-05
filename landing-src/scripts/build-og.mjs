// Renders og/og-image.html to assets/brand/og-image.jpg (1200 × 630) with the
// project's own fonts and skeleton art. Run from landing-src/: npm run build:og
// Uses the Chromium that Playwright finds, or CHROMIUM_PATH if set.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const template = pathToFileURL(path.join(import.meta.dirname, '..', 'og', 'og-image.html')).href;
const output = path.join(root, 'assets', 'brand', 'og-image.jpg');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(template, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();
await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(output);
console.log(`Wrote ${path.relative(root, output)}`);
