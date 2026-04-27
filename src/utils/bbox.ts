import type { CSSProperties } from 'react';
import type { BBox, PositionedMineruBlock } from '../types/reader';

export interface PageSize {
  width: number;
  height: number;
}

export interface BBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const HOTSPOT_EXCLUDED_TYPES = new Set([
  'page_header',
  'page_footer',
  'page_number',
  'page_footnote',
]);

export function isValidBBox(bbox?: BBox): bbox is BBox {
  if (!bbox || bbox.length !== 4) {
    return false;
  }

  const [x1, y1, x2, y2] = bbox;

  return (
    Number.isFinite(x1) &&
    Number.isFinite(y1) &&
    Number.isFinite(x2) &&
    Number.isFinite(y2) &&
    x2 > x1 &&
    y2 > y1
  );
}

export function shouldCreateHotspot(
  block: Pick<PositionedMineruBlock, 'type' | 'bbox'>,
): boolean {
  return isValidBBox(block.bbox) && !HOTSPOT_EXCLUDED_TYPES.has(block.type);
}

export function bboxToRect(
  bbox: BBox,
  originalPage: PageSize,
  renderedPage: PageSize,
): BBoxRect {
  const scaleX = renderedPage.width / originalPage.width;
  const scaleY = renderedPage.height / originalPage.height;
  const [x1, y1, x2, y2] = bbox;

  return {
    left: x1 * scaleX,
    top: y1 * scaleY,
    width: (x2 - x1) * scaleX,
    height: (y2 - y1) * scaleY,
  };
}

export function bboxToCssStyle(
  bbox: BBox,
  originalPage: PageSize,
  renderedPage: PageSize,
): CSSProperties {
  const rect = bboxToRect(bbox, originalPage, renderedPage);

  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}
