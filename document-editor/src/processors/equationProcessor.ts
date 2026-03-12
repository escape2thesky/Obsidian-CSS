import { MarkdownPostProcessorContext } from 'obsidian';
import type DocumentEditorPlugin from '../main';
import { scheduleXRefResolution } from './crossReference';

// -------------------------------------------------------
// Equation counter
// -------------------------------------------------------
class EquationCounter {
  private count = 0;

  next(): number {
    return ++this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

// -------------------------------------------------------
// Selectors for block-level math elements
// MathJax (Obsidian default): mjx-container[display="true"]
// KaTeX fallback: .math.math-block
// -------------------------------------------------------
const BLOCK_MATH_SELECTORS = [
  'mjx-container[display="true"]',
  '.math.math-block',
].join(',');

// -------------------------------------------------------
// Wrap a block math element with a numbered container.
// -------------------------------------------------------
function wrapEquation(mathEl: HTMLElement, n: number): void {
  const wrap = document.createElement('div');
  wrap.className = 'de-equation-wrap';

  const numEl = document.createElement('span');
  numEl.className = 'de-equation-number';
  numEl.textContent = `(${n})`;

  const parent = mathEl.parentElement;
  if (!parent) return;

  parent.insertBefore(wrap, mathEl);
  wrap.appendChild(mathEl);
  wrap.appendChild(numEl);
}

// -------------------------------------------------------
// Unwrap for idempotent re-processing
// -------------------------------------------------------
function unwrapEquations(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.de-equation-wrap').forEach(wrap => {
    const parent = wrap.parentNode;
    if (!parent) return;
    Array.from(wrap.children).forEach(child => {
      if (!child.classList.contains('de-equation-number')) {
        parent.insertBefore(child, wrap);
      }
    });
    wrap.remove();
  });
}

// -------------------------------------------------------
// Process block math elements in el
// -------------------------------------------------------
function processEquations(el: HTMLElement, counter: EquationCounter): void {
  el.querySelectorAll<HTMLElement>(BLOCK_MATH_SELECTORS).forEach(mathEl => {
    if (mathEl.closest('.de-equation-wrap')) return;
    wrapEquation(mathEl, counter.next());
  });
}

// -------------------------------------------------------
// Direct container processing (for manual refresh)
// -------------------------------------------------------
export function processEquationContainer(
  container: HTMLElement,
  settings: { enableEquationNumbers: boolean },
): void {
  if (!settings.enableEquationNumbers) return;
  unwrapEquations(container);
  const counter = new EquationCounter();
  processEquations(container, counter);
}

// -------------------------------------------------------
// Reading View post-processor
// Session-based counter (same approach as figureProcessor)
// -------------------------------------------------------
const SESSION_GAP_MS = 500;

export function registerEquationPostProcessor(plugin: DocumentEditorPlugin): void {
  const counter = new EquationCounter();
  let lastCallTime = 0;
  let lastFile = '';

  plugin.registerMarkdownPostProcessor(
    (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      if (!plugin.settings.enableEquationNumbers) return;

      const now = Date.now();
      const currentFile = ctx.sourcePath;

      if (currentFile !== lastFile || now - lastCallTime > SESSION_GAP_MS) {
        counter.reset();
        lastFile = currentFile;
      }
      lastCallTime = now;

      processEquations(el, counter);
      // Schedule cross-reference resolution so eq labels resolve
      scheduleXRefResolution(plugin);
    },
    20,
  );
}
