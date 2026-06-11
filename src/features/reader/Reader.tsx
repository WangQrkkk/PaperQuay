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
  OPEN_PREFERENCES_EVENT,
  OPEN_STANDALONE_PDF_EVENT,
  type JumpToNoteAnchorEventDetail,
  type OpenPreferencesEventDetail,
} from '../../app/appEvents';
import { selectDirectory } from '../../services/desktop';
import { listLibraryPapers } from '../../services/library';
import { AppLocaleProvider } from '../../i18n/uiLanguage';
import { getHomeTabTitle, HOME_TAB_ID, type ReaderTab, useTabsStore } from '../../stores/useTabsStore';
import {
  createQaSession,
  type ReaderTabBridgeState,
} from './documentReaderShared';
import type {
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
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
  mergeLocalPdfPath,
  createNativeLibraryWorkspaceItem,
  getModelRuntimeConfig,
  resolveLanguageLabel,
  type PreferencesSectionKey,
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
    left.onCancelTranslate === right.onCancelTranslate &&
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

    applyItems(standaloneItems);
    applyItems(nativeLibraryItems);

    return itemMap;
  }, [nativeLibraryItems, standaloneItems]);

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
    setLibraryPreviewStates,
    setLibraryTranslationSnapshots,
    syncLibraryParsedState,
    updateLibraryPreviewOperation,
  } = useReaderLibraryPreview({
    activeTabId: workspaceActive ? activeTabId : null,
    allKnownItems,
    createPaperTaskState,
    l,
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
    const handleJumpToNoteAnchorEvent = (event: Event) => {
      const detail = (event as CustomEvent<JumpToNoteAnchorEventDetail>).detail;
      if (!detail?.noteId || !detail.anchorId) {
        return;
      }

      void openNoteAnchorJump(detail);
    };

    window.addEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
    window.addEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);

    return () => {
      window.removeEventListener(OPEN_STANDALONE_PDF_EVENT, handleOpenStandalonePdfEvent);
      window.removeEventListener(JUMP_TO_NOTE_ANCHOR_EVENT, handleJumpToNoteAnchorEvent);
    };
  }, [handleOpenStandalonePdf, openNoteAnchorJump]);

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
                  onOpenPaper={handleOpenNativeLibraryPaper}
                  mineruCacheDir={settings.mineruCacheDir}
                  autoLoadSiblingJson={settings.autoLoadSiblingJson}
                  showReadingHeatmap={settings.showLibraryReadingHeatmap}
                  onRunMineruParse={handleNativeLibraryMineruParse}
                  onTranslatePaper={handleNativeLibraryTranslate}
                  onGenerateSummary={handleNativeLibraryGenerateSummary}
                  paperActionStates={nativePaperActionStates}
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
          onCancelTranslate={activeReaderBridge?.onCancelTranslate}
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
