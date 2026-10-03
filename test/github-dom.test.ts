import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findDiffFiles, readDiffEntries, readDiffLines } from '../src/github-dom.ts';
import { parseMermaidBlocks } from '../src/parse.ts';

const number = (side: 'L' | 'R', n: number | null) => n === null
  ? '<td class="blob-num empty-cell"></td>'
  : `<td class="blob-num" id="diff-test${side}${n}" data-line-number="${n}"></td>`;
const code = (text: string, marker = ' ') => `<td class="blob-code"><span class="blob-code-inner" data-code-marker="${marker}">${text}</span></td>`;
const unified = (left: number | null, right: number | null, text: string, marker = ' ') => `<tr>${number('L', left)}${number('R', right)}${code(text, marker)}</tr>`;
const file = (rows: string) => new JSDOM(`<div class="file"><div class="file-header" data-path="docs/flow.md"></div><table class="diff-table"><tbody>${rows}</tbody></table></div>`).window.document;

test('finds one file per real header and ignores unrelated data-path attributes', () => {
  const doc = file('');
  doc.body.insertAdjacentHTML('beforeend', '<a data-path="wrong.md">wrong</a><div class="file"><div class="file-header" data-path="other.md"></div></div>');
  const files = findDiffFiles(doc);
  assert.deepEqual(files.map(({ path }) => path), ['docs/flow.md', 'other.md']);
  assert.equal(files[0].element.className, 'file');
  assert.equal(files[0].header.getAttribute('data-path'), 'docs/flow.md');
});

test('unified diffs keep the old and new diagrams separate with indentation intact', () => {
  const doc = file([
    unified(1, 1, '```mermaid'),
    unified(2, 2, 'flowchart TD'),
    unified(3, null, '  A --&gt; <span>B</span>', '-'),
    unified(null, 3, '  A --&gt; <span>C</span>', '+'),
    unified(4, 4, '```'),
  ].join(''));
  const lines = readDiffLines(findDiffFiles(doc)[0].element);
  assert.equal(parseMermaidBlocks(lines.before).blocks[0].source, 'flowchart TD\n  A --> B');
  assert.equal(parseMermaidBlocks(lines.after).blocks[0].source, 'flowchart TD\n  A --> C');
  assert.deepEqual(lines.before.map((line) => line.number), [1, 2, 3, 4]);
  assert.deepEqual(lines.after.map((line) => line.number), [1, 2, 3, 4]);
});

test('split diffs map each code cell to the adjacent explicit side', () => {
  const doc = file(`<tr>${number('L', 8)}${code('  old', '-')}${number('R', 9)}${code('  new', '+')}</tr>
    <tr>${number('L', null)}<td class="blob-code empty-cell"></td>${number('R', 10)}${code('+literal', '+')}</tr>`);
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element), {
    before: [{ number: 8, text: '  old' }],
    after: [{ number: 9, text: '  new' }, { number: 10, text: '+literal' }],
  });
});

test('hunk controls, comment text, unnumbered source, and unknown IDs are excluded', () => {
  const doc = file([
    unified(1, 1, '```mermaid'),
    '<tr><td class="blob-num blob-num-hunk">@@</td><td class="blob-code blob-code-hunk">flowchart TD</td></tr>',
    '<tr><td colspan="3"><div class="review-comment">malicious diagram<table><tbody><tr><td class="blob-num" data-line-number="2" id="diff-commentR2"></td><td class="blob-code"><span class="blob-code-inner" data-code-marker="+">injected</span></td></tr></tbody></table></div></td></tr>',
    `<tr><td class="blob-num" data-line-number="2" id="unknown"></td>${code('unknown')}</tr>`,
    unified(4, 4, '```'),
  ].join(''));
  const lines = readDiffLines(findDiffFiles(doc)[0].element);
  assert.deepEqual(lines.before, [{ number: 1, text: '```mermaid' }, { number: 4, text: '```' }]);
  assert.deepEqual(lines.after, lines.before);
  assert.deepEqual(parseMermaidBlocks(lines.after), { blocks: [], incomplete: true });
});

test('blank lines and literal minus/plus source characters survive extraction', () => {
  const doc = file(unified(null, 1, '<br>', '+') + unified(null, 2, '-x + y', '+'));
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element).after, [
    { number: 1, text: '' }, { number: 2, text: '-x + y' },
  ]);
});

test('duplicate source cells do not repeat a line and no DOM nodes are changed', () => {
  const doc = file(unified(1, 1, 'text') + unified(1, 1, 'text'));
  const before = doc.body.innerHTML;
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element), {
    before: [{ number: 1, text: 'text' }], after: [{ number: 1, text: 'text' }],
  });
  assert.equal(doc.body.innerHTML, before);
});

