import mermaid from 'mermaid';
import type { MermaidConfig } from 'mermaid';
import type { MermaidBlock, RenderMessage, Theme, ViewerMessage } from './types.ts';

const PARENT_ORIGIN = 'https://github.com';
const MAX_DIAGRAMS = 30;
const MAX_SOURCE_LENGTH = 50_000;
const token = location.hash.slice(1);
const appElement = document.getElementById('app');
if (!appElement) throw new Error('プレビューの表示先が見つかりませんでした。');
const app = appElement;
let latestGeneration = -1;
let displayedGeneration = -1;
let pendingRender: RenderMessage | null = null;
let rendering = false;
let renderId = 0;
let heightFrame = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function validBlock(block: unknown): block is MermaidBlock {
  return isRecord(block)
    && typeof block.source === 'string' && block.source.length <= MAX_SOURCE_LENGTH
    && typeof block.startLine === 'number' && Number.isSafeInteger(block.startLine) && block.startLine > 0
    && typeof block.endLine === 'number' && Number.isSafeInteger(block.endLine) && block.endLine >= block.startLine;
}

function validBlocks(blocks: unknown): blocks is MermaidBlock[] {
  return Array.isArray(blocks) && blocks.length <= MAX_DIAGRAMS && blocks.every(validBlock);
}

function validMessage(data: unknown): data is RenderMessage {
  return isRecord(data)
    && data.type === 'gmr:render' && data.token === token
    && typeof data.generation === 'number' && Number.isSafeInteger(data.generation) && data.generation >= 0
    && (data.theme === 'light' || data.theme === 'dark')
    && validBlocks(data.before) && validBlocks(data.after);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function reportHeight() {
  cancelAnimationFrame(heightFrame);
  heightFrame = requestAnimationFrame(() => {
    if (displayedGeneration < 0 || displayedGeneration !== latestGeneration) return;
    parent.postMessage({
      type: 'gmr:height', token, generation: displayedGeneration,
      height: Math.max(120, Math.min(1600, Math.ceil(app.getBoundingClientRect().height) + 2)),
    } satisfies ViewerMessage, PARENT_ORIGIN);
  });
}

function initializeMermaid(theme: Theme) {
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: MAX_SOURCE_LENGTH,
    maxEdges: 500,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: theme === 'dark' ? 'dark' : 'default',
    themeCSS: '',
    themeVariables: {},
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    dompurifyConfig: {},
  };
  // Diagram directives must not relax the host's rendering and security settings.
  mermaid.initialize({ ...config, secure: ['secure', ...Object.keys(config)] });
}

function safeSvg(svgText: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error('SVG を読み込めませんでした。');
  }
  // The CSP and opaque sandbox are the security boundary. Also disable diagram
  // navigation and resource URLs so the preview stays a passive drawing.
  svg.querySelectorAll('script, iframe, object, embed, link, meta, base, form, animate, set, animateMotion, animateTransform, image')
    .forEach((element) => element.remove());
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'target' || name === 'download'
        || ((name === 'href' || name === 'xlink:href' || name === 'src')
          && (element.localName === 'a' || !attribute.value.startsWith('#')))) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  const imported = document.importNode(svg, true);
  if (!(imported instanceof SVGSVGElement)) throw new Error('SVG を読み込めませんでした。');
  return imported;
}

