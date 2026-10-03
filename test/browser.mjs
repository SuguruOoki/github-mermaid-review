import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'github-mermaid-review-test-'));
const extension = process.env.GMR_EXTENSION_DIR ?? path.join(root, 'dist');
const checks = [];
const outboundRequests = [];
const escaped = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function row(id, before, after) {
  const number = (line, side) => line
    ? `<td class="blob-num" data-line-number="${line.number}" id="${id}${side}${line.number}">${line.number}</td>`
    : '<td class="blob-num"></td>';
  const code = (line) => `<td class="blob-code"><span class="blob-code-inner" data-code-marker=" ">${escaped(line?.text ?? '')}</span></td>`;
  return `<tr>${number(before, 'L')}${code(before)}${number(after, 'R')}${code(after)}</tr>`;
}

function lines(text, offset = 1) {
  return text.split('\n').map((content, index) => ({ number: offset + index, text: content }));
}

function file(id, name, before, after) {
  const rows = Array.from({ length: Math.max(before.length, after.length) }, (_, index) => row(id, before[index], after[index])).join('');
  return `<section class="file" id="${id}"><div class="file-header" data-path="${name}"><strong>${name}</strong></div><table class="diff-table"><tbody>${rows}</tbody></table></section>`;
}

const before = lines('```mermaid\nflowchart LR\n  A[Before] --> B[Review]\n```');
const after = lines('```mermaid\nflowchart LR\n  A[After] --> B[Preview]\n```\n\n```mermaid\nnot-a-valid-diagram !!!\n```\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Still works\n```');
const gap = [
  ...lines('```mermaid\nflowchart LR\n  A[Visible] --> B[Complete]\n```'),
  { number: 10, text: '```mermaid' },
  { number: 11, text: 'flowchart LR' },
  { number: 13, text: '```' },
];
const fixture = `<!doctype html><html lang="en" data-color-mode="light"><head><meta charset="utf-8"><title>PR fixture</title><style>
body{margin:24px;font:14px -apple-system,sans-serif;color:#1f2328;background:#fff}.file{border:1px solid #d1d9e0;border-radius:8px;margin:20px 0;overflow:hidden}.file-header{padding:12px;background:#f6f8fa}table{width:100%;border-collapse:collapse}td{font:12px/1.7 monospace}.blob-num{width:32px;color:#656d76}.blob-code{width:45%;white-space:pre-wrap}body.dark{background:#0d1117;color:#f0f6fc;--borderColor-default:#3d444d;--fgColor-default:#f0f6fc;--bgColor-default:#0d1117;--bgColor-muted:#151b23;--fgColor-muted:#9198a1}body.dark .file-header{background:#151b23}
</style></head><body><h1>GitHub Mermaid Review · browser fixture</h1>${file('flow', 'docs/flow.md', before, after)}${file('gap', 'docs/gap.md', [], gap)}${file('non-markdown', 'example.ts', [], after)}</body></html>`;

