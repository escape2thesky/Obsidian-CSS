import { MarkdownView } from 'obsidian';
import type DocumentEditorPlugin from '../main';

// -------------------------------------------------------
// Text node walking: find [ref:bib:key] and wrap in spans
// -------------------------------------------------------
const BIB_REF_RE = /\[ref:bib:([^\]]+)\]/g;

function processBibRefTextNode(textNode: Text): void {
  const text = textNode.textContent ?? '';
  if (!text.includes('[ref:bib:')) return;

  BIB_REF_RE.lastIndex = 0;
  type Part = { text: string; kind: 'literal' | 'ref'; key: string };
  const parts: Part[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BIB_REF_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), kind: 'literal', key: '' });
    }
    parts.push({ text: match[0], kind: 'ref', key: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), kind: 'literal', key: '' });
  }

  if (parts.length === 1 && parts[0].kind === 'literal') return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind === 'literal') {
      fragment.appendChild(document.createTextNode(part.text));
    } else {
      const span = document.createElement('span');
      span.className = 'de-bib-ref';
      span.dataset.bibKey = part.key;
      span.textContent = '[?]';
      fragment.appendChild(span);
    }
  }
  parent.replaceChild(fragment, textNode);
}

function walkBibRefTextNodes(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_SKIP;
      if (parent.closest('.de-bib-ref,code,pre')) return NodeFilter.FILTER_SKIP;
      return (node.textContent ?? '').includes('[ref:bib:')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const node of nodes) processBibRefTextNode(node);
}

// -------------------------------------------------------
// Find bibliography table: first <table> whose first <th>
// text is "key" (case-insensitive)
// -------------------------------------------------------
function isBibTable(table: HTMLTableElement): boolean {
  const firstTh = table.querySelector('thead th');
  return (firstTh?.textContent ?? '').trim().toLowerCase() === 'key';
}

// -------------------------------------------------------
// Get the column index for "key" in the table header
// -------------------------------------------------------
function getKeyColumnIndex(table: HTMLTableElement): number {
  const ths = Array.from(table.querySelectorAll('thead th'));
  return ths.findIndex(th => th.textContent?.trim().toLowerCase() === 'key');
}

// -------------------------------------------------------
// Build key → { rowEl, tableOrder } mapping from bib tables
// -------------------------------------------------------
interface BibEntry {
  rowEl: HTMLTableRowElement;
  tableOrder: number;
}

function collectBibEntries(container: HTMLElement): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();
  let tableOrder = 0;

  container.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    if (!isBibTable(table)) return;
    const keyCol = getKeyColumnIndex(table);
    if (keyCol < 0) return;

    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    rows.forEach(row => {
      const cell = row.cells[keyCol];
      if (!cell) return;
      // Strip any injected number prefix [N]
      const key = (cell.dataset.bibOrigKey ?? cell.textContent ?? '').trim();
      if (!key) return;
      cell.dataset.bibOrigKey = key; // preserve original key
      entries.set(key, { rowEl: row, tableOrder: tableOrder++ });
    });

    // Mark the table
    table.classList.add('de-bib-table');
  });

  return entries;
}

// -------------------------------------------------------
// Collect unique bib keys in order of appearance in the DOM
// (for citation-order numbering)
// -------------------------------------------------------
function collectCitationOrder(container: HTMLElement): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  container.querySelectorAll<HTMLElement>('.de-bib-ref').forEach(span => {
    const key = span.dataset.bibKey ?? '';
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  });
  return keys;
}

