// Composes docs/screenshots/hero.png (1200×627 @2x, LinkedIn / README banner)
// from the logo and the generated panel screenshots.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const shots = resolve(root, 'docs/screenshots');
const W = 2400;
const H = 1254;

const mark = (await readFile(resolve(root, 'assets/logo-mark.svg'), 'utf8')).replace('<svg ', '<svg width="168" height="168" ');

const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="o1" cx="0.08" cy="0.05" r="0.6"><stop offset="0" stop-color="#8B5CF6" stop-opacity="0.45"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></radialGradient>
    <radialGradient id="o2" cx="0.95" cy="0.15" r="0.55"><stop offset="0" stop-color="#4F6BFF" stop-opacity="0.4"/><stop offset="1" stop-color="#4F6BFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="o3" cx="0.75" cy="1" r="0.6"><stop offset="0" stop-color="#14C8EE" stop-opacity="0.38"/><stop offset="1" stop-color="#14C8EE" stop-opacity="0"/></radialGradient>
    <radialGradient id="o4" cx="0.02" cy="0.95" r="0.45"><stop offset="0" stop-color="#FF8FB8" stop-opacity="0.3"/><stop offset="1" stop-color="#FF8FB8" stop-opacity="0"/></radialGradient>
    <linearGradient id="word" x1="0" x2="1"><stop offset="0" stop-color="#6D4AEF"/><stop offset="0.55" stop-color="#3B5BFF"/><stop offset="1" stop-color="#0EA5C9"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#ECEEF7"/>
  <rect width="100%" height="100%" fill="url(#o1)"/><rect width="100%" height="100%" fill="url(#o2)"/>
  <rect width="100%" height="100%" fill="url(#o3)"/><rect width="100%" height="100%" fill="url(#o4)"/>
  <g font-family="Segoe UI, Inter, system-ui, sans-serif">
    <text x="140" y="560" font-size="132" font-weight="800" letter-spacing="-4" fill="url(#word)">Chromotion</text>
    <text x="146" y="660" font-size="50" font-weight="600" fill="#0E1222">Calm canvases for your Chrome tabs.</text>
    <text x="146" y="740" font-size="38" fill="#3F4759">AI groups your tabs into workspaces — on your device.</text>
    <g font-size="34" font-weight="600" fill="#3F4759">
      <rect x="146" y="810" width="330" height="72" rx="36" fill="#FFFFFF" fill-opacity="0.7" stroke="#FFFFFF"/>
      <text x="311" y="858" text-anchor="middle">Free · MIT</text>
      <rect x="500" y="810" width="300" height="72" rx="36" fill="#FFFFFF" fill-opacity="0.7" stroke="#FFFFFF"/>
      <text x="650" y="858" text-anchor="middle">No API key</text>
      <rect x="824" y="810" width="300" height="72" rx="36" fill="#FFFFFF" fill-opacity="0.7" stroke="#FFFFFF"/>
      <text x="974" y="858" text-anchor="middle">No account</text>
    </g>
    <text x="146" y="1090" font-size="34" fill="#555E72">by <tspan font-weight="700" fill="#0E1222">Burhan Celebi</tspan></text>
  </g>
</svg>`;

const panel = async (file, height) => {
  const img = sharp(resolve(shots, file)).resize({ height });
  const { width } = await img.clone().metadata().then(async () => (await img.clone().toBuffer({ resolveWithObject: true })).info);
  const radius = 44;
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`);
  const rounded = await img.composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const shadow = await sharp({ create: { width: width + 160, height: height + 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="#24285A" fill-opacity="0.35"/></svg>`), left: 80, top: 100 }])
    .blur(40)
    .png()
    .toBuffer();
  return { rounded, shadow, width, height };
};

const light = await panel('panel-light.png', 1090);
const dark = await panel('panel-dark.png', 1010);
const xLight = 1370;
const xDark = xLight + light.width - 150;

await sharp(Buffer.from(background))
  .composite([
    { input: Buffer.from(mark), left: 140, top: 250 },
    { input: dark.shadow, left: xDark - 80, top: 150 - 100 },
    { input: dark.rounded, left: xDark, top: 150 },
    { input: light.shadow, left: xLight - 80, top: 100 - 100 },
    { input: light.rounded, left: xLight, top: 100 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(shots, 'hero.png'));
console.log('docs/screenshots/hero.png');
