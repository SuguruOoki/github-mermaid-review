import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import { buildExtension } from './build.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const staging = await mkdtemp(path.join(tmpdir(), 'gmr-release-'));
const output = path.join(root, 'release');
const archiveName = 'github-mermaid-review-chrome.zip';
const allowed = ['content.js', 'viewer.js', 'viewer.html', 'viewer.css', 'content.css',
  'manifest.json', 'MERMAID-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt'].sort();

try {
  // Build independently of the installed dist folder so no stale/local files ship.
  await buildExtension(staging);
  if (JSON.stringify((await readdir(staging)).sort()) !== JSON.stringify(allowed)) {
    throw new Error('Unexpected release files; review the package allowlist.');
  }
  const files: Record<string, Uint8Array> = {};
  for (const name of allowed) files[`github-mermaid-review/${name}`] = await readFile(path.join(staging, name));
  files['github-mermaid-review/LICENSE'] = await readFile(path.join(root, 'LICENSE'));
  files['github-mermaid-review/README.md'] = await readFile(path.join(root, 'INSTALL.md'));
  const manifest: { version: string } = JSON.parse(await readFile(path.join(staging, 'manifest.json'), 'utf8'));
  const pkg: { version: string } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Package and manifest versions differ.');
  const archive = zipSync(files, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') });
  const extracted = unzipSync(archive);
  for (const [name, contents] of Object.entries(files)) {
    if (!extracted[name] || !Buffer.from(contents).equals(Buffer.from(extracted[name]))) {
      throw new Error(`ZIP integrity check failed: ${name}`);
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, archiveName), archive);
  const hash = createHash('sha256').update(archive).digest('hex');
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${archiveName}\n`);
  console.log(`Version ${manifest.version}: ${path.join(output, archiveName)} (${archive.length} bytes)`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
