import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAgentSessionRunning,
  updateAgentRunningSessions,
} from '../src/features/agent/agentRunningSessions.ts';

test('updateAgentRunningSessions adds a running session id', () => {
  const next = updateAgentRunningSessions(new Set<string>(), 'session-1', true);

  assert.equal(isAgentSessionRunning(next, 'session-1'), true);
});

test('updateAgentRunningSessions removes only the targeted session id', () => {
  const next = updateAgentRunningSessions(new Set(['session-1', 'session-2']), 'session-1', false);

  assert.equal(isAgentSessionRunning(next, 'session-1'), false);
  assert.equal(isAgentSessionRunning(next, 'session-2'), true);
});
