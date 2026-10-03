import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
const profile = await mkdtemp(path.join(tmpdir(), 'github-side-effects-test-'));
const extension = process.env.GMR_EXTENSION_DIR ?? path.join(root, 'dist');
const fixtureUrl = 'https://github.com/test/repo/pull/1/files';
const checks = [];
const outboundRequests = [];
const pageErrors = [];
const sources = new Map();
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const revisions = [
  { before: 1, after: 1, text: "fetch('/unchanged-context');", marker: ' ' },
  { before: 2, after: 2, text: '/*', marker: ' ' },
  { before: 3, after: null, text: "fetch('/removed-comment');", marker: '-' },
  { before: null, after: 3, text: "fetch('/added-comment');", marker: '+' },
  { before: 4, after: 4, text: '*/', marker: ' ' },
  { before: 5, after: null, text: "fetch('/old-endpoint');", marker: '-' },
  { before: null, after: 5, text: "fetch('/new-endpoint');", marker: '+' },
  { before: 6, after: null, text: 'const local = 1;', marker: '-' },
  { before: null, after: 6, text: "localStorage.setItem('theme', 'dark');", marker: '+' },
  { before: 7, after: null, text: "this.status = 'old';", marker: '-' },
  { before: null, after: 7, text: "this.status = 'ready';", marker: '+' },
  { before: null, after: 8, text: 'const example = "fetch(\'/string-only\')";', marker: '+' },
  { before: null, after: 9, text: "// fetch('/line-comment-only');", marker: '+' },
  { before: 10, after: 10, text: 'const end = true;', marker: ' ' },
];

function numberCell(id, kind, side, number) {
  if (kind === 'classic') return number === null ? '<td class="blob-num"></td>'
    : `<td class="blob-num" id="${id}${side === 'before' ? 'L' : 'R'}${number}" data-line-number="${number}">${number}</td>`;
  return `<td class="new-diff-line-number" data-diff-side="${side === 'before' ? 'left' : 'right'}"${number === null ? '' : ` data-line-number="${number}"`}>${number ?? ''}</td>`;
}

function codeCell(id, kind, side, number, text, marker) {
  if (number === null) return kind === 'classic' ? '<td class="blob-code empty-cell"></td>'
    : `<td class="diff-text-cell" data-diff-side="${side === 'before' ? 'left' : 'right'}"></td>`;
  const cellId = `${id}-${side}-${number}`;
  const title = `Original title: ${cellId}`;
  sources.set(cellId, { text, title, marker });
  const common = `id="${cellId}" title="${title}" data-fixture-marker="${marker}"`;
  const inner = `<span class="syntax-word">${escape(text)}</span>`;
  if (kind === 'classic') return `<td class="blob-code" ${common}><span class="blob-code-inner fixture-source" data-code-marker="${marker}">${inner}</span></td>`;
  return `<td class="diff-text-cell" ${common} data-diff-side="${side === 'before' ? 'left' : 'right'}" data-line-number="${number}" data-line-anchor="${id}R${number}"><code class="diff-text syntax-highlighted-line"><span class="diff-text-marker">${marker}</span><div class="diff-text-inner fixture-source">${inner}</div></code></td>`;
}

function diffRow(id, kind, mode, entry) {
  const { before, after, text, marker } = entry;
  const rowClass = kind === 'react' ? ' class="diff-line-row"' : '';
  if (mode === 'unified') {
    const side = after === null ? 'before' : 'after';
    return `<tr${rowClass}>${numberCell(id, kind, 'before', before)}${numberCell(id, kind, 'after', after)}${codeCell(id, kind, side, after ?? before, text, marker)}</tr>`;
  }
  return `<tr${rowClass}>${numberCell(id, kind, 'before', before)}${codeCell(id, kind, 'before', before, text, marker)}${numberCell(id, kind, 'after', after)}${codeCell(id, kind, 'after', after, text, marker)}</tr>`;
}

