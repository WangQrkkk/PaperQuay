import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { extractTranslatableMarkdownFromMineruBlock } from "../../services/mineru";
import {
  translateBlocksOpenAICompatible,
  translateTextOpenAICompatible,
} from "../../services/translation";
import type {
  PositionedMineruBlock,
  QaModelPreset,
  ReaderSettings,
  SelectedExcerpt,
  TranslationBlockInput,
  TranslationMap,
  WorkspaceItem,
} from "../../types/reader";
import { isPaperTaskRunning } from "./paperTaskState";
import {
  getModelRuntimeConfig,
} from "./readerShared";
import type { ReaderDocumentTranslationSnapshot } from "./documentReaderShared";
import {
  countTranslatedBlocks,
  mergeReaderTranslations,
  sanitizeTranslationErrorMessage,
  translateBlocksBestEffort,
} from "./readerTranslation";
import {
  readTranslationCache,
  writeTranslationCache,
} from "./readerTranslationCache";

type LocaleTextFn = (zh: string, en: string) => string;

function buildTranslatableBlockInput(block: PositionedMineruBlock): TranslationBlockInput | null {
  if (block.contentSourceBlockId) {
    return null;
  }

  const text = extractTranslatableMarkdownFromMineruBlock(block).trim();

  return text ? { blockId: block.blockId, text } : null;
}

function buildTranslatableBlockInputs(blocks: PositionedMineruBlock[]): TranslationBlockInput[] {
  return blocks
    .map((block) => buildTranslatableBlockInput(block))
    .filter((block): block is TranslationBlockInput => Boolean(block));
}

interface UseDocumentTranslationOptions {
  currentDocument: WorkspaceItem;
  flatBlocks: PositionedMineruBlock[];
  libraryOperationRunning: boolean;
  onOpenPreferences: () => void;
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
  applySelectedExcerptTranslation: (translation: string) => void;
  blockTranslations: TranslationMap;
  handleCancelDocumentTranslation: () => void;
  handleClearTranslations: () => void;
  handleRetranslateBlock: (block: PositionedMineruBlock) => Promise<void>;
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
  translationCancelling: boolean;
  translationProgressCompleted: number;
  translationProgressTotal: number;
}

