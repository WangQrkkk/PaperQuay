import type {
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperAnnotation,
  PaperHistoryRecord,
} from '../types/reader';

const PAPER_HISTORY_STORAGE_KEY = 'paper-reader-paper-history-v1';
const PAPER_HISTORY_VERSION = 4;

function stripAttachmentForHistory(
  attachment: DocumentChatAttachment,
): DocumentChatAttachment {
  return {
    ...attachment,
    dataUrl: undefined,
    textContent: undefined,
  };
}

function stripMessageForHistory(message: DocumentChatMessage): DocumentChatMessage {
  return {
    ...message,
    attachments: message.attachments?.map(stripAttachmentForHistory),
  };
}

function buildSessionTitle(messages: DocumentChatMessage[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.content.trim(),
  );

  if (!firstUserMessage) {
    return '鏂板璇?;
  }

  const normalizedContent = firstUserMessage.content.replace(/\s+/g, ' ').trim();

  return normalizedContent.length > 36
    ? `${normalizedContent.slice(0, 36)}…`
    : normalizedContent;
}

function stripSessionForHistory(session: DocumentChatSession): DocumentChatSession {
  const firstMessage = session.messages[0];
  const lastMessage = session.messages[session.messages.length - 1];

  return {
    ...session,
    title: session.title.trim() || buildSessionTitle(session.messages),
    createdAt: session.createdAt || firstMessage?.createdAt || Date.now(),
    updatedAt: session.updatedAt || lastMessage?.createdAt || session.createdAt || Date.now(),
    messages: session.messages.map(stripMessageForHistory),
  };
}

function buildLegacySession(record: Pick<PaperHistoryRecord, 'qaMessages' | 'selectedQaPresetId'>): DocumentChatSession | null {
  const messages = Array.isArray(record.qaMessages)
    ? record.qaMessages.map(stripMessageForHistory)
    : [];

  if (messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  return {
    id: `legacy-${firstMessage?.id || crypto.randomUUID()}`,
    title: buildSessionTitle(messages),
    createdAt: firstMessage?.createdAt || Date.now(),
    updatedAt: lastMessage?.createdAt || firstMessage?.createdAt || Date.now(),
    messages,
  };
}

function stripAnnotationForHistory(annotation: PaperAnnotation): PaperAnnotation {
  return {
    ...annotation,
    note: annotation.note.trim(),
    quote: annotation.quote?.trim(),
    updatedAt: annotation.updatedAt || annotation.createdAt || Date.now(),
  };
}

function isRecordShape(value: unknown): value is PaperHistoryRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PaperHistoryRecord).workspaceId === 'string' &&
      typeof (value as PaperHistoryRecord).lastOpenedAt === 'number',
  );
}

export function loadPaperHistoryMap(): Record<string, PaperHistoryRecord> {
  try {
    const rawValue = localStorage.getItem(PAPER_HISTORY_STORAGE_KEY);

    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const nextRecords: Record<string, PaperHistoryRecord> = {};

    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!isRecordShape(value)) {
        continue;
      }

      const normalizedSessions = Array.isArray(value.qaSessions)
        ? value.qaSessions
            .filter(
              (session): session is DocumentChatSession =>
                Boolean(session && typeof session === 'object' && typeof session.id === 'string'),
            )
            .map(stripSessionForHistory)
        : [];
      const legacySession = buildLegacySession(value);
      const qaSessions =
        normalizedSessions.length > 0
          ? normalizedSessions
          : legacySession
            ? [legacySession]
            : [];
      const selectedQaSessionId =
        typeof value.selectedQaSessionId === 'string' &&
        qaSessions.some((session) => session.id === value.selectedQaSessionId)
          ? value.selectedQaSessionId
          : qaSessions[0]?.id ?? null;
      const workspaceNoteMarkdown =
        typeof value.workspaceNoteMarkdown === 'string' ? value.workspaceNoteMarkdown : '';
      const annotations = Array.isArray(value.annotations)
        ? value.annotations
            .filter(
              (annotation): annotation is PaperAnnotation =>
                Boolean(
                  annotation &&
                    typeof annotation === 'object' &&
                    typeof (annotation as PaperAnnotation).id === 'string' &&
                    typeof (annotation as PaperAnnotation).blockId === 'string',
                ),
            )
            .map(stripAnnotationForHistory)
        : [];

      nextRecords[workspaceId] = {
        ...value,
        version: PAPER_HISTORY_VERSION,
        readingViewMode:
          value.readingViewMode === 'pdf-annotate' ? 'pdf-annotate' : 'linked',
        selectedQaSessionId,
        workspaceNoteMarkdown,
        annotations,
        qaSessions,
        qaMessages: undefined,
      };
    }

    return nextRecords;
  } catch {
    return {};
  }
}

export function loadPaperHistory(workspaceId: string): PaperHistoryRecord | null {
  return loadPaperHistoryMap()[workspaceId] ?? null;
}

export function savePaperHistory(record: PaperHistoryRecord): PaperHistoryRecord {
  const currentMap = loadPaperHistoryMap();
  const normalizedSessions = record.qaSessions.map(stripSessionForHistory);
  const normalizedAnnotations = record.annotations.map(stripAnnotationForHistory);
  const selectedQaSessionId =
    record.selectedQaSessionId &&
    normalizedSessions.some((session) => session.id === record.selectedQaSessionId)
      ? record.selectedQaSessionId
      : normalizedSessions[0]?.id ?? null;
  const sanitizedRecord: PaperHistoryRecord = {
    ...record,
    version: PAPER_HISTORY_VERSION,
    selectedQaSessionId,
    workspaceNoteMarkdown: record.workspaceNoteMarkdown,
    annotations: normalizedAnnotations,
    qaSessions: normalizedSessions,
    qaMessages: undefined,
  };

  currentMap[record.workspaceId] = sanitizedRecord;
  localStorage.setItem(PAPER_HISTORY_STORAGE_KEY, JSON.stringify(currentMap));

  return sanitizedRecord;
}

export function removePaperHistory(workspaceId: string): void {
  const currentMap = loadPaperHistoryMap();

  if (!(workspaceId in currentMap)) {
    return;
  }

  delete currentMap[workspaceId];
  localStorage.setItem(PAPER_HISTORY_STORAGE_KEY, JSON.stringify(currentMap));
}
