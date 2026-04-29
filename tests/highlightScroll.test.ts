import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHighlightScrollKey,
  shouldScrollToHighlight,
} from '../src/features/pdf/highlightScroll.ts';
import type { PdfHighlightTarget } from '../src/types/reader.ts';

const sampleHighlight: PdfHighlightTarget = {
  blockId: 'block-1',
  pageIndex: 0,
  bbox: [12, 24, 180, 260],
  bboxCoordinateSystem: 'pdf',
  bboxPageSize: [595, 842],
};

test('shouldScrollToHighlight returns true for a new highlight target', () => {
  assert.equal(shouldScrollToHighlight('', sampleHighlight), true);
});

test('shouldScrollToHighlight returns false for the same highlight target', () => {
  const key = buildHighlightScrollKey(sampleHighlight);

  assert.equal(shouldScrollToHighlight(key, { ...sampleHighlight }), false);
});

test('buildHighlightScrollKey changes when the highlight target changes', () => {
  const nextKey = buildHighlightScrollKey({
    ...sampleHighlight,
    pageIndex: 3,
  });

  assert.notEqual(nextKey, buildHighlightScrollKey(sampleHighlight));
});
