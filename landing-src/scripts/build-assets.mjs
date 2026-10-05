// Builds the public-page images from the two source images in uploads/images/.
// Run from landing-src/: npm run build:assets. Outputs are committed, so the site
// itself never needs Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..', '..');
const out = dir => path.join(root, 'assets', dir);
const INK = '#07110E';

async function report(file) {
  const { size } = await fs.stat(file);
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${path.relative(root, file)}`);
}

// ── Hero poster: the glowing X-ray skeleton, cropped to its visible bounds. ──
// The source is transparent around the figure; keep the alpha so the plate
// grid shows through on the page.
async function poster() {
  await fs.mkdir(out('img'), { recursive: true });
  const crop = { left: 0, top: 115, width: 957, height: 1333 };
  const base = sharp(path.join(root, 'uploads/images/sidebar_bg.png')).extract(crop);
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

// ── Brand mark: only the hexagon-and-skeleton mark from logo.png. ──
// The baked-in wordmark and tagline below it are cropped away. The mark glows on
// black, so its background is removed by unmixing black: alpha = max channel,
// colour = channel / alpha. Over a dark page this reproduces the original pixels;
// no colour or proportion is changed. Edges are feathered so the glow does not
// end in a hard rectangle.
async function mark() {
  await fs.mkdir(out('brand'), { recursive: true });
  const crop = { left: 420, top: 30, width: 730, height: 700 };
  const { data, info } = await sharp(path.join(root, 'uploads/images/logo.png'))
    .removeAlpha().extract(crop).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgba = Buffer.alloc(width * height * 4);
  const feather = 48;
  const smooth = t => { const x = Math.min(Math.max(t, 0), 1); return x * x * (3 - 2 * x); };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3, o = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const peak = Math.max(r, g, b);
      // Faint near-black noise becomes fully transparent.
      let a = peak < 6 ? 0 : peak / 255;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      a *= smooth(edge / feather);
      rgba[o] = a ? Math.min(255, Math.round(r / (peak / 255))) : 0;
      rgba[o + 1] = a ? Math.min(255, Math.round(g / (peak / 255))) : 0;
      rgba[o + 2] = a ? Math.min(255, Math.round(b / (peak / 255))) : 0;
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  // Pad to a square canvas so the mark can sit in square slots without distortion.
  const side = Math.max(width, height);
  const square = sharp(rgba, { raw: { width, height, channels: 4 } })
    .extend({ top: Math.floor((side - height) / 2), bottom: Math.ceil((side - height) / 2), left: Math.floor((side - width) / 2), right: Math.ceil((side - width) / 2), background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const master = await square.png().toBuffer();
  for (const size of [96, 192, 512]) {
    const stem = path.join(out('brand'), `mark-${size}`);
    await sharp(master).resize(size, size).png({ palette: true, quality: 90, effort: 10 }).toFile(stem + '.png');
    await report(stem + '.png');
  }
  return master;
}

// ── Favicons and app icons: the mark on an ink tile (works on any browser chrome). ──
async function icons(master) {
  const tile = async (size, inset) => {
    const inner = Math.round(size * (1 - inset * 2));
    const markPng = await sharp(master).resize(inner, inner).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: INK } })
      .composite([{ input: markPng, gravity: 'center' }]).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  };
  const write = async (name, buffer) => { const file = path.join(out('brand'), name); await fs.writeFile(file, buffer); await report(file); };
  await write('apple-touch-icon.png', await tile(180, 0.04));
  await write('icon-192.png', await tile(192, 0.04));
  await write('icon-512.png', await tile(512, 0.04));
  // Maskable icons need the mark inside the central safe zone (80%).
  await write('icon-maskable-512.png', await tile(512, 0.12));
  // favicon.ico with embedded PNG images (supported by every current browser).
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(size => tile(size, 0)));
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
await icons(await mark());
