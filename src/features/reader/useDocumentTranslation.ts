import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { extractTranslatableMarkdownFromMineruBlock } from "../../services/mineru";
import { translateTextOpenAICompatible } from "../../services/translation";
import type {
  PositionedMineruBlock,
  QaModelPreset,
  ReaderSettings,
  SelectedExcerpt,
  TranslationMap,
  WorkspaceItem,
} from "../../types/reader";
import { isPaperTaskRunning } from "./paperTaskState";
import {
  ONBOARDING_WELCOME_CACHE_DIR,
  getModelRuntimeConfig,
  isOnboardingWelcomeItem,
} from "./readerShared";
import type { ReaderDocumentTranslationSnapshot } from "./documentReaderShared";
import {
  countTranslatedBlocks,
  mergeReaderTranslations,
  readTranslationCache,
  sanitizeTranslationErrorMessage,
  translateBlocksBestEffort,
  writeTranslationCache,
} from "./readerTranslation";

type LocaleTextFn = (zh: string, en: string) => string;

interface UseDocumentTranslationOptions {
  currentDocument: WorkspaceItem;
  flatBlocks: PositionedMineruBlock[];
  libraryOperationRunning: boolean;
  onOpenPreferences: () => void;
  onboardingDemoReveal?: {
    parsed: boolean;
    translated: boolean;
    summarized: boolean;
  };
  selectedExcerpt: SelectedExcerpt | null;
  selectionTranslationModelPreset: QaModelPreset | null;
  settings: ReaderSettings;
  setError: (value: string) => void;
  setStatusMessage: (value: string) => void;
  translationModelPreset: QaModelPreset | null;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
  updateLibraryOperation: (
    kind: "translation",
    status: "running" | "success" | "error",
    message: string,
    completed?: number | null,
    total?: number | null,
  ) => void;
  lRef: MutableRefObject<LocaleTextFn>;
}

interface UseDocumentTranslationResult {
  blockTranslations: TranslationMap;
  handleClearTranslations: () => void;
  handleTranslateDocument: () => Promise<void>;
  handleTranslateSelectedExcerpt: (
    openPreferencesOnMissingKey?: boolean,
  ) => Promise<void>;
  resetDocumentTranslationState: () => void;
  resetSelectedExcerptTranslationState: () => void;
  selectedExcerptError: string;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  translatedCount: number;
  translating: boolean;
  translationProgressCompleted: number;
  translationProgressTotal: number;
}