const reactNumber = (side: 'left' | 'right', n: number | null) => `<td class="new-diff-line-number" data-diff-side="${side}"${n === null ? '' : ` data-line-number="${n}"`}></td>`;
const reactCode = (side: 'left' | 'right', n: number | null, text: string, marker = ' ') => `<td class="diff-text-cell" data-diff-side="${side}" data-line-number="${n}" data-diff-line-key="b:1-l:null-r:${n}" data-line-anchor="diff-reactR${n}"><code class="diff-text syntax-highlighted-line"><span class="diff-text-marker">${marker}</span><div class="diff-text-inner">${text}</div></code></td>`;
const reactUnified = (left: number | null, right: number | null, text: string, marker = ' ') => `<tr class="diff-line-row">${reactNumber('left', left)}${reactNumber('right', right)}${reactCode(right === null ? 'left' : 'right', right ?? left, text, marker)}</tr>`;
const reactFile = (rows: string) => new JSDOM(`<div role="region" id="diff-react" aria-labelledby="heading-react"><div data-diff-header-wrapper="true"><h3 id="heading-react"><a href="#diff-react"><code>\u200edocs/flow.md\u200e</code></a></h3></div><table><tbody>${rows}</tbody></table></div>`).window.document;

test('discovers current React file regions and removes GitHub filename direction markers', () => {
  const doc = reactFile('');
  doc.body.insertAdjacentHTML('beforeend', '<div role="region" id="diff-unrelated"><h3><code>not-a-file.md</code></h3></div>');
  const files = findDiffFiles(doc);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'docs/flow.md');
  assert.equal(files[0].element.id, 'diff-react');
  assert.equal(files[0].header.getAttribute('data-diff-header-wrapper'), 'true');
});

test('React unified diffs preserve both revisions and exclude separate marker elements', () => {
  const doc = reactFile([
    reactUnified(5, 5, '```mermaid'),
    reactUnified(6, 6, 'flowchart TD'),
    reactUnified(7, null, '  A --&gt; <span>B</span>', '-'),
    reactUnified(null, 7, '  A --&gt; <span>C</span>', '+'),
    reactUnified(8, 8, '```'),
  ].join(''));
  const lines = readDiffLines(findDiffFiles(doc)[0].element);
  assert.deepEqual(parseMermaidBlocks(lines.before), {
    blocks: [{ source: 'flowchart TD\n  A --> B', startLine: 5, endLine: 8 }], incomplete: false,
  });
  assert.deepEqual(parseMermaidBlocks(lines.after), {
    blocks: [{ source: 'flowchart TD\n  A --> C', startLine: 5, endLine: 8 }], incomplete: false,
  });
});

test('React source requires explicit valid line numbers and known sides', () => {
  const doc = reactFile(`<tr class="diff-line-row"><td class="new-diff-line-number" data-diff-side="unknown" data-line-number="1"></td>${reactCode('right', 1, 'untrusted')}</tr>`
    + reactUnified(null, 3, '<br>', '+') + '<tr><td>review comment ```mermaid</td></tr>');
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element), {
    before: [], after: [{ number: 3, text: '' }],
  });
});

test('React split diffs use explicit sides even when both anchors have an R suffix', () => {
  const doc = reactFile(`<tr class="diff-line-row">${reactNumber('left', 12)}${reactCode('left', 12, '  old', '-')}${reactNumber('right', 15)}${reactCode('right', 15, '  new', '+')}</tr>`
    + `<tr class="diff-line-row">${reactNumber('left', null)}<td class="diff-text-cell left-side-diff-cell" data-diff-side="left"></td>${reactNumber('right', 16)}${reactCode('right', 16, '+literal', '+')}</tr>`);
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element), {
    before: [{ number: 12, text: '  old' }],
    after: [{ number: 15, text: '  new' }, { number: 16, text: '+literal' }],
  });
});

test('React split context without a context class extracts each side independently', () => {
  const doc = reactFile(`<tr class="diff-line-row">${reactNumber('left', 2)}${reactCode('left', 2, 'same')}${reactNumber('right', 5)}${reactCode('right', 5, 'same')}</tr>`);
  assert.deepEqual(readDiffLines(findDiffFiles(doc)[0].element), {
    before: [{ number: 2, text: 'same' }],
    after: [{ number: 5, text: 'same' }],
  });
});

