import { Plugin, MarkdownView } from 'obsidian';
import { DocumentEditorSettings, DEFAULT_SETTINGS } from './settings';
import { DocumentEditorSettingTab } from './settingsTab';
import {
  createHeadingNumberPlugin,
  registerHeadingPostProcessor,
} from './processors/headingNumberer';
import {
  registerFigurePostProcessor,
  processFigureContainer,
} from './processors/figureProcessor';
import { registerWikiImageConverter } from './processors/wikiImageConverter';
import {
  registerCrossReferenceProcessor,
  clearXRefTimer,
  scheduleXRefResolution,
} from './processors/crossReference';
import {
  registerEquationPostProcessor,
  processEquationContainer,
} from './processors/equationProcessor';
import {
  registerBibliographyPostProcessor,
  processBibliographyContainer,
  clearBibTimer,
} from './processors/bibliographyProcessor';
import { registerTocCommands } from './features/tocGenerator';
import { registerPdfExporter } from './features/pdfExporter';

export default class DocumentEditorPlugin extends Plugin {
  settings: DocumentEditorSettings = DEFAULT_SETTINGS;
  private rerenderTimer: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DocumentEditorSettingTab(this.app, this));

    // Task 2: Heading auto-numbering (CM6 Live Preview + Reading View)
    this.registerEditorExtension(createHeadingNumberPlugin(this));
    registerHeadingPostProcessor(this);

    // Task 3: Figure/table centering and numbering
    registerFigurePostProcessor(this);
    registerWikiImageConverter(this);

    // Task 4: Cross-references (runs after figure/heading processors, priority 50)
    registerCrossReferenceProcessor(this);

    // Task 5: Equation numbering (priority 20)
    registerEquationPostProcessor(this);

    // Task 7: Bibliography
    registerBibliographyPostProcessor(this);

    // Task 6: TOC generation commands
    registerTocCommands(this);

    // Task 8: PDF export command + ribbon
    registerPdfExporter(this);

    // ---- Startup: re-process already-open Reading Views ----
    this.app.workspace.onLayoutReady(() => {
      this.scheduleRerender(800);
    });

    // Re-process on leaf/layout changes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.scheduleRerender(300);
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.scheduleRerender(300);
      }),
    );

    // Manual refresh command
    this.addCommand({
      id: 'rerender-figures',
      name: '図表・数式・参考文献をリフレッシュ',
      callback: () => {
        this.rerenderAllReadingViews();
      },
    });

    // Ribbon: refresh
    this.addRibbonIcon('refresh-cw', '図表番号をリフレッシュ (Document Editor)', () => {
      this.rerenderAllReadingViews();
    });

    console.log('Document Editor: loaded');
  }

  private scheduleRerender(delay: number): void {
    if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
    this.rerenderTimer = window.setTimeout(() => {
      this.rerenderTimer = null;
      this.rerenderAllReadingViews();
    }, delay);
  }

  rerenderAllReadingViews(): void {
    this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
      const view = leaf.view as MarkdownView;
      if (view.getMode() !== 'preview') return;

      const container = view.previewMode.containerEl;

      // Order matters: figures/tables → equations → cross-refs → bibliography
      processFigureContainer(container, this.settings);
      processEquationContainer(container, this.settings);
      processBibliographyContainer(container, this.settings);
      // Cross-references resolve after all numbering is done
      scheduleXRefResolution(this);
    });
  }

  onunload() {
    if (this.rerenderTimer !== null) window.clearTimeout(this.rerenderTimer);
    clearXRefTimer();
    clearBibTimer();
    console.log('Document Editor: unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
