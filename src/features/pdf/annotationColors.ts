import { AnnotationEditorParamsType } from 'pdfjs-dist';

export type PdfAnnotationColorTool = 'highlight' | 'freetext' | 'ink';

export interface PdfAnnotationToolColors {
  highlight: string;
  freetext: string;
  ink: string;
}

export interface PdfAnnotationColorPreset {
  id: 'yellow' | 'green' | 'blue' | 'pink' | 'red';
  label: string;
  highlightHex: string;
  editorHex: string;
}

const ANNOTATION_COLORS_STORAGE_KEY = 'paperquay-pdf-annotation-colors-v1';

export const PDF_ANNOTATION_COLOR_PRESETS: PdfAnnotationColorPreset[] = [
  {
    id: 'yellow',
    label: 'Yellow',
    highlightHex: '#fef08a',
    editorHex: '#ca8a04',
  },
  {
    id: 'green',
    label: 'Green',
    highlightHex: '#86efac',
    editorHex: '#16a34a',
  },
  {
    id: 'blue',
    label: 'Blue',
    highlightHex: '#93c5fd',
    editorHex: '#2563eb',
  },
  {
    id: 'pink',
    label: 'Pink',
    highlightHex: '#f9a8d4',
    editorHex: '#db2777',
  },
  {
    id: 'red',
    label: 'Red',
    highlightHex: '#fca5a5',
    editorHex: '#dc2626',
  },
];

export const DEFAULT_PDF_ANNOTATION_TOOL_COLORS: PdfAnnotationToolColors = {
  highlight: PDF_ANNOTATION_COLOR_PRESETS[0].highlightHex,
  freetext: PDF_ANNOTATION_COLOR_PRESETS[2].editorHex,
  ink: PDF_ANNOTATION_COLOR_PRESETS[4].editorHex,
};

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function normalizeHexColor(value: string) {
  return value.trim().toLowerCase();
}

export function loadPdfAnnotationToolColors(): PdfAnnotationToolColors {
  try {
    const rawValue = localStorage.getItem(ANNOTATION_COLORS_STORAGE_KEY);

    if (!rawValue) {
      return DEFAULT_PDF_ANNOTATION_TOOL_COLORS;
    }

    const parsed = JSON.parse(rawValue) as Partial<PdfAnnotationToolColors>;

    return {
      highlight: isHexColor(parsed.highlight)
        ? normalizeHexColor(parsed.highlight)
        : DEFAULT_PDF_ANNOTATION_TOOL_COLORS.highlight,
      freetext: isHexColor(parsed.freetext)
        ? normalizeHexColor(parsed.freetext)
        : DEFAULT_PDF_ANNOTATION_TOOL_COLORS.freetext,
      ink: isHexColor(parsed.ink)
        ? normalizeHexColor(parsed.ink)
        : DEFAULT_PDF_ANNOTATION_TOOL_COLORS.ink,
    };
  } catch {
    return DEFAULT_PDF_ANNOTATION_TOOL_COLORS;
  }
}

export function persistPdfAnnotationToolColors(colors: PdfAnnotationToolColors) {
  try {
    localStorage.setItem(
      ANNOTATION_COLORS_STORAGE_KEY,
      JSON.stringify({
        highlight: normalizeHexColor(colors.highlight),
        freetext: normalizeHexColor(colors.freetext),
        ink: normalizeHexColor(colors.ink),
      }),
    );
  } catch {
    // 忽略本地持久化失败，避免影响批注主流程。
  }
}

export function buildPdfJsHighlightColorOptions() {
  return PDF_ANNOTATION_COLOR_PRESETS.map(
    (preset) => `${preset.id}=${preset.highlightHex}`,
  ).join(',');
}

export function getPdfAnnotationColorValue(
  preset: PdfAnnotationColorPreset,
  tool: PdfAnnotationColorTool,
) {
  return tool === 'highlight' ? preset.highlightHex : preset.editorHex;
}

export function getPdfAnnotationParamType(tool: PdfAnnotationColorTool) {
  switch (tool) {
    case 'highlight':
      return AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR;
    case 'freetext':
      return AnnotationEditorParamsType.FREETEXT_COLOR;
    case 'ink':
      return AnnotationEditorParamsType.INK_COLOR;
  }
}

export function applyPdfAnnotationToolColors(
  uiManager: { updateParams?: (type: number, value: string) => void } | null | undefined,
  colors: PdfAnnotationToolColors,
) {
  if (!uiManager?.updateParams) {
    return;
  }

  uiManager.updateParams(
    AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
    normalizeHexColor(colors.highlight),
  );
  uiManager.updateParams(
    AnnotationEditorParamsType.FREETEXT_COLOR,
    normalizeHexColor(colors.freetext),
  );
  uiManager.updateParams(
    AnnotationEditorParamsType.INK_COLOR,
    normalizeHexColor(colors.ink),
  );
}
