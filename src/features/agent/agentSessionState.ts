import { buildAgentHistorySession } from './AgentWorkspace.model.ts';
import type { AgentChatMessage, AgentHistorySession } from './AgentWorkspace.types.ts';
import type { UiLanguage } from '../../types/reader.ts';

interface SessionSnapshotInput {
  sessionId: string;
  messages: AgentChatMessage[];
  selectedPaperIds: string[];
  lastInstruction: string;
  locale: UiLanguage;
}

export function upsertAgentHistorySession(
  sessions: AgentHistorySession[],
  input: SessionSnapshotInput,
): AgentHistorySession[] {
  const nextSession = buildAgentHistorySession({
    id: input.sessionId,
    messages: input.messages,
    selectedPaperIds: input.selectedPaperIds,
    lastInstruction: input.lastInstruction,
    locale: input.locale,
  });
  const otherSessions = sessions.filter((session) => session.id !== input.sessionId);

  return [nextSession, ...otherSessions].slice(0, 30);
}

export function patchAgentHistorySessionMessage(
  sessions: AgentHistorySession[],
  {
    sessionId,
    messageId,
    updater,
    locale,
  }: {
    sessionId: string;
    messageId: string;
    updater: (message: AgentChatMessage) => AgentChatMessage;
    locale: UiLanguage;
  },
): AgentHistorySession[] {
  const targetSession = sessions.find((session) => session.id === sessionId);

  if (!targetSession) {
    return sessions;
  }

  const nextMessages = targetSession.messages.map((message) =>
    message.id === messageId ? updater(message) : message,
  );

  return upsertAgentHistorySession(sessions, {
    sessionId,
    messages: nextMessages,
    selectedPaperIds: targetSession.selectedPaperIds,
    lastInstruction: targetSession.lastInstruction,
    locale,
  });
}
