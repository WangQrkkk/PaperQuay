import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReaderWorkspace from './ReaderWorkspace';
import {
  captureSystemScreenshot,
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
  extractTranslatableMarkdownFromMineruBlock,
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import { askDocumentOpenAICompatibleStream } from '../../services/qa';
import { summarizeDocumentOpenAICompatible } from '../../services/summary';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
  resolveSummaryOutputLanguage,
  SUMMARY_PROMPT_VERSION,
} from '../../services/summarySource';
import { translateBlocksOpenAICompatible } from '../../services/translation';
import {
  buildZoteroAttachmentPdfUrl,
  listLocalZoteroRelatedNotes,
  lookupZoteroKey,
} from '../../services/zotero';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import type { LiteraturePaperTaskState } from '../../types/library';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
  isPaperTaskRunning,
} from './paperTaskState';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  ModelRuntimeConfig,
  ModelRuntimeRole,
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
  TranslationDisplayMode,
  TranslationMap,
  UiLanguage,
  WorkspaceItem,
  WorkspaceStage,
  ZoteroRelatedNote,
} from '../../types/reader';
import { bytesToDataUrl, decodeUtf8, formatFileSize, guessMimeTypeFromPath, isImagePath, isTextLikePath } from '../../utils/files';
import {
  buildMineruCachePathCandidates,
  buildMineruCachePaths,
  buildMineruSummaryCachePathCandidates,
  buildMineruSummaryCachePath,
  buildMineruTranslationCachePathCandidates,
  buildMineruTranslationCachePath,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
  type MineruCachePaths,
} from '../../utils/mineruCache';
import { loadPaperHistory, savePaperHistory } from '../../utils/paperHistory';
import { buildPathInDirectory, getParentDirectory, normalizePathForCompare } from '../../utils/path';
import { getFileNameFromPath, normalizeSelectionText as normalizeTextSelection } from '../../utils/text';

const MIN_LEFT_PANE_RATIO = 0.28;
const MAX_LEFT_PANE_RATIO = 0.72;
const PANE_RATIO_STORAGE_KEY = 'paper-reader-pane-ratio-v2';
const ONBOARDING_WELCOME_CACHE_DIR = '/onboarding/mineru-cache/welcome-bfc1ec86';
const ONBOARDING_WELCOME_PDF_URL = '/onboarding/welcome.pdf';

function isOnboardingWelcomeItem(item: WorkspaceItem | null | undefined): boolean {
  return item?.workspaceId === 'onboarding:welcome';
}

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

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
  onTranslationDisplayModeChange: (mode: TranslationDisplayMode) => void;
  translationTargetLanguageLabel: string;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
  onboardingWorkspaceStage?: WorkspaceStage | null;
  onboardingDemoReveal?: {
    parsed: boolean;
    translated: boolean;
    summarized: boolean;
  };
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

