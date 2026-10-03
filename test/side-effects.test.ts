import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChangedSourceLine, ChangeKind, SourceStreams } from '../src/types.ts';
import { detectSideEffects, supportsSideEffectFile } from '../src/side-effects.ts';

const lines = (source: string, change: ChangeKind = 'added', start = 1): ChangedSourceLine[] => source.split('\n').map((text, index) => ({ number: start + index, text, change }));
const detect = (source: string, path: unknown = 'src/example.ts') => detectSideEffects({ after: lines(source) }, path);
const categories = (source: string, path?: string) => detect(source, path).map(({ number, category }) => [number, category]);

test('supports JS/TS, PHP and Python files including tests, but not prose or unrelated extensions', () => {
  for (const extension of ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'php', 'py']) assert.equal(supportsSideEffectFile(`src/a.test.${extension}`), true);
  for (const path of ['README.md', 'docs.mdx', 'a.rs', 'src/noextension', '', null]) {
    assert.equal(supportsSideEffectFile(path), false);
    assert.deepEqual(detect('fetch(url)', path), []);
  }
});

test('finds concrete persistence, communication and explicit state changes', () => {
  assert.deepEqual(categories([
    'await prisma.user.update({ where, data });',
    'fs.promises.writeFile(path, contents);',
    'localStorage.setItem("key", value);',
    'await fetch("/api"); axios.get(url);',
    'this.status = "ready";',
    'store.dispatch(action);',
    'document.body.appendChild(node);',
    'globalThis.counter += 1;',
    'this.cache[key] ??= value;',
    'Object.assign(this, changes);',
    'delete window.cache;',
  ].join('\n')), [[1, 'persistence'], [2, 'persistence'], [3, 'persistence'], [4, 'network'], [5, 'state'], [6, 'state'], [7, 'state'], [8, 'state'], [9, 'state'], [10, 'state'], [11, 'state']]);
});

test('does not label ordinary assignment, reads, arbitrary save/set methods or mere API names', () => {
  assert.deepEqual(detect([
    'const value = input + 1;',
    'result.save(); result.set("key", value);',
    'prisma.user.findMany(); localStorage.getItem("key"); fs.readFile(path);',
    'const callback = fetch; const name = this.status;',
    'if (this.value === value || window.counter >= 5) return;',
    'const copy = { value: this.value };',
    'mock.fetch(url); unrelated.db.update(input);',
    'function fetch(url) {}',
    'export async function writeFile(path, value) {}',
  ].join('\n')), []);
});

test('each category appears once per changed line and evidence names the matched syntax', () => {
  assert.deepEqual(detect('fetch(a); fetch(b); this.value = 1; this.other = 2;'), [
    { side: 'after', number: 1, category: 'network', evidence: 'fetch(' },
    { side: 'after', number: 1, category: 'state', evidence: 'this.value =' },
  ]);
});

test('comparisons do not change state, while bit-shift assignments do', () => {
  for (const [path, target] of [['a.ts', 'this.count'], ['a.py', 'self.count'], ['a.php', '$this->count']]) {
    assert.deepEqual(detect(`${target} <= limit; ${target} >= limit;`, path), []);
    assert.deepEqual(categories(`${target} <<= 1;\n${target} >>= 1;`, path), [[1, 'state'], [2, 'state']]);
  }
  assert.deepEqual(categories('this.flags >>>= 1;'), [[1, 'state']]);
});

test('only changed lines are emitted and each side has its own source and lexical state', () => {
  const entries = {
    before: [ ...lines('/*', 'context'), ...lines('fetch(oldUrl);', 'removed', 2), ...lines('*/', 'context', 3), ...lines('fs.unlink(oldPath);', 'removed', 4) ],
    after: [ ...lines('fetch(url);', 'context'), ...lines('fetch(newUrl);', 'added', 2), ...lines('this.value = 1', 'unknown', 3) ],
  };
  assert.deepEqual(detectSideEffects(entries, 'test.js').map(({ side, number, category }) => [side, number, category]), [
    ['before', 4, 'persistence'], ['after', 2, 'network'],
  ]);
  assert.deepEqual(detectSideEffects({ before: lines('fetch(url)', 'added'), after: lines('fetch(url)', 'removed') }, 'a.ts'), []);
});