// -------------------------------------------------------
// Apply numbers to bibliography table rows and ref spans
// -------------------------------------------------------
function applyBibNumbers(
  container: HTMLElement,
  entries: Map<string, BibEntry>,
  orderedKeys: string[],
  keyToNumber: Map<string, number>,
): void {
  // Update table rows: show [N] in the key column and add anchor id
  entries.forEach((entry, key) => {
    const n = keyToNumber.get(key);
    if (n === undefined) return;
    const table = entry.rowEl.closest<HTMLTableElement>('table');
    if (!table) return;
    const keyCol = getKeyColumnIndex(table);
    const cell = entry.rowEl.cells[keyCol];
    if (!cell) return;

    const origKey = cell.dataset.bibOrigKey ?? key;
    const anchorId = `de-bib-${origKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
    entry.rowEl.id = anchorId;

    // Show number in cell
    cell.textContent = '';
    const numSpan = document.createElement('span');
    numSpan.className = 'de-bib-number';
    numSpan.textContent = `[${n}]`;
    const keyText = document.createTextNode(` ${origKey}`);
    cell.appendChild(numSpan);
    cell.appendChild(keyText);
  });

  // Update ref spans
  container.querySelectorAll<HTMLElement>('.de-bib-ref').forEach(span => {
    const key = span.dataset.bibKey ?? '';
    const n = keyToNumber.get(key);
    if (n === undefined) {
      span.textContent = '[?]';
      span.className = 'de-bib-ref de-ref-missing';
      return;
    }
    const entry = entries.get(key);
    span.textContent = '';
    span.className = 'de-bib-ref';
    const link = document.createElement('a');
    link.className = 'de-ref-link';
    link.textContent = `[${n}]`;
    if (entry) {
      const anchorId = entry.rowEl.id;
      link.href = '#' + anchorId;
      link.addEventListener('click', e => {
        e.preventDefault();
        entry.rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    span.appendChild(link);
  });
}

// -------------------------------------------------------
// Full-document bibliography resolution
// -------------------------------------------------------
export function resolveBibliography(
  container: HTMLElement,
  order: 'citation' | 'table',
): void {
  // Reset previously injected numbers so we can re-run idempotently
  container.querySelectorAll<HTMLElement>('[data-bib-orig-key]').forEach(cell => {
    const origKey = cell.dataset.bibOrigKey ?? '';
    cell.textContent = origKey;
  });

  const entries = collectBibEntries(container);
  if (entries.size === 0) return;

  const keyToNumber = new Map<string, number>();

  if (order === 'citation') {
    const citationKeys = collectCitationOrder(container);
    // Keys that appear in refs first, then remaining table keys
    let n = 1;
    for (const key of citationKeys) {
      if (entries.has(key)) keyToNumber.set(key, n++);
    }
    entries.forEach((_, key) => {
      if (!keyToNumber.has(key)) keyToNumber.set(key, n++);
    });
  } else {
    // table order
    const sorted = Array.from(entries.entries()).sort(
      (a, b) => a[1].tableOrder - b[1].tableOrder,
    );
    sorted.forEach(([key], idx) => keyToNumber.set(key, idx + 1));
  }

  applyBibNumbers(container, entries, [], keyToNumber);
}

// -------------------------------------------------------
// Debounced full-document resolution
// -------------------------------------------------------
let bibTimer: number | null = null;

function scheduleBibResolution(plugin: DocumentEditorPlugin): void {
  if (bibTimer !== null) window.clearTimeout(bibTimer);
  bibTimer = window.setTimeout(() => {
    bibTimer = null;
    plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
      const view = leaf.view as MarkdownView;
      if (view.getMode() === 'preview') {
        resolveBibliography(
          view.previewMode.containerEl,
          plugin.settings.bibNumberingOrder,
        );
      }
    });
  }, 400);
}

export function clearBibTimer(): void {
  if (bibTimer !== null) {
    window.clearTimeout(bibTimer);
    bibTimer = null;
  }
}

// -------------------------------------------------------
// Direct container processing (for manual refresh)
// -------------------------------------------------------
export function processBibliographyContainer(
  container: HTMLElement,
  settings: { enableBibliography: boolean; bibNumberingOrder: 'citation' | 'table' },
): void {
  if (!settings.enableBibliography) return;
  resolveBibliography(container, settings.bibNumberingOrder);
}

// -------------------------------------------------------
// Register post-processor
// -------------------------------------------------------
export function registerBibliographyPostProcessor(plugin: DocumentEditorPlugin): void {
  plugin.registerMarkdownPostProcessor(el => {
    if (!plugin.settings.enableBibliography) return;
    walkBibRefTextNodes(el);
    scheduleBibResolution(plugin);
  }, 60);
}
