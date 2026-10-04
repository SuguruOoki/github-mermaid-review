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
const allowed = ['content.js', 'viewer.js', 'viewer.html', 'viewer.css', 'content.css',
  'manifest.json', 'MERMAID-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'].sort();

async function listBuildFiles(directory: string, prefix = ''): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory() && name === 'icons') {
      names.push(...await listBuildFiles(path.join(directory, entry.name), name + '/'));
    } else if (entry.isFile()) {
      names.push(name);
    } else {
      throw new Error(`Unexpected release entry: ${name}`);
    }
  }
  return names.sort();
}

try {
  // Build independently of the installed dist folder so no stale/local files ship.
  await buildExtension(staging);
  if (JSON.stringify(await listBuildFiles(staging)) !== JSON.stringify(allowed)) {
    throw new Error('Unexpected release files; review the package allowlist.');
  }
  const payload: Record<string, Uint8Array> = {};
  for (const name of allowed) payload[name] = await readFile(path.join(staging, name));
  payload.LICENSE = await readFile(path.join(root, 'LICENSE'));
  const localFiles = Object.fromEntries(Object.entries(payload).map(([name, bytes]) => [`github-mermaid-review/${name}`, bytes]));
  localFiles['github-mermaid-review/README.md'] = await readFile(path.join(root, 'INSTALL.md'));
  const manifest: { version: string } = JSON.parse(await readFile(path.join(staging, 'manifest.json'), 'utf8'));
  const pkg: { version: string } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Package and manifest versions differ.');
  await mkdir(output, { recursive: true });
  const checksums: string[] = [];
  for (const [archiveName, files] of [
    ['github-mermaid-review-chrome.zip', localFiles],
    ['github-mermaid-review-webstore.zip', payload],
  ] as const) {
    const archive = zipSync(files, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') });
    const extracted = unzipSync(archive);
    if (Object.keys(extracted).length !== Object.keys(files).length) throw new Error(`ZIP entry count differs: ${archiveName}`);
    for (const [name, contents] of Object.entries(files)) {
      if (!extracted[name] || !Buffer.from(contents).equals(Buffer.from(extracted[name]))) {
        throw new Error(`ZIP integrity check failed: ${archiveName}/${name}`);
      }
    }
    await writeFile(path.join(output, archiveName), archive);
    checksums.push(`${createHash('sha256').update(archive).digest('hex')}  ${archiveName}`);
    console.log(`Version ${manifest.version}: ${path.join(output, archiveName)} (${archive.length} bytes)`);
  }
  await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
} finally {
  await rm(staging, { recursive: true, force: true });
}
