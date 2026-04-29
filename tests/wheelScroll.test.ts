import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canScrollInDirection,
  normalizeWheelDelta,
  shouldIgnoreWheelDelegation,
} from '../src/utils/wheelScroll.ts';

test('canScrollInDirection returns true when scrolling down has remaining space', () => {
  assert.equal(
    canScrollInDirection(
      {
        scrollTop: 24,
        scrollHeight: 400,
        clientHeight: 120,
      },
      36,
    ),
    true,
  );
});

test('canScrollInDirection returns false when scrolling up at the top edge', () => {
  assert.equal(
    canScrollInDirection(
      {
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 120,
      },
      -24,
    ),
    false,
  );
});

test('shouldIgnoreWheelDelegation ignores modified wheel gestures', () => {
  assert.equal(
    shouldIgnoreWheelDelegation({
      defaultPrevented: false,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      deltaY: 24,
    }),
    true,
  );
});

test('shouldIgnoreWheelDelegation ignores neutral wheel movement', () => {
  assert.equal(
    shouldIgnoreWheelDelegation({
      defaultPrevented: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      deltaY: 0,
    }),
    true,
  );
});

test('normalizeWheelDelta converts line mode into pixels', () => {
  assert.equal(
    normalizeWheelDelta({
      deltaY: 3,
      deltaMode: 1,
    }),
    48,
  );
});
