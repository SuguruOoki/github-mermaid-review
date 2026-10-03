import type { ChangeKind, DiffEntry, DiffFile, DiffSide, SourceLine, SourceStreams } from './types.ts';

interface LineLocation {
  side: DiffSide;
  number: number;
}

/**
 * Discover classic and React GitHub diff containers, including collapsed files. Path and
 * header come from GitHub's explicit file metadata, not comment text or links.
 * Unknown DOM shapes are ignored rather than treated as source code.
 */
export function findDiffFiles(root: Document | Element = document): DiffFile[] {
  const headers = [...root.querySelectorAll('.file-header[data-path]')];
  if ('matches' in root && root.matches('.file-header[data-path]')) headers.unshift(root);
  const seen = new Set<Element>();
  const files = headers.flatMap((header) => {
    const element = header.closest('.file');
    const path = header.getAttribute('data-path');
    if (!element || !path || seen.has(element)) return [];
    seen.add(element);
    return [{ element, header, path }];
  });
  const regions = [...root.querySelectorAll('[role="region"][id^="diff-"]')];
  if ('matches' in root && root.matches('[role="region"][id^="diff-"]')) regions.unshift(root);
  for (const element of regions) {
    if (seen.has(element)) continue;
    const header = element.querySelector('[data-diff-header-wrapper="true"]');
    const link = [...(header?.querySelectorAll('h3 a[href]') ?? [])]
      .find((anchor) => anchor.getAttribute('href') === `#${element.id}`);
    // GitHub wraps filenames in LRM characters to keep their visual direction.
    const path = link?.querySelector('code')?.textContent.replace(/^\u200e+|\u200e+$/g, '');
    if (!header || !path) continue;
    seen.add(element);
    files.push({ element, header, path });
  }
  return files;
}

function readNumber(cell: Element | null | undefined): LineLocation | null {
  if (!cell?.matches('td.blob-num[data-line-number]')) return null;
  const number = Number(cell.getAttribute('data-line-number'));
  const match = cell.id.match(/([LR])(\d+)$/);
  if (!match || Number(match[2]) !== number || !Number.isSafeInteger(number) || number < 1) return null;
  return { side: match[1] === 'L' ? 'before' : 'after', number };
}

function readReactNumber(cell: Element | null | undefined): LineLocation | null {
  if (!cell?.matches('td.new-diff-line-number[data-line-number]')) return null;
  const number = Number(cell.getAttribute('data-line-number'));
  const side = cell.getAttribute('data-diff-side');
  if (!Number.isSafeInteger(number) || number < 1 || (side !== 'left' && side !== 'right')) return null;
  return { side: side === 'left' ? 'before' : 'after', number };
}

function readChange(side: DiffSide, marker: string | null): ChangeKind {
  if (marker === '+') return side === 'after' ? 'added' : 'unknown';
  if (marker === '-') return side === 'before' ? 'removed' : 'unknown';
  if (marker !== null && /^[ \t]*$/.test(marker)) return 'context';
  return 'unknown';
}

/**
 * Read numbered source cells without mutating GitHub's DOM. Each entry retains
 * its original code cell; unified context entries on both sides share that cell.
 * Only an explicit marker consistent with the numbered side denotes a change.
 * Comments, controls, empty split cells, and inferred hidden lines are excluded.
 */
export function readDiffEntries(element: Element): SourceStreams<DiffEntry> {
  const result: SourceStreams<DiffEntry> = { before: [], after: [] };
  const seen: Record<DiffSide, Set<number>> = { before: new Set(), after: new Set() };
  const append = (location: LineLocation | null, text: string, marker: string | null, cell: HTMLTableCellElement): void => {
    if (!location || seen[location.side].has(location.number)) return;
    seen[location.side].add(location.number);
    result[location.side].push({ number: location.number, text,
      change: readChange(location.side, marker), cell });
  };

  for (const row of element.querySelectorAll('table.diff-table tr')) {
    // A review comment can itself contain a table. Its rows are not diff rows.
    if (!row.closest('table')?.matches('table.diff-table')) continue;
    if (element.contains(row.parentElement?.closest('tr') ?? null)) continue;
    const cells = [...row.children].filter((cell): cell is HTMLTableCellElement => cell.matches('td'));
    const codeCells = cells.filter((cell) => cell.matches('.blob-code'));
    for (const code of codeCells) {
      const source = code.matches('.blob-code-inner[data-code-marker]')
        ? code
        : code.querySelector('.blob-code-inner[data-code-marker]');
      if (!source || source.closest('td') !== code) continue;
      const text = source.textContent;
      const marker = source.getAttribute('data-code-marker');
      if (codeCells.length === 1) {
        // Unified rows share their source cell between the explicitly numbered sides.
        for (const cell of cells) append(readNumber(cell), text, marker, code);
      } else {
        // Split rows keep each code cell next to its own line-number cell.
        append(readNumber(code.previousElementSibling), text, marker, code);
      }
    }
  }

  for (const row of element.querySelectorAll('tr.diff-line-row')) {
    if (element.contains(row.parentElement?.closest('tr') ?? null)) continue;
    const cells = [...row.children].filter((cell): cell is HTMLTableCellElement => cell.matches('td'));
    const codeCells = cells.filter((cell) => cell.matches('.diff-text-cell'));
    for (const code of codeCells) {
      const source = code.querySelector('code.diff-text > .diff-text-inner');
      if (!source || source.closest('td') !== code) continue;
      const marker = source.parentElement?.querySelector(':scope > .diff-text-marker')?.textContent ?? null;
      if (codeCells.length === 1) {
        for (const cell of cells) append(readReactNumber(cell), source.textContent, marker, code);
      } else {
        const side = code.getAttribute('data-diff-side');
        const numberCell = cells.find((cell) => cell.matches('.new-diff-line-number')
          && cell.getAttribute('data-diff-side') === side);
        append(readReactNumber(numberCell), source.textContent, marker, code);
      }
    }
  }
  return result;
}

/**
 * Return the independent before/after source streams used by Mermaid parsing.
 * DOM order, indentation, and number gaps are preserved; DOM metadata stays local.
 */
export function readDiffLines(element: Element): SourceStreams {
  const entries = readDiffEntries(element);
  const sourceLine = ({ number, text }: DiffEntry): SourceLine => ({ number, text });
  return { before: entries.before.map(sourceLine), after: entries.after.map(sourceLine) };
}
