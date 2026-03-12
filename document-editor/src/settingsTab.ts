import { App, PluginSettingTab, Setting } from 'obsidian';
import DocumentEditorPlugin from './main';

export class DocumentEditorSettingTab extends PluginSettingTab {
  plugin: DocumentEditorPlugin;

  constructor(app: App, plugin: DocumentEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Document Editor Settings' });

    new Setting(containerEl)
      .setName('見出し自動番号付け')
      .setDesc('H1=1., H2=1.1, H3=1.1.1 形式で番号を表示します（Markdownは変更しません）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableHeadingNumbers)
        .onChange(async (value) => {
          this.plugin.settings.enableHeadingNumbers = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('wiki画像リンクを自動変換')
      .setDesc('![[image.png]] 形式を ![image](image.png) 形式に自動変換します（ペースト時など）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoConvertWikiImages)
        .onChange(async (value) => {
          this.plugin.settings.autoConvertWikiImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('図番号を自動付与')
      .setDesc('画像に自動で「図N: キャプション」を表示します')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableFigureNumbers)
        .onChange(async (value) => {
          this.plugin.settings.enableFigureNumbers = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('表番号を自動付与')
      .setDesc('テーブルに自動で「表N」を表示し、中央揃えにします')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableTableNumbers)
        .onChange(async (value) => {
          this.plugin.settings.enableTableNumbers = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('数式番号を自動付与')
      .setDesc('ブロック数式に自動で (N) の番号を付けます')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableEquationNumbers)
        .onChange(async (value) => {
          this.plugin.settings.enableEquationNumbers = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('参考文献管理')
      .setDesc('keyカラムを持つテーブルを参考文献として自動番号付けします')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableBibliography)
        .onChange(async (value) => {
          this.plugin.settings.enableBibliography = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('参考文献の番号順')
      .setDesc('「参照順」: 文書内で最初に参照された順番。「テーブル行順」: テーブルの行順番')
      .addDropdown(dropdown => dropdown
        .addOption('citation', '参照順')
        .addOption('table', 'テーブル行順')
        .setValue(this.plugin.settings.bibNumberingOrder)
        .onChange(async (value) => {
          this.plugin.settings.bibNumberingOrder = value as 'citation' | 'table';
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'PDF出力デフォルト設定' });

    new Setting(containerEl)
      .setName('デフォルト本文フォントサイズ (pt)')
      .addSlider(slider => slider
        .setLimits(9, 14, 1)
        .setValue(this.plugin.settings.defaultPdfFontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultPdfFontSize = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('デフォルト余白 (mm)')
      .addSlider(slider => slider
        .setLimits(10, 30, 5)
        .setValue(this.plugin.settings.defaultPdfMargin)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultPdfMargin = value;
          await this.plugin.saveSettings();
        }));
  }
}