test('comments, quoted strings, templates and regex literals do not produce hints', () => {
  assert.deepEqual(detect([
    '// fetch(url); this.value = 1;',
    'const a = "fetch(url); this.value = 1;";',
    "const b = 'localStorage.setItem(k,v)';",
    '/* axios.post(url);',
    'this.value = 1;',
    '*/',
    'const template = `fetch(url)',
    'this.value = 1; ${fetch(url)}`;',
    'const pattern = /fetch\(url\); this.value = 1/;',
    'return /this.value = 1/;',
  ].join('\n')), []);
  assert.deepEqual(categories('"fetch(url)"; fetch(real); /* ignored */ this.value = 1;'), [[1, 'network'], [1, 'state']]);
});

test('known multiline comment scope survives missing context and a visible terminator resumes detection', () => {
  const entries = { after: [ ...lines('/* docs', 'context'), ...lines('fetch(url);', 'added', 30), ...lines('*/ fetch(real);', 'added', 31) ] };
  assert.deepEqual(detectSideEffects(entries, 'a.ts').map(({ number, category }) => [number, category]), [[31, 'network']]);
});

test('PHP detects writes, HTTP sends and instance/static/global mutations', () => {
  assert.deepEqual(categories([
    '<?php',
    'file_put_contents($path, $value);',
    'DB::table("users")->update($values);',
    'Storage::disk("s3")->put($key, $value);',
    'Http::post($url, $data);',
    'curl_exec($handle);',
    '$this->status = "ready";',
    'self::$count += 1;',
    '$GLOBALS["enabled"] = true;',
    '$result->save(); $result->set($key, $value);',
  ].join('\n'), 'handler.php'), [[2, 'persistence'], [3, 'persistence'], [4, 'persistence'], [5, 'network'], [6, 'network'], [7, 'state'], [8, 'state'], [9, 'state']]);
});

test('PHP heredoc, nowdoc, hash comments and multiline quoted strings are hidden', () => {
  assert.deepEqual(categories([
    '$text = <<<TEXT',
    'file_put_contents($p, $v);',
    'TEXT;',
    "$text = <<<'NOWDOC'",
    'Http::post($url);',
    'NOWDOC;',
    '# $this->status = 1;',
    "$text = 'begin",
    '$this->status = 1;',
    "end';",
    '$this->status = 2;',
  ].join('\n'), 'a.php'), [[11, 'state']]);
});

test('Python detects known file/database writes, network requests and self state', () => {
  assert.deepEqual(categories([
    'requests.get(url)',
    'httpx.post(url, data=value)',
    'Path("output.txt").write_text(value)',
    'os.remove(path)',
    'session.commit()',
    'self.status = "ready"',
    'setattr(self, "status", value)',
    'globals().update(values)',
    'value = 1',
    'result.save()',
  ].join('\n'), 'a.py'), [[1, 'network'], [2, 'network'], [3, 'persistence'], [4, 'persistence'], [5, 'persistence'], [6, 'state'], [7, 'state'], [8, 'state']]);
});

test('Python multiline strings, docstrings, comments and ordinary strings are hidden', () => {
  assert.deepEqual(categories([
    '# requests.get(url)',
    '"""requests.get(url)',
    'self.status = 1',
    '"""',
    "value = r'''os.remove(path)",
    'session.commit()',
    "'''",
    'value = "self.status = 1"',
    'self.status = 2',
  ].join('\n'), 'a.py'), [[9, 'state']]);
  assert.deepEqual(detect('#[ requests.post("/api")\n#[ self.value = 1', 'a.py'), []);
});

test('a long line is scanned without silently discarding its final operation', () => {
  assert.deepEqual(categories(`${' '.repeat(60_000)}fetch(url);`), [[1, 'network']]);
  assert.deepEqual(detect(`fetch${' '.repeat(60_000)}`), []);
});

test('invalid line metadata is ignored and input objects stay unchanged', () => {
  const entries = { before: [], after: [...lines('fetch(url)'), { number: 0, text: 'fetch(url)', change: 'added' }, { number: 2, text: null, change: 'added' }] };
  const copy = structuredClone(entries);
  assert.equal(detectSideEffects(entries as unknown as SourceStreams<ChangedSourceLine>, 'a.js').length, 1);
  assert.deepEqual(entries, copy);
  assert.deepEqual(detectSideEffects(undefined, 'a.js'), []);
});
