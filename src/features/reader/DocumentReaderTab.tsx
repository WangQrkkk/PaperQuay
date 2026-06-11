import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReaderWorkspace from './ReaderWorkspace';
import {
  captureSystemScreenshot,
  downloadRemoteFileToPath,
  loadPdfBinary,
  listLocalDirectoryFiles,
  localPathExists,
  readLocalTextFile,
  readLocalTextFileIfExists,
  runMineruCloudParse,
  selectChatAttachmentPaths,
  selectLocalMineruJsonPath,
} from '../../services/desktop';
import {
  createNote as createStoredNote,
  deleteNote as deleteStoredNote,
  listNotes as listStoredNotes,
  type NoteMutationOptions,
  updateNote as updateStoredNote,
} from '../../services/notes';
import type { LocalDirectoryFileEntry } from '../../services/desktop';
import {
  extractTextFromMineruBlock,
  extractTranslatableMarkdownFromMineruBlock,
  flattenMineruPages,
  parseMineruPages,
  resolveMineruBlockContentSource,
} from '../../services/mineru';
import { askDocumentOpenAICompatibleStream } from '../../services/qa';
import { resolveLocalRag } from '../../services/localRag';
import { summarizeDocumentOpenAICompatible } from '../../services/summary';
import {
  emitJumpToNoteAnchor,
  NOTE_CHANGED_EVENT,
  type JumpToNoteAnchorEventDetail,
  type NoteChangedEventDetail,
} from '../../app/appEvents';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
  resolveSummaryOutputLanguage,
  SUMMARY_PROMPT_VERSION,
} from '../../services/summarySource';
import {
  buildZoteroAttachmentPdfUrl,
  listLocalZoteroRelatedNotes,
  lookupZoteroKey,
} from '../../services/zotero';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import type { LiteraturePaperTaskState } from '../../types/library';
import type {
  CreateNoteRequest,
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  UpdateNoteRequest,
} from '../../types/notes';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
  isPaperTaskRunning,
} from './paperTaskState';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatRenderMode,
  DocumentChatSession,
  MineruPage,
  ModelReasoningEffort,
  PaperAnnotation,
  PaperSummary,
  PdfBlockSelectContext,
  PdfHighlightTarget,
  PdfReadingHeatmap,
  PdfScrollPosition,
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
  WorkspaceItem,
  WorkspaceStage,
  ZoteroRelatedNote,
} from '../../types/reader';
import {
  buildMineruCachePaths,
  guessSiblingJsonPath,
} from '../../utils/mineruCache';
import {
  loadPaperHistory,
  PAPER_READING_HEATMAP_UPDATED_EVENT,
  savePaperHistory,
} from '../../utils/paperHistory';
import { getFileNameFromPath } from '../../utils/text';
import { getPdfSourceSignature } from '../pdf/pdfDocumentSource';
import {
  buildAttachmentFromPath,
  buildQaSessionTitle,
  buildRemotePdfDownloadPath,
  buildScreenshotAttachmentFromPath,
  clampPaneRatio,
  createChatMessage,
  createQaSession,
  getMineruJsonDisplayName,
  getPreviewPdfName,
  isEditableTarget,
  isSameLocalPath,
  LibraryPreviewSyncPayload,
  loadPaneRatio,
  normalizeSelectedText,
  PANE_RATIO_STORAGE_KEY,
  ReaderDocumentTranslationSnapshot,
  ReaderTabBridgeState,
  updateQaSession,
} from './documentReaderShared';
import { appendUniqueChatAttachments } from './documentReaderAttachments';
import {
  removeQaSession,
  resolveActiveQaSession,
  resolveQaModelPreset,
  resolveQaSessionSelection,
} from './documentReaderQaSessions';
import {
  buildQuoteMarkdown as buildNoteQuoteMarkdown,
  createNoteAnchorFromSelection,
  titleFromText,
} from '../notes/noteUtils';
import {
  chunkItems,
  getModelRuntimeConfig,
  pickLocaleText,
  resolveModelPreset,
} from './readerShared';
import type { LocalRagResolution } from './readerQaContext';
import { buildQaContext, formatQaContextStatus } from './readerQaContext';
import { useDocumentTranslation } from './useDocumentTranslation';
import {
  buildPendingNoteAnchorInsert,
  buildNoteAnchorJumpDetail,
  buildNoteAnchorPdfHighlightTarget,
  buildNotePdfHighlightTarget,
  buildReaderNotesEditorSourceId,
  buildSelectedExcerptNoteCreateRequest,
  isNoteEventRecord,
  resolveReaderNoteAnchorTarget,
  resolveNoteAnchorWorkspaceId,
  sortReaderNotes,
} from './documentReaderNotes';
import {
  buildReaderLocalPdfPathCandidates,
  restorePdfSourceHistory,
  upsertRecentPdfReadingHeatmap,
  upsertRecentPdfScrollPosition,
} from './documentReaderHistory';
import {
  buildAvailablePdfOptions,
  canSwitchToOriginalPdf,
  resolveAnnotationSaveDirectory,
  resolveCurrentLocalPdfPath,
  resolveCurrentPdfVariantLabel,
  resolveOriginalPdfPath,
} from './documentReaderPdfOptions.ts';
import {
  writeMineruParseCache,
  writePreviewSummaryCache,
} from './readerLibraryPreview';
import {
  loadSavedMineruPages,
  loadSavedSummaryCache,
  resolveSavedPdfPath,
} from './documentReaderCache';
import {
  buildPaperSummarySourceKey,
  loadMineruMarkdownDocument,
} from './documentReaderSummarySource';
import { buildReaderAssistantSidebarProps } from './readerAssistantSidebarProps';
import { formatReaderDocumentSource } from './readerWorkspaceShared';

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

const GLOBAL_READER_NOTE_EDITOR_SOURCE_ID = buildReaderNotesEditorSourceId('global');

function requestDeferredReaderStartupWork(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 280 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 80);
  return () => window.clearTimeout(handle);
}

interface DocumentReaderTabProps {
  tabId: string;
  document: WorkspaceItem;
  isActive: boolean;
  settings: ReaderSettings;
  embeddingApiKey: string;
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
  assistantActivePanel: AssistantPanelKey;
  setAssistantActivePanel: StateSetter<AssistantPanelKey>;
  assistantDetached: boolean;
  setAssistantDetached: StateSetter<boolean>;
  qaSessions: DocumentChatSession[];
  setQaSessions: StateSetter<DocumentChatSession[]>;
  selectedQaSessionId: string;
  setSelectedQaSessionId: StateSetter<string>;
  qaInput: string;
  setQaInput: StateSetter<string>;
  qaAttachments: DocumentChatAttachment[];
  setQaAttachments: StateSetter<DocumentChatAttachment[]>;
  selectedQaPresetId: string;
  setSelectedQaPresetId: StateSetter<string>;
  qaRagEnabled: boolean;
  setQaRagEnabled: StateSetter<boolean>;
  qaAnswerRenderMode: DocumentChatRenderMode;
  setQaAnswerRenderMode: StateSetter<DocumentChatRenderMode>;
  qaReasoningEffort: ModelReasoningEffort;
  setQaReasoningEffort: StateSetter<ModelReasoningEffort>;
  qaLoading: boolean;
  setQaLoading: StateSetter<boolean>;
  qaError: string;
  setQaError: StateSetter<string>;
  notes: Note[];
  setNotes: StateSetter<Note[]>;
  activeNoteId: string | null;
  setActiveNoteId: StateSetter<string | null>;
  notesLoading: boolean;
  setNotesLoading: StateSetter<boolean>;
  notesSaving: boolean;
  setNotesSaving: StateSetter<boolean>;
  notesError: string;
  setNotesError: StateSetter<string>;
  pendingNoteAnchorJump?: JumpToNoteAnchorEventDetail | null;
  onPendingNoteAnchorJumpHandled?: (requestId?: string) => void;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
}


