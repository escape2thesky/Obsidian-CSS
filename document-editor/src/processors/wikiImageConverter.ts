import { App, Editor, MarkdownFileInfo, MarkdownView, TFile } from 'obsidian';
import type DocumentEditorPlugin from '../main';

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff?)$/i;
const WIKI_IMAGE_RE = /!\[\[([^\]|]+(?:\|[^\]]*)?)\]\]/g;

// -------------------------------------------------------
// Compute vault-relative path from one file to another.
// Both paths are vault-root-relative (Obsidian TFile.path format).
// -------------------------------------------------------
function getRelativePath(fromFilePath: string, toFilePath: string): string {
  const lastSlash = fromFilePath.lastIndexOf('/');
  const fromDir = lastSlash >= 0 ? fromFilePath.substring(0, lastSlash) : '';
  const fromParts = fromDir ? fromDir.split('/') : [];
  const toParts = toFilePath.split('/');

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.slice(common).map(() => '..');
  const downs = toParts.slice(common);
  return [...ups, ...downs].join('/') || toFilePath;
}

// -------------------------------------------------------
// Encode a relative path for use inside a Markdown link.
// Encodes each path segment with encodeURIComponent but
// preserves the '/' separators.
// -------------------------------------------------------
function encodeMarkdownPath(relativePath: string): string {
  return relativePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

// -------------------------------------------------------
// Build the replacement Markdown image string.
// -------------------------------------------------------
function buildMarkdownImage(altText: string, relativePath: string): string {
  return `![${altText}](${encodeMarkdownPath(relativePath)})`;
}

// -------------------------------------------------------
// Replace wiki image links for a KNOWN target file.
// Called from the vault 'create' listener — no metadata
// cache lookup needed, we already have the exact TFile.
// -------------------------------------------------------
function replaceWikiLinksForFile(
  editor: Editor,
  sourceFilePath: string,
  targetFile: TFile
): void {
  const escapedName = targetFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match ![[filename.ext]] or ![[filename.ext|alias]]
  const re = new RegExp(
    `!\\[\\[([^\\]|]*${escapedName}(?:\\|[^\\]]*)?)\\]\\]`,
    'g'
  );

  const lineCount = editor.lineCount();
  for (let lineNum = lineCount - 1; lineNum >= 0; lineNum--) {
    const line = editor.getLine(lineNum);
    if (!line.includes('![[')) continue;

    type Span = { from: number; to: number; text: string };
    const spans: Span[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(line)) !== null) {
      const inner = m[1];
      const pipeIdx = inner.indexOf('|');
      const alias = pipeIdx >= 0 ? inner.substring(pipeIdx + 1).trim() : undefined;
      const altText = alias ?? targetFile.basename;
      const relativePath = getRelativePath(sourceFilePath, targetFile.path);

      spans.push({ from: m.index, to: m.index + m[0].length, text: buildMarkdownImage(altText, relativePath) });
    }

    // Apply in reverse column order so offsets stay valid
    for (let i = spans.length - 1; i >= 0; i--) {
      const { from, to, text } = spans[i];
      editor.replaceRange(text, { line: lineNum, ch: from }, { line: lineNum, ch: to });
    }
  }
}

// -------------------------------------------------------
// Fallback: scan the whole editor for any wiki image links
// and convert them using the metadata cache for path lookup.
// Used on editor-change (debounced) for files that existed
// before the editor was opened.
// -------------------------------------------------------
function replaceAllWikiLinksViaCache(
  editor: Editor,
  sourceFilePath: string,
  app: App
): void {
  const lineCount = editor.lineCount();

  for (let lineNum = lineCount - 1; lineNum >= 0; lineNum--) {
    const line = editor.getLine(lineNum);
    if (!line.includes('![[')) continue;

    type Span = { from: number; to: number; text: string };
    const spans: Span[] = [];
    const re = new RegExp(WIKI_IMAGE_RE.source, 'g');
    let m: RegExpExecArray | null;

    while ((m = re.exec(line)) !== null) {
      const inner = m[1];
      const pipeIdx = inner.indexOf('|');
      const filePart = (pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner).trim();
      const alias = pipeIdx >= 0 ? inner.substring(pipeIdx + 1).trim() : undefined;

      if (!IMAGE_EXT_RE.test(filePart)) continue;

      const file = app.metadataCache.getFirstLinkpathDest(filePart, sourceFilePath);
      if (!file) continue; // not yet indexed — skip

      const altText = alias ?? file.basename;
      const relativePath = getRelativePath(sourceFilePath, file.path);

      spans.push({ from: m.index, to: m.index + m[0].length, text: buildMarkdownImage(altText, relativePath) });
    }

    for (let i = spans.length - 1; i >= 0; i--) {
      const { from, to, text } = spans[i];
      editor.replaceRange(text, { line: lineNum, ch: from }, { line: lineNum, ch: to });
    }
  }
}

// -------------------------------------------------------
// Register both listeners.
// -------------------------------------------------------
export function registerWikiImageConverter(plugin: DocumentEditorPlugin) {
  // --- Primary path: vault 'create' fires when a new file is saved ---
  // At this point we have the exact TFile with the correct vault path,
  // so no metadata cache lookup is needed.
  plugin.registerEvent(
    plugin.app.vault.on('create', (abstractFile) => {
      if (!plugin.settings.autoConvertWikiImages) return;
      if (!(abstractFile instanceof TFile)) return;
      if (!IMAGE_EXT_RE.test(abstractFile.name)) return;

      // Give Obsidian a tick to finish inserting the wiki link into the editor
      setTimeout(() => {
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor || !view.file) return;

        replaceWikiLinksForFile(view.editor, view.file.path, abstractFile);
      }, 50);
    })
  );

  // --- Fallback path: editor-change for pre-existing wiki image links ---
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  plugin.registerEvent(
    plugin.app.workspace.on(
      'editor-change',
      (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        if (!plugin.settings.autoConvertWikiImages) return;
        const sourceFilePath = info.file?.path;
        if (!sourceFilePath) return;

        // Quick bail-out: no wiki image syntax in the document
        const value = editor.getValue();
        if (!value.includes('![[')) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          replaceAllWikiLinksViaCache(editor, sourceFilePath, plugin.app);
        }, 600); // longer delay to let the metadata cache settle
      }
    )
  );
}
