/**
 * The router must fail CLOSED. A malformed hash is user input from a link
 * someone else wrote; `decodeURIComponent` throws on it, and a throw during
 * render is a white screen — the one failure mode the precedent app shipped.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

mkdirSync('.tmp-router', { recursive: true });
execSync('npx esbuild src/router.ts --bundle --platform=node --format=esm --outfile=.tmp-router/router.mjs', { stdio: 'pipe' });
const { parseHash, href } = await import('./.tmp-router/router.mjs');

const failures = [];
const eq = (actual, expected, what) => { if (actual !== expected) failures.push(`${what}: got ${actual}, expected ${expected}`); };

/* The five routes, and only the five routes. */
eq(parseHash('#/').name, 'library', 'root');
eq(parseHash('').name, 'library', 'empty hash');
eq(parseHash('#').name, 'library', 'bare #');
eq(parseHash('#/add').name, 'bring', '#/add');
eq(parseHash('#/rec').name, 'record', '#/rec');
eq(parseHash('#/rec/x').name, 'notfound', 'record takes no params');
eq(parseHash('#/settings').name, 'settings', '#/settings');
eq(parseHash('#/i/sample').name, 'interview', '#/i/sample');
eq(parseHash('#/i/sample').params.id, 'sample', 'interview id');
eq(parseHash('#/i/sample?x=1').name, 'interview', 'query string ignored');
eq(parseHash('#/i/sample?x=1').params.x, undefined, 'unknown query key is not exposed');

/* Anything else is notfound, and App renders the Library for it. */
eq(parseHash('#/nope').name, 'notfound', 'unknown route');
eq(parseHash('#/i').name, 'notfound', 'interview with no id');
eq(parseHash('#/i/a/b').name, 'notfound', 'too many segments');
eq(parseHash('#/i/%').name, 'notfound', 'malformed percent encoding');
eq(parseHash('#/i/%E0%A4%A').name, 'notfound', 'truncated UTF-8 escape');

/* Ids round-trip through href/parseHash, including awkward ones. */
const weird = 'iv_a/b+c=';
eq(parseHash(href('interview', { id: weird })).params.id, weird, 'id round-trip');

/* A proof receipt survives a reload, but only the bounded `t` query is accepted. */
const timed = href('interview', { id: weird }, { t: 12.5 });
eq(timed, '#/i/iv_a%2Fb%2Bc%3D?t=12.5', 'time deep-link encoding');
eq(parseHash(timed).params.t, '12.5', 'time deep-link round-trip');
eq(parseHash('#/i/sample?t=-1').params.t, undefined, 'negative time rejected');
eq(parseHash('#/i/sample?t=999999999').params.t, undefined, 'unbounded time rejected');

rmSync('.tmp-router', { recursive: true, force: true });

if (failures.length) {
  console.error(`verify-router: ${failures.length} failure(s)`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('verify-router: five routes resolve, unknown hashes fail closed to the Library ✓');
