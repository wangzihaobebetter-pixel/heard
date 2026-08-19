/**
 * The token layer is a contract too. WP2/WP3 write `var(--wash)` on faith; if a
 * role exists in Paper but not in Ink, the dark theme renders an invalid value
 * and the word being spoken silently stops being highlighted.
 *
 * Asserts: every colour role from DESIGN §7 exists in BOTH themes, the type
 * scale and motion durations exist, and no screen file hard-codes a hex.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const problems = [];

// DESIGN §7 colour table — these must be defined per theme.
const THEMED = [
  '--bg', '--surface', '--surface-2', '--ink', '--ink-2', '--ink-3', '--hairline',
  '--anchor', '--anchor-ink', '--wash', '--wash-2', '--heard', '--focus',
];
// Theme-independent scales.
const GLOBAL = [
  '--font-sans', '--font-mono',
  '--size-display', '--size-title', '--size-body', '--size-secondary', '--size-micro', '--size-timecode',
  '--lh-display', '--lh-title', '--lh-body', '--lh-body-cjk', '--lh-secondary', '--lh-micro',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--gutter', '--gutter-desktop',
  '--touch-min', '--paragraph-gap', '--row-pad-y',
  '--radius-chip', '--radius-card', '--radius-sheet',
  '--chip-h', '--chip-pad-x', '--chip-border', '--chip-border-hover',
  '--chip-border-approx', '--chip-border-dashed', '--chip-font',
  '--appbar-h', '--player-bar-h', '--player-sheet-collapsed', '--player-sheet-mid',
  '--dur-state', '--dur-settle', '--dur-scroll', '--dur-fade', '--ease-move', '--ease-fade',
  '--pre-roll', '--pre-roll-approx', '--post-roll',
  '--focus-ring', '--bp-desktop', '--measure-transcript',
];

function blockFor(selector) {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('\n}', open);
  return css.slice(open, close);
}

const paper = blockFor(":root,\n:root[data-theme='paper']");
const ink = blockFor(":root[data-theme='ink']");
if (!paper) problems.push('no Paper theme block');
if (!ink) problems.push('no Ink theme block');

for (const name of THEMED) {
  if (paper && !new RegExp(`^\\s*${name}:`, 'm').test(paper)) problems.push(`${name} missing from Paper`);
  if (ink && !new RegExp(`^\\s*${name}:`, 'm').test(ink)) problems.push(`${name} missing from Ink`);
}
for (const name of GLOBAL) {
  if (!new RegExp(`^\\s*${name}:`, 'm').test(css)) problems.push(`${name} is not defined`);
}

// DESIGN §7: "No red for errors. No green for success." There is no --danger
// and no --success token, on purpose; a package that wants one has to argue.
if (/--danger:|--success:/.test(css)) problems.push('a --danger/--success token appeared — §7 says errors are ink, ✓ heard is ink');

// Nobody hard-codes colour outside the token file.
const styleFiles = execSync("find src -name '*.css'", { encoding: 'utf8' })
  .trim().split('\n').filter((f) => f && !f.endsWith('styles/tokens.css'));
for (const f of styleFiles) {
  const body = readFileSync(f, 'utf8');
  for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    problems.push(`${f} hard-codes ${m[0]} — use a token`);
  }
}

if (problems.length) {
  console.error(`verify-tokens: ${problems.length} problem(s)`);
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log(`verify-tokens: ${THEMED.length} colour roles in both themes, ${GLOBAL.length} scale/motion tokens, no stray hex ✓`);
