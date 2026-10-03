import { parseMermaidBlocks } from './parse.ts';
import { findDiffFiles, readDiffLines } from './github-dom.ts';
import panelStyles from './content.css';
import { syncSideEffectReview, clearSideEffectReview } from './side-effect-ui.ts';

import type { DiffFile, MermaidBlock, RenderMessage, Theme, ViewerMessage } from './types.ts';

interface PanelState {
  file: DiffFile;
  host: HTMLDivElement;
  panel: HTMLDetailsElement;
  body: HTMLDivElement;
  status: HTMLParagraphElement;
  badge: HTMLSpanElement;
  token: string;
  generation: number;
  before: MermaidBlock[];
  after: MermaidBlock[];
  ready: boolean;
  visible: boolean;
  initialized: boolean;
  frame: HTMLIFrameElement | null;
  fingerprint: string;
  loadTimer?: number;
  loadFailed?: boolean;
}

const panels = new Map<Element, PanelState>();
const MAX_SOURCE = 50_000;
const MAX_BLOCKS = 30;
let pageKey = '';
let timer: number | undefined;
const visibility = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const state = [...panels.values()].find((item) => item.panel === entry.target);
    if (!state) continue;
    state.visible = entry.isIntersecting;
    if (state.visible) mountFrame(state);
  }
}, { rootMargin: '400px' });

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function theme(): Theme {
  const html = document.documentElement;
  const mode = html.dataset.colorMode;
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function dispose(state: PanelState) {
  clearTimeout(state.loadTimer);
  visibility.unobserve(state.panel);
  state.host.remove();
  panels.delete(state.file.element);
}

function postRender(state: PanelState) {
  if (!state.ready || !state.frame?.isConnected || !state.panel.open) return;
  state.frame.contentWindow?.postMessage({
    type: 'gmr:render', token: state.token, generation: ++state.generation,
    theme: theme(), before: state.before, after: state.after,
  } satisfies RenderMessage, '*'); // Manifest sandbox has an opaque origin; source window + nonce bind the reply.
}

function mountFrame(state: PanelState) {
  if (!state.visible || !state.panel.open || (!state.before.length && !state.after.length)) return;
  if (state.frame) return;
  if (!globalThis.chrome?.runtime?.id) {
    state.status.textContent = '拡張機能が更新されました。このページを更新してください。';
    state.status.hidden = false;
    return;
  }
  const frame = node('iframe', 'gmr-frame');
  frame.title = `${state.file.path} の Mermaid プレビュー`;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  const viewerUrl = chrome.runtime.getURL('viewer.html') + '#' + state.token;
  frame.src = viewerUrl;
  let restoredSource = false;
  frame.addEventListener('load', () => {
    // Other page scripts can replace an injected iframe with an empty srcdoc.
    // Restore only our packaged viewer, once; never loop against another script.
    if (state.frame !== frame || !frame.isConnected || state.ready || !frame.hasAttribute('srcdoc')) return;
    if (!restoredSource && frame.getAttribute('src') === viewerUrl) {
      restoredSource = true;
      frame.removeAttribute('srcdoc');
    } else {
      state.loadFailed = true;
      state.status.hidden = false;
      state.status.textContent = '他の処理によってプレビューの読み込みが変更されました。このページを更新して再確認してください。';
    }
  });
  state.frame = frame;
  state.body.append(frame);
  state.loadTimer = window.setTimeout(() => {
    if (!state.ready && frame.isConnected) {
      state.loadFailed = true;
      state.status.textContent = 'プレビューを読み込めませんでした。拡張機能を再読み込みして、このページを更新してください。';
      state.status.hidden = false;
    }
  }, 15_000);
}

function refresh(state: PanelState) {
  const lines = readDiffLines(state.file.element);
  const before = parseMermaidBlocks(lines.before);
  const after = parseMermaidBlocks(lines.after);
  const fingerprint = JSON.stringify([before, after, theme()]);
  if (fingerprint === state.fingerprint) return;
  state.fingerprint = fingerprint;
  const all = [...before.blocks, ...after.blocks];
  const tooLarge = all.some((block) => block.source.length > MAX_SOURCE);
  const tooMany = before.blocks.length > MAX_BLOCKS || after.blocks.length > MAX_BLOCKS;
  state.before = before.blocks.filter((block) => block.source.length <= MAX_SOURCE).slice(0, MAX_BLOCKS);
  state.after = after.blocks.filter((block) => block.source.length <= MAX_SOURCE).slice(0, MAX_BLOCKS);
  const count = state.before.length + state.after.length;
  state.badge.textContent = count ? `前 ${state.before.length} / 後 ${state.after.length}` : '表示範囲を確認';
  const notices = [];
  if (!count || before.incomplete || after.incomplete) {
    notices.push('完全な Mermaid ブロックが見えない場合は、GitHub の「Expand all lines」や省略行の展開で周辺行を表示してください。展開後は自動で更新します。');
  }
  if (tooLarge) notices.push('50,000 文字を超える図は表示を省略しました。');
  if (tooMany) notices.push('表示は変更前・変更後それぞれ先頭 30 図までです。');
  state.status.textContent = notices.join(' ');
  state.status.hidden = !notices.length;
  if (!state.initialized) {
    state.panel.open = count > 0;
    state.initialized = true;
  }
  if (!count && state.frame) {
    state.frame.remove();
    state.frame = null;
    state.ready = false;
    clearTimeout(state.loadTimer);
  }
  mountFrame(state);
  postRender(state);
}

function addPanel(file: DiffFile) {
  // Keep GitHub's DOM updates and page-wide styling separate from preview UI.
  const host = node('div', 'gmr-host');
  host.dataset.gmrOwned = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = panelStyles;
  const panel = node('details', 'gmr-panel');
  panel.dataset.gmrOwned = 'true';
  const summary = node('summary', 'gmr-summary');
  const badge = node('span', 'gmr-badge');
  summary.append(node('span', 'gmr-title', 'Mermaid プレビュー'), badge);
  const body = node('div', 'gmr-body');
  const status = node('p', 'gmr-status');
  status.setAttribute('role', 'status');
  body.append(status);
  panel.append(summary, body);
  shadow.append(style, panel);
  const state: PanelState = { file, host, panel, body, status, badge, token: crypto.randomUUID(), generation: 0,
    before: [], after: [], ready: false, visible: false, initialized: false, frame: null, fingerprint: '' };
  panels.set(file.element, state);
  file.header.after(host);
  visibility.observe(panel);
  panel.addEventListener('toggle', () => {
    if (panel.open) {
      mountFrame(state);
      postRender(state);
    } else if (state.frame) {
      // Release renderer memory while collapsed; re-open uses the latest extracted source.
      state.frame.remove();
      state.frame = null;
      state.ready = false;
      clearTimeout(state.loadTimer);
    }
  });
  refresh(state);
}

function scan() {
  const key = location.pathname + location.search;
  if (key !== pageKey) {
    for (const state of panels.values()) dispose(state);
    clearSideEffectReview();
    pageKey = key;
  }
  if (!/^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(location.pathname)) return;
  for (const state of panels.values()) {
    if (!state.file.element.isConnected || !state.panel.isConnected) dispose(state);
  }
  const files = findDiffFiles();
  syncSideEffectReview(files);
  for (const file of files) {
    if (!/\.(md|markdown|mdx)$/i.test(file.path)) continue;
    const state = panels.get(file.element);
    if (state) {
      if (state.file.path !== file.path) { dispose(state); addPanel(file); }
      else refresh(state);
    } else addPanel(file);
  }
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(scan, 200);
}

function isViewerMessage(data: unknown): data is ViewerMessage {
  if (typeof data !== 'object' || data === null || !('token' in data) || typeof data.token !== 'string' || !('type' in data)) return false;
  return data.type === 'gmr:ready' || (data.type === 'gmr:height'
    && 'generation' in data && typeof data.generation === 'number'
    && 'height' in data && typeof data.height === 'number' && Number.isFinite(data.height));
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (event.origin !== 'null' || !isViewerMessage(data)) return;
  for (const state of panels.values()) {
    if (!state.frame || event.source !== state.frame.contentWindow || data.token !== state.token) continue;
    if (data.type === 'gmr:ready') {
      state.ready = true;
      clearTimeout(state.loadTimer);
      if (state.loadFailed) {
        state.loadFailed = false;
        state.fingerprint = '';
        refresh(state);
        return;
      }
      postRender(state);
    } else if (data.type === 'gmr:height' && data.generation === state.generation) {
      state.frame.style.height = `${Math.min(1600, Math.max(120, data.height))}px`;
    }
  }
});

new MutationObserver((records) => {
  if (records.some((record) => {
    const element = record.target instanceof Element ? record.target : record.target.parentElement;
    if (element?.closest('[data-gmr-owned]')) return false;
    if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((n) => n instanceof Element && n.hasAttribute('data-gmr-owned'))) return false;
    return true;
  })) schedule();
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'] });
for (const event of ['turbo:load', 'pjax:end', 'popstate']) window.addEventListener(event, schedule);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
scan();
