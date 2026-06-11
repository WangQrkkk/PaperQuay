import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCurrentWindow } from '../../platform/electron/window';

import {
  JUMP_TO_NOTE_ANCHOR_EVENT,
  OPEN_ONBOARDING_EVENT,
  OPEN_PREFERENCES_EVENT,
  OPEN_STANDALONE_PDF_EVENT,
  type JumpToNoteAnchorEventDetail,
  type OpenPreferencesEventDetail,
} from '../../app/appEvents';
import { selectDirectory } from '../../services/desktop';
import { listLibraryPapers } from '../../services/library';
import { AppLocaleProvider } from '../../i18n/uiLanguage';
import { getHomeTabTitle, HOME_TAB_ID, type ReaderTab, useTabsStore } from '../../stores/useTabsStore';
import { useThemeStore } from '../../stores/useThemeStore';
import {
  createQaSession,
  type ReaderTabBridgeState,
} from './documentReaderShared';
import type {
  LiteratureCategory,
  LiteraturePaper,
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
  LibrarySettings,
} from '../../types/library';
import type { Note } from '../../types/notes';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatRenderMode,
  DocumentChatSession,
  ModelReasoningEffort,
  TranslationDisplayMode,
  WorkspaceItem,
} from '../../types/reader';
import DocumentReaderTab from './DocumentReaderTab';
import { AssistantSidebar } from './AssistantSidebar';
import LiteratureLibraryView from '../literature/LiteratureLibraryView';
import { emitLibraryMetadataEnrichRequest } from '../literature/libraryEvents';
import OnboardingGuide from './OnboardingGuide';
import ReaderPreferencesWindow from './ReaderPreferencesWindow';
import { useReaderLibraryActions } from './useReaderLibraryActions';
import { useReaderLibraryPreview } from './useReaderLibraryPreview';
import { useReaderSettings } from './useReaderSettings';
import { useReaderZoteroSync } from './useReaderZoteroSync';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
} from './paperTaskState';
import {
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  loadStoredNumber,
} from './readerWorkspaceShared';
import {
  EMPTY_LIBRARY_PREVIEW_STATE,
  EMPTY_ONBOARDING_DEMO_REVEAL,
  formatPaperSummaryForLibrary,
  isOnboardingWelcomeItem,
  mergeLocalPdfPath,
  ONBOARDING_AGENT_STEP,
  ONBOARDING_LIBRARY_END_STEP,
  ONBOARDING_LIBRARY_START_STEP,
  ONBOARDING_READER_OVERVIEW_STEP,
  ONBOARDING_READER_READING_END_STEP,
  ONBOARDING_READER_READING_START_STEP,
  ONBOARDING_SEEN_STORAGE_KEY,
  ONBOARDING_SETTINGS_STEP,
  ONBOARDING_WELCOME_CACHE_DIR,
  ONBOARDING_WELCOME_ITEM,
  createNativeLibraryWorkspaceItem,
  getModelRuntimeConfig,
  resolveLanguageLabel,
  WELCOME_STANDALONE_ITEM,
  type OnboardingDemoRevealState,
  type PreferencesSectionKey,
  type SummaryCacheEnvelope,
} from './readerShared';

interface ReaderProps {
  workspaceActive?: boolean;
}

function resolveNoteAnchorWorkspaceId(detail: JumpToNoteAnchorEventDetail) {
  const rawTarget = (
    detail.targetPaperId ||
    detail.anchorPaperId ||
    detail.notePaperId ||
    ''
  ).trim();

  if (!rawTarget) {
    return '';
  }

  if (
    rawTarget.startsWith('native-library:') ||
    rawTarget.startsWith('standalone:') ||
    rawTarget.startsWith('onboarding:')
  ) {
    return rawTarget;
  }

  return `native-library:${rawTarget}`;
}

function isNoteAnchorJumpForWorkspace(
  detail: JumpToNoteAnchorEventDetail | null,
  workspaceId: string,
) {
  return Boolean(detail && resolveNoteAnchorWorkspaceId(detail) === workspaceId);
}

function areReaderTabBridgeStatesEqual(
  left: ReaderTabBridgeState | null | undefined,
  right: ReaderTabBridgeState | null | undefined,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.translating === right.translating &&
    left.translatedCount === right.translatedCount &&
    left.assistantSidebarProps === right.assistantSidebarProps &&
    left.onDetachAssistant === right.onDetachAssistant &&
    left.onAttachAssistant === right.onAttachAssistant &&
    left.onTranslate === right.onTranslate &&
    left.onClearTranslations === right.onClearTranslations &&
    left.onCloudParse === right.onCloudParse &&
    left.onGenerateSummary === right.onGenerateSummary
  );
}