export function useDocumentTranslation({
  currentDocument,
  flatBlocks,
  libraryOperationRunning,
  onOpenPreferences,
  onboardingDemoReveal,
  selectedExcerpt,
  selectionTranslationModelPreset,
  settings,
  setError,
  setStatusMessage,
  translationModelPreset,
  translationSnapshot = null,
  updateLibraryOperation,
  lRef,
}: UseDocumentTranslationOptions): UseDocumentTranslationResult {
  const selectedExcerptRequestIdRef = useRef(0);
  const selectionRequestKeyRef = useRef("");

  const [blockTranslations, setBlockTranslations] = useState<TranslationMap>(
    {},
  );
  const [blockTranslationTargetLanguage, setBlockTranslationTargetLanguage] =
    useState("");
  const [translating, setTranslating] = useState(false);
  const [translationProgressCompleted, setTranslationProgressCompleted] =
    useState(0);
  const [translationProgressTotal, setTranslationProgressTotal] = useState(0);
  const [selectedExcerptTranslation, setSelectedExcerptTranslation] =
    useState("");
  const [selectedExcerptTranslating, setSelectedExcerptTranslating] =
    useState(false);
  const [selectedExcerptError, setSelectedExcerptError] = useState("");

  const translatedCount = useMemo(
    () => countTranslatedBlocks(blockTranslations),
    [blockTranslations],
  );

  const tryLoadSavedTranslations = useCallback(
    async (item: WorkspaceItem) =>
      readTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        targetLanguage: settings.translationTargetLanguage,
      }),
    [settings.mineruCacheDir, settings.translationTargetLanguage],
  );

  const saveTranslationCache = useCallback(
    async (item: WorkspaceItem, translations: TranslationMap) => {
      await writeTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translations,
      });
    },
    [
      settings.mineruCacheDir,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    ],
  );

  useEffect(() => {
    if (
      blockTranslationTargetLanguage &&
      blockTranslationTargetLanguage !== settings.translationTargetLanguage
    ) {
      setBlockTranslations({});
      setBlockTranslationTargetLanguage("");
    }
  }, [blockTranslationTargetLanguage, settings.translationTargetLanguage]);

  useEffect(() => {
    if (
      !translationSnapshot ||
      translationSnapshot.targetLanguage !== settings.translationTargetLanguage
    ) {
      return;
    }

    const incomingCount = countTranslatedBlocks(
      translationSnapshot.translations,
    );

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
    settings.translationTargetLanguage,
    setStatusMessage,
    translatedCount,
    translationSnapshot,
    lRef,
  ]);

  useEffect(() => {
    if (!flatBlocks.length || !settings.mineruCacheDir.trim()) {
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
      const cachedTranslationResult =
        await tryLoadSavedTranslations(currentDocument);

      if (cancelled || !cachedTranslationResult) {
        return;
      }

      setBlockTranslations(cachedTranslationResult.translations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setStatusMessage(
        lRef.current(
          `已恢复历史翻译 ${countTranslatedBlocks(cachedTranslationResult.translations)} 条（${settings.translationTargetLanguage}）`,
          `Restored ${countTranslatedBlocks(cachedTranslationResult.translations)} saved translations (${settings.translationTargetLanguage})`,
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
    setStatusMessage,
    translatedCount,
    tryLoadSavedTranslations,
    lRef,
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
      .then((parsed: { translations?: TranslationMap } | null) => {
        if (cancelled || !parsed?.translations) {
          return;
        }

        setBlockTranslations(parsed.translations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setStatusMessage(
          lRef.current(
            "已加载 Welcome 内置全文翻译",
            "Loaded the built-in Welcome translation",
          ),
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
    setStatusMessage,
    translatedCount,
    lRef,
  ]);

  const handleTranslateDocument = useCallback(async () => {
    if (translating || libraryOperationRunning) {
      return;
    }

    const blocksToTranslate = flatBlocks
      .map((block) => ({
        blockId: block.blockId,
        text: extractTranslatableMarkdownFromMineruBlock(block),
      }))
      .filter((block) => block.text.trim().length > 0);

    if (blocksToTranslate.length === 0) {
      const message = lRef.current(
        "当前没有可翻译的结构化文本",
        "There is no structured text available to translate",
      );
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
      return;
    }

    if (isOnboardingWelcomeItem(currentDocument)) {
      try {
        setTranslating(true);
        setError("");
        updateLibraryOperation(
          "translation",
          "running",
          lRef.current(
            "正在加载 Welcome 内置全文翻译...",
            "Loading the built-in Welcome translation...",
          ),
          0,
          blocksToTranslate.length,
        );
        const response = await fetch(
          `${ONBOARDING_WELCOME_CACHE_DIR}/translations/chinese.json`,
        );
        const parsed = response.ok
          ? ((await response.json()) as {
              translations?: TranslationMap;
            } | null)
          : null;

        if (!parsed?.translations) {
          throw new Error(
            lRef.current(
              "未找到 Welcome 内置译文",
              "The built-in Welcome translation was not found",
            ),
          );
        }

        setBlockTranslations(parsed.translations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(
          countTranslatedBlocks(parsed.translations),
        );
        const successMessage = lRef.current(
          "已显示 Welcome 内置全文翻译，没有调用 API。",
          "Displayed the built-in Welcome full translation without calling any API.",
        );
        setStatusMessage(successMessage);
        updateLibraryOperation(
          "translation",
          "success",
          successMessage,
          countTranslatedBlocks(parsed.translations),
          blocksToTranslate.length,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : lRef.current(
                "加载内置译文失败",
                "Failed to load the built-in translation",
              );
        setError(message);
        setStatusMessage(
          lRef.current(
            "加载内置译文失败",
            "Failed to load the built-in translation",
          ),
        );
        updateLibraryOperation("translation", "error", message, 100, 100);
      } finally {
        setTranslating(false);
        setTranslationProgressTotal(0);
      }

      return;
    }

    if (!translationModelPreset || !translationModelPreset.apiKey.trim()) {
      onOpenPreferences();
      const message = lRef.current(
        "请先在设置中填写 AI 接口 API Key",
        "Configure the AI API key in Settings first",
      );
      setError(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
      return;
    }

    setTranslating(true);
    setTranslationProgressTotal(blocksToTranslate.length);
    setError("");
    const translationStartMessage = lRef.current(
      `正在翻译 ${blocksToTranslate.length} 个结构块`,
      `Translating ${blocksToTranslate.length} structured blocks`,
    );
    setStatusMessage(translationStartMessage);
    updateLibraryOperation(
      "translation",
      "running",
      translationStartMessage,
      0,
      blocksToTranslate.length,
    );

    try {
      const cachedTranslationResult = await tryLoadSavedTranslations(
        currentDocument,
      ).catch(() => null);
      const resumedTranslations = mergeReaderTranslations(
        mergeReaderTranslations(
          blockTranslations,
          cachedTranslationResult?.translations,
        ),
        translationSnapshot?.translations,
      );
      const resumedCount = countTranslatedBlocks(resumedTranslations);

      if (resumedCount > 0) {
        setBlockTranslations(resumedTranslations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(resumedCount);
      } else {
        setTranslationProgressCompleted(0);
      }

      const result = await translateBlocksBestEffort({
        apiKey: translationModelPreset.apiKey.trim(),
        baseUrl: translationModelPreset.baseUrl,
        batchSize: Math.max(1, settings.translationBatchSize),
        blocks: blocksToTranslate,
        concurrency: Math.max(1, settings.translationConcurrency),
        existingTranslations: resumedTranslations,
        model: translationModelPreset.model,
        onProgress: async (progress) => {
          setBlockTranslations(progress.translations);
          setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
          setTranslationProgressCompleted(progress.translatedCount);

          if (progress.translatedCount > 0) {
            await saveTranslationCache(
              currentDocument,
              progress.translations,
            ).catch(() => undefined);
          }

          const progressMessage = lRef.current(
            `正在翻译 ${progress.translatedCount}/${progress.totalBlocks} 个块`,
            `Translating ${progress.translatedCount}/${progress.totalBlocks} blocks`,
          );
          setStatusMessage(progressMessage);
          updateLibraryOperation(
            "translation",
            "running",
            progressMessage,
            progress.translatedCount,
            progress.totalBlocks,
          );
        },
        reasoningEffort: getModelRuntimeConfig(settings, "translation")
          .reasoningEffort,
        requestsPerMinute: settings.translationRequestsPerMinute,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        temperature: getModelRuntimeConfig(settings, "translation").temperature,
      });
      const nextTranslations = result.translations;
      const nextTranslatedCount = countTranslatedBlocks(nextTranslations);

      setBlockTranslations(nextTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setTranslationProgressCompleted(nextTranslatedCount);

      await saveTranslationCache(currentDocument, nextTranslations).catch(
        () => undefined,
      );
      const failedCount = result.failedBlocks.length;
      const finishedMessage =
        failedCount > 0
          ? lRef.current(
              `翻译已部分完成，已保存 ${nextTranslatedCount} 段译文，剩余 ${failedCount} 段可稍后重试`,
              `Translation partially completed. Saved ${nextTranslatedCount} translated blocks, with ${failedCount} remaining for retry`,
            )
          : lRef.current(
              `翻译完成，已生成 ${nextTranslatedCount} 段译文`,
              `Translation complete. Generated ${nextTranslatedCount} translated blocks`,
            );
      setStatusMessage(finishedMessage);
      updateLibraryOperation(
        "translation",
        failedCount > 0 ? "error" : "success",
        finishedMessage,
        nextTranslatedCount,
        blocksToTranslate.length,
      );

      if (failedCount > 0) {
        setError(
          sanitizeTranslationErrorMessage(
            result.failureMessages[0],
            lRef.current,
            "document",
          ),
        );
      }
    } catch (error) {
      const message = sanitizeTranslationErrorMessage(
        error,
        lRef.current,
        "document",
      );
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
    } finally {
      setTranslating(false);
      setTranslationProgressTotal(0);
    }
  }, [
    blockTranslations,
    currentDocument,
    flatBlocks,
    libraryOperationRunning,
    onOpenPreferences,
    saveTranslationCache,
    setError,
    setStatusMessage,
    settings.translationBatchSize,
    settings.translationConcurrency,
    settings.translationRequestsPerMinute,
    settings.translationSourceLanguage,
    settings.translationTargetLanguage,
    translating,
    translationModelPreset,
    translationSnapshot?.translations,
    tryLoadSavedTranslations,
    updateLibraryOperation,
    lRef,
  ]);

  const handleClearTranslations = useCallback(() => {
    setBlockTranslations({});
    setStatusMessage(
      lRef.current(
        "已清空当前文稿的译文缓存",
        "Cleared the translation cache for the current paper",
      ),
    );
  }, [setStatusMessage, lRef]);

  const handleTranslateSelectedExcerpt = useCallback(
    async (openPreferencesOnMissingKey = true) => {
      if (!selectedExcerpt) {
        setStatusMessage(
          lRef.current("请先选中一段文本", "Select a text passage first"),
        );
        setSelectedExcerptError(
          lRef.current(
            "请先在 PDF 或结构块视图中选中需要翻译的文本。",
            "Select text in the PDF or structured block view before translating it.",
          ),
        );
        return;
      }

      const selectionRequestKey = `${selectedExcerpt.source}::${selectedExcerpt.text}`;

      if (selectionRequestKeyRef.current === selectionRequestKey) {
        return;
      }

      if (
        !selectionTranslationModelPreset ||
        !selectionTranslationModelPreset.baseUrl.trim()
      ) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写 OpenAI 兼容 Base URL。",
            "Configure the OpenAI-compatible Base URL in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译接口 Base URL", "Missing translation Base URL"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset.apiKey.trim()) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写 AI 接口 API Key。",
            "Configure the AI API key in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译接口 API Key", "Missing translation API key"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      if (!selectionTranslationModelPreset.model.trim()) {
        setSelectedExcerptTranslation("");
        setSelectedExcerptError(
          lRef.current(
            "请先在设置中填写模型名称。",
            "Configure the model name in Settings first.",
          ),
        );
        setStatusMessage(
          lRef.current("缺少翻译模型名称", "Missing translation model name"),
        );

        if (openPreferencesOnMissingKey) {
          onOpenPreferences();
        }

        return;
      }

      const requestId = selectedExcerptRequestIdRef.current + 1;
      selectedExcerptRequestIdRef.current = requestId;
      selectionRequestKeyRef.current = selectionRequestKey;

      setSelectedExcerptTranslating(true);
      setSelectedExcerptError("");
      setStatusMessage(
        lRef.current(
          "正在翻译划词内容…",
          "Translating the selected excerpt...",
        ),
      );

      try {
        const translatedText = (
          await translateTextOpenAICompatible({
            baseUrl: selectionTranslationModelPreset.baseUrl,
            apiKey: selectionTranslationModelPreset.apiKey.trim(),
            model: selectionTranslationModelPreset.model,
            temperature: getModelRuntimeConfig(settings, "selectionTranslation")
              .temperature,
            reasoningEffort: getModelRuntimeConfig(
              settings,
              "selectionTranslation",
            ).reasoningEffort,
            sourceLanguage: settings.translationSourceLanguage,
            targetLanguage: settings.translationTargetLanguage,
            text: selectedExcerpt.text,
            requestsPerMinute: settings.translationRequestsPerMinute,
          })
        ).trim();

        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedExcerptTranslation(translatedText);

        if (!translatedText) {
          setSelectedExcerptError(
            lRef.current(
              "翻译结果为空，请稍后重试。",
              "The translation result was empty. Please try again later.",
            ),
          );
          setStatusMessage(
            lRef.current(
              "划词翻译结果为空",
              "Selected-text translation returned no content",
            ),
          );
          return;
        }

        setStatusMessage(
          lRef.current("划词翻译完成", "Selected-text translation complete"),
        );
      } catch (error) {
        if (selectedExcerptRequestIdRef.current !== requestId) {
          return;
        }

        const message = sanitizeTranslationErrorMessage(
          error,
          lRef.current,
          "selection",
        );

        setSelectedExcerptTranslation("");
        setSelectedExcerptError(message);
        setStatusMessage(message);
      } finally {
        if (selectionRequestKeyRef.current === selectionRequestKey) {
          selectionRequestKeyRef.current = "";
        }

        if (selectedExcerptRequestIdRef.current === requestId) {
          setSelectedExcerptTranslating(false);
        }
      }
    },
    [
      onOpenPreferences,
      selectedExcerpt,
      selectionTranslationModelPreset,
      setStatusMessage,
      settings.translationRequestsPerMinute,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      lRef,
    ],
  );

  const resetDocumentTranslationState = useCallback(() => {
    selectionRequestKeyRef.current = "";
    setBlockTranslations({});
    setBlockTranslationTargetLanguage("");
    setTranslating(false);
    setTranslationProgressCompleted(0);
    setTranslationProgressTotal(0);
    setSelectedExcerptTranslation("");
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError("");
  }, []);

  const resetSelectedExcerptTranslationState = useCallback(() => {
    selectionRequestKeyRef.current = "";
    setSelectedExcerptTranslation("");
    setSelectedExcerptTranslating(false);
    setSelectedExcerptError("");
  }, []);

  return {
    blockTranslations,
    handleClearTranslations,
    handleTranslateDocument,
    handleTranslateSelectedExcerpt,
    resetDocumentTranslationState,
    resetSelectedExcerptTranslationState,
    selectedExcerptError,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
    translatedCount,
    translating,
    translationProgressCompleted,
    translationProgressTotal,
  };
}
