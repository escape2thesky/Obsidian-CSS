import { MarkdownView } from 'obsidian';
import type DocumentEditorPlugin from '../main';

// -------------------------------------------------------
// Text node walking: find {#type:label} and [ref:type:label]
// Skip bib: refs (handled by bibliographyProcessor)
// -------------------------------------------------------
const COMBINED_RE = /\{#([a-z]+:[^\}]+)\}|\[ref:((?!bib:)[^\]]+)\]/g;

function processTextNode(textNode: Text): void {
  const text = textNode.textContent ?? '';
  if (!text.includes('{#') && !text.includes('[ref:')) return;

  COMBINED_RE.lastIndex = 0;
  type Part = { text: string; kind: 'literal' | 'label' | 'ref'; value: string };
  const parts: Part[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = COMBINED_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), kind: 'literal', value: '' });
    }
    if (match[1]) {
      parts.push({ text: match[0], kind: 'label', value: match[1] });
    } else if (match[2]) {
      parts.push({ text: match[0], kind: 'ref', value: match[2] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), kind: 'literal', value: '' });
  }

  if (parts.length === 1 && parts[0].kind === 'literal') return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind === 'literal') {
      fragment.appendChild(document.createTextNode(part.text));
    } else if (part.kind === 'label') {
      const span = document.createElement('span');
      span.className = 'de-label';
      span.dataset.label = part.value;
      fragment.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.className = 'de-ref';
      span.dataset.ref = part.value;
      span.textContent = '[???]';
      fragment.appendChild(span);
    }
  }
  parent.replaceChild(fragment, textNode);
}

function walkTextNodes(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_SKIP;
      if (parent.closest('.de-label,.de-ref,code,pre,.math')) return NodeFilter.FILTER_SKIP;
      const t = node.textContent ?? '';
      return (t.includes('{#') || t.includes('[ref:'))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const node of nodes) processTextNode(node);
}

// -------------------------------------------------------
// Find the nearest element matching selector that precedes
// target in document order within container.
// -------------------------------------------------------
function findNearestPreceding(
  target: Element,
  container: HTMLElement,
  selector: string,
): HTMLElement | null {
  let nearest: HTMLElement | null = null;
  container.querySelectorAll<HTMLElement>(selector).forEach(el => {
    if (el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) {
      nearest = el;
    }
  });
  return nearest;
}

// -------------------------------------------------------
// Build label → { number, displayType, element } registry
// -------------------------------------------------------
interface LabelEntry {
  number: string;
  displayType: string;
  element: HTMLElement;
}

function buildLabelRegistry(container: HTMLElement): Map<string, LabelEntry> {
  const registry = new Map<string, LabelEntry>();

  container.querySelectorAll<HTMLElement>('.de-label').forEach(labelEl => {
    const fullLabel = labelEl.dataset.label ?? '';
    const colonIdx = fullLabel.indexOf(':');
    if (colonIdx < 0) return;
    const type = fullLabel.slice(0, colonIdx);

    let number = '';
    let displayType = '';
    let targetEl: HTMLElement | null = null;

    if (type === 'fig') {
      // Label may be adjacent to or inside a .de-figure
      const parentFig = labelEl.closest<HTMLElement>('.de-figure');
      const fig = parentFig ?? findNearestPreceding(labelEl, container, '.de-figure');
      if (fig) {
        const m = fig.querySelector('.de-figcaption')?.textContent?.match(/図(\d+)/);
        if (m) { number = m[1]; displayType = 'fig'; targetEl = fig; }
      }
    } else if (type === 'tbl') {
      const tbl = findNearestPreceding(labelEl, container, '.de-table-wrap');
      if (tbl) {
        const m = tbl.querySelector('.de-table-caption')?.textContent?.match(/表(\d+)/);
        if (m) { number = m[1]; displayType = 'tbl'; targetEl = tbl; }
      }
    } else if (type === 'sec') {
      const heading = labelEl.closest<HTMLElement>('h1,h2,h3,h4,h5,h6');
      if (heading) {
        const numSpan = heading.querySelector('.de-heading-number');
        if (numSpan) {
          number = (numSpan.textContent ?? '').trim().replace(/\.$/, '');
          displayType = 'sec';
          targetEl = heading;
        }
      }
    } else if (type === 'eq') {
      const eq = findNearestPreceding(labelEl, container, '.de-equation-wrap');
      if (eq) {
        const m = eq.querySelector('.de-equation-number')?.textContent?.match(/\((\d+)\)/);
        if (m) { number = m[1]; displayType = 'eq'; targetEl = eq; }
      }
    }

    if (number && targetEl) {
      const id = `de-anchor-${fullLabel.replace(/[^a-zA-Z0-9]/g, '-')}`;
      targetEl.id = id;
      registry.set(fullLabel, { number, displayType, element: targetEl });
    }
  });

  return registry;
}

// -------------------------------------------------------
// Resolve all .de-ref spans using the registry
// -------------------------------------------------------
function resolveAllReferences(container: HTMLElement): void {
  const registry = buildLabelRegistry(container);

  container.querySelectorAll<HTMLElement>('.de-ref').forEach(refEl => {
    const fullRef = refEl.dataset.ref ?? '';
    const entry = registry.get(fullRef);

    if (!entry) {
      refEl.textContent = '[???]';
      refEl.className = 'de-ref de-ref-missing';
      return;
    }

    const { displayType, number, element: targetEl } = entry;
    let displayText = '';
    if (displayType === 'fig') displayText = `図${number}`;
    else if (displayType === 'tbl') displayText = `表${number}`;
    else if (displayType === 'sec') displayText = number + '.';
    else if (displayType === 'eq') displayText = `(${number})`;
    else displayText = number;

    refEl.textContent = '';
    refEl.className = 'de-ref';
    const link = document.createElement('a');
    link.className = 'de-ref-link';
    link.textContent = displayText;
    link.href = '#' + targetEl.id;
    link.addEventListener('click', e => {
      e.preventDefault();
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    refEl.appendChild(link);
  });
}

// -------------------------------------------------------
// Debounced full-document resolution
// -------------------------------------------------------
let resolveTimer: number | null = null;

export function scheduleXRefResolution(plugin: DocumentEditorPlugin): void {
  if (resolveTimer !== null) window.clearTimeout(resolveTimer);
  resolveTimer = window.setTimeout(() => {
    resolveTimer = null;
    plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
      const view = leaf.view as MarkdownView;
      if (view.getMode() === 'preview') {
        resolveAllReferences(view.previewMode.containerEl);
      }
    });
  }, 350);
}

export function clearXRefTimer(): void {
  if (resolveTimer !== null) {
    window.clearTimeout(resolveTimer);
    resolveTimer = null;
  }
}

// -------------------------------------------------------
// Register post-processor (runs after figure/heading processors)
// -------------------------------------------------------
export function registerCrossReferenceProcessor(plugin: DocumentEditorPlugin): void {
  plugin.registerMarkdownPostProcessor(el => {
    walkTextNodes(el);
    scheduleXRefResolution(plugin);
  }, 50);
}
