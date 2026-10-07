// Builds a shareable release from dist/:
//   release/chromotion-<version>/        unpacked folder (Load unpacked)
//   release/chromotion-<version>.zip     same files, manifest.json at the zip root
// A KURULUM.txt (Turkish/English install guide) is included in both.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
const name = `chromotion-${manifest.version}`;
const outDir = resolve(root, 'release', name);
const zip = resolve(root, 'release', `${name}.zip`);

// Sanity checks that would make Chrome refuse the folder on another computer.
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page, ...Object.values(manifest.icons)]) {
  await stat(resolve(dist, file)).catch(() => {
    throw new Error(`dist/ is missing ${file} — run "npm run build" first`);
  });
}

await rm(outDir, { recursive: true, force: true });
await rm(zip, { force: true });
await mkdir(outDir, { recursive: true });
await cp(dist, outDir, { recursive: true });
await cp(resolve(import.meta.dirname, 'KURULUM.txt'), resolve(outDir, 'KURULUM.txt'));

if (process.platform === 'win32') {
  // Windows ships bsdtar in System32; it writes zip when the name ends in .zip.
  // (Git Bash's GNU tar would silently write a tar file instead.)
  const tar = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', outDir, '.'], { stdio: 'pipe' });
} else {
  execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: outDir, stdio: 'pipe' });
}
// A zip starts with "PK\x03\x04"; refuse to publish anything else.
const magic = (await readFile(zip)).subarray(0, 4).toString('latin1');
if (magic !== 'PK\x03\x04') throw new Error(`${zip} is not a zip archive`);
const size = (await stat(zip)).size;
console.log(`release/${name}/  (Load unpacked this folder)`);
console.log(`release/${name}.zip  ${(size / 1024).toFixed(0)} KB — share this; extract before loading`);
