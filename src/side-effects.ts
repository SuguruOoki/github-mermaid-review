import type { ChangedSourceLine, DiffSide, EffectCategory, SideEffectCandidate, SourceStreams } from './types.ts';

type Language = 'js' | 'php' | 'python';
interface EffectRule {
  category: EffectCategory;
  pattern: RegExp;
}
interface LexicalState {
  mode: 'block' | 'string' | null;
  delimiter: string;
  heredoc: string | null;
}

/**
 * Best-effort review hints, not proof of effects or purity. Only visible changed
 * lines are reported. Context lines maintain lexical state; known multiline
 * strings/comments survive gaps, but an opener hidden in a gap is unknowable.
 * No source is evaluated. Aliases, template interpolation, calls split over
 * lines and language/type semantics are intentionally outside this detector.
 */
const LANGUAGES = new Map<string, Language>([
  ...['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'].map((extension): [string, Language] => [extension, 'js']),
  ['php', 'php'], ['py', 'python'],
]);

function languageFor(path: unknown): Language | undefined {
  return typeof path === 'string' ? LANGUAGES.get(path.split('.').at(-1)?.toLowerCase() ?? '') : undefined;
}

export function supportsSideEffectFile(path: unknown): boolean {
  return Boolean(languageFor(path));
}

// Boundaries exclude receiver suffixes (e.g. mock.fetch and unrelated.db.update).
// Receiver identity can still be shadowed; the UI must call every match a hint.
const boundary = '(?<![\\w$.])';
const call = '\\s*(?:\\?\\.\\s*)?\\(';
const dot = '\\s*(?:\\?\\.|\\.)\\s*';
const assignment = '(?:=(?!=|>)|(?:\\*\\*|>>>|>>|<<|&&|\\|\\||\\?\\?|[+*/%&|^-])=|\\+\\+|--)';
const property = '(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*|\\s*\\[[^\\]\\n]*\\])';

function rule(category: EffectCategory, pattern: string): EffectRule {
  return { category, pattern: new RegExp(boundary + pattern, 'g') };
}

