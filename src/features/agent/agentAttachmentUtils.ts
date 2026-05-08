import type { DocumentChatAttachment } from '../../types/reader';

export function getAgentAttachmentKey(attachment: DocumentChatAttachment): string {
  return `${attachment.filePath || attachment.name}:${attachment.size}`;
}

export function mergeUniqueAgentAttachments(
  current: DocumentChatAttachment[],
  incoming: DocumentChatAttachment[],
): DocumentChatAttachment[] {
  if (incoming.length === 0) {
    return current;
  }

  const existingKeys = new Set(current.map((attachment) => getAgentAttachmentKey(attachment)));
  const next = [...current];

  for (const attachment of incoming) {
    const key = getAgentAttachmentKey(attachment);

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    next.push(attachment);
  }

  return next;
}
