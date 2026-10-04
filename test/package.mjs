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
const localArchiveName = 'github-mermaid-review-chrome.zip';
const storeArchiveName = 'github-mermaid-review-webstore.zip';
const prefix = 'github-mermaid-review/';
const allowed = ['content.js', 'viewer.js', 'viewer.html', 'viewer.css', 'content.css',
  'manifest.json', 'MERMAID-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'LICENSE',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'].sort();

function validateEntryNames(files, expected) {
  for (const name of Object.keys(files)) {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9.-]*(?:\/[A-Za-z0-9][A-Za-z0-9.-]*)*$/);
    assert.ok(!name.split('/').some((segment) => segment === '.' || segment === '..'));
  }
  assert.deepEqual(Object.keys(files).sort(), expected);
}

try {
  const checksumText = await readFile(path.join(root, 'release/SHA256SUMS.txt'), 'utf8');
  const checksums = new Map(checksumText.trim().split('\n').map((line) => {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9.-]+)$/.exec(line);
    assert.ok(match, `Invalid checksum line: ${line}`);
    return [match[2], match[1]];
  }));
  assert.deepEqual([...checksums.keys()].sort(), [localArchiveName, storeArchiveName].sort());
  const archives = new Map();
  for (const name of [localArchiveName, storeArchiveName]) {
    const archive = await readFile(path.join(root, 'release', name));
    assert.equal(createHash('sha256').update(archive).digest('hex'), checksums.get(name));
    archives.set(name, unzipSync(archive));
  }
  const localFiles = archives.get(localArchiveName);
  const storeFiles = archives.get(storeArchiveName);
  validateEntryNames(localFiles, [...allowed.map((name) => prefix + name), prefix + 'README.md'].sort());
  validateEntryNames(storeFiles, allowed);
  assert.deepEqual(Buffer.from(localFiles[prefix + 'README.md']), await readFile(path.join(root, 'INSTALL.md')));
  for (const name of allowed) {
    assert.deepEqual(Buffer.from(localFiles[prefix + name]), Buffer.from(storeFiles[name]), `Payload differs: ${name}`);
  }
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(Buffer.from(storeFiles['manifest.json']).toString('utf8'));
  const localManifest = JSON.parse(Buffer.from(localFiles[prefix + 'manifest.json']).toString('utf8'));
  assert.equal(manifest.version, version);
  assert.equal(localManifest.version, version);
  assert.deepEqual(manifest.icons, Object.fromEntries([16, 32, 48, 128].map((size) => [String(size), `icons/icon${size}.png`])));
  for (const [size, name] of Object.entries(manifest.icons)) {
    assert.ok(storeFiles[name], `Missing icon: ${name}`);
    const png = Buffer.from(storeFiles[name]);
    assert.ok(png.length >= 33, `Truncated PNG: ${name}`);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(8), 13, `Invalid IHDR size: ${name}`);
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(png.readUInt32BE(16), Number(size), `Wrong icon width: ${name}`);
    assert.equal(png.readUInt32BE(20), Number(size), `Wrong icon height: ${name}`);
  }
  const extension = path.join(staging, 'webstore');
  for (const [name, bytes] of Object.entries(storeFiles)) {
    const target = path.join(extension, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  // Both archives have identical extension payloads. Exercise the store layout once.
  for (const script of ['browser.mjs', 'browser-side-effects.mjs']) {
    execFileSync(process.execPath, [path.join(root, 'test', script)], {
      cwd: root, stdio: 'inherit', env: { ...process.env, GMR_EXTENSION_DIR: extension },
    });
  }
  console.log('PASS: both ZIP layouts, checksums, icons and payloads match; store ZIP passes both browser suites.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
