import type { MermaidBlock, SourceLine } from './types.ts';

interface Fence {
  character: string;
  length: number;
  mermaid: boolean;
  contiguous: boolean;
  startLine: number;
  lines: string[];
}

export interface MermaidParseResult {
  blocks: MermaidBlock[];
  incomplete: boolean;
}

/**
 * Parse visible source lines in their existing order. A block must have both
 * fences inside one contiguous run of positive line numbers. Missing lines are
 * never guessed. startLine/endLine include the fences; source preserves spaces.
 * Known fence scope survives gaps until a matching close is visible. Incomplete
 * is true when a Mermaid block has a gap or has no visible closing fence.
 * An enclosing fence whose opener is entirely hidden cannot be detected here.
 */
export function parseMermaidBlocks(lines: readonly SourceLine[]): MermaidParseResult {
  const blocks: MermaidBlock[] = [];
  let incomplete = false;
  let fence: Fence | null = null;
  let previousNumber: number | null = null;

  for (const line of lines) {
    const valid = Number.isSafeInteger(line.number) && line.number > 0 && typeof line.text === 'string';
    if (!valid || (previousNumber !== null && line.number !== previousNumber + 1)) {
      if (fence?.mermaid) incomplete = true;
      if (fence) {
        fence.contiguous = false;
        fence.lines = [];
      }
    }
    if (!valid) {
      previousNumber = null;
      continue;
    }
    previousNumber = line.number;

    if (fence) {
      const closing = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        if (fence.mermaid && fence.contiguous) {
          blocks.push({ source: fence.lines.join('\n'), startLine: fence.startLine, endLine: line.number });
        }
        fence = null;
      } else if (fence.mermaid && fence.contiguous) {
        fence.lines.push(line.text);
      }
      continue;
    }

    const opening = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) continue;
    const language = opening[2].trim().split(/[ \t]+/)[0].toLowerCase();
    fence = {
      character: opening[1][0],
      length: opening[1].length,
      mermaid: language === 'mermaid',
      contiguous: true,
      startLine: line.number,
      lines: [],
    };
  }

  if (fence?.mermaid) incomplete = true;
  return { blocks, incomplete };
}
