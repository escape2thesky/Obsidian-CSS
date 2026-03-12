export interface DocumentEditorSettings {
  enableHeadingNumbers: boolean;
  enableFigureNumbers: boolean;
  enableTableNumbers: boolean;
  enableEquationNumbers: boolean;
  enableBibliography: boolean;
  bibNumberingOrder: 'citation' | 'table';
  defaultPdfFontSize: number;
  defaultPdfMargin: number;
  autoConvertWikiImages: boolean;
}

export const DEFAULT_SETTINGS: DocumentEditorSettings = {
  enableHeadingNumbers: true,
  enableFigureNumbers: true,
  enableTableNumbers: true,
  enableEquationNumbers: true,
  enableBibliography: true,
  bibNumberingOrder: 'citation',
  defaultPdfFontSize: 11,
  defaultPdfMargin: 20,
  autoConvertWikiImages: true,
};