function file(id, kind, mode) {
  const filename = `src/${id}.ts`;
  const renderedRows = [];
  for (let index = 0; index < revisions.length; index++) {
    const entry = revisions[index];
    const next = revisions[index + 1];
    if (mode === 'split' && entry.marker === '-' && next?.marker === '+' && entry.before === next.after) {
      const rowClass = kind === 'react' ? ' class="diff-line-row"' : '';
      renderedRows.push(`<tr${rowClass}>${numberCell(id, kind, 'before', entry.before)}${codeCell(id, kind, 'before', entry.before, entry.text, '-')}${numberCell(id, kind, 'after', next.after)}${codeCell(id, kind, 'after', next.after, next.text, '+')}</tr>`);
      index++;
    } else renderedRows.push(diffRow(id, kind, mode, entry));
  }
  const rows = renderedRows.join('');
  if (kind === 'classic') return `<section class="file fixture-file" id="${id}"><div class="file-header" data-path="${filename}"><h2>${filename} · ${mode}</h2></div><table class="diff-table"><tbody>${rows}</tbody></table></section>`;
  return `<section class="fixture-file" role="region" id="diff-${id}" aria-labelledby="heading-${id}"><div data-diff-header-wrapper="true"><h3 id="heading-${id}"><a href="#diff-${id}"><code>\u200e${filename}\u200e</code></a> · ${mode}</h3></div><table><tbody>${rows}</tbody></table></section>`;
}

const fixture = `<!doctype html><html lang="en" data-color-mode="light"><head><meta charset="utf-8"><title>Side-effect review fixture</title><style>
body{margin:24px;font:14px -apple-system,sans-serif;color:#1f2328;background:#fff;padding-bottom:50px}
h1{font-size:24px}h2,h3{font-size:15px;margin:0}.fixture-file{border:1px solid #d1d9e0;border-radius:8px;margin:24px 0;overflow:hidden}
.file-header,[data-diff-header-wrapper]{padding:12px;background:#f6f8fa}a{color:inherit}table{width:100%;border-collapse:collapse;table-layout:fixed}td{font:12px/1.8 monospace;vertical-align:top}
.blob-num,.new-diff-line-number{width:32px;color:#656d76;text-align:right;padding-right:6px}.blob-code,.diff-text-cell{white-space:pre-wrap;padding:0 8px}
.diff-text-marker{display:inline-block;width:1em}.diff-text-inner{display:inline}.blob-code-inner[data-code-marker]::before{content:attr(data-code-marker);display:inline-block;width:1em}
td[data-fixture-marker="+"]{background:#dafbe1}td[data-fixture-marker="-"]{background:#ffebe9}
body.dark{background:#0d1117;color:#f0f6fc;--borderColor-default:#3d444d;--fgColor-default:#f0f6fc;--bgColor-default:#0d1117;--bgColor-muted:#151b23;--fgColor-muted:#9198a1;--fgColor-success:#3fb950;--fgColor-danger:#f85149}
body.dark .file-header,body.dark [data-diff-header-wrapper]{background:#151b23}body.dark td[data-fixture-marker="+"]{background:#033a16}body.dark td[data-fixture-marker="-"]{background:#67060c}
</style></head><body><h1>GitHub review · side-effect candidates</h1><p>Four supported diff layouts, with unchanged context, comments, strings, additions and deletions.</p>
${file('classic-unified', 'classic', 'unified')}${file('classic-split', 'classic', 'split')}${file('react-unified', 'react', 'unified')}${file('react-split', 'react', 'split')}
</body></html>`;

async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function waitForCount(page, count, files) {
  await page.waitForFunction(({ count, files }) => {
    const shadow = document.querySelector('.gmr-effects-host')?.shadowRoot;
    const summary = shadow?.querySelector('.effects-summary');
    return document.querySelectorAll('td[data-gmr-side-effect]').length === count
      && summary?.textContent.includes(`${count} 行 / ${files} ファイル`)
      && shadow.querySelectorAll('.effects-candidate').length === count;
  }, { count, files });
}

async function assertOriginalSource(page, expected = [...sources]) {
  const actual = await page.evaluate((ids) => ids.map((id) => {
    const cell = document.getElementById(id);
    return [id, { text: cell.querySelector('.fixture-source').textContent, title: cell.getAttribute('title') }];
  }), expected.map(([id]) => id));
  assert.deepEqual(actual, expected.map(([id, { text, title }]) => [id, { text, title }]));
}

