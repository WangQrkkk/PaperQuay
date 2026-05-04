export const WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY = 'paper-reader-workspace-header-collapsed-v1';
export const ASSISTANT_PANEL_WIDTH_STORAGE_KEY = 'paper-reader-assistant-panel-width-v1';
export const MIN_ASSISTANT_PANEL_WIDTH = 336;
export const MAX_ASSISTANT_PANEL_WIDTH = 720;

export interface ReaderWorkspaceDocument {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  source: string;
}

export type LocaleTextFn = (zh: string, en: string) => string;

export function formatReaderDocumentSource(
  l: LocaleTextFn,
  currentDocument: ReaderWorkspaceDocument,
  selectedSectionTitle: string,
): string {
  return currentDocument.source === 'standalone'
    ? l('独立文献', 'Standalone Document')
    : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;
}

export function formatReaderDocumentMeta(
  l: LocaleTextFn,
  currentDocument: ReaderWorkspaceDocument,
): string {
  return `${currentDocument.creators || l('未知作者', 'Unknown Author')}${
    currentDocument.year ? ` · ${currentDocument.year}` : ''
  }`;
}

export function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

export function loadStoredNumber(key: string, fallback: number): number {
  try {
    const rawValue = Number(localStorage.getItem(key));

    return Number.isFinite(rawValue) ? rawValue : fallback;
  } catch {
    return fallback;
  }
}
