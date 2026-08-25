/**
 * PWA asset check.
 *
 * Two precedent scars encoded here:
 *  - an icon once shipped as a corner CROP of a larger canvas, because the
 *    rasteriser cropped instead of scaling. So: assert the real pixel size of
 *    every declared PNG, read out of the PNG header.
 *  - a deploy-window 404 got cached under cache-first and locked users out.
 *    So: assert the service worker guards every put with res.ok, and that its
 *    cache name is derived from the build rather than hand-bumped.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = 'public';
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const problems = [];

function pngSize(path) {
  const d = readFileSync(path);
  if (d.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
}

for (const icon of manifest.icons) {
  const rel = icon.src.replace(/^\.\//, '');
  const path = join(PUBLIC, rel);
  if (!existsSync(path)) { problems.push(`missing ${rel}`); continue; }
  if (icon.sizes === 'any') { console.log(`  ${rel}: vector ✓`); continue; }
  const [w, h] = icon.sizes.split('x').map(Number);
  const actual = pngSize(path);
  if (!actual) { problems.push(`${rel} is not a PNG`); continue; }
  if (actual.w !== w || actual.h !== h) problems.push(`${rel} declares ${icon.sizes} but is ${actual.w}x${actual.h}`);
  else console.log(`  ${rel}: ${actual.w}x${actual.h} ${icon.purpose} ✓`);
}

if (!manifest.icons.some((i) => i.purpose === 'maskable')) problems.push('no maskable icon declared');
if (manifest.display !== 'standalone') problems.push('manifest is not standalone');
if (manifest.start_url !== './' || manifest.scope !== './') problems.push('manifest paths are not GitHub Pages-relative');
if (/everything stays/i.test(manifest.description ?? '')) {
  problems.push('manifest makes a false all-local claim');
}
if (!/providers? you connect/i.test(manifest.description ?? '')) {
  problems.push('manifest does not name the connected-provider boundary');
}
if (!existsSync(join(PUBLIC, 'sw.js'))) problems.push('missing sw.js');

const swRaw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
// Strip comments first — otherwise a comment that says "no .catch() here"
// trips the very check it is explaining.
const sw = swRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (!swRaw.includes('/*__PRECACHE__*/')) problems.push('service worker has no emitted-asset precache marker');
if (!sw.includes('__BUILD_ID__')) problems.push('service worker cache is not versioned from build output');
const puts = [...sw.matchAll(/caches\.open\(CACHE\)\.then\(\(c\) => c\.put\(/g)].length;
const okGuards = [...sw.matchAll(/if \(res\.ok\)/g)].length;
if (puts === 0) problems.push('service worker never caches anything');
if (okGuards < puts) problems.push(`${puts - okGuards} cache write(s) are not guarded by res.ok — a 404 would be pinned`);
const installBody = sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] ?? '';
if (/\.catch\s*\(/.test(installBody)) problems.push('service worker suppresses precache failure instead of preserving the previous worker');

if (!existsSync('build-sw.mjs')) problems.push('missing emitted-asset service worker builder');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (!pkg.scripts.build.includes('node build-sw.mjs')) problems.push('production build does not inject the offline asset list');

const html = readFileSync('index.html', 'utf8');
const htmlTheme = html.match(/name="theme-color" content="([^"]+)"/)?.[1];
if (htmlTheme && htmlTheme.toLowerCase() !== manifest.theme_color.toLowerCase()) {
  problems.push(`theme-color mismatch: index.html ${htmlTheme} vs manifest ${manifest.theme_color}`);
}
if (!html.includes('./manifest.webmanifest')) problems.push('index.html does not link the manifest relatively');

if (problems.length) {
  console.error(`verify-pwa: ${problems.length} problem(s)`);
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log('verify-pwa: manifest, icons and service worker all check out ✓');
