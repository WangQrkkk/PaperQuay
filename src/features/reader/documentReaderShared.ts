import type {
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperSummary,
  PdfSource,
  TranslationMap,
  UiLanguage,
  WorkspaceItem,
} from '../../types/reader';
import type { LiteraturePaperTaskState } from '../../types/library';
import { readLocalBinaryFile } from '../../services/desktop';
import { bytesToDataUrl, decodeUtf8, formatFileSize, guessMimeTypeFromPath, isImagePath, isTextLikePath } from '../../utils/files';
import { buildPathInDirectory, normalizePathForCompare } from '../../utils/path';
import { getFileNameFromPath, normalizeSelectionText as normalizeTextSelection } from '../../utils/text';
import { pickLocaleText } from './readerShared';
import type { MineruCacheManifest, SummaryCacheEnvelope, TranslationCacheEnvelope } from './readerShared';

export const MIN_LEFT_PANE_RATIO = 0.28;
export const MAX_LEFT_PANE_RATIO = 0.72;
export const PANE_RATIO_STORAGE_KEY = 'paper-reader-pane-ratio-v2';
export const ONBOARDING_WELCOME_PDF_URL = '/onboarding/welcome.pdf';

export interface ReaderTabBridgeState {
  translating: boolean;
  translatedCount: number;
  onTranslate: () => void;
  onClearTranslations: () => void;
  onCloudParse: () => void;
  onGenerateSummary: () => void;
}

export interface ReaderDocumentTranslationSnapshot {
  targetLanguage: string;
  translations: TranslationMap;
  updatedAt: number;
}

export interface LibraryPreviewSyncPayload {
  item: WorkspaceItem;
  hasBlocks: boolean;
  blockCount: number;
  currentPdfName: string;
  currentJsonName: string;
  statusMessage: string;
  sourceKey: string;
  summary?: PaperSummary | null;
  loading?: boolean;
  error?: string;
  operation?: LiteraturePaperTaskState | null;
}

export interface ScreenshotBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenshotSelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenshotSelectionState {
  bounds: ScreenshotBounds;
  startX: number | null;
  startY: number | null;
  currentX: number | null;
  currentY: number | null;
}

export function clampPaneRatio(nextRatio: number): number {
  return Math.min(MAX_LEFT_PANE_RATIO, Math.max(MIN_LEFT_PANE_RATIO, nextRatio));
}

export function loadPaneRatio(): number {
  try {
    const storedRatio = Number(localStorage.getItem(PANE_RATIO_STORAGE_KEY));

    return Number.isFinite(storedRatio) ? clampPaneRatio(storedRatio) : 0.5;
  } catch {
    return 0.5;
  }
}

export function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function normalizeSelectedText(text: string): string {
  return normalizeTextSelection(text).slice(0, 2_000);
}

export function formatQuoteMarkdown(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function appendMarkdownSection(current: string, section: string): string {
  const nextSection = section.trim();

  if (!nextSection) {
    return current;
  }

  const trimmedCurrent = current.trimEnd();

  return trimmedCurrent ? `${trimmedCurrent}\n\n${nextSection}\n` : `${nextSection}\n`;
}

export function createChatMessage(
  role: DocumentChatMessage['role'],
  content: string,
  options?: {
    attachments?: DocumentChatAttachment[];
    modelId?: string;
    modelLabel?: string;
  },
): DocumentChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    attachments: options?.attachments,
    modelId: options?.modelId,
    modelLabel: options?.modelLabel,
  };
}

export function buildQaSessionTitle(
  locale: UiLanguage,
  messages: DocumentChatMessage[],
): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.content.trim(),
  );

  if (!firstUserMessage) {
    return pickLocaleText(locale, '新会话', 'New chat');
  }

  const normalizedContent = firstUserMessage.content.replace(/\s+/g, ' ').trim();

  return normalizedContent.length > 36
    ? `${normalizedContent.slice(0, 36)}…`
    : normalizedContent;
}

export function createQaSession(
  locale: UiLanguage,
  options?: Partial<Pick<DocumentChatSession, 'title' | 'createdAt' | 'updatedAt' | 'messages'>>,
): DocumentChatSession {
  const messages = options?.messages ?? [];
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const createdAt = options?.createdAt ?? firstMessage?.createdAt ?? Date.now();
  const updatedAt = options?.updatedAt ?? lastMessage?.createdAt ?? createdAt;

  return {
    id: crypto.randomUUID(),
    title: options?.title?.trim() || buildQaSessionTitle(locale, messages),
    createdAt,
    updatedAt,
    messages,
  };
}

export function updateQaSession(
  sessions: DocumentChatSession[],
  nextSession: DocumentChatSession,
): DocumentChatSession[] {
  const nextSessions = sessions.map((session) =>
    session.id === nextSession.id ? nextSession : session,
  );

  return nextSessions.some((session) => session.id === nextSession.id)
    ? nextSessions
    : [...sessions, nextSession];
}