export function useDocumentTranslation({
  currentDocument,
  flatBlocks,
  libraryOperationRunning,
  onOpenPreferences,
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
  const documentTranslationAbortControllerRef = useRef<AbortController | null>(null);
  const documentTranslationRequestIdRef = useRef(0);
  const selectedExcerptRequestIdRef = useRef(0);
  const selectionRequestKeyRef = useRef("");
  const blockTranslationsRef = useRef<TranslationMap>({});
  const translationProgressTotalRef = useRef(0);

  const [blockTranslations, setBlockTranslations] = useState<TranslationMap>(
    {},
  );
  const [blockTranslationTargetLanguage, setBlockTranslationTargetLanguage] =
    useState("");
  const [translating, setTranslating] = useState(false);
  const [translationCancelling, setTranslationCancelling] = useState(false);
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

  useEffect(() => {
    blockTranslationsRef.current = blockTranslations;
  }, [blockTranslations]);

  useEffect(() => {
    translationProgressTotalRef.current = translationProgressTotal;
  }, [translationProgressTotal]);

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

  const handleTranslateDocument = useCallback(async () => {
    if (translating || libraryOperationRunning) {
      return;
    }

    const blocksToTranslate = buildTranslatableBlockInputs(flatBlocks);

    if (blocksToTranslate.length === 0) {
      const message = lRef.current(
        "当前没有可翻译的结构化文本",
        "There is no structured text available to translate",
      );
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
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

    const requestId = documentTranslationRequestIdRef.current + 1;
    const abortController = new AbortController();

    documentTranslationRequestIdRef.current = requestId;
    documentTranslationAbortControllerRef.current = abortController;

    setTranslating(true);
    setTranslationCancelling(false);
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
        apiMode: translationModelPreset.apiMode,
        baseUrl: translationModelPreset.baseUrl,
        batchSize: Math.max(1, settings.translationBatchSize),
        blocks: blocksToTranslate,
        concurrency: Math.max(1, settings.translationConcurrency),
        existingTranslations: resumedTranslations,
        model: translationModelPreset.model,
        onProgress: async (progress) => {
          if (
            documentTranslationRequestIdRef.current !== requestId ||
            abortController.signal.aborted
          ) {
            return;
          }

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
        signal: abortController.signal,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        temperature: getModelRuntimeConfig(settings, "translation").temperature,
        translateBatch: translateBlocksOpenAICompatible,
      });

      if (documentTranslationRequestIdRef.current !== requestId) {
        return;
      }

      const nextTranslations = result.translations;
      const nextTranslatedCount = countTranslatedBlocks(nextTranslations);

      setBlockTranslations(nextTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setTranslationProgressCompleted(nextTranslatedCount);

      await saveTranslationCache(currentDocument, nextTranslations).catch(
        () => undefined,
      );

      if (result.cancelled) {
        const remainingCount = Math.max(0, blocksToTranslate.length - nextTranslatedCount);
        const cancelledMessage = lRef.current(
          `已取消全文翻译，已保留 ${nextTranslatedCount} 段译文，剩余 ${remainingCount} 段可再次点击翻译全文继续`,
          `Full-document translation cancelled. Kept ${nextTranslatedCount} translated blocks; click Translate Document again to continue the remaining ${remainingCount}`,
        );

        setStatusMessage(cancelledMessage);
        updateLibraryOperation(
          "translation",
          "success",
          cancelledMessage,
          nextTranslatedCount,
          blocksToTranslate.length,
        );
        return;
      }

      const failedCount = result.failedBlocks.length;
      const finishedMessage =
        failedCount > 0
          ? lRef.current(
              `翻译已部分完成，已保存 ${nextTranslatedCount} 段译文，剩余 ${failedCount} 段可再次点击翻译全文继续`,
              `Translation partially completed. Saved ${nextTranslatedCount} translated blocks; click Translate Document again to continue the remaining ${failedCount}`,
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
      if (documentTranslationRequestIdRef.current !== requestId) {
        return;
      }

      const message = sanitizeTranslationErrorMessage(
        error,
        lRef.current,
        "document",
      );
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation("translation", "error", message, 100, 100);
    } finally {
      if (documentTranslationRequestIdRef.current === requestId) {
        setTranslating(false);
        setTranslationCancelling(false);
        setTranslationProgressTotal(0);
        if (documentTranslationAbortControllerRef.current === abortController) {
          documentTranslationAbortControllerRef.current = null;
        }
      }
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

  const handleCancelDocumentTranslation = useCallback(() => {
    const abortController = documentTranslationAbortControllerRef.current;

    if (!abortController || abortController.signal.aborted) {
      return;
    }

    abortController.abort();
    setTranslationCancelling(true);

    const translatedBlockCount = countTranslatedBlocks(blockTranslationsRef.current);
    const totalBlockCount = translationProgressTotalRef.current || null;
    const message = lRef.current(
      "正在取消全文翻译，当前批次结束后会停止，并保留已完成译文。",
      "Cancelling full-document translation. It will stop after the current batch and keep completed translations.",
    );

    setStatusMessage(message);
    updateLibraryOperation(
      "translation",
      "running",
      message,
      translatedBlockCount,
      totalBlockCount,
    );
  }, [setStatusMessage, updateLibraryOperation, lRef]);

  const handleRetranslateBlock = useCallback(
    async (block: PositionedMineruBlock) => {
      if (translating || libraryOperationRunning) {
        return;
      }

      const blockToTranslate = buildTranslatableBlockInput(block);

      if (!blockToTranslate) {
        const message = lRef.current(
          "这个结构块没有可翻译文本",
          "This structured block has no translatable text",
        );
        setStatusMessage(message);
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

      const requestId = documentTranslationRequestIdRef.current + 1;
      const abortController = new AbortController();

      documentTranslationRequestIdRef.current = requestId;
      documentTranslationAbortControllerRef.current = abortController;

      setTranslating(true);
      setTranslationCancelling(false);
      setTranslationProgressCompleted(0);
      setTranslationProgressTotal(1);
      setError("");

      const startMessage = lRef.current(
        `正在重新翻译第 ${block.pageIndex + 1} 页的结构块`,
        `Retranslating the structured block on page ${block.pageIndex + 1}`,
      );
      setStatusMessage(startMessage);
      updateLibraryOperation("translation", "running", startMessage, 0, 1);

      try {
        const result = await translateBlocksBestEffort({
          apiKey: translationModelPreset.apiKey.trim(),
          apiMode: translationModelPreset.apiMode,
          baseUrl: translationModelPreset.baseUrl,
          batchSize: 1,
          blocks: [blockToTranslate],
          concurrency: 1,
          existingTranslations: {},
          model: translationModelPreset.model,
          onProgress: async (progress) => {
            if (
              documentTranslationRequestIdRef.current !== requestId ||
              abortController.signal.aborted
            ) {
              return;
            }

            const mergedTranslations = mergeReaderTranslations(
              blockTranslationsRef.current,
              progress.translations,
            );

            setBlockTranslations(mergedTranslations);
            setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
            setTranslationProgressCompleted(progress.translatedCount);

            if (progress.translatedCount > 0) {
              await saveTranslationCache(currentDocument, mergedTranslations).catch(
                () => undefined,
              );
            }
          },
          reasoningEffort: getModelRuntimeConfig(settings, "translation").reasoningEffort,
          requestsPerMinute: settings.translationRequestsPerMinute,
          signal: abortController.signal,
          sourceLanguage: settings.translationSourceLanguage,
          targetLanguage: settings.translationTargetLanguage,
          temperature: getModelRuntimeConfig(settings, "translation").temperature,
          translateBatch: translateBlocksOpenAICompatible,
        });

        if (documentTranslationRequestIdRef.current !== requestId) {
          return;
        }

        const nextTranslations = mergeReaderTranslations(
          blockTranslationsRef.current,
          result.translations,
        );
        const translatedText = result.translations[block.blockId]?.trim() ?? "";

        setBlockTranslations(nextTranslations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(translatedText ? 1 : 0);
        await saveTranslationCache(currentDocument, nextTranslations).catch(
          () => undefined,
        );

        if (result.cancelled) {
          const message = lRef.current(
            "已取消单块重译，原有译文已保留。",
            "Block retranslation cancelled. Existing translation was kept.",
          );
          setStatusMessage(message);
          updateLibraryOperation("translation", "success", message, translatedText ? 1 : 0, 1);
          return;
        }

        if (!translatedText) {
          const message = lRef.current(
            "这个结构块重译失败，已保留原有译文。",
            "Failed to retranslate this block. Existing translation was kept.",
          );
          setStatusMessage(message);
          updateLibraryOperation("translation", "error", message, 1, 1);
          setError(
            sanitizeTranslationErrorMessage(
              result.failureMessages[0],
              lRef.current,
              "document",
            ),
          );
          return;
        }

        const message = lRef.current(
          "已重新翻译当前结构块",
          "Retranslated the selected structured block",
        );
        setStatusMessage(message);
        updateLibraryOperation("translation", "success", message, 1, 1);
      } catch (error) {
        if (documentTranslationRequestIdRef.current !== requestId) {
          return;
        }

        const message = sanitizeTranslationErrorMessage(
          error,
          lRef.current,
          "document",
        );
        setError(message);
        setStatusMessage(message);
        updateLibraryOperation("translation", "error", message, 1, 1);
      } finally {
        if (documentTranslationRequestIdRef.current === requestId) {
          setTranslating(false);
          setTranslationCancelling(false);
          setTranslationProgressTotal(0);
          if (documentTranslationAbortControllerRef.current === abortController) {
            documentTranslationAbortControllerRef.current = null;
          }
        }
      }
    },
    [
      currentDocument,
      libraryOperationRunning,
      onOpenPreferences,
      saveTranslationCache,
      setError,
      setStatusMessage,
      settings.translationRequestsPerMinute,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      translating,
      translationModelPreset,
      updateLibraryOperation,
      lRef,
    ],
  );

  const handleClearTranslations = useCallback(() => {
    setBlockTranslations({});
    setStatusMessage(
      lRef.current(
        "已清空当前文稿的译文缓存",
        "Cleared the translation cache for the current paper",
      ),
    );
  }, [setStatusMessage, lRef]);

  const applySelectedExcerptTranslation = useCallback(
    (translation: string) => {
      selectionRequestKeyRef.current = "";
      setSelectedExcerptTranslation(translation);
      setSelectedExcerptTranslating(false);
      setSelectedExcerptError("");
    },
    [],
  );

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
            apiMode: selectionTranslationModelPreset.apiMode,
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
    documentTranslationAbortControllerRef.current?.abort();
    documentTranslationAbortControllerRef.current = null;
    documentTranslationRequestIdRef.current += 1;
    selectionRequestKeyRef.current = "";
    setBlockTranslations({});
    setBlockTranslationTargetLanguage("");
    setTranslating(false);
    setTranslationCancelling(false);
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
  };
}
