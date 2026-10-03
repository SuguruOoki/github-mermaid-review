import test from 'node:test';
import assert from 'node:assert/strict';
import type { SourceLine } from '../src/types.ts';
import { parseMermaidBlocks } from '../src/parse.ts';

const numbered = (source: string, start = 1) => source.split('\n').map((text, index) => ({ number: start + index, text }));

test('extracts multiple complete diagrams with exact source indentation and fence line range', () => {
  const lines = numbered('Intro\n```mermaid\nflowchart TD\n  A --> B\n```\ntext\n~~~mermaid\nsequenceDiagram\n  A->>B: hello\n~~~~', 7);
  assert.deepEqual(parseMermaidBlocks(lines), {
    blocks: [
      { source: 'flowchart TD\n  A --> B', startLine: 8, endLine: 11 },
      { source: 'sequenceDiagram\n  A->>B: hello', startLine: 13, endLine: 16 },
    ],
    incomplete: false,
  });
});

test('never stitches a diagram across hidden context or non-monotonic line numbers', () => {
  for (const endNumber of [5, 2, 1]) {
    assert.deepEqual(parseMermaidBlocks([
      { number: 1, text: '```mermaid' },
      { number: 2, text: 'flowchart TD' },
      { number: endNumber, text: '```' },
    ]), { blocks: [], incomplete: true });
  }
});

test('a fresh complete block after the incomplete block closes still renders', () => {
  assert.deepEqual(parseMermaidBlocks([
    ...numbered('```mermaid\nflowchart TD'),
    ...numbered('```\n```mermaid\nflowchart LR\nB --> C\n```', 10),
  ]), {
    blocks: [{ source: 'flowchart LR\nB --> C', startLine: 11, endLine: 14 }],
    incomplete: true,
  });
});

test('ignores Mermaid examples nested inside a longer non-Mermaid fence', () => {
  assert.deepEqual(parseMermaidBlocks(numbered('````markdown\n```mermaid\nA --> B\n```\n````')), {
    blocks: [], incomplete: false,
  });
});

test('a gap inside a known outer fence does not turn a nested example into a diagram', () => {
  assert.deepEqual(parseMermaidBlocks([
    { number: 1, text: '````markdown' },
    ...numbered('```mermaid\ngraph TD\nA --> B\n```', 20),
  ]), { blocks: [], incomplete: false });
});

test('a visible outer closing fence restores parsing after missing context', () => {
  assert.deepEqual(parseMermaidBlocks([
    { number: 1, text: '~~~~markdown' },
    ...numbered('~~~mermaid\ngraph TD\nA --> B\n~~~\n~~~~\n```mermaid\ngraph LR\nC --> D\n```', 20),
  ]), {
    blocks: [{ source: 'graph LR\nC --> D', startLine: 25, endLine: 28 }],
    incomplete: false,
  });
});

test('a gap in a Mermaid block discards its remainder until the matching close', () => {
  assert.deepEqual(parseMermaidBlocks([
    { number: 1, text: '````mermaid' },
    ...numbered('```mermaid\ngraph TD\nA --> B\n```\n````\n```mermaid\ngraph LR\nC --> D\n```', 20),
  ]), {
    blocks: [{ source: 'graph LR\nC --> D', startLine: 25, endLine: 28 }],
    incomplete: true,
  });
});

test('a gap outside known fences permits a complete visible block', () => {
  assert.deepEqual(parseMermaidBlocks([
    { number: 1, text: 'Intro' },
    ...numbered('```mermaid\ngraph TD\nA --> B\n```', 20),
  ]), {
    blocks: [{ source: 'graph TD\nA --> B', startLine: 20, endLine: 23 }],
    incomplete: false,
  });
});

test('only same-character closing fences of sufficient length close the diagram', () => {
  assert.deepEqual(parseMermaidBlocks(numbered('````mermaid\nflowchart LR\n```\n~~~\nA --> B\n`````')), {
    blocks: [{ source: 'flowchart LR\n```\n~~~\nA --> B', startLine: 1, endLine: 6 }],
    incomplete: false,
  });
});

test('unknown languages and inline or indented-code fence text do not create diagrams', () => {
  assert.deepEqual(parseMermaidBlocks(numbered('`mermaid`\n    ```mermaid\n```javascript\n```mermaid\n```\n~~~text\n~~~')), {
    blocks: [], incomplete: false,
  });
});

test('accepts fence info and up to three leading spaces without changing diagram indentation', () => {
  assert.deepEqual(parseMermaidBlocks(numbered('  ```Mermaid title\n  graph TD\n    A --> B\n  ```')), {
    blocks: [{ source: '  graph TD\n    A --> B', startLine: 1, endLine: 4 }],
    incomplete: false,
  });
});

test('invalid source lines break runs and are not silently concatenated', () => {
  assert.deepEqual(parseMermaidBlocks([
    { number: 1, text: '~~~mermaid' },
    { number: 2, text: null } as unknown as SourceLine,
    { number: 3, text: '~~~' },
  ]), { blocks: [], incomplete: true });
});

test('does not mutate the caller-owned lines', () => {
  const lines = numbered('```mermaid\nA --> B\n```');
  const original = structuredClone(lines);
  lines.forEach(Object.freeze);
  Object.freeze(lines);
  parseMermaidBlocks(lines);
  assert.deepEqual(lines, original);
});
