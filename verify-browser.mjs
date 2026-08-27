#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findChrome } from './scripts/find-chrome.mjs';

const ROOT = process.cwd();
const chrome = findChrome();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitReady(url, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Vite exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let viteLog = '';
vite.stdout.on('data', (chunk) => { viteLog += chunk; });
vite.stderr.on('data', (chunk) => { viteLog += chunk; });

try {
  await waitReady(base, vite);
  console.log(`verify-browser: isolated app ready at ${base}`);
  const env = {
    ...process.env,
    CHROME_PATH: chrome,
    HEARD_URL: base,
    HEARD_APP_URL: base,
    HEARD_SHOTS: join(tmpdir(), 'heard-verify-shots'),
  };
  const allScripts = [
    'verify-experience.mjs',
    'verify-touch.mjs',
    'verify-notes-retry.mjs',
    'verify-follow.mjs',
    'verify-intake.mjs',
  ];
  const requested = process.env.HEARD_VERIFY_ONLY?.split(',').map((value) => value.trim()).filter(Boolean);
  const scripts = requested?.length ? allScripts.filter((script) => requested.includes(script)) : allScripts;
  if (requested?.length && scripts.length !== requested.length) {
    throw new Error(`Unknown HEARD_VERIFY_ONLY entry; allowed: ${allScripts.join(', ')}`);
  }
  for (const script of scripts) {
    console.log(`\n— ${script}`);
    execFileSync(process.execPath, [script], { cwd: ROOT, env, stdio: 'inherit' });
  }
  console.log('\nverify-browser: all browser behavior gates passed ✓');
} catch (error) {
  if (viteLog.trim()) console.error(`\nVite output:\n${viteLog.trim()}`);
  throw error;
} finally {
  if (vite.exitCode == null) {
    vite.kill('SIGTERM');
    await Promise.race([
      once(vite, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}