function buildQaSessionTitle(
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

function createQaSession(
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

function blobToDataUrlRemoved(blob: Blob): Promise<string> {
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

async function buildScreenshotAttachmentFromPath(
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

function normalizeDocumentModelRuntimeConfig(value: unknown): ModelRuntimeConfig {
  if (!value || typeof value !== 'object') {
    return { reasoningEffort: 'auto' };
  }

  const config = value as Partial<ModelRuntimeConfig>;
  const temperature =
    typeof config.temperature === 'number' && Number.isFinite(config.temperature)
      ? Math.min(2, Math.max(0, config.temperature))
      : undefined;
  const reasoningEffort =
    config.reasoningEffort === 'low' ||
    config.reasoningEffort === 'medium' ||
    config.reasoningEffort === 'high'
      ? config.reasoningEffort
      : 'auto';

  return { temperature, reasoningEffort };
}

function getDocumentModelRuntimeConfig(
  settings: ReaderSettings,
  role: ModelRuntimeRole,
): ModelRuntimeConfig {
  return normalizeDocumentModelRuntimeConfig(settings.modelRuntimeConfigs?.[role]);
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
  return buildPathInDirectory(directory, filename);
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

function isSameLocalPath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
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
  onTranslationDisplayModeChange,
  translationTargetLanguageLabel,
  translationSnapshot = null,
  onboardingWorkspaceStage = null,
  onboardingDemoReveal,
}: DocumentReaderTabProps) {
  const locale = useAppLocale();
  const l = useLocaleText();
  const layoutRef = useRef<HTMLDivElement>(null);
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
  const localeRef = useRef(locale);
  const lRef = useRef(l);

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
  const [readingViewMode, setReadingViewMode] = useState<ReaderViewMode>('dual-pane');
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgressCompleted, setTranslationProgressCompleted] = useState(0);
  const [translationProgressTotal, setTranslationProgressTotal] = useState(0);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(() => l('就绪', 'Ready'));
  const [paperSummary, setPaperSummary] = useState<PaperSummary | null>(null);
  const [paperSummaryLoading, setPaperSummaryLoading] = useState(false);
  const [paperSummaryError, setPaperSummaryError] = useState('');
  const [paperSummarySourceKey, setPaperSummarySourceKey] = useState('');
  const [libraryOperation, setLibraryOperation] = useState<LiteraturePaperTaskState | null>(null);
  const [qaSessions, setQaSessions] = useState<DocumentChatSession[]>(() => {
    const initialSession = createQaSession(locale);

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
  const updateLibraryOperation = useCallback(
    (
      kind: LiteraturePaperTaskState['kind'],
      status: LiteraturePaperTaskState['status'],
      message: string,
      completed?: number | null,
      total?: number | null,
    ) => {
      setLibraryOperation(
        buildLocalizedPaperTaskState({
          locale: localeRef.current,
          kind,
          status,
          message,
          completed,
          total,
        }),
      );
    },
    [],
  );
  const [workspaceNoteMarkdown, setWorkspaceNoteMarkdown] = useState('');
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [zoteroRelatedNotes, setZoteroRelatedNotes] = useState<ZoteroRelatedNote[]>([]);
  const [zoteroRelatedNotesLoading, setZoteroRelatedNotesLoading] = useState(false);
  const [zoteroRelatedNotesError, setZoteroRelatedNotesError] = useState('');
  const [projectPdfFiles, setProjectPdfFiles] = useState<LocalDirectoryFileEntry[]>([]);

  useEffect(() => {
    localeRef.current = locale;
    lRef.current = l;
  }, [l, locale]);

  useEffect(() => {
    if (!isActive || !onboardingWorkspaceStage) {
      return;
    }

    setWorkspaceStage(onboardingWorkspaceStage);
    if (onboardingWorkspaceStage === 'reading') {
      setReadingViewMode('dual-pane');
    }
  }, [isActive, onboardingWorkspaceStage]);

  const hasDocument = Boolean(currentDocument && pdfSource);
  const translatedCount = useMemo(() => Object.keys(blockTranslations).length, [blockTranslations]);
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
  const screenshotBusy = capturingScreenshot;
  const currentPdfName =
    pdfSource?.kind === 'remote-url'
      ? pdfSource.fileName ||
        currentDocument.attachmentFilename ||
        currentDocument.attachmentTitle ||
        `${currentDocument.title}.pdf`
      : pdfPath
        ? getFileNameFromPath(pdfPath)
        : l('未打开', 'Not Opened');
  const currentJsonName = mineruPath
    ? mineruPath.startsWith('cloud:')
      ? mineruPath.replace(/^cloud:/, '')
      : getFileNameFromPath(mineruPath)
    : l('未加载', 'Not Loaded');
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
      return pdfSource?.kind === 'remote-url' ? l('远程 PDF', 'Remote PDF') : '';
    }

    if (originalPdfPath && isSameLocalPath(currentLocalPdfPath, originalPdfPath)) {
      return l('原始 PDF', 'Original PDF');
    }

    return l('批注版 PDF', 'Annotated PDF');
  }, [currentLocalPdfPath, l, originalPdfPath, pdfSource]);
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
      return getParentDirectory(originalPdfPath);
    }

    if (currentLocalPdfPath) {
      return getParentDirectory(currentLocalPdfPath);
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
      return l('尚未选中结构块', 'No block selected yet');
    }

    return `P${activeBlock.pageIndex + 1} · ${activeBlock.type} · ${activeBlock.blockId}`;
  }, [activeBlock, l]);

  const summaryBlockInputs = useMemo<SummaryBlockInput[]>(
    () => buildSummaryBlockInputs(flatBlocks),
    [flatBlocks],
  );

  const paperSummaryNextSourceKey = useMemo(() => {
    if (!currentDocument) {
      return '';
    }

    const summaryLanguage = resolveSummaryOutputLanguage(settings);

    if (settings.summarySourceMode === 'pdf-text') {
      if (!pdfData) {
        return '';
      }

      return `${currentDocument.itemKey}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::pdf-text::${pdfPath || currentPdfName}::${pdfData.byteLength}`;
    }

    if (!mineruPath && flatBlocks.length === 0) {
      return '';
    }

    return `${currentDocument.itemKey}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::${mineruPath || currentJsonName}::${flatBlocks.length}`;
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    mineruPath,
    pdfData,
    pdfPath,
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
  ]);
  const libraryPreviewSourceKey =
    paperSummarySourceKey ||
    paperSummaryNextSourceKey ||
    `${currentDocument.workspaceId}::preview::${currentJsonName}::${flatBlocks.length}`;

  const tryLoadSavedTranslations = useCallback(
    async (item: WorkspaceItem) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const candidatePaths = buildMineruTranslationCachePathCandidates(
        settings.mineruCacheDir.trim(),
        item,
        settings.translationTargetLanguage,
      );

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
    },
    [settings.mineruCacheDir, settings.translationTargetLanguage],
  );

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
    if (
      !currentDocument ||
      !translationSnapshot ||
      translationSnapshot.targetLanguage !== settings.translationTargetLanguage
    ) {
      return;
    }

    const incomingCount = Object.keys(translationSnapshot.translations).length;

    if (incomingCount === 0) {
      return;
    }

    if (
      blockTranslationTargetLanguage === translationSnapshot.targetLanguage &&
      translatedCount >= incomingCount
    ) {
      return;
    }

    setBlockTranslations(translationSnapshot.translations);
    setBlockTranslationTargetLanguage(translationSnapshot.targetLanguage);
    setStatusMessage(
      lRef.current(
        `已加载文库页刚生成的全文翻译 ${incomingCount} 条`,
        `Loaded ${incomingCount} translations generated from the library page`,
      ),
    );
  }, [
    blockTranslationTargetLanguage,
    currentDocument,
    settings.translationTargetLanguage,
    translatedCount,
    translationSnapshot,
  ]);

  useEffect(() => {
    if (!currentDocument || flatBlocks.length === 0 || !settings.mineruCacheDir.trim()) {
      return;
    }

    if (
      blockTranslationTargetLanguage === settings.translationTargetLanguage &&
      translatedCount > 0
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      await waitForNextPaint();

      if (cancelled) {
        return;
      }

      const cachedTranslations = await tryLoadSavedTranslations(currentDocument);

      if (cancelled || !cachedTranslations) {
        return;
      }

      setBlockTranslations(cachedTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setStatusMessage(
        lRef.current(
          `已恢复历史翻译 ${Object.keys(cachedTranslations).length} 条（${settings.translationTargetLanguage}）`,
          `Restored ${Object.keys(cachedTranslations).length} saved translations (${settings.translationTargetLanguage})`,
        ),
      );
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    blockTranslationTargetLanguage,
    currentDocument,
    flatBlocks.length,
    settings.mineruCacheDir,
    settings.translationTargetLanguage,
    translatedCount,
    tryLoadSavedTranslations,
  ]);

  useEffect(() => {
    if (
      !isOnboardingWelcomeItem(currentDocument) ||
      flatBlocks.length === 0 ||
      !onboardingDemoReveal?.translated
    ) {
      return;
    }

    if (
      blockTranslationTargetLanguage === settings.translationTargetLanguage &&
      translatedCount > 0
    ) {
      return;
    }

    let cancelled = false;

    void fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/translations/chinese.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((parsed: Partial<TranslationCacheEnvelope> | null) => {
        if (cancelled || !parsed?.translations) {
          return;
        }

        setBlockTranslations(parsed.translations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setStatusMessage(
          lRef.current('已加载 Welcome 内置全文翻译', 'Loaded the built-in Welcome translation'),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    blockTranslationTargetLanguage,
    currentDocument,
    flatBlocks.length,
    onboardingDemoReveal?.translated,
    settings.translationTargetLanguage,
    translatedCount,
  ]);

  useEffect(() => {
    if (!currentDocument.workspaceId) {
      return;
    }

    const previewPayload: LibraryPreviewSyncPayload = {
      item: currentDocument,
      hasBlocks: flatBlocks.length > 0,
      blockCount: flatBlocks.length,
      currentPdfName,
      currentJsonName,
      statusMessage,
      sourceKey: libraryPreviewSourceKey,
      summary: paperSummary,
    };

    if (libraryOperation) {
      previewPayload.loading = paperSummaryLoading || libraryOperation.status === 'running';
      previewPayload.error = libraryOperation.status === 'error' ? libraryOperation.message : '';
      previewPayload.operation = libraryOperation;
    } else if (paperSummaryLoading || paperSummaryError) {
      previewPayload.loading = paperSummaryLoading;
      previewPayload.error = paperSummaryError;
    }

    onLibraryPreviewSync(previewPayload);
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    libraryOperation,
    libraryPreviewSourceKey,
    onLibraryPreviewSync,
    paperSummary,
    paperSummaryError,
    paperSummaryLoading,
    statusMessage,
  ]);

  useEffect(() => {
    if (!isOnboardingWelcomeItem(currentDocument) || paperSummary || !onboardingDemoReveal?.summarized) {
      return;
    }

    let cancelled = false;

    void fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((parsed: Partial<SummaryCacheEnvelope> | null) => {
        if (cancelled || !parsed?.summary) {
          return;
        }

        setPaperSummary(parsed.summary);
        setPaperSummarySourceKey(parsed.sourceKey || 'onboarding:welcome::summary');
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [currentDocument, onboardingDemoReveal?.summarized, paperSummary]);

  useEffect(() => {
    screenshotSelectionRef.current = screenshotSelection;
  }, [screenshotSelection]);

  const resetDocumentState = useCallback(() => {
    const initialSession = createQaSession(localeRef.current);

    // Allow the next opened document, including reopening the same workspace item,
    // to restore cached reading history before any auto-generation runs.
    restoredHistoryRef.current = '';
    setMineruPath('');
    setMineruPages([]);
    setFlatBlocks([]);
    setBlockTranslations({});
    setBlockTranslationTargetLanguage('');
    setActiveBlockId(null);
    setHoveredBlockId(null);
    setActivePdfHighlight(null);
    setBlockScrollSignal(0);
    setPaperSummary(null);
    setPaperSummaryLoading(false);
    setPaperSummaryError('');
    setPaperSummarySourceKey('');
    setLibraryOperation(null);
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
          lRef.current(
            blocks.length > 0
              ? `已加载 ${blocks.length} 个结构块`
              : '已加载结构化 JSON，但还没有可用的结构块',
            blocks.length > 0
              ? `Loaded ${blocks.length} structured blocks`
              : 'Loaded the structured JSON, but no usable blocks are available yet',
          ),
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

  const tryLoadSavedSummary = useCallback(
    async (item: WorkspaceItem, sourceKey: string) => {
      if (!settings.mineruCacheDir.trim() || !sourceKey.trim()) {
        return null;
      }

      const candidatePaths = buildMineruSummaryCachePathCandidates(
        settings.mineruCacheDir.trim(),
        item,
        sourceKey,
      );

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
    },
    [settings.mineruCacheDir],
  );

  const tryLoadSavedMineruPages = useCallback(
    async (item: WorkspaceItem) => {
      if (isOnboardingWelcomeItem(item)) {
        if (onboardingDemoReveal && !onboardingDemoReveal.parsed) {
          return null;
        }

        const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`);

        if (!response.ok) {
          return null;
        }

        const jsonText = await response.text();

        return {
          pages: parseMineruPages(jsonText),
          path: `${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`,
          message: lRef.current(
            '已加载 Welcome 内置 MinerU 解析结果',
            'Loaded the built-in Welcome MinerU parse result',
          ),
        };
      }

      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const candidateCaches = buildMineruCachePathCandidates(settings.mineruCacheDir.trim(), item);

      for (const cachePaths of candidateCaches) {
        for (const candidatePath of [cachePaths.contentJsonPath, cachePaths.middleJsonPath]) {
          try {
            const jsonText = await readLocalTextFile(candidatePath);

            return {
              pages: parseMineruPages(jsonText),
              path: candidatePath,
              message: lRef.current(
                `已从本地缓存恢复《${item.title}》的解析结果`,
                `Restored the parsing result for "${item.title}" from the local cache`,
              ),
            };
          } catch {
            continue;
          }
        }
      }

      return null;
    },
    [onboardingDemoReveal, settings.mineruCacheDir],
  );

  const tryResolveSavedPdfPath = useCallback(
    async (item: WorkspaceItem) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const candidateCaches = buildMineruCachePathCandidates(settings.mineruCacheDir.trim(), item);

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
    setStatusMessage(lRef.current('已清除当前选中块', 'Cleared the current block selection'));
  }, []);

  const resetLayout = useCallback(() => {
    setLeftPaneWidthRatio(0.5);
    setStatusMessage(lRef.current('已重置为默认布局', 'Restored the default layout'));
  }, []);

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
            nextStatus = lRef.current(
              `${openingStatus}，并已保存到本地下载目录`,
              `${openingStatus}, and saved to the local download directory`,
            );
          } catch {
            nextStatus = lRef.current(
              `${openingStatus}，但保存到本地下载目录失败`,
              `${openingStatus}, but saving to the local download directory failed`,
            );
          }
        }

        setPdfSource(resolvedSource);
        setPdfData(binary);
        setPdfPath(resolvedPdfPath);
        setCurrentDocument(nextResolvedItem);
        setWorkspaceStage(nextStage);
        resetDocumentState();
        onDocumentResolved(nextResolvedItem);

        if (isOnboardingWelcomeItem(nextResolvedItem)) {
          const cachedMineru = await tryLoadSavedMineruPages(nextResolvedItem);

          if (cachedMineru) {
            applyMineruPages(cachedMineru.pages, cachedMineru.path, {
              item: nextResolvedItem,
              pdfPath: resolvedPdfPath,
              pdfSource: resolvedSource,
              statusMessage: cachedMineru.message,
            });
            nextStatus = cachedMineru.message;
          }
        } else if (resolvedSource.kind === 'local-path') {
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

              const siblingStatusMessage = lRef.current(
                `已自动加载《${item.title}》同目录的 MinerU JSON`,
                `Automatically loaded the MinerU JSON next to "${item.title}"`,
              );

              applyMineruPages(pages, siblingJsonPath, {
                item: nextResolvedItem,
                pdfPath: resolvedSource.path,
                pdfSource: resolvedSource,
                statusMessage: siblingStatusMessage,
              });
              nextStatus = siblingStatusMessage;

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
        setError(nextError instanceof Error ? nextError.message : lRef.current('打开文献失败', 'Failed to open the paper'));
        setStatusMessage(lRef.current('打开文献失败', 'Failed to open the paper'));
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

    if (isOnboardingWelcomeItem(document)) {
      await openWorkspaceDocument(
        document,
        { kind: 'remote-url', url: ONBOARDING_WELCOME_PDF_URL, fileName: 'welcome.pdf' },
        lRef.current('正在打开 Welcome 演示文档', 'Opening the Welcome demo document'),
        'reading',
      );
      return;
    }

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
          lRef.current(`正在打开《${document.title}》`, `Opening "${document.title}"`),
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
        lRef.current(`正在打开《${document.title}》`, `Opening "${document.title}"`),
        'reading',
      );
      return;
    }

    if (!document.attachmentKey) {
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      setError(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
      setStatusMessage(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
      return;
    }

    if (!zoteroApiKey.trim()) {
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      onOpenPreferences();
      setError(
        lRef.current(
          '当前条目的本地 PDF 不存在，请先在设置中填写 Zotero Web API Key',
          'The local PDF is unavailable. Configure the Zotero Web API key in Settings first.',
        ),
      );
      setStatusMessage(lRef.current('缺少 Zotero Web API Key', 'Missing Zotero Web API key'));
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
        lRef.current(
          `已通过 Zotero Web API 打开《${document.title}》`,
          `Opened "${document.title}" via the Zotero Web API`,
        ),
        'reading',
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : lRef.current('打开 Zotero 文献失败', 'Failed to open the Zotero paper'),
      );
      setStatusMessage(lRef.current('打开 Zotero 文献失败', 'Failed to open the Zotero paper'));
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
      setStatusMessage(lRef.current('请先打开 PDF，再选择 MinerU JSON', 'Open a PDF before selecting a MinerU JSON file'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const path = await selectLocalMineruJsonPath();

      if (!path) {
        setStatusMessage(lRef.current('已取消选择 MinerU JSON', 'Cancelled MinerU JSON selection'));
        return;
      }

      const jsonText = await readLocalTextFile(path);
      const pages = parseMineruPages(jsonText);

      applyMineruPages(pages, path, {
        item: currentDocument,
        pdfPath,
        pdfSource,
        statusMessage: lRef.current('已加载结构化 JSON', 'Loaded the structured JSON'),
      });
      if (currentDocument && pdfPath) {
        await saveMineruParseCache({
          item: currentDocument,
          pdfPath,
          sourceKind: 'manual-json',
          contentJsonText: jsonText,
        }).catch(() => undefined);
      }

      setStatusMessage(lRef.current('已加载结构化 JSON', 'Loaded the structured JSON'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : lRef.current('打开 MinerU JSON 失败', 'Failed to open the MinerU JSON'));
      setStatusMessage(lRef.current('打开 MinerU JSON 失败', 'Failed to open the MinerU JSON'));
    } finally {
      setLoading(false);
    }
  }, [applyMineruPages, currentDocument, pdfPath, pdfSource, saveMineruParseCache]);

  const handlePdfBlockSelect = useCallback(
    (block: PositionedMineruBlock) => {
      activateBlock(block, lRef.current(
        `已从 PDF 选中结构块 ${block.blockId}`,
        `Selected block ${block.blockId} from the PDF`,
      ), {
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
      activateBlock(block, lRef.current(
        `已定位到右侧结构块 ${block.blockId}`,
        `Focused block ${block.blockId} in the block panel`,
      ), {
        syncBlockList: false,
      });
    },
    [activateBlock],
  );

  const handleCloudParse = useCallback(async () => {
    if (isPaperTaskRunning(libraryOperation, 'mineru')) {
      return;
    }

    if (isOnboardingWelcomeItem(currentDocument)) {
      try {
        updateLibraryOperation(
          'mineru',
          'running',
          lRef.current('正在加载 Welcome 内置解析结果...', 'Loading the built-in Welcome parse result...'),
          10,
          100,
        );

        const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`);

        if (!response.ok) {
          const message = lRef.current('加载 Welcome 内置解析结果失败', 'Failed to load the built-in Welcome parse result');
          setError(message);
          setStatusMessage(message);
          updateLibraryOperation('mineru', 'error', message, 100, 100);
          return;
        }

        const jsonText = await response.text();
        const pages = parseMineruPages(jsonText);
        const nextPath = `${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`;
        const nextStatusMessage = lRef.current(
          '已显示 Welcome 内置 MinerU 解析结果，没有调用 API。',
          'Displayed the built-in Welcome MinerU parse result without calling any API.',
        );

        applyMineruPages(pages, nextPath, {
          item: currentDocument,
          pdfPath,
          pdfSource,
          statusMessage: nextStatusMessage,
        });
        setStatusMessage(nextStatusMessage);
        setError('');
        const blockCount = flattenMineruPages(pages).length;
        updateLibraryOperation('mineru', 'success', nextStatusMessage, blockCount, blockCount || null);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : lRef.current('加载 Welcome 内置解析结果失败', 'Failed to load the built-in Welcome parse result');
        setError(message);
        setStatusMessage(message);
        updateLibraryOperation('mineru', 'error', message, 100, 100);
      }
      return;
    }

    if (!pdfPath) {
      const message = lRef.current('请先打开 PDF，再调用云端解析', 'Open a PDF before starting cloud parsing');
      setStatusMessage(message);
      updateLibraryOperation('mineru', 'error', message, 100, 100);
      return;
    }

    if (!mineruApiToken.trim()) {
      onOpenPreferences();
      const message = lRef.current('请先在设置中填写 MinerU API Token', 'Configure the MinerU API token in Settings first');
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation('mineru', 'error', message, 100, 100);
      return;
    }

    setLoading(true);
    setError('');
    const runningMessage = lRef.current('正在将 PDF 发送到 MinerU 云端解析…', 'Sending the PDF to MinerU cloud parsing...');
    setStatusMessage(runningMessage);
    updateLibraryOperation('mineru', 'running', runningMessage, 20, 100);

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
        throw new Error(
          lRef.current(
            'MinerU 解析成功，但未返回可用的 JSON 内容',
            'MinerU parsing succeeded, but no usable JSON payload was returned.',
          ),
        );
      }

      const pages = parseMineruPages(jsonText);
      let nextMineruPath =
        result.contentJsonPath || result.middleJsonPath || `cloud:${result.fileName}:${result.batchId}`;
      let nextStatusMessage = lRef.current(
        `云端解析完成，批次号 ${result.batchId}`,
        `Cloud parsing finished. Batch ID: ${result.batchId}`,
      );

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
          nextStatusMessage = lRef.current(
            `已保存云端解析结果到：${savedPaths.directory}`,
            `Saved the cloud parsing output to: ${savedPaths.directory}`,
          );
        }
      }

      applyMineruPages(pages, nextMineruPath, {
        item: currentDocument,
        pdfPath,
        pdfSource,
        statusMessage: nextStatusMessage,
      });
      setStatusMessage(nextStatusMessage);
      const blockCount = flattenMineruPages(pages).length;
      updateLibraryOperation('mineru', 'success', nextStatusMessage, blockCount, blockCount || null);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : lRef.current('云端解析失败', 'Cloud parsing failed');
      setError(message);
      setStatusMessage(lRef.current('云端解析失败', 'Cloud parsing failed'));
      updateLibraryOperation('mineru', 'error', message, 100, 100);
    } finally {
      setLoading(false);
    }
  }, [
    applyMineruPages,
    currentDocument,
    libraryOperation,
    mineruApiToken,
    onOpenPreferences,
    pdfPath,
    saveMineruParseCache,
    settings.mineruCacheDir,
    updateLibraryOperation,
  ]);

  const handleTranslateDocument = useCallback(async () => {
    if (translating || isPaperTaskRunning(libraryOperation, 'translation')) {
      return;
    }

    const blocksToTranslate = flatBlocks
      .map((block) => ({
        blockId: block.blockId,
        text: extractTranslatableMarkdownFromMineruBlock(block),
      }))
      .filter((block) => block.text.trim().length > 0);

    if (blocksToTranslate.length === 0) {
      const message = lRef.current('当前没有可翻译的结构化文本', 'There is no structured text available to translate');
      setStatusMessage(message);
      updateLibraryOperation('translation', 'error', message, 100, 100);
      return;
    }

    if (isOnboardingWelcomeItem(currentDocument)) {
      try {
        setTranslating(true);
        setError('');
        updateLibraryOperation(
          'translation',
          'running',
          lRef.current('正在加载 Welcome 内置全文翻译...', 'Loading the built-in Welcome translation...'),
          0,
          blocksToTranslate.length,
        );
        const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/translations/chinese.json`);
        const parsed = response.ok ? (await response.json()) as Partial<TranslationCacheEnvelope> : null;

        if (!parsed?.translations) {
          throw new Error(lRef.current('未找到 Welcome 内置译文', 'The built-in Welcome translation was not found'));
        }

        setBlockTranslations(parsed.translations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(Object.keys(parsed.translations).length);
        const successMessage = lRef.current(
          '已显示 Welcome 内置全文翻译，没有调用 API。',
          'Displayed the built-in Welcome full translation without calling any API.',
        );
        setStatusMessage(successMessage);
        updateLibraryOperation(
          'translation',
          'success',
          successMessage,
          Object.keys(parsed.translations).length,
          blocksToTranslate.length,
        );
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : lRef.current('加载内置译文失败', 'Failed to load the built-in translation');
        setError(message);
        setStatusMessage(lRef.current('加载内置译文失败', 'Failed to load the built-in translation'));
        updateLibraryOperation('translation', 'error', message, 100, 100);
      } finally {
        setTranslating(false);
        setTranslationProgressTotal(0);
      }

      return;
    }

    if (!translationModelPreset || !translationModelPreset.apiKey.trim()) {
      onOpenPreferences();
      const message = lRef.current('请先在设置中填写 AI 接口 API Key', 'Configure the AI API key in Settings first');
      setError(message);
      updateLibraryOperation('translation', 'error', message, 100, 100);
      return;
    }

    setTranslating(true);
    setTranslationProgressCompleted(0);
    setTranslationProgressTotal(blocksToTranslate.length);
    setError('');
    const translationStartMessage = lRef.current(
      `正在翻译 ${blocksToTranslate.length} 个结构块`,
      `Translating ${blocksToTranslate.length} structured blocks`,
    );
    setStatusMessage(translationStartMessage);
    updateLibraryOperation(
      'translation',
      'running',
      translationStartMessage,
      0,
      blocksToTranslate.length,
    );

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
          temperature: getDocumentModelRuntimeConfig(settings, 'translation').temperature,
          reasoningEffort: getDocumentModelRuntimeConfig(settings, 'translation').reasoningEffort,
          sourceLanguage: settings.translationSourceLanguage,
            targetLanguage: settings.translationTargetLanguage,
            blocks: batch,
            batchSize: batch.length,
            concurrency: 1,
            requestsPerMinute: settings.translationRequestsPerMinute,
          });

          for (const translation of translations) {
            if (translation.translatedText.trim()) {
              collectedTranslations.set(translation.blockId, translation.translatedText);
            }
          }

          completedBlocks = Math.min(blocksToTranslate.length, completedBlocks + batch.length);
          setTranslationProgressCompleted(completedBlocks);
          const progressMessage = lRef.current(
            `正在翻译 ${completedBlocks}/${blocksToTranslate.length} 个块`,
            `Translating ${completedBlocks}/${blocksToTranslate.length} blocks`,
          );
          setStatusMessage(progressMessage);
          updateLibraryOperation(
            'translation',
            'running',
            progressMessage,
            completedBlocks,
            blocksToTranslate.length,
          );
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
      const successMessage = lRef.current(
        `翻译完成，已生成 ${Object.keys(nextTranslations).length} 段译文`,
        `Translation complete. Generated ${Object.keys(nextTranslations).length} translated blocks`,
      );
      setStatusMessage(successMessage);
      updateLibraryOperation(
        'translation',
        'success',
        successMessage,
        blocksToTranslate.length,
        blocksToTranslate.length,
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : lRef.current('翻译失败', 'Translation failed');
      setError(message);
      setStatusMessage(lRef.current('翻译失败', 'Translation failed'));
      updateLibraryOperation('translation', 'error', message, 100, 100);
    } finally {
      setTranslating(false);
      setTranslationProgressTotal(0);
    }
  }, [
    currentDocument,
    flatBlocks,
    libraryOperation,
    onOpenPreferences,
    saveTranslationCache,
    settings.translationBatchSize,
    settings.translationConcurrency,
    settings.translationRequestsPerMinute,
    settings.translationSourceLanguage,
    settings.translationTargetLanguage,
    translating,
    translationModelPreset,
    updateLibraryOperation,
  ]);

  const handleClearTranslations = useCallback(() => {
    setBlockTranslations({});
    setStatusMessage(lRef.current('已清空当前文稿的译文缓存', 'Cleared the translation cache for the current paper'));
  }, []);

  const loadMineruMarkdownForSummary = useCallback(async () => {
    const candidatePaths = new Set<string>();

    if (mineruPath.trim() && !mineruPath.startsWith('cloud:')) {
      candidatePaths.add(guessSiblingMarkdownPath(mineruPath));
    }

    if (settings.mineruCacheDir.trim()) {
      for (const cachePaths of buildMineruCachePathCandidates(
        settings.mineruCacheDir.trim(),
        currentDocument,
      )) {
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

    throw new Error(
      lRef.current(
        '请先加载 MinerU 的 full.md，再使用 MinerU Markdown 作为概览来源。',
        'Load MinerU full.md before using MinerU Markdown as the overview source.',
      ),
    );
  }, [
    currentDocument,
    flatBlocks,
    mineruPath,
    settings.mineruCacheDir,
  ]);

  const resolveSummaryRequest = useCallback(async () => {
    if (settings.summarySourceMode === 'pdf-text') {
      if (!pdfData) {
        throw new Error(
          lRef.current(
            '请先加载 PDF，或切换概览来源后再生成概览。',
            'Load a PDF, or switch the overview source before generating an overview.',
          ),
        );
      }

      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        throw new Error(
          lRef.current(
            '当前 PDF 未提取到可用文本，请尝试切换概览来源或重新加载 PDF。',
            'No usable text was extracted from the current PDF. Try switching the overview source or reloading the PDF.',
          ),
        );
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
        throw new Error(
          lRef.current(
            '请先加载 PDF，或切换到 MinerU 内容问答。',
            'Load a PDF first, or switch back to MinerU-based QA.',
          ),
        );
      }

      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        throw new Error(
          lRef.current(
            '当前 PDF 未提取到可用文本，请改用 MinerU 内容问答，或确认 PDF 可被本地文本层读取。',
            'No usable text was extracted from the current PDF. Use MinerU-based QA instead, or confirm the local PDF text layer is readable.',
          ),
        );
      }

      return {
        blocks: summaryBlockInputs,
        documentText,
      };
    }

    const documentText = await loadMineruMarkdownForSummary();

    if (!documentText.trim() && summaryBlockInputs.length === 0) {
      throw new Error(
        lRef.current(
          '请先加载 MinerU JSON，再进行基于 MinerU 内容的文档问答。',
          'Load a MinerU JSON file before starting MinerU-based document QA.',
        ),
      );
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
      if (paperSummaryLoading || isPaperTaskRunning(libraryOperation, 'overview')) {
        return;
      }

      if (!currentDocument) {
        return;
      }

      if (isOnboardingWelcomeItem(currentDocument)) {
        const requestId = summaryRequestIdRef.current + 1;
        summaryRequestIdRef.current = requestId;
        setPaperSummaryLoading(true);
        setPaperSummaryError('');
        const loadingMessage = lRef.current('正在加载 Welcome 内置概览…', 'Loading the built-in Welcome overview...');
        setStatusMessage(loadingMessage);
        updateLibraryOperation('overview', 'running', loadingMessage, 15, 100);

        try {
          const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`);
          const parsed = response.ok ? (await response.json()) as Partial<SummaryCacheEnvelope> : null;

          if (!parsed?.summary) {
            throw new Error(lRef.current('未找到 Welcome 内置概览', 'The built-in Welcome overview was not found'));
          }

          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          setPaperSummary(parsed.summary);
          setPaperSummarySourceKey(parsed.sourceKey || 'onboarding:welcome::summary');
          const successMessage = lRef.current(
            '已显示 Welcome 内置 AI 概览，没有调用 API。',
            'Displayed the built-in Welcome AI overview without calling any API.',
          );
          setStatusMessage(successMessage);
          updateLibraryOperation('overview', 'success', successMessage, 100, 100);
        } catch (nextError) {
          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          setPaperSummary(null);
          const message =
            nextError instanceof Error ? nextError.message : lRef.current('加载内置概览失败', 'Failed to load the built-in overview');
          setPaperSummaryError(message);
          setStatusMessage(lRef.current('加载内置概览失败', 'Failed to load the built-in overview'));
          updateLibraryOperation('overview', 'error', message, 100, 100);
        } finally {
          if (summaryRequestIdRef.current === requestId) {
            setPaperSummaryLoading(false);
          }
        }

        return;
      }

      if (settings.summarySourceMode === 'mineru-markdown' && summaryBlockInputs.length === 0) {
        setPaperSummary(null);
        const message = lRef.current(
          '请先加载 MinerU JSON，再基于 MinerU Markdown 生成概览。',
          'Load a MinerU JSON file before generating an overview from MinerU Markdown.',
        );
        setPaperSummaryError(message);
        setStatusMessage(lRef.current('请先加载 MinerU JSON 后再生成概览', 'Load MinerU JSON before generating the overview'));
        updateLibraryOperation('overview', 'error', message, 100, 100);
        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.baseUrl.trim()) {
        setPaperSummary(null);
        const message = lRef.current(
          '请先在设置中填写概览模型的 OpenAI 兼容 Base URL。',
          'Configure the overview model OpenAI-compatible Base URL in Settings first.',
        );
        setPaperSummaryError(message);
        setStatusMessage(lRef.current('缺少概览接口 Base URL', 'Missing overview Base URL'));
        updateLibraryOperation('overview', 'error', message, 100, 100);

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.apiKey.trim()) {
        setStatusMessage(lRef.current('缺少概览接口 API Key', 'Missing overview API key'));
        setPaperSummary(null);
        const message = lRef.current(
          '请先在设置中填写概览模型的 API Key。',
          'Configure the overview model API key in Settings first.',
        );
        setPaperSummaryError(message);
        updateLibraryOperation('overview', 'error', message, 100, 100);

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!summaryModelPreset || !summaryModelPreset.model.trim()) {
        setPaperSummary(null);
        const message = lRef.current(
          '请先在设置中填写概览模型名称。',
          'Configure the overview model name in Settings first.',
        );
        setPaperSummaryError(message);
        setStatusMessage(lRef.current('缺少概览模型名称', 'Missing overview model name'));
        updateLibraryOperation('overview', 'error', message, 100, 100);

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      const requestId = summaryRequestIdRef.current + 1;
      summaryRequestIdRef.current = requestId;

      setPaperSummaryLoading(true);
      setPaperSummaryError('');
      const runningMessage = lRef.current('正在生成论文概览…', 'Generating the paper overview...');
      setStatusMessage(runningMessage);
      updateLibraryOperation('overview', 'running', runningMessage, 25, 100);

      try {
        const summaryRequest = await resolveSummaryRequest();
        const cachedSummary = await tryLoadSavedSummary(currentDocument, paperSummaryNextSourceKey);

        if (cachedSummary) {
          if (summaryRequestIdRef.current !== requestId) {
            return;
          }

          setPaperSummary(cachedSummary);
          setPaperSummarySourceKey(paperSummaryNextSourceKey);
          const successMessage = lRef.current('已从本地缓存恢复论文概览', 'Restored the paper overview from the local cache');
          setStatusMessage(successMessage);
          updateLibraryOperation('overview', 'success', successMessage, 100, 100);
          return;
        }

        const summary = await summarizeDocumentOpenAICompatible({
          baseUrl: summaryModelPreset.baseUrl,
          apiKey: summaryModelPreset.apiKey.trim(),
          model: summaryModelPreset.model,
          temperature: getDocumentModelRuntimeConfig(settings, 'summary').temperature,
          reasoningEffort: getDocumentModelRuntimeConfig(settings, 'summary').reasoningEffort,
          title: currentDocument.title,
          authors: currentDocument.creators || undefined,
          year: currentDocument.year || undefined,
          outputLanguage: resolveSummaryOutputLanguage(settings),
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
        const successMessage = lRef.current('论文概览已生成', 'Paper overview generated');
        setStatusMessage(successMessage);
        updateLibraryOperation('overview', 'success', successMessage, 100, 100);
      } catch (nextError) {
        if (summaryRequestIdRef.current !== requestId) {
          return;
        }

        setPaperSummary(null);
        const message =
          nextError instanceof Error
            ? nextError.message
            : lRef.current('生成论文概览失败', 'Failed to generate the paper overview');
        setPaperSummaryError(message);
        setStatusMessage(lRef.current('论文概览生成失败', 'Failed to generate the paper overview'));
        updateLibraryOperation('overview', 'error', message, 100, 100);
      } finally {
        if (summaryRequestIdRef.current === requestId) {
          setPaperSummaryLoading(false);
        }
      }
    },
    [
      currentDocument,
      libraryOperation,
      onOpenPreferences,
      paperSummaryNextSourceKey,
      paperSummaryLoading,
      resolveSummaryRequest,
      saveSummaryCache,
      settings.summaryOutputLanguage,
      settings.summarySourceMode,
      settings.uiLanguage,
      summaryBlockInputs.length,
      summaryModelPreset,
      tryLoadSavedSummary,
      updateLibraryOperation,
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
    setStatusMessage(
      source === 'pdf'
        ? lRef.current('已选中 PDF 划词', 'Selected text from the PDF')
        : lRef.current('已选中结构块文本', 'Selected text from the structured block'),
    );
  }, []);

  const handleTranslateSelectedExcerpt = useCallback(
    async (openPreferencesOnMissingKey = true) => {
      if (!selectedExcerpt) {
        setStatusMessage(lRef.current('请先选中一段文本', 'Select a text passage first'));
        setSelectedExcerptError(
          lRef.current(
            '请先在 PDF 或结构块视图中选中需要翻译的文本。',
            'Select text in the PDF or structured block view before translating it.',
          ),
        );
        return;
      }

      const selectionRequestKey = `${selectedExcerpt.source}::${selectedExcerpt.text}`;

      if (selectionRequestKeyRef.current === selectionRequestKey) {
        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.baseUrl.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError(
          lRef.current(
            '请先在设置中填写 OpenAI 兼容 Base URL。',
            'Configure the OpenAI-compatible Base URL in Settings first.',
          ),
        );
        setStatusMessage(lRef.current('缺少翻译接口 Base URL', 'Missing translation Base URL'));

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.apiKey.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError(
          lRef.current(
            '请先在设置中填写 AI 接口 API Key。',
            'Configure the AI API key in Settings first.',
          ),
        );
        setStatusMessage(lRef.current('缺少翻译接口 API Key', 'Missing translation API key'));

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset || !selectionTranslationModelPreset.model.trim()) {
        setSelectedExcerptTranslation('');
        setSelectedExcerptError(
          lRef.current('请先在设置中填写模型名称。', 'Configure the model name in Settings first.'),
        );
        setStatusMessage(lRef.current('缺少翻译模型名称', 'Missing translation model name'));

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
      setStatusMessage(lRef.current('正在翻译划词内容…', 'Translating the selected excerpt...'));

      try {
        const result = await translateBlocksOpenAICompatible({
          baseUrl: selectionTranslationModelPreset.baseUrl,
          apiKey: selectionTranslationModelPreset.apiKey.trim(),
          model: selectionTranslationModelPreset.model,
          temperature: getDocumentModelRuntimeConfig(settings, 'selectionTranslation').temperature,
          reasoningEffort: getDocumentModelRuntimeConfig(settings, 'selectionTranslation').reasoningEffort,
          sourceLanguage: settings.translationSourceLanguage,
          targetLanguage: settings.translationTargetLanguage,
          blocks: [
            {
              blockId: 'selection',
              text: selectedExcerpt.text,
            },
          ],
          batchSize: 1,
          requestsPerMinute: settings.translationRequestsPerMinute,
        });

        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        const translatedText = result[0]?.translatedText?.trim() ?? '';

        setSelectedExcerptTranslation(translatedText);

        if (!translatedText) {
          setSelectedExcerptError(
            lRef.current('翻译结果为空，请稍后重试。', 'The translation result was empty. Please try again later.'),
          );
          setStatusMessage(lRef.current('划词翻译结果为空', 'Selected-text translation returned no content'));
          return;
        }

        setStatusMessage(lRef.current('划词翻译完成', 'Selected-text translation complete'));
      } catch (nextError) {
        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedExcerptTranslation('');
        setSelectedExcerptError(
          nextError instanceof Error ? nextError.message : lRef.current('划词翻译失败', 'Selected-text translation failed'),
        );
        setStatusMessage(lRef.current('划词翻译失败', 'Selected-text translation failed'));
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
      settings.translationRequestsPerMinute,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      selectionTranslationModelPreset,
    ],
  );

  const handleAppendSelectedExcerptToQa = useCallback(() => {
    if (!selectedExcerpt) {
      return;
    }

    const excerptPrompt = lRef.current(
      `请结合这段划词内容回答：\n“${selectedExcerpt.text}”`,
      `Answer with this selected excerpt in mind:\n"${selectedExcerpt.text}"`,
    );

    setQaInput((current) => (current.trim() ? `${current}\n\n${excerptPrompt}` : excerptPrompt));
    setStatusMessage(lRef.current('已将划词内容加入问答输入框', 'Added the selected excerpt to the QA input'));
  }, [selectedExcerpt]);

  const handleClearSelectedExcerpt = useCallback(() => {
    lastCapturedSelectionRef.current = null;
    selectionRequestKeyRef.current = '';
    autoTranslatedSelectionKeyRef.current = '';
    setSelectedExcerpt(null);
    setSelectedExcerptTranslation('');
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError('');
    setStatusMessage(lRef.current('已清除划词内容', 'Cleared the selected excerpt'));
  }, []);

  const legacyHandlePdfAnnotationSaveSuccess = useCallback((path: string) => {
    setStatusMessage(
      lRef.current(
        `已切换到标注后的 PDF：${path}`,
        `Switched to the annotated PDF: ${path}`,
      ),
    );
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
        setError(nextError instanceof Error ? nextError.message : lRef.current('切换 PDF 失败', 'Failed to switch PDF'));
        setStatusMessage(lRef.current('切换 PDF 失败', 'Failed to switch PDF'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handlePdfAnnotationSaveSuccess = useCallback(
    (path: string) => {
      void switchCurrentPdfFile(
        path,
        lRef.current(
          `已切换到已保存的批注版 PDF：${getFileNameFromPath(path)}`,
          `Switched to the saved annotated PDF: ${getFileNameFromPath(path)}`,
        ),
      );
    },
    [switchCurrentPdfFile],
  );

  const handleOpenOriginalPdf = useCallback(() => {
    if (!originalPdfPath) {
      setStatusMessage(lRef.current('当前论文没有可切换的原始 PDF', 'No original PDF is available for this paper'));
      return;
    }

    void switchCurrentPdfFile(
      originalPdfPath,
      lRef.current(
        `已切换到原始 PDF：${getFileNameFromPath(originalPdfPath)}`,
        `Switched to the original PDF: ${getFileNameFromPath(originalPdfPath)}`,
      ),
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

      void switchCurrentPdfFile(
        path,
        lRef.current(
          `已切换到 PDF：${getFileNameFromPath(path)}`,
          `Switched to PDF: ${getFileNameFromPath(path)}`,
        ),
      );
    },
    [currentLocalPdfPath, switchCurrentPdfFile],
  );

  const handleOpenFloatingAssistant = useCallback(() => {
    setAssistantDetached(true);
    setAssistantActivePanel((current) => current ?? 'chat');
    setWorkspaceStage('reading');
    setStatusMessage(lRef.current('AI 助手已切换为主窗口内浮动面板', 'Moved the AI assistant to a floating panel in the main window'));
  }, []);

  const handleAttachAssistant = useCallback(() => {
    setAssistantDetached(false);
    setStatusMessage(lRef.current('AI 助手已停靠回右侧面板', 'Docked the AI assistant back to the right sidebar'));
  }, []);

  const handleCreateQaSession = useCallback(() => {
    const nextSession = createQaSession(localeRef.current);

    setQaSessions((current) => [...current, nextSession]);
    setSelectedQaSessionId(nextSession.id);
    setQaInput('');
    setQaAttachments([]);
    setQaLoading(false);
    setQaError('');
    setStatusMessage(lRef.current('已创建新会话', 'Created a new chat session'));
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
      setStatusMessage(
        lRef.current(`已切换到会话：${nextSession.title}`, `Switched to session: ${nextSession.title}`),
      );
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
        const initialSession = createQaSession(localeRef.current);

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
      setStatusMessage(lRef.current('已删除会话', 'Deleted the chat session'));
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
      setStatusMessage(
        lRef.current(`已切换问答模型：${nextPreset.label}`, `Switched QA model: ${nextPreset.label}`),
      );
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
    setStatusMessage(lRef.current('已将划词内容追加到笔记', 'Appended the selected excerpt to the note'));
  }, [selectedExcerpt]);

  const handleCreateAnnotation = useCallback(
    (note: string) => {
      if (!activeBlock || !activeBlock.bbox) {
        setStatusMessage(lRef.current('请先选中一个可批注的结构块', 'Select an annotatable block first'));
        return;
      }

      const normalizedNote = note.trim();
      const quote =
        selectedExcerpt?.text.trim() || extractTextFromMineruBlock(activeBlock).slice(0, 240);

      if (!normalizedNote && !quote) {
        setStatusMessage(lRef.current('批注内容不能为空', 'The annotation content cannot be empty'));
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
      setStatusMessage(
        lRef.current(
          `已创建批注并关联结构块 ${activeBlock.blockId}`,
          `Created an annotation linked to block ${activeBlock.blockId}`,
        ),
      );
    },
    [activeBlock, selectedExcerpt],
  );

  const handleDeleteAnnotation = useCallback((annotationId: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    setSelectedAnnotationId((current) => (current === annotationId ? null : current));
    setStatusMessage(lRef.current('已删除批注', 'Deleted the annotation'));
  }, []);

  const handleSelectAnnotation = useCallback(
    (annotationId: string) => {
      const targetAnnotation = annotations.find((annotation) => annotation.id === annotationId);

      if (!targetAnnotation) {
        return;
      }

      const targetBlock = flatBlocks.find((block) => block.blockId === targetAnnotation.blockId);

      if (!targetBlock) {
        setStatusMessage(lRef.current('该批注对应的结构块已不存在', 'The block linked to this annotation no longer exists'));
        return;
      }

      setSelectedAnnotationId(targetAnnotation.id);
      activateBlock(
        targetBlock,
        lRef.current(
          `已定位到批注 ${targetAnnotation.blockId}`,
          `Focused annotation ${targetAnnotation.blockId}`,
        ),
      );
    },
    [activateBlock, annotations, flatBlocks],
  );

  const handleSelectQaAttachments = useCallback(
    async (kind: 'image' | 'file') => {
      try {
        const paths = await selectChatAttachmentPaths(kind);

        if (paths.length === 0) {
          setStatusMessage(
            kind === 'image'
              ? lRef.current('已取消选择图片附件', 'Cancelled image attachment selection')
              : lRef.current('已取消选择文件附件', 'Cancelled file attachment selection'),
          );
          return;
        }

        const attachments = await Promise.all(
          paths.map((path) => buildAttachmentFromPath(path, kind, localeRef.current)),
        );

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
        setStatusMessage(
          lRef.current(`已添加 ${attachments.length} 个附件`, `Added ${attachments.length} attachment(s)`),
        );
      } catch (nextError) {
        setQaError(
          nextError instanceof Error ? nextError.message : lRef.current('加载问答附件失败', 'Failed to load chat attachments'),
        );
      }
    },
    [],
  );

  /*
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
      setQaError('当前阅读区域过小，无法截图');
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
    setStatusMessage('请拖拽选择截图区域，按 Esc 取消');
  }, [capturingScreenshot, screenshotSelection]);
 const cancelScreenshotSelection = useCallback((message = '已取消截图选择') => {
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
        setStatusMessage('正在生成截图，请稍候…');
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
          summary: '系统截图',
        };

        setQaAttachments((current) => [...current, attachment]);
        setStatusMessage('截图已加入问答附件');
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
        setStatusMessage('未选择截图区域');
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

  */
  /*
  /*
  /*
  /*
  const handleCaptureSystemScreenshotLegacy = useCallback(async () => {
    if (capturingScreenshot) {
      return;
    }

    try {
      setCapturingScreenshot(true);
      setQaError('');
      setStatusMessage('legacy system screenshot');

      const screenshot = await captureSystemScreenshot();

      if (!screenshot) {
        setStatusMessage('legacy screenshot cancelled');
        return;
      }

      const attachment = await buildScreenshotAttachmentFromPath(screenshot.path);

      setQaAttachments((current) => {
        const attachmentKey = `${attachment.filePath || attachment.name}:${attachment.size}`;

        if (
          current.some(
            (item) => `${item.filePath || item.name}:${item.size}` === attachmentKey,
          )
        ) {
          return current;
        }

        return [...current, attachment];
      });
      setStatusMessage(`已添加系统截图：${attachment.name}`);
    } catch (nextError) {
      setQaError(nextError instanceof Error ? nextError.message : '截图失败');
    } finally {
      setCapturingScreenshot(false);
    }
  }, [capturingScreenshot]);
  */

  const handleCaptureSystemScreenshotNative = useCallback(async () => {
    if (capturingScreenshot) {
      return;
    }

    try {
      setCapturingScreenshot(true);
      setQaError('');
      setStatusMessage(lRef.current('正在启动系统截图...', 'Starting system screenshot...'));

      const screenshot = await captureSystemScreenshot();

      if (!screenshot) {
        setStatusMessage(lRef.current('已取消系统截图', 'System screenshot cancelled'));
        return;
      }

      const attachment = await buildScreenshotAttachmentFromPath(screenshot.path, localeRef.current);

      setQaAttachments((current) => {
        const attachmentKey = `${attachment.filePath || attachment.name}:${attachment.size}`;

        if (
          current.some(
            (item) => `${item.filePath || item.name}:${item.size}` === attachmentKey,
          )
        ) {
          return current;
        }

        return [...current, attachment];
      });
      setStatusMessage(
        lRef.current(`已添加系统截图：${attachment.name}`, `Screenshot attached: ${attachment.name}`),
      );
    } catch (nextError) {
      setQaError(
        nextError instanceof Error ? nextError.message : lRef.current('系统截图失败', 'System screenshot failed'),
      );
    } finally {
      setCapturingScreenshot(false);
    }
  }, [capturingScreenshot]);

  /*
  const handleCaptureSystemScreenshot = useCallback(async () => {
    if (capturingScreenshot) {
      return;
    }

    try {
      setCapturingScreenshot(true);
      setQaError('');
      setStatusMessage('正在启动系统截图...');

      const screenshot = await captureSystemScreenshot();

      if (!screenshot) {
        setStatusMessage('已取消系统截图');
        return;
      }

      const attachment = await buildScreenshotAttachmentFromPath(screenshot.path);

      setQaAttachments((current) => {
        const attachmentKey = `${attachment.filePath || attachment.name}:${attachment.size}`;

        if (
          current.some(
            (item) => `${item.filePath || item.name}:${item.size}` === attachmentKey,
          )
        ) {
          return current;
        }

        return [...current, attachment];
      });
      setStatusMessage(`已添加截图附件：${attachment.name}`);
    } catch (nextError) {
      setQaError(nextError instanceof Error ? nextError.message : '系统截图失败');
    } finally {
      setCapturingScreenshot(false);
    }
  }, [capturingScreenshot]);
  */

  const handleSubmitQa = useCallback(async () => {
    const question = qaInput.trim();

    if (!currentDocument || !question) {
      return;
    }

    if (!activeQaPreset) {
      setQaError(lRef.current('请先在设置中选择可用的问答模型配置。', 'Select an available QA model preset in Settings first.'));
      onOpenPreferences();
      return;
    }

    if (!qaConfigured) {
      setQaError(lRef.current('问答模型未配置，请先填写 Base URL 和 API Key。', 'The QA model is not configured. Fill in the Base URL and API key first.'));
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
      setQaError(
        nextError instanceof Error
          ? nextError.message
          : lRef.current('当前没有可用于问答的文档上下文。', 'There is no document context available for QA right now.'),
      );
      return;
    }

    if (qaRequest.documentText === '__never__') {
      setQaError(
        lRef.current(
          '请先加载 MinerU JSON，或先在 PDF / 结构块视图中选中文本。',
          'Load MinerU JSON first, or select text in the PDF or block view.',
        ),
      );
      return;
    }

    const currentSession = activeQaSession ?? createQaSession(localeRef.current);
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
    const nextAssistantMessage = createChatMessage('assistant', '', {
      modelId: activeQaPreset.id,
      modelLabel: activeQaPreset.label,
    });
    const streamingMessages: DocumentChatMessage[] = [
      ...nextMessages,
      nextAssistantMessage,
    ];
    const pendingSession: DocumentChatSession = {
      ...currentSession,
      title: buildQaSessionTitle(localeRef.current, nextMessages),
      createdAt: currentSession.createdAt || nextUserMessage.createdAt,
      updatedAt: nextAssistantMessage.createdAt,
      messages: streamingMessages,
    };

    setQaSessions((current) => updateQaSession(current, pendingSession));
    setSelectedQaSessionId(currentSession.id);
    setQaInput('');
    setQaAttachments([]);
    setQaLoading(true);
    setQaError('');

    let streamedAnswer = '';

    try {
      const updateStreamingAnswer = (answer: string) => {
        streamedAnswer = answer;
        const updatedAssistantMessage: DocumentChatMessage = {
          ...nextAssistantMessage,
          content: answer,
          createdAt: Date.now(),
        };

        setQaSessions((current) =>
          updateQaSession(current, {
            ...pendingSession,
            updatedAt: updatedAssistantMessage.createdAt,
            messages: [
              ...nextMessages,
              updatedAssistantMessage,
            ],
          }),
        );
      };

      const answer = await askDocumentOpenAICompatibleStream(
        {
          baseUrl: activeQaPreset.baseUrl,
          apiKey: activeQaPreset.apiKey.trim(),
          model: activeQaPreset.model,
          temperature: getDocumentModelRuntimeConfig(settings, 'qa').temperature,
          reasoningEffort: getDocumentModelRuntimeConfig(settings, 'qa').reasoningEffort,
          responseLanguage: settings.uiLanguage === 'en-US' ? 'English' : 'Simplified Chinese',
          title: currentDocument.title,
          authors: currentDocument.creators || undefined,
          year: currentDocument.year || undefined,
          excerptText: selectedExcerpt?.text || undefined,
          documentText: qaRequest.documentText,
          blocks: qaRequest.blocks,
          messages: nextMessages.slice(-12),
        },
        {
          onDelta: (_delta, fullText) => updateStreamingAnswer(fullText),
        },
      );

      if (answer !== streamedAnswer) {
        updateStreamingAnswer(answer);
      }

      setStatusMessage(lRef.current('文档问答已完成', 'Document QA completed'));
    } catch (nextError) {
      if (!streamedAnswer.trim()) {
        setQaSessions(previousSessions);
        setSelectedQaSessionId(previousSelectedSessionId);
        setQaAttachments(previousAttachments);
      }

      setQaError(nextError instanceof Error ? nextError.message : lRef.current('文档问答失败', 'Document QA failed'));
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
      const initialSession = createQaSession(localeRef.current);

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
      setReadingViewMode('dual-pane');
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
      history.qaSessions.length > 0 ? history.qaSessions : [createQaSession(localeRef.current)];
    const restoredSessionId =
      (history.selectedQaSessionId &&
        restoredSessions.some((session) => session.id === history.selectedQaSessionId)
          ? history.selectedQaSessionId
          : restoredSessions[0]?.id) ?? '';

    if (!onboardingWorkspaceStage) {
      setWorkspaceStage(history.workspaceStage);
    }
    setReadingViewMode(history.readingViewMode);
    setPaperSummary(history.paperSummary);
    setPaperSummarySourceKey(history.paperSummarySourceKey);
    setWorkspaceNoteMarkdown(history.workspaceNoteMarkdown);
    setAnnotations(history.annotations);
    setQaSessions(restoredSessions);
    setSelectedQaSessionId(restoredSessionId);
    setSelectedQaPresetId(nextPresetId);

    if (history.paperSummary || history.qaSessions.length > 0 || Boolean(history.qaMessages?.length)) {
      setStatusMessage(lRef.current('已恢复上次阅读与问答记录', 'Restored the last reading and QA history'));
    }
  }, [
    currentDocument.workspaceId,
    pdfSource,
    qaModelPresets,
    settings.qaActivePresetId,
    onboardingWorkspaceStage,
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
          nextError instanceof Error
            ? nextError.message
            : lRef.current('加载 Zotero 关联笔记失败', 'Failed to load Zotero related notes'),
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
      onGenerateSummary: () => {
        void handleGeneratePaperSummary();
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
    handleGeneratePaperSummary,
  ]);

  return (
    <div className="relative h-full min-h-0" hidden={!isActive}>
      <ReaderWorkspace
        currentDocument={currentDocument}
        selectedSectionTitle={
          currentDocument.source === 'standalone'
            ? settings.uiLanguage === 'en-US'
              ? 'Standalone Document'
              : '独立文献'
            : settings.uiLanguage === 'en-US'
              ? 'My Library'
              : '我的文库'
        }
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
        pdfSource={pdfSource}
        pdfData={pdfData}
        blocks={flatBlocks}
        translations={blockTranslations}
        translationDisplayMode={settings.translationDisplayMode}
        translationLanguageLabel={translationTargetLanguageLabel}
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
        onTranslationDisplayModeChange={onTranslationDisplayModeChange}
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
        onCaptureScreenshot={() => void handleCaptureSystemScreenshotNative()}
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
      {/*
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
      */}
    </div>
  );
}

export default DocumentReaderTab;

