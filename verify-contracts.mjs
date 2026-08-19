/**
 * WP0 froze a type contract; this asserts it is still frozen.
 *
 * Five packages import these names in parallel tonight. TypeScript catches a
 * package that misuses a field, but nothing catches WP0's own file being
 * "tidied" — renaming `Anchor.quality` or dropping `Word.i` would compile
 * cleanly right up until two packages disagree about what a note points at.
 * Authority: DESIGN.md §9 "Types (normative — implementers use these names)".
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('src/types.ts', 'utf8');
const store = readFileSync('src/store/index.ts', 'utf8');
const problems = [];

/** interface/type name → the members that must be present, verbatim. */
const CONTRACT = {
  Word: ['i', 't', 's', 'e'],
  Segment: ['s', 'e', 'wi', 'wj'],
  TranscriptChunk: ['i', 's', 'e', 'state'],
  Transcript: ['lang', 'words', 'segments', 'heardSec', 'durationSec', 'chunks'],
  Anchor: ['s', 'e', 'wi', 'wj', 'quality', 'pinnedByUser'],
  Note: ['id', 'kind', 'text', 'quote', 'anchor', 'heard', 'createdAt', 'updatedAt'],
  InterviewFile: ['name', 'size', 'type', 'kept'],
  Interview: ['id', 'title', 'createdAt', 'recordedAt', 'durationSec', 'file', 'lang', 'status', 'sample'],
  SttSettings: ['preset', 'baseUrl', 'key', 'model'],
  LlmSettings: ['preset', 'baseUrl', 'key', 'model'],
  UiSettings: ['lang', 'theme', 'keepAudio', 'speed'],
  Settings: ['stt', 'llm', 'ui'],
  PlayerState: ['interviewId', 'currentTime', 'playing', 'span', 'mode', 'wordIndex'],
  PersistedState: ['v', 'settings', 'interviews', 'transcripts', 'notes', 'currentInterviewId', 'ui'],
};

/** union alias → every member it must still admit. */
const UNIONS = {
  NoteKind: ["'point'", "'quote'", "'yours'"],
  InterviewStatus: ["'listening'", "'reading'", "'ready'", "'partial'", "'failed'"],
  SttPreset: ["'openai'", "'groq'", "'custom'"],
  LlmPreset: ["'openai'", "'deepseek'", "'openrouter'", "'moonshot'", "'siliconflow'", "'custom'"],
  UiLang: ["'en'", "'zh'"],
  Theme: ["'system'", "'paper'", "'ink'"],
};

function bodyOf(name) {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  return m ? m[1] : null;
}

for (const [name, members] of Object.entries(CONTRACT)) {
  const body = bodyOf(name);
  if (!body) { problems.push(`interface ${name} is gone`); continue; }
  for (const member of members) {
    if (!new RegExp(`^\\s*${member}\\??:`, 'm').test(body)) {
      problems.push(`${name}.${member} is gone or renamed`);
    }
  }
}

for (const [name, members] of Object.entries(UNIONS)) {
  const m = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(src);
  if (!m) { problems.push(`type ${name} is gone`); continue; }
  for (const member of members) {
    if (!m[1].includes(member)) problems.push(`${name} no longer admits ${member}`);
  }
}

/* Anchor.quality is the honesty channel — it drives whether a chip renders
   solid, ≈ or dashed (DESIGN §5). Losing a state loses the honesty. */
const anchorQuality = /quality: ([^;]+);/.exec(bodyOf('Anchor') ?? '')?.[1] ?? '';
for (const q of ["'word'", "'segment'", "'unpinned'"]) {
  if (!anchorQuality.includes(q)) problems.push(`Anchor.quality no longer admits ${q}`);
}

/* Audio blobs must never enter the persisted store — a 44 MB Blob would be
   JSON-serialised on every write (DESIGN §4.6, §9). */
if (/interface PersistedState[\s\S]*?\n\}/.exec(src)?.[0]?.includes('Blob')) {
  problems.push('PersistedState mentions Blob — audio belongs in idb under audio:<id>, never in the store');
}
if (!store.includes("name: 'heard-v1'")) problems.push('the persist key moved off heard-v1 without a migration');
if (!/version: STORE_VERSION/.test(store)) problems.push('the store is not version-stamped');
if (!/migrate:/.test(store)) problems.push('the store has no migrate() — a schema change would silently drop data');

if (problems.length) {
  console.error(`verify-contracts: ${problems.length} break(s) in the frozen contract`);
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
const fields = Object.values(CONTRACT).reduce((n, m) => n + m.length, 0);
console.log(`verify-contracts: ${Object.keys(CONTRACT).length} shapes / ${fields} fields and ${Object.keys(UNIONS).length} unions intact ✓`);