for (const [name, makeFile, makeRow, selector] of [
  ['classic', file, unified, '.blob-code'],
  ['React', reactFile, reactUnified, '.diff-text-cell'],
] as const) {
  test(`${name} unified entries identify changed lines and retain original code cells`, () => {
    const doc = makeFile(makeRow(1, 1, 'same')
      + makeRow(2, null, 'old()', '-') + makeRow(null, 2, 'new()', '+'));
    const element = findDiffFiles(doc)[0].element;
    const original = element.outerHTML;
    const cells = element.querySelectorAll(selector);
    const entries = readDiffEntries(element);
    assert.deepEqual(entries.before, [
      { number: 1, text: 'same', change: 'context', cell: cells[0] },
      { number: 2, text: 'old()', change: 'removed', cell: cells[1] },
    ]);
    assert.deepEqual(entries.after, [
      { number: 1, text: 'same', change: 'context', cell: cells[0] },
      { number: 2, text: 'new()', change: 'added', cell: cells[2] },
    ]);
    assert.equal(entries.before[0].cell, entries.after[0].cell);
    assert.equal(element.outerHTML, original);
  });

  test(`${name} does not infer changes from source characters or contradictory markers`, () => {
    const doc = makeFile(makeRow(1, null, 'fetch()', '+')
      + makeRow(null, 2, 'save()', '-')
      + makeRow(null, 3, '+literal()', '?')
      + makeRow(4, 4, '-literal()'));
    const entries = readDiffEntries(findDiffFiles(doc)[0].element);
    assert.deepEqual(entries.before.map(({ number, change }) => ({ number, change })), [
      { number: 1, change: 'unknown' }, { number: 4, change: 'context' },
    ]);
    assert.deepEqual(entries.after.map(({ number, change }) => ({ number, change })), [
      { number: 2, change: 'unknown' }, { number: 3, change: 'unknown' },
      { number: 4, change: 'context' },
    ]);
  });
}

test('classic split entries distinguish changed and context cells on the same side', () => {
  const doc = file(`<tr>${number('L', 8)}${code('old()', '-')}${number('R', 9)}${code('new()', '+')}</tr>`
    + `<tr>${number('L', 10)}${code('same()')}${number('R', 11)}${code('same()')}</tr>`);
  const cells = doc.querySelectorAll('.blob-code');
  const entries = readDiffEntries(findDiffFiles(doc)[0].element);
  assert.deepEqual(entries.before.map(({ change, cell }) => ({ change, cell })), [
    { change: 'removed', cell: cells[0] }, { change: 'context', cell: cells[2] },
  ]);
  assert.deepEqual(entries.after.map(({ change, cell }) => ({ change, cell })), [
    { change: 'added', cell: cells[1] }, { change: 'context', cell: cells[3] },
  ]);
});

test('React split entries preserve each side even with misleading line anchors', () => {
  const doc = reactFile(`<tr class="diff-line-row">${reactNumber('left', 8)}${reactCode('left', 8, 'old()', '-')}${reactNumber('right', 9)}${reactCode('right', 9, 'new()', '+')}</tr>`
    + `<tr class="diff-line-row">${reactNumber('left', 10)}${reactCode('left', 10, 'same()')}${reactNumber('right', 11)}${reactCode('right', 11, 'same()')}</tr>`);
  const cells = doc.querySelectorAll('.diff-text-cell');
  const entries = readDiffEntries(findDiffFiles(doc)[0].element);
  assert.deepEqual(entries.before.map(({ change, cell }) => ({ change, cell })), [
    { change: 'removed', cell: cells[0] }, { change: 'context', cell: cells[2] },
  ]);
  assert.deepEqual(entries.after.map(({ change, cell }) => ({ change, cell })), [
    { change: 'added', cell: cells[1] }, { change: 'context', cell: cells[3] },
  ]);
});

test('missing React markers remain unknown and nested comment tables never become source entries', () => {
  const doc = reactFile(reactUnified(null, 1, 'valid()', '+')
    + '<tr><td colspan="3"><div class="review-comment"><table><tbody>'
    + reactUnified(null, 2, 'comment.save()', '+') + '</tbody></table></div></td></tr>'
    + reactUnified(null, 3, 'unmarked()', '+'));
  doc.querySelectorAll('.diff-text-marker')[2].remove();
  const entries = readDiffEntries(findDiffFiles(doc)[0].element);
  assert.deepEqual(entries.before, []);
  assert.deepEqual(entries.after.map(({ number, text, change }) => ({ number, text, change })), [
    { number: 1, text: 'valid()', change: 'added' },
    { number: 3, text: 'unmarked()', change: 'unknown' },
  ]);
});

test('entry extraction excludes unknown source DOM and nested classic diff-shaped tables', () => {
  const doc = file(unified(null, 1, 'valid()', '+')
    + `<tr>${number('R', 2)}<td class="blob-code">unknown.save()</td></tr>`
    + '<tr><td colspan="3"><div class="review-comment"><table class="diff-table"><tbody>'
    + unified(null, 3, 'comment.save()', '+') + '</tbody></table></div></td></tr>');
  const entries = readDiffEntries(findDiffFiles(doc)[0].element);
  assert.deepEqual(entries.before, []);
  assert.deepEqual(entries.after.map(({ number, text, change }) => ({ number, text, change })), [
    { number: 1, text: 'valid()', change: 'added' },
  ]);
});