export function createAttachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('截图数据转换失败'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('截图数据转换失败'));
    reader.readAsDataURL(blob);
  });
}

export async function buildAttachmentFromPath(
  path: string,
  kind: 'image' | 'file',
  locale: UiLanguage = 'zh-CN',
): Promise<DocumentChatAttachment> {
  const bytes = await readLocalBinaryFile(path);
  const mimeType = guessMimeTypeFromPath(path);
  const fileName = getFileNameFromPath(path);
  const imageFile = isImagePath(path);
  const textFile = isTextLikePath(path);

  return {
    id: createAttachmentId(),
    kind: imageFile ? 'image' : kind,
    name: fileName,
    mimeType,
    size: bytes.byteLength,
    filePath: path,
    dataUrl: imageFile ? bytesToDataUrl(bytes, mimeType) : undefined,
    textContent: textFile ? decodeUtf8(bytes).slice(0, 12_000) : undefined,
    summary: textFile
      ? `${pickLocaleText(locale, '文本附件', 'Text attachment')} · ${formatFileSize(bytes.byteLength)}`
      : imageFile
        ? `${pickLocaleText(locale, '图片附件', 'Image attachment')} · ${formatFileSize(bytes.byteLength)}`
        : `${pickLocaleText(locale, '文件附件', 'File attachment')} · ${formatFileSize(bytes.byteLength)}`,
  };
}

export async function buildScreenshotAttachmentFromPath(
  path: string,
  locale: UiLanguage = 'zh-CN',
): Promise<DocumentChatAttachment> {
  const attachment = await buildAttachmentFromPath(path, 'image', locale);

  return {
    ...attachment,
    kind: 'screenshot',
    summary: `${pickLocaleText(locale, '系统截图', 'System screenshot')} · ${formatFileSize(attachment.size)}`,
  };
}

export function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || 'document.pdf';
}

export function ensurePdfExtension(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

export function getMineruJsonDisplayName(path: string): string {
  return path.startsWith('cloud:') ? path.replace(/^cloud:/, '') : getFileNameFromPath(path);
}

export function getPreviewPdfName(item: WorkspaceItem, pdfPath: string, source: PdfSource): string {
  if (pdfPath) {
    return getFileNameFromPath(pdfPath);
  }

  if (source?.kind === 'remote-url') {
    return (
      source.fileName ||
      item.attachmentFilename ||
      item.attachmentTitle ||
      `${item.title}.pdf`
    );
  }

  if (item.localPdfPath) {
    return getFileNameFromPath(item.localPdfPath);
  }

  return item.attachmentFilename || item.attachmentTitle || `${item.title}.pdf`;
}
export function joinLocalPath(directory: string, filename: string): string {
  return buildPathInDirectory(directory, filename);
}

export function buildRemotePdfDownloadPath(
  directory: string,
  item: WorkspaceItem,
  source?: Exclude<PdfSource, null>,
) {
  const rawName =
    (source?.kind === 'remote-url' ? source.fileName : '') ||
    item.attachmentFilename ||
    item.attachmentTitle ||
    item.title ||
    item.itemKey;
  const filename = ensurePdfExtension(sanitizeFilename(rawName));
  const prefix = sanitizeFilename(item.itemKey || item.workspaceId);

  return joinLocalPath(directory, `${prefix}-${filename}`);
}

export function isSameLocalPath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

export function appendUniqueLocalPath(targets: string[], nextPath: string): void {
  if (!nextPath.trim()) {
    return;
  }

  if (targets.some((candidate) => isSameLocalPath(candidate, nextPath))) {
    return;
  }

  targets.push(nextPath);
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('截图图像解码失败'));
    };
    image.src = objectUrl;
  });
}

export async function cropScreenshotBlob(
  blob: Blob,
  selectionRect: ScreenshotSelectionRect,
  captureWidth: number,
  captureHeight: number,
): Promise<Blob> {
  const image = await loadBlobImage(blob);
  const scaleX = image.naturalWidth / captureWidth;
  const scaleY = image.naturalHeight / captureHeight;
  const sourceLeft = Math.max(0, Math.round(selectionRect.left * scaleX));
  const sourceTop = Math.max(0, Math.round(selectionRect.top * scaleY));
  const sourceWidth = Math.max(1, Math.round(selectionRect.width * scaleX));
  const sourceHeight = Math.max(1, Math.round(selectionRect.height * scaleY));
  const canvas = document.createElement('canvas');

  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('无法创建截图画布');
  }

  context.drawImage(
    image,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  const nextBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png');
  });

  if (!nextBlob) {
    throw new Error('截图裁剪失败');
  }

  return nextBlob;
}