const RULES: Record<Language, EffectRule[]> = {
  js: [
    rule('persistence', `(?:localStorage|sessionStorage)${dot}(?:setItem|removeItem|clear)${call}`),
    rule('persistence', `(?:fs(?:${dot}promises)?|fsPromises)${dot}(?:writeFile(?:Sync)?|appendFile(?:Sync)?|unlink(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|mkdir(?:Sync)?|rename(?:Sync)?|copyFile(?:Sync)?|truncate(?:Sync)?|chmod(?:Sync)?|chown(?:Sync)?|symlink(?:Sync)?|link(?:Sync)?)${call}`),
    rule('persistence', `(?:writeFile(?:Sync)?|appendFile(?:Sync)?)${call}`),
    rule('persistence', `(?:prisma|db)(?:${dot}[A-Za-z_$][\\w$]*)?${dot}(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|insert|insertInto|deleteFrom)${call}`),
    rule('network', `(?:(?:window|globalThis)${dot})?fetch${call}`),
    rule('network', `axios(?:${dot}(?:request|get|post|put|patch|delete|head|options))?${call}`),
    rule('network', `(?:http|https)${dot}(?:request|get)${call}`),
    rule('network', `navigator${dot}sendBeacon${call}`),
    rule('network', `(?:socket|ws)${dot}(?:send|emit)${call}`),
    rule('network', `(?:mailer|transport)${dot}sendMail${call}`),
    rule('network', `new\\s+WebSocket${call}`),
    rule('state', `(?:this|globalThis|window|document|store)${property}+\\s*${assignment}`),
    rule('state', `(?:this${dot})?setState${call}`),
    rule('state', `store${dot}(?:dispatch|commit|replaceState)${call}`),
    rule('state', `document(?:${dot}(?:body|head|documentElement))?${dot}(?:write|writeln|append|prepend|appendChild|removeChild|replaceChild|replaceChildren|setAttribute|removeAttribute)${call}`),
    rule('state', `Object${dot}assign\\s*\\(\\s*(?:this|globalThis|window|document|store)\\s*,`),
    rule('state', `delete\\s+(?:this|globalThis|window|document|store)${property}+`),
  ],
  php: [
    rule('persistence', `(?:file_put_contents|fwrite|fputs|unlink|rename|mkdir|rmdir|chmod|chown|copy|touch|ftruncate)${call}`),
    rule('persistence', `(?:DB|Storage)\\s*::\\s*(?:(?:table|disk)\\s*\\([^()\\n]*\\)\\s*->\\s*)?(?:insert|insertOrIgnore|update|updateOrInsert|upsert|delete|put|putFile|putFileAs|append|prepend|move|copy|makeDirectory|deleteDirectory)${call}`),
    rule('persistence', `\\$db\\s*->\\s*(?:insert|update|delete|commit|rollback)${call}`),
    rule('network', `(?:curl_exec|curl_multi_exec|mail)${call}`),
    rule('network', `Http\\s*::\\s*(?:get|post|put|patch|delete|head|send)${call}`),
    rule('network', `Mail\\s*::\\s*(?:send|raw|html|queue|later)${call}`),
    rule('network', `\\$httpClient\\s*->\\s*(?:request|send|get|post|put|patch|delete)${call}`),
    rule('state', `\\$this(?:\\s*->\\s*[A-Za-z_][\\w]*|\\s*\\[[^\\]\\n]*\\])+\\s*${assignment}`),
    rule('state', `(?:self|static)\\s*::\\s*\\$[A-Za-z_][\\w]*(?:\\s*\\[[^\\]\\n]*\\])*\\s*${assignment}`),
    rule('state', `\\$GLOBALS\\s*\\[[^\\]\\n]*\\]\\s*${assignment}`),
  ],
  python: [
    rule('persistence', `(?:os${dot}(?:remove|unlink|rename|replace|mkdir|makedirs|rmdir|removedirs|chmod|chown)|shutil${dot}(?:copy|copy2|copyfile|copytree|move|rmtree))${call}`),
    rule('persistence', `(?:(?:pathlib${dot})?Path\\s*\\([^()\\n]*\\)|path)${dot}(?:write_text|write_bytes|unlink|mkdir|rmdir|rename|replace|touch)${call}`),
    rule('persistence', `(?:db|session)${dot}(?:commit|rollback|add|add_all|delete|bulk_save_objects|bulk_insert_mappings|bulk_update_mappings)${call}`),
    rule('network', `(?:requests|httpx|aiohttp)${dot}(?:request|get|post|put|patch|delete|head|options)${call}`),
    rule('network', `urllib${dot}request${dot}(?:urlopen|urlretrieve)${call}`),
    rule('network', `(?:smtp|smtp_client)${dot}(?:sendmail|send_message)${call}`),
    rule('state', `self${property}+\\s*${assignment}`),
    rule('state', 'setattr\\s*\\(\\s*self\\s*,'),
    rule('state', 'globals\\s*\\(\\s*\\)\\s*\\.\\s*update\\s*\\('),
  ],
};

