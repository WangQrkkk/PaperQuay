import type { PdfSource } from '../../types/reader';
import { PDFJS_COMPATIBILITY_OPTIONS } from '../../utils/pdfJsCompatibility.ts';

export const LOCAL_PDF_PROTOCOL = 'paperquay-pdf';

export interface PdfJsDocumentInit {
  cMapPacked?: boolean;
  cMapUrl?: string;
  data?: Uint8Array;
  disableAutoFetch?: boolean;
  disableFontFace?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  enableHWA?: boolean;
  fontExtraProperties?: boolean;
  isEvalSupported?: boolean;
  isOffscreenCanvasSupported?: boolean;
  rangeChunkSize?: number;
  standardFontDataUrl?: string;
  stopAtErrors?: boolean;
  useSystemFonts?: boolean;
  useWorkerFetch?: boolean;
  httpHeaders?: Record<string, string>;
  url?: string;
}

const PDF_LOADING_OPTIONS = {
  ...PDFJS_COMPATIBILITY_OPTIONS,
  enableHWA: true,
  isEvalSupported: false,
  isOffscreenCanvasSupported: true,
  rangeChunkSize: 1024 * 1024,
} as const;

const URL_PDF_LOADING_OPTIONS = {
  ...PDF_LOADING_OPTIONS,
  disableAutoFetch: false,
  disableStream: false,
} as const;

export function buildLocalPdfProtocolUrl(path: string): string {
  return `${LOCAL_PDF_PROTOCOL}://local/?path=${encodeURIComponent(path)}`;
}

export function buildPdfJsDocumentInit(
  source: PdfSource,
  pdfData: Uint8Array | null,
): PdfJsDocumentInit | null {
  if (source?.kind === 'local-path') {
    return {
      ...URL_PDF_LOADING_OPTIONS,
      url: buildLocalPdfProtocolUrl(source.path),
    };
  }

  if (source?.kind === 'remote-url') {
    return source.headers
      ? {
          ...URL_PDF_LOADING_OPTIONS,
          url: source.url,
          httpHeaders: source.headers,
        }
      : {
          ...URL_PDF_LOADING_OPTIONS,
          url: source.url,
        };
  }

  if (pdfData) {
    return {
      ...PDF_LOADING_OPTIONS,
      data: pdfData,
    };
  }

  return null;
}

export function getPdfSourceSignature(source: PdfSource, fallback = ''): string {
  if (source?.kind === 'local-path') {
    return `local:${source.path}`;
  }

  if (source?.kind === 'remote-url') {
    return `remote:${source.url}`;
  }

  return fallback;
}
