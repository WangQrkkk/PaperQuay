import type { PdfHighlightTarget } from '../../types/reader.ts';

export function buildHighlightScrollKey(target: PdfHighlightTarget | null): string {
  if (!target) {
    return '';
  }

  return [
    target.blockId,
    target.pageIndex,
    target.bbox.join(','),
    target.bboxCoordinateSystem ?? '',
    target.bboxPageSize?.join(',') ?? '',
  ].join('|');
}

export function shouldScrollToHighlight(
  lastScrollKey: string,
  target: PdfHighlightTarget | null,
): boolean {
  const nextKey = buildHighlightScrollKey(target);
  return nextKey !== '' && nextKey !== lastScrollKey;
}
