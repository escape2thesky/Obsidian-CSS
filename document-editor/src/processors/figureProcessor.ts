import { MarkdownPostProcessorContext } from 'obsidian';
import type DocumentEditorPlugin from '../main';

// -------------------------------------------------------
// Document-scoped counters for figures and tables
// -------------------------------------------------------
class FigureCounter {
  figureCount = 0;
  tableCount = 0;

  reset() {
    this.figureCount = 0;
    this.tableCount = 0;
  }

  nextFigure(): number {
    return ++this.figureCount;
  }

  nextTable(): number {
    return ++this.tableCount;
  }
}

// -------------------------------------------------------
// Returns true if `el` is the only non-whitespace child of `parent`.
// Used to decide whether to replace <p> entirely.
// -------------------------------------------------------
function isOnlyMeaningfulChild(el: Element, parent: Element): boolean {
  return Array.from(parent.childNodes).every(
    node =>
      node === el ||
      (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '')
  );
}

// -------------------------------------------------------
// Wrap a target element in .de-figure and add caption below.
// If the target's parent is a <p> containing only the target,
// we REPLACE the <p> to avoid placing block elements inside <p>
// (which causes rendering glitches when images are consecutive).
// -------------------------------------------------------
function applyFigureWrap(target: HTMLElement, captionText: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'de-figure';

  const caption = document.createElement('div');
  caption.className = 'de-figcaption';
  caption.textContent = captionText;

  const parent = target.parentElement;
  if (parent?.tagName === 'P' && isOnlyMeaningfulChild(target, parent)) {
    // Replace the <p> entirely — avoids block-inside-<p> invalid HTML
    parent.parentNode?.insertBefore(wrap, parent);
    wrap.appendChild(target);   // auto-detaches target from parent
    wrap.appendChild(caption);
    parent.remove();             // remove now-empty <p>
  } else {
    // Multiple siblings in parent — wrap inline
    target.parentNode?.insertBefore(wrap, target);
    wrap.appendChild(target);
    wrap.appendChild(caption);
  }
}

// -------------------------------------------------------
// Process images in document order.
// Two selectors are used:
//   1. .internal-embed.image-embed  — wiki-link embeds ![[img.png]]
//   2. img (not inside .internal-embed) — standard ![alt](src)
// Both are collected, sorted by DOM position, then wrapped.
// -------------------------------------------------------
function processFigures(el: HTMLElement, counter: FigureCounter) {
  type Target = { node: HTMLElement; altText: string };
  const targets: Target[] = [];

  // Wiki-style embeds: ![[image.png]]
  // Wrap the .internal-embed span, not the <img> inside it,
  // to avoid interfering with Obsidian's lazy image loader.
  el.querySelectorAll<HTMLElement>('.internal-embed.image-embed').forEach(embed => {
    if (embed.closest('.de-figure')) return;
    const img = embed.querySelector('img');
    const altText = img?.alt ?? embed.getAttribute('alt') ?? '';
    targets.push({ node: embed, altText });
  });

  // Standard markdown images: ![alt](src)
  // Skip images that are inside wiki embeds (already collected above).
  el.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    if (img.closest('.de-figure') || img.closest('.internal-embed')) return;
    targets.push({ node: img, altText: img.alt ?? '' });
  });

  // Sort by document order so figure numbers match visual order
  targets.sort((a, b) => {
    const pos = a.node.compareDocumentPosition(b.node);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  for (const { node, altText } of targets) {
    const n = counter.nextFigure();
    const captionText = altText ? `図${n}: ${altText}` : `図${n}`;
    applyFigureWrap(node, captionText);
  }
}

// -------------------------------------------------------
// Wrap <table> in .de-table-wrap and add label above
// -------------------------------------------------------
function processTables(el: HTMLElement, counter: FigureCounter) {
  el.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (table.closest('.de-table-wrap')) return;

    const n = counter.nextTable();

    const wrap = document.createElement('div');
    wrap.className = 'de-table-wrap';

    const caption = document.createElement('div');
    caption.className = 'de-table-caption';
    caption.textContent = `表${n}`;

    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(caption);
    wrap.appendChild(table);
  });
}

// -------------------------------------------------------
// Undo previous wrapping (for idempotent re-processing)
// -------------------------------------------------------
function unwrapFigures(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.de-figure').forEach(wrap => {
    const parent = wrap.parentNode;
    if (!parent) return;
    Array.from(wrap.children).forEach(child => {
      if (!child.classList.contains('de-figcaption')) {
        parent.insertBefore(child, wrap);
      }
    });
    wrap.remove();
  });
}

function unwrapTables(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.de-table-wrap').forEach(wrap => {
    const parent = wrap.parentNode;
    if (!parent) return;
    Array.from(wrap.children).forEach(child => {
      if (!child.classList.contains('de-table-caption')) {
        parent.insertBefore(child, wrap);
      }
    });
    wrap.remove();
  });
}

// -------------------------------------------------------
// Direct container processing (used for manual refresh / startup)
// Processes the ENTIRE preview container in one pass,
// bypassing the post-processor pipeline.
// -------------------------------------------------------
export function processFigureContainer(
  container: HTMLElement,
  settings: { enableFigureNumbers: boolean; enableTableNumbers: boolean }
): void {
  const { enableFigureNumbers, enableTableNumbers } = settings;
  if (!enableFigureNumbers && !enableTableNumbers) return;

  // Unwrap first so re-processing is idempotent
  if (enableFigureNumbers) unwrapFigures(container);
  if (enableTableNumbers) unwrapTables(container);

  const counter = new FigureCounter();
  if (enableFigureNumbers) processFigures(container, counter);
  if (enableTableNumbers) processTables(container, counter);
}

// -------------------------------------------------------
// Reading View post-processor
// -------------------------------------------------------

// A render session is a burst of post-processor calls for the same file.
// Calls within SESSION_GAP_MS of each other are part of the same session.
const SESSION_GAP_MS = 500;

export function registerFigurePostProcessor(plugin: DocumentEditorPlugin) {
  // Counter lives in the closure; reset when a new render session starts.
  const counter = new FigureCounter();
  let lastCallTime = 0;
  let lastFile = '';

  plugin.registerMarkdownPostProcessor(
    (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const { enableFigureNumbers, enableTableNumbers } = plugin.settings;
      if (!enableFigureNumbers && !enableTableNumbers) return;

      const now = Date.now();
      const currentFile = ctx.sourcePath;

      // Reset for a new render session (different file OR inter-call gap exceeds SESSION_GAP_MS)
      if (currentFile !== lastFile || now - lastCallTime > SESSION_GAP_MS) {
        counter.reset();
        lastFile = currentFile;
      }
      lastCallTime = now;

      if (enableFigureNumbers) processFigures(el, counter);
      if (enableTableNumbers) processTables(el, counter);
    },
    10
  );
}
