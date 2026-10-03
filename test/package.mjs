import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const staging = await mkdtemp(path.join(tmpdir(), 'gmr-package-test-'));
try {
  const archive = await readFile(path.join(root, 'release/github-mermaid-review-chrome.zip'));
  const checksum = await readFile(path.join(root, 'release/SHA256SUMS.txt'), 'utf8');
  assert.equal(createHash('sha256').update(archive).digest('hex'), checksum.split(' ')[0]);
  const files = unzipSync(archive);
  for (const [name, bytes] of Object.entries(files)) {
    assert.match(name, /^github-mermaid-review\/[A-Za-z0-9.-]+$/);
    const target = path.join(staging, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const extension = path.join(staging, 'github-mermaid-review');
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
  for (const script of ['browser.mjs', 'browser-side-effects.mjs']) {
    execFileSync(process.execPath, [path.join(root, 'test', script)], {
      cwd: root, stdio: 'inherit', env: { ...process.env, GMR_EXTENSION_DIR: extension },
    });
  }
  console.log('PASS: downloaded ZIP layout loads and passes both browser suites.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
