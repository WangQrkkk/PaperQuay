import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPaperTaskState,
  isPaperPipelineBusy,
  isPaperPipelineActionDisabled,
  isPaperTaskRunning,
} from '../src/features/reader/paperTaskState.ts';

test('buildPaperTaskState uses localized labels', () => {
  const state = buildPaperTaskState({
    locale: 'en-US',
    kind: 'overview',
    status: 'running',
    message: 'Generating overview...',
    completed: 10,
    total: 100,
  });

  assert.equal(state.label, 'Overview Generation');
  assert.equal(state.kind, 'overview');
  assert.equal(state.status, 'running');
  assert.equal(state.completed, 10);
  assert.equal(state.total, 100);
});

test('isPaperTaskRunning only matches running states and optional kind', () => {
  const runningState = buildPaperTaskState({
    locale: 'zh-CN',
    kind: 'mineru',
    status: 'running',
    message: '正在解析',
  });
  const successState = buildPaperTaskState({
    locale: 'zh-CN',
    kind: 'mineru',
    status: 'success',
    message: '已完成',
  });

  assert.equal(isPaperTaskRunning(runningState), true);
  assert.equal(isPaperTaskRunning(runningState, 'mineru'), true);
  assert.equal(isPaperTaskRunning(runningState, 'translation'), false);
  assert.equal(isPaperTaskRunning(successState), false);
});

test('pipeline actions are disabled while any paper task is running', () => {
  const runningState = buildPaperTaskState({
    locale: 'en-US',
    kind: 'translation',
    status: 'running',
    message: 'Translating...',
  });

  assert.equal(isPaperPipelineBusy(runningState), true);
  assert.equal(
    isPaperPipelineActionDisabled({
      hasPdf: true,
      hasHandler: true,
      actionState: runningState,
    }),
    true,
  );
  assert.equal(
    isPaperPipelineActionDisabled({
      hasPdf: true,
      hasHandler: true,
      actionState: null,
    }),
    false,
  );
});