function DocumentReaderTab({
  tabId,
  document,
  isActive,
  settings,
  embeddingApiKey,
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
  assistantActivePanel,
  setAssistantActivePanel,
  assistantDetached,
  setAssistantDetached,
  qaSessions,
  setQaSessions,
  selectedQaSessionId,
  setSelectedQaSessionId,
  qaInput,
  setQaInput,
  qaAttachments,
  setQaAttachments,
  selectedQaPresetId,
  setSelectedQaPresetId,
  qaRagEnabled,
  setQaRagEnabled,
  qaAnswerRenderMode,
  setQaAnswerRenderMode,
  qaReasoningEffort,
  setQaReasoningEffort,
  qaLoading,
  setQaLoading,
  qaError,
  setQaError,
  notes,
  setNotes,
  activeNoteId,
  setActiveNoteId,
  notesLoading,
  setNotesLoading,
  notesSaving,
  setNotesSaving,
  notesError,
  setNotesError,
  pendingNoteAnchorJump = null,
  onPendingNoteAnchorJumpHandled,
  translationSnapshot = null,
}: DocumentReaderTabProps) {
  const locale = useAppLocale();
  const l = useLocaleText();
  const readerNoteEditorSourceId = GLOBAL_READER_NOTE_EDITOR_SOURCE_ID;
  const layoutRef = useRef<HTMLDivElement>(null);
  const summaryRequestIdRef = useRef(0);
  const openDocumentRequestIdRef = useRef(0);
  const lastDocumentSignatureRef = useRef('');
  const lastCapturedSelectionRef = useRef<{
    source: TextSelectionSource;
    text: string;
    capturedAt: number;
  } | null>(null);
  const paperOpenedAtRef = useRef(Date.now());
  const restoredHistoryRef = useRef('');
  const autoTranslatedSelectionKeyRef = useRef('');
  const autoSummarySourceKeyRef = useRef('');
  const pendingHistoryActiveBlockIdRef = useRef<string | null>(null);
  const pdfTextCacheRef = useRef<{
    key: string;
    text: string;
  } | null>(null);
  const pdfTextPendingRef = useRef<Promise<string> | null>(null);
  const localeRef = useRef(locale);
  const lRef = useRef(l);

  const [currentDocument, setCurrentDocument] = useState<WorkspaceItem>(document);
  const [pdfSource, setPdfSource] = useState<PdfSource>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfPath, setPdfPath] = useState('');
  const pdfScrollPositionsRef = useRef<Record<string, PdfScrollPosition>>({});
  const pdfReadingHeatmapsRef = useRef<Record<string, PdfReadingHeatmap>>({});
  const [mineruPath, setMineruPath] = useState('');
  const [mineruPages, setMineruPages] = useState<MineruPage[]>([]);
  const [flatBlocks, setFlatBlocks] = useState<PositionedMineruBlock[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activePdfHighlight, setActivePdfHighlight] = useState<PdfHighlightTarget | null>(null);
  const [pdfHighlightSignal, setPdfHighlightSignal] = useState(0);
  const [blockScrollSignal, setBlockScrollSignal] = useState(0);
  const [leftPaneWidthRatio, setLeftPaneWidthRatio] = useState(loadPaneRatio);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [workspaceStage, setWorkspaceStage] = useState<WorkspaceStage>('reading');
  const [readingViewMode, setReadingViewMode] = useState<ReaderViewMode>('dual-pane');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(() => l('就绪', 'Ready'));
  const [paperSummary, setPaperSummary] = useState<PaperSummary | null>(null);
  const [paperSummaryLoading, setPaperSummaryLoading] = useState(false);
  const [paperSummaryError, setPaperSummaryError] = useState('');
  const [paperSummarySourceKey, setPaperSummarySourceKey] = useState('');
  const [libraryOperation, setLibraryOperation] = useState<LiteraturePaperTaskState | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [selectedExcerpt, setSelectedExcerpt] = useState<SelectedExcerpt | null>(null);
  const [pendingNoteAnchorInsert, setPendingNoteAnchorInsert] = useState<NoteAnchorInsertRequest | null>(null);
  const [readerNoteExternalUpdate, setReaderNoteExternalUpdate] = useState<Note | null>(null);
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
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [zoteroRelatedNotes, setZoteroRelatedNotes] = useState<ZoteroRelatedNote[]>([]);
  const [zoteroRelatedNotesLoading, setZoteroRelatedNotesLoading] = useState(false);
  const [zoteroRelatedNotesError, setZoteroRelatedNotesError] = useState('');
  const [projectPdfFiles, setProjectPdfFiles] = useState<LocalDirectoryFileEntry[]>([]);
  const readerLocaleText = useCallback(
    (zh: string, en: string) => pickLocaleText(settings.uiLanguage, zh, en),
    [settings.uiLanguage],
  );
  const selectedSectionTitle = useMemo(
    () =>
      currentDocument.source === 'standalone'
        ? readerLocaleText('独立文献', 'Standalone Document')
        : readerLocaleText('我的文库', 'My Library'),
    [currentDocument.source, readerLocaleText],
  );
  const documentSource = useMemo(
    () => formatReaderDocumentSource(readerLocaleText, currentDocument, selectedSectionTitle),
    [currentDocument, readerLocaleText, selectedSectionTitle],
  );

  useEffect(() => {
    localeRef.current = locale;
    lRef.current = l;
  }, [l, locale]);

  const hasDocument = Boolean(currentDocument && pdfSource);
  const translationModelPreset =
    resolveModelPreset(qaModelPresets, settings.translationModelPresetId) ?? qaModelPresets[0] ?? null;
  const selectionTranslationModelPreset =
    resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId) ??
    translationModelPreset;
  const summaryModelPreset =
    resolveModelPreset(qaModelPresets, settings.summaryModelPresetId) ?? translationModelPreset;
  const activeQaPreset = resolveQaModelPreset(qaModelPresets, selectedQaPresetId);
  const activeQaSession = useMemo(
    () => resolveActiveQaSession(qaSessions, selectedQaSessionId),
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
  const {
    applySelectedExcerptTranslation,
    blockTranslations,
    handleCancelDocumentTranslation,
    handleClearTranslations,
    handleRetranslateBlock,
    handleTranslateDocument,
    handleTranslateSelectedExcerpt,
    resetDocumentTranslationState,
    resetSelectedExcerptTranslationState,
    selectedExcerptError,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
    translatedCount,
    translating,
    translationCancelling,
    translationProgressCompleted,
    translationProgressTotal,
  } = useDocumentTranslation({
    currentDocument,
    flatBlocks,
    libraryOperationRunning: isPaperTaskRunning(libraryOperation, 'translation'),
    onOpenPreferences,
    selectedExcerpt,
    selectionTranslationModelPreset,
    settings,
    setError,
    setStatusMessage,
    translationModelPreset,
    translationSnapshot,
    updateLibraryOperation,
    lRef,
  });
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
  const originalPdfPath = useMemo(
    () => resolveOriginalPdfPath(document, settings.remotePdfDownloadDir),
    [document, settings.remotePdfDownloadDir],
  );
  const currentLocalPdfPath = resolveCurrentLocalPdfPath(pdfPath, pdfSource);
  const pdfScrollSourceKey = useMemo(
    () => (pdfSource ? getPdfSourceSignature(pdfSource, pdfPath || currentDocument.workspaceId) : ''),
    [currentDocument.workspaceId, pdfPath, pdfSource],
  );
  const pdfScrollPosition = pdfScrollSourceKey
    ? pdfScrollPositionsRef.current[pdfScrollSourceKey] ?? null
    : null;
  const pdfReadingHeatmap = pdfScrollSourceKey
    ? pdfReadingHeatmapsRef.current[pdfScrollSourceKey] ?? null
    : null;
  const saveCurrentPaperHistory = useCallback(
    (
      nextPdfScrollPositions = pdfScrollPositionsRef.current,
      nextPdfReadingHeatmaps = pdfReadingHeatmapsRef.current,
    ) => {
      if (!currentDocument.workspaceId || !pdfSource) {
        return;
      }

      savePaperHistory({
        version: 6,
        workspaceId: currentDocument.workspaceId,
        document: currentDocument,
        lastOpenedAt: paperOpenedAtRef.current,
        lastUpdatedAt: Date.now(),
        lastPdfPath:
          pdfPath || (pdfSource.kind === 'local-path' ? pdfSource.path : ''),
        pdfScrollPositions: nextPdfScrollPositions,
        pdfReadingHeatmaps: nextPdfReadingHeatmaps,
        lastMineruPath: mineruPath,
        lastActiveBlockId: activeBlockId,
        workspaceStage,
        readingViewMode,
        selectedQaPresetId,
        selectedQaSessionId: null,
        paperSummary,
        paperSummarySourceKey,
        workspaceNoteMarkdown: '',
        annotations,
        qaSessions: [],
      });
    },
    [
      activeBlockId,
      annotations,
      currentDocument,
      mineruPath,
      paperSummary,
      paperSummarySourceKey,
      pdfPath,
      pdfSource,
      readingViewMode,
      selectedQaPresetId,
      workspaceStage,
    ],
  );
  const handlePdfScrollPositionChange = useCallback((position: PdfScrollPosition) => {
    const next = upsertRecentPdfScrollPosition(pdfScrollPositionsRef.current, position);

    if (!next) {
      return;
    }

    pdfScrollPositionsRef.current = next;
    saveCurrentPaperHistory(next, pdfReadingHeatmapsRef.current);
  }, [saveCurrentPaperHistory]);
  const handlePdfReadingHeatmapChange = useCallback((heatmap: PdfReadingHeatmap) => {
    const next = upsertRecentPdfReadingHeatmap(pdfReadingHeatmapsRef.current, heatmap);

    if (!next) {
      return;
    }

    pdfReadingHeatmapsRef.current = next;
    saveCurrentPaperHistory(pdfScrollPositionsRef.current, next);
    window.dispatchEvent(
      new CustomEvent(PAPER_READING_HEATMAP_UPDATED_EVENT, {
        detail: {
          workspaceId: currentDocument.workspaceId,
          sourceKey: heatmap.sourceKey,
        },
      }),
    );
  }, [saveCurrentPaperHistory]);
  const currentPdfVariantLabel = useMemo(
    () => resolveCurrentPdfVariantLabel({
      currentLocalPdfPath,
      originalPdfPath,
      pdfSource,
      localize: l,
    }),
    [currentLocalPdfPath, l, originalPdfPath, pdfSource],
  );
  const canOpenOriginalPdf = canSwitchToOriginalPdf(currentLocalPdfPath, originalPdfPath);
  const annotationSaveDirectory = useMemo(
    () => resolveAnnotationSaveDirectory({
      mineruCacheDir: settings.mineruCacheDir,
      document,
      originalPdfPath,
      currentLocalPdfPath,
    }),
    [currentLocalPdfPath, document, originalPdfPath, settings.mineruCacheDir],
  );
  const availablePdfOptions = useMemo(
    () => buildAvailablePdfOptions({
      originalPdfPath,
      projectPdfFiles,
      currentLocalPdfPath,
      currentPdfVariantLabel,
    }),
    [currentLocalPdfPath, currentPdfVariantLabel, originalPdfPath, projectPdfFiles],
  );

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

  const blockById = useMemo(
    () => new Map(flatBlocks.map((block) => [block.blockId, block])),
    [flatBlocks],
  );
  const activeBlock = useMemo(
    () => (activeBlockId ? blockById.get(activeBlockId) ?? null : null),
    [activeBlockId, blockById],
  );
  const resolveBlockContentSource = useCallback(
    (block: PositionedMineruBlock) =>
      resolveMineruBlockContentSource(block, blockById),
    [blockById],
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
    return buildPaperSummarySourceKey({
      item: currentDocument,
      promptVersion: SUMMARY_PROMPT_VERSION,
      summaryLanguage: resolveSummaryOutputLanguage(settings),
      summarySourceMode: settings.summarySourceMode,
      pdfSource,
      pdfPath,
      currentPdfName,
      mineruPath,
      currentJsonName,
      blockCount: flatBlocks.length,
    });
  }, [
    currentDocument,
    currentJsonName,
    currentPdfName,
    flatBlocks.length,
    mineruPath,
    pdfSource,
    pdfPath,
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
  ]);
  const libraryPreviewSourceKey =
    paperSummarySourceKey ||
    paperSummaryNextSourceKey ||
    `${currentDocument.workspaceId}::preview::${currentJsonName}::${flatBlocks.length}`;

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

  const resetDocumentState = useCallback(() => {
    // Allow the next opened document, including reopening the same workspace item,
    // to restore cached reading history before any auto-generation runs.
    restoredHistoryRef.current = '';
    setMineruPath('');
    setMineruPages([]);
    setFlatBlocks([]);
    resetDocumentTranslationState();
    setActiveBlockId(null);
    setHoveredBlockId(null);
    setActivePdfHighlight(null);
    setBlockScrollSignal(0);
    pdfScrollPositionsRef.current = {};
    pdfReadingHeatmapsRef.current = {};
    setPaperSummary(null);
    setPaperSummaryLoading(false);
    setPaperSummaryError('');
    setPaperSummarySourceKey('');
    setLibraryOperation(null);
    autoSummarySourceKeyRef.current = '';
    setSelectedAnnotationId(null);
    setCapturingScreenshot(false);
    setSelectedExcerpt(null);
    setAnnotations([]);
    setZoteroRelatedNotes([]);
    setZoteroRelatedNotesLoading(false);
    setZoteroRelatedNotesError('');
    lastCapturedSelectionRef.current = null;
    autoTranslatedSelectionKeyRef.current = '';
  }, [resetDocumentTranslationState]);

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
      sourceKind: Parameters<typeof writeMineruParseCache>[0]['sourceKind'];
      contentJsonText?: string | null;
      middleJsonText?: string | null;
      markdownText?: string | null;
      batchId?: string;
      dataId?: string;
      fileName?: string;
      zipEntries?: string[];
    }) => {
      return writeMineruParseCache({
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
        mineruCacheDir: settings.mineruCacheDir,
      });
    },
    [settings.mineruCacheDir],
  );

  const saveSummaryCache = useCallback(
    async (item: WorkspaceItem, sourceKey: string, summary: PaperSummary) => {
      await writePreviewSummaryCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceKey,
        summary,
      });
    },
    [settings.mineruCacheDir],
  );

  const tryLoadSavedSummary = useCallback(
    async (item: WorkspaceItem, sourceKey: string) => {
      return loadSavedSummaryCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceKey,
        readText: readLocalTextFileIfExists,
      });
    },
    [settings.mineruCacheDir],
  );

  const tryLoadSavedMineruPages = useCallback(
    async (item: WorkspaceItem) => {
      return loadSavedMineruPages({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        l: lRef.current,
        readText: readLocalTextFileIfExists,
        parsePages: parseMineruPages,
      });
    },
    [settings.mineruCacheDir],
  );

  const tryResolveSavedPdfPath = useCallback(
    async (item: WorkspaceItem) => {
      return resolveSavedPdfPath({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        readText: readLocalTextFileIfExists,
        loadPdf: loadPdfBinary,
      });
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
      const nextPdfHighlight =
        options?.syncPdfHighlight === false ? null : createHighlightTarget(block);

      setActiveBlockId(block.blockId);
      setHoveredBlockId(block.blockId);
      setActivePdfHighlight(nextPdfHighlight);

      if (nextPdfHighlight) {
        setPdfHighlightSignal((current) => current + 1);
      }

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

  const restorePdfScrollPositionsForSource = useCallback(
    (workspaceId: string, source: Exclude<PdfSource, null>, fallback: string) => {
      const history = loadPaperHistory(workspaceId);
      const sourceKey = getPdfSourceSignature(source, fallback || workspaceId);
      const nextHistory = restorePdfSourceHistory(history, sourceKey);

      pdfScrollPositionsRef.current = nextHistory.pdfScrollPositions;
      pdfReadingHeatmapsRef.current = nextHistory.pdfReadingHeatmaps;
    },
    [],
  );

  const openWorkspaceDocument = useCallback(
    async (
      item: WorkspaceItem,
      source: Exclude<PdfSource, null>,
      openingStatus: string,
      nextStage: WorkspaceStage,
    ): Promise<boolean> => {
      const requestId = openDocumentRequestIdRef.current + 1;
      openDocumentRequestIdRef.current = requestId;
      setLoading(true);
      setError('');

      try {
        let resolvedSource = source;
        let resolvedPdfPath = source.kind === 'local-path' ? source.path : '';
        let nextStatus = openingStatus;
        const resolvedItem =
          source.kind === 'local-path' ? { ...item, localPdfPath: source.path } : item;

        let nextResolvedItem = resolvedItem;

        if (source.kind === 'local-path' && !(await localPathExists(source.path))) {
          throw new Error(
            lRef.current(
              `PDF 文件不存在：${source.path}`,
              `PDF file does not exist: ${source.path}`,
            ),
          );
        }

        if (source.kind === 'remote-url' && settings.remotePdfDownloadDir.trim()) {
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

        resetDocumentState();
        restorePdfScrollPositionsForSource(
          nextResolvedItem.workspaceId,
          resolvedSource,
          resolvedPdfPath || nextResolvedItem.workspaceId,
        );
        setPdfSource(resolvedSource);
        setPdfData(null);
        setPdfPath(resolvedPdfPath);
        setCurrentDocument(nextResolvedItem);
        setWorkspaceStage(nextStage);
        onDocumentResolved(nextResolvedItem);

        requestDeferredReaderStartupWork(() => {
          void (async () => {
            const isCurrentOpen = () => openDocumentRequestIdRef.current === requestId;

            if (!isCurrentOpen()) {
              return;
            }

            if (resolvedSource.kind !== 'local-path') {
              return;
            }

            const cachedMineru = await tryLoadSavedMineruPages(nextResolvedItem);

            if (!isCurrentOpen()) {
              return;
            }

            if (cachedMineru) {
              applyMineruPages(cachedMineru.pages, cachedMineru.path, {
                item: nextResolvedItem,
                pdfPath: resolvedPdfPath,
                pdfSource: resolvedSource,
                statusMessage: cachedMineru.message,
              });
              setStatusMessage(cachedMineru.message);
              return;
            }

            if (!settings.autoLoadSiblingJson) {
              return;
            }

            const siblingJsonPath = guessSiblingJsonPath(resolvedSource.path);

            try {
              const jsonText = await readLocalTextFileIfExists(siblingJsonPath);
              if (!jsonText || !isCurrentOpen()) {
                return;
              }

              const pages = parseMineruPages(jsonText);

              if (!isCurrentOpen()) {
                return;
              }

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
              setStatusMessage(siblingStatusMessage);

              await saveMineruParseCache({
                item: nextResolvedItem,
                pdfPath: resolvedSource.path,
                sourceKind: 'sibling-json',
                contentJsonText: jsonText,
              }).catch(() => undefined);
            } catch {
              // Cache restore is opportunistic. Keep the PDF open even if parsing is unavailable.
            }
          })().catch(() => undefined);
        });

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
      restorePdfScrollPositionsForSource,
      saveMineruParseCache,
      settings.autoLoadSiblingJson,
      settings.remotePdfDownloadDir,
      tryLoadSavedMineruPages,
    ],
  );

  const openDocumentItem = useCallback(async () => {
    const history = loadPaperHistory(document.workspaceId);
    const cachedPdfPath = await tryResolveSavedPdfPath(document);
    const candidateLocalPaths = buildReaderLocalPdfPathCandidates({
      historyLastPdfPath: history?.lastPdfPath,
      documentLocalPdfPath: document.localPdfPath,
      remotePdfDownloadPath:
        document.attachmentKey && settings.remotePdfDownloadDir.trim()
          ? buildRemotePdfDownloadPath(settings.remotePdfDownloadDir, document)
          : null,
      cachedPdfPath,
    });

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
      resetDocumentState();
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      setCurrentDocument(document);
      setError(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
      setStatusMessage(lRef.current('该条目没有可打开的 PDF 附件', 'This item has no PDF attachment that can be opened'));
      return;
    }

    if (!zoteroApiKey.trim()) {
      resetDocumentState();
      setPdfSource(null);
      setPdfData(null);
      setPdfPath('');
      setCurrentDocument(document);
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
    resetDocumentState,
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
    (block: PositionedMineruBlock, context?: PdfBlockSelectContext) => {
      const contentBlock = resolveBlockContentSource(block);
      const clickedHighlight = createHighlightTarget(block);

      activateBlock(contentBlock, lRef.current(
        `已从 PDF 选中结构块 ${contentBlock.blockId}`,
        `Selected block ${contentBlock.blockId} from the PDF`,
      ), {
        syncPdfHighlight: false,
      });
      setActivePdfHighlight(clickedHighlight);

      if (
        readingViewMode !== 'pdf-only' ||
        !context ||
        !settings.enablePdfParagraphTranslationPopover
      ) {
        return;
      }

      const blockText = extractTranslatableMarkdownFromMineruBlock(contentBlock).trim().slice(0, 4_000);

      if (!blockText) {
        return;
      }

      const translatedText = blockTranslations[contentBlock.blockId]?.trim() ?? '';

      lastCapturedSelectionRef.current = null;
      autoTranslatedSelectionKeyRef.current = '';

      setSelectedExcerpt({
        text: blockText,
        source: 'pdf',
        origin: 'pdf-block',
        blockId: contentBlock.blockId,
        createdAt: Date.now(),
        anchorClientX: context.anchorClientX,
        anchorClientY: context.anchorClientY,
        anchorClientRect: context.anchorClientRect,
        placement: context.placement ?? 'bottom',
        pdfLocation: block.bbox
          ? {
              pageNumber: block.pageIndex + 1,
              bbox: block.bbox,
              bboxCoordinateSystem: block.bboxCoordinateSystem,
              bboxPageSize: block.bboxPageSize,
            }
          : undefined,
      });
      applySelectedExcerptTranslation(translatedText);
      setStatusMessage(
        translatedText
          ? lRef.current('已显示当前段落的缓存译文', 'Showing the cached translation for this paragraph')
          : lRef.current(
              '当前段落还没有缓存译文，可先运行全文翻译或点击立即翻译',
              'This paragraph has no cached translation yet. Run full translation first or click Translate Now.',
            ),
      );
    },
    [
      activateBlock,
      applySelectedExcerptTranslation,
      blockTranslations,
      createHighlightTarget,
      readingViewMode,
      resolveBlockContentSource,
      settings.enablePdfParagraphTranslationPopover,
    ],
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

  const loadMineruMarkdownForSummary = useCallback(async () => {
    return loadMineruMarkdownDocument({
      item: currentDocument,
      flatBlocks,
      mineruPath,
      mineruCacheDir: settings.mineruCacheDir,
      readText: readLocalTextFileIfExists,
      buildFallbackMarkdown: buildMineruMarkdownDocument,
      l: lRef.current,
    });
  }, [
    currentDocument,
    flatBlocks,
    mineruPath,
    settings.mineruCacheDir,
  ]);

  const loadCachedPdfDocumentText = useCallback(async () => {
    if (!pdfSource) {
      return '';
    }

    const sourceForText = pdfSource;
    const cacheKey = `${currentDocument.workspaceId}::${getPdfSourceSignature(pdfSource, pdfPath || currentPdfName)}`;

    if (pdfTextCacheRef.current?.key === cacheKey) {
      return pdfTextCacheRef.current.text;
    }

    if (!pdfTextPendingRef.current) {
      pdfTextPendingRef.current = loadPdfBinary(sourceForText)
        .then((bytes) => (bytes ? extractPdfTextByPdfJs(bytes) : ''))
        .then((text) => {
          pdfTextCacheRef.current = {
            key: cacheKey,
            text,
          };
          return text;
        })
        .finally(() => {
          pdfTextPendingRef.current = null;
        });
    }

    return pdfTextPendingRef.current;
  }, [currentDocument.workspaceId, currentPdfName, pdfPath, pdfSource]);

  const resolveSummaryRequest = useCallback(async () => {
    if (settings.summarySourceMode === 'pdf-text') {
      if (!pdfSource) {
        throw new Error(
          lRef.current(
            '请先加载 PDF，或切换概览来源后再生成概览。',
            'Load a PDF, or switch the overview source before generating an overview.',
          ),
        );
      }

      const documentText = await loadCachedPdfDocumentText();

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
    loadCachedPdfDocumentText,
    loadMineruMarkdownForSummary,
    pdfSource,
    settings.summarySourceMode,
    summaryBlockInputs,
  ]);

  const resolveQaRequest = useCallback(async () => {
    let pdfDocumentText = '';
    let mineruDocumentText = '';

    if (settings.ragSourceMode === 'pdf-text' || settings.ragSourceMode === 'hybrid' || settings.qaSourceMode === 'pdf-text') {
      if (!pdfSource) {
        if (settings.qaSourceMode === 'pdf-text') {
          throw new Error(
            lRef.current(
              '请先加载 PDF，或切换到 MinerU 内容问答。',
              'Load a PDF first, or switch back to MinerU-based QA.',
            ),
          );
        }
      } else {
        pdfDocumentText = await loadCachedPdfDocumentText();

        if (settings.qaSourceMode === 'pdf-text' && !pdfDocumentText.trim()) {
          throw new Error(
            lRef.current(
              '当前 PDF 未提取到可用文本，请改用 MinerU 内容问答，或确认 PDF 可被本地文本层读取。',
              'No usable text was extracted from the current PDF. Use MinerU-based QA instead, or confirm the local PDF text layer is readable.',
            ),
          );
        }
      }
    }

    if (settings.ragSourceMode === 'mineru-markdown' || settings.ragSourceMode === 'hybrid' || settings.qaSourceMode === 'mineru-markdown') {
      mineruDocumentText = await loadMineruMarkdownForSummary();
    }

    if (settings.qaSourceMode === 'mineru-markdown' && !mineruDocumentText.trim() && summaryBlockInputs.length === 0) {
      throw new Error(
        lRef.current(
          '请先加载 MinerU JSON，再进行基于 MinerU 内容的文档问答。',
          'Load a MinerU JSON file before starting MinerU-based document QA.',
        ),
      );
    }

    const ragEnabledForQa =
      qaRagEnabled && settings.localRagEnabled && settings.ragSourceMode !== 'off';

    let ragResolution: LocalRagResolution =
      ragEnabledForQa
        ? {
            kind: 'missing-embedding-config' as const,
          }
        : {
            kind: 'disabled' as const,
          };

    if (
      ragEnabledForQa &&
      currentDocument &&
      embeddingApiKey.trim() &&
      settings.embeddingBaseUrl.trim() &&
      settings.embeddingModel.trim()
    ) {
      ragResolution = await resolveLocalRag({
        item: currentDocument,
        settings,
        embedding: {
          baseUrl: settings.embeddingBaseUrl,
          apiKey: embeddingApiKey.trim(),
          model: settings.embeddingModel,
          dimensions: settings.embeddingDimensions,
          timeoutSeconds: settings.embeddingRequestTimeoutSeconds,
        },
        question: qaInput.trim(),
        excerptText: selectedExcerpt?.text,
        mineruBlocks: flatBlocks,
        mineruDocumentText,
        pdfDocumentText,
      });

      if (ragResolution.kind === 'retrieved') {
        return {
          blocks: summaryBlockInputs,
          documentText: ragResolution.documentText,
          qaContext: buildQaContext({
            origin: 'local-rag',
            rag: ragResolution,
          }),
          citations: ragResolution.citations,
        };
      }
    }

    if (settings.qaSourceMode === 'pdf-text') {
      return {
        blocks: summaryBlockInputs,
        documentText: pdfDocumentText,
        qaContext: buildQaContext({
          origin: 'pdf-text',
          rag: ragResolution,
        }),
        citations: [],
      };
    }

    return {
      blocks: summaryBlockInputs,
      documentText: mineruDocumentText,
      qaContext: buildQaContext({
        origin: 'mineru-markdown',
        rag: ragResolution,
      }),
      citations: [],
    };
  }, [
    activeQaPreset,
    loadMineruMarkdownForSummary,
    loadCachedPdfDocumentText,
    currentDocument,
    embeddingApiKey,
    flatBlocks,
    pdfSource,
    qaInput,
    selectedExcerpt?.text,
    settings,
    settings.qaSourceMode,
    summaryBlockInputs,
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
          apiMode: summaryModelPreset.apiMode,
          temperature: getModelRuntimeConfig(settings, 'summary').temperature,
          reasoningEffort: getModelRuntimeConfig(settings, 'summary').reasoningEffort,
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
    if (!settings.enableSelectionTranslation) {
      return;
    }

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
      anchorClientRect: selection.anchorClientRect,
      placement: selection.placement,
      pdfLocation: selection.pdfLocation,
    });
    resetSelectedExcerptTranslationState();
    setStatusMessage(
      source === 'pdf'
        ? lRef.current('已选中 PDF 划词', 'Selected text from the PDF')
        : lRef.current('已选中结构块文本', 'Selected text from the structured block'),
    );
  }, [resetSelectedExcerptTranslationState, settings.enableSelectionTranslation]);

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
    autoTranslatedSelectionKeyRef.current = '';
    setSelectedExcerpt(null);
    resetSelectedExcerptTranslationState();
    setStatusMessage(lRef.current('已清除划词内容', 'Cleared the selected excerpt'));
  }, [resetSelectedExcerptTranslationState]);

  useEffect(() => {
    if (!selectedExcerpt) {
      return;
    }

    if (
      selectedExcerpt.origin === 'pdf-block'
        ? !settings.enablePdfParagraphTranslationPopover
        : !settings.enableSelectionTranslation
    ) {
      handleClearSelectedExcerpt();
    }
  }, [
    handleClearSelectedExcerpt,
    selectedExcerpt,
    settings.enablePdfParagraphTranslationPopover,
    settings.enableSelectionTranslation,
  ]);

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

        if (!(await localPathExists(path))) {
          throw new Error(
            lRef.current(
              `PDF 文件不存在：${path}`,
              `PDF file does not exist: ${path}`,
            ),
          );
        }

        setPdfSource(nextSource);
        setPdfData(null);
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
    setAssistantActivePanel('chat');
    setWorkspaceStage('reading');
    setStatusMessage(
      lRef.current('文档问答已切换为独立浮动窗口', 'Moved document chat to a detached floating window'),
    );
  }, []);

  const handleAttachAssistant = useCallback(() => {
    setAssistantDetached(false);
    setAssistantActivePanel('chat');
    setStatusMessage(lRef.current('文档问答已停靠回右侧面板', 'Docked document chat back to the right sidebar'));
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

      const nextSession = resolveQaSessionSelection(qaSessions, sessionId);

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
      const nextSelection = removeQaSession(
        qaSessions,
        sessionId,
        () => createQaSession(localeRef.current),
      );

      if (!nextSelection.removed) {
        return;
      }

      setQaSessions(nextSelection.sessions);
      setSelectedQaSessionId((current) =>
        current === sessionId ? nextSelection.selectedSessionId : current,
      );

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
      const nextPreset = resolveQaModelPreset(qaModelPresets, presetId);

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

  const reloadNotes = useCallback(async () => {
    setNotesLoading(true);
    setNotesError('');

    try {
      const nextNotes = await listStoredNotes({ limit: 1000 });

      setNotes(nextNotes);
      setReaderNoteExternalUpdate((current) =>
        current && nextNotes.some((note) => note.id === current.id) ? current : null,
      );
      setActiveNoteId((current) =>
        current && nextNotes.some((note) => note.id === current)
          ? current
          : nextNotes[0]?.id ?? null,
      );
    } catch (nextError) {
      setNotes([]);
      setActiveNoteId(null);
      setNotesError(
        nextError instanceof Error
          ? nextError.message
          : lRef.current('加载笔记失败', 'Failed to load notes'),
      );
    } finally {
      setNotesLoading(false);
    }
  }, [setActiveNoteId, setNotes, setNotesError, setNotesLoading]);

  const handleSelectNote = useCallback((note: Note) => {
    setActiveNoteId(note.id);
    setAssistantActivePanel('notes');
  }, []);

  const handleJumpToNote = useCallback((note: Note) => {
    setActiveNoteId(note.id);
    setSelectedAnnotationId(null);
    setWorkspaceStage('reading');
    setAssistantActivePanel('notes');

    if (note.paperId && note.paperId !== currentDocument.workspaceId) {
      setStatusMessage(lRef.current('该笔记属于其他文献，请先打开对应文献', 'This note belongs to another paper. Open that paper first.'));
      return;
    }

    const highlightTarget = buildNotePdfHighlightTarget(note);

    if (!highlightTarget) {
      setStatusMessage(lRef.current('该笔记没有绑定 PDF 位置', 'This note is not linked to a PDF location'));
      return;
    }

    setActivePdfHighlight(highlightTarget);
    setPdfHighlightSignal((current) => current + 1);
    setStatusMessage(
      lRef.current(
        `已定位到笔记：${note.title || '未命名笔记'}`,
        `Located note: ${note.title || 'Untitled Note'}`,
      ),
    );
  }, [currentDocument.workspaceId, setActiveNoteId, setAssistantActivePanel]);

  const applyNoteAnchorJump = useCallback((detail: JumpToNoteAnchorEventDetail) => {
    const highlightTarget = buildNoteAnchorPdfHighlightTarget(detail);

    if (!highlightTarget) {
      setStatusMessage(lRef.current('该引用没有绑定 PDF 位置', 'This reference is not linked to a PDF location'));
      return false;
    }

    setActiveNoteId(detail.noteId);
    setSelectedAnnotationId(null);
    setWorkspaceStage('reading');
    setAssistantActivePanel('notes');
    setActivePdfHighlight(highlightTarget);
    setPdfHighlightSignal((current) => current + 1);
    setStatusMessage(
      lRef.current(
        `已定位到引用：${detail.anchorLabel || detail.noteTitle || '未命名引用'}`,
        `Located reference: ${detail.anchorLabel || detail.noteTitle || 'Untitled reference'}`,
      ),
    );
    return true;
  }, [setActiveNoteId, setAssistantActivePanel]);

  const handleJumpToNoteAnchor = useCallback((note: Note, anchor: NoteAnchor) => {
    const targetWorkspaceId = resolveNoteAnchorWorkspaceId(note, anchor);
    const detail = buildNoteAnchorJumpDetail(note, anchor);

    if (targetWorkspaceId && targetWorkspaceId !== currentDocument.workspaceId) {
      setActiveNoteId(note.id);
      setAssistantActivePanel('notes');
      emitJumpToNoteAnchor(detail);
      return;
    }

    applyNoteAnchorJump(detail);
  }, [applyNoteAnchorJump, currentDocument.workspaceId, setActiveNoteId, setAssistantActivePanel]);

  const handleCreateNote = useCallback(
    async (request: CreateNoteRequest) => {
      setNotesSaving(true);
      setNotesError('');

      try {
        const created = await createStoredNote(
          {
            ...request,
            paperId: request.paperId || currentDocument.workspaceId,
          },
          { sourceId: readerNoteEditorSourceId },
        );

        setNotes((current) => [created, ...current.filter((note) => note.id !== created.id)]);
        setReaderNoteExternalUpdate((current) => (current?.id === created.id ? null : current));
        setActiveNoteId(created.id);
        setAssistantActivePanel('notes');
        setStatusMessage(lRef.current('已创建笔记', 'Created note'));
        return created;
      } catch (nextError) {
        setNotesError(
          nextError instanceof Error
            ? nextError.message
            : lRef.current('创建笔记失败', 'Failed to create note'),
        );
        return null;
      } finally {
        setNotesSaving(false);
      }
    },
    [currentDocument.workspaceId, readerNoteEditorSourceId],
  );

  const handleCreateStandaloneNote = useCallback(() => {
    void handleCreateNote({
      paperId: currentDocument.workspaceId,
      type: 'standalone',
      title: lRef.current('新的阅读笔记', 'New Reading Note'),
      content: '',
      tags: [],
      color: '#f3f4f6',
    });
  }, [currentDocument.workspaceId, handleCreateNote]);

  const handleUpdateNote = useCallback(async (
    noteId: string,
    patch: UpdateNoteRequest,
    options: NoteMutationOptions = {},
  ) => {
    setNotesSaving(true);
    setNotesError('');

    try {
      const updated = await updateStoredNote(noteId, patch, {
        ...options,
        sourceId: options.sourceId ?? readerNoteEditorSourceId,
      });

      setNotes((current) =>
        sortReaderNotes(current.map((note) => (note.id === updated.id ? updated : note))),
      );
      setReaderNoteExternalUpdate((current) => (current?.id === updated.id ? null : current));
      setActiveNoteId(updated.id);
      setStatusMessage(lRef.current('已保存笔记', 'Saved note'));
    } catch (nextError) {
      setNotesError(
        nextError instanceof Error
          ? nextError.message
          : lRef.current('保存笔记失败', 'Failed to save note'),
      );
    } finally {
      setNotesSaving(false);
    }
  }, [readerNoteEditorSourceId]);

  const handleAddSelectionToNote = useCallback(async () => {
    if (!selectedExcerpt?.text.trim()) {
      setStatusMessage(lRef.current('请先在 PDF 或正文中划词', 'Select text in the PDF or document first'));
      return;
    }

    const anchor = createNoteAnchorFromSelection(selectedExcerpt, currentDocument.workspaceId, currentDocument.title);
    let targetNote = resolveReaderNoteAnchorTarget(notes, activeNoteId);

    if (!targetNote) {
      targetNote = await handleCreateNote(
        buildSelectedExcerptNoteCreateRequest({
          paperId: currentDocument.workspaceId,
          selectedExcerpt,
          title: titleFromText(selectedExcerpt.text, lRef.current('新的阅读笔记', 'New Reading Note')),
        }),
      );

      if (!targetNote) {
        return;
      }
    }

    setActiveNoteId(targetNote.id);
    setAssistantActivePanel('notes');
    setPendingNoteAnchorInsert(buildPendingNoteAnchorInsert(targetNote.id, anchor));
    setStatusMessage(lRef.current('已插入当前笔记，保存后同步定位', 'Inserted into the current note. Save to sync the reference.'));
  }, [
    activeNoteId,
    currentDocument.title,
    currentDocument.workspaceId,
    handleCreateNote,
    notes,
    selectedExcerpt,
    setActiveNoteId,
    setAssistantActivePanel,
  ]);

  const handlePendingNoteAnchorInsertHandled = useCallback((requestId: string) => {
    setPendingNoteAnchorInsert((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    setNotesSaving(true);
    setNotesError('');

    try {
      await deleteStoredNote(noteId, { sourceId: readerNoteEditorSourceId });
      setReaderNoteExternalUpdate((current) => (current?.id === noteId ? null : current));
      setNotes((current) => {
        const nextNotes = current.filter((note) => note.id !== noteId);
        setActiveNoteId((activeId) => (activeId === noteId ? nextNotes[0]?.id ?? null : activeId));
        return nextNotes;
      });
      setStatusMessage(lRef.current('已删除笔记', 'Deleted note'));
    } catch (nextError) {
      setNotesError(
        nextError instanceof Error
          ? nextError.message
          : lRef.current('删除笔记失败', 'Failed to delete note'),
      );
    } finally {
      setNotesSaving(false);
    }
  }, [readerNoteEditorSourceId]);

  const handleReaderNoteExternalUpdateApply = useCallback((note: Note) => {
    setReaderNoteExternalUpdate((current) => (current?.id === note.id ? null : current));
    setNotes((current) => {
      const exists = current.some((item) => item.id === note.id);
      const nextNotes = exists
        ? current.map((item) => (item.id === note.id ? note : item))
        : [note, ...current];

      return sortReaderNotes(nextNotes);
    });
    setActiveNoteId((current) => current ?? note.id);
  }, [setActiveNoteId, setNotes]);

  const handleSaveAssistantMessageAsNote = useCallback(
    (message: DocumentChatMessage) => {
      const session =
        qaSessions.find((item) => item.messages.some((sessionMessage) => sessionMessage.id === message.id)) ??
        activeQaSession;
      const messageIndex = session?.messages.findIndex((sessionMessage) => sessionMessage.id === message.id) ?? -1;
      const question =
        messageIndex >= 0
          ? [...(session?.messages.slice(0, messageIndex) ?? [])]
              .reverse()
              .find((sessionMessage) => sessionMessage.role === 'user' && sessionMessage.content.trim())
              ?.content.trim() ?? ''
          : '';
      const answer = message.content.trim();

      if (!answer) {
        setStatusMessage(lRef.current('这条 AI 回复还没有可保存的内容', 'This AI reply has no content to save yet'));
        return;
      }

      const content = [
        question ? `## Question\n\n${buildNoteQuoteMarkdown(question)}` : '',
        `## Answer\n\n${answer}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      void handleCreateNote({
        paperId: currentDocument.workspaceId,
        type: 'ai-chat',
        title: titleFromText(question || answer, lRef.current('AI 对话笔记', 'AI Chat Note')),
        content,
        excerpt: question || undefined,
        pdfLocation: selectedExcerpt?.pdfLocation ?? null,
        aiChatId: session?.id ?? selectedQaSessionId,
        aiChatMessageIds: [message.id],
        tags: ['AI'],
        color: '#dbeafe',
      });
    },
    [
      activeQaSession,
      currentDocument.workspaceId,
      handleCreateNote,
      qaSessions,
      selectedExcerpt?.pdfLocation,
      selectedQaSessionId,
    ],
  );

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
      if (annotationId.startsWith('note-anchor:')) {
        const [, noteId, anchorId] = annotationId.split(':');
        const targetNote = notes.find((note) => note.id === noteId);
        const targetAnchor = targetNote?.anchors.find((anchor) => anchor.id === anchorId);

        if (!targetNote || !targetAnchor) {
          setStatusMessage(lRef.current('该 PDF 摘录已不存在', 'This PDF clip no longer exists'));
          return;
        }

        handleJumpToNoteAnchor(targetNote, targetAnchor);
        return;
      }

      if (annotationId.startsWith('note:')) {
        const noteId = annotationId.slice('note:'.length);
        const targetNote = notes.find((note) => note.id === noteId);

        if (!targetNote) {
          setStatusMessage(lRef.current('该 PDF 笔记已不存在', 'This PDF note no longer exists'));
          return;
        }

        handleJumpToNote(targetNote);
        return;
      }

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
    [activateBlock, annotations, flatBlocks, handleJumpToNote, handleJumpToNoteAnchor, notes],
  );

  const handleSelectQaCitation = useCallback(
    (citation: DocumentChatCitation) => {
      const samePageBlocks =
        citation.pageIndex !== null && citation.pageIndex !== undefined
          ? flatBlocks.filter((block) => block.pageIndex === citation.pageIndex)
          : [];
      const samePageBodyBlock =
        samePageBlocks.find((block) => block.type !== 'title') ?? samePageBlocks[0] ?? null;
      const targetBlock =
        (citation.blockId
          ? flatBlocks.find((block) => block.blockId === citation.blockId)
          : null) ??
        samePageBodyBlock;

      if (!targetBlock) {
        setStatusMessage(
          lRef.current(
            `未找到引用 ${citation.label} 对应的结构块`,
            `Could not find the block for citation ${citation.label}`,
          ),
        );
        return;
      }

      setWorkspaceStage('reading');
      setAssistantActivePanel('chat');
      activateBlock(
        targetBlock,
        lRef.current(
          `已定位到引用 [${citation.label}] · ${targetBlock.blockId}`,
          `Focused citation [${citation.label}] · ${targetBlock.blockId}`,
        ),
      );
    },
    [activateBlock, flatBlocks],
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

        setQaAttachments((current) => appendUniqueChatAttachments(current, attachments));
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
      renderMode: qaAnswerRenderMode,
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
      const qaRequest = await resolveQaRequest();

      if (qaRequest.documentText === '__never__') {
        throw new Error(
          lRef.current(
            '请先加载 MinerU JSON，或先在 PDF / 结构块视图中选中文本。',
            'Load MinerU JSON first, or select text in the PDF or block view.',
          ),
        );
      }

      const updateStreamingAnswer = (answer: string) => {
        streamedAnswer = answer;
        const updatedAssistantMessage: DocumentChatMessage = {
          ...nextAssistantMessage,
          content: answer,
          qaContext: qaRequest.qaContext,
          citations: qaRequest.citations,
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
          apiMode: activeQaPreset.apiMode,
          answerRenderMode: qaAnswerRenderMode,
          temperature: getModelRuntimeConfig(settings, 'qa').temperature,
          reasoningEffort: qaReasoningEffort,
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

      setStatusMessage(formatQaContextStatus(qaRequest.qaContext, lRef.current));
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
    qaAnswerRenderMode,
    qaReasoningEffort,
    qaInput,
    qaSessions,
    resolveQaRequest,
    selectedQaSessionId,
    selectedExcerpt?.text,
  ]);

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
      return;
    }

    setWorkspaceStage(history.workspaceStage);
    setReadingViewMode(history.readingViewMode);
    setPaperSummary(history.paperSummary);
    setPaperSummarySourceKey(history.paperSummarySourceKey);
    setAnnotations(history.annotations);

    if (history.paperSummary || history.annotations.length > 0) {
      setStatusMessage(lRef.current('已恢复上次阅读记录', 'Restored the last reading history'));
    }
  }, [
    currentDocument.workspaceId,
    pdfSource,
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
    void reloadNotes();
  }, [reloadNotes]);

  useEffect(() => {
    const handleNoteChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteChangedEventDetail>).detail;
      if (!detail?.noteId) return;

      if (detail.action === 'deleted') {
        setReaderNoteExternalUpdate((current) => (current?.id === detail.noteId ? null : current));
        setNotes((current) => {
          const nextNotes = current.filter((note) => note.id !== detail.noteId);
          setActiveNoteId((activeId) => (activeId === detail.noteId ? nextNotes[0]?.id ?? null : activeId));
          return nextNotes;
        });
        return;
      }

      if (!isNoteEventRecord(detail.note)) {
        void reloadNotes();
        return;
      }

      const nextNote = detail.note;
      const fromThisReaderSidebar = detail.sourceId === readerNoteEditorSourceId;
      const isCurrentEditorNote = activeNoteId === nextNote.id;

      if (isCurrentEditorNote && !fromThisReaderSidebar) {
        setReaderNoteExternalUpdate(nextNote);
        return;
      }

      if (fromThisReaderSidebar) {
        setReaderNoteExternalUpdate((current) => (current?.id === nextNote.id ? null : current));
      }

      setNotes((current) => {
        const exists = current.some((note) => note.id === nextNote.id);
        const nextNotes = exists
          ? current.map((note) => (note.id === nextNote.id ? nextNote : note))
          : [nextNote, ...current];

        return sortReaderNotes(nextNotes);
      });
      setActiveNoteId((current) => current ?? nextNote.id);
    };

    window.addEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
    return () => window.removeEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
  }, [activeNoteId, readerNoteEditorSourceId, reloadNotes, setActiveNoteId, setNotes]);

  useEffect(() => {
    if (!pendingNoteAnchorJump) {
      return;
    }

    const targetWorkspaceId = (
      pendingNoteAnchorJump.targetPaperId ||
      pendingNoteAnchorJump.anchorPaperId ||
      pendingNoteAnchorJump.notePaperId ||
      ''
    ).trim();

    if (targetWorkspaceId && targetWorkspaceId !== currentDocument.workspaceId) {
      return;
    }

    if (!pdfSource) {
      return;
    }

    if (applyNoteAnchorJump(pendingNoteAnchorJump)) {
      onPendingNoteAnchorJumpHandled?.(pendingNoteAnchorJump.requestId);
    }
  }, [
    applyNoteAnchorJump,
    currentDocument.workspaceId,
    onPendingNoteAnchorJumpHandled,
    pdfSource,
    pendingNoteAnchorJump,
  ]);

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
    setBlockScrollSignal((current) => current + 1);
  }, [flatBlocks]);

  useEffect(() => {
    saveCurrentPaperHistory();
  }, [saveCurrentPaperHistory]);

  useEffect(() => {
    localStorage.setItem(PANE_RATIO_STORAGE_KEY, String(leftPaneWidthRatio));
  }, [leftPaneWidthRatio]);

  const assistantSidebarProps = useMemo(
    () =>
      buildReaderAssistantSidebarProps({
        l: readerLocaleText,
        activePanel: assistantActivePanel,
        onActivePanelChange: setAssistantActivePanel,
        currentDocument,
        documentSource,
        currentPdfName,
        currentJsonName,
        blockCount: flatBlocks.length,
        translatedCount,
        statusMessage,
        hasBlocks: flatBlocks.length > 0,
        aiConfigured,
        notes,
        activeNoteId,
        notesLoading,
        notesSaving,
        notesError,
        pendingAnchorInsert: pendingNoteAnchorInsert,
        onPendingAnchorInsertHandled: handlePendingNoteAnchorInsertHandled,
        noteEditorSourceId: readerNoteEditorSourceId,
        externalUpdateNote: readerNoteExternalUpdate,
        onExternalUpdateApply: handleReaderNoteExternalUpdateApply,
        qaSessions,
        selectedQaSessionId,
        qaMessages,
        qaInput,
        qaAttachments,
        qaModelPresets,
        selectedQaPresetId,
        qaRagEnabled,
        qaAnswerRenderMode,
        qaReasoningEffort,
        qaLoading,
        qaError,
        screenshotLoading: screenshotBusy,
        onQaInputChange: setQaInput,
        onQaSubmit: () => {
          void handleSubmitQa();
        },
        onQaPresetChange: handleQaPresetChange,
        onQaRagEnabledChange: setQaRagEnabled,
        onQaAnswerRenderModeChange: setQaAnswerRenderMode,
        onQaReasoningEffortChange: setQaReasoningEffort,
        onQaSessionCreate: handleCreateQaSession,
        onQaSessionSelect: handleSelectQaSession,
        onQaSessionDelete: handleDeleteQaSession,
        onSelectImageAttachments: () => {
          void handleSelectQaAttachments('image');
        },
        onSelectFileAttachments: () => {
          void handleSelectQaAttachments('file');
        },
        onCaptureScreenshot: () => {
          void handleCaptureSystemScreenshotNative();
        },
        onRemoveAttachment: handleRemoveAttachment,
        onCitationClick: handleSelectQaCitation,
        onCreateStandaloneNote: handleCreateStandaloneNote,
        onSelectNote: handleSelectNote,
        onUpdateNote: (noteId, patch, options) => {
          void handleUpdateNote(noteId, patch, options);
        },
        onDeleteNote: (noteId) => {
          void handleDeleteNote(noteId);
        },
        onJumpToNoteAnchor: handleJumpToNoteAnchor,
        onAddSelectionToNote: () => {
          void handleAddSelectionToNote();
        },
        onSaveAssistantMessageAsNote: handleSaveAssistantMessageAsNote,
        selectedExcerpt,
        selectedExcerptTranslation,
        selectedExcerptTranslating,
        selectedExcerptError,
        onAppendSelectedExcerptToQa: handleAppendSelectedExcerptToQa,
        onTranslateSelectedExcerpt: () => {
          void handleTranslateSelectedExcerpt();
        },
        onClearSelectedExcerpt: handleClearSelectedExcerpt,
        onOpenPreferences,
      }),
    [
      activeNoteId,
      aiConfigured,
      assistantActivePanel,
      currentDocument,
      currentJsonName,
      currentPdfName,
      documentSource,
      flatBlocks.length,
      handleAddSelectionToNote,
      handleAppendSelectedExcerptToQa,
      handleCaptureSystemScreenshotNative,
      handleClearSelectedExcerpt,
      handleCreateQaSession,
      handleCreateStandaloneNote,
      handleDeleteNote,
      handleDeleteQaSession,
      handleJumpToNoteAnchor,
      handlePendingNoteAnchorInsertHandled,
      handleQaPresetChange,
      handleReaderNoteExternalUpdateApply,
      handleRemoveAttachment,
      handleSaveAssistantMessageAsNote,
      handleSelectNote,
      handleSelectQaAttachments,
      handleSelectQaCitation,
      handleSelectQaSession,
      handleSubmitQa,
      handleTranslateSelectedExcerpt,
      handleUpdateNote,
      notes,
      notesError,
      notesLoading,
      notesSaving,
      onOpenPreferences,
      pendingNoteAnchorInsert,
      qaAnswerRenderMode,
      qaAttachments,
      qaError,
      qaLoading,
      qaMessages,
      qaModelPresets,
      qaRagEnabled,
      qaReasoningEffort,
      qaInput,
      qaSessions,
      readerLocaleText,
      readerNoteExternalUpdate,
      readerNoteEditorSourceId,
      screenshotBusy,
      selectedExcerpt,
      selectedExcerptError,
      selectedExcerptTranslating,
      selectedExcerptTranslation,
      selectedQaPresetId,
      selectedQaSessionId,
      statusMessage,
      translatedCount,
    ],
  );


  useEffect(() => {
    const signature = `${document.workspaceId}::${document.attachmentKey ?? ''}`;

    if (lastDocumentSignatureRef.current === signature) {
      return;
    }

    lastDocumentSignatureRef.current = signature;
    pdfTextCacheRef.current = null;
    pdfTextPendingRef.current = null;
    setQaRagEnabled(true);
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
    if (
      !selectedExcerpt ||
      selectedExcerpt.origin === 'pdf-block' ||
      !translationConfigured ||
      !settings.enableSelectionTranslation ||
      !settings.autoTranslateSelection
    ) {
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
    settings.enableSelectionTranslation,
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

  const handleBridgeTranslate = useCallback(() => {
    void handleTranslateDocument();
  }, [handleTranslateDocument]);

  const handleBridgeCancelTranslate = useCallback(() => {
    handleCancelDocumentTranslation();
  }, [handleCancelDocumentTranslation]);

  const handleBridgeCloudParse = useCallback(() => {
    void handleCloudParse();
  }, [handleCloudParse]);

  const handleBridgeGenerateSummary = useCallback(() => {
    void handleGeneratePaperSummary();
  }, [handleGeneratePaperSummary]);

  const bridgeState = useMemo<ReaderTabBridgeState>(
    () => ({
      translating,
      translatedCount,
      assistantSidebarProps,
      onDetachAssistant: handleOpenFloatingAssistant,
      onAttachAssistant: handleAttachAssistant,
      onTranslate: handleBridgeTranslate,
      onCancelTranslate: handleBridgeCancelTranslate,
      onClearTranslations: handleClearTranslations,
      onCloudParse: handleBridgeCloudParse,
      onGenerateSummary: handleBridgeGenerateSummary,
    }),
    [
      assistantSidebarProps,
      handleAttachAssistant,
      handleBridgeCancelTranslate,
      handleBridgeCloudParse,
      handleBridgeGenerateSummary,
      handleBridgeTranslate,
      handleClearTranslations,
      handleOpenFloatingAssistant,
      translatedCount,
      translating,
    ],
  );

  useEffect(() => {
    onBridgeStateChange(tabId, bridgeState);

    return () => {
      onBridgeStateChange(tabId, null);
    };
  }, [bridgeState, onBridgeStateChange, tabId]);

  return (
    <div className="relative h-full min-h-0" hidden={!isActive}>
      <ReaderWorkspace
        active={isActive}
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
        translationCancelling={translationCancelling}
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
        pdfScrollPosition={pdfScrollPosition}
        pdfReadingHeatmap={pdfReadingHeatmap}
        onPdfScrollPositionChange={handlePdfScrollPositionChange}
        onPdfReadingHeatmapChange={handlePdfReadingHeatmapChange}
        blocks={flatBlocks}
        translations={blockTranslations}
        translationDisplayMode={settings.translationDisplayMode}
        translationLanguageLabel={translationTargetLanguageLabel}
        activeBlockId={activeBlockId}
        hoveredBlockId={hoveredBlockId}
        activePdfHighlight={activePdfHighlight}
        pdfHighlightSignal={pdfHighlightSignal}
        blockScrollSignal={blockScrollSignal}
        smoothScroll={settings.smoothScroll}
        enablePdfReadingHeatmap={settings.enablePdfReadingHeatmap}
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
        onRetranslateBlock={(block) => void handleRetranslateBlock(block)}
        onTranslationDisplayModeChange={onTranslationDisplayModeChange}
        onTextSelect={handleTextSelect}
        onOpenStandalonePdf={onOpenStandalonePdf}
        onOpenMineruJson={() => void handleOpenMineruJson()}
        onCloudParse={() => void handleCloudParse()}
        onTranslateDocument={() => void handleTranslateDocument()}
        onCancelTranslateDocument={handleCancelDocumentTranslation}
        onOpenPreferences={onOpenPreferences}
        notes={notes}
        onAddSelectionToNote={() => void handleAddSelectionToNote()}
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
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
        qaRagEnabled={qaRagEnabled}
        qaAnswerRenderMode={qaAnswerRenderMode}
        qaReasoningEffort={qaReasoningEffort}
        screenshotLoading={screenshotBusy}
        onQaInputChange={setQaInput}
        onQaSubmit={() => void handleSubmitQa()}
        onQaPresetChange={handleQaPresetChange}
        onQaRagEnabledChange={setQaRagEnabled}
        onQaAnswerRenderModeChange={setQaAnswerRenderMode}
        onQaReasoningEffortChange={setQaReasoningEffort}
        onQaSessionCreate={handleCreateQaSession}
        onQaSessionSelect={handleSelectQaSession}
        onQaSessionDelete={handleDeleteQaSession}
        onSelectImageAttachments={() => void handleSelectQaAttachments('image')}
        onSelectFileAttachments={() => void handleSelectQaAttachments('file')}
        onCaptureScreenshot={() => void handleCaptureSystemScreenshotNative()}
        onRemoveAttachment={handleRemoveAttachment}
        onCitationClick={handleSelectQaCitation}
        onSaveAssistantMessageAsNote={handleSaveAssistantMessageAsNote}
        qaLoading={qaLoading}
        qaError={qaError}
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        autoTranslateSelection={settings.enableSelectionTranslation && settings.autoTranslateSelection}
        onAppendSelectedExcerptToQa={handleAppendSelectedExcerptToQa}
        onTranslateSelectedExcerpt={() => void handleTranslateSelectedExcerpt()}
        onClearSelectedExcerpt={handleClearSelectedExcerpt}
        onPdfAnnotationSaveSuccess={handlePdfAnnotationSaveSuccess}
        aiConfigured={aiConfigured}
        assistantDetached={assistantDetached}
        leftSidebarCollapsed={false}
        onToggleLeftSidebar={() => undefined}
        onAttachAssistant={handleAttachAssistant}
        showLibraryToggle={false}
      />
    </div>
  );
}

export default DocumentReaderTab;