async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function settleHeight(page, frame, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const expected = await frame.evaluate(() => Math.min(1600, Math.max(120, Math.ceil(document.getElementById('app').getBoundingClientRect().height) + 2)));
  const iframe = await page.locator(selector).elementHandle();
  await page.waitForFunction(({ iframe, expected }) => Number.parseFloat(iframe.style.height) >= expected - 1,
    { iframe, expected });
}

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    ...(process.env.GMR_CHROMIUM_PATH ? { executablePath: process.env.GMR_CHROMIUM_PATH } : {}),
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://github.com') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      outboundRequests.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('https://github.com/test/repo/pull/1/files');

  await check('MV3 content script discovers Markdown files and mounts sandboxed viewers', async () => {
    await page.locator('#flow .gmr-frame').waitFor();
    assert.equal(await page.locator('.gmr-panel').count(), 2);
    assert.equal(await page.locator('#non-markdown .gmr-panel').count(), 0);
    assert.equal(await page.locator('#flow .gmr-frame').getAttribute('sandbox'), 'allow-scripts');
    assert.match(await page.locator('#flow .gmr-frame').getAttribute('src'), /^chrome-extension:\/\//);
  });

  const flowElement = await page.locator('#flow .gmr-frame').elementHandle();
  const flowFrame = await flowElement.contentFrame();
  assert.ok(flowFrame);
  await page.locator('#gap .gmr-panel').scrollIntoViewIfNeeded();
  const gapElement = await page.locator('#gap .gmr-frame').elementHandle();
  const gapFrame = await gapElement.contentFrame();
  assert.ok(gapFrame);

  await check('before and after render independently; a syntax error does not stop later diagrams', async () => {
    await flowFrame.locator('.after .diagram').nth(2).locator('svg').waitFor();
    assert.equal(await flowFrame.locator('.before .diagram svg').count(), 1);
    assert.equal(await flowFrame.locator('.after .diagram svg').count(), 2);
    assert.equal(await flowFrame.locator('.error').count(), 1);
    assert.match(await flowFrame.locator('.before').textContent(), /Before/);
    assert.match(await flowFrame.locator('.after').textContent(), /After/);
    assert.equal(await flowFrame.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)), false);
  });

  await check('page-wide iframe rewriting leaves preview frames and rendered diagrams intact', async () => {
    const ordinaryWasRewritten = await page.evaluate(() => {
      const ordinary = document.createElement('iframe');
      ordinary.id = 'page-frame';
      ordinary.src = 'about:blank';
      document.body.append(ordinary);
      const rewriteFrames = () => {
        for (const iframe of document.querySelectorAll('iframe:not([srcdoc])')) iframe.srcdoc = '';
      };
      rewriteFrames();
      new MutationObserver(rewriteFrames).observe(document.documentElement, { childList: true, subtree: true });
      const rewritten = ordinary.getAttribute('srcdoc') === '';
      ordinary.remove();
      return rewritten;
    });
    assert.equal(ordinaryWasRewritten, true, 'fixture must reproduce page-wide iframe rewriting');
    assert.equal(await page.locator('#flow .gmr-frame').getAttribute('srcdoc'), null);
    assert.equal(await page.locator('#gap .gmr-frame').getAttribute('srcdoc'), null);
    assert.equal(await flowFrame.locator('svg').count(), 3);
  });

  await check('line gaps skip incomplete blocks and expansion updates the open preview', async () => {
    await gapFrame.locator('.after svg').waitFor();
    assert.equal(await gapFrame.locator('.after .diagram').count(), 1);
    assert.match(await page.locator('#gap .gmr-status').textContent(), /Expand all lines/);
    assert.match(await gapFrame.locator('.before .empty').textContent(), /全文が見えている/);
    const missing = row('gap', null, { number: 12, text: '  C[Expanded] --> D[Now visible]' });
    await page.locator('#gapR13').evaluate((cell, html) => cell.closest('tr').insertAdjacentHTML('beforebegin', html), missing);
    await gapFrame.locator('.after .diagram').nth(1).locator('svg').waitFor();
    assert.equal(await gapFrame.locator('.after .diagram').count(), 2);
    assert.match(await gapFrame.locator('.after').textContent(), /Expanded/);
  });

  await check('source toggle, zoom and resize stay usable', async () => {
    const diagram = flowFrame.locator('.before .diagram');
    await diagram.locator('summary').click();
    assert.equal(await diagram.locator('details').getAttribute('open'), '');
    assert.match(await diagram.locator('pre').textContent(), /flowchart LR/);
    await diagram.getByRole('button', { name: '図を拡大', exact: true }).click();
    assert.equal(await diagram.getByRole('button', { name: '図を元の倍率に戻す', exact: true }).textContent(), '125%');
    await diagram.getByRole('button', { name: '図を元の倍率に戻す', exact: true }).click();
    const height = await page.locator('#flow .gmr-frame').evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(height >= 120 && height <= 1600, `unexpected frame height ${height}`);
  });

  await settleHeight(page, flowFrame, '#flow .gmr-frame');
  await page.locator('#flow .gmr-panel').screenshot({ path: path.join(results, 'preview-light.png') });
  await settleHeight(page, gapFrame, '#gap .gmr-frame');
  await page.locator('#gap .gmr-panel').screenshot({ path: path.join(results, 'preview-expanded.png') });

  await check('ordinary mutations do not duplicate panels; theme updates redraw correctly', async () => {
    await page.locator('#flow .gmr-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      for (let index = 0; index < 20; index++) document.body.append(document.createElement('span'));
      document.documentElement.dataset.colorMode = 'dark';
      document.body.classList.add('dark');
    });
    await flowFrame.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { polling: 100 });
    await flowFrame.locator('.after .diagram').nth(2).locator('svg').waitFor();
    assert.equal(await page.locator('.gmr-panel').count(), 2);
    assert.equal(await page.locator('.gmr-frame').count(), 2);
  });
  await page.locator('#flow .gmr-panel').screenshot({ path: path.join(results, 'preview-dark.png') });

  await check('malicious source cannot enable links, HTML resources or network access', async () => {
    const source = [
      '```mermaid',
      '%%{init: {"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true}}}%%',
      'flowchart LR',
      '  A[Untrusted directive] --> B[Safe preview]',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A["<img src=\'https://gmr-test.invalid/pixel\'>"] --> B[Safe]',
      '  click A "https://gmr-test.invalid/click"',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  C@{ img: "https://gmr-test.invalid/image.png", label: "External image" }',
      '```',
    ].join('\n');
    const html = file('malicious', 'docs/malicious.md', [], lines(source));
    await page.locator('body').evaluate((body, value) => body.insertAdjacentHTML('beforeend', value), html);
    await page.locator('#malicious .gmr-panel').scrollIntoViewIfNeeded();
    const element = await page.locator('#malicious .gmr-frame').elementHandle();
    const frame = await element.contentFrame();
    await frame.locator('.after .diagram').nth(2).locator('svg, .error').waitFor();
    assert.equal(await frame.locator('.after .diagram').first().locator('svg').count(), 1,
      await frame.locator('.after .diagram').first().textContent());
    assert.equal(await frame.locator('a[href], a[xlink\\:href], img[src], image').count(), 0);
    assert.equal(await frame.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)), false);
    assert.deepEqual(outboundRequests, []);
  });

  await check('invalid message token is ignored', async () => {
    await page.locator('#flow .gmr-panel').scrollIntoViewIfNeeded();
    await page.locator('#flow .gmr-frame').evaluate((iframe) => iframe.contentWindow.postMessage({
      type: 'gmr:render', token: 'not-the-nonce', generation: 9999, theme: 'light', before: [], after: [],
    }, '*'));
    await flowFrame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await flowFrame.locator('.after .diagram').count(), 3);
    assert.equal(await flowFrame.locator('html').getAttribute('data-theme'), 'dark');
  });

  async function mountWithSrcdocInterference(id, repeat) {
    await page.locator('#flow .gmr-panel').scrollIntoViewIfNeeded();
    const html = file(id, `docs/${id}.md`, [], lines('```mermaid\nflowchart LR\n  A[Recovered] --> B[Preview]\n```'));
    await page.locator('body').evaluate((body, value) => body.insertAdjacentHTML('beforeend', value), html);
    const host = page.locator(`#${id} .gmr-host`);
    await host.waitFor({ state: 'attached' });
    assert.equal(await page.locator(`#${id} .gmr-frame`).count(), 0, 'interference must be installed before the lazy iframe mounts');
    await host.evaluate((element, repeat) => {
      const shadow = element.shadowRoot;
      let injections = 0;
      let corrections = 0;
      element.dataset.testInjections = '0';
      element.dataset.testCorrections = '0';
      const observer = new MutationObserver((records) => {
        const frame = shadow.querySelector('.gmr-frame');
        if (!frame) return;
        for (const record of records) {
          if (record.target === frame && record.type === 'attributes' && record.oldValue !== null && !frame.hasAttribute('srcdoc')) {
            corrections++;
          }
        }
        if (!frame.hasAttribute('srcdoc') && injections < (repeat ? 2 : 1)) {
          injections++;
          frame.srcdoc = '';
        }
        element.dataset.testInjections = String(injections);
        element.dataset.testCorrections = String(corrections);
      });
      observer.observe(shadow, { childList: true, subtree: true, attributes: true, attributeFilter: ['srcdoc'], attributeOldValue: true });
    }, repeat);
    await page.locator(`#${id} .gmr-panel`).scrollIntoViewIfNeeded();
    const iframe = await page.locator(`#${id} .gmr-frame`).elementHandle();
    return { host, iframe, frame: await iframe.contentFrame() };
  }

  await check('a one-time empty srcdoc replacement recovers the packaged viewer', async () => {
    const { host, iframe, frame } = await mountWithSrcdocInterference('recover-once', false);
    await frame.locator('svg').waitFor();
    assert.match(await frame.locator('.after').textContent(), /Recovered/);
    assert.equal(await iframe.getAttribute('srcdoc'), null);
    assert.equal(await host.getAttribute('data-test-injections'), '1');
    assert.equal(await host.getAttribute('data-test-corrections'), '1');
    assert.equal(await page.locator('#recover-once .gmr-status').isVisible(), false);
  });

  await check('repeated empty srcdoc replacement shows an error after one correction', async () => {
    const { host, iframe } = await mountWithSrcdocInterference('recover-repeated', true);
    await page.locator('#recover-repeated .gmr-status').filter({ hasText: '他の処理によって' }).waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await iframe.getAttribute('srcdoc'), '');
    assert.equal(await host.getAttribute('data-test-injections'), '2');
    assert.equal(await host.getAttribute('data-test-corrections'), '1');
  });

  await check('SPA navigation outside a PR diff removes stale panels', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/test/repo/issues');
      window.dispatchEvent(new Event('turbo:load'));
    });
    await page.waitForFunction(() => document.querySelectorAll('.gmr-host').length === 0);
    assert.equal(await page.locator('.gmr-frame').count(), 0);
  });
  assert.deepEqual(outboundRequests, []);
  const report = { passed: checks.length, browserVersion: context.browser()?.version(), checks, screenshots: ['preview-light.png', 'preview-dark.png', 'preview-expanded.png'], outboundRequests };
  await writeFile(path.join(results, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(path.join(results, 'failure.png'), { force: true });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (context) {
    const page = context.pages().at(-1);
    await page?.screenshot({ path: path.join(results, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Browser frames:', page?.frames().map((frame) => frame.url()));
    console.error('Page text:', await page?.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
