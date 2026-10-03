import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function buildExtension(dist: string): Promise<void> {
  await mkdir(dist, { recursive: true });
  const bundled = await build({entryPoints: [path.join(root, 'src/content.ts'), path.join(root, 'src/viewer.ts')], outdir: dist, bundle: true, format: 'iife', target: 'chrome120', minify: true, legalComments: 'eof', logLevel: 'info', metafile: true, loader: { '.css': 'text' }});
  for (const name of ['viewer.html', 'viewer.css', 'content.css']) await cp(path.join(root, 'src', name), path.join(dist, name));
  await cp(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
  const license = await readFile(path.join(root, 'node_modules/mermaid/LICENSE'), 'utf8');
  await writeFile(path.join(dist, 'MERMAID-LICENSE.txt'), license);
  const packages = new Set<string>();
  for (const input of Object.keys(bundled.metafile.inputs)) {
    const absolute = path.resolve(input).split(path.sep).join('/');
    const marker = absolute.lastIndexOf('/node_modules/');
    if (marker < 0) continue;
    const parts = absolute.slice(marker + 14).split('/');
    packages.add(absolute.slice(0, marker + 14) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/'));
  }
  const notices: string[] = [];
  for (const directory of [...packages].sort()) {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const texts = await Promise.all(files.map((name) => readFile(path.join(directory, name), 'utf8')));
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const source = pkg.name === 'elkjs'
      ? `Source code for elkjs ${pkg.version} is available under the Eclipse Public License 2.0.\nObtain the corresponding source and build instructions at https://github.com/kieler/elkjs/tree/${pkg.version}\nSource archive: https://github.com/kieler/elkjs/archive/refs/tags/${pkg.version}.tar.gz\nThe upstream package is bundled without source changes.\n`
      : '';
    notices.push(`${pkg.name} ${pkg.version}\nLicense: ${JSON.stringify(pkg.license ?? pkg.licenses ?? 'See package source')}\n${repository ? `Source repository: ${repository}\n` : ''}${source}${texts.join('\n')}`);
  }
  await writeFile(path.join(dist, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n====================\n\n'));
  console.log('Chromeで読み込むフォルダ: ' + dist);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildExtension(path.join(root, 'dist'));
}
