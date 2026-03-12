import { MarkdownView } from 'obsidian';
import type DocumentEditorPlugin from '../main';
import { HeadingCounter } from '../processors/headingNumberer';

// -------------------------------------------------------
// TOC block delimiters
// -------------------------------------------------------
const TOC_START = '<!-- TOC -->';
const TOC_END = '<!-- /TOC -->';

// -------------------------------------------------------
// Generate TOC markdown from document content.
// Only H1-H3 are included.
// Heading numbers match the same algorithm as headingNumberer.ts.
// -------------------------------------------------------
export function generateToc(content: string): string {
  const counter = new HeadingCounter();
  const lines = content.split('\n');
  const tocLines: string[] = [TOC_START];

  for (const line of lines) {
    // Skip existing TOC block content
    if (line === TOC_START || line === TOC_END) continue;

    const m = line.match(/^(#{1,3}) (.+)/);
    if (!m) continue;

    const level = m[1].length;
    // Strip inline labels and trailing whitespace from heading text
    const text = m[2].replace(/\{#[^\}]+\}/g, '').trim();
    const number = counter.next(level);
    const indent = '  '.repeat(level - 1);
    tocLines.push(`${indent}- ${number} ${text}`);
  }

  tocLines.push(TOC_END);
  return tocLines.join('\n');
}

// -------------------------------------------------------
// Find existing TOC block and return its editor range
// Returns null if no TOC block found.
// -------------------------------------------------------
function findExistingTocRange(
  content: string,
): { startLine: number; endLine: number } | null {
  const lines = content.split('\n');
  let startLine = -1;
  let endLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === TOC_START) startLine = i;
    if (lines[i].trimEnd() === TOC_END && startLine >= 0) {
      endLine = i;
      break;
    }
  }

  if (startLine < 0 || endLine < 0) return null;
  return { startLine, endLine };
}

// -------------------------------------------------------
// Register TOC commands
// -------------------------------------------------------
export function registerTocCommands(plugin: DocumentEditorPlugin): void {
  // Insert TOC at cursor position
  plugin.addCommand({
    id: 'insert-toc-at-cursor',
    name: 'TOCをカーソル位置に挿入',
    editorCallback: (editor) => {
      const toc = generateToc(editor.getValue());
      editor.replaceSelection(toc + '\n\n');
    },
  });

  // Insert TOC at file top
  plugin.addCommand({
    id: 'insert-toc-at-top',
    name: 'TOCをファイル先頭に挿入',
    editorCallback: (editor) => {
      const toc = generateToc(editor.getValue());
      editor.replaceRange(toc + '\n\n', { line: 0, ch: 0 });
    },
  });

  // Update existing TOC block
  plugin.addCommand({
    id: 'update-toc',
    name: '既存TOCを更新',
    editorCallback: (editor) => {
      const content = editor.getValue();
      const range = findExistingTocRange(content);
      if (!range) {
        // No existing TOC — insert at cursor
        const toc = generateToc(content);
        editor.replaceSelection(toc + '\n\n');
        return;
      }
      const toc = generateToc(content);
      editor.replaceRange(
        toc,
        { line: range.startLine, ch: 0 },
        { line: range.endLine, ch: TOC_END.length },
      );
    },
  });

  // Ribbon icon shortcut for TOC update
  plugin.addCommand({
    id: 'refresh-toc-reading-view',
    name: 'TOCを再描画 (Reading View)',
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== 'preview') return false;
      if (checking) return true;
      // Force re-render by switching mode briefly — use Obsidian's leaf refresh
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (view as unknown as { previewMode: { rerender: (force: boolean) => void } }).previewMode.rerender(true);
      return true;
    },
  });
}
