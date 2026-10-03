export interface SourceLine {
  number: number;
  text: string;
}

export type DiffSide = 'before' | 'after';
export type ChangeKind = 'added' | 'removed' | 'context' | 'unknown';
export interface ChangedSourceLine extends SourceLine {
  change: ChangeKind;
}
export interface SourceStreams<T = SourceLine> {
  before: T[];
  after: T[];
}
export interface DiffEntry extends ChangedSourceLine {
  cell: HTMLTableCellElement;
}
export interface DiffFile {
  element: Element;
  header: Element;
  path: string;
}

export interface MermaidBlock {
  source: string;
  startLine: number;
  endLine: number;
}
export type Theme = 'light' | 'dark';
export interface RenderMessage extends SourceStreams<MermaidBlock> {
  type: 'gmr:render';
  token: string;
  generation: number;
  theme: Theme;
}
export type ViewerMessage =
  | { type: 'gmr:ready'; token: string }
  | { type: 'gmr:height'; token: string; generation: number; height: number };

export type EffectCategory = 'persistence' | 'network' | 'state';
export interface SideEffectCandidate {
  side: DiffSide;
  number: number;
  category: EffectCategory;
  evidence: string;
}
