/**
 * Injects the emitted asset list and a content-derived cache id into
 * dist/sw.js. Runs as the last step of `npm run build`.
 *
 * The cache id is a hash of the asset list, so a deploy that changed nothing
 * keeps its cache and a deploy that changed anything invalidates it. A
 * hand-bumped version number is the thing that gets forgotten.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = 'dist';
const SW = join(DIST, 'sw.js');
const marker = '/*__PRECACHE__*/';
const buildMarker = '__BUILD_ID__';

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

const assets = filesUnder(DIST)
  .map((file) => relative(DIST, file).split(sep).join('/'))
  .filter((file) => !['sw.js', 'index.html', 'manifest.webmanifest'].includes(file) && !file.startsWith('.'))
  // The sample mp3 is fetched on first play and runtime-cached; precaching 4 MB
  // on every first load would be rude (DESIGN §4.6).
  .filter((file) => file !== 'sample.mp3')
  .sort()
  .map((file) => JSON.stringify(`./${file}`))
  .join(',\n  ');

const source = readFileSync(SW, 'utf8');
if (!source.includes(marker) || !source.includes(buildMarker)) {
  throw new Error('build-sw: dist/sw.js is missing its build markers');
}
const buildId = createHash('sha256').update(assets).digest('hex').slice(0, 12);
writeFileSync(SW, source.replace(marker, assets).replace(buildMarker, buildId));
console.log(`build-sw: cache ${buildId} precaches ${assets ? assets.split(',\n').length : 0} emitted assets`);
