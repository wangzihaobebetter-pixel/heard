/**
 * Rasterises the two icon SVGs to the exact PNG sizes the manifest declares.
 *
 * Uses macOS `qlmanage` + `sips` rather than a rasteriser dependency. Chrome's
 * --window-size CROPS instead of scaling, which is how an icon once shipped as
 * a corner crop of a larger canvas; sips scales, and verify-pwa.mjs asserts the
 * emitted pixel dimensions afterwards either way.
 *
 * Not part of `npm run build` — the PNGs are committed. Run `npm run icons`
 * after editing an SVG.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';

const TMP = '.tmp-icons';
const OUT = 'public/icons';

const JOBS = [
  { svg: `${OUT}/icon.svg`, png: `${OUT}/icon-512.png`, size: 512 },
  { svg: `${OUT}/icon.svg`, png: `${OUT}/icon-192.png`, size: 192 },
  { svg: `${OUT}/icon-maskable.svg`, png: `${OUT}/icon-512-maskable.png`, size: 512 },
];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

for (const job of JOBS) {
  const base = job.svg.split('/').pop();
  execFileSync('qlmanage', ['-t', '-s', '1024', '-o', TMP, job.svg], { stdio: 'ignore' });
  const raster = `${TMP}/${base}.png`;
  copyFileSync(raster, job.png);
  execFileSync('sips', ['-z', String(job.size), String(job.size), job.png], { stdio: 'ignore' });
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', job.png], { encoding: 'utf8' });
  const w = Number(/pixelWidth: (\d+)/.exec(dims)?.[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(dims)?.[1]);
  if (w !== job.size || h !== job.size) throw new Error(`${job.png} is ${w}x${h}, expected ${job.size}`);
  console.log(`make-icons: ${job.png} ${w}x${h} ✓`);
}

rmSync(TMP, { recursive: true, force: true });
