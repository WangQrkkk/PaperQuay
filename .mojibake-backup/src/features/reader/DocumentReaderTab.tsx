import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toBlob } from 'html-to-image';
import ReaderWorkspace from './ReaderWorkspace';
import {
  downloadRemoteFileToPath,
  loadPdfBinary,
  listLocalDirectoryFiles,
  readLocalBinaryFile,
  readLocalTextFile,
  runMineruCloudParse,
  selectChatAttachmentPaths,
  selectLocalMineruJsonPath,
  writeLocalTextFile,
} from '../../services/desktop';
import type { LocalDirectoryFileEntry } from '../../services/desktop';
import {
  extractTextFromMineruBlock,
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import { askDocumentOpenAICompatible } from '../../services/qa';
import { summarizeDocumentOpenAICompatible } from '../../services/summary';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
} from '../../services/summarySource';
import { translateBlocksOpenAICompatible } from '../../services/translation';
import {
  buildZoteroAttachmentPdfUrl,
  listLocalZoteroRelatedNotes,
  lookupZoteroKey,
} from '../../services/zotero';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  MineruPage,
  PaperAnnotation,
  PaperSummary,
  PdfHighlightTarget,
  PdfSource,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderViewMode,
  ReaderSettings,
  SelectedExcerpt,
  SummaryBlockInput,
  TextSelectionPayload,
  TextSelectionSource,
  TranslationMap,
  WorkspaceItem,
  WorkspaceStage,
  ZoteroRelatedNote,
} from '../../types/reader';
import { bytesToDataUrl, decodeUtf8, formatFileSize, guessMimeTypeFromPath, isImagePath, isTextLikePath } from '../../utils/files';
import {
  buildLegacyMineruCachePaths,
  buildLegacyMineruSummaryCachePath,
  buildMineruCachePaths,
  buildMineruSummaryCachePath,
  buildLegacyMineruTranslationCachePath,
  buildMineruTranslationCachePath,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
  type MineruCachePaths,
} from '../../utils/mineruCache';
import { loadPaperHistory, savePaperHistory } from '../../utils/paperHistory';
import { getFileNameFromPath, normalizeSelectionText as normalizeTextSelection } from '../../utils/text';

const MIN_LEFT_PANE_RATIO = 0.28;
const MAX_LEFT_PANE_RATIO = 0.72;
const PANE_RATIO_STORAGE_KEY = 'paper-reader-pane-ratio-v2';

interface MineruCacheManifest {
  version: number;
  documentKey: string;
  title: string;
  pdfPath: string;
  savedAt: string;
  sourceKind: 'cloud' | 'manual-json' | 'sibling-json';
  batchId?: string;
  dataId?: string;
  fileName?: string;
  zipEntries?: string[];
}

interface TranslationCacheEnvelope {
  version: number;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

interface SummaryCacheEnvelope {
  version: number;
  sourceKey: string;
  summarizedAt: string;
  summary: PaperSummary;
}

interface ScreenshotBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScreenshotSelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScreenshotSelectionState {
  bounds: ScreenshotBounds;
  startX: number | null;
  startY: number | null;
  currentX: number | null;
  currentY: number | null;
}

function isManifestShape(value: unknown): value is MineruCacheManifest {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as MineruCacheManifest).documentKey === 'string' &&
      typeof (value as MineruCacheManifest).pdfPath === 'string',
  );
}

export interface ReaderTabBridgeState {
  translating: boolean;
  translatedCount: number;
  onTranslate: () => void;
  onClearTranslations: () => void;
  onCloudParse: () => void;
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
}

interface DocumentReaderTabProps {
  tabId: string;
  document: WorkspaceItem;
  isActive: boolean;
  settings: ReaderSettings;
  zoteroLocalDataDir: string;
  mineruApiToken: string;
  translationApiKey: string;
  summaryApiKey: string;
  qaModelPresets: QaModelPreset[];
  zoteroApiKey: string;
  zoteroUserId: string;
  onZoteroUserIdChange: (value: string) => void;
  onQaActivePresetChange: (presetId: string) => void;
  onDocumentResolved: (item: WorkspaceItem) => void;
  onLibraryPreviewSync: (payload: LibraryPreviewSyncPayload) => void;
  onOpenPreferences: () => void;
  onOpenStandalonePdf: () => void;
  onBridgeStateChange: (tabId: string, bridge: ReaderTabBridgeState | null) => void;
}

function clampPaneRatio(nextRatio: number): number {
  return Math.min(MAX_LEFT_PANE_RATIO, Math.max(MIN_LEFT_PANE_RATIO, nextRatio));
}

function loadPaneRatio(): number {
  try {
    const storedRatio = Number(localStorage.getItem(PANE_RATIO_STORAGE_KEY));

    return Number.isFinite(storedRatio) ? clampPaneRatio(storedRatio) : 0.5;
  } catch {
    return 0.5;
  }
}

function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function normalizeSelectedText(text: string): string {
  return normalizeTextSelection(text).slice(0, 2_000);
}

function clampToRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSelectionPoint(clientX: number, clientY: number, bounds: ScreenshotBounds) {
  return {
    x: clampToRange(clientX, bounds.left, bounds.left + bounds.width),
    y: clampToRange(clientY, bounds.top, bounds.top + bounds.height),
  };
}

function buildSelectionRect(state: ScreenshotSelectionState | null): ScreenshotSelectionRect | null {
  if (
    !state ||
    state.startX === null ||
    state.startY === null ||
    state.currentX === null ||
    state.currentY === null
  ) {
    return null;
  }

  const start = normalizeSelectionPoint(state.startX, state.startY, state.bounds);
  const current = normalizeSelectionPoint(state.currentX, state.currentY, state.bounds);
  const left = Math.min(start.x, current.x) - state.bounds.left;
  const top = Math.min(start.y, current.y) - state.bounds.top;
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);

  if (width < 12 || height < 12) {
    return null;
  }

  return { left, top, width, height };
}

