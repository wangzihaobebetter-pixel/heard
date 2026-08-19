/**
 * Every t('...') key must be registered, IN BOTH LANGUAGES.
 *
 * The compiler cannot catch this: `translate()` falls back to en and then to
 * the raw key, so a key missing from English ships on screen as the literal
 * string `bring.choose`. The precedent app shipped exactly that once. Parity
 * is enforced from day one here, and a gap in either direction fails the build.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MIN_KEYS = 100;

const files = execSync("find src -name '*.tsx' -o -name '*.ts'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

const registered = new Set();
const perLang = { en: new Set(), 'zh-CN': new Set() };

for (const f of files.filter((x) => x.includes('/i18n/'))) {
  const src = readFileSync(f, 'utf8');
  for (const block of src.matchAll(/registerStrings\('([\w-]+)',\s*\{([\s\S]*?)\n\}\);/g)) {
    const pkg = block[1];
    const body = block[2];
    const enStart = body.indexOf('en: {');
    const zhStart = body.indexOf("'zh-CN': {");
    if (enStart < 0 || zhStart < 0) {
      console.error(`verify-i18n: registerStrings('${pkg}') is missing a language table`);
      process.exit(1);
    }
    const sections = [
      ['en', body.slice(enStart, zhStart)],
      ['zh-CN', body.slice(zhStart)],
    ];
    for (const [lang, section] of sections) {
      // Match any indentation, and require the value to look like a string so
      // object-literal noise is never counted as a key.
      for (const k of section.matchAll(/^\s+'?([\w.]+)'?:\s*['`]/gm)) {
        const full = k[1].startsWith(`${pkg}.`) ? k[1] : `${pkg}.${k[1]}`;
        registered.add(full);
        perLang[lang].add(full);
      }
    }
  }
}

const used = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  for (const m of code.matchAll(/\bt\('([\w.]+)'/g)) if (!used.has(m[1])) used.set(m[1], f);
  // template-literal keys, e.g. t(`preset.${p}`)
  for (const m of code.matchAll(/\bt\(`([\w.]+)\$\{/g)) if (!used.has(m[1] + '*')) used.set(m[1] + '*', f);
}

const missing = [];
for (const [key, file] of used) {
  if (key.endsWith('*')) {
    const prefix = key.slice(0, -1);
    if (![...registered].some((r) => r.startsWith(prefix))) missing.push([key, file]);
  } else if (!registered.has(key)) {
    missing.push([key, file]);
  }
}

const onlyZh = [...perLang['zh-CN']].filter((k) => !perLang.en.has(k));
const onlyEn = [...perLang.en].filter((k) => !perLang['zh-CN'].has(k));
for (const k of onlyZh) missing.push([`${k} (missing in en — would render as the raw key)`, 'src/i18n']);
for (const k of onlyEn) missing.push([`${k} (missing in zh-CN)`, 'src/i18n']);

// A parser that silently stops matching is the failure mode this file exists to
// prevent, so assert it is still seeing a plausible number of keys.
if (registered.size < MIN_KEYS) {
  console.error(`verify-i18n: only ${registered.size} keys parsed (expected ≥ ${MIN_KEYS}) — the parser is out of date, not the app.`);
  process.exit(1);
}

console.log(`verify-i18n: ${registered.size} keys registered (en ${perLang.en.size}, zh-CN ${perLang['zh-CN'].size}), ${used.size} used`);
if (missing.length) {
  console.error(`verify-i18n: ${missing.length} MISSING`);
  missing.forEach(([k, f]) => console.error(`  ✗ ${k}  (${f})`));
  process.exit(1);
}
console.log('verify-i18n: every key resolves in both languages ✓');