function addZoomControls(header: HTMLDivElement, canvas: HTMLDivElement, svg: SVGSVGElement) {
  const controls = node('div', 'zoom-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '図の表示倍率');
  const smaller = node('button', '', '−');
  const reset = node('button', '', '100%');
  const larger = node('button', '', '+');
  smaller.setAttribute('aria-label', '図を縮小');
  reset.setAttribute('aria-label', '図を元の倍率に戻す');
  larger.setAttribute('aria-label', '図を拡大');
  for (const button of [smaller, reset, larger]) button.type = 'button';
  controls.append(smaller, reset, larger);
  header.append(controls);

  const viewBox = svg.viewBox.baseVal;
  const measured = svg.getBoundingClientRect();
  const naturalWidth = viewBox.width > 0 ? viewBox.width : (measured.width || 400);
  const naturalHeight = viewBox.height > 0 ? viewBox.height : (measured.height || 200);
  let scale = 1;
  function update() {
    const parentWidth = canvas.parentElement?.clientWidth ?? naturalWidth + 28;
    const width = Math.min(naturalWidth, parentWidth - 28);
    svg.style.width = `${Math.max(1, width) * scale}px`;
    svg.style.height = `${Math.max(1, width) * naturalHeight / naturalWidth * scale}px`;
    reset.textContent = `${Math.round(scale * 100)}%`;
    smaller.disabled = scale <= 0.5;
    larger.disabled = scale >= 3;
    reportHeight();
  }
  smaller.addEventListener('click', () => { scale = Math.max(0.5, scale - 0.25); update(); });
  larger.addEventListener('click', () => { scale = Math.min(3, scale + 0.25); update(); });
  reset.addEventListener('click', () => { scale = 1; update(); });
  update();
  return update;
}

function makeCard(block: MermaidBlock) {
  const card = node('article', 'diagram');
  const header = node('div', 'diagram-header');
  header.append(node('h3', '', `行 ${block.startLine}–${block.endLine}`));
  const viewport = node('div', 'viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', `行 ${block.startLine}–${block.endLine} の図`);
  const canvas = node('div', 'canvas');
  canvas.append(node('p', 'loading', '描画しています…'));
  viewport.append(canvas);
  const details = node('details');
  details.append(node('summary', '', 'ソースを表示'), node('pre', '', block.source));
  details.addEventListener('toggle', reportHeight);
  card.append(header, viewport, details);
  return { card, header, canvas };
}

let resizeDiagrams: (() => void)[] = [];

async function renderMessage(message: RenderMessage) {
  displayedGeneration = message.generation;
  document.documentElement.dataset.theme = message.theme;
  initializeMermaid(message.theme);
  resizeDiagrams = [];
  const columns = node('div', 'columns');
  const jobs = [];
  for (const [side, label] of [['before', '変更前'], ['after', '変更後']] as const) {
    const column = node('section', `column ${side}`);
    column.append(node('h2', '', label));
    if (message[side].length === 0) {
      column.append(node('p', 'empty', 'この側には、全文が見えている Mermaid ブロックがありません。'));
    }
    for (const block of message[side]) {
      const card = makeCard(block);
      column.append(card.card);
      jobs.push({ ...card, block });
    }
    columns.append(column);
  }
  app.replaceChildren(
    node('p', 'intro', '差分画面で全文が見えているブロックを、各側の行順で表示しています。左右の同じ位置にある図が対応するとは限りません。'),
    columns,
  );
  reportHeight();

  for (const job of jobs) {
    if (message.generation !== latestGeneration) return;
    try {
      const { svg: svgText } = await mermaid.render(`gmr-diagram-${++renderId}`, job.block.source);
      if (message.generation !== latestGeneration) return;
      const svg = safeSvg(svgText);
      job.canvas.replaceChildren(svg);
      resizeDiagrams.push(addZoomControls(job.header, job.canvas, svg));
    } catch (error) {
      if (message.generation !== latestGeneration) return;
      const detail = error instanceof Error ? error.message.slice(0, 800) : '構文を確認してください。';
      job.canvas.replaceChildren(node('p', 'error', `図を描画できませんでした。\n${detail}`));
    }
    reportHeight();
  }
}

async function drainRenders() {
  if (rendering) return;
  rendering = true;
  try {
    while (pendingRender) {
      const message = pendingRender;
      pendingRender = null;
      await renderMessage(message);
    }
  } finally {
    rendering = false;
  }
}

if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) && parent !== window) {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== parent || event.origin !== PARENT_ORIGIN || !validMessage(event.data)) return;
    if (event.data.generation <= latestGeneration) return;
    latestGeneration = event.data.generation;
    pendingRender = event.data;
    void drainRenders();
  });
  new ResizeObserver(reportHeight).observe(app);
  window.addEventListener('resize', () => {
    resizeDiagrams.forEach((update) => update());
    reportHeight();
  });
  parent.postMessage({ type: 'gmr:ready', token } satisfies ViewerMessage, PARENT_ORIGIN);
}
