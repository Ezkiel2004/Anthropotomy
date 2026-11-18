// Builds the public-page images: the hero poster from uploads/images/sidebar_bg.png (skipped when that file is
// absent) and the brand files (marks, app icons, favicon, full logo) from assets/brand/logo.jpg.
// Run from landing-src/: npm run build:assets. Outputs are committed, so the site itself never needs Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const out = dir => path.join(root, 'assets', dir);

async function report(file) {
  const { size } = await fs.stat(file);
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${path.relative(root, file)}`);
}

// ── Hero poster: the glowing X-ray skeleton, cropped to its visible bounds. ──
// The source is transparent around the figure; keep the alpha so the plate
// grid shows through on the page.
async function poster() {
  const source = path.join(root, 'uploads/images/sidebar_bg.png');
  if (!(await fs.stat(source).catch(() => null))) { console.log('poster: uploads/images/sidebar_bg.png not found, keeping the committed poster'); return; }
  await fs.mkdir(out('img'), { recursive: true });
  const crop = { left: 0, top: 115, width: 957, height: 1333 };
  const base = sharp(source).extract(crop);
  for (const width of [480, 720, 957]) {
    const resized = base.clone().resize({ width });
    const stem = path.join(out('img'), `hero-skeleton-${width}`);
    await resized.clone().avif({ quality: 52, effort: 7 }).toFile(stem + '.avif');
    await resized.clone().webp({ quality: 74, alphaQuality: 80, effort: 6 }).toFile(stem + '.webp');
    await report(stem + '.avif');
    await report(stem + '.webp');
  }
  // PNG fallback for browsers without WebP: palette-quantised to stay small.
  const png = path.join(out('img'), 'hero-skeleton-720.png');
  await base.clone().resize({ width: 720 }).png({ palette: true, quality: 80, colours: 128, effort: 10 }).toFile(png);
  await report(png);
  console.log(`poster aspect: ${crop.width} × ${crop.height}`);
}

// ── Brand: the lungs mark and ANTHROPOTOMY wordmark in assets/brand/logo.jpg (navy and red on cream). ──
// The JPEG is cleaned into two flat inks with real transparency (JPEG noise removed, soft edges kept), then
// recoloured per surface: LIGHT keeps the original inks, DARK swaps the navy for near-white for the app's dark pages.
const GROUND = [252, 241, 235];
const RED = [199, 56, 48], NAVY = [35, 56, 75];
const DARK_RED = [228, 76, 64], DARK_NAVY = [236, 243, 247];

async function inks() {
  const { data, info } = await sharp(path.join(root, 'assets/brand/logo.jpg')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const light = Buffer.alloc(width * height * 4), dark = Buffer.alloc(width * height * 4);
  const smooth = t => { const x = Math.min(Math.max(t, 0), 1); return x * x * (3 - 2 * x); };
  const project = (p, ink) => {
    let num = 0, den = 0;
    for (let c = 0; c < 3; c++) { const d = ink[c] - GROUND[c]; num += (p[c] - GROUND[c]) * d; den += d * d; }
    return Math.min(Math.max(num / den, 0), 1);
  };
  const alpha = new Float32Array(width * height);
  for (let n = 0; n < width * height; n++) {
    const p = [data[n * 3], data[n * 3 + 1], data[n * 3 + 2]];
    const red = p[0] - p[2] > 60;                    // red ink is far redder than blue; navy and the ground are not
    const a = smooth((project(p, red ? RED : NAVY) - 0.12) / 0.7);
    alpha[n] = a;
    const [lr, lg, lb] = red ? RED : NAVY, [dr, dg, db] = red ? DARK_RED : DARK_NAVY, o = n * 4;
    light[o] = lr; light[o + 1] = lg; light[o + 2] = lb; light[o + 3] = Math.round(a * 255);
    dark[o] = dr; dark[o + 1] = dg; dark[o + 2] = db; dark[o + 3] = Math.round(a * 255);
  }
  // Boxes: everything, and the lungs alone (above the empty band between the mark and the wordmark).
  let x0 = width, x1 = 0, y0 = height, y1 = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width; x++) if (alpha[y * width + x] > 0.3) { any = true; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
    if (any) { rows.push(y); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  }
  const gap = rows.findIndex((y, i) => i && y - rows[i - 1] > 25);
  const split = gap > 0 ? rows[gap - 1] : rows.at(-1);
  let markX0 = width, markX1 = 0;
  for (let y = rows[0]; y <= split; y++) for (let x = 0; x < width; x++) if (alpha[y * width + x] > 0.3) { markX0 = Math.min(markX0, x); markX1 = Math.max(markX1, x + 1); }
  const raw = buf => sharp(buf, { raw: { width, height, channels: 4 } });
  return {
    light: raw(light), dark: raw(dark),
    full: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 },
    mark: { left: markX0, top: y0, width: markX1 - markX0, height: split + 1 - y0 },
  };
}

// The cropped image, centred on a transparent square so its longest side takes `fill` of it.
async function inSquare(image, box, size, fill) {
  const cropped = await image.clone().extract(box).png().toBuffer();
  const scale = (size * fill) / Math.max(box.width, box.height);
  const w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale));
  const resized = await sharp(cropped).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.floor((size - w) / 2), top: Math.floor((size - h) / 2) }]).png().toBuffer();
}

async function brand() {
  await fs.mkdir(out('brand'), { recursive: true });
  const { light, dark, full, mark } = await inks();
  const write = async (name, buffer) => { const file = path.join(out('brand'), name); await fs.writeFile(file, buffer); await report(file); };
  const cream = { r: GROUND[0], g: GROUND[1], b: GROUND[2], alpha: 1 };

  // Marks for the app's dark pages.
  for (const size of [96, 192, 512]) await write(`mark-${size}.png`, await sharp(await inSquare(dark, mark, size, 0.92)).png({ compressionLevel: 9 }).toBuffer());

  // App icons: the mark on the logo's cream ground. `radius` rounds the corners (browsers and the home screen
  // draw their own mask on the others).
  const tile = async (size, fill, radius = 0) => {
    const flat = await sharp({ create: { width: size, height: size, channels: 4, background: cream } })
      .composite([{ input: await inSquare(light, mark, size, fill) }]).png().toBuffer();
    if (!radius) return flat;
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="#fff"/></svg>`);
    return sharp(flat).composite([{ input: mask, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
  };
  await write('icon-192.png', await tile(192, 0.62, 0.22));
  await write('icon-512.png', await tile(512, 0.62, 0.22));
  await write('icon-maskable-512.png', await tile(512, 0.5));                    // full bleed; the mark stays inside the safe zone
  await write('apple-touch-icon.png', await sharp(await tile(180, 0.62)).flatten({ background: cream }).png().toBuffer());   // iOS rounds it itself

  // The full logo (mark and wordmark), transparent, for light and dark surfaces.
  const pad = Math.round(Math.max(full.width, full.height) * 0.04);
  for (const [name, image] of [['logo.png', light], ['logo-on-dark.png', dark]]) {
    await write(name, await sharp(await image.clone().extract(full).png().toBuffer())
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer());
  }

  // favicon.ico with embedded PNG images (supported by every current browser).
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(size => tile(size, 0.84, 0.18)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size, e); header.writeUInt8(size, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  const ico = path.join(root, 'favicon.ico');
  await fs.writeFile(ico, Buffer.concat([header, ...images]));
  await report(ico);
}

await poster();
await brand();
