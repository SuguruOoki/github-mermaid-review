import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import type { BrowserContext, Locator, Page } from 'playwright';

// Every visible file, repository name and review is a synthetic fixture. No
// account, live GitHub request, user browser profile or existing screenshot is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeScreenshots = process.argv.includes('--store-screenshots');
const output = path.join(root, storeScreenshots ? 'docs/store/screenshots' : 'docs/assets');
const temporary = await mkdtemp(path.join(tmpdir(), 'github-mermaid-demo-'));
const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const baseUrl = 'https://github.com/demo/review-examples/pull/1/files';
const width = storeScreenshots ? 1280 : 1180;
const height = storeScreenshots ? 800 : 790;
const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface Line { number: number; text: string }
interface Frame { filename: string; duration: number }

function source(text: string): Line[] {
  return text.split('\n').map((text, index) => ({ number: index + 1, text }));
}

function numberCell(id: string, side: 'L' | 'R', line?: Line): string {
  return line
    ? `<td class="blob-num" id="${id}${side}${line.number}" data-line-number="${line.number}">${line.number}</td>`
    : '<td class="blob-num"></td>';
}

function codeCell(line: Line | undefined, marker: string): string {
  return `<td class="blob-code" data-marker="${line ? marker : ''}"><span class="blob-code-inner" data-code-marker="${line ? marker : ' '}">${escape(line?.text ?? '')}</span></td>`;
}

function splitFile(id: string, filename: string, before: Line[], after: Line[]): string {
  const rows = Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
    `<tr>${numberCell(id, 'L', before[index])}${codeCell(before[index], '-')}${numberCell(id, 'R', after[index])}${codeCell(after[index], '+')}</tr>`).join('');
  return `<section class="file" id="${id}"><div class="file-header" data-path="${filename}"><span class="chevron">⌄</span><strong>${filename}</strong><span class="file-mode">Split diff</span></div><table class="diff-table split"><tbody>${rows}</tbody></table></section>`;
}

function addedFile(id: string, filename: string, text: string): string {
  const rows = source(text).map(line => `<tr>${numberCell(id, 'L')}${numberCell(id, 'R', line)}${codeCell(line, '+')}</tr>`).join('');
  return `<section class="file" id="${id}"><div class="file-header" data-path="${filename}"><span class="chevron">⌄</span><strong>${filename}</strong><span class="file-mode">Unified diff</span></div><table class="diff-table"><tbody>${rows}</tbody></table></section>`;
}

