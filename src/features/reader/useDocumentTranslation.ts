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
import {
  buildTranslationSourceMetadata,
  selectReusableCachedTranslations,
} from './readerTranslationSource';

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

function translationCacheFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const blockTranslationSourceFingerprintRef = useRef("");
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

  const translationSourceBlocks = useMemo(
    () => buildTranslatableBlockInputs(flatBlocks),
    [flatBlocks],
  );
  const translationSourceMetadata = useMemo(
    () => buildTranslationSourceMetadata(translationSourceBlocks),
    [translationSourceBlocks],
  );

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
    async (
      item: WorkspaceItem,
      translations: TranslationMap,
      sourceBlocks: TranslationBlockInput[],
    ) => {
      await writeTranslationCache({
        item,
        mineruCacheDir: settings.mineruCacheDir,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translations,
        sourceBlocks,
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
      blockTranslationSourceFingerprintRef.current = "";
    }
  }, [blockTranslationTargetLanguage, settings.translationTargetLanguage]);

  useEffect(() => {
    const activeSourceFingerprint = blockTranslationSourceFingerprintRef.current;

    if (
      !activeSourceFingerprint ||
      activeSourceFingerprint === translationSourceMetadata.sourceFingerprint
    ) {
      return;
    }

    blockTranslationSourceFingerprintRef.current = "";
    setBlockTranslations({});
    setBlockTranslationTargetLanguage("");
  }, [translationSourceMetadata.sourceFingerprint]);

  useEffect(() => {
    if (
      !translationSnapshot ||
      translationSnapshot.targetLanguage !== settings.translationTargetLanguage
    ) {
      return;
    }

    const reusableSnapshotTranslations = selectReusableCachedTranslations(
      translationSnapshot,
      translationSourceBlocks,
    );
    const incomingCount = countTranslatedBlocks(reusableSnapshotTranslations);

    if (incomingCount === 0) {
      return;
    }

    if (
      blockTranslationTargetLanguage === translationSnapshot.targetLanguage &&
      blockTranslationSourceFingerprintRef.current ===
        translationSourceMetadata.sourceFingerprint &&
      translatedCount >= incomingCount
    ) {
      return;
    }

    blockTranslationSourceFingerprintRef.current =
      translationSourceMetadata.sourceFingerprint;
    setBlockTranslations(reusableSnapshotTranslations);
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
    translationSourceBlocks,
    translationSourceMetadata.sourceFingerprint,
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

      const reusableCachedTranslations = selectReusableCachedTranslations(
        cachedTranslationResult,
        translationSourceBlocks,
      );
      const restoredCount = countTranslatedBlocks(reusableCachedTranslations);

      if (restoredCount === 0) {
        return;
      }

      blockTranslationSourceFingerprintRef.current =
        translationSourceMetadata.sourceFingerprint;
      setBlockTranslations(reusableCachedTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setStatusMessage(
        lRef.current(
          `已恢复历史翻译 ${restoredCount} 条（${settings.translationTargetLanguage}）`,
          `Restored ${restoredCount} saved translations (${settings.translationTargetLanguage})`,
        ),
      );
      updateLibraryOperation(
        "translation",
        "success",
        lRef.current(
          `已恢复历史翻译 ${restoredCount} 条（${settings.translationTargetLanguage}）`,
          `Restored ${restoredCount} saved translations (${settings.translationTargetLanguage})`,
        ),
        restoredCount,
        flatBlocks.length || null,
      );
    })().catch((error) => {
      if (cancelled) {
        return;
      }

      const detail = translationCacheFailureMessage(error);
      const message = lRef.current(
        `读取已保存的全文译文失败：${detail}`,
        `Failed to restore saved full-document translations: ${detail}`,
      );
      console.error('Failed to restore translation cache', error);
      setError(message);
      setStatusMessage(message);
      updateLibraryOperation('translation', 'error', message, null, flatBlocks.length || null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    blockTranslationTargetLanguage,
    currentDocument,
    flatBlocks.length,
    settings.mineruCacheDir,
    settings.translationTargetLanguage,
    setError,
    setStatusMessage,
    translatedCount,
    tryLoadSavedTranslations,
    translationSourceBlocks,
    translationSourceMetadata.sourceFingerprint,
    updateLibraryOperation,
    lRef,
  ]);

  const handleTranslateDocument = useCallback(async () => {
    if (translating || libraryOperationRunning) {
      return;
    }

    const blocksToTranslate = translationSourceBlocks;

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
    let cacheWriteError: unknown = null;

    try {
      const cachedTranslationResult = await tryLoadSavedTranslations(
        currentDocument,
      ).catch((cacheError) => {
        console.warn('Failed to read translation cache before translation resume', cacheError);
        return null;
      });
      const reusableCachedTranslations = selectReusableCachedTranslations(
        cachedTranslationResult,
        blocksToTranslate,
      );
      const reusableSnapshotTranslations =
        translationSnapshot?.targetLanguage === settings.translationTargetLanguage
          ? selectReusableCachedTranslations(translationSnapshot, blocksToTranslate)
          : {};
      const reusableInMemoryTranslations =
        blockTranslationTargetLanguage === settings.translationTargetLanguage &&
        blockTranslationSourceFingerprintRef.current ===
          translationSourceMetadata.sourceFingerprint
          ? selectReusableCachedTranslations(
              {
                ...translationSourceMetadata,
                translations: blockTranslationsRef.current,
              },
              blocksToTranslate,
            )
          : {};
      const resumedTranslations = mergeReaderTranslations(
        mergeReaderTranslations(
          reusableCachedTranslations,
          reusableSnapshotTranslations,
        ),
        reusableInMemoryTranslations,
      );
      const resumedCount = countTranslatedBlocks(resumedTranslations);

      if (resumedCount > 0) {
        blockTranslationSourceFingerprintRef.current =
          translationSourceMetadata.sourceFingerprint;
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
          blockTranslationSourceFingerprintRef.current =
            translationSourceMetadata.sourceFingerprint;
          setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
          setTranslationProgressCompleted(progress.translatedCount);

          if (progress.translatedCount > 0) {
            try {
              await saveTranslationCache(
                currentDocument,
                progress.translations,
                blocksToTranslate,
              );
            } catch (cacheError) {
              cacheWriteError = cacheError;
              console.error('Failed to save translation progress', cacheError);
            }
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

      blockTranslationSourceFingerprintRef.current =
        translationSourceMetadata.sourceFingerprint;
      setBlockTranslations(nextTranslations);
      setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
      setTranslationProgressCompleted(nextTranslatedCount);

      try {
        await saveTranslationCache(currentDocument, nextTranslations, blocksToTranslate);
      } catch (cacheError) {
        cacheWriteError = cacheError;
        console.error('Failed to save completed translation cache', cacheError);
      }

      const cacheStatusSuffix = cacheWriteError
        ? lRef.current(
            '；译文缓存写入失败，本次结果仅保留在当前窗口',
            '; the translation cache could not be written, so this result is only available in the current window',
          )
        : '';

      if (result.cancelled) {
        const remainingCount = Math.max(0, blocksToTranslate.length - nextTranslatedCount);
        const cancelledMessage = lRef.current(
          `已取消全文翻译，已保留 ${nextTranslatedCount} 段译文，剩余 ${remainingCount} 段可再次点击翻译全文继续`,
          `Full-document translation cancelled. Kept ${nextTranslatedCount} translated blocks; click Translate Document again to continue the remaining ${remainingCount}`,
        );

        const finalCancelledMessage = `${cancelledMessage}${cacheStatusSuffix}`;
        setStatusMessage(finalCancelledMessage);
        updateLibraryOperation(
          "translation",
          cacheWriteError ? "error" : "success",
          finalCancelledMessage,
          nextTranslatedCount,
          blocksToTranslate.length,
        );
        if (cacheWriteError) {
          setError(translationCacheFailureMessage(cacheWriteError));
        }
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
      const finalFinishedMessage = `${finishedMessage}${cacheStatusSuffix}`;
      setStatusMessage(finalFinishedMessage);
      updateLibraryOperation(
        "translation",
        failedCount > 0 || cacheWriteError ? "error" : "success",
        finalFinishedMessage,
        nextTranslatedCount,
        blocksToTranslate.length,
      );

      if (cacheWriteError) {
        setError(translationCacheFailureMessage(cacheWriteError));
      } else if (failedCount > 0) {
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
    currentDocument,
    blockTranslationTargetLanguage,
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
    translationSnapshot,
    translationSourceBlocks,
    translationSourceMetadata,
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
      let cacheWriteError: unknown = null;
      const sourceBlocks = translationSourceBlocks;
      const sourceMetadata = translationSourceMetadata;

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

            const reusableInMemoryTranslations =
              blockTranslationTargetLanguage === settings.translationTargetLanguage &&
              blockTranslationSourceFingerprintRef.current ===
                sourceMetadata.sourceFingerprint
                ? selectReusableCachedTranslations(
                    {
                      ...sourceMetadata,
                      translations: blockTranslationsRef.current,
                    },
                    sourceBlocks,
                  )
                : {};
            const mergedTranslations = mergeReaderTranslations(
              reusableInMemoryTranslations,
              progress.translations,
            );

            blockTranslationSourceFingerprintRef.current = sourceMetadata.sourceFingerprint;
            setBlockTranslations(mergedTranslations);
            setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
            setTranslationProgressCompleted(progress.translatedCount);

            if (progress.translatedCount > 0) {
              try {
                await saveTranslationCache(
                  currentDocument,
                  mergedTranslations,
                  sourceBlocks,
                );
              } catch (cacheError) {
                cacheWriteError = cacheError;
                console.error('Failed to save retranslated block progress', cacheError);
              }
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

        const reusableInMemoryTranslations =
          blockTranslationTargetLanguage === settings.translationTargetLanguage &&
          blockTranslationSourceFingerprintRef.current === sourceMetadata.sourceFingerprint
            ? selectReusableCachedTranslations(
                {
                  ...sourceMetadata,
                  translations: blockTranslationsRef.current,
                },
                sourceBlocks,
              )
            : {};
        const nextTranslations = mergeReaderTranslations(
          reusableInMemoryTranslations,
          result.translations,
        );
        const translatedText = result.translations[block.blockId]?.trim() ?? "";

        blockTranslationSourceFingerprintRef.current = sourceMetadata.sourceFingerprint;
        setBlockTranslations(nextTranslations);
        setBlockTranslationTargetLanguage(settings.translationTargetLanguage);
        setTranslationProgressCompleted(translatedText ? 1 : 0);
        try {
          await saveTranslationCache(
            currentDocument,
            nextTranslations,
            sourceBlocks,
          );
        } catch (cacheError) {
          cacheWriteError = cacheError;
          console.error('Failed to save retranslated block', cacheError);
        }

        const cacheStatusSuffix = cacheWriteError
          ? lRef.current(
              '；译文缓存写入失败，本次结果仅保留在当前窗口',
              '; the translation cache could not be written, so this result is only available in the current window',
            )
          : '';

        if (result.cancelled) {
          const message = lRef.current(
            "已取消单块重译，原有译文已保留。",
            "Block retranslation cancelled. Existing translation was kept.",
          );
          const finalMessage = `${message}${cacheStatusSuffix}`;
          setStatusMessage(finalMessage);
          updateLibraryOperation(
            "translation",
            cacheWriteError ? "error" : "success",
            finalMessage,
            translatedText ? 1 : 0,
            1,
          );
          if (cacheWriteError) {
            setError(translationCacheFailureMessage(cacheWriteError));
          }
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
        const finalMessage = `${message}${cacheStatusSuffix}`;
        setStatusMessage(finalMessage);
        updateLibraryOperation(
          "translation",
          cacheWriteError ? "error" : "success",
          finalMessage,
          1,
          1,
        );
        if (cacheWriteError) {
          setError(translationCacheFailureMessage(cacheWriteError));
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
      blockTranslationTargetLanguage,
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
      translationSourceBlocks,
      translationSourceMetadata,
      updateLibraryOperation,
      lRef,
    ],
  );

  const handleClearTranslations = useCallback(() => {
    blockTranslationSourceFingerprintRef.current = "";
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
    blockTranslationSourceFingerprintRef.current = "";
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