function formatQuoteMarkdown(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function appendMarkdownSection(current: string, section: string): string {
  const nextSection = section.trim();

  if (!nextSection) {
    return current;
  }

  const trimmedCurrent = current.trimEnd();

  return trimmedCurrent ? `${trimmedCurrent}\n\n${nextSection}\n` : `${nextSection}\n`;
}

function createChatMessage(
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

function buildQaSessionTitle(messages: DocumentChatMessage[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.content.trim(),
  );

  if (!firstUserMessage) {
    return 'New chat';
  }

  const normalizedContent = firstUserMessage.content.replace(/\s+/g, ' ').trim();

  return normalizedContent.length > 36
    ? `${normalizedContent.slice(0, 36)}…`
    : normalizedContent;
}

function createQaSession(
  options?: Partial<Pick<DocumentChatSession, 'title' | 'createdAt' | 'updatedAt' | 'messages'>>,
): DocumentChatSession {
  const messages = options?.messages ?? [];
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const createdAt = options?.createdAt ?? firstMessage?.createdAt ?? Date.now();
  const updatedAt = options?.updatedAt ?? lastMessage?.createdAt ?? createdAt;

  return {
    id: crypto.randomUUID(),
    title: options?.title?.trim() || buildQaSessionTitle(messages),
    createdAt,
    updatedAt,
    messages,
  };
}

function updateQaSession(
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

function createAttachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
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

async function buildAttachmentFromPath(
  path: string,
  kind: 'image' | 'file',
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
      ? `文本附件 璺?${formatFileSize(bytes.byteLength)}`
      : imageFile
        ? `图片附件 璺?${formatFileSize(bytes.byteLength)}`
        : `文件附件 璺?${formatFileSize(bytes.byteLength)}`,
  };
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || 'document.pdf';
}

function ensurePdfExtension(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
}

function getMineruJsonDisplayName(path: string): string {
  return path.startsWith('cloud:') ? path.replace(/^cloud:/, '') : getFileNameFromPath(path);
}

function resolveModelPreset(
  presets: QaModelPreset[],
  presetId: string | undefined,
): QaModelPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null;
}

function getPreviewPdfName(item: WorkspaceItem, pdfPath: string, source: PdfSource): string {
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

function getSummarySourceLabel(mode: ReaderSettings['summarySourceMode']): string {
  return mode === 'pdf-text' ? 'PDF 文本' : 'MinerU Markdown';
}

function joinLocalPath(directory: string, filename: string): string {
  const trimmedDirectory = directory.trim().replace(/[\\/]+$/, '');
  const separator = trimmedDirectory.includes('\\') ? '\\' : '/';

  return `${trimmedDirectory}${separator}${filename}`;
}

function buildRemotePdfDownloadPath(directory: string, item: WorkspaceItem, source?: Exclude<PdfSource, null>) {
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

function normalizeLocalPathForCompare(path: string): string {
  return path.replace(/\//g, '\\').trim().toLowerCase();
}

function isSameLocalPath(left: string, right: string): boolean {
  return normalizeLocalPathForCompare(left) === normalizeLocalPathForCompare(right);
}

function appendUniqueLocalPath(targets: string[], nextPath: string): void {
  if (!nextPath.trim()) {
    return;
  }

  if (targets.some((candidate) => isSameLocalPath(candidate, nextPath))) {
    return;
  }

  targets.push(nextPath);
}

function getParentDirectoryPath(path: string): string {
  const normalizedPath = path.replace(/\//g, '\\');
  const separatorIndex = normalizedPath.lastIndexOf('\\');

  return separatorIndex >= 0 ? normalizedPath.slice(0, separatorIndex) : '';
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }

  const output: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }

  return output;
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

async function cropScreenshotBlob(
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

function DocumentReaderTab({
  tabId,
  document,
  isActive,
  settings,
  zoteroLocalDataDir,
  mineruApiToken,
  translationApiKey,
  summaryApiKey,
  qaModelPresets,
  zoteroApiKey,
  zoteroUserId,
  onZoteroUserIdChange,
  onQaActivePresetChange,
  onDocumentResolved,
  onLibraryPreviewSync,
  onOpenPreferences,
  onOpenStandalonePdf,
  onBridgeStateChange,
}: DocumentReaderTabProps) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const documentSearchInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectionRef = useRef<ScreenshotSelectionState | null>(null);
  const screenshotPointerIdRef = useRef<number | null>(null);
  const summaryRequestIdRef = useRef(0);
  const selectedExcerptRequestIdRef = useRef(0);
  const lastDocumentSignatureRef = useRef('');
  const lastCapturedSelectionRef = useRef<{
    source: TextSelectionSource;
    text: string;
    capturedAt: number;
  } | null>(null);
  const paperOpenedAtRef = useRef(Date.now());
  const restoredHistoryRef = useRef('');
  const selectionRequestKeyRef = useRef('');
  const autoTranslatedSelectionKeyRef = useRef('');
  const autoSummarySourceKeyRef = useRef('');
  const pendingHistoryActiveBlockIdRef = useRef<string | null>(null);

  const [currentDocument, setCurrentDocument] = useState<WorkspaceItem>(document);
  const [pdfSource, setPdfSource] = useState<PdfSource>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfPath, setPdfPath] = useState('');
  const [mineruPath, setMineruPath] = useState('');
  const [mineruPages, setMineruPages] = useState<MineruPage[]>([]);
  const [flatBlocks, setFlatBlocks] = useState<PositionedMineruBlock[]>([]);
  const [blockTranslations, setBlockTranslations] = useState<TranslationMap>({});
  const [blockTranslationTargetLanguage, setBlockTranslationTargetLanguage] = useState('');
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activePdfHighlight, setActivePdfHighlight] = useState<PdfHighlightTarget | null>(null);
  const [blockScrollSignal, setBlockScrollSignal] = useState(0);
  const [leftPaneWidthRatio, setLeftPaneWidthRatio] = useState(loadPaneRatio);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [assistantActivePanel, setAssistantActivePanel] = useState<AssistantPanelKey>('chat');
  const [workspaceStage, setWorkspaceStage] = useState<WorkspaceStage>('reading');
  const [readingViewMode, setReadingViewMode] = useState<ReaderViewMode>('linked');
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgressCompleted, setTranslationProgressCompleted] = useState(0);
  const [translationProgressTotal, setTranslationProgressTotal] = useState(0);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('就绪');
  const [documentSearchQuery, setDocumentSearchQuery] = useState('');
  const [documentSearchCursor, setDocumentSearchCursor] = useState(-1);
  const [paperSummary, setPaperSummary] = useState<PaperSummary | null>(null);
  const [paperSummaryLoading, setPaperSummaryLoading] = useState(false);
  const [paperSummaryError, setPaperSummaryError] = useState('');
  const [paperSummarySourceKey, setPaperSummarySourceKey] = useState('');
  const [qaSessions, setQaSessions] = useState<DocumentChatSession[]>(() => {
    const initialSession = createQaSession();

    return [initialSession];
  });
  const [selectedQaSessionId, setSelectedQaSessionId] = useState(
    () => qaSessions[0]?.id ?? '',
  );
  const [qaInput, setQaInput] = useState('');
  const [qaAttachments, setQaAttachments] = useState<DocumentChatAttachment[]>([]);
  const [selectedQaPresetId, setSelectedQaPresetId] = useState(settings.qaActivePresetId);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState('');
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [screenshotSelection, setScreenshotSelection] = useState<ScreenshotSelectionState | null>(null);
  const [selectedExcerpt, setSelectedExcerpt] = useState<SelectedExcerpt | null>(null);
  const [selectedExcerptTranslation, setSelectedExcerptTranslation] = useState('');
  const [selectedExcerptTranslating, setSelectedExcerptTranslating] = useState(false);
  const [selectedExcerptError, setSelectedExcerptError] = useState('');
  const [assistantDetached, setAssistantDetached] = useState(false);
  const [workspaceNoteMarkdown, setWorkspaceNoteMarkdown] = useState('');
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [zoteroRelatedNotes, setZoteroRelatedNotes] = useState<ZoteroRelatedNote[]>([]);
  const [zoteroRelatedNotesLoading, setZoteroRelatedNotesLoading] = useState(false);
  const [zoteroRelatedNotesError, setZoteroRelatedNotesError] = useState('');
  const [projectPdfFiles, setProjectPdfFiles] = useState<LocalDirectoryFileEntry[]>([]);

  const hasDocument = Boolean(currentDocument && pdfSource);
  const translatedCount = Object.keys(blockTranslations).length;
  const translationModelPreset =
    resolveModelPreset(qaModelPresets, settings.translationModelPresetId) ?? qaModelPresets[0] ?? null;
  const selectionTranslationModelPreset =
    resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId) ??
    translationModelPreset;
  const summaryModelPreset =
    resolveModelPreset(qaModelPresets, settings.summaryModelPresetId) ?? translationModelPreset;
  const activeQaPreset =
    qaModelPresets.find((preset) => preset.id === selectedQaPresetId) ?? qaModelPresets[0] ?? null;
  const activeQaSession = useMemo(
    () =>
      qaSessions.find((session) => session.id === selectedQaSessionId) ??
      qaSessions[0] ??
      null,
    [qaSessions, selectedQaSessionId],
  );
  const qaMessages = activeQaSession?.messages ?? [];
  const translationConfigured = Boolean(
    translationModelPreset &&
      translationModelPreset.apiKey.trim() &&
      translationModelPreset.baseUrl.trim() &&
      translationModelPreset.model.trim(),
  );
  const summaryConfigured = Boolean(
    summaryModelPreset &&
      summaryModelPreset.apiKey.trim() &&
      summaryModelPreset.baseUrl.trim() &&
      summaryModelPreset.model.trim(),
  );
  const qaConfigured = Boolean(
    activeQaPreset?.apiKey.trim() &&
      activeQaPreset.baseUrl.trim() &&
      activeQaPreset.model.trim(),
  );
  const aiConfigured = translationConfigured || summaryConfigured || qaConfigured;
  const screenshotBusy = capturingScreenshot || Boolean(screenshotSelection);
  const screenshotSelectionRect = useMemo(
    () => buildSelectionRect(screenshotSelection),
    [screenshotSelection],
  );
  const currentPdfName =
    pdfSource?.kind === 'remote-url'
      ? pdfSource.fileName ||
        currentDocument.attachmentFilename ||
        currentDocument.attachmentTitle ||
        `${currentDocument.title}.pdf`
      : pdfPath
        ? getFileNameFromPath(pdfPath)
        : '未打开';
  const currentJsonName = mineruPath
    ? mineruPath.startsWith('cloud:')
      ? mineruPath.replace(/^cloud:/, '')
      : getFileNameFromPath(mineruPath)
    : '鏈姞杞?;
  const normalizedDocumentSearchQuery = documentSearchQuery.trim().toLowerCase();
  const originalPdfPath = useMemo(() => {
    if (document.localPdfPath?.trim()) {
      return document.localPdfPath;
    }

    if (document.attachmentKey && settings.remotePdfDownloadDir.trim()) {
      return buildRemotePdfDownloadPath(settings.remotePdfDownloadDir, document);
    }

    return '';
  }, [document, settings.remotePdfDownloadDir]);
  const currentLocalPdfPath =
    pdfPath || (pdfSource?.kind === 'local-path' ? pdfSource.path : '');
  const currentPdfVariantLabel = useMemo(() => {
    if (!currentLocalPdfPath) {
      return pdfSource?.kind === 'remote-url' ? 'Remote PDF' : '';
    }

    if (originalPdfPath && isSameLocalPath(currentLocalPdfPath, originalPdfPath)) {
      return 'Original PDF';
    }

    return 'Annotated PDF';
  }, [currentLocalPdfPath, originalPdfPath, pdfSource]);
  const canOpenOriginalPdf = Boolean(
    originalPdfPath &&
      currentLocalPdfPath &&
      !isSameLocalPath(currentLocalPdfPath, originalPdfPath),
  );
  const annotationSaveDirectory = useMemo(() => {
    if (settings.mineruCacheDir.trim()) {
      return buildMineruCachePaths(settings.mineruCacheDir.trim(), document).directory;
    }

    if (originalPdfPath) {
      return getParentDirectoryPath(originalPdfPath);
    }

    if (currentLocalPdfPath) {
      return getParentDirectoryPath(currentLocalPdfPath);
    }

    return '';
  }, [currentLocalPdfPath, document, originalPdfPath, settings.mineruCacheDir]);
  const availablePdfOptions = useMemo(() => {
    const options: Array<{ path: string; label: string }> = [];
    const appendOption = (path: string, label: string) => {
      if (!path.trim()) {
        return;
      }

      if (options.some((option) => isSameLocalPath(option.path, path))) {
        return;
      }

      options.push({ path, label });
    };

    if (originalPdfPath) {
      appendOption(originalPdfPath, `Original - ${getFileNameFromPath(originalPdfPath)}`);
    }

    projectPdfFiles.forEach((entry) => {
      const prefix =
        originalPdfPath && isSameLocalPath(entry.path, originalPdfPath) ? 'Original' : 'Project';
      appendOption(entry.path, `${prefix} - ${entry.name}`);
    });

    if (currentLocalPdfPath) {
      appendOption(
        currentLocalPdfPath,
        `${currentPdfVariantLabel || 'Current'} - ${getFileNameFromPath(currentLocalPdfPath)}`,
      );
    }

    return options;
  }, [currentLocalPdfPath, currentPdfVariantLabel, originalPdfPath, projectPdfFiles]);

  useEffect(() => {
    const fallbackFiles: LocalDirectoryFileEntry[] = currentLocalPdfPath
      ? [
          {
            path: currentLocalPdfPath,
            name: getFileNameFromPath(currentLocalPdfPath),
            size: 0,
            modifiedAtMs: 0,
          },
        ]
      : [];

    if (!annotationSaveDirectory.trim()) {
      setProjectPdfFiles(fallbackFiles);
      return;
    }

    let cancelled = false;

    void listLocalDirectoryFiles(annotationSaveDirectory, 'pdf')
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setProjectPdfFiles(entries);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setProjectPdfFiles(fallbackFiles);
      });

    return () => {
      cancelled = true;
    };
  }, [annotationSaveDirectory, currentLocalPdfPath]);

  const activeBlock = useMemo(
    () => flatBlocks.find((block) => block.blockId === activeBlockId) ?? null,
    [activeBlockId, flatBlocks],
  );

  const activeBlockSummary = useMemo(() => {
    if (!activeBlock) {
      return '灏氭湭閫変腑缁撴瀯鍧?;
    }

    return `P${activeBlock.pageIndex + 1} 璺?${activeBlock.type} 璺?${activeBlock.blockId}`;
  }, [activeBlock]);

  const documentSearchMatches = useMemo(() => {
    if (!normalizedDocumentSearchQuery) {
      return [];
    }

    return flatBlocks.filter((block) => {
      const originalText = extractTextFromMineruBlock(block).toLowerCase();
      const translatedText = blockTranslations[block.blockId]?.toLowerCase() ?? '';

      return (
        originalText.includes(normalizedDocumentSearchQuery) ||
        translatedText.includes(normalizedDocumentSearchQuery)
      );
    });
  }, [blockTranslations, flatBlocks, normalizedDocumentSearchQuery]);

  const summaryBlockInputs = useMemo<SummaryBlockInput[]>(
    () => buildSummaryBlockInputs(flatBlocks),
    [flatBlocks],
  );

  const paperSummaryNextSourceKey = useMemo(() => {
    if (!currentDocument) {
      return '';
    }

    if (settings.summarySourceMode === 'pdf-text') {
      if (!pdfData) {
        return '';
      }

      return `${currentDocument.itemKey}::pdf-text::${pdfPath || currentPdfName}::${pdfData.byteLength}`;
    }

    if (!mineruPath && flatBlocks.length === 0) {
      return '';
    }

    return `${currentDocument.itemKey}::mineru-markdown::${mineruPath || currentJsonName}::${flatBlocks.length}`;
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    mineruPath,
    pdfData,
    pdfPath,
    settings.summarySourceMode,
  ]);
  const libraryPreviewSourceKey =
    paperSummarySourceKey ||
    paperSummaryNextSourceKey ||
    `${currentDocument.workspaceId}::preview::${currentJsonName}::${flatBlocks.length}`;

  useEffect(() => {
    if (
      blockTranslationTargetLanguage &&
      blockTranslationTargetLanguage !== settings.translationTargetLanguage
    ) {
      setBlockTranslations({});
      setBlockTranslationTargetLanguage('');
    }
  }, [blockTranslationTargetLanguage, settings.translationTargetLanguage]);

  useEffect(() => {
    if (!currentDocument || flatBlocks.length === 0 || !settings.mineruCacheDir.trim()) {
      return;
    }

    if (
      blockTranslationTargetLanguage === settings.translationTargetLanguage &&
      Object.keys(blockTranslations).length > 0
    ) {
      return;
    }

    let cancelled = false;

    void tryLoadSavedTranslations(currentDocument)
      .then((cachedTranslations) => {
        if (cancelled || !cachedTranslations) {
          return;
        }

        setBlockTranslations(cachedTranslations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setStatusMessage(
          `已从本地缓存恢复 ${Object.keys(cachedTranslations).length} 濞?${
            settings.translationTargetLanguage
          } 译文`,
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    blockTranslationTargetLanguage,
    blockTranslations,
    currentDocument,
    flatBlocks.length,
    settings.mineruCacheDir,
    settings.translationTargetLanguage,
    tryLoadSavedTranslations,
  ]);

  useEffect(() => {
    if (!currentDocument.workspaceId) {
      return;
    }

    onLibraryPreviewSync({
      item: currentDocument,
      hasBlocks: flatBlocks.length > 0,
      blockCount: flatBlocks.length,
      currentPdfName,
      currentJsonName,
      statusMessage,
      sourceKey: libraryPreviewSourceKey,
      summary: paperSummary,
      loading: paperSummaryLoading,
      error: paperSummaryError,
    });
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    libraryPreviewSourceKey,
    onLibraryPreviewSync,
    paperSummary,
    paperSummaryError,
    paperSummaryLoading,
    statusMessage,
  ]);

  useEffect(() => {
    screenshotSelectionRef.current = screenshotSelection;
  }, [screenshotSelection]);

  const resetDocumentState = useCallback(() => {
    const initialSession = createQaSession();

    setMineruPath('');
    setMineruPages([]);
    setFlatBlocks([]);
    setBlockTranslations({});
    setBlockTranslationTargetLanguage('');
    setActiveBlockId(null);
    setHoveredBlockId(null);
    setActivePdfHighlight(null);
    setBlockScrollSignal(0);
    setDocumentSearchQuery('');
    setDocumentSearchCursor(-1);
    setPaperSummary(null);
    setPaperSummaryLoading(false);
    setPaperSummaryError('');
    setPaperSummarySourceKey('');
    autoSummarySourceKeyRef.current = '';
    setSelectedAnnotationId(null);
    setQaSessions([initialSession]);
    setSelectedQaSessionId(initialSession.id);
    setQaInput('');
    setQaAttachments([]);
    setQaLoading(false);
    setQaError('');
    setCapturingScreenshot(false);
    setScreenshotSelection(null);
    screenshotPointerIdRef.current = null;
    setSelectedExcerpt(null);
    setSelectedExcerptTranslation('');
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError('');
    setWorkspaceNoteMarkdown('');
    setAnnotations([]);
    setZoteroRelatedNotes([]);
    setZoteroRelatedNotesLoading(false);
    setZoteroRelatedNotesError('');
    lastCapturedSelectionRef.current = null;
    selectionRequestKeyRef.current = '';
    autoTranslatedSelectionKeyRef.current = '';
    setAssistantDetached(false);
  }, []);

  const applyMineruPages = useCallback(
    (
      pages: MineruPage[],
      nextMineruPath: string,
      options?: {
        item?: WorkspaceItem;
        pdfPath?: string;
        pdfSource?: PdfSource;
        statusMessage?: string;
      },
    ) => {
      const blocks = flattenMineruPages(pages);

      setMineruPages(pages);
      setFlatBlocks(blocks);
      setMineruPath(nextMineruPath);
      setActiveBlockId(null);
      setHoveredBlockId(null);
      setActivePdfHighlight(null);
      setBlockScrollSignal((current) => current + 1);

      if (!options?.item) {
        return;
      }

      const currentJsonDisplayName = getMineruJsonDisplayName(nextMineruPath);

      onLibraryPreviewSync({
        item: options.item,
        hasBlocks: blocks.length > 0,
        blockCount: blocks.length,
        currentPdfName: getPreviewPdfName(
          options.item,
          options.pdfPath ?? '',
          options.pdfSource ?? null,
        ),
        currentJsonName: currentJsonDisplayName,
        statusMessage:
          options.statusMessage ??
          (blocks.length > 0
            ? `宸插姞杞?${blocks.length} 个结构块`
            : '已加载结构化 JSON锛屼絾杩樻病鏈夊彲鐢ㄧ殑缁撴瀯鍧?),
        sourceKey: `${options.item.workspaceId}::${currentJsonDisplayName}::${blocks.length}`,
      });
    },
    [onLibraryPreviewSync],
  );

  const saveMineruParseCache = useCallback(
    async ({
      item,
      pdfPath: currentPdfPath,
      sourceKind,
      contentJsonText,
      middleJsonText,
      markdownText,
      batchId,
      dataId,
      fileName,
      zipEntries,
    }: {
      item: WorkspaceItem;
      pdfPath: string;
      sourceKind: MineruCacheManifest['sourceKind'];
      contentJsonText?: string | null;
      middleJsonText?: string | null;
      markdownText?: string | null;
      batchId?: string;
      dataId?: string;
      fileName?: string;
      zipEntries?: string[];
    }) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const cachePaths = buildMineruCachePaths(settings.mineruCacheDir.trim(), item);
      const writeTasks: Promise<void>[] = [];

      if (contentJsonText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.contentJsonPath, contentJsonText));
      }

      if (middleJsonText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.middleJsonPath, middleJsonText));
      }

      if (markdownText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.markdownPath, markdownText));
      }

      const manifest: MineruCacheManifest = {
        version: 1,
        documentKey: item.itemKey,
        title: item.title,
        pdfPath: currentPdfPath,
        savedAt: new Date().toISOString(),
        sourceKind,
        batchId,
        dataId,
        fileName,
        zipEntries,
      };

      writeTasks.push(
        writeLocalTextFile(cachePaths.manifestPath, JSON.stringify(manifest, null, 2)),
      );

      await Promise.all(writeTasks);

      return cachePaths;
    },
    [settings.mineruCacheDir],
  );

  const saveTranslationCache = useCallback(
    async (item: WorkspaceItem, translations: TranslationMap) => {
      if (!settings.mineruCacheDir.trim()) {
        return;
      }

      const cachePath = buildMineruTranslationCachePath(
        settings.mineruCacheDir.trim(),
        item,
        settings.translationTargetLanguage,
      );
      const payload: TranslationCacheEnvelope = {
        version: 1,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translatedAt: new Date().toISOString(),
        translations,
      };

      await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
    },
    [
      settings.mineruCacheDir,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    ],
  );

  const saveSummaryCache = useCallback(
    async (item: WorkspaceItem, sourceKey: string, summary: PaperSummary) => {
      if (!settings.mineruCacheDir.trim() || !sourceKey.trim()) {
        return;
      }

      const cachePath = buildMineruSummaryCachePath(
        settings.mineruCacheDir.trim(),
        item,
        sourceKey,
      );
      const payload: SummaryCacheEnvelope = {
        version: 1,
        sourceKey,
        summarizedAt: new Date().toISOString(),
        summary,
      };

      await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
    },
    [settings.mineruCacheDir],
  );

  async function tryLoadSavedTranslations(item: WorkspaceItem) {
    if (!settings.mineruCacheDir.trim()) {
      return null;
    }

    const candidatePaths = [
      buildMineruTranslationCachePath(
        settings.mineruCacheDir.trim(),
        item,
        settings.translationTargetLanguage,
      ),
      buildLegacyMineruTranslationCachePath(
        settings.mineruCacheDir.trim(),
        item,
        settings.translationTargetLanguage,
      ),
    ];

    for (const candidatePath of candidatePaths) {
      try {
        const raw = await readLocalTextFile(candidatePath);
        const parsed = JSON.parse(raw) as Partial<TranslationCacheEnvelope>;

        if (!parsed || typeof parsed !== 'object' || !parsed.translations) {
          continue;
        }

        return parsed.translations as TranslationMap;
      } catch {
        continue;
      }
    }

    return null;
  }

  async function tryLoadSavedSummary(item: WorkspaceItem, sourceKey: string) {
    if (!settings.mineruCacheDir.trim() || !sourceKey.trim()) {
      return null;
    }

    const candidatePaths = [
      buildMineruSummaryCachePath(settings.mineruCacheDir.trim(), item, sourceKey),
      buildLegacyMineruSummaryCachePath(settings.mineruCacheDir.trim(), item, sourceKey),
    ];

    for (const candidatePath of candidatePaths) {
      try {
        const raw = await readLocalTextFile(candidatePath);
        const parsed = JSON.parse(raw) as Partial<SummaryCacheEnvelope>;

        if (
          !parsed ||
          typeof parsed !== 'object' ||
          parsed.sourceKey !== sourceKey ||
          !parsed.summary
        ) {
          continue;
        }

        return parsed.summary as PaperSummary;
      } catch {
        continue;
      }
    }

    return null;
  }

  const tryLoadSavedMineruPages = useCallback(
    async (item: WorkspaceItem) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const candidateCaches = [
        buildMineruCachePaths(settings.mineruCacheDir.trim(), item),
        buildLegacyMineruCachePaths(settings.mineruCacheDir.trim(), item),
      ];

      for (const cachePaths of candidateCaches) {
        for (const candidatePath of [cachePaths.contentJsonPath, cachePaths.middleJsonPath]) {
          try {
            const jsonText = await readLocalTextFile(candidatePath);

          return {
            pages: parseMineruPages(jsonText),
            path: candidatePath,
            message: `瀹歌弓绮犵紓鎾崇摠閻╊喖缍嶉幁銏狀槻閵?{item.title}》的解析结果`,
          };
          } catch {
            continue;
          }
        }
      }

      return null;
    },
    [settings.mineruCacheDir],
  );

  const tryResolveSavedPdfPath = useCallback(
    async (item: WorkspaceItem) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const candidateCaches = [
        buildMineruCachePaths(settings.mineruCacheDir.trim(), item),
        buildLegacyMineruCachePaths(settings.mineruCacheDir.trim(), item),
      ];

      for (const cachePaths of candidateCaches) {
        try {
          const manifestText = await readLocalTextFile(cachePaths.manifestPath);
          const parsed = JSON.parse(manifestText);

          if (!isManifestShape(parsed) || !parsed.pdfPath.trim()) {
            continue;
          }

          try {
            await loadPdfBinary({ kind: 'local-path', path: parsed.pdfPath });
            return parsed.pdfPath;
          } catch {
            continue;
          }
        } catch {
          continue;
        }
      }

      return null;
    },
    [settings.mineruCacheDir],
  );

  const createHighlightTarget = useCallback(
    (block: PositionedMineruBlock): PdfHighlightTarget | null =>
      block.bbox
        ? {
            blockId: block.blockId,
            pageIndex: block.pageIndex,
            bbox: block.bbox,
            bboxCoordinateSystem: block.bboxCoordinateSystem,
            bboxPageSize: block.bboxPageSize,
          }
        : null,
    [],
  );

  const activateBlock = useCallback(
    (
      block: PositionedMineruBlock,
      nextStatus: string,
      options?: {
        syncPdfHighlight?: boolean;
        syncBlockList?: boolean;
      },
    ) => {
      setActiveBlockId(block.blockId);
      setHoveredBlockId(block.blockId);
      setActivePdfHighlight(
        options?.syncPdfHighlight === false ? null : createHighlightTarget(block),
      );

      if (options?.syncBlockList !== false) {
        setBlockScrollSignal((current) => current + 1);
      }

      setStatusMessage(nextStatus);
    },
    [createHighlightTarget],
  );

  const clearSelection = useCallback(() => {
    setActiveBlockId(null);
    setHoveredBlockId(null);
    setActivePdfHighlight(null);
    setStatusMessage('宸叉竻闄ゅ綋鍓嶇粨鏋勫潡閫変腑鐘舵€?);
  }, []);

  const resetLayout = useCallback(() => {
    setLeftPaneWidthRatio(0.5);
    setStatusMessage('宸叉仮澶嶉粯璁ら槄璇诲垎鏍忔瘮渚?);
  }, []);

  const handleDocumentSearchStep = useCallback(
    (direction: 1 | -1) => {
      if (documentSearchMatches.length === 0) {
        setStatusMessage(
          normalizedDocumentSearchQuery ? '没有找到匹配的结构块' : '请输入文内检索关键词',
        );
        return;
      }

      const nextCursor =
        (documentSearchCursor + direction + documentSearchMatches.length) %
        documentSearchMatches.length;
      const nextBlock = documentSearchMatches[nextCursor];

      setDocumentSearchCursor(nextCursor);
      activateBlock(
        nextBlock,
        `鏂囧唴妫€绱?${nextCursor + 1} / ${documentSearchMatches.length} 璺?${nextBlock.blockId}`,
      );
    },
    [activateBlock, documentSearchCursor, documentSearchMatches, normalizedDocumentSearchQuery],
  );

  const openWorkspaceDocument = useCallback(
    async (
      item: WorkspaceItem,
      source: Exclude<PdfSource, null>,
      openingStatus: string,
      nextStage: WorkspaceStage,
    ): Promise<boolean> => {
      setLoading(true);
      setError('');

      try {
        const binary = await loadPdfBinary(source);
        let resolvedSource = source;
        let resolvedPdfPath = source.kind === 'local-path' ? source.path : '';
        let nextStatus = openingStatus;
        const resolvedItem =
          source.kind === 'local-path' ? { ...item, localPdfPath: source.path } : item;

        let nextResolvedItem = resolvedItem;

        if (source.kind === 'remote-url' && binary && settings.remotePdfDownloadDir.trim()) {
          const downloadPath = buildRemotePdfDownloadPath(
            settings.remotePdfDownloadDir,
            item,
            source,
          );

          try {
            await downloadRemoteFileToPath(source.url, downloadPath, source.headers);
            resolvedPdfPath = downloadPath;
            nextResolvedItem = { ...item, localPdfPath: downloadPath };
            nextStatus = `${openingStatus}，并已保存到本地下载目录`;
          } catch {
            nextStatus = `${openingStatus}，但保存到本地下载目录失败`;
          }
        }

        setPdfSource(resolvedSource);
        setPdfData(binary);
        setPdfPath(resolvedPdfPath);
        setCurrentDocument(nextResolvedItem);
        setWorkspaceStage(nextStage);
        resetDocumentState();
        onDocumentResolved(nextResolvedItem);

        if (resolvedSource.kind === 'local-path') {
          const cachedMineru = await tryLoadSavedMineruPages(nextResolvedItem);

          if (cachedMineru) {
            applyMineruPages(cachedMineru.pages, cachedMineru.path, {
              item: nextResolvedItem,
              pdfPath: resolvedPdfPath,
              pdfSource: resolvedSource,
              statusMessage: cachedMineru.message,
            });
            nextStatus = cachedMineru.message;
          } else if (settings.autoLoadSiblingJson) {
            const siblingJsonPath = guessSiblingJsonPath(resolvedSource.path);

            try {
              const jsonText = await readLocalTextFile(siblingJsonPath);
              const pages = parseMineruPages(jsonText);

              const siblingStatusMessage = `宸叉墦寮€銆?{item.title}》，并自动读取同目录 MinerU JSON`;

              applyMineruPages(pages, siblingJsonPath, {
                item: nextResolvedItem,
                pdfPath: resolvedSource.path,
                pdfSource: resolvedSource,
                statusMessage: siblingStatusMessage,
              });
              nextStatus = `宸叉墦寮€銆?{item.title}》，并自动读取同目录 MinerU JSON`;

              await saveMineruParseCache({
                item: nextResolvedItem,
                pdfPath: resolvedSource.path,
                sourceKind: 'sibling-json',
                contentJsonText: jsonText,
              }).catch(() => undefined);
            } catch {
              nextStatus = openingStatus;
            }
          }
        }

        setStatusMessage(nextStatus);
        return true;
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '打开文献失败');
        setStatusMessage('打开文献失败');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [
      applyMineruPages,
      onDocumentResolved,
      resetDocumentState,
      saveMineruParseCache,
      settings.autoLoadSiblingJson,
      settings.remotePdfDownloadDir,
      tryLoadSavedMineruPages,
    ],
  );

  const openDocumentItem = useCallback(async () => {
    setCurrentDocument(document);

    const candidateLocalPaths: string[] = [];
    const history = loadPaperHistory(document.workspaceId);

    if (history?.lastPdfPath?.trim()) {
      appendUniqueLocalPath(candidateLocalPaths, history.lastPdfPath);
    }

    if (document.localPdfPath?.trim()) {
      appendUniqueLocalPath(candidateLocalPaths, document.localPdfPath);
    }

    if (document.attachmentKey && settings.remotePdfDownloadDir.trim()) {
      appendUniqueLocalPath(
        candidateLocalPaths,
        buildRemotePdfDownloadPath(settings.remotePdfDownloadDir, document),
      );
    }

    const cachedPdfPath = await tryResolveSavedPdfPath(document);

    if (cachedPdfPath) {
      appendUniqueLocalPath(candidateLocalPaths, cachedPdfPath);
    }

    if (candidateLocalPaths.length > 0) {
      for (const candidatePath of candidateLocalPaths) {
        const opened = await openWorkspaceDocument(
          { ...document, localPdfPath: candidatePath },
          { kind: 'local-path', path: candidatePath },
          `宸叉墦寮€銆?{document.title}》`,
          'reading',
        );

        if (opened) {
          return;
        }
      }
    }

    if (document.localPdfPath && candidateLocalPaths.length === 0) {
      await openWorkspaceDocument(
        document,
        { kind: 'local-path', path: document.localPdfPath },
        `宸叉墦寮€銆?{document.title}》`,
        'reading',
      );
      return;
    }

    if (!document.attachmentKey) {
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      setError('鐠囥儲娼惄顔界梾閺堝褰查幍鎾崇磻閻?PDF 附件');
      setStatusMessage('鐠囥儲娼惄顔界梾閺堝褰查幍鎾崇磻閻?PDF 附件');
      return;
    }

    if (!zoteroApiKey.trim()) {
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      onOpenPreferences();
      setError('褰撳墠鏉＄洰鐨勬湰鍦?PDF 不存在，请先在设置中填写 Zotero Web API Key');
      setStatusMessage('缺少 Zotero Web API Key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let userId = zoteroUserId.trim();

      if (!userId) {
        const keyInfo = await lookupZoteroKey(zoteroApiKey.trim());
        userId = keyInfo.userId;
        onZoteroUserIdChange(userId);
      }

      const remoteSource: Exclude<PdfSource, null> = {
        kind: 'remote-url',
        url: buildZoteroAttachmentPdfUrl(userId, document.attachmentKey),
        fileName: document.attachmentFilename || document.attachmentTitle || `${document.title}.pdf`,
        headers: {
          'Zotero-API-Key': zoteroApiKey.trim(),
          'Zotero-API-Version': '3',
        },
      };

      const resolvedDocument: WorkspaceItem = {
        ...document,
        localPdfPath: undefined,
      };

      await openWorkspaceDocument(
        resolvedDocument,
        remoteSource,
        `已通过 Zotero Web 閻╃绻涢幍鎾崇磻閵?{document.title}》`,
        'reading',
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '打开 Zotero 文献失败');
      setStatusMessage('打开 Zotero 文献失败');
    } finally {
      setLoading(false);
    }
  }, [
    document,
    onOpenPreferences,
    onZoteroUserIdChange,
    openWorkspaceDocument,
    settings.remotePdfDownloadDir,
    tryResolveSavedPdfPath,
    zoteroApiKey,
    zoteroUserId,
  ]);

  const handleOpenMineruJson = useCallback(async () => {
    if (!pdfSource) {
      setStatusMessage('请先打开 PDF锛屽啀鍔犺浇瀵瑰簲鐨?MinerU JSON');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const path = await selectLocalMineruJsonPath();

      if (!path) {
        setStatusMessage('已取消选择 MinerU JSON');
        return;
      }

      const jsonText = await readLocalTextFile(path);
      const pages = parseMineruPages(jsonText);

      applyMineruPages(pages, path, {
        item: currentDocument,
        pdfPath,
        pdfSource,
        statusMessage: '已加载结构化 JSON',
      });
      if (currentDocument && pdfPath) {
        await saveMineruParseCache({
          item: currentDocument,
          pdfPath,
          sourceKind: 'manual-json',
          contentJsonText: jsonText,
        }).catch(() => undefined);
      }

      setStatusMessage('已加载结构化 JSON');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '打开 MinerU JSON 失败');
      setStatusMessage('打开 MinerU JSON 失败');
    } finally {
      setLoading(false);
    }
  }, [applyMineruPages, currentDocument, pdfPath, pdfSource, saveMineruParseCache]);

  const handlePdfBlockSelect = useCallback(
    (block: PositionedMineruBlock) => {
      activateBlock(block, `已从 PDF 閫変腑缁撴瀯鍧?${block.blockId}`, {
        syncPdfHighlight: false,
      });
    },
    [activateBlock],
  );

  const handlePdfBlockHover = useCallback((block: PositionedMineruBlock | null) => {
    setHoveredBlockId(block?.blockId ?? null);
  }, []);

  const handleBlockClick = useCallback(
    (block: PositionedMineruBlock) => {
      activateBlock(block, `宸插畾浣嶅埌鍙充晶缁撴瀯鍧?${block.blockId}`, {
        syncBlockList: false,
      });
    },
    [activateBlock],
  );

  const handleCloudParse = useCallback(async () => {
    if (!pdfPath) {
      setStatusMessage('请先打开 PDF，再调用云端解析');
      return;
    }

    if (!mineruApiToken.trim()) {
      onOpenPreferences();
      setError('请先在设置中填写 MinerU API Token');
      return;
    }

    setLoading(true);
    setError('');
    setStatusMessage('正在提交 PDF 閸?MinerU 云端解析');

    try {
      const cachePaths =
        currentDocument && settings.mineruCacheDir.trim()
          ? buildMineruCachePaths(settings.mineruCacheDir.trim(), currentDocument)
          : null;
      const result = await runMineruCloudParse({
        apiToken: mineruApiToken.trim(),
        pdfPath,
        extractDir: cachePaths?.directory,
        language: 'ch',
        modelVersion: 'vlm',
        enableFormula: true,
        enableTable: true,
        isOcr: false,
        timeoutSecs: 900,
        pollIntervalSecs: 5,
      });
      const jsonText = result.contentJsonText ?? result.middleJsonText;

      if (!jsonText) {
        throw new Error('MinerU 杩斿洖缁撴灉涓病鏈夋壘鍒板彲鐢ㄧ殑缁撴瀯鍖?JSON');
      }

      const pages = parseMineruPages(jsonText);
      let nextMineruPath =
        result.contentJsonPath || result.middleJsonPath || `cloud:${result.fileName}:${result.batchId}`;
      let nextStatusMessage = `云端解析完成，批次号 ${result.batchId}`;

      if (currentDocument) {
        const savedPaths = await saveMineruParseCache({
          item: currentDocument,
          pdfPath,
          sourceKind: 'cloud',
          contentJsonText: result.contentJsonText,
          middleJsonText: result.middleJsonText,
          markdownText: result.markdownText,
          batchId: result.batchId,
          dataId: result.dataId,
          fileName: result.fileName,
          zipEntries: result.zipEntries,
        }).catch(() => null);

        if (savedPaths) {
          nextMineruPath =
            result.contentJsonPath ||
            result.middleJsonPath ||
            (result.contentJsonText?.trim() ? savedPaths.contentJsonPath : savedPaths.middleJsonPath);
          nextStatusMessage = `浜戠瑙ｆ瀽瀹屾垚锛屽凡淇濆瓨鍒?${savedPaths.directory}`;
        }
      }

      applyMineruPages(pages, nextMineruPath, {
        item: currentDocument,
        pdfPath,
        pdfSource,
        statusMessage: nextStatusMessage,
      });
      setStatusMessage(nextStatusMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '云端解析失败');
      setStatusMessage('云端解析失败');
    } finally {
      setLoading(false);
    }
  }, [
    applyMineruPages,
    currentDocument,
    mineruApiToken,
    onOpenPreferences,
    pdfPath,
    saveMineruParseCache,
    settings.mineruCacheDir,
  ]);

  const handleTranslateDocument = useCallback(async () => {
    const blocksToTranslate = flatBlocks
      .map((block) => ({
        blockId: block.blockId,
        text: extractTextFromMineruBlock(block),
      }))
      .filter((block) => block.text.trim().length > 0);

    if (blocksToTranslate.length === 0) {
      setStatusMessage('瑜版挸澧犲▽鈩冩箒閸欘垳鐐曠拠鎴犳畱缂佹挻鐎崠鏍ㄦ瀮閺?);
      return;
    }

    if (!translationModelPreset || !translationModelPreset.apiKey.trim()) {
      onOpenPreferences();
      setError('请先在设置中填写 AI 接口 API Key');
      return;
    }

    setTranslating(true);
    setTranslationProgressCompleted(0);
    setTranslationProgressTotal(blocksToTranslate.length);
    setError('');
    setStatusMessage(`正在翻译 ${blocksToTranslate.length} 个结构块`);

    try {
      const batchSize = Math.max(1, settings.translationBatchSize);
      const concurrency = Math.max(1, settings.translationConcurrency);
      const batches = chunkItems(blocksToTranslate, batchSize);
      const collectedTranslations = new Map<string, string>();
      let completedBlocks = 0;
      let cursor = 0;

      const runWorker = async () => {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;

          if (currentIndex >= batches.length) {
            return;
          }

          const batch = batches[currentIndex];
          const translations = await translateBlocksOpenAICompatible({
            baseUrl: translationModelPreset.baseUrl,
            apiKey: translationModelPreset.apiKey.trim(),
            model: translationModelPreset.model,
            sourceLanguage: settings.translationSourceLanguage,
            targetLanguage: settings.translationTargetLanguage,
            blocks: batch,
            batchSize: batch.length,
            concurrency: 1,
          });

          for (const translation of translations) {
            if (translation.translatedText.trim()) {
              collectedTranslations.set(translation.blockId, translation.translatedText);
            }
          }

          completedBlocks = Math.min(blocksToTranslate.length, completedBlocks + batch.length);
          setTranslationProgressCompleted(completedBlocks);
          setStatusMessage(`正在翻译 ${completedBlocks}/${blocksToTranslate.length} 个块`);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, batches.length) }, () => runWorker()),
      );
      const nextTranslations: TranslationMap = {};

      for (const [blockId, translatedText] of collectedTranslations.entries()) {
        nextTranslations[blockId] = translatedText;
      }

      setBlockTranslations(nextTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setTranslationProgressCompleted(blocksToTranslate.length);

      if (currentDocument) {
        await saveTranslationCache(currentDocument, nextTranslations).catch(() => undefined);
      }
      setStatusMessage(`翻译完成，已生成 ${Object.keys(nextTranslations).length} 段译文`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '翻译失败');
      setStatusMessage('翻译失败');
    } finally {
      setTranslating(false);
      setTranslationProgressTotal(0);
    }
  }, [
    currentDocument,
    flatBlocks,
    onOpenPreferences,
    saveTranslationCache,
    settings.translationBatchSize,
    settings.translationConcurrency,
    settings.translationSourceLanguage,
    settings.translationTargetLanguage,
    translationModelPreset,
  ]);

  const handleClearTranslations = useCallback(() => {
    setBlockTranslations({});
    setStatusMessage('已清空当前文稿的译文缓存');
  }, []);

  const loadMineruMarkdownForSummary = useCallback(async () => {
    const candidatePaths = new Set<string>();

    if (mineruPath.trim() && !mineruPath.startsWith('cloud:')) {
      candidatePaths.add(guessSiblingMarkdownPath(mineruPath));
    }

    if (settings.mineruCacheDir.trim()) {
      for (const cachePaths of [
        buildMineruCachePaths(settings.mineruCacheDir.trim(), currentDocument),
        buildLegacyMineruCachePaths(settings.mineruCacheDir.trim(), currentDocument),
      ]) {
        candidatePaths.add(cachePaths.markdownPath);
      }
    }

    for (const candidatePath of candidatePaths) {
      try {
        const markdownText = await readLocalTextFile(candidatePath);

        if (markdownText.trim()) {
          return markdownText;
        }
      } catch {
        continue;
      }
    }

    const fallbackMarkdown = buildMineruMarkdownDocument(flatBlocks, mineruPath);

    if (fallbackMarkdown.trim()) {
      return fallbackMarkdown;
    }

    throw new Error('请先加载 MinerU 鐟欙絾鐎界紒鎾寸亯閹?full.md，再使用 MinerU Markdown 閻㈢喐鍨氶幗妯款洣閵?);
  }, [
    currentDocument,
    flatBlocks,
    mineruPath,
    settings.mineruCacheDir,
  ]);

  const resolveSummaryRequest = useCallback(async () => {
    if (settings.summarySourceMode === 'pdf-text') {
      if (!pdfData) {
        throw new Error('请先加载 PDF，再使用 PDF 鏂囨湰鐢熸垚鎽樿銆?);
      }

      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        throw new Error('閺堫亣鍏樻禒搴＄秼閸?PDF 提取到可用文本，请尝试切换摘要来源或重新加载 PDF閵?);
      }

      return {
        blocks: summaryBlockInputs,
        documentText,
      };
    }

    return {
      blocks: summaryBlockInputs,
      documentText: await loadMineruMarkdownForSummary(),
    };
  }, [
    loadMineruMarkdownForSummary,
    pdfData,
    settings.summarySourceMode,
    summaryBlockInputs,
  ]);

  const resolveQaRequest = useCallback(async () => {
    if (settings.qaSourceMode === 'pdf-text') {
      if (!pdfData) {
        throw new Error('请先打开当前 PDF，再使用基于本地 PDF 鏂囨湰鐨勬枃妗ｉ棶绛斻€?);
      }

      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        throw new Error('当前 PDF 閺堫亝褰侀崣鏍у煂閸欘垳鏁ら弬鍥ㄦ拱閿涘矁顕崚鍥ㄥ床閸?MinerU 内容问答，或确认 PDF 鍙鏈湴鏂囨湰灞傝鍙栥€?);
      }

      return {
        blocks: summaryBlockInputs,
        documentText,
      };
    }

    const documentText = await loadMineruMarkdownForSummary();

    if (!documentText.trim() && summaryBlockInputs.length === 0) {
      throw new Error('请先加载 MinerU JSON 閹存牕鐣幋鎰隘缁旑垵袙閺嬫劧绱濋崘宥勫▏閻劌鐔€娴?MinerU 鍐呭鐨勬枃妗ｉ棶绛斻€?);
    }

    return {
      blocks: summaryBlockInputs,
      documentText,
    };
  }, [
    loadMineruMarkdownForSummary,
    pdfData,
    settings.qaSourceMode,
    summaryBlockInputs,
  ]);

  const handleGeneratePaperSummary = useCallback(
    async (openPreferencesOnMissingKey = true) => {
      if (!currentDocument) {
        return;
      }

      if (settings.summarySourceMode === 'mineru-markdown' && summaryBlockInputs.length === 0) {
        setPaperSummary(null);
        setPaperSummaryError('请先加载 MinerU JSON 閹存牕鐣幋鎰隘缁旑垵袙閺嬫劧绱濋崘宥囨晸閹存劘顔戦弬鍥洤鐟欏牄鈧?);
        setStatusMessage('璇峰厛鍔犺浇缁撴瀯鍖栧唴瀹癸紝鍐嶇敓鎴愭憳瑕?);
        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.baseUrl.trim()) {
        setPaperSummary(null);
        setPaperSummaryError('璇峰厛鍦ㄨ缃腑濉啓鎽樿妯″瀷鐨?OpenAI 兼容 Base URL閵?);
        setStatusMessage('缺少摘要接口 Base URL');

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.apiKey.trim()) {
        setStatusMessage('缺少摘要接口 API Key');
        setPaperSummary(null);
        setPaperSummaryError('璇峰厛鍦ㄨ缃腑濉啓鎽樿妯″瀷鐨?API Key閵?);

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.model.trim()) {
        setPaperSummary(null);
        setPaperSummaryError('璇峰厛鍦ㄨ缃腑濉啓鎽樿妯″瀷鍚嶇О銆?);
        setStatusMessage('缺少摘要模型名称');

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      const requestId = summaryRequestIdRef.current + 1;
      summaryRequestIdRef.current = requestId;

      setPaperSummaryLoading(true);
      setPaperSummaryError('');
      setStatusMessage('濮濓絽婀悽鐔稿灇鐠佺儤鏋冮幗妯款洣閳?);

      try {
        const summaryRequest = await resolveSummaryRequest();
        const cachedSummary = await tryLoadSavedSummary(currentDocument, paperSummaryNextSourceKey);

        if (cachedSummary) {
          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          setPaperSummary(cachedSummary);
          setPaperSummarySourceKey(paperSummaryNextSourceKey);
          setStatusMessage('已从本地缓存恢复论文摘要');
          return;
        }

        const summary = await summarizeDocumentOpenAICompatible({
          baseUrl: summaryModelPreset.baseUrl,
          apiKey: summaryModelPreset.apiKey.trim(),
          model: summaryModelPreset.model,
          title: currentDocument.title,
          authors: currentDocument.creators || undefined,
          year: currentDocument.year || undefined,
          blocks: summaryRequest.blocks,
          documentText: summaryRequest.documentText,
        });

        if (summaryRequestIdRef.current !== requestId) {
          return;
        }

        setPaperSummary(summary);
        setPaperSummarySourceKey(paperSummaryNextSourceKey);
        await saveSummaryCache(currentDocument, paperSummaryNextSourceKey, summary).catch(
          () => undefined,
        );
        setStatusMessage('宸茬敓鎴愯鏂囨瑙?);
      } catch (nextError) {
        if (summaryRequestIdRef.current !== requestId) {
          return;
        }

        setPaperSummary(null);
        setPaperSummaryError(nextError instanceof Error ? nextError.message : '生成论文概览失败');
        setStatusMessage('论文摘要生成失败');
      } finally {
        if (summaryRequestIdRef.current === requestId) {
          setPaperSummaryLoading(false);
        }
      }
    },
    [
      currentDocument,
      onOpenPreferences,
      paperSummaryNextSourceKey,
      resolveSummaryRequest,
      saveSummaryCache,
      settings.summarySourceMode,
      summaryBlockInputs.length,
      summaryModelPreset,
      tryLoadSavedSummary,
    ],
  );

  const handleTextSelect = useCallback((selection: TextSelectionPayload, source: TextSelectionSource) => {
    const normalizedText = normalizeSelectedText(selection.text);

    if (!normalizedText) {
      return;
    }

    const now = Date.now();
    const lastCapturedSelection = lastCapturedSelectionRef.current;

    if (
      lastCapturedSelection &&
      lastCapturedSelection.source === source &&
      lastCapturedSelection.text === normalizedText &&
      now - lastCapturedSelection.capturedAt < 250
    ) {
      return;
    }

    lastCapturedSelectionRef.current = {
      source,
      text: normalizedText,
      capturedAt: now,
    };

    setSelectedExcerpt({
      text: normalizedText,
      source,
      createdAt: Date.now(),
      anchorClientX: selection.anchorClientX,
      anchorClientY: selection.anchorClientY,
      placement: selection.placement,
    });
    setSelectedExcerptTranslation('');
    setSelectedExcerptError('');
    setStatusMessage(source === 'pdf' ? '宸叉崟鑾?PDF 划词' : '宸叉崟鑾锋鏂囧垝璇?);
  }, []);

  const handleTranslateSelectedExcerpt = useCallback(
    async (openPreferencesOnMissingKey = true) => {
      if (!selectedExcerpt) {
        setStatusMessage('鐠囧嘲鍘涢柅澶夎厬娑撯偓濞堝灚鏋冪€?);
        setSelectedExcerptError('璇峰厛鍦?PDF 閹存牗顒滈弬鍥﹁厬闁鑵戞稉鈧▓鍨瀮鐎涙ぜ鈧?);
        return;
      }

      const selectionRequestKey = `${selectedExcerpt.source}::${selectedExcerpt.text}`;

      if (selectionRequestKeyRef.current === selectionRequestKey) {
        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.baseUrl.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError('请先在设置中填写 OpenAI 兼容 Base URL閵?);
        setStatusMessage('缺少翻译接口 Base URL');

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.apiKey.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError('请先在设置中填写 AI 接口 API Key閵?);
        setStatusMessage('缺少翻译接口 API Key');

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.model.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError('璇峰厛鍦ㄨ缃腑濉啓妯″瀷鍚嶇О銆?);
        setStatusMessage('缺少翻译模型名称');

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      const requestId = selectedExcerptRequestIdRef.current + 1;
      selectedExcerptRequestIdRef.current = requestId;
      selectionRequestKeyRef.current = selectionRequestKey;

      setSelectedExcerptTranslating(true);
      setSelectedExcerptError('');
      setStatusMessage('姝ｅ湪缈昏瘧鍒掕瘝鈥?);

      try {
        const result = await translateBlocksOpenAICompatible({
          baseUrl: selectionTranslationModelPreset.baseUrl,
          apiKey: selectionTranslationModelPreset.apiKey.trim(),
          model: selectionTranslationModelPreset.model,
          sourceLanguage: settings.translationSourceLanguage,
          targetLanguage: settings.translationTargetLanguage,
          blocks: [
            {
              blockId: 'selection',
              text: selectedExcerpt.text,
            },
          ],
          batchSize: 1,
        });

        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        const translatedText = result[0]?.translatedText?.trim() ?? '';

        setSelectedExcerptTranslation(translatedText);

        if (!translatedText) {
          setSelectedExcerptError('妯″瀷杩斿洖鎴愬姛锛屼絾娌℃湁鐢熸垚璇戞枃銆?);
          setStatusMessage('划词翻译结果为空');
          return;
        }

        setStatusMessage('宸茬敓鎴愬垝璇嶈瘧鏂?);
      } catch (nextError) {
        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedExcerptTranslation('');
        setSelectedExcerptError(nextError instanceof Error ? nextError.message : '划词翻译失败');
        setStatusMessage('划词翻译失败');
      } finally {
        if (selectionRequestKeyRef.current === selectionRequestKey) {
          selectionRequestKeyRef.current = '';
        }

        if (selectedExcerptRequestIdRef.current === requestId) {
          setSelectedExcerptTranslating(false);
        }
      }
    },
    [
      onOpenPreferences,
      selectedExcerpt,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      selectionTranslationModelPreset,
    ],
  );

  const handleAppendSelectedExcerptToQa = useCallback(() => {
    if (!selectedExcerpt) {
      return;
    }

    const excerptPrompt = `请结合这段划词内容回答：\n閳?{selectedExcerpt.text}”`;

    setQaInput((current) => (current.trim() ? `${current}\n\n${excerptPrompt}` : excerptPrompt));
    setStatusMessage('瀹告彃鐨㈤崚鎺曠槤閸愬懎顔愰崝鐘插弳闂傤喚鐡熸潏鎾冲弳濡?);
  }, [selectedExcerpt]);

  const handleClearSelectedExcerpt = useCallback(() => {
    lastCapturedSelectionRef.current = null;
    selectionRequestKeyRef.current = '';
    autoTranslatedSelectionKeyRef.current = '';
    setSelectedExcerpt(null);
    setSelectedExcerptTranslation('');
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError('');
    setStatusMessage('宸叉竻闄ゅ綋鍓嶅垝璇?);
  }, []);

  const legacyHandlePdfAnnotationSaveSuccess = useCallback((path: string) => {
    setStatusMessage(`已导出批注版 PDF閿?{path}`);
  }, []);

  const switchCurrentPdfFile = useCallback(
    async (path: string, nextStatusMessage: string) => {
      setLoading(true);
      setError('');

      try {
        const nextSource: Exclude<PdfSource, null> = { kind: 'local-path', path };
        const nextBytes = await loadPdfBinary(nextSource);

        setPdfSource(nextSource);
        setPdfData(nextBytes);
        setPdfPath(path);
        setCurrentDocument((current) => ({ ...current, localPdfPath: path }));
        setStatusMessage(nextStatusMessage);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to switch PDF');
        setStatusMessage('Failed to switch PDF');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handlePdfAnnotationSaveSuccess = useCallback(
    (path: string) => {
      void switchCurrentPdfFile(path, `Switched to saved annotated PDF: ${getFileNameFromPath(path)}`);
    },
    [switchCurrentPdfFile],
  );

  const handleOpenOriginalPdf = useCallback(() => {
    if (!originalPdfPath) {
      setStatusMessage('No original PDF is available for this paper');
      return;
    }

    void switchCurrentPdfFile(
      originalPdfPath,
      `Switched to original PDF: ${getFileNameFromPath(originalPdfPath)}`,
    );
  }, [originalPdfPath, switchCurrentPdfFile]);

  const handleSelectProjectPdf = useCallback(
    (path: string) => {
      if (!path.trim()) {
        return;
      }

      if (currentLocalPdfPath && isSameLocalPath(path, currentLocalPdfPath)) {
        return;
      }

      void switchCurrentPdfFile(path, `Switched to PDF: ${getFileNameFromPath(path)}`);
    },
    [currentLocalPdfPath, switchCurrentPdfFile],
  );

  const handleOpenFloatingAssistant = useCallback(() => {
    setAssistantDetached(true);
    setAssistantActivePanel((current) => current ?? 'chat');
    setWorkspaceStage('reading');
    setStatusMessage('AI 助手已切换为主窗口内浮动面板');
  }, []);

  const handleAttachAssistant = useCallback(() => {
    setAssistantDetached(false);
    setStatusMessage('AI 閸斺晜澧滃鎻掍粻闂堢姴娲栭崣鍏呮櫠閺?);
  }, []);

  const handleCreateQaSession = useCallback(() => {
    const nextSession = createQaSession();

    setQaSessions((current) => [...current, nextSession]);
    setSelectedQaSessionId(nextSession.id);
    setQaInput('');
    setQaAttachments([]);
    setQaLoading(false);
    setQaError('');
    setStatusMessage('宸叉柊寤洪棶绛斾細璇?);
  }, []);

  const handleSelectQaSession = useCallback(
    (sessionId: string) => {
      if (sessionId === selectedQaSessionId) {
        return;
      }

      const nextSession = qaSessions.find((session) => session.id === sessionId);

      if (!nextSession) {
        return;
      }

      setSelectedQaSessionId(nextSession.id);
      setQaInput('');
      setQaAttachments([]);
      setQaError('');
      setStatusMessage(`宸插垏鎹㈠埌浼氳瘽锛?{nextSession.title}`);
    },
    [qaSessions, selectedQaSessionId],
  );

  const handleDeleteQaSession = useCallback(
    (sessionId: string) => {
      const nextSessions = qaSessions.filter((session) => session.id !== sessionId);

      if (nextSessions.length === qaSessions.length) {
        return;
      }

      if (nextSessions.length === 0) {
        const initialSession = createQaSession();

        setQaSessions([initialSession]);
        setSelectedQaSessionId(initialSession.id);
      } else {
        setQaSessions(nextSessions);
        setSelectedQaSessionId((current) =>
          current === sessionId ? nextSessions[0].id : current,
        );
      }

      setQaInput('');
      setQaAttachments([]);
      setQaLoading(false);
      setQaError('');
      setStatusMessage('宸插垹闄ら棶绛斾細璇?);
    },
    [qaSessions],
  );

  const handleQaPresetChange = useCallback(
    (presetId: string) => {
      const nextPreset =
        qaModelPresets.find((preset) => preset.id === presetId) ?? qaModelPresets[0] ?? null;

      if (!nextPreset) {
        return;
      }

      setSelectedQaPresetId(nextPreset.id);
      onQaActivePresetChange(nextPreset.id);
      setStatusMessage(`已切换问答模型：${nextPreset.label}`);
    },
    [onQaActivePresetChange, qaModelPresets],
  );

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setQaAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const handleAppendSelectedExcerptToNote = useCallback(() => {
    if (!selectedExcerpt?.text.trim()) {
      return;
    }

    setWorkspaceNoteMarkdown((current) =>
      appendMarkdownSection(current, formatQuoteMarkdown(selectedExcerpt.text)),
    );
    setStatusMessage('宸插皢鍒掕瘝鍐呭杩藉姞鍒扮瑪璁?);
  }, [selectedExcerpt]);

  const handleCreateAnnotation = useCallback(
    (note: string) => {
      if (!activeBlock || !activeBlock.bbox) {
        setStatusMessage('请先选中一个可批注的结构块');
        return;
      }

      const normalizedNote = note.trim();
      const quote =
        selectedExcerpt?.text.trim() || extractTextFromMineruBlock(activeBlock).slice(0, 240);

      if (!normalizedNote && !quote) {
        setStatusMessage('批注内容不能为空');
        return;
      }

      const now = Date.now();
      const nextAnnotation: PaperAnnotation = {
        id: `annotation-${now}-${Math.random().toString(16).slice(2, 8)}`,
        blockId: activeBlock.blockId,
        blockType: activeBlock.type,
        pageIndex: activeBlock.pageIndex,
        bbox: activeBlock.bbox,
        bboxCoordinateSystem: activeBlock.bboxCoordinateSystem,
        bboxPageSize: activeBlock.bboxPageSize,
        note: normalizedNote,
        quote,
        createdAt: now,
        updatedAt: now,
      };

      setAnnotations((current) => [nextAnnotation, ...current]);
      setSelectedAnnotationId(nextAnnotation.id);
      setStatusMessage(`宸蹭负缁撴瀯鍧?${activeBlock.blockId} 添加批注`);
    },
    [activeBlock, selectedExcerpt],
  );

  const handleDeleteAnnotation = useCallback((annotationId: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    setSelectedAnnotationId((current) => (current === annotationId ? null : current));
    setStatusMessage('瀹告彃鍨归梽銈嗗濞?);
  }, []);

  const handleSelectAnnotation = useCallback(
    (annotationId: string) => {
      const targetAnnotation = annotations.find((annotation) => annotation.id === annotationId);

      if (!targetAnnotation) {
        return;
      }

      const targetBlock = flatBlocks.find((block) => block.blockId === targetAnnotation.blockId);

      if (!targetBlock) {
        setStatusMessage('鐠囥儲澹掑▔銊ヮ嚠鎼存梻娈戠紒鎾寸€崸妤€鍑℃稉宥呯摠閸?);
        return;
      }

      setSelectedAnnotationId(targetAnnotation.id);
      activateBlock(targetBlock, `已定位到批注 ${targetAnnotation.blockId}`);
    },
    [activateBlock, annotations, flatBlocks],
  );

  const handleSelectQaAttachments = useCallback(
    async (kind: 'image' | 'file') => {
      try {
        const paths = await selectChatAttachmentPaths(kind);

        if (paths.length === 0) {
          setStatusMessage(kind === 'image' ? '已取消选择图片附件' : '已取消选择文件附件');
          return;
        }

        const attachments = await Promise.all(paths.map((path) => buildAttachmentFromPath(path, kind)));

        setQaAttachments((current) => {
          const existingKeys = new Set(
            current.map((attachment) => `${attachment.filePath || attachment.name}:${attachment.size}`),
          );
          const nextItems = attachments.filter(
            (attachment) =>
              !existingKeys.has(`${attachment.filePath || attachment.name}:${attachment.size}`),
          );

          return [...current, ...nextItems];
        });
        setStatusMessage(`宸叉坊鍔?${attachments.length} 个问答附件`);
      } catch (nextError) {
        setQaError(nextError instanceof Error ? nextError.message : '加载问答附件失败');
      }
    },
    [],
  );

  const handleCaptureScreenshot = useCallback(() => {
    if (!layoutRef.current) {
      setQaError('当前没有可框选截图的阅读区域');
      return;
    }

    if (capturingScreenshot || screenshotSelection) {
      return;
    }

    const bounds = layoutRef.current.getBoundingClientRect();

    if (bounds.width < 40 || bounds.height < 40) {
      setQaError('瑜版挸澧犻梼鍛邦嚢閸栧搫鐓欐潻鍥х毈閿涘本妫ゅ▔鏇熷焻閸?);
      return;
    }

    setQaError('');
    setScreenshotSelection({
      bounds: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      startX: null,
      startY: null,
      currentX: null,
      currentY: null,
    });
    setStatusMessage('鎷栨嫿榧犳爣妗嗛€夋埅鍥惧尯鍩燂紝鎸?Esc 取消');
  }, [capturingScreenshot, screenshotSelection]);
const cancelScreenshotSelection = useCallback((message = '宸插彇娑堟閫夋埅鍥?) => {
    setScreenshotSelection(null);
    setStatusMessage(message);
  }, []);

  const finalizeScreenshotSelection = useCallback(
    async (selectionRect: ScreenshotSelectionRect) => {
      if (!layoutRef.current) {
        setQaError('当前没有可截图的阅读区域');
        return;
      }

      const captureNode = layoutRef.current;
      const captureWidth = Math.max(360, captureNode.clientWidth);
      const captureHeight = Math.max(240, captureNode.clientHeight);
      const maxLongSide = 1800;
      const canvasScale = Math.min(1, maxLongSide / Math.max(captureWidth, captureHeight));

      try {
        setCapturingScreenshot(true);
        setQaError('');
        setStatusMessage('姝ｅ湪鐢熸垚妗嗛€夋埅鍥?..');
        await waitForNextPaint();
        const blob = await toBlob(captureNode, {
          cacheBust: true,
          backgroundColor: '#f8fafc',
          pixelRatio: 1,
          skipFonts: true,
          width: captureWidth,
          height: captureHeight,
          canvasWidth: Math.round(captureWidth * canvasScale),
          canvasHeight: Math.round(captureHeight * canvasScale),
        });

        if (!blob) {
          throw new Error('截图结果为空');
        }

        const croppedBlob = await cropScreenshotBlob(
          blob,
          selectionRect,
          captureWidth,
          captureHeight,
        );
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const attachment: DocumentChatAttachment = {
          id: createAttachmentId(),
          kind: 'screenshot',
          name: `${currentDocument.title || 'paper'}-${timestamp}.png`,
          mimeType: croppedBlob.type || 'image/png',
          size: croppedBlob.size,
          dataUrl: await blobToDataUrl(croppedBlob),
          summary: '妗嗛€夋埅鍥?,
        };

        setQaAttachments((current) => [...current, attachment]);
        setStatusMessage('宸插皢妗嗛€夋埅鍥惧姞鍏ュ綋鍓嶉棶绛?);
      } catch (nextError) {
        setQaError(nextError instanceof Error ? nextError.message : '截图失败');
      } finally {
        setCapturingScreenshot(false);
      }
    },
    [currentDocument.title],
  );

  useEffect(() => {
    if (!screenshotSelection) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      setScreenshotSelection((current) => {
        if (!current || current.startX === null || current.startY === null) {
          return current;
        }

        const point = normalizeSelectionPoint(event.clientX, event.clientY, current.bounds);

        return {
          ...current,
          currentX: point.x,
          currentY: point.y,
        };
      });
    };

    const handlePointerUp = () => {
      const nextSelection = screenshotSelectionRef.current;
      const selectionRect = buildSelectionRect(nextSelection);

      setScreenshotSelection(null);

      if (!selectionRect) {
        setStatusMessage('宸插彇娑堟閫夋埅鍥?);
        return;
      }

      void finalizeScreenshotSelection(selectionRect);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelScreenshotSelection();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cancelScreenshotSelection, finalizeScreenshotSelection, screenshotSelection]);

  const handleSubmitQa = useCallback(async () => {
    const question = qaInput.trim();

    if (!currentDocument || !question) {
      return;
    }

    if (!activeQaPreset) {
      setQaError('鐠囧嘲鍘涢崷銊啎缂冾喕鑵戦柊宥囩枂閼峰啿鐨稉鈧稉顏堟６缁涙梹膩閸ㄥ鈧?);
      onOpenPreferences();
      return;
    }

    if (!qaConfigured) {
      setQaError('璇峰厛琛ュ叏褰撳墠闂瓟妯″瀷鐨?Base URL、API Key 鍜屾ā鍨嬪悕绉般€?);
      onOpenPreferences();
      return;
    }

    let qaRequest: {
      blocks: SummaryBlockInput[];
      documentText: string;
    };

    try {
      qaRequest = await resolveQaRequest();
    } catch (nextError) {
      setQaError(nextError instanceof Error ? nextError.message : '瑜版挸澧犲▽鈩冩箒閸欘垳鏁ゆ禍搴ㄦ６缁涙梻娈戦弬鍥ㄣ€傛稉濠佺瑓閺?);
      return;
    }

    if (qaRequest.documentText === '__never__') {
      setQaError('请先加载 MinerU JSON，或先在 PDF / 濮濓絾鏋冩稉顓炲灊鐠囧秴鎮楅崘宥嗗絹闂傤喓鈧?);
      return;
    }

    const currentSession = activeQaSession ?? createQaSession();
    const previousSessions = qaSessions;
    const previousSelectedSessionId = selectedQaSessionId;
    const previousAttachments = qaAttachments;
    const nextUserMessage = createChatMessage('user', question, {
      attachments: qaAttachments,
      modelId: activeQaPreset.id,
      modelLabel: activeQaPreset.label,
    });
    const nextMessages: DocumentChatMessage[] = [
      ...currentSession.messages,
      nextUserMessage,
    ];
    const pendingSession: DocumentChatSession = {
      ...currentSession,
      title: buildQaSessionTitle(nextMessages),
      createdAt: currentSession.createdAt || nextUserMessage.createdAt,
      updatedAt: nextUserMessage.createdAt,
      messages: nextMessages,
    };

    setQaSessions((current) => updateQaSession(current, pendingSession));
    setSelectedQaSessionId(currentSession.id);
    setQaInput('');
    setQaAttachments([]);
    setQaLoading(true);
    setQaError('');

    try {
      const answer = await askDocumentOpenAICompatible({
        baseUrl: activeQaPreset.baseUrl,
        apiKey: activeQaPreset.apiKey.trim(),
        model: activeQaPreset.model,
        title: currentDocument.title,
        authors: currentDocument.creators || undefined,
        year: currentDocument.year || undefined,
        excerptText: selectedExcerpt?.text || undefined,
        documentText: qaRequest.documentText,
        blocks: qaRequest.blocks,
        messages: nextMessages.slice(-8),
      });

      const nextAnswerMessage = createChatMessage('assistant', answer, {
        modelId: activeQaPreset.id,
        modelLabel: activeQaPreset.label,
      });

      setQaSessions((current) =>
        updateQaSession(current, {
          ...pendingSession,
          updatedAt: nextAnswerMessage.createdAt,
          messages: [
            ...nextMessages,
            nextAnswerMessage,
          ],
        }),
      );
      setStatusMessage('鏂囨。闂瓟宸叉洿鏂?);
    } catch (nextError) {
      setQaSessions(previousSessions);
      setSelectedQaSessionId(previousSelectedSessionId);
      setQaAttachments(previousAttachments);
      setQaError(nextError instanceof Error ? nextError.message : '文档问答失败');
    } finally {
      setQaLoading(false);
    }
  }, [
    activeQaPreset,
    activeQaSession,
    currentDocument,
    onOpenPreferences,
    qaAttachments,
    qaConfigured,
    qaInput,
    qaSessions,
    resolveQaRequest,
    selectedQaSessionId,
    selectedExcerpt?.text,
  ]);

  useEffect(() => {
    const fallbackPresetId =
      qaModelPresets.find((preset) => preset.id === settings.qaActivePresetId)?.id ??
      qaModelPresets[0]?.id ??
      '';

    if (!fallbackPresetId) {
      return;
    }

    if (qaModelPresets.some((preset) => preset.id === selectedQaPresetId)) {
      return;
    }

    setSelectedQaPresetId(fallbackPresetId);
  }, [qaModelPresets, selectedQaPresetId, settings.qaActivePresetId]);

  useEffect(() => {
    if (qaSessions.length === 0) {
      const initialSession = createQaSession();

      setQaSessions([initialSession]);
      setSelectedQaSessionId(initialSession.id);
      return;
    }

    if (
      !selectedQaSessionId ||
      !qaSessions.some((session) => session.id === selectedQaSessionId)
    ) {
      setSelectedQaSessionId(qaSessions[0].id);
    }
  }, [qaSessions, selectedQaSessionId]);

  useEffect(() => {
    if (!currentDocument.workspaceId || !pdfSource) {
      return;
    }

    if (restoredHistoryRef.current === currentDocument.workspaceId) {
      return;
    }

    restoredHistoryRef.current = currentDocument.workspaceId;
    const history = loadPaperHistory(currentDocument.workspaceId);

    paperOpenedAtRef.current = history?.lastOpenedAt ?? Date.now();
    pendingHistoryActiveBlockIdRef.current = history?.lastActiveBlockId ?? null;

    if (!history) {
      setReadingViewMode('linked');
      setSelectedQaPresetId(
        qaModelPresets.find((preset) => preset.id === settings.qaActivePresetId)?.id ??
          qaModelPresets[0]?.id ??
          '',
      );
      return;
    }

    const nextPresetId =
      qaModelPresets.find((preset) => preset.id === history.selectedQaPresetId)?.id ??
      qaModelPresets.find((preset) => preset.id === settings.qaActivePresetId)?.id ??
      qaModelPresets[0]?.id ??
      '';
    const restoredSessions =
      history.qaSessions.length > 0 ? history.qaSessions : [createQaSession()];
    const restoredSessionId =
      (history.selectedQaSessionId &&
        restoredSessions.some((session) => session.id === history.selectedQaSessionId)
          ? history.selectedQaSessionId
          : restoredSessions[0]?.id) ?? '';

    setWorkspaceStage(history.workspaceStage);
    setReadingViewMode(history.readingViewMode);
    setPaperSummary(history.paperSummary);
    setPaperSummarySourceKey(history.paperSummarySourceKey);
    setWorkspaceNoteMarkdown(history.workspaceNoteMarkdown);
    setAnnotations(history.annotations);
    setQaSessions(restoredSessions);
    setSelectedQaSessionId(restoredSessionId);
    setSelectedQaPresetId(nextPresetId);

    if (history.paperSummary || history.qaSessions.length > 0 || Boolean(history.qaMessages?.length)) {
      setStatusMessage('宸叉仮澶嶈璁烘枃鐨勫巻鍙茶褰?);
    }
  }, [
    currentDocument.workspaceId,
    pdfSource,
    qaModelPresets,
    settings.qaActivePresetId,
  ]);

  useEffect(() => {
    if (currentDocument.source !== 'zotero-local' || !currentDocument.itemKey.trim()) {
      setZoteroRelatedNotes([]);
      setZoteroRelatedNotesLoading(false);
      setZoteroRelatedNotesError('');
      return;
    }

    if (!zoteroLocalDataDir.trim()) {
      setZoteroRelatedNotes([]);
      setZoteroRelatedNotesLoading(false);
      setZoteroRelatedNotesError('');
      return;
    }

    let cancelled = false;

    setZoteroRelatedNotesLoading(true);
    setZoteroRelatedNotesError('');

    void listLocalZoteroRelatedNotes({
      dataDir: zoteroLocalDataDir.trim(),
      itemKey: currentDocument.itemKey,
    })
      .then((notes) => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotes(notes);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotes([]);
        setZoteroRelatedNotesError(
          nextError instanceof Error ? nextError.message : '加载 Zotero 关联笔记失败',
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setZoteroRelatedNotesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument.itemKey, currentDocument.source, zoteroLocalDataDir]);

  useEffect(() => {
    const pendingBlockId = pendingHistoryActiveBlockIdRef.current;

    if (!pendingBlockId || flatBlocks.length === 0) {
      return;
    }

    const targetBlock = flatBlocks.find((block) => block.blockId === pendingBlockId);
    pendingHistoryActiveBlockIdRef.current = null;

    if (!targetBlock) {
      return;
    }

    setActiveBlockId(targetBlock.blockId);
    setActivePdfHighlight(createHighlightTarget(targetBlock));
    setBlockScrollSignal((current) => current + 1);
  }, [createHighlightTarget, flatBlocks]);

  useEffect(() => {
    if (!currentDocument.workspaceId || !pdfSource) {
      return;
    }

    savePaperHistory({
      version: 3,
      workspaceId: currentDocument.workspaceId,
      document: currentDocument,
      lastOpenedAt: paperOpenedAtRef.current,
      lastUpdatedAt: Date.now(),
      lastPdfPath:
        pdfPath || (pdfSource.kind === 'local-path' ? pdfSource.path : ''),
      lastMineruPath: mineruPath,
      lastActiveBlockId: activeBlockId,
      workspaceStage,
      readingViewMode,
      selectedQaPresetId,
      selectedQaSessionId,
      paperSummary,
      paperSummarySourceKey,
      workspaceNoteMarkdown,
      annotations,
      qaSessions,
    });
  }, [
    activeBlockId,
    annotations,
    currentDocument,
    mineruPath,
    paperSummary,
    paperSummarySourceKey,
    pdfPath,
    pdfSource,
    qaSessions,
    readingViewMode,
    selectedQaSessionId,
    selectedQaPresetId,
    workspaceNoteMarkdown,
    workspaceStage,
  ]);

  useEffect(() => {
    localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(leftPaneWidthRatio));
  }, [leftPaneWidthRatio]);

  useEffect(() => {
    setDocumentSearchCursor(-1);
  }, [normalizedDocumentSearchQuery]);

  useEffect(() => {
    const signature = `${document.workspaceId}::${document.attachmentKey ?? ''}`;

    if (lastDocumentSignatureRef.current === signature) {
      return;
    }

    lastDocumentSignatureRef.current = signature;
    void openDocumentItem();
  }, [document.attachmentKey, document.workspaceId, openDocumentItem]);

  useEffect(() => {
    if (!currentDocument || !paperSummaryNextSourceKey) {
      return;
    }

    if (
      !settings.autoGenerateSummary ||
      !summaryConfigured ||
      paperSummaryLoading ||
      paperSummarySourceKey === paperSummaryNextSourceKey
    ) {
      return;
    }

    if (autoSummarySourceKeyRef.current === paperSummaryNextSourceKey) {
      return;
    }

    autoSummarySourceKeyRef.current = paperSummaryNextSourceKey;

    void handleGeneratePaperSummary(false);
  }, [
    currentDocument,
    handleGeneratePaperSummary,
    paperSummaryLoading,
    paperSummaryNextSourceKey,
    paperSummarySourceKey,
    settings.autoGenerateSummary,
    summaryConfigured,
  ]);

  useEffect(() => {
    if (!selectedExcerpt || !translationConfigured || !settings.autoTranslateSelection) {
      return;
    }

    const autoTranslatedSelectionKey = `${selectedExcerpt.createdAt}:${selectedExcerpt.source}:${selectedExcerpt.text}`;

    if (autoTranslatedSelectionKeyRef.current === autoTranslatedSelectionKey) {
      return;
    }

    autoTranslatedSelectionKeyRef.current = autoTranslatedSelectionKey;
    void handleTranslateSelectedExcerpt(false);
  }, [
    handleTranslateSelectedExcerpt,
    selectedExcerpt,
    settings.autoTranslateSelection,
    translationConfigured,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        clearSelection();
        handleClearSelectedExcerpt();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, handleClearSelectedExcerpt, isActive]);

  useEffect(() => {
    if (!isDraggingSplitter) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const layoutRect = layoutRef.current?.getBoundingClientRect();

      if (!layoutRect || layoutRect.width <= 0) {
        return;
      }

      setLeftPaneWidthRatio(clampPaneRatio((event.clientX - layoutRect.left) / layoutRect.width));
    };

    const handlePointerUp = () => {
      setIsDraggingSplitter(false);
    };

    const previousUserSelect = globalThis.document.body.style.userSelect;
    const previousCursor = globalThis.document.body.style.cursor;

    globalThis.document.body.style.userSelect = 'none';
    globalThis.document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      globalThis.document.body.style.userSelect = previousUserSelect;
      globalThis.document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDraggingSplitter]);

  useEffect(() => {
    onBridgeStateChange(tabId, {
      translating,
      translatedCount,
      onTranslate: () => {
        void handleTranslateDocument();
      },
      onClearTranslations: handleClearTranslations,
      onCloudParse: () => {
        void handleCloudParse();
      },
    });

    return () => {
      onBridgeStateChange(tabId, null);
    };
  }, [
    handleClearTranslations,
    handleTranslateDocument,
    onBridgeStateChange,
    tabId,
    translatedCount,
    translating,
    handleCloudParse,
  ]);

  return (
    <div className="relative h-full min-h-0" hidden={!isActive}>
      <ReaderWorkspace
        currentDocument={currentDocument}
        selectedSectionTitle={currentDocument.source === 'standalone' ? '独立文献' : '我的文库'}
        currentPdfName={currentPdfName}
        currentJsonName={currentJsonName}
        mineruPath={mineruPath}
        translatedCount={translatedCount}
        translationProgressCompleted={translationProgressCompleted}
        translationProgressTotal={translationProgressTotal}
        workspaceStage={workspaceStage}
        onStageChange={setWorkspaceStage}
        readingViewMode={readingViewMode}
        onReadingViewModeChange={setReadingViewMode}
        loading={loading}
        translating={translating}
        error={error}
        statusMessage={statusMessage}
        activeBlockSummary={activeBlockSummary}
        currentPdfVariantLabel={currentPdfVariantLabel}
        canOpenOriginalPdf={canOpenOriginalPdf}
        onOpenOriginalPdf={handleOpenOriginalPdf}
        currentPdfPath={currentLocalPdfPath || availablePdfOptions[0]?.path || ''}
        availablePdfOptions={availablePdfOptions}
        onCurrentPdfPathChange={handleSelectProjectPdf}
        pdfAnnotationSaveDirectory={annotationSaveDirectory}
        originalPdfPath={originalPdfPath}
        documentSearchQuery={documentSearchQuery}
        documentSearchInputRef={documentSearchInputRef}
        onDocumentSearchQueryChange={setDocumentSearchQuery}
        documentSearchCursor={documentSearchCursor}
        documentSearchMatchCount={documentSearchMatches.length}
        onDocumentSearchStep={handleDocumentSearchStep}
        pdfSource={pdfSource}
        pdfData={pdfData}
        blocks={flatBlocks}
        translations={blockTranslations}
        translationDisplayMode="translated"
        activeBlockId={activeBlockId}
        hoveredBlockId={hoveredBlockId}
        activePdfHighlight={activePdfHighlight}
        blockScrollSignal={blockScrollSignal}
        smoothScroll={settings.smoothScroll}
        softPageShadow={settings.softPageShadow}
        compactReading={settings.compactReading}
        showBlockMeta={settings.showBlockMeta}
        hidePageDecorationsInBlockView={settings.hidePageDecorationsInBlockView}
        leftPaneWidthRatio={leftPaneWidthRatio}
        layoutRef={layoutRef}
        onStartResize={() => setIsDraggingSplitter(true)}
        onResetLayout={resetLayout}
        onPdfBlockHover={handlePdfBlockHover}
        onPdfBlockSelect={handlePdfBlockSelect}
        onBlockClick={handleBlockClick}
        onTextSelect={handleTextSelect}
        onOpenStandalonePdf={onOpenStandalonePdf}
        onOpenMineruJson={() => void handleOpenMineruJson()}
        onCloudParse={() => void handleCloudParse()}
        onTranslateDocument={() => void handleTranslateDocument()}
        onOpenPreferences={onOpenPreferences}
        workspaceNoteMarkdown={workspaceNoteMarkdown}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        zoteroRelatedNotes={zoteroRelatedNotes}
        zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
        zoteroRelatedNotesError={zoteroRelatedNotesError}
        onWorkspaceNoteChange={setWorkspaceNoteMarkdown}
        onAppendSelectedExcerptToNote={handleAppendSelectedExcerptToNote}
        onCreateAnnotation={handleCreateAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
        onSelectAnnotation={handleSelectAnnotation}
        paperSummary={paperSummary}
        paperSummaryLoading={paperSummaryLoading}
        paperSummaryError={paperSummaryError}
        onGenerateSummary={() => void handleGeneratePaperSummary()}
        qaSessions={qaSessions}
        selectedQaSessionId={selectedQaSessionId}
        qaMessages={qaMessages}
        qaInput={qaInput}
        qaAttachments={qaAttachments}
        qaModelPresets={qaModelPresets}
        selectedQaPresetId={selectedQaPresetId}
        screenshotLoading={screenshotBusy}
        onQaInputChange={setQaInput}
        onQaSubmit={() => void handleSubmitQa()}
        onQaPresetChange={handleQaPresetChange}
        onQaSessionCreate={handleCreateQaSession}
        onQaSessionSelect={handleSelectQaSession}
        onQaSessionDelete={handleDeleteQaSession}
        onSelectImageAttachments={() => void handleSelectQaAttachments('image')}
        onSelectFileAttachments={() => void handleSelectQaAttachments('file')}
        onCaptureScreenshot={() => void handleCaptureScreenshot()}
        onRemoveAttachment={handleRemoveAttachment}
        qaLoading={qaLoading}
        qaError={qaError}
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        autoTranslateSelection={settings.autoTranslateSelection}
        onAppendSelectedExcerptToQa={handleAppendSelectedExcerptToQa}
        onTranslateSelectedExcerpt={() => void handleTranslateSelectedExcerpt()}
        onClearSelectedExcerpt={handleClearSelectedExcerpt}
        onPdfAnnotationSaveSuccess={handlePdfAnnotationSaveSuccess}
        aiConfigured={aiConfigured}
        assistantDetached={assistantDetached}
        assistantActivePanel={assistantActivePanel}
        onAssistantActivePanelChange={setAssistantActivePanel}
        leftSidebarCollapsed={false}
        onToggleLeftSidebar={() => undefined}
        onDetachAssistant={handleOpenFloatingAssistant}
        onAttachAssistant={handleAttachAssistant}
        showLibraryToggle={false}
      />
      {screenshotSelection ? (
        <div
          className="fixed inset-0 z-[80] bg-slate-950/26 backdrop-blur-[1px]"
          onPointerDown={(event) => {
            const bounds = screenshotSelection.bounds;
            const insideBounds =
              event.clientX >= bounds.left &&
              event.clientX <= bounds.left + bounds.width &&
              event.clientY >= bounds.top &&
              event.clientY <= bounds.top + bounds.height;

            if (!insideBounds) {
              cancelScreenshotSelection();
              return;
            }

            const point = normalizeSelectionPoint(event.clientX, event.clientY, bounds);

            setScreenshotSelection((current) =>
              current
                ? {
                    ...current,
                    startX: point.x,
                    startY: point.y,
                    currentX: point.x,
                    currentY: point.y,
                  }
                : current,
            );
          }}
        >
          <div
            className="absolute overflow-hidden rounded-[28px] border border-sky-400/80 bg-white/6 shadow-[0_24px_64px_rgba(15,23,42,0.24)]"
            style={{
              left: screenshotSelection.bounds.left,
              top: screenshotSelection.bounds.top,
              width: screenshotSelection.bounds.width,
              height: screenshotSelection.bounds.height,
            }}
          >
            <div className="absolute left-4 top-4 rounded-2xl border border-white/20 bg-slate-950/72 px-3 py-2 text-xs leading-5 text-white">
              拖拽鼠标选择截图区域
              <br />
              Esc 取消
            </div>
            {screenshotSelectionRect ? (
              <div
                className="absolute rounded-2xl border-2 border-sky-400 bg-sky-300/14 shadow-[0_0_0_9999px_rgba(15,23,42,0.32)]"
                style={{
                  left: screenshotSelectionRect.left,
                  top: screenshotSelectionRect.top,
                  width: screenshotSelectionRect.width,
                  height: screenshotSelectionRect.height,
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DocumentReaderTab;
