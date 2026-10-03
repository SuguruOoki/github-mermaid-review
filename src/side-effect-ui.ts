import { readDiffEntries } from './github-dom.ts';
import { detectSideEffects, supportsSideEffectFile } from './side-effects.ts';
import styles from './side-effect-ui.css';

import type { DiffFile, DiffSide, EffectCategory } from './types.ts';

interface CandidateRow {
  key: string;
  path: string;
  side: DiffSide;
  number: number;
  cell: HTMLTableCellElement;
  reasons: string[];
}

interface ReviewUI {
  host: HTMLDivElement;
  pageStyle: HTMLStyleElement;
  summary: HTMLElement;
  notice: HTMLParagraphElement;
  list: HTMLDivElement;
}

const labels: Record<EffectCategory, string> = { persistence: 'DB・ファイル・保存', network: '外部通信・送信', state: '状態変更' };
const LIMIT = 300;
let ui: ReviewUI | undefined;
let current: CandidateRow[] = [];
let fingerprint = '';
let enabled = true;
let selectedKey = '';
const decorated = new Set<HTMLTableCellElement>();

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function clearDecorations() {
  for (const cell of decorated) {
    cell.removeAttribute('data-gmr-side-effect');
    cell.removeAttribute('data-gmr-side-effect-selected');
  }
  decorated.clear();
}

function decorate() {
  clearDecorations();
  if (!enabled) return;
  for (const item of current) {
    if (!item.cell.isConnected) continue;
    item.cell.setAttribute('data-gmr-side-effect', '');
    if (item.key === selectedKey) item.cell.setAttribute('data-gmr-side-effect-selected', '');
    decorated.add(item.cell);
  }
}

function mount(): ReviewUI {
  const host = node('div', 'gmr-effects-host');
  host.dataset.gmrOwned = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  const panel = node('details', 'effects-panel');
  const summary = node('summary', 'effects-summary');
  const body = node('div', 'effects-body');
  const explanation = node('p', 'effects-explanation', '読み込まれた追加・削除行から、呼び出し名や代入を手掛かりに抽出しています。候補がなくても、副作用がないとは限りません。');
  const label = node('label', 'effects-toggle');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = enabled;
  label.append(toggle, document.createTextNode('候補行を強調する'));
  toggle.addEventListener('change', () => { enabled = toggle.checked; decorate(); });
  const notice = node('p', 'effects-notice');
  notice.setAttribute('role', 'status');
  const list = node('div', 'effects-list');
  list.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-index]') : null;
    if (!button) return;
    const item = current[Number(button.dataset.index)];
    if (!item?.cell.isConnected) return;
    selectedKey = item.key;
    decorate();
    panel.open = false;
    item.cell.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  });
  body.append(explanation, label, notice, list);
  panel.append(summary, body);
  shadow.append(sheet, panel);
  document.body.append(host);
  const pageStyle = document.createElement('style');
  pageStyle.dataset.gmrOwned = 'true';
  // Preserve source text, diff colors, line-number controls and existing attributes.
  pageStyle.textContent = `
    td[data-gmr-side-effect] { box-shadow: inset 4px 0 0 #bf8700 !important; outline: 1px solid #bf8700 !important; outline-offset: -1px !important; }
    td[data-gmr-side-effect-selected] { outline: 3px solid #bf8700 !important; outline-offset: -3px !important; }
  `;
  document.head.append(pageStyle);
  return { host, pageStyle, summary, notice, list };
}

/** Recompute candidates from the current DOM; always reconcile cell identities. */
export function syncSideEffectReview(files: DiffFile[]) {
  const supported = files.filter((file) => supportsSideEffectFile(file.path));
  if (!supported.length) { clearSideEffectReview(); return; }
  const candidates: CandidateRow[] = [];
  let loadedFiles = 0;
  for (const file of supported) {
    const entries = readDiffEntries(file.element);
    if (entries.before.length || entries.after.length) loadedFiles++;
    const cells = {
      before: new Map(entries.before.map((entry) => [entry.number, entry.cell])),
      after: new Map(entries.after.map((entry) => [entry.number, entry.cell])),
    };
    const byLine = new Map<string, CandidateRow>();
    for (const match of detectSideEffects(entries, file.path)) {
      const cell = cells[match.side].get(match.number);
      if (!cell) continue;
      const key = JSON.stringify([file.path, match.side, match.number]);
      let item = byLine.get(key);
      if (!item) {
        item = { key, path: file.path, side: match.side, number: match.number, cell, reasons: [] };
        byLine.set(key, item);
      }
      item.reasons.push(`${labels[match.category]}: ${match.evidence}`);
    }
    candidates.push(...byLine.values());
  }
  current = candidates;
  if (!ui?.host.isConnected || !ui.pageStyle.isConnected) {
    ui?.host.remove();
    ui?.pageStyle.remove();
    ui = mount();
    fingerprint = '';
  }
  decorate();
  const next = JSON.stringify([loadedFiles, supported.length, candidates.map(({ key, reasons }) => [key, reasons])]);
  if (next === fingerprint) return;
  fingerprint = next;
  const { summary, notice, list } = ui;
  const fileCount = new Set(candidates.map((item) => item.path)).size;
  summary.textContent = `◆ 副作用候補 ${candidates.length} 行 / ${fileCount} ファイル`;
  notice.textContent = `対応ファイル ${loadedFiles} / ${supported.length} 件の表示済みコードを確認しています。`
    + (loadedFiles < supported.length ? ' 折りたたまれた差分は開いてください。' : '')
    + (candidates.length > LIMIT ? ` 一覧は先頭 ${LIMIT} 行までです。強調は全候補に付けています。` : '')
    + (!candidates.length ? ' 対応規則に一致する変更行は見つかりませんでした。' : '');
  const fragment = document.createDocumentFragment();
  let lastPath: string | undefined;
  for (const [index, item] of candidates.slice(0, LIMIT).entries()) {
    if (item.path !== lastPath) {
      fragment.append(node('h3', 'effects-file', item.path));
      lastPath = item.path;
    }
    const button = node('button', 'effects-candidate');
    button.type = 'button';
    button.dataset.index = String(index);
    const revision = item.side === 'after' ? '追加' : '削除';
    button.append(node('span', `effects-location ${item.side}`, `${revision} L${item.number}`),
      node('span', 'effects-reason', item.reasons.join(' / ')));
    fragment.append(button);
  }
  list.replaceChildren(fragment);
}

export function clearSideEffectReview() {
  clearDecorations();
  ui?.host.remove();
  ui?.pageStyle.remove();
  ui = undefined;
  current = [];
  fingerprint = '';
  selectedKey = '';
}
