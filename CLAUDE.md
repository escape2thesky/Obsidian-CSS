# CLAUDE.md - Document Editor Plugin 開発規約

## プロジェクト概要
- **プラグイン名**: Document Editor
- **場所**: `document-editor/` サブディレクトリ
- **言語**: TypeScript (strict mode)
- **ビルド**: esbuild (`npm run build`)
- **対象**: Obsidian Desktop (isDesktopOnly: true)

## ディレクトリ構成
```
document-editor/
├── src/
│   ├── main.ts                     # Plugin エントリポイント
│   ├── settings.ts                 # 設定型定義
│   ├── settingsTab.ts              # 設定UI
│   ├── processors/
│   │   ├── headingNumberer.ts      # 見出し番号（CM6 + post-processor）
│   │   ├── figureProcessor.ts      # 図・表キャプション
│   │   ├── equationProcessor.ts    # 数式番号
│   │   ├── crossReference.ts       # ラベル・相互参照
│   │   └── bibliographyProcessor.ts# 参考文献
│   └── features/
│       ├── tocGenerator.ts         # TOC生成
│       └── pdfExporter.ts          # PDF出力
├── styles.css
├── manifest.json
├── package.json
└── tsconfig.json
```

## 開発コマンド
```bash
cd document-editor
npm install          # 初回のみ
npm run build        # 本番ビルド
npm run dev          # 開発モード（watch）
```

## コーディング規約

### TypeScript
- `strict: true` を常に維持する
- `any` 型は使用禁止（やむを得ない場合は `unknown` + type guard）
- Optional chaining `?.` を積極的に使う

### パフォーマンス必須事項
- **エディタ変更イベントには必ずdebounce（最小300ms）を付ける**
- DOM操作はpost-processor内で完結させる（Markdown本文は変更しない）
- イベントリスナーは `onunload()` で必ず解除する
- `registerMarkdownPostProcessor()` 内で重い処理をしない

### パフォーマンス禁止事項
- エディタ変更のたびにドキュメント全体をパースする（→ debounceすること）
- `setInterval` の使用（→ ResizeObserver/MutationObserver を使う）
- ファイルI/Oをpost-processor内で行う

### ラベル・参照構文（ユーザー向け）
```
{#fig:label}   # 図ラベル
{#tbl:label}   # 表ラベル
{#eq:label}    # 数式ラベル
{#sec:label}   # 見出しラベル
{#bib:key}     # 参考文献キー（非推奨、テーブルのkeyカラムを使うこと）

[ref:fig:label]   # 図参照
[ref:tbl:label]   # 表参照
[ref:eq:label]    # 数式参照
[ref:sec:label]   # 見出し参照
[ref:bib:key]     # 参考文献参照
```

## Obsidian API 注意事項
- `app.workspace.getActiveViewOfType(MarkdownView)` でアクティブビュー取得
- `registerMarkdownPostProcessor()` はReading Viewのみ（Live PreviewはCM6）
- CM6拡張は `registerEditorExtension()` で登録し、unloadで解除
- PDF出力は `electron` モジュールを使用（Desktop専用）
- ファイル保存は `app.vault.adapter.write()` を使用

## テスト方法
1. `npm run build` でビルド
2. Obsidianの設定 > コミュニティプラグイン > フォルダを開く
3. `document-editor/` フォルダをVaultの `.obsidian/plugins/` にコピー
4. Obsidianを再起動 > プラグインを有効化
5. テスト用Markdownファイルで各機能を確認

## よくあるミス
- post-processorが複数回呼ばれても冪等（同じ結果）になるよう実装する
- `el.querySelector()` で要素が見つからない場合のnullチェックを忘れない
- CM6 Decorationの更新でViewUpdateを毎回全部再計算しない（変更分のみ）
