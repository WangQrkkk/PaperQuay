import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { updateLibraryPaper } from '../../services/library';
import {
  summarizeDocumentOpenAICompatible,
} from '../../services/summary';
import {
  HOME_TAB_ID,
} from '../../stores/useTabsStore';
import type {
  PaperSummary,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader';
import type {
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
} from '../../types/library';
import { getFileNameFromPath } from '../../utils/text';
import { loadPaperHistory } from '../../utils/paperHistory';
import {
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import {
  resolveSummaryOutputLanguage,
} from '../../services/summarySource';
import {
  buildLibraryPreviewSummaryRequest,
  loadReaderLibraryPreviewBlocks,
  readExistingMineruJson,
  readSavedPreviewSummary,
  writeMineruParseCache,
  writePreviewSummaryCache,
} from './readerLibraryPreview';
import type {
  LibraryPreviewSyncPayload,
  ReaderDocumentTranslationSnapshot,
} from './documentReaderShared';
import {
  EMPTY_LIBRARY_PREVIEW_STATE,
  formatPaperSummaryForLibrary,
  getModelRuntimeConfig,
  isOnboardingWelcomeItem,
  textSignature,
  type LibraryPreviewLoadResult,
  type LibraryPreviewOutcome,
  type LibraryPreviewState,
  type MineruCacheManifest,
  type OnboardingDemoRevealState,
  type PreferencesSectionKey,
} from './readerShared';

type LocaleTextFn = <T,>(zh: T, en: T) => T;

type CreatePaperTaskState = (
  kind: LiteraturePaperTaskKind,
  status: LiteraturePaperTaskState['status'],
  message: string,
  completed?: number | null,
  total?: number | null,
) => LiteraturePaperTaskState;

export interface UseReaderLibraryPreviewOptions {
  activeTabId: string | null;
  allKnownItems: WorkspaceItem[];
  createPaperTaskState: CreatePaperTaskState;
  l: LocaleTextFn;
  onboardingDemoReveal: OnboardingDemoRevealState;
  onboardingOpen: boolean;
  selectedLibraryItem: WorkspaceItem | null;
  setError: (value: string) => void;
  setPreferencesOpen: (value: boolean) => void;
  setPreferredPreferencesSection: (value: PreferencesSectionKey | undefined) => void;
  setStatusMessage: (value: string) => void;
  settings: ReaderSettings;
  summaryModelPreset: QaModelPreset | null | undefined;
}

export interface UseReaderLibraryPreviewResult {
  findExistingMineruJson: (item: WorkspaceItem) => Promise<Awaited<ReturnType<typeof readExistingMineruJson>>>;
  generateLibraryPreview: (
    item: WorkspaceItem,
    force?: boolean,
    options?: { allowGenerate?: boolean },
  ) => Promise<LibraryPreviewOutcome>;
  handleLibraryPreviewSync: (payload: LibraryPreviewSyncPayload) => void;
  itemParseStatusMap: Record<string, boolean | undefined>;
  libraryPreviewStates: Record<string, LibraryPreviewState>;
  libraryTranslationSnapshots: Record<string, ReaderDocumentTranslationSnapshot>;
  loadLibraryPreviewBlocks: (item: WorkspaceItem) => Promise<LibraryPreviewLoadResult>;
  saveLibraryMineruParseCache: (options: {
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
  }) => Promise<Awaited<ReturnType<typeof writeMineruParseCache>>>;
  setItemParseStatusMap: Dispatch<SetStateAction<Record<string, boolean | undefined>>>;
  setLibraryPreviewStates: Dispatch<SetStateAction<Record<string, LibraryPreviewState>>>;
  setLibraryTranslationSnapshots: Dispatch<SetStateAction<Record<string, ReaderDocumentTranslationSnapshot>>>;
  syncLibraryParsedState: (
    item: WorkspaceItem,
    jsonText: string,
    jsonPath: string,
    status: string,
  ) => {
    pages: ReturnType<typeof parseMineruPages>;
    blocks: ReturnType<typeof flattenMineruPages>;
  };
  updateLibraryPreviewOperation: (
    item: WorkspaceItem,
    operation: LiteraturePaperTaskState | null,
    patch?: Partial<Omit<LibraryPreviewState, 'operation'>>,
  ) => void;
}

export function useReaderLibraryPreview({
  activeTabId,
  allKnownItems,
  createPaperTaskState,
  l,
  onboardingDemoReveal,
  onboardingOpen,
  selectedLibraryItem,
  setPreferencesOpen,
  setPreferredPreferencesSection,
  settings,
  summaryModelPreset,
}: UseReaderLibraryPreviewOptions): UseReaderLibraryPreviewResult {
  const libraryPreviewRequestIdRef = useRef<Record<string, number>>({});
  const savedNativeSummaryKeysRef = useRef<Set<string>>(new Set());

  const [libraryPreviewStates, setLibraryPreviewStates] = useState<
    Record<string, LibraryPreviewState>
  >({});
  const [itemParseStatusMap, setItemParseStatusMap] = useState<Record<string, boolean | undefined>>(
    {},
  );
  const [libraryTranslationSnapshots, setLibraryTranslationSnapshots] = useState<
    Record<string, ReaderDocumentTranslationSnapshot>
  >({});

  const notLoadedText = l('未加载', 'Not Loaded');
  const noPdfLoadedText = l('未加载 PDF', 'No PDF Loaded');
  const noJsonLoadedText = l('未加载 JSON', 'No JSON Loaded');

  const updateLibraryPreviewOperation = useCallback(
    (
      item: WorkspaceItem,
      operation: LiteraturePaperTaskState | null,
      patch: Partial<Omit<LibraryPreviewState, 'operation'>> = {},
    ) => {
      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          ...patch,
          operation,
        },
      }));
    },
    [],
  );

  const persistNativeLibraryOverview = useCallback(
    async (item: WorkspaceItem, summary: PaperSummary, sourceKey: string) => {
      if (item.source !== 'native-library') {
        return;
      }

      const summaryText = formatPaperSummaryForLibrary(summary);

      if (!summaryText) {
        return;
      }

      const saveKey = `${item.itemKey}::${sourceKey || 'overview'}::${textSignature(summaryText)}`;

      if (savedNativeSummaryKeysRef.current.has(saveKey)) {
        return;
      }

      savedNativeSummaryKeysRef.current.add(saveKey);
      const updatedPaper = await updateLibraryPaper({
        paperId: item.itemKey,
        aiSummary: summaryText,
      });

      window.dispatchEvent(
        new CustomEvent('paperquay:native-summary-updated', {
          detail: {
            paperId: updatedPaper.id,
            aiSummary: updatedPaper.aiSummary,
          },
        }),
      );
    },
    [],
  );

  const handleLibraryPreviewSync = useCallback((payload: LibraryPreviewSyncPayload) => {
    const isWelcomeDemoPayload = isOnboardingWelcomeItem(payload.item);

    if (payload.summary) {
      void persistNativeLibraryOverview(
        payload.item,
        payload.summary,
        payload.sourceKey ?? 'overview',
      ).catch(() => undefined);
    }

    if (payload.item.source === 'native-library' && payload.hasBlocks) {
      window.dispatchEvent(
        new CustomEvent('paperquay:native-mineru-status-updated', {
          detail: {
            paperId: payload.item.itemKey,
            mineruParsed: true,
          },
        }),
      );
    }

    setItemParseStatusMap((current) => ({
      ...current,
      [payload.item.workspaceId]: isWelcomeDemoPayload && onboardingOpen
        ? onboardingDemoReveal.parsed
        : payload.hasBlocks,
    }));

    setLibraryPreviewStates((current) => {
      const existingState = current[payload.item.workspaceId];
      const hasSummary = Object.prototype.hasOwnProperty.call(payload, 'summary');
      const hasLoading = Object.prototype.hasOwnProperty.call(payload, 'loading');
      const hasError = Object.prototype.hasOwnProperty.call(payload, 'error');
      const hasOperation = Object.prototype.hasOwnProperty.call(payload, 'operation');

      return {
        ...current,
        [payload.item.workspaceId]: {
          summary: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.summarized
            ? null
            : hasSummary ? payload.summary ?? null : existingState?.summary ?? null,
          loading: hasLoading ? Boolean(payload.loading) : false,
          error: hasError ? payload.error ?? '' : '',
          operation: hasOperation ? payload.operation ?? null : existingState?.operation ?? null,
          hasBlocks: isWelcomeDemoPayload && onboardingOpen
            ? onboardingDemoReveal.parsed && payload.hasBlocks
            : payload.hasBlocks,
          blockCount: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? 0
            : payload.blockCount,
          currentPdfName: payload.currentPdfName,
          currentJsonName: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? l('尚未解析', 'Not parsed yet')
            : payload.currentJsonName,
          statusMessage: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? l(
                '请按新手引导点击 MinerU 解析，内置结构块会在这里显示。',
                'Follow the onboarding guide and click MinerU Parse to reveal the bundled structure blocks here.',
              )
            : payload.statusMessage,
          sourceKey: payload.sourceKey,
        },
      };
    });
  }, [
    l,
    onboardingDemoReveal.parsed,
    onboardingDemoReveal.summarized,
    onboardingOpen,
    persistNativeLibraryOverview,
  ]);

  const findExistingMineruJson = useCallback(
    async (item: WorkspaceItem) =>
      readExistingMineruJson(item, {
        autoLoadSiblingJson: settings.autoLoadSiblingJson,
        mineruCacheDir: settings.mineruCacheDir,
      }),
    [settings.autoLoadSiblingJson, settings.mineruCacheDir],
  );

  useEffect(() => {
    if (allKnownItems.length === 0) {
      setItemParseStatusMap({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const nextEntries = await Promise.all(
        allKnownItems.map(async (item) => [item.workspaceId, Boolean(await findExistingMineruJson(item))] as const),
      );

      if (cancelled) {
        return;
      }

      setItemParseStatusMap((current) => ({
        ...current,
        ...Object.fromEntries(nextEntries),
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [allKnownItems, findExistingMineruJson]);

  const saveLibraryMineruParseCache = useCallback(
    async (options: {
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
    }) =>
      writeMineruParseCache({
        ...options,
        mineruCacheDir: settings.mineruCacheDir,
      }),
    [settings.mineruCacheDir],
  );

  const syncLibraryParsedState = useCallback(
    (
      item: WorkspaceItem,
      jsonText: string,
      jsonPath: string,
      status: string,
    ) => {
      const pages = parseMineruPages(jsonText);
      const blocks = flattenMineruPages(pages);
      const currentJsonName = getFileNameFromPath(jsonPath);
      const currentPdfName = item.localPdfPath
        ? getFileNameFromPath(item.localPdfPath)
        : noPdfLoadedText;

      setItemParseStatusMap((current) => ({
        ...current,
        [item.workspaceId]: true,
      }));
      setLibraryPreviewStates((current) => {
        const previousState = current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE;

        return {
          ...current,
          [item.workspaceId]: {
            ...previousState,
            loading: false,
            error: '',
            hasBlocks: blocks.length > 0,
            blockCount: blocks.length,
            currentPdfName,
            currentJsonName,
            statusMessage: status,
            sourceKey:
              previousState.sourceKey || `${item.workspaceId}::${currentJsonName}::${blocks.length}`,
          },
        };
      });

      return {
        pages,
        blocks,
      };
    },
    [noPdfLoadedText],
  );

  const loadLibraryPreviewBlocks = useCallback(
    async (item: WorkspaceItem): Promise<LibraryPreviewLoadResult> =>
      loadReaderLibraryPreviewBlocks({
        item,
        settings,
        l,
        noJsonLoadedText,
        noPdfLoadedText,
        notLoadedText,
      }),
    [l, noJsonLoadedText, noPdfLoadedText, notLoadedText, settings],
  );

  const resolveLibraryPreviewSummaryRequest = useCallback(
    async (
      item: WorkspaceItem,
      blocks: PositionedMineruBlock[],
    ) =>
      buildLibraryPreviewSummaryRequest({
        item,
        blocks,
        settings,
        l,
      }),
    [l, settings],
  );

  const tryLoadSavedPreviewSummary = useCallback(
    async (item: WorkspaceItem, sourceKey: string) =>
      readSavedPreviewSummary({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceKey,
      }),
    [settings.mineruCacheDir],
  );

  const savePreviewSummary = useCallback(
    async (
      item: WorkspaceItem,
      sourceKey: string,
      summary: PaperSummary,
    ) =>
      writePreviewSummaryCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceKey,
        summary,
      }),
    [settings.mineruCacheDir],
  );

  const generateLibraryPreview = useCallback(
    async (
      item: WorkspaceItem,
      force = false,
      options?: {
        allowGenerate?: boolean;
      },
    ): Promise<LibraryPreviewOutcome> => {
      const allowGenerate = options?.allowGenerate ?? true;
      const cachedState = libraryPreviewStates[item.workspaceId];

      if (!force && cachedState) {
        if (cachedState.loading || cachedState.summary) {
          return 'loaded';
        }

        if (cachedState.hasBlocks && !allowGenerate) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              ...cachedState,
              loading: false,
              error: '',
              statusMessage:
                cachedState.statusMessage ||
                l(
                  '结构化内容已就绪，可以手动生成概览。',
                  'Structured content is ready. You can generate the overview manually.',
                ),
            },
          }));
          return 'loaded';
        }
      }

      const requestId = (libraryPreviewRequestIdRef.current[item.workspaceId] ?? 0) + 1;
      libraryPreviewRequestIdRef.current[item.workspaceId] = requestId;

      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          summary: force ? null : current[item.workspaceId]?.summary ?? null,
          loading: true,
          error: '',
          operation: allowGenerate
            ? createPaperTaskState(
                'overview',
                'running',
                l(
                  '正在整理预览内容并生成 AI 概览...',
                  'Preparing the preview and generating the AI overview...',
                ),
                15,
                100,
              )
            : current[item.workspaceId]?.operation ?? null,
          hasBlocks: current[item.workspaceId]?.hasBlocks ?? false,
          blockCount: current[item.workspaceId]?.blockCount ?? 0,
          currentPdfName: item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText,
          currentJsonName: current[item.workspaceId]?.currentJsonName ?? notLoadedText,
          statusMessage: l(
            '正在整理预览内容并生成 AI 概览...',
            'Preparing the preview and generating the AI overview...',
          ),
          sourceKey: current[item.workspaceId]?.sourceKey ?? '',
        },
      }));

      try {
        const previewContext = await loadLibraryPreviewBlocks(item);
        const summaryRequest = await resolveLibraryPreviewSummaryRequest(item, previewContext.blocks);
        const {
          summaryInputs,
          sourceKey,
          documentText,
          errorMessage,
        } = summaryRequest;
        const historySummary =
          loadPaperHistory(item.workspaceId)?.paperSummarySourceKey === sourceKey
            ? loadPaperHistory(item.workspaceId)?.paperSummary ?? null
            : null;
        const cachedSummary = force ? null : await tryLoadSavedPreviewSummary(item, sourceKey);

        if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
          return 'skipped';
        }

        if (errorMessage && !documentText.trim() && summaryInputs.length === 0) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              summary: null,
              loading: false,
              error: '',
              operation: allowGenerate
                ? createPaperTaskState('overview', 'error', errorMessage, 100, 100)
                : current[item.workspaceId]?.operation ?? null,
              hasBlocks: false,
              blockCount: 0,
              currentPdfName: previewContext.currentPdfName,
              currentJsonName: previewContext.currentJsonName,
              statusMessage: errorMessage,
              sourceKey,
            },
          }));
          return 'skipped';
        }

        if (!force && historySummary) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              summary: historySummary,
              loading: false,
              error: '',
              operation: allowGenerate
                ? createPaperTaskState(
                    'overview',
                    'success',
                    l('已从阅读历史恢复概览', 'Overview restored from reading history'),
                    100,
                    100,
                  )
                : current[item.workspaceId]?.operation ?? null,
              hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
              blockCount: previewContext.blocks.length,
              currentPdfName: previewContext.currentPdfName,
              currentJsonName: previewContext.currentJsonName,
              statusMessage: l('已从阅读历史恢复概览', 'Overview restored from reading history'),
              sourceKey,
            },
          }));
          void persistNativeLibraryOverview(item, historySummary, sourceKey).catch(() => undefined);
          return 'loaded';
        }

        if (!force && cachedSummary) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              summary: cachedSummary,
              loading: false,
              error: '',
              operation: allowGenerate
                ? createPaperTaskState(
                    'overview',
                    'success',
                    l('已加载缓存概览', 'Loaded the cached overview'),
                    100,
                    100,
                  )
                : current[item.workspaceId]?.operation ?? null,
              hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
              blockCount: previewContext.blocks.length,
              currentPdfName: previewContext.currentPdfName,
              currentJsonName: previewContext.currentJsonName,
              statusMessage: l('已加载缓存概览', 'Loaded the cached overview'),
              sourceKey,
            },
          }));
          void persistNativeLibraryOverview(item, cachedSummary, sourceKey).catch(() => undefined);
          return 'loaded';
        }

        if (!summaryModelPreset || !summaryModelPreset.apiKey.trim() || !summaryModelPreset.baseUrl.trim()) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              summary: null,
              loading: false,
              error: '',
              operation: allowGenerate
                ? createPaperTaskState(
                    'overview',
                    'error',
                    l(
                      '概览模型尚未配置完成，请检查 Base URL、模型名称和 API Key。',
                      'The overview model is not configured yet. Check the Base URL, model name, and API key.',
                    ),
                    100,
                    100,
                  )
                : current[item.workspaceId]?.operation ?? null,
              hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
              blockCount: previewContext.blocks.length,
              currentPdfName: previewContext.currentPdfName,
              currentJsonName: previewContext.currentJsonName,
              statusMessage: l(
                '概览模型尚未配置完成，请检查 Base URL、模型名称和 API Key。',
                'The overview model is not configured yet. Check the Base URL, model name, and API key.',
              ),
              sourceKey,
            },
          }));
          setPreferredPreferencesSection('models');
          setPreferencesOpen(true);
          return 'skipped';
        }

        if (!force && cachedState?.summary && cachedState.sourceKey === sourceKey) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              ...cachedState,
              loading: false,
              operation: allowGenerate
                ? createPaperTaskState(
                    'overview',
                    'success',
                    l('已加载当前概览', 'Loaded the current overview'),
                    100,
                    100,
                  )
                : cachedState.operation ?? null,
            },
          }));
          return 'loaded';
        }

        if (!allowGenerate) {
          setLibraryPreviewStates((current) => ({
            ...current,
            [item.workspaceId]: {
              summary: null,
              loading: false,
              error: '',
              operation: current[item.workspaceId]?.operation ?? null,
              hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
              blockCount: previewContext.blocks.length,
              currentPdfName: previewContext.currentPdfName,
              currentJsonName: previewContext.currentJsonName,
              statusMessage: previewContext.blocks.length > 0
                ? l(
                    '结构化内容已就绪，可以手动生成概览。',
                    'Structured content is ready. You can generate the overview manually.',
                  )
                : previewContext.statusMessage,
              sourceKey,
            },
          }));
          return 'skipped';
        }

        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            operation: createPaperTaskState(
              'overview',
              'running',
              l('正在调用概览模型生成结构化结果...', 'Calling the overview model for a structured result...'),
              55,
              100,
            ),
            statusMessage: l('正在调用概览模型生成结构化结果...', 'Calling the overview model for a structured result...'),
          },
        }));

        const summary = await summarizeDocumentOpenAICompatible({
          baseUrl: summaryModelPreset.baseUrl,
          apiKey: summaryModelPreset.apiKey.trim(),
          model: summaryModelPreset.model,
          temperature: getModelRuntimeConfig(settings, 'summary').temperature,
          reasoningEffort: getModelRuntimeConfig(settings, 'summary').reasoningEffort,
          title: item.title,
          authors: item.creators || undefined,
          year: item.year || undefined,
          outputLanguage: resolveSummaryOutputLanguage(settings),
          blocks: summaryInputs,
          documentText,
        });

        if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
          return 'skipped';
        }

        await savePreviewSummary(item, sourceKey, summary).catch(() => undefined);

        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary,
            loading: false,
            error: '',
            operation: createPaperTaskState(
              'overview',
              'success',
              l('AI 概览已生成', 'AI overview generated'),
              100,
              100,
            ),
            hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: l('AI 概览已生成', 'AI overview generated'),
            sourceKey,
          },
        }));
        void persistNativeLibraryOverview(item, summary, sourceKey).catch(() => undefined);
        return 'generated';
      } catch (nextError) {
        if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
          return 'skipped';
        }

        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: null,
            loading: false,
            error:
              nextError instanceof Error
                ? nextError.message
                : l('生成预览概览失败', 'Failed to generate the preview overview'),
            operation: createPaperTaskState(
              'overview',
              'error',
              nextError instanceof Error
                ? nextError.message
                : l('生成预览概览失败', 'Failed to generate the preview overview'),
              100,
              100,
            ),
            hasBlocks: libraryPreviewStates[item.workspaceId]?.hasBlocks ?? false,
            blockCount: libraryPreviewStates[item.workspaceId]?.blockCount ?? 0,
            currentPdfName:
              libraryPreviewStates[item.workspaceId]?.currentPdfName ??
              (item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText),
            currentJsonName: libraryPreviewStates[item.workspaceId]?.currentJsonName ?? notLoadedText,
            statusMessage: l('生成预览概览失败', 'Failed to generate the preview overview'),
            sourceKey: libraryPreviewStates[item.workspaceId]?.sourceKey ?? '',
          },
        }));
        return 'failed';
      }
    },
    [
      createPaperTaskState,
      l,
      libraryPreviewStates,
      loadLibraryPreviewBlocks,
      noPdfLoadedText,
      notLoadedText,
      persistNativeLibraryOverview,
      resolveLibraryPreviewSummaryRequest,
      savePreviewSummary,
      setPreferencesOpen,
      setPreferredPreferencesSection,
      settings,
      summaryModelPreset,
      tryLoadSavedPreviewSummary,
    ],
  );

  useEffect(() => {
    if (activeTabId !== HOME_TAB_ID || !selectedLibraryItem) {
      return;
    }

    void generateLibraryPreview(selectedLibraryItem, false, { allowGenerate: false });
  }, [activeTabId, generateLibraryPreview, selectedLibraryItem]);

  return {
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
  };
}
