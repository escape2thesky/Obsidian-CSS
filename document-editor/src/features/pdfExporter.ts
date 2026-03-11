import { App, Modal, Notice, MarkdownView, MarkdownRenderer, Setting } from 'obsidian';
import type DocumentEditorPlugin from '../main';

// -------------------------------------------------------
// Electron types (available in Obsidian Desktop)
// -------------------------------------------------------
interface ElectronWebContents {
  printToPDF(options: Record<string, unknown>): Promise<Buffer>;
}
interface ElectronWindow {
  webContents: ElectronWebContents;
}
interface ElectronRemote {
  getCurrentWindow(): ElectronWindow;
}
interface ElectronModule {
  remote: ElectronRemote;
}

function getElectronRemote(): ElectronRemote | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).require('electron') as ElectronModule;
    return electron.remote ?? null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------
// PDF Export Modal
// -------------------------------------------------------
export class PdfExportModal extends Modal {
  private plugin: DocumentEditorPlugin;
  private fontSize: number;
  private margin: number;
  private filename: string;
  private previewContentEl!: HTMLElement;
  private previewTimer: number | null = null;

  constructor(app: App, plugin: DocumentEditorPlugin) {
    super(app);
    this.plugin = plugin;
    this.fontSize = plugin.settings.defaultPdfFontSize;
    this.margin = plugin.settings.defaultPdfMargin;
    const activeFile = app.workspace.getActiveViewOfType(MarkdownView)?.file;
    this.filename = (activeFile?.basename ?? 'document') + '.pdf';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('de-pdf-modal-container');

    // ---- Layout: settings pane + preview pane ----
    const layout = contentEl.createDiv({ cls: 'de-pdf-modal' });
    const settingsEl = layout.createDiv({ cls: 'de-pdf-settings' });
    const previewWrap = layout.createDiv({ cls: 'de-pdf-preview-wrap' });
    previewWrap.createSpan({ text: 'A4 プレビュー', cls: 'de-pdf-preview-label' });

    // Preview content area (styled like A4)
    this.previewContentEl = previewWrap.createDiv({ cls: 'de-pdf-preview-content' });
    this.applyPreviewStyles();

    // ---- Settings ----
    settingsEl.createEl('h3', { text: 'PDF出力設定' });

    // Font size
    new Setting(settingsEl)
      .setName(`本文フォントサイズ: ${this.fontSize}pt`)
      .addSlider(sl => sl
        .setLimits(9, 14, 1)
        .setValue(this.fontSize)
        .setDynamicTooltip()
        .onChange(val => {
          this.fontSize = val;
          sl.sliderEl.previousElementSibling?.remove();
          (sl.sliderEl.parentElement?.previousElementSibling as HTMLElement | null)
            ?.setText?.(`本文フォントサイズ: ${val}pt`);
          this.schedulePreviewUpdate();
        }));

    // Margin
    new Setting(settingsEl)
      .setName(`余白: ${this.margin}mm`)
      .addSlider(sl => sl
        .setLimits(10, 30, 5)
        .setValue(this.margin)
        .setDynamicTooltip()
        .onChange(val => {
          this.margin = val;
          this.schedulePreviewUpdate();
        }));

    // Filename
    new Setting(settingsEl)
      .setName('出力ファイル名')
      .addText(text => text
        .setValue(this.filename)
        .onChange(val => { this.filename = val || this.filename; }));

    // Export button
    settingsEl.createEl('button', { text: 'PDFを出力', cls: 'mod-cta de-pdf-export-btn' })
      .addEventListener('click', () => void this.exportPdf());

    // Initial preview render
    void this.updatePreview();
  }

  private applyPreviewStyles(): void {
    this.previewContentEl.style.padding = `${this.margin}mm`;
    this.previewContentEl.style.fontSize = `${this.fontSize}pt`;
    this.previewContentEl.style.lineHeight = '1.6';
    this.previewContentEl.style.maxWidth = '210mm';
    this.previewContentEl.style.background = '#fff';
    this.previewContentEl.style.color = '#000';
  }

  private schedulePreviewUpdate(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.updatePreview();
    }, 500);
  }

  private async updatePreview(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      this.previewContentEl.textContent = 'アクティブなMarkdownファイルがありません。';
      return;
    }

    this.previewContentEl.empty();
    this.applyPreviewStyles();

    const content = await this.app.vault.read(view.file);
    await MarkdownRenderer.render(
      this.app,
      content,
      this.previewContentEl,
      view.file.path,
      view,
    );
  }

  private async exportPdf(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      new Notice('アクティブなMarkdownファイルがありません。');
      return;
    }

    // Ensure filename ends with .pdf
    const filename = this.filename.endsWith('.pdf') ? this.filename : this.filename + '.pdf';

    const remote = getElectronRemote();
    if (remote) {
      await this.exportWithElectron(remote, filename);
    } else {
      this.exportWithPrint();
    }
  }

  private async exportWithElectron(remote: ElectronRemote, filename: string): Promise<void> {
    try {
      new Notice('PDF生成中...');
      const win = remote.getCurrentWindow();
      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: {
          marginType: 'custom',
          top: this.margin / 25.4,   // mm → inches
          bottom: this.margin / 25.4,
          left: this.margin / 25.4,
          right: this.margin / 25.4,
        },
      });

      // Save to vault root
      const outputPath = filename;
      const exists = await this.app.vault.adapter.exists(outputPath);
      if (exists) {
        await this.app.vault.adapter.writeBinary(outputPath, pdfBuffer);
      } else {
        await this.app.vault.adapter.writeBinary(outputPath, pdfBuffer);
      }

      new Notice(`PDF保存完了: ${filename}`);
      this.close();
    } catch (err) {
      console.error('PDF export error:', err);
      new Notice(`PDF生成エラー: ${String(err)}\nブラウザ印刷でお試しください。`);
      this.exportWithPrint();
    }
  }

  private exportWithPrint(): void {
    // Fallback: use browser print
    const printWin = window.open('', '_blank');
    if (!printWin) {
      new Notice('ポップアップがブロックされました。');
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${this.filename}</title>
        <style>
          @page { size: A4; margin: ${this.margin}mm; }
          body { font-size: ${this.fontSize}pt; line-height: 1.6; font-family: serif; }
        </style>
      </head>
      <body>
        ${this.previewContentEl.innerHTML}
      </body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
    printWin.print();
    printWin.close();
  }

  onClose(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.contentEl.empty();
  }
}

// -------------------------------------------------------
// Register PDF export command and ribbon button
// -------------------------------------------------------
export function registerPdfExporter(plugin: DocumentEditorPlugin): void {
  plugin.addCommand({
    id: 'export-pdf',
    name: 'PDFを出力',
    callback: () => {
      new PdfExportModal(plugin.app, plugin).open();
    },
  });

  plugin.addRibbonIcon('file-text', 'PDFを出力 (Document Editor)', () => {
    new PdfExportModal(plugin.app, plugin).open();
  });
}
