import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import TabBar from '../../components/tabs/TabBar';
import { OPEN_PREFERENCES_EVENT, type OpenPreferencesEventDetail } from '../../app/appEvents';
import { AppLocaleProvider } from '../../i18n/uiLanguage';
import { getHomeTabTitle, HOME_TAB_ID, type ReaderTab, useTabsStore } from '../../stores/useTabsStore';
import { useThemeStore } from '../../stores/useThemeStore';
import type {
  ReaderTabBridgeState,
} from './documentReaderShared';
import type {
  LiteratureCategory,
  LiteraturePaper,
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
  LibrarySettings,
} from '../../types/library';
import type {
  WorkspaceItem,
} from '../../types/reader';
import DocumentReaderTab from './DocumentReaderTab';
import LiteratureLibraryView from '../literature/LiteratureLibraryView';
import OnboardingGuide from './OnboardingGuide';
import ReaderPreferencesWindow from './ReaderPreferencesWindow';
import ReaderShellHeader from './ReaderShellHeader';
import { useReaderLibraryActions } from './useReaderLibraryActions';
import { useReaderLibraryPreview } from './useReaderLibraryPreview';
import { useReaderSettings } from './useReaderSettings';
import { useReaderZoteroSync } from './useReaderZoteroSync';
import {
  buildPaperTaskState as buildLocalizedPaperTaskState,
} from './paperTaskState';
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
  resolveLanguageLabel,
  WELCOME_STANDALONE_ITEM,
  type OnboardingDemoRevealState,
  type PreferencesSectionKey,
  type SummaryCacheEnvelope,
} from './readerShared';

function Reader() {
  const appWindow = getCurrentWindow();
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setHomeTabTitle = useTabsStore((state) => state.setHomeTabTitle);

  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const {
    configHydrated,
    l,
    qaModelPresets,
    readerSecrets,
    settings,
    setZoteroLocalDataDir,
    summaryConfigured,
    summaryModelPreset,
    syncNativeLibraryZoteroDir,
    translationModelPreset,
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

  const [standaloneItems, setStandaloneItems] = useState<WorkspaceItem[]>([]);
  const [nativeLibraryItems, setNativeLibraryItems] = useState<WorkspaceItem[]>([]);
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [readerBridges, setReaderBridges] = useState<Record<string, ReaderTabBridgeState>>({});
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
    activeTabId,
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && preferencesOpen) {
        setPreferencesOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferencesOpen]);

  return (
    <AppLocaleProvider value={settings.uiLanguage}>
      <div className="relative h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] text-slate-900 dark:bg-chrome-950 dark:text-chrome-100">
        <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/70 bg-white/55 shadow-[0_26px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/8 dark:bg-chrome-950 dark:shadow-none">
          <ReaderShellHeader
            l={l}
            themeMode={themeMode}
            onOpenStandalonePdf={() => void handleOpenStandalonePdf()}
            onOpenOnboarding={handleOpenOnboarding}
            onOpenPreferences={handleOpenPreferences}
            onCycleThemeMode={() => {
              const next: Record<'light' | 'dark' | 'system', 'light' | 'dark' | 'system'> = {
                light: 'dark',
                dark: 'system',
                system: 'light',
              };
              setThemeMode(next[themeMode]);
            }}
            onWindowMinimize={handleWindowMinimize}
            onWindowToggleMaximize={handleWindowToggleMaximize}
            onWindowClose={handleWindowClose}
          />

          <div data-tour="reader-tabs">
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={setActiveTab}
              onClose={closeTab}
            />
          </div>

          <main className="relative min-h-0 flex-1 overflow-hidden">
            <div className="h-full min-h-0 overflow-hidden" hidden={activeTabId !== HOME_TAB_ID}>
              <LiteratureLibraryView
                onOpenPaper={onboardingOpen ? handleOpenOnboardingDemoPaper : handleOpenNativeLibraryPaper}
                onOpenSettings={handleOpenPreferences}
                mineruCacheDir={settings.mineruCacheDir}
                autoLoadSiblingJson={settings.autoLoadSiblingJson}
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
                    isActive={tab.id === activeTabId}
                    settings={settings}
                    zoteroLocalDataDir={zoteroLocalDataDir}
                    mineruApiToken={mineruApiToken}
                    translationApiKey={translationApiKey}
                    summaryApiKey={summaryApiKey}
                    embeddingApiKey={embeddingApiKey}
                    qaModelPresets={qaModelPresets}
                    zoteroApiKey={zoteroApiKey}
                    zoteroUserId={zoteroUserId}
                    onZoteroUserIdChange={(value) => updateReaderSecret('zoteroUserId', value)}
                    onQaActivePresetChange={(presetId) => updateSetting('qaActivePresetId', presetId)}
                    onDocumentResolved={handleWorkspaceItemResolved}
                    onLibraryPreviewSync={handleLibraryPreviewSync}
                    onOpenPreferences={handleOpenPreferences}
                    onOpenStandalonePdf={() => void handleOpenStandalonePdf()}
                    onBridgeStateChange={handleBridgeStateChange}
                    onTranslationDisplayModeChange={(mode) => updateSetting('translationDisplayMode', mode)}
                    translationTargetLanguageLabel={resolveLanguageLabel(
                      settings.uiLanguage,
                      settings.translationTargetLanguage,
                    )}
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
          onSelectMineruCacheDir={() => void handleSelectMineruCacheDir()}
          onSelectRemotePdfDownloadDir={() => void handleSelectRemotePdfDownloadDir()}
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