function Reader({ workspaceActive = true }: ReaderProps) {
  const appWindow = getCurrentWindow();
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setHomeTabTitle = useTabsStore((state) => state.setHomeTabTitle);

  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const {
    configHydrated,
    l,
    librarySettings,
    qaModelPresets,
    readerSecrets,
    settings,
    setZoteroLocalDataDir,
    summaryConfigured,
    summaryModelPreset,
    syncNativeLibraryZoteroDir,
    translationModelPreset,
    updateNativeLibrarySettings,
    updateQaModelPreset,
    updateReaderSecret,
    updateSetting,
    addQaModelPreset,
    removeQaModelPreset,
    zoteroLocalDataDir,
  } = useReaderSettings({
    setError,
    setStatusMessage,
  });

  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferredPreferencesSection, setPreferredPreferencesSection] = useState<PreferencesSectionKey | undefined>(undefined);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const [onboardingDemoReveal, setOnboardingDemoReveal] = useState<OnboardingDemoRevealState>(
    EMPTY_ONBOARDING_DEMO_REVEAL,
  );
  const onboardingPreviousThemeModeRef = useRef<'light' | 'dark' | 'system' | null>(null);
  const readerMainRef = useRef<HTMLDivElement | null>(null);

  const [standaloneItems, setStandaloneItems] = useState<WorkspaceItem[]>([]);
  const [nativeLibraryItems, setNativeLibraryItems] = useState<WorkspaceItem[]>([]);
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [readerBridges, setReaderBridges] = useState<Record<string, ReaderTabBridgeState>>({});
  const [readerAssistantActivePanel, setReaderAssistantActivePanel] = useState<AssistantPanelKey>('chat');
  const [readerAssistantDetached, setReaderAssistantDetached] = useState(false);
  const [readerAssistantPanelWidth, setReaderAssistantPanelWidth] = useState(() =>
    loadStoredNumber(ASSISTANT_PANEL_WIDTH_STORAGE_KEY, 408),
  );
  const [readerAssistantPanelResizing, setReaderAssistantPanelResizing] = useState(false);
  const [readerQaSessions, setReaderQaSessions] = useState<DocumentChatSession[]>(() => [
    createQaSession(settings.uiLanguage),
  ]);
  const [readerSelectedQaSessionId, setReaderSelectedQaSessionId] = useState(
    () => readerQaSessions[0]?.id ?? '',
  );
  const [readerQaInput, setReaderQaInput] = useState('');
  const [readerQaAttachments, setReaderQaAttachments] = useState<DocumentChatAttachment[]>([]);
  const [readerSelectedQaPresetId, setReaderSelectedQaPresetId] = useState(settings.qaActivePresetId);
  const [readerQaRagEnabled, setReaderQaRagEnabled] = useState(true);
  const [readerQaAnswerRenderMode, setReaderQaAnswerRenderMode] = useState<DocumentChatRenderMode>('markdown');
  const [readerQaReasoningEffort, setReaderQaReasoningEffort] = useState<ModelReasoningEffort>(
    () => getModelRuntimeConfig(settings, 'qa').reasoningEffort ?? 'auto',
  );
  const [readerQaLoading, setReaderQaLoading] = useState(false);
  const [readerQaError, setReaderQaError] = useState('');
  const [readerNotes, setReaderNotes] = useState<Note[]>([]);
  const [readerActiveNoteId, setReaderActiveNoteId] = useState<string | null>(null);
  const [readerNotesLoading, setReaderNotesLoading] = useState(false);
  const [readerNotesSaving, setReaderNotesSaving] = useState(false);
  const [readerNotesError, setReaderNotesError] = useState('');
  const [pendingNoteAnchorJump, setPendingNoteAnchorJump] =
    useState<JumpToNoteAnchorEventDetail | null>(null);
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  const {
    mineruApiToken,
    translationApiKey,
    summaryApiKey,
    embeddingApiKey,
    zoteroApiKey,
    zoteroUserId,
  } = readerSecrets;

  const createPaperTaskState = useCallback(
    (
      kind: LiteraturePaperTaskKind,
      status: LiteraturePaperTaskState['status'],
      message: string,
      completed?: number | null,
      total?: number | null,
    ) =>
      buildLocalizedPaperTaskState({
        locale: settings.uiLanguage,
        kind,
        status,
        message,
        completed,
        total,
      }),
    [settings.uiLanguage],
  );

  useEffect(() => {
    setHomeTabTitle(getHomeTabTitle(settings.uiLanguage));
  }, [setHomeTabTitle, settings.uiLanguage]);

  useEffect(() => {
    const fallbackPresetId =
      qaModelPresets.find((preset) => preset.id === settings.qaActivePresetId)?.id ??
      qaModelPresets[0]?.id ??
      '';

    if (!fallbackPresetId) {
      return;
    }

    if (qaModelPresets.some((preset) => preset.id === readerSelectedQaPresetId)) {
      return;
    }

    setReaderSelectedQaPresetId(fallbackPresetId);
  }, [qaModelPresets, readerSelectedQaPresetId, settings.qaActivePresetId]);

  useEffect(() => {
    if (readerQaSessions.length === 0) {
      const initialSession = createQaSession(settings.uiLanguage);

      setReaderQaSessions([initialSession]);
      setReaderSelectedQaSessionId(initialSession.id);
      return;
    }

    if (
      !readerSelectedQaSessionId ||
      !readerQaSessions.some((session) => session.id === readerSelectedQaSessionId)
    ) {
      setReaderSelectedQaSessionId(readerQaSessions[0].id);
    }
  }, [readerQaSessions, readerSelectedQaSessionId, settings.uiLanguage]);

  const handleOpenPreferences = useCallback(() => {
    setPreferredPreferencesSection(undefined);
    setPreferencesOpen(true);
  }, []);

  useEffect(() => {
    const handleOpenPreferencesEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenPreferencesEventDetail>).detail;

      setPreferredPreferencesSection(detail?.section);
      setPreferencesOpen(true);
    };

    window.addEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferencesEvent);

    return () => {
      window.removeEventListener(OPEN_PREFERENCES_EVENT, handleOpenPreferencesEvent);
    };
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === 'true') {
        return;
      }
    } catch {
    }

    onboardingPreviousThemeModeRef.current = themeMode;
    setThemeMode('light');
    setOnboardingOpen(true);
  }, [setThemeMode, themeMode]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const workspaceItemMap = useMemo(() => {
    const itemMap = new Map<string, WorkspaceItem>();

    const applyItems = (items: WorkspaceItem[]) => {
      for (const item of items) {
        const existingItem = itemMap.get(item.workspaceId);

        if (!existingItem) {
          itemMap.set(item.workspaceId, item);
          continue;
        }

        itemMap.set(item.workspaceId, {
          ...existingItem,
          ...item,
          localPdfPath: mergeLocalPdfPath(existingItem, item),
        });
      }
    };

    if (onboardingOpen) {
      applyItems([ONBOARDING_WELCOME_ITEM]);
    } else {
      applyItems(standaloneItems);
      applyItems(nativeLibraryItems);
    }

    return itemMap;
  }, [nativeLibraryItems, onboardingOpen, standaloneItems]);

  const allKnownItems = useMemo(
    () => Array.from(workspaceItemMap.values()),
    [workspaceItemMap],
  );

  const readerTabs = useMemo(
    () => tabs.filter((tab): tab is ReaderTab => tab.type === 'reader'),
    [tabs],
  );

  const selectedLibraryItem = useMemo(() => {
    if (!selectedLibraryItemId) {
      return null;
    }

    return workspaceItemMap.get(selectedLibraryItemId) ?? null;
  }, [selectedLibraryItemId, workspaceItemMap]);

  const activeReaderBridge =
    activeTab?.type === 'reader' ? readerBridges[activeTab.id] ?? null : null;
  const activeAssistantSidebarProps =
    workspaceActive && activeReaderBridge ? activeReaderBridge.assistantSidebarProps : null;
  const showReaderAssistantSidebar = Boolean(
    activeAssistantSidebarProps && !readerAssistantDetached,
  );

  useEffect(() => {
    localStorage.setItem(
      ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(readerAssistantPanelWidth)),
    );
  }, [readerAssistantPanelWidth]);

  useEffect(() => {
    if (!readerAssistantPanelResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const mainRect = readerMainRef.current?.getBoundingClientRect();

      if (!mainRect) {
        return;
      }

      const boundedMaxWidth = Math.min(
        MAX_ASSISTANT_PANEL_WIDTH,
        Math.max(MIN_ASSISTANT_PANEL_WIDTH, mainRect.width - 120),
      );
      const nextWidth = Math.round(
        Math.min(
          boundedMaxWidth,
          Math.max(MIN_ASSISTANT_PANEL_WIDTH, mainRect.right - event.clientX),
        ),
      );

      setReaderAssistantPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setReaderAssistantPanelResizing(false);
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
  }, [readerAssistantPanelResizing]);

  const {
    findExistingMineruJson,
    generateLibraryPreview,
    handleLibraryPreviewSync,
    itemParseStatusMap,
    libraryPreviewStates,
    libraryTranslationSnapshots,
    loadLibraryPreviewBlocks,
    saveLibraryMineruParseCache,
    setItemParseStatusMap,
    setLibraryPreviewStates,
    setLibraryTranslationSnapshots,
    syncLibraryParsedState,
    updateLibraryPreviewOperation,
  } = useReaderLibraryPreview({
    activeTabId: workspaceActive ? activeTabId : null,
    allKnownItems,
    createPaperTaskState,
    l,
    onboardingDemoReveal,
    onboardingOpen,
    selectedLibraryItem,
    setError,
    setPreferencesOpen,
    setPreferredPreferencesSection,
    setStatusMessage,
    settings,
    summaryModelPreset,
  });

  const {
    batchMineruPaused,
    batchMineruProgress,
    batchMineruRunning,
    batchSummaryPaused,
    batchSummaryProgress,
    batchSummaryRunning,
    handleBatchGenerateSummaries,
    handleBatchMineruParse,
    handleCancelBatchMineru,
    handleCancelBatchSummary,
    handleNativeLibraryGenerateSummary,
    handleNativeLibraryMineruParse,
    handleNativeLibraryTranslate,
    handleOpenNativeLibraryPaper,
    handleOpenStandalonePdf,
    handleSelectMineruCacheDir,
    handleSelectRemotePdfDownloadDir,
    handleListLlmModels,
    handleTestLlmConnection,
    handleToggleBatchMineruPause,
    handleToggleBatchSummaryPause,
    handleWindowClose,
    handleWindowMinimize,
    handleWindowToggleMaximize,
    handleWorkspaceItemResolved,
    nativePaperActionStates,
  } = useReaderLibraryActions({
    allKnownItems,
    appWindow,
    configHydrated,
    createPaperTaskState,
    findExistingMineruJson,
    generateLibraryPreview,
    itemParseStatusMap,
    l,
    libraryPreviewStates,
    loadLibraryPreviewBlocks,
    libraryTranslationSnapshots,
    mineruApiToken,
    settings,
    setError,
    setLibraryPreviewStates,
    setLibraryTranslationSnapshots,
    setNativeLibraryItems,
    setPreferencesOpen,
    setPreferredPreferencesSection,
    setSelectedLibraryItemId,
    setStandaloneItems,
    setStatusMessage,
    summaryConfigured,
    syncLibraryParsedState,
    translationModelPreset,
    updateLibraryPreviewOperation,
    updateSetting,
    saveLibraryMineruParseCache,
    openTab,
  });

  const handleReaderZoteroUserIdChange = useCallback(
    (value: string) => updateReaderSecret('zoteroUserId', value),
    [updateReaderSecret],
  );

  const handleReaderQaActivePresetChange = useCallback(
    (presetId: string) => updateSetting('qaActivePresetId', presetId),
    [updateSetting],
  );

  const handleReaderOpenStandalonePdf = useCallback(() => {
    void handleOpenStandalonePdf();
  }, [handleOpenStandalonePdf]);

  const handleReaderTranslationDisplayModeChange = useCallback(
    (mode: TranslationDisplayMode) => updateSetting('translationDisplayMode', mode),
    [updateSetting],
  );

  const translationTargetLanguageLabel = useMemo(
    () => resolveLanguageLabel(settings.uiLanguage, settings.translationTargetLanguage),
    [settings.translationTargetLanguage, settings.uiLanguage],
  );

  const handlePendingNoteAnchorJumpHandled = useCallback((requestId?: string) => {
    setPendingNoteAnchorJump((current) =>
      !requestId || current?.requestId === requestId ? null : current,
    );
  }, []);

  const {
    handleDetectLocalZotero,
    handleImportLocalZoteroToNativeLibrary,
    handleReloadLocalZotero,
    handleSelectLocalZoteroDir,
  } = useReaderZoteroSync({
    l,
    zoteroLocalDataDir,
    setZoteroLocalDataDir,
    setLibraryLoading,
    setError,
    setStatusMessage,
    syncNativeLibraryZoteroDir,
  });

  const handleSelectLibraryStorageDir = useCallback(async () => {
    const directory = await selectDirectory(
      l('选择默认文献存储文件夹', 'Select the default paper storage folder'),
    );

    if (!directory) {
      return;
    }

    await updateNativeLibrarySettings(
      { storageDir: directory },
      'reader-library-storage-dir',
    );
  }, [l, updateNativeLibrarySettings]);

  const activeLibraryPreviewState = selectedLibraryItem
    ? libraryPreviewStates[selectedLibraryItem.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE
    : EMPTY_LIBRARY_PREVIEW_STATE;

  const onboardingDemoItem = onboardingOpen
    ? ONBOARDING_WELCOME_ITEM
    : selectedLibraryItem ?? allKnownItems[0] ?? null;
  const onboardingDemoTabId = onboardingDemoItem
    ? readerTabs.find((tab) => tab.documentId === onboardingDemoItem.workspaceId)?.id ?? null
    : null;
  const onboardingWorkspaceStage = onboardingOpen
    ? onboardingStepIndex === ONBOARDING_READER_OVERVIEW_STEP
      ? 'overview'
      : onboardingStepIndex >= ONBOARDING_READER_READING_START_STEP &&
          onboardingStepIndex <= ONBOARDING_READER_READING_END_STEP
        ? 'reading'
        : null
    : null;
  const onboardingDemoItemId = onboardingDemoItem?.workspaceId ?? null;
  const onboardingDemoItemTitle = onboardingDemoItem?.title ?? '';
  const onboardingExistingTabId = onboardingDemoItemId
    ? readerTabs.find((tab) => tab.documentId === onboardingDemoItemId)?.id ?? null
    : null;
  const selectedItemIsOnboardingWelcome = isOnboardingWelcomeItem(selectedLibraryItem);
  const displayedLibraryPreviewState = selectedItemIsOnboardingWelcome && onboardingOpen
    ? {
        ...activeLibraryPreviewState,
        summary: onboardingDemoReveal.summarized ? activeLibraryPreviewState.summary : null,
        hasBlocks: onboardingDemoReveal.parsed && activeLibraryPreviewState.hasBlocks,
        blockCount: onboardingDemoReveal.parsed ? activeLibraryPreviewState.blockCount : 0,
        currentPdfName: activeLibraryPreviewState.currentPdfName || 'welcome.pdf',
        currentJsonName: onboardingDemoReveal.parsed
          ? activeLibraryPreviewState.currentJsonName || 'content_list_v2.json'
          : l('尚未解析', 'Not parsed yet'),
        statusMessage: onboardingDemoReveal.parsed
          ? onboardingDemoReveal.translated
            ? l(
                'Welcome 演示文档已显示内置解析和全文翻译结果，可以继续查看概览或进入阅读器。',
                'The Welcome demo now shows the built-in parse and full-translation results. Continue to the overview or open the reader.',
              )
            : activeLibraryPreviewState.statusMessage ||
              l(
                '已显示内置 MinerU 解析结果。下一步可以点击全文翻译显示内置译文。',
                'The built-in MinerU parse result is visible. Next, click Translate Document to reveal the bundled translation.',
              )
          : l(
              '这是新手引导内置的 Welcome 文档。请按引导先点击 MinerU 解析，解析结果会立即显示，不会调用 API。',
              'This is the built-in Welcome document for onboarding. Follow the guide and click MinerU Parse first; the result appears instantly without calling any API.',
            ),
        loading: false,
        error: '',
      }
    : activeLibraryPreviewState;

  const onboardingDemoLibrary = useMemo(() => {
    const demoCategoryId = 'onboarding-demo-category';
    const summaryText =
      onboardingDemoReveal.summarized && displayedLibraryPreviewState.summary
        ? formatPaperSummaryForLibrary(displayedLibraryPreviewState.summary)
        : null;
    const demoSettings: LibrarySettings = {
      storageDir: '',
      zoteroLocalDataDir: zoteroLocalDataDir,
      importMode: 'copy',
      autoRenameFiles: true,
      fileNamingRule: '{author}_{year}_{title}',
      createCategoryFolders: false,
      folderWatchEnabled: false,
      backupEnabled: false,
      preserveOriginalPath: true,
      openAlexEnabled: true,
      openAlexApiKey: '',
      openAlexMailto: '',
    };
    const demoCategories: LiteratureCategory[] = [
      {
        id: 'onboarding-system-all',
        name: l('全部文献', 'All Papers'),
        parentId: null,
        sortOrder: 0,
        isSystem: true,
        systemKey: 'all',
        createdAt: 0,
        updatedAt: 0,
        paperCount: 1,
      },
      {
        id: 'onboarding-system-recent',
        name: l('最近导入', 'Recently Imported'),
        parentId: null,
        sortOrder: 1,
        isSystem: true,
        systemKey: 'recent',
        createdAt: 0,
        updatedAt: 0,
        paperCount: 1,
      },
      {
        id: demoCategoryId,
        name: l('新手引导', 'Onboarding'),
        parentId: null,
        sortOrder: 2,
        isSystem: false,
        systemKey: null,
        createdAt: 0,
        updatedAt: 0,
        paperCount: 1,
      },
    ];
    const demoPaper: LiteraturePaper = {
      id: ONBOARDING_WELCOME_ITEM.workspaceId,
      title: ONBOARDING_WELCOME_ITEM.title,
      year: '2026',
      publication: l('PaperQuay 内置文档', 'PaperQuay Built-in Document'),
      doi: null,
      url: null,
      abstractText: l(
        '这是一篇随软件打包的 Welcome 演示文档，用于展示导入、MinerU 解析、全文翻译、AI 概览和阅读器跳转流程。',
        'This bundled Welcome document demonstrates import, MinerU parsing, full translation, AI overview, and reader navigation.',
      ),
      keywords: ['PaperQuay', 'Onboarding', 'AI Reading'],
      importedAt: 0,
      updatedAt: 0,
      lastReadAt: null,
      readingProgress: 0,
      isFavorite: false,
      userNote: null,
      aiSummary: summaryText,
      citation: null,
      source: 'onboarding',
      sortOrder: 0,
      authors: [
        {
          id: 'onboarding-author',
          name: 'PaperQuay',
          givenName: null,
          familyName: null,
          sortOrder: 0,
        },
      ],
      tags: [
        {
          id: 'onboarding-tag-demo',
          name: l('演示', 'Demo'),
          color: '#2dd4bf',
        },
      ],
      categoryIds: [demoCategoryId],
      attachments: [
        {
          id: 'onboarding-welcome-pdf',
          paperId: ONBOARDING_WELCOME_ITEM.workspaceId,
          kind: 'pdf',
          originalPath: null,
          storedPath: ONBOARDING_WELCOME_ITEM.localPdfPath ?? '/onboarding/welcome.pdf',
          relativePath: null,
          fileName: 'welcome.pdf',
          mimeType: 'application/pdf',
          fileSize: 0,
          contentHash: null,
          createdAt: 0,
          missing: false,
        },
      ],
    };

    return {
      settings: demoSettings,
      categories: demoCategories,
      papers: [demoPaper],
      statusMessage: displayedLibraryPreviewState.statusMessage,
      paperStatuses: {
        [demoPaper.id]: {
          mineruParsed: onboardingDemoReveal.parsed,
          overviewGenerated: onboardingDemoReveal.summarized,
          checkingMineru: false,
        },
      },
    };
  }, [
    displayedLibraryPreviewState.statusMessage,
    displayedLibraryPreviewState.summary,
    l,
    onboardingDemoReveal.parsed,
    onboardingDemoReveal.summarized,
    zoteroLocalDataDir,
  ]);

  const onboardingPaperActionStates = useMemo(
    () => ({
      [ONBOARDING_WELCOME_ITEM.workspaceId]: displayedLibraryPreviewState.operation,
    }),
    [displayedLibraryPreviewState.operation],
  );

  const markOnboardingSeen = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, 'true');
    } catch {
    }
  }, []);

  const handleOpenOnboarding = useCallback(() => {
    if (!onboardingOpen) {
      onboardingPreviousThemeModeRef.current = themeMode;
    }
    setThemeMode('light');
    setPreferencesOpen(false);
    setActiveTab(HOME_TAB_ID);
    setOnboardingStepIndex(0);
    setOnboardingDemoReveal(EMPTY_ONBOARDING_DEMO_REVEAL);
    setLibraryPreviewStates((current) => {
      const next = { ...current };
      delete next[ONBOARDING_WELCOME_ITEM.workspaceId];
      return next;
    });
    setItemParseStatusMap((current) => ({
      ...current,
      [ONBOARDING_WELCOME_ITEM.workspaceId]: false,
    }));
    setOnboardingOpen(true);
  }, [onboardingOpen, setActiveTab, setItemParseStatusMap, setLibraryPreviewStates, setThemeMode, themeMode]);

  const handleCloseOnboarding = useCallback(() => {
    markOnboardingSeen();
    setOnboardingOpen(false);
    const previousThemeMode = onboardingPreviousThemeModeRef.current;
    onboardingPreviousThemeModeRef.current = null;
    if (previousThemeMode && previousThemeMode !== 'light') {
      setThemeMode(previousThemeMode);
    }
  }, [markOnboardingSeen, setThemeMode]);

  const handleFinishOnboarding = useCallback(() => {
    setStandaloneItems((current) => {
      const existingItems = current.filter(
        (item) => item.workspaceId !== WELCOME_STANDALONE_ITEM.workspaceId,
      );

      return [WELCOME_STANDALONE_ITEM, ...existingItems];
    });
    setSelectedLibraryItemId(WELCOME_STANDALONE_ITEM.workspaceId);
    handleCloseOnboarding();
  }, [handleCloseOnboarding]);

  const handleOnboardingStepChange = useCallback((nextStepIndex: number) => {
    setOnboardingStepIndex(nextStepIndex);
  }, []);

  useEffect(() => {
    if (!onboardingOpen) {
      return;
    }

    if (selectedLibraryItemId !== ONBOARDING_WELCOME_ITEM.workspaceId) {
      setSelectedLibraryItemId(ONBOARDING_WELCOME_ITEM.workspaceId);
    }

    if (onboardingStepIndex < ONBOARDING_SETTINGS_STEP) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
      return;
    }

    if (onboardingStepIndex === ONBOARDING_SETTINGS_STEP) {
      setActiveTab(HOME_TAB_ID);
      setPreferredPreferencesSection('library');
      setPreferencesOpen(true);
      return;
    }

    if (
      onboardingStepIndex >= ONBOARDING_LIBRARY_START_STEP &&
      onboardingStepIndex <= ONBOARDING_LIBRARY_END_STEP
    ) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
      if (!selectedLibraryItemId && onboardingDemoItemId) {
        setSelectedLibraryItemId(onboardingDemoItemId);
      }
      return;
    }

    if (
      onboardingStepIndex >= ONBOARDING_READER_READING_START_STEP &&
      onboardingStepIndex <= ONBOARDING_READER_OVERVIEW_STEP
    ) {
      setPreferencesOpen(false);
      if (!onboardingDemoItemId) {
        setActiveTab(HOME_TAB_ID);
        return;
      }

      if (selectedLibraryItemId !== onboardingDemoItemId) {
        setSelectedLibraryItemId(onboardingDemoItemId);
      }

      const nextTabId = onboardingExistingTabId ?? openTab(onboardingDemoItemId, onboardingDemoItemTitle);
      setActiveTab(nextTabId);
      return;
    }

    if (onboardingStepIndex >= ONBOARDING_AGENT_STEP) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
    }
  }, [
    onboardingDemoItemId,
    onboardingDemoItemTitle,
    onboardingExistingTabId,
    onboardingOpen,
    onboardingStepIndex,
    openTab,
    selectedLibraryItemId,
    setActiveTab,
  ]);

  const handleBridgeStateChange = useCallback((tabId: string, bridge: ReaderTabBridgeState | null) => {
    setReaderBridges((current) => {
      if (!bridge) {
        if (!(tabId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[tabId];
        return next;
      }

      if (areReaderTabBridgeStatesEqual(current[tabId], bridge)) {
        return current;
      }

      return {
        ...current,
        [tabId]: bridge,
      };
    });
  }, []);

  const revealOnboardingWelcomeParse = useCallback(() => {
    setSelectedLibraryItemId(ONBOARDING_WELCOME_ITEM.workspaceId);
    setOnboardingDemoReveal((current) => ({ ...current, parsed: true }));
    setLibraryPreviewStates((current) => ({
      ...current,
      [ONBOARDING_WELCOME_ITEM.workspaceId]: {
        ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
        loading: false,
        error: '',
        operation: createPaperTaskState(
          'mineru',
          'success',
          l('已显示内置 MinerU 解析结果', 'Displayed the built-in MinerU parse result'),
          100,
          100,
        ),
        currentPdfName: 'welcome.pdf',
        currentJsonName: 'content_list_v2.json',
        statusMessage: l(
          '已显示内置 MinerU 解析结果。这个演示没有调用 API。',
          'Displayed the built-in MinerU parse result without calling an API.',
        ),
      },
    }));
    void generateLibraryPreview(ONBOARDING_WELCOME_ITEM, false, { allowGenerate: false });
  }, [createPaperTaskState, generateLibraryPreview, l, setLibraryPreviewStates]);

  const revealOnboardingWelcomeTranslation = useCallback(() => {
    setSelectedLibraryItemId(ONBOARDING_WELCOME_ITEM.workspaceId);
    setOnboardingDemoReveal((current) => ({ ...current, parsed: true, translated: true }));
    setLibraryPreviewStates((current) => ({
      ...current,
      [ONBOARDING_WELCOME_ITEM.workspaceId]: {
        ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
        loading: false,
        error: '',
        operation: createPaperTaskState(
          'translation',
          'success',
          l('已显示内置全文翻译', 'Displayed the built-in full translation'),
          100,
          100,
        ),
        currentPdfName: 'welcome.pdf',
        currentJsonName: 'content_list_v2.json',
        statusMessage: l(
          '已显示 Welcome 内置全文翻译。这个演示没有调用 API。',
          'Displayed the built-in Welcome full translation without calling an API.',
        ),
      },
    }));
    void generateLibraryPreview(ONBOARDING_WELCOME_ITEM, false, { allowGenerate: false });
  }, [createPaperTaskState, generateLibraryPreview, l, setLibraryPreviewStates]);

  const revealOnboardingWelcomeSummary = useCallback(async () => {
    setOnboardingDemoReveal((current) => ({ ...current, parsed: true, summarized: true }));

    try {
      const previewContext = await loadLibraryPreviewBlocks(ONBOARDING_WELCOME_ITEM);
      const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`);
      const parsed = response.ok ? (await response.json()) as Partial<SummaryCacheEnvelope> : null;
      const summary = parsed?.summary ?? null;

      setLibraryPreviewStates((current) => ({
        ...current,
        [ONBOARDING_WELCOME_ITEM.workspaceId]: {
          ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          summary,
          loading: false,
          error: '',
          operation: createPaperTaskState(
            'overview',
            'success',
            l('已显示内置 AI 概览', 'Displayed the built-in AI overview'),
            100,
            100,
          ),
          hasBlocks: true,
          blockCount: previewContext.blocks.length,
          currentPdfName: 'welcome.pdf',
          currentJsonName: 'content_list_v2.json',
          statusMessage: l(
            '已显示 Welcome 内置 AI 概览。这个演示结果来自随软件打包的数据，没有调用 API。',
            'Displayed the built-in Welcome AI overview. This demo result is bundled with the app and did not call any API.',
          ),
          sourceKey: parsed?.sourceKey || 'onboarding:welcome::summary',
        },
      }));
    } catch (nextError) {
      setLibraryPreviewStates((current) => ({
        ...current,
        [ONBOARDING_WELCOME_ITEM.workspaceId]: {
          ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: false,
          error: nextError instanceof Error ? nextError.message : l('加载内置概览失败', 'Failed to load the built-in overview'),
          statusMessage: l('加载内置概览失败', 'Failed to load the built-in overview'),
        },
      }));
    }
  }, [createPaperTaskState, l, loadLibraryPreviewBlocks, setLibraryPreviewStates]);

  const handleOpenOnboardingDemoPaper = useCallback(() => {
    setSelectedLibraryItemId(ONBOARDING_WELCOME_ITEM.workspaceId);
    openTab(ONBOARDING_WELCOME_ITEM.workspaceId, ONBOARDING_WELCOME_ITEM.title);
  }, [openTab]);

  const handleOnboardingDemoGenerateSummary = useCallback(() => {
    void revealOnboardingWelcomeSummary();
  }, [revealOnboardingWelcomeSummary]);

  const openNoteAnchorJump = useCallback(
    async (detail: JumpToNoteAnchorEventDetail) => {
      const workspaceId = resolveNoteAnchorWorkspaceId(detail);

      if (!workspaceId) {
        const message = l('该引用没有关联文献，无法定位', 'This reference is not linked to a paper.');
        setError(message);
        setStatusMessage(message);
        return;
      }

      const pendingDetail: JumpToNoteAnchorEventDetail = {
        ...detail,
        targetPaperId: workspaceId,
      };

      const existingItem = workspaceItemMap.get(workspaceId);
      if (existingItem) {
        setSelectedLibraryItemId(existingItem.workspaceId);
        openTab(existingItem.workspaceId, existingItem.title);
        setPendingNoteAnchorJump(pendingDetail);
        return;
      }

      if (!workspaceId.startsWith('native-library:')) {
        const message = l('暂不支持自动打开该引用来源', 'This reference source cannot be opened automatically yet.');
        setError(message);
        setStatusMessage(message);
        return;
      }

      const paperId = workspaceId.slice('native-library:'.length);

      try {
        const papers = await listLibraryPapers({ limit: 1000, sortBy: 'updatedAt', sortDirection: 'desc' });
        const paper = papers.find((item) => item.id === paperId);
        const workspaceItem = paper ? createNativeLibraryWorkspaceItem(paper) : null;

        if (!workspaceItem) {
          const message = l('没有找到该引用对应的可打开 PDF', 'No openable PDF was found for this reference.');
          setError(message);
          setStatusMessage(message);
          return;
        }

        setNativeLibraryItems((current) => [
          workspaceItem,
          ...current.filter((item) => item.workspaceId !== workspaceItem.workspaceId),
        ]);
        setSelectedLibraryItemId(workspaceItem.workspaceId);
        openTab(workspaceItem.workspaceId, workspaceItem.title);
        setPendingNoteAnchorJump(pendingDetail);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('打开引用来源失败', 'Failed to open the reference source.');
        setError(message);
        setStatusMessage(message);
      }
    },
    [l, openTab, setError, setNativeLibraryItems, setSelectedLibraryItemId, setStatusMessage, workspaceItemMap],
  );

  useEffect(() => {
    if (!configHydrated) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void syncNativeLibraryZoteroDir(zoteroLocalDataDir, 'reader-zotero-input');
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [configHydrated, syncNativeLibraryZoteroDir, zoteroLocalDataDir]);

  useEffect(() => {
    const handleOpenStandalonePdfEvent = () => {
      void handleOpenStandalonePdf();
    };
    const handleOpenOnboardingEvent = () => {
      handleOpenOnboarding();
    };
    const handleJumpToNoteAnchorEvent = (event: Event) => {
      const detail = (event as CustomEvent<JumpToNoteAnchorEventDetail>).detail;
      if (!detail?.noteId || !detail.anchorId) {
        return;
      }

      void openNoteAnchorJump(detail);
    };

    window.addEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
    window.addEventListener(OPEN_ONBOARDING_EVENT, handleOpenOnboardingEvent);
    window.addEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);

    return () => {
      window.removeEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
      window.removeEventListener(OPEN_ONBOARDING_EVENT, handleOpenOnboardingEvent);
      window.removeEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);
    };
  }, [handleOpenOnboarding, handleOpenStandalonePdf, openNoteAnchorJump]);

  useEffect(() => {
    if (!workspaceActive) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && preferencesOpen) {
        setPreferencesOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferencesOpen, workspaceActive]);

  return (
    <AppLocaleProvider value={settings.uiLanguage}>
      <div className="relative h-full min-h-0 overflow-hidden bg-[#f4f4f4] text-[#202124] dark:bg-[#121212] dark:text-[#e8e8e8]">
        <div className="flex h-full min-h-0 flex-col bg-[#f7f7f7] dark:bg-[#181818]">
          <main ref={readerMainRef} className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
              <div
                className="h-full min-h-0 overflow-hidden"
                hidden={!workspaceActive || activeTabId !== HOME_TAB_ID}
              >
                <LiteratureLibraryView
                  onOpenPaper={onboardingOpen ? handleOpenOnboardingDemoPaper : handleOpenNativeLibraryPaper}
                  mineruCacheDir={settings.mineruCacheDir}
                  autoLoadSiblingJson={settings.autoLoadSiblingJson}
                  showReadingHeatmap={settings.showLibraryReadingHeatmap}
                  demoLibrary={onboardingOpen ? onboardingDemoLibrary : null}
                  onRunMineruParse={onboardingOpen ? revealOnboardingWelcomeParse : handleNativeLibraryMineruParse}
                  onTranslatePaper={onboardingOpen ? revealOnboardingWelcomeTranslation : handleNativeLibraryTranslate}
                  onGenerateSummary={onboardingOpen ? handleOnboardingDemoGenerateSummary : handleNativeLibraryGenerateSummary}
                  paperActionStates={onboardingOpen ? onboardingPaperActionStates : nativePaperActionStates}
                />
              </div>

              {readerTabs.map((tab) => {
              const item = workspaceItemMap.get(tab.documentId);

              if (!item) {
                return null;
              }

              return (
                <div key={tab.id} className="h-full min-h-0 overflow-hidden" hidden={tab.id !== activeTabId}>
                  <DocumentReaderTab
                    tabId={tab.id}
                    document={item}
                    isActive={workspaceActive && tab.id === activeTabId}
                    settings={settings}
                    zoteroLocalDataDir={zoteroLocalDataDir}
                    mineruApiToken={mineruApiToken}
                    translationApiKey={translationApiKey}
                    summaryApiKey={summaryApiKey}
                    embeddingApiKey={embeddingApiKey}
                    qaModelPresets={qaModelPresets}
                    zoteroApiKey={zoteroApiKey}
                    zoteroUserId={zoteroUserId}
                    onZoteroUserIdChange={handleReaderZoteroUserIdChange}
                    onQaActivePresetChange={handleReaderQaActivePresetChange}
                    onDocumentResolved={handleWorkspaceItemResolved}
                    onLibraryPreviewSync={handleLibraryPreviewSync}
                    onOpenPreferences={handleOpenPreferences}
                    onOpenStandalonePdf={handleReaderOpenStandalonePdf}
                    onBridgeStateChange={handleBridgeStateChange}
                    onTranslationDisplayModeChange={handleReaderTranslationDisplayModeChange}
                    translationTargetLanguageLabel={translationTargetLanguageLabel}
                    assistantActivePanel={readerAssistantActivePanel}
                    setAssistantActivePanel={setReaderAssistantActivePanel}
                    assistantDetached={readerAssistantDetached}
                    setAssistantDetached={setReaderAssistantDetached}
                    qaSessions={readerQaSessions}
                    setQaSessions={setReaderQaSessions}
                    selectedQaSessionId={readerSelectedQaSessionId}
                    setSelectedQaSessionId={setReaderSelectedQaSessionId}
                    qaInput={readerQaInput}
                    setQaInput={setReaderQaInput}
                    qaAttachments={readerQaAttachments}
                    setQaAttachments={setReaderQaAttachments}
                    selectedQaPresetId={readerSelectedQaPresetId}
                    setSelectedQaPresetId={setReaderSelectedQaPresetId}
                    qaRagEnabled={readerQaRagEnabled}
                    setQaRagEnabled={setReaderQaRagEnabled}
                    qaAnswerRenderMode={readerQaAnswerRenderMode}
                    setQaAnswerRenderMode={setReaderQaAnswerRenderMode}
                    qaReasoningEffort={readerQaReasoningEffort}
                    setQaReasoningEffort={setReaderQaReasoningEffort}
                    qaLoading={readerQaLoading}
                    setQaLoading={setReaderQaLoading}
                    qaError={readerQaError}
                    setQaError={setReaderQaError}
                    notes={readerNotes}
                    setNotes={setReaderNotes}
                    activeNoteId={readerActiveNoteId}
                    setActiveNoteId={setReaderActiveNoteId}
                    notesLoading={readerNotesLoading}
                    setNotesLoading={setReaderNotesLoading}
                    notesSaving={readerNotesSaving}
                    setNotesSaving={setReaderNotesSaving}
                    notesError={readerNotesError}
                    setNotesError={setReaderNotesError}
                    pendingNoteAnchorJump={
                      isNoteAnchorJumpForWorkspace(pendingNoteAnchorJump, item.workspaceId)
                        ? pendingNoteAnchorJump
                        : null
                    }
                    onPendingNoteAnchorJumpHandled={handlePendingNoteAnchorJumpHandled}
                    translationSnapshot={libraryTranslationSnapshots[item.workspaceId] ?? null}
                    onboardingWorkspaceStage={
                      tab.id === activeTabId && tab.id === onboardingDemoTabId
                        ? onboardingWorkspaceStage
                        : null
                    }
                    onboardingDemoReveal={
                      tab.id === onboardingDemoTabId ? onboardingDemoReveal : undefined
                    }
                  />
                </div>
              );
              })}
            </div>

            {showReaderAssistantSidebar && activeAssistantSidebarProps ? (
              <>
                {activeAssistantSidebarProps.activePanel ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={l('调整问答侧栏宽度', 'Resize assistant sidebar')}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setReaderAssistantPanelResizing(true);
                    }}
                    className="group relative z-20 ml-auto w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
                  >
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/90 transition-all duration-200 group-hover:w-[3px] group-hover:bg-slate-400" />
                    <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-all duration-200 group-hover:w-1.5 group-hover:bg-slate-500" />
                  </div>
                ) : null}

                <aside className="flex min-h-0 shrink-0 self-stretch transition-all duration-300">
                  <AssistantSidebar
                    {...activeAssistantSidebarProps}
                    panelWidth={readerAssistantPanelWidth}
                    chatLayoutMode="compact"
                    onDetach={activeReaderBridge?.onDetachAssistant}
                  />
                </aside>
              </>
            ) : null}
          </main>
        </div>

        <OnboardingGuide
          open={onboardingOpen}
          language={settings.uiLanguage}
          stepIndex={onboardingStepIndex}
          onStepIndexChange={handleOnboardingStepChange}
          onClose={handleCloseOnboarding}
          onFinish={handleFinishOnboarding}
        />

        <ReaderPreferencesWindow
          open={preferencesOpen}
          onClose={() => setPreferencesOpen(false)}
          preferredSection={preferredPreferencesSection}
          settings={settings}
          librarySettings={librarySettings}
          zoteroLocalDataDir={zoteroLocalDataDir}
          mineruApiToken={mineruApiToken}
          translationApiKey={translationApiKey}
          summaryApiKey={summaryApiKey}
          embeddingApiKey={embeddingApiKey}
          qaModelPresets={qaModelPresets}
          zoteroApiKey={zoteroApiKey}
          zoteroUserId={zoteroUserId}
          libraryLoading={libraryLoading}
          translating={activeReaderBridge?.translating ?? false}
          translatedCount={activeReaderBridge?.translatedCount ?? 0}
          onSettingChange={updateSetting}
          onNativeLibrarySettingsChange={(patch) => void updateNativeLibrarySettings(patch)}
          onSelectLibraryStorageDir={() => void handleSelectLibraryStorageDir()}
          onZoteroLocalDataDirChange={setZoteroLocalDataDir}
          onMineruApiTokenChange={(value) => updateReaderSecret('mineruApiToken', value)}
          onTranslationApiKeyChange={(value) => updateReaderSecret('translationApiKey', value)}
          onSummaryApiKeyChange={(value) => updateReaderSecret('summaryApiKey', value)}
          onEmbeddingApiKeyChange={(value) => updateReaderSecret('embeddingApiKey', value)}
          onZoteroApiKeyChange={(value) => updateReaderSecret('zoteroApiKey', value)}
          onZoteroUserIdChange={(value) => updateReaderSecret('zoteroUserId', value)}
          onDetectLocalZotero={() => void handleDetectLocalZotero()}
          onSelectLocalZoteroDir={() => void handleSelectLocalZoteroDir()}
          onReloadLocalZotero={() => void handleReloadLocalZotero()}
          onImportLocalZotero={() => void handleImportLocalZoteroToNativeLibrary()}
          onEnrichAllLibraryMetadata={emitLibraryMetadataEnrichRequest}
          onSelectMineruCacheDir={() => void handleSelectMineruCacheDir()}
          onSelectRemotePdfDownloadDir={() => void handleSelectRemotePdfDownloadDir()}
          onListLlmModels={handleListLlmModels}
          onTestLlmConnection={handleTestLlmConnection}
          onQaModelPresetAdd={addQaModelPreset}
          onQaModelPresetRemove={removeQaModelPreset}
          onQaModelPresetChange={updateQaModelPreset}
          onTranslate={activeReaderBridge?.onTranslate}
          onClearTranslations={activeReaderBridge?.onClearTranslations}
          onBatchMineruParse={() => void handleBatchMineruParse()}
          onBatchGenerateSummaries={() => void handleBatchGenerateSummaries()}
          onToggleBatchMineruPause={handleToggleBatchMineruPause}
          onCancelBatchMineru={handleCancelBatchMineru}
          onToggleBatchSummaryPause={handleToggleBatchSummaryPause}
          onCancelBatchSummary={handleCancelBatchSummary}
          batchMineruRunning={batchMineruRunning}
          batchSummaryRunning={batchSummaryRunning}
          batchMineruPaused={batchMineruPaused}
          batchSummaryPaused={batchSummaryPaused}
          batchMineruProgress={batchMineruProgress}
          batchSummaryProgress={batchSummaryProgress}
        />
      </div>
    </AppLocaleProvider>
  );
}

export default Reader;
