import {
  MarkdownPostProcessorContext,
  MarkdownView,
} from 'obsidian';
import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type DocumentEditorPlugin from '../main';

// -------------------------------------------------------
// Heading counter - computes hierarchical numbers
// -------------------------------------------------------
export class HeadingCounter {
  private counts: number[] = [0, 0, 0, 0, 0, 0];

  next(level: number): string {
    this.counts[level - 1]++;
    this.counts.fill(0, level);
    return this.counts.slice(0, level).join('.') + '.';
  }

  reset(): void {
    this.counts.fill(0);
  }
}

// Module-level WeakMaps store post-processor state per contentEl.
// WeakMap ensures entries are GC'd when the DOM element is removed,
// and avoids `as unknown as` casts to attach state to DOM nodes.
const headingCounterMap = new WeakMap<Element, HeadingCounter>();
const headingLastFileMap = new WeakMap<Element, string>();

// -------------------------------------------------------
// CM6 Widget: renders the number span before heading text
// -------------------------------------------------------
class HeadingNumberWidget extends WidgetType {
  constructor(readonly number: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'de-heading-number';
    span.textContent = this.number + ' ';
    return span;
  }

  eq(other: HeadingNumberWidget): boolean {
    return other.number === this.number;
  }
}

// -------------------------------------------------------
// Parse all headings from the document text
// Returns array of { level, from } where `from` is the
// offset of the first character after "# " marker.
// -------------------------------------------------------
function parseHeadings(doc: { toString(): string }): Array<{ level: number; from: number }> {
  const text = doc.toString();
  const results: Array<{ level: number; from: number }> = [];
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    const m = line.match(/^(#{1,6}) /);
    if (m) {
      const level = m[1].length;
      // `from` points to first char of heading text (after "### ")
      const from = offset + m[1].length + 1;
      results.push({ level, from });
    }
    offset += line.length + 1; // +1 for '\n'
  }
  return results;
}

// -------------------------------------------------------
// CM6 ViewPlugin: Live Preview heading numbers
// -------------------------------------------------------
function buildHeadingDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const counter = new HeadingCounter();

  const headings = parseHeadings(view.state.doc);
  for (const { level, from } of headings) {
    // Ensure position is within document
    if (from > view.state.doc.length) continue;
    const number = counter.next(level);
    builder.add(
      from,
      from,
      Decoration.widget({
        widget: new HeadingNumberWidget(number),
        side: -1,
      })
    );
  }
  return builder.finish();
}

export function createHeadingNumberPlugin(plugin: DocumentEditorPlugin) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = plugin.settings.enableHeadingNumbers
          ? buildHeadingDecorations(view)
          : Decoration.none;
      }

      update(update: ViewUpdate) {
        if (!plugin.settings.enableHeadingNumbers) {
          this.decorations = Decoration.none;
          return;
        }
        if (update.docChanged || update.viewportChanged) {
          // Clear immediately to prevent stale widgets from being mapped
          // to wrong positions (e.g. "# Hello" -> "Hello" would keep the
          // number widget at position 0 of regular text for 300ms).
          this.decorations = Decoration.none;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.decorations = buildHeadingDecorations(update.view);
            update.view.dispatch({});
          }, 300);
        }
      }
    },
    { decorations: (v: { decorations: DecorationSet }) => v.decorations }
  );
}

// -------------------------------------------------------
// Reading View post-processor
// -------------------------------------------------------
export function registerHeadingPostProcessor(plugin: DocumentEditorPlugin) {
  plugin.registerMarkdownPostProcessor(
    (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
      if (!plugin.settings.enableHeadingNumbers) return;

      // Post-processors run per-block, so we need to number
      // headings relative to the full document. We collect
      // all headings in the container (could be the full page
      // when rendered from Reading View).
      // NOTE: Obsidian calls this processor for each section,
      // so we re-count from h1 each time. For accurate numbers
      // across the full document we attach a global counter to
      // the contentEl of the active MarkdownView.

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView) return;

      // Use a counter stored in module-level WeakMaps keyed by contentEl.
      const contentEl = activeView.contentEl;
      let counter = headingCounterMap.get(contentEl);
      const lastFile = headingLastFileMap.get(contentEl);

      const currentFile = activeView.file?.path ?? '';
      if (!counter || lastFile !== currentFile) {
        counter = new HeadingCounter();
        headingCounterMap.set(contentEl, counter);
        headingLastFileMap.set(contentEl, currentFile);
      }

      const headings = el.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
      headings.forEach((h) => {
        // Skip if already numbered
        if (h.querySelector('.de-heading-number')) return;

        const level = parseInt(h.tagName[1], 10);
        const number = counter!.next(level);

        const span = document.createElement('span');
        span.className = 'de-heading-number';
        span.textContent = number + ' ';
        h.insertBefore(span, h.firstChild);
      });
    },
    // Priority: run before other processors
    1
  );
}
