import test from 'node:test';
import assert from 'node:assert/strict';

import {
  patchAgentHistorySessionMessage,
  upsertAgentHistorySession,
} from '../src/features/agent/agentSessionState.ts';
import type { AgentChatMessage, AgentHistorySession } from '../src/features/agent/AgentWorkspace.types.ts';

function message(id: string, role: AgentChatMessage['role'], content: string): AgentChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
  };
}

function session(id: string, messages: AgentChatMessage[]): AgentHistorySession {
  return {
    id,
    title: id,
    summary: id,
    updatedAt: 1,
    messages,
    selectedPaperIds: [],
    lastInstruction: '',
    status: 'success',
  };
}

test('upsertAgentHistorySession inserts and replaces by session id', () => {
  const sessions = upsertAgentHistorySession([], {
    sessionId: 's1',
    messages: [message('m1', 'assistant', 'hello')],
    selectedPaperIds: ['p1'],
    lastInstruction: 'hi',
    locale: 'en-US',
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 's1');

  const replaced = upsertAgentHistorySession(sessions, {
    sessionId: 's1',
    messages: [message('m2', 'assistant', 'updated')],
    selectedPaperIds: ['p2'],
    lastInstruction: 'updated',
    locale: 'en-US',
  });

  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].messages[0]?.id, 'm2');
  assert.deepEqual(replaced[0].selectedPaperIds, ['p2']);
});

test('patchAgentHistorySessionMessage only updates the targeted session and message', () => {
  const sessions = [
    session('s1', [message('m1', 'assistant', 'old'), message('m2', 'user', 'keep')]),
    session('s2', [message('m3', 'assistant', 'other')]),
  ];

  const patched = patchAgentHistorySessionMessage(sessions, {
    sessionId: 's1',
    messageId: 'm1',
    updater: (current) => ({ ...current, content: 'new' }),
    locale: 'en-US',
  });

  assert.equal(patched[0].id, 's1');
  assert.equal(patched[0].messages[0]?.content, 'new');
  assert.equal(patched[0].messages[1]?.content, 'keep');
  assert.equal(patched[1].messages[0]?.content, 'other');
});

test('upsertAgentHistorySession marks a session as running when the latest assistant trace is running', () => {
  const sessions = upsertAgentHistorySession([], {
    sessionId: 's1',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Agent is replying...',
        createdAt: 1,
        trace: [
          {
            id: 'trace-1',
            type: 'intent',
            title: 'Understanding request',
            summary: 'The Agent is processing the instruction.',
            status: 'running',
          },
        ],
      },
    ],
    selectedPaperIds: [],
    lastInstruction: 'classify selected papers',
    locale: 'en-US',
  });

  assert.equal(sessions[0]?.status, 'running');
});
