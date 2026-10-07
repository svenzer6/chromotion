// Rasterises assets/logo-mark.svg into the extension icon sizes.
// 16/32 px drop the motion trails (elements marked data-detail) so they stay crisp.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const mark = await readFile(resolve(root, 'assets/logo-mark.svg'), 'utf8');
const simplified = mark.replace(/<[^>]*data-detail[^>]*\/>\s*/g, '');

const sizes = [16, 32, 48, 128];
const outDirs = [resolve(root, 'assets/icons'), resolve(root, 'public/icons')];
for (const dir of outDirs) await mkdir(dir, { recursive: true });

for (const size of sizes) {
  const svg = Buffer.from(size <= 32 ? simplified : mark);
  const png = await sharp(svg, { density: 72 * Math.max(1, (size * 4) / 128) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  for (const dir of outDirs) await writeFile(resolve(dir, `icon${size}.png`), png);
  console.log(`icon${size}.png`, png.length, 'bytes');
}

// The mark is also shipped as SVG for in-app branding (options header, sleeping tabs).
await writeFile(resolve(root, 'public/icons/logo-mark.svg'), mark);

const manifestIcons = Object.fromEntries(sizes.map((s) => [String(s), `icons/icon${s}.png`]));
await writeFile(
  resolve(root, 'assets/manifest-icons.json'),
  JSON.stringify({ icons: manifestIcons, action: { default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } } }, null, 2) + '\n',
);
console.log('assets/manifest-icons.json, public/icons/logo-mark.svg');