function fixture(title: string, files: string): string {
  return `<!doctype html><html lang="en" data-color-mode="light"><head><meta charset="utf-8"><title>${title} · synthetic demo</title><style>
*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:#fff;color:#1f2328;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding-bottom:220px}
.demo-header{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid #d1d9e0}.demo-brand{display:flex;align-items:center;gap:12px;padding:15px 26px;background:#f6f8fa}.demo-brand strong{font-size:18px;letter-spacing:-.3px}.demo-badge{margin-left:auto;border:1px solid #bf8700;color:#7d4e00;background:#fff8c5;font-size:11px;font-weight:700;padding:4px 9px;border-radius:20px;letter-spacing:.7px}.demo-step{display:flex;align-items:center;gap:12px;padding:12px 26px;color:#0969da;font-size:16px;font-weight:600}.demo-step::before{content:'▶';font-size:12px}.repo{padding:20px 26px 0;color:#59636e;font-size:13px}.repo h1{font-size:23px;line-height:1.35;margin:5px 0 12px;color:#1f2328;font-weight:600}.repo .tabs{display:flex;gap:26px;border-bottom:1px solid #d1d9e0;color:#59636e}.tabs span{padding:9px 0}.tabs .active{color:#1f2328;font-weight:600;border-bottom:2px solid #fd8c73}.files{margin:18px 26px}.file{border:1px solid #d1d9e0;border-radius:7px;margin:18px 0;overflow:hidden}.file-header{display:flex;align-items:center;gap:10px;padding:11px 13px;background:#f6f8fa;border-bottom:1px solid #d1d9e0;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.file-mode{margin-left:auto;font:11px -apple-system,sans-serif;color:#59636e}.chevron{font-size:16px;color:#59636e}table{width:100%;border-collapse:collapse;table-layout:fixed}td{font:13px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;vertical-align:top}.blob-num{width:35px;text-align:right;padding-right:8px;color:#6e7781;user-select:none}.blob-code{padding:0 8px;white-space:pre;overflow:hidden}.blob-code-inner::before{content:attr(data-code-marker);display:inline-block;width:16px;color:#6e7781}.blob-code[data-marker='+']{background:#dafbe1}.blob-code[data-marker='-']{background:#ffebe9}.split .blob-code{width:calc(50% - 35px)}.demo-pointer{position:fixed;width:27px;height:27px;z-index:1000;border:2px solid #0969da;background:#0969da20;border-radius:50%;pointer-events:none;left:-40px;top:-40px;box-shadow:0 0 0 3px #fff9}.demo-pointer.click{background:#0969da60;transform:scale(.8)}
</style></head><body><header class="demo-header"><div class="demo-brand"><strong>GitHub Mermaid Review</strong><span>Chrome extension</span><span class="demo-badge">SYNTHETIC DEMO</span></div><div id="demo-step" class="demo-step">${title}</div></header><div class="repo">demo / review-examples · Pull request #1<h1>${title}</h1><div class="tabs"><span>Conversation</span><span>Commits</span><span class="active">Files changed</span></div></div><main class="files">${files}</main><div class="demo-pointer" aria-hidden="true"></div></body></html>`;
}

const diagramFixture = fixture('Preview Mermaid directly in a pull request', splitFile('flow', 'docs/review-flow.md',
  source('```mermaid\nflowchart LR\n  A[Open PR] --> B[Read source]\n  B --> C[Review]\n```'),
  source('```mermaid\nflowchart LR\n  A[Open PR] --> B[See diagram]\n  B --> C[Review]\n```')));

const effectsFixture = fixture('Start with changes that may have side effects',
  addedFile('checkout', 'src/checkout.ts', [
    'export async function submitOrder(order: Order) {',
    '  const total = calculateTotal(order.items);',
    '',
    '  const receipt = {',
    '    orderId: order.id,',
    '    amount: total,',
    '    currency: order.currency,',
    '  };',
    '',
    "  await fetch('/api/orders', {",
    "    method: 'POST',",
    '    body: JSON.stringify(receipt),',
    '  });',
    '',
    '  return receipt;',
    '}',
  ].join('\n')) + addedFile('preferences', 'src/preferences.ts', [
    'export function savePreferences(theme: Theme) {',
    '  const preference = { theme, version: 1 };',
    '',
    '  const value = JSON.stringify(preference);',
    "  localStorage.setItem('preferences', value);",
    '',
    '  store.theme = theme;',
    '',
    '  return preference;',
    '}',
  ].join('\n')));

class Timeline {
  readonly frames: Frame[] = [];
  private pointer = { x: width - 80, y: 140 };
  private readonly page: Page;
  private readonly name: string;

  constructor(page: Page, name: string) {
    this.page = page;
    this.name = name;
  }

  async caption(text: string): Promise<void> {
    await this.page.locator('#demo-step').evaluate((element, text) => { element.textContent = text; }, text);
  }

  async capture(duration: number): Promise<void> {
    const filename = path.join(temporary, `${this.name}-${String(this.frames.length).padStart(3, '0')}.png`);
    await this.page.screenshot({ path: filename, animations: 'disabled' });
    this.frames.push({ filename, duration });
  }