/** Mask literals/comments without changing UTF-16 offsets used for evidence. */
function visibleCode(text: string, language: Language, state: LexicalState): string {
  const visible = text.split('');
  const hide = (from: number, to: number): void => { for (let cursor = from; cursor < to; cursor += 1) visible[cursor] = ' '; };
  let index = 0;
  let canStartRegex = true;

  if (state.heredoc) {
    hide(0, text.length);
    if (text.trim().replace(/;$/, '') === state.heredoc) state.heredoc = null;
    return visible.join('');
  }

  while (index < text.length) {
    if (state.mode === 'block') {
      const end = text.indexOf('*/', index);
      hide(index, end < 0 ? text.length : end + 2);
      if (end < 0) break;
      state.mode = null;
      index = end + 2;
      continue;
    }
    if (state.mode === 'string') {
      const start = index;
      let ended = false;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text.startsWith(state.delimiter, index)) {
          index += state.delimiter.length;
          state.mode = null;
          ended = true;
          break;
        }
        index += 1;
      }
      hide(start, Math.min(index, text.length));
      // JS/Python ordinary strings only continue with a backslash; PHP permits
      // newlines. Triple quoted strings and templates always retain their scope.
      if (!ended && language !== 'php' && state.delimiter.length === 1 && state.delimiter !== '`' && !/(?:^|[^\\])(?:\\\\)*\\$/.test(text)) state.mode = null;
      canStartRegex = false;
      continue;
    }

    if ((language !== 'python' && text.startsWith('//', index)) || (language !== 'js' && text[index] === '#' && !(language === 'php' && text.startsWith('#[', index)))) {
      hide(index, text.length);
      break;
    }
    if (language !== 'python' && text.startsWith('/*', index)) {
      state.mode = 'block';
      hide(index, index + 2);
      index += 2;
      continue;
    }
    if (language === 'php' && text.startsWith('<<<', index)) {
      const opening = text.slice(index).match(/^<<<[ \t]*['"]?([A-Za-z_]\w*)['"]?[ \t]*$/);
      if (opening) {
        state.heredoc = opening[1];
        hide(index, text.length);
        break;
      }
    }
    if (text[index] === '"' || text[index] === "'" || (language !== 'python' && text[index] === '`')) {
      state.delimiter = language === 'python' && text.startsWith(text[index].repeat(3), index) ? text[index].repeat(3) : text[index];
      state.mode = 'string';
      hide(index, index + state.delimiter.length);
      index += state.delimiter.length;
      continue;
    }
    if (language === 'js' && text[index] === '/' && canStartRegex) {
      const start = index++;
      let characterClass = false;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === '[') characterClass = true;
        if (text[index] === ']') characterClass = false;
        if (text[index] === '/' && !characterClass) { index += 1; break; }
        index += 1;
      }
      hide(start, Math.min(index, text.length));
      canStartRegex = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(text[index])) {
      const start = index++;
      while (index < text.length && /[\w$]/.test(text[index])) index += 1;
      canStartRegex = /^(?:return|throw|yield|case|delete|typeof|void|new|in|of|await)$/.test(text.slice(start, index));
      continue;
    }
    if (!/\s/.test(text[index])) canStartRegex = /[=(:,;!&|?{}\[+*%~^-]/.test(text[index]);
    index += 1;
  }
  return visible.join('');
}

export function detectSideEffects(entries: Partial<SourceStreams<ChangedSourceLine>> | undefined, path: unknown): SideEffectCandidate[] {
  const language = languageFor(path);
  if (!language) return [];
  const results: SideEffectCandidate[] = [];
  for (const side of ['before', 'after'] satisfies DiffSide[]) {
    const state: LexicalState = { mode: null, delimiter: '', heredoc: null };
    const seen = new Set<string>();
    for (const line of entries?.[side] ?? []) {
      if (!Number.isSafeInteger(line.number) || line.number <= 0 || typeof line.text !== 'string') continue;
      const code = visibleCode(line.text, language, state);
      if (line.change !== (side === 'before' ? 'removed' : 'added')) continue;
      for (const { category, pattern } of RULES[language]) {
        const key = `${line.number}:${category}`;
        if (seen.has(key)) continue;
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(code))) {
          // A known function's declaration is not its invocation.
          if (/(?:function\s*\*?|def)\s*$/.test(code.slice(0, match.index))) continue;
          seen.add(key);
          results.push({ side, number: line.number, category, evidence: match[0].replace(/\s+/g, ' ').trim().slice(0, 100) });
          break;
        }
      }
    }
  }
  return results;
}
