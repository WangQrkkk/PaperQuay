export const PDFJS_ASSET_PROTOCOL = 'paperquay-pdf-assets';
export const PDFJS_ASSET_ROOT_URL = `${PDFJS_ASSET_PROTOCOL}://pdfjs/`;

export const PDFJS_COMPATIBILITY_OPTIONS = {
  cMapUrl: `${PDFJS_ASSET_ROOT_URL}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_ASSET_ROOT_URL}standard_fonts/`,
  useSystemFonts: true,
  useWorkerFetch: true,
  disableFontFace: false,
  stopAtErrors: false,
  fontExtraProperties: true,
} as const;

export function buildPdfJsDataDocumentInit(data: Uint8Array) {
  return {
    ...PDFJS_COMPATIBILITY_OPTIONS,
    data,
  };
}