  async click(target: Locator): Promise<void> {
    const bounds = await target.boundingBox();
    assert.ok(bounds, 'Demo click target must be visible');
    const end = { x: bounds.x + Math.min(bounds.width / 2, 140), y: bounds.y + bounds.height / 2 };
    const begin = this.pointer;
    for (let index = 1; index <= 5; index++) {
      const position = { x: begin.x + (end.x - begin.x) * index / 5, y: begin.y + (end.y - begin.y) * index / 5 };
      await this.page.locator('.demo-pointer').evaluate((element, position) => {
        const pointer = element as HTMLElement;
        pointer.style.left = `${position.x - 13}px`;
        pointer.style.top = `${position.y - 13}px`;
      }, position);
      await this.capture(0.08);
    }
    this.pointer = end;
    await this.page.locator('.demo-pointer').evaluate(element => element.classList.add('click'));
    await target.click();
    await this.capture(0.16);
    await this.page.locator('.demo-pointer').evaluate(element => element.classList.remove('click'));
    // Rendering and iframe resize observers get a chance to update before a hold.
    await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  async save(): Promise<{ file: string; timelineSeconds: number; bytes: number }> {
    assert.ok(this.frames.length);
    const concat = path.join(temporary, `${this.name}.txt`);
    // Names are generated locally inside mkdtemp; quoting is for ffmpeg concat,
    // not a shell. execFile never interprets filenames as shell commands.
    const quote = (filename: string): string => filename.replaceAll("'", "'\\''");
    const last = this.frames[this.frames.length - 1];
    await writeFile(concat, this.frames.map(frame => `file '${quote(frame.filename)}'\nduration ${frame.duration}\n`).join('')
      + `file '${quote(last.filename)}'\n`);
    const destination = path.join(output, `${this.name}.gif`);
    const timelineSeconds = Number(this.frames.reduce((sum, frame) => sum + frame.duration, 0).toFixed(2));
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
      '-filter_complex', 'fps=12,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-t', String(timelineSeconds), '-loop', '0', destination], { maxBuffer: 2 * 1024 * 1024 });
    return { file: path.relative(root, destination), timelineSeconds, bytes: (await stat(destination)).size };
  }
}