let context;
try {
  await mkdir(results, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    ...(process.env.GMR_CHROMIUM_PATH ? { executablePath: process.env.GMR_CHROMIUM_PATH } : {}),
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.href === fixtureUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      outboundRequests.push(url.href);
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(20_000);
  await page.goto(fixtureUrl);

  await check('MV3 extension identifies changed candidates in classic and React unified/split diffs', async () => {
    await waitForCount(page, 20, 4);
    assert.equal(await page.locator('.gmr-effects-host').count(), 1);
    assert.equal(await page.locator('.effects-panel').getAttribute('open'), null);
    const highlighted = await page.locator('td[data-gmr-side-effect]').evaluateAll((cells) => cells.map((cell) => cell.id).sort());
    const expected = ['classic-unified', 'classic-split', 'react-unified', 'react-split'].flatMap((id) => [
      `${id}-before-5`, `${id}-before-7`, `${id}-after-5`, `${id}-after-6`, `${id}-after-7`,
    ]).sort();
    assert.deepEqual(highlighted, expected, 'context, comments, strings and local assignments must not be candidates');
    await assertOriginalSource(page);
  });

  await check('candidate list exposes side, line, category and evidence without implying purity', async () => {
    await page.locator('.effects-summary').click();
    assert.match(await page.locator('.effects-explanation').textContent(), /候補がなくても、副作用がないとは限りません/);
    assert.equal(await page.locator('.effects-file').count(), 4);
    for (const label of ['追加 L5', '削除 L5', '外部通信・送信', 'DB・ファイル・保存', '状態変更']) {
      assert.ok((await page.locator('.effects-list').textContent()).includes(label), `missing ${label}`);
    }
    for (const label of ['fetch', 'localStorage', 'this.status']) {
      assert.ok((await page.locator('.effects-list').textContent()).includes(label), `missing evidence ${label}`);
    }
  });

  await check('highlight toggle preserves source, existing titles and original diff colors', async () => {
    const cells = page.locator('td[data-fixture-marker]');
    const colors = await cells.evaluateAll((items) => items.map((cell) => getComputedStyle(cell).backgroundColor));
    await page.getByLabel('候補行を強調する').uncheck();
    assert.equal(await page.locator('td[data-gmr-side-effect]').count(), 0);
    assert.equal(await page.locator('.effects-candidate').count(), 20);
    assert.deepEqual(await cells.evaluateAll((items) => items.map((cell) => getComputedStyle(cell).backgroundColor)), colors);
    await page.getByLabel('候補行を強調する').check();
    await waitForCount(page, 20, 4);
    assert.deepEqual(await cells.evaluateAll((items) => items.map((cell) => getComputedStyle(cell).backgroundColor)), colors);
    await assertOriginalSource(page);
  });

  await check('candidate navigation selects the source cell and collapses the panel to avoid covering it', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.effects-candidate').filter({ hasText: '追加 L7' }).last().click();
    const selected = page.locator('td[data-gmr-side-effect-selected]');
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.getAttribute('id'), 'react-split-after-7');
    assert.equal(await page.locator('.effects-panel').getAttribute('open'), null);
    const position = await selected.evaluate((cell) => {
      const rect = cell.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: innerHeight, scrollY };
    });
    assert.ok(position.scrollY > 0 && position.top >= 0 && position.bottom <= position.height, JSON.stringify(position));
    assert.equal(await selected.evaluate((cell) => {
      const rect = cell.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + Math.min(200, rect.width / 2), rect.top + rect.height / 2);
      return target === cell || cell.contains(target);
    }), true, 'the source cell must remain reachable instead of being covered by the floating panel');
  });
  await page.locator('.effects-summary').click();
  await page.locator('.effects-body').evaluate((body) => { body.scrollTop = 0; });
  await page.screenshot({ path: path.join(results, 'side-effects-light.png') });

  await check('theme changes and ordinary mutations keep one readable review panel', async () => {
    await page.evaluate(() => {
      document.documentElement.dataset.colorMode = 'dark';
      document.body.classList.add('dark');
      for (let index = 0; index < 10; index++) document.body.append(document.createElement('span'));
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.gmr-effects-host').shadowRoot.querySelector('.effects-panel')).backgroundColor === 'rgb(13, 17, 23)');
    await waitForCount(page, 20, 4);
    assert.equal(await page.locator('.gmr-effects-host').count(), 1);
    await assertOriginalSource(page);
  });
  await page.screenshot({ path: path.join(results, 'side-effects-dark.png') });

  await check('expanding loaded lines discovers newly visible candidates', async () => {
    const expanded = diffRow('react-split', 'react', 'split', {
      before: null, after: 11, text: "fetch('/expanded-line');", marker: '+',
    });
    await page.locator('#diff-react-split tbody').evaluate((body, html) => body.insertAdjacentHTML('beforeend', html), expanded);
    await waitForCount(page, 21, 4);
    assert.equal(await page.locator('#react-split-after-11').getAttribute('data-gmr-side-effect'), '');
    assert.equal(await page.locator('.effects-candidate').filter({ hasText: '追加 L11' }).count(), 1);
    await assertOriginalSource(page);
  });

  await check('replacing an identical source cell restores decoration and updates navigation targets', async () => {
    await page.locator('#react-split-after-11').evaluate((cell) => {
      const replacement = cell.cloneNode(true);
      replacement.removeAttribute('data-gmr-side-effect');
      replacement.removeAttribute('data-gmr-side-effect-selected');
      window.detachedFixtureCell = cell;
      cell.replaceWith(replacement);
    });
    await waitForCount(page, 21, 4);
    assert.equal(await page.evaluate(() => window.detachedFixtureCell.hasAttribute('data-gmr-side-effect')), false);
    await page.locator('.effects-candidate').filter({ hasText: '追加 L11' }).click();
    assert.equal(await page.locator('td[data-gmr-side-effect-selected]').getAttribute('id'), 'react-split-after-11');
    await assertOriginalSource(page);
  });

  await check('removing a candidate updates its list entry and clears its old highlight', async () => {
    await page.locator('#react-split-after-11 .fixture-source').evaluate((source) => { source.textContent = 'const localOnly = 42;'; });
    await waitForCount(page, 20, 4);
    assert.equal(await page.locator('#react-split-after-11').getAttribute('data-gmr-side-effect'), null);
    assert.equal(await page.locator('#react-split-after-11').getAttribute('data-gmr-side-effect-selected'), null);
    assert.equal(await page.locator('.effects-candidate').filter({ hasText: '追加 L11' }).count(), 0);
  });

  await check('zero candidates keeps the limitation visible and removes every decoration', async () => {
    await page.locator('.fixture-source').evaluateAll((items) => {
      for (const source of items) source.textContent = 'const localOnly = 1;';
    });
    await waitForCount(page, 0, 0);
    assert.equal(await page.locator('td[data-gmr-side-effect-selected]').count(), 0);
    assert.match(await page.locator('.effects-notice').textContent(), /一致する変更行は見つかりませんでした/);
    assert.match(await page.locator('.effects-explanation').textContent(), /副作用がないとは限りません/);
  });

  await check('SPA exit removes the panel, page styling and stale source decorations', async () => {
    await page.locator('#classic-unified-after-5 .fixture-source').evaluate((source) => { source.textContent = "fetch('/before-navigation');"; });
    await waitForCount(page, 1, 1);
    await page.evaluate(() => {
      history.pushState({}, '', '/test/repo/issues');
      window.dispatchEvent(new Event('turbo:load'));
    });
    await page.waitForFunction(() => !document.querySelector('.gmr-effects-host'));
    assert.equal(await page.locator('td[data-gmr-side-effect], td[data-gmr-side-effect-selected]').count(), 0);
    assert.equal(await page.locator('style[data-gmr-owned]').count(), 0);
  });

  await check('reviewing source performs no network requests or page execution', async () => {
    assert.deepEqual(outboundRequests, []);
    assert.deepEqual(pageErrors, []);
  });
  const report = { passed: checks.length, browserVersion: context.browser()?.version(), checks,
    screenshots: ['side-effects-light.png', 'side-effects-dark.png'], outboundRequests, pageErrors };
  await writeFile(path.join(results, 'side-effects-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(path.join(results, 'side-effects-failure.png'), { force: true });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const page = context?.pages().at(-1);
  await page?.screenshot({ path: path.join(results, 'side-effects-failure.png'), fullPage: true }).catch(() => {});
  console.error('Side-effect panel:', await page?.locator('.effects-panel').textContent().catch(() => 'unavailable'));
  console.error('Highlighted cells:', await page?.locator('td[data-gmr-side-effect]').evaluateAll((items) => items.map((cell) => cell.id)).catch(() => []));
  throw error;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