let context: BrowserContext | undefined;
try {
  await mkdir(output, { recursive: true });
  const extension = path.join(root, 'dist');
  await stat(path.join(extension, 'manifest.json'));
  if (!storeScreenshots) await run(ffmpeg, ['-version']);
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width, height }, deviceScaleFactor: 1,
    ...(process.env.GMR_CHROMIUM_PATH ? { executablePath: process.env.GMR_CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const unexpectedRequests: string[] = [];
  const pageErrors: string[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.href === baseUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: diagramFixture });
    } else if (request.isNavigationRequest() && url.href === `${baseUrl}?demo=effects`) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: effectsFixture });
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      unexpectedRequests.push(url.href);
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(20_000);
  await page.goto(baseUrl);
  const iframe = page.frameLocator('#flow .gmr-frame');
  await iframe.locator('.before svg').waitFor();
  await iframe.locator('.after svg').waitFor();
  assert.equal(await iframe.locator('.error').count(), 0);

  if (storeScreenshots) {
    // Store images keep the real extension UI and synthetic-data disclosure,
    // but omit the animated walkthrough's step captions and pointer.
    const waitForHeader = async (): Promise<void> => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const bounds = await page.locator('.demo-header, .demo-brand strong, .demo-badge').evaluateAll(elements => elements.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }));
      assert.equal(bounds.length, 3, 'Store screenshot must retain the title and synthetic-data disclosure');
      for (const box of bounds) {
        assert.ok(box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
          && box.x + box.width <= width && box.y + box.height <= height,
        `Store screenshot header must be fully inside the viewport: ${JSON.stringify(box)}`);
      }
    };
    const prepareScreenshot = async (): Promise<void> => {
      await page.locator('#demo-step, .demo-pointer').evaluateAll(elements => elements.forEach(element => element.remove()));
      await waitForHeader();
    };
    await prepareScreenshot();
    await page.screenshot({ path: path.join(output, 'mermaid-preview.png'), animations: 'disabled' });

    await page.goto(`${baseUrl}?demo=effects`);
    await page.locator('td[data-gmr-side-effect]').first().waitFor();
    assert.equal(await page.locator('td[data-gmr-side-effect]').count(), 3);
    await page.locator('.effects-summary').click();
    assert.equal(await page.locator('.effects-candidate').count(), 3);
    assert.equal(await page.locator('.effects-panel').getAttribute('open'), '');
    await prepareScreenshot();
    await page.locator('#preferences').evaluate(element => {
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 420);
    });
    await waitForHeader();
    await page.screenshot({ path: path.join(output, 'side-effect-review.png'), animations: 'disabled' });
    assert.deepEqual(pageErrors, [], 'Store screenshots must not hide page errors');
    assert.deepEqual(unexpectedRequests, [], 'Store screenshots must not request external services');
    console.log(JSON.stringify({ viewport: { width, height }, syntheticOnly: true, pageErrors, unexpectedRequests,
      screenshots: ['mermaid-preview.png', 'side-effect-review.png'].map(filename => path.relative(root, path.join(output, filename))) }, null, 2));
  } else {
    const mermaid = new Timeline(page, 'mermaid-preview');
    await mermaid.caption('1 / 3 · Open Files changed — before and after diagrams appear automatically');
    await mermaid.capture(2.2);
    await mermaid.caption('2 / 3 · Open the source while keeping the diagram in view');
    await mermaid.click(iframe.locator('.after .diagram summary'));
    assert.equal(await iframe.locator('.after details').getAttribute('open'), '');
    await mermaid.capture(2.3);
    await mermaid.click(iframe.locator('.after .diagram summary'));
    await mermaid.caption('3 / 3 · Zoom in for a closer review');
    const zoom = iframe.getByRole('button', { name: '図を拡大', exact: true }).last();
    await mermaid.click(zoom);
    await mermaid.click(zoom);
    assert.equal(await iframe.getByRole('button', { name: '図を元の倍率に戻す', exact: true }).last().textContent(), '150%');
    await mermaid.capture(2.1);
    await mermaid.click(iframe.getByRole('button', { name: '図を元の倍率に戻す', exact: true }).last());
    await mermaid.capture(1.2);
    const diagramResult = await mermaid.save();

    await page.goto(`${baseUrl}?demo=effects`);
    await page.locator('td[data-gmr-side-effect]').first().waitFor();
    assert.equal(await page.locator('td[data-gmr-side-effect]').count(), 3);
    const effects = new Timeline(page, 'side-effect-review');
    await effects.caption('1 / 3 · Orange outlines mark changed lines with possible side effects');
    await effects.capture(2.2);
    await effects.caption('2 / 3 · Open the candidate list to see files, lines and matching patterns');
    await effects.click(page.locator('.effects-summary'));
    assert.equal(await page.locator('.effects-candidate').count(), 3);
    await effects.capture(3);
    await effects.caption('3 / 3 · Click a candidate — jump to the line and continue reviewing');
    await effects.click(page.locator('.effects-candidate').filter({ hasText: 'localStorage' }));
    assert.equal(await page.locator('td[data-gmr-side-effect-selected]').count(), 1);
    assert.equal(await page.locator('.effects-panel').getAttribute('open'), null);
    await effects.capture(3.1);
    await effects.caption('Review the surrounding code. Candidates are hints, not proof of side effects.');
    await effects.capture(1.2);
    const effectsResult = await effects.save();
    assert.deepEqual(pageErrors, [], 'Demo must not hide page errors');
    assert.deepEqual(unexpectedRequests, [], 'Demo must not request external services');
    console.log(JSON.stringify({ viewport: { width, height }, loop: 'infinite', syntheticOnly: true,
      pageErrors, unexpectedRequests, demos: [diagramResult, effectsResult] }, null, 2));
  }
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
