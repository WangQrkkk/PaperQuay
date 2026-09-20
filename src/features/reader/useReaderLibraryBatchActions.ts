import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSummaryOutputLanguage } from '../../services/summarySource';
import { extractTranslatableMarkdownFromMineruBlock } from '../../services/mineru';
import type { WorkspaceItem } from '../../types/reader';
import { buildMineruCachePaths } from '../../utils/mineruCache';
import { runMineruCloudParseWithOcrFallback } from './mineruOcrFallback';
import { createTranslationRequestRateLimiter } from './readerTranslation';
import { buildTranslationSourceMetadata } from './readerTranslationSource';
import {
  getAutoEnglishTranslationAttemptKey,
  type LibraryTranslationRunOptions,
  type LibraryTranslationRunResult,
} from './readerLibraryTranslationBatch';
import {
  clampBatchConcurrency,
  clampMineruBatchConcurrency,
  buildAuthoritativeLibraryBatchItems,
  EMPTY_BATCH_PROGRESS,
  getAutoParseAttemptKey,
  getAutoSummaryAttemptKey,
  isMineruRateLimitError,
  sleep,
  type BatchProgressState,
} from './readerShared';
import type { UseReaderLibraryActionsOptions } from './readerLibraryActionTypes';

interface UseReaderLibraryBatchActionsOptions
  extends Pick<
    UseReaderLibraryActionsOptions,
    | 'allKnownItems'
    | 'configHydrated'
    | 'findExistingMineruJson'
    | 'generateLibraryPreview'
    | 'itemParseStatusMap'
    | 'l'
    | 'loadLibraryBatchItems'
    | 'loadLibraryPreviewBlocks'
    | 'mineruApiToken'
    | 'saveLibraryMineruParseCache'
    | 'setError'
    | 'setPreferencesOpen'
    | 'setStatusMessage'
    | 'settings'
    | 'summaryConfigured'
    | 'syncLibraryParsedState'
  > {
  runLibraryItemTranslation: (
    item: WorkspaceItem,
    options?: LibraryTranslationRunOptions,
  ) => Promise<LibraryTranslationRunResult>;
  translationConfigurationKey: string;
  translationConfigured: boolean;
}

type LibraryBatchKind = 'mineru' | 'summary' | 'translation';

export interface UseReaderLibraryBatchActionsResult {
  batchMineruPaused: boolean;
  batchMineruProgress: BatchProgressState;
  batchMineruRunning: boolean;
  batchTranslationPaused: boolean;
  batchTranslationProgress: BatchProgressState;
  batchTranslationRunning: boolean;
  batchSummaryPaused: boolean;
  batchSummaryProgress: BatchProgressState;
  batchSummaryRunning: boolean;
  handleBatchGenerateSummaries: (options?: { auto?: boolean }) => Promise<void>;
  handleBatchMineruParse: (options?: { auto?: boolean }) => Promise<void>;
  handleBatchTranslateEnglish: (options?: { auto?: boolean }) => Promise<void>;
  handleCancelBatchMineru: () => void;
  handleCancelBatchTranslation: () => void;
  handleCancelBatchSummary: () => void;
  handleToggleBatchMineruPause: () => void;
  handleToggleBatchTranslationPause: () => void;
  handleToggleBatchSummaryPause: () => void;
}

export function useReaderLibraryBatchActions({
  allKnownItems,
  configHydrated,
  findExistingMineruJson,
  generateLibraryPreview,
  itemParseStatusMap,
  l,
  loadLibraryBatchItems,
  loadLibraryPreviewBlocks,
  mineruApiToken,
  runLibraryItemTranslation,
  saveLibraryMineruParseCache,
  setError,
  setPreferencesOpen,
  setStatusMessage,
  settings,
  summaryConfigured,
  syncLibraryParsedState,
  translationConfigurationKey,
  translationConfigured,
}: UseReaderLibraryBatchActionsOptions): UseReaderLibraryBatchActionsResult {
  const autoMineruAttemptedRef = useRef<Set<string>>(new Set());
  const autoTranslationAttemptedRef = useRef<Set<string>>(new Set());
  const autoSummaryAttemptedRef = useRef<Set<string>>(new Set());
  const batchMineruStartingRef = useRef(false);
  const batchMineruRunningRef = useRef(false);
  const batchTranslationRunningRef = useRef(false);
  const batchSummaryRunningRef = useRef(false);
  const batchMineruPausedRef = useRef(false);
  const batchTranslationPausedRef = useRef(false);
  const batchSummaryPausedRef = useRef(false);
  const batchMineruCancelRequestedRef = useRef(false);
  const batchTranslationCancelRequestedRef = useRef(false);
  const batchTranslationRateLimitAbortControllerRef = useRef<AbortController | null>(null);
  const batchSummaryCancelRequestedRef = useRef(false);
  const batchCoordinatorRef = useRef<LibraryBatchKind | null>(null);
  const autoTranslationBlockedSignatureRef = useRef<string | null>(null);
  const autoPipelineRunningRef = useRef(false);
  const autoPipelineRerunRequestedRef = useRef(false);
  const autoPipelineLatestRunRef = useRef<(() => Promise<void>) | null>(null);

  const [batchMineruRunning, setBatchMineruRunning] = useState(false);
  const [batchTranslationRunning, setBatchTranslationRunning] = useState(false);
  const [batchSummaryRunning, setBatchSummaryRunning] = useState(false);
  const [batchMineruPaused, setBatchMineruPaused] = useState(false);
  const [batchTranslationPaused, setBatchTranslationPaused] = useState(false);
  const [batchSummaryPaused, setBatchSummaryPaused] = useState(false);
  const [batchMineruProgress, setBatchMineruProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );
  const [batchTranslationProgress, setBatchTranslationProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );

  const acquireBatchCoordinator = useCallback(
    (kind: LibraryBatchKind, auto: boolean) => {
      if (batchCoordinatorRef.current !== null) {
        if (!auto) {
          setStatusMessage(
            l(
              '另一项全库任务正在运行，请等待其结束后再试。',
              'Another library-wide task is running. Try again after it finishes.',
            ),
          );
        }
        return false;
      }

      batchCoordinatorRef.current = kind;
      return true;
    },
    [l, setStatusMessage],
  );

  const releaseBatchCoordinator = useCallback((kind: LibraryBatchKind) => {
    if (batchCoordinatorRef.current === kind) {
      batchCoordinatorRef.current = null;
    }
  }, []);

  const handleBatchMineruParse = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchMineruStartingRef.current || batchMineruRunningRef.current) {
        return;
      }

      if (!acquireBatchCoordinator('mineru', auto)) {
        return;
      }

      batchMineruStartingRef.current = true;

      if (!auto) {
        setError('');
        setStatusMessage(l('正在刷新完整文库…', 'Refreshing the full library…'));
      }

      if (!mineruApiToken.trim()) {
        if (!auto) {
          setPreferencesOpen(true);
          setError(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
          setStatusMessage(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
        }
        batchMineruStartingRef.current = false;
        releaseBatchCoordinator('mineru');
        return;
      }

      let batchItems = allKnownItems;

      try {
        const libraryItems = await loadLibraryBatchItems();
        batchItems = buildAuthoritativeLibraryBatchItems(allKnownItems, libraryItems);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('加载批处理文库失败', 'Failed to load the library for batch processing');
        setError(message);
        setStatusMessage(message);
        batchMineruStartingRef.current = false;
        releaseBatchCoordinator('mineru');
        return;
      }

      if (batchItems.length === 0) {
        if (!auto) {
          setStatusMessage(
            l('当前没有可解析的文献', 'No documents are available for parsing'),
          );
        }
        batchMineruStartingRef.current = false;
        releaseBatchCoordinator('mineru');
        return;
      }

      const candidates = batchItems.filter((item) => {
        const attemptKey = getAutoParseAttemptKey(item);
        return !(auto && autoMineruAttemptedRef.current.has(attemptKey));
      });

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage(
            l(
              '当前没有需要执行解析的文献',
              'No documents require parsing right now',
            ),
          );
        }
        batchMineruStartingRef.current = false;
        releaseBatchCoordinator('mineru');
        return;
      }

      const concurrency = clampMineruBatchConcurrency(settings.libraryBatchConcurrency);

      batchMineruRunningRef.current = true;
      batchMineruStartingRef.current = false;
      batchMineruPausedRef.current = false;
      batchMineruCancelRequestedRef.current = false;
      setBatchMineruRunning(true);
      setBatchMineruPaused(false);
      setBatchMineruProgress({
        running: true,
        paused: false,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: candidates[0]?.title ?? '',
      });

      let parsedCount = 0;
      let existingCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let completedCount = 0;
      let successCount = 0;
      let lastErrorMessage = '';
      let rateLimited = false;
      let cursor = 0;

      const waitForResumeOrCancel = async () => {
        while (batchMineruPausedRef.current && !batchMineruCancelRequestedRef.current) {
          await sleep(120);
        }

        return batchMineruCancelRequestedRef.current;
      };

      const updateProgress = (currentLabel: string) => {
        setBatchMineruProgress({
          running: true,
          paused: batchMineruPausedRef.current,
          cancelRequested: batchMineruCancelRequestedRef.current,
          total: candidates.length,
          completed: completedCount,
          succeeded: successCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel,
        });
      };

      try {
        const runWorker = async () => {
          while (true) {
            if (await waitForResumeOrCancel()) {
              return;
            }

            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length || batchMineruCancelRequestedRef.current) {
              return;
            }

            const item = candidates[currentIndex];
            const attemptKey = getAutoParseAttemptKey(item);
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${item.title}`;

            if (!auto) {
              setStatusMessage(
                l(
                  `批量 MinerU 解析中：${currentLabel}`,
                  `Running MinerU batch parsing: ${currentLabel}`,
                ),
              );
            }

            updateProgress(currentLabel);

            try {
              const existingParse = await findExistingMineruJson(item);

              if (existingParse) {
                syncLibraryParsedState(
                  item,
                  existingParse.jsonText,
                  existingParse.path,
                  l('已复用已有的 MinerU 结果', 'Reused the existing MinerU result'),
                );
                if (item.source === 'native-library') {
                  window.dispatchEvent(
                    new CustomEvent('paperquay:native-mineru-status-updated', {
                      detail: { paperId: item.itemKey, mineruParsed: true },
                    }),
                  );
                }
                existingCount += 1;
                successCount += 1;
                continue;
              }

              const pdfPath = item.localPdfPath?.trim() ?? '';

              if (!pdfPath) {
                skippedCount += 1;
                continue;
              }

              const cachePaths = settings.mineruCacheDir.trim()
                ? buildMineruCachePaths(settings.mineruCacheDir.trim(), item)
                : null;
              const parseResult = await runMineruCloudParseWithOcrFallback({
                apiToken: mineruApiToken.trim(),
                apiBaseUrl: settings.mineruApiBaseUrl,
                pdfPath,
                extractDir: cachePaths?.directory,
                language: 'ch',
                modelVersion: 'vlm',
                enableFormula: true,
                enableTable: true,
                isOcr: false,
                timeoutSecs: 900,
                pollIntervalSecs: 5,
              }, () => {
                if (!auto) {
                  setStatusMessage(
                    l(
                      `普通解析未返回可用结构，正在以 OCR 重试：${currentLabel}`,
                      `No usable structure was returned. Retrying with OCR: ${currentLabel}`,
                    ),
                  );
                }
              });
              const { result, jsonText } = parseResult;

              if (!jsonText?.trim()) {
                throw new Error(
                  l(
                    'MinerU 未返回可用的 JSON 结果',
                    'MinerU did not return a usable JSON result',
                  ),
                );
              }

              const savedPaths = await saveLibraryMineruParseCache({
                item,
                pdfPath,
                sourceKind: 'cloud',
                contentJsonText: result.contentJsonText,
                middleJsonText: result.middleJsonText,
                markdownText: result.markdownText,
                batchId: result.batchId,
                dataId: result.dataId,
                fileName: result.fileName,
                zipEntries: result.zipEntries,
              });

              const resolvedJsonPath =
                result.contentJsonPath ||
                result.middleJsonPath ||
                (savedPaths
                  ? result.contentJsonText?.trim()
                    ? savedPaths.contentJsonPath
                    : savedPaths.middleJsonPath
                  : 'content_list_v2.json');
              const status = savedPaths
                ? l(
                    `已完成 MinerU 解析并写入缓存：${savedPaths.directory}`,
                    `MinerU parsing finished and was cached in: ${savedPaths.directory}`,
                  )
                : l('已完成 MinerU 解析', 'MinerU parsing finished');

              syncLibraryParsedState(item, jsonText, resolvedJsonPath, status);
              if (item.source === 'native-library') {
                window.dispatchEvent(
                  new CustomEvent('paperquay:native-mineru-status-updated', {
                    detail: { paperId: item.itemKey, mineruParsed: true },
                  }),
                );
              }
              parsedCount += 1;
              successCount += 1;
            } catch (nextError) {
              failedCount += 1;
              lastErrorMessage =
                nextError instanceof Error
                  ? nextError.message
                  : l('MinerU 解析失败', 'MinerU parsing failed');
              if (isMineruRateLimitError(nextError)) {
                rateLimited = true;
                batchMineruCancelRequestedRef.current = true;
              }
            } finally {
              completedCount += 1;
              autoMineruAttemptedRef.current.add(attemptKey);
              updateProgress(currentLabel);
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, candidates.length) }, () => runWorker()),
        );
      } finally {
        const wasCancelled = batchMineruCancelRequestedRef.current;
        batchMineruRunningRef.current = false;
        batchMineruPausedRef.current = false;
        setBatchMineruRunning(false);
        setBatchMineruPaused(false);
        setBatchMineruProgress({
          running: false,
          paused: false,
          cancelRequested: wasCancelled,
          total: candidates.length,
          completed: completedCount,
          succeeded: successCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            rateLimited
              ? l(
                  `MinerU 触发限流，已停止本轮；已完成 ${completedCount}/${candidates.length}`,
                  `MinerU rate limit reached; stopped this run after ${completedCount}/${candidates.length}`,
                )
              : wasCancelled
              ? l(
                  `MinerU 批处理已取消，已完成 ${completedCount}/${candidates.length}`,
                  `MinerU batch cancelled after ${completedCount}/${candidates.length}`,
                )
              : candidates.length > 0
                ? l(
                    `批量解析进度 ${completedCount}/${candidates.length}`,
                    `Batch parse progress ${completedCount}/${candidates.length}`,
                  )
                : '',
        });
        releaseBatchCoordinator('mineru');
      }

      if (!auto) {
        if (lastErrorMessage && !batchMineruCancelRequestedRef.current) {
          setError(lastErrorMessage);
        }

        setStatusMessage(
          rateLimited
            ? l(
                `MinerU 触发限流，已停止本轮：新增 ${parsedCount}，复用 ${existingCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `MinerU rate limit reached; stopped this run: parsed ${parsedCount}, reused ${existingCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : batchMineruCancelRequestedRef.current
            ? l(
                `MinerU 批处理已取消：新增 ${parsedCount}，复用 ${existingCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `MinerU batch cancelled: parsed ${parsedCount}, reused ${existingCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : l(
                `MinerU 批处理完成：新增 ${parsedCount}，复用 ${existingCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `MinerU batch finished: parsed ${parsedCount}, reused ${existingCount}, skipped ${skippedCount}, failed ${failedCount}`,
              ),
        );
      }
    },
    [
      allKnownItems,
      acquireBatchCoordinator,
      findExistingMineruJson,
      l,
      loadLibraryBatchItems,
      mineruApiToken,
      releaseBatchCoordinator,
      saveLibraryMineruParseCache,
      setError,
      setPreferencesOpen,
      setStatusMessage,
      settings.libraryBatchConcurrency,
      settings.mineruCacheDir,
      settings.mineruApiBaseUrl,
      syncLibraryParsedState,
    ],
  );

  const handleBatchTranslateEnglish = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchTranslationRunningRef.current) {
        return;
      }

      if (!auto) {
        autoTranslationBlockedSignatureRef.current = null;
      }

      if (!acquireBatchCoordinator('translation', auto)) {
        return;
      }

      if (!translationConfigured) {
        if (!auto) {
          setPreferencesOpen(true);
          setError(l('缺少可用的翻译模型配置', 'Translation model configuration is missing'));
          setStatusMessage(
            l('缺少可用的翻译模型配置', 'Translation model configuration is missing'),
          );
        }
        releaseBatchCoordinator('translation');
        return;
      }

      let batchItems = allKnownItems;

      try {
        const libraryItems = await loadLibraryBatchItems();
        batchItems = buildAuthoritativeLibraryBatchItems(allKnownItems, libraryItems);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('加载批处理文库失败', 'Failed to load the library for batch processing');
        if (!auto) {
          setError(message);
          setStatusMessage(message);
        }
        releaseBatchCoordinator('translation');
        return;
      }

      let preparedItems: Array<{
        attemptKey: string;
        item: WorkspaceItem;
        sourceFingerprint: string;
      }> = [];

      try {
        preparedItems = (
          await Promise.all(
            batchItems.map(async (item) => {
              try {
                const preview = await loadLibraryPreviewBlocks(item);
                const sourceBlocks = preview.blocks
                  .map((block) => ({
                    blockId: block.blockId,
                    text: extractTranslatableMarkdownFromMineruBlock(block),
                  }))
                  .filter((block) => block.text.trim().length > 0);

                if (sourceBlocks.length === 0) {
                  return null;
                }

                const { sourceFingerprint } = buildTranslationSourceMetadata(sourceBlocks);
                return {
                  attemptKey: getAutoEnglishTranslationAttemptKey(item, sourceFingerprint),
                  item,
                  sourceFingerprint,
                };
              } catch {
                return null;
              }
            }),
          )
        ).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('检查 MinerU 结构化正文失败', 'Failed to inspect MinerU structured text');
        if (!auto) {
          setError(message);
          setStatusMessage(message);
        }
        releaseBatchCoordinator('translation');
        return;
      }

      const runSignature = [
        translationConfigurationKey,
        ...preparedItems.map(({ attemptKey }) => attemptKey).sort(),
      ].join('\u001e');

      if (auto && autoTranslationBlockedSignatureRef.current === runSignature) {
        releaseBatchCoordinator('translation');
        return;
      }

      const candidates = preparedItems.filter(
        ({ attemptKey }) =>
          !(auto && autoTranslationAttemptedRef.current.has(attemptKey)),
      );

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage(
            l(
              '当前没有已完成 MinerU 解析、可检查翻译的论文',
              'No MinerU-parsed papers are ready for translation checks',
            ),
          );
        }
        releaseBatchCoordinator('translation');
        return;
      }

      const waitForTranslationRequestSlot = createTranslationRequestRateLimiter(
        settings.translationRequestsPerMinute,
      );
      const rateLimitAbortController = new AbortController();
      batchTranslationRateLimitAbortControllerRef.current?.abort();
      batchTranslationRateLimitAbortControllerRef.current = rateLimitAbortController;

      batchTranslationRunningRef.current = true;
      batchTranslationPausedRef.current = false;
      batchTranslationCancelRequestedRef.current = false;
      setBatchTranslationRunning(true);
      setBatchTranslationPaused(false);
      setBatchTranslationProgress({
        running: true,
        paused: false,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: candidates[0]?.item.title ?? '',
      });

      let completedCount = 0;
      let succeededCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let rateLimited = false;

      const waitForResumeOrCancel = async () => {
        while (
          batchTranslationPausedRef.current &&
          !batchTranslationCancelRequestedRef.current
        ) {
          await sleep(120);
        }

        return !batchTranslationCancelRequestedRef.current;
      };

      const updateProgress = (currentLabel: string) => {
        setBatchTranslationProgress({
          running: true,
          paused: batchTranslationPausedRef.current,
          cancelRequested: batchTranslationCancelRequestedRef.current,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel,
        });
      };

      try {
        for (let index = 0; index < candidates.length; index += 1) {
          if (!(await waitForResumeOrCancel())) {
            break;
          }

          const candidate = candidates[index];
          const item = candidate.item;
          const currentLabel = `${index + 1}/${candidates.length} ${item.title}`;

          if (!auto) {
            setStatusMessage(
              l(
                `正在检查并翻译英文论文：${currentLabel}`,
                `Checking and translating English papers: ${currentLabel}`,
              ),
            );
          }
          updateProgress(currentLabel);

          try {
            const result = await runLibraryItemTranslation(item, {
              batchSize: 1,
              beforeRequest: () =>
                waitForTranslationRequestSlot(rateLimitAbortController.signal),
              concurrency: 1,
              englishOnly: true,
              quiet: true,
              sourceLanguage: 'English',
              stopOnRateLimit: true,
              targetLanguage: 'Chinese',
              waitForResumeOrCancel,
            });

            if (result.status === 'success') {
              succeededCount += 1;
            } else if (result.status === 'skipped' || result.status === 'cancelled') {
              skippedCount += 1;
            } else {
              failedCount += 1;
            }

            if (result.status === 'rate-limited') {
              rateLimited = true;
              batchTranslationCancelRequestedRef.current = true;
            }
          } catch {
            failedCount += 1;
          } finally {
            completedCount += 1;
            autoTranslationAttemptedRef.current.add(candidate.attemptKey);
            updateProgress(currentLabel);
          }

          if (rateLimited || batchTranslationCancelRequestedRef.current) {
            break;
          }
        }
      } finally {
        const wasCancelled =
          batchTranslationCancelRequestedRef.current && !rateLimited;
        if (rateLimited || wasCancelled) {
          autoTranslationBlockedSignatureRef.current = runSignature;
        }
        batchTranslationRunningRef.current = false;
        batchTranslationPausedRef.current = false;
        rateLimitAbortController.abort();
        if (
          batchTranslationRateLimitAbortControllerRef.current === rateLimitAbortController
        ) {
          batchTranslationRateLimitAbortControllerRef.current = null;
        }
        setBatchTranslationRunning(false);
        setBatchTranslationPaused(false);
        setBatchTranslationProgress({
          running: false,
          paused: false,
          cancelRequested: wasCancelled,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel: rateLimited
            ? l(
                `翻译服务触发 429 限流，已停止本轮；已完成 ${completedCount}/${candidates.length}`,
                `Translation hit a 429 rate limit; stopped after ${completedCount}/${candidates.length}`,
              )
            : wasCancelled
              ? l(
                  `英文论文批量翻译已取消，已完成 ${completedCount}/${candidates.length}`,
                  `English-paper batch translation cancelled after ${completedCount}/${candidates.length}`,
                )
              : l(
                  `英文论文批量翻译进度 ${completedCount}/${candidates.length}`,
                  `English-paper batch translation progress ${completedCount}/${candidates.length}`,
                ),
        });
        releaseBatchCoordinator('translation');
      }

      if (!auto || rateLimited) {
        setStatusMessage(
          rateLimited
            ? l(
                `翻译服务触发 429 限流，已停止本轮：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `Translation hit a 429 rate limit and stopped: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : batchTranslationCancelRequestedRef.current
              ? l(
                  `英文论文批量翻译已取消：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                  `English-paper batch translation cancelled: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
                )
              : l(
                  `英文论文批量翻译完成：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                  `English-paper batch translation finished: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
                ),
        );
      }
    },
    [
      allKnownItems,
      acquireBatchCoordinator,
      l,
      loadLibraryBatchItems,
      loadLibraryPreviewBlocks,
      releaseBatchCoordinator,
      runLibraryItemTranslation,
      setError,
      setPreferencesOpen,
      setStatusMessage,
      settings.translationRequestsPerMinute,
      translationConfigurationKey,
      translationConfigured,
    ],
  );

  const handleBatchGenerateSummaries = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchSummaryRunningRef.current) {
        return;
      }

      if (!acquireBatchCoordinator('summary', auto)) {
        return;
      }

      if (!summaryConfigured) {
        if (!auto) {
          setPreferencesOpen(true);
          setError(l('缺少概览模型配置', 'Overview model configuration is missing'));
          setStatusMessage(
            l('缺少概览模型配置', 'Overview model configuration is missing'),
          );
        }
        releaseBatchCoordinator('summary');
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage(
            l(
              '当前没有可生成概览的文献',
              'No documents are available for overview generation',
            ),
          );
        }
        releaseBatchCoordinator('summary');
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);
      let preparedCandidates: Array<{
        attemptKey: string;
        hasParse: boolean;
        item: WorkspaceItem;
      }>;
      try {
        preparedCandidates = await Promise.all(
          allKnownItems.map(async (item) => {
            const parseResult =
              settings.summarySourceMode === 'mineru-markdown'
                ? await findExistingMineruJson(item)
                : null;
            const hasParse = Boolean(parseResult);
            const attemptKey = getAutoSummaryAttemptKey(
              item,
              settings.summarySourceMode,
              resolveSummaryOutputLanguage(settings),
              hasParse,
            );

            return {
              item,
              hasParse,
              attemptKey,
            };
          }),
        );
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('检查概览候选失败', 'Failed to inspect overview candidates');
        if (!auto) {
          setError(message);
          setStatusMessage(message);
        }
        releaseBatchCoordinator('summary');
        return;
      }
      const candidates = preparedCandidates.filter(
        ({ attemptKey }) => !(auto && autoSummaryAttemptedRef.current.has(attemptKey)),
      );

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage(
            l(
              '当前没有需要生成概览的文献',
              'No documents require overview generation right now',
            ),
          );
        }
        releaseBatchCoordinator('summary');
        return;
      }

      batchSummaryRunningRef.current = true;
      batchSummaryPausedRef.current = false;
      batchSummaryCancelRequestedRef.current = false;
      setBatchSummaryRunning(true);
      setBatchSummaryPaused(false);
      setBatchSummaryProgress({
        running: true,
        paused: false,
        cancelRequested: false,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: candidates[0]?.item.title ?? '',
      });

      let succeededCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let completedCount = 0;
      let cursor = 0;

      const waitForResumeOrCancel = async () => {
        while (batchSummaryPausedRef.current && !batchSummaryCancelRequestedRef.current) {
          await sleep(120);
        }

        return batchSummaryCancelRequestedRef.current;
      };

      const updateProgress = (currentLabel: string) => {
        setBatchSummaryProgress({
          running: true,
          paused: batchSummaryPausedRef.current,
          cancelRequested: batchSummaryCancelRequestedRef.current,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel,
        });
      };

      try {
        const runWorker = async () => {
          while (true) {
            if (await waitForResumeOrCancel()) {
              return;
            }

            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length || batchSummaryCancelRequestedRef.current) {
              return;
            }

            const candidate = candidates[currentIndex];
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${candidate.item.title}`;

            if (!auto) {
              setStatusMessage(
                l(
                  `正在批量生成概览：${currentLabel}`,
                  `Generating overviews in batch: ${currentLabel}`,
                ),
              );
            }

            updateProgress(currentLabel);

            try {
              if (
                settings.summarySourceMode === 'pdf-text' &&
                !candidate.item.localPdfPath?.trim()
              ) {
                skippedCount += 1;
                continue;
              }

              if (settings.summarySourceMode === 'mineru-markdown' && !candidate.hasParse) {
                skippedCount += 1;
                continue;
              }

              const outcome = await generateLibraryPreview(candidate.item, false, {
                allowGenerate: true,
              });

              if (outcome === 'failed') {
                failedCount += 1;
              } else if (outcome === 'skipped') {
                skippedCount += 1;
              } else {
                succeededCount += 1;
              }
            } finally {
              completedCount += 1;
              autoSummaryAttemptedRef.current.add(candidate.attemptKey);
              updateProgress(currentLabel);
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, candidates.length) }, () => runWorker()),
        );
      } finally {
        const wasCancelled = batchSummaryCancelRequestedRef.current;
        batchSummaryRunningRef.current = false;
        batchSummaryPausedRef.current = false;
        setBatchSummaryRunning(false);
        setBatchSummaryPaused(false);
        setBatchSummaryProgress({
          running: false,
          paused: false,
          cancelRequested: wasCancelled,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            wasCancelled
              ? l(
                  `批量概览已取消，已完成 ${completedCount}/${candidates.length}`,
                  `Batch overview cancelled after ${completedCount}/${candidates.length}`,
                )
              : candidates.length > 0
                ? l(
                    `批量概览进度 ${completedCount}/${candidates.length}`,
                    `Batch overview progress ${completedCount}/${candidates.length}`,
                  )
                : '',
        });
        releaseBatchCoordinator('summary');
      }

      if (!auto) {
        setStatusMessage(
          batchSummaryCancelRequestedRef.current
            ? l(
                `概览批处理已取消：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `Overview batch cancelled: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : l(
                `概览批处理完成：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `Overview batch finished: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
              ),
        );
      }
    },
    [
      acquireBatchCoordinator,
      allKnownItems,
      findExistingMineruJson,
      generateLibraryPreview,
      l,
      releaseBatchCoordinator,
      setError,
      setPreferencesOpen,
      setStatusMessage,
      settings,
      summaryConfigured,
    ],
  );

  const handleToggleBatchMineruPause = useCallback(() => {
    if (!batchMineruRunningRef.current) {
      return;
    }

    const nextPaused = !batchMineruPausedRef.current;
    batchMineruPausedRef.current = nextPaused;
    setBatchMineruPaused(nextPaused);
    setBatchMineruProgress((current) =>
      current.running
        ? {
            ...current,
            paused: nextPaused,
            cancelRequested: batchMineruCancelRequestedRef.current,
          }
        : current,
    );
    setStatusMessage(
      nextPaused
        ? l('已暂停 MinerU 批量解析', 'Paused the MinerU batch parsing')
        : l('已继续 MinerU 批量解析', 'Resumed the MinerU batch parsing'),
    );
  }, [l, setStatusMessage]);

  const handleCancelBatchMineru = useCallback(() => {
    if (!batchMineruRunningRef.current || batchMineruCancelRequestedRef.current) {
      return;
    }

    batchMineruCancelRequestedRef.current = true;
    batchMineruPausedRef.current = false;
    setBatchMineruPaused(false);
    setBatchMineruProgress((current) =>
      current.running
        ? {
            ...current,
            paused: false,
            cancelRequested: true,
            currentLabel:
              current.currentLabel ||
              l(
                '正在等待当前任务结束后取消…',
                'Waiting for the current task to finish before cancelling...',
              ),
          }
        : current,
    );
    setStatusMessage(
      l(
        '正在取消 MinerU 批量解析，当前进行中的任务完成后将停止。',
        'Cancelling the MinerU batch parsing. It will stop after the current tasks finish.',
      ),
    );
  }, [l, setStatusMessage]);

  const handleToggleBatchTranslationPause = useCallback(() => {
    if (!batchTranslationRunningRef.current) {
      return;
    }

    const nextPaused = !batchTranslationPausedRef.current;
    batchTranslationPausedRef.current = nextPaused;
    setBatchTranslationPaused(nextPaused);
    setBatchTranslationProgress((current) =>
      current.running
        ? {
            ...current,
            paused: nextPaused,
            cancelRequested: batchTranslationCancelRequestedRef.current,
          }
        : current,
    );
    setStatusMessage(
      nextPaused
        ? l('已暂停英文论文批量翻译', 'Paused English-paper batch translation')
        : l('已继续英文论文批量翻译', 'Resumed English-paper batch translation'),
    );
  }, [l, setStatusMessage]);

  const handleCancelBatchTranslation = useCallback(() => {
    if (
      !batchTranslationRunningRef.current ||
      batchTranslationCancelRequestedRef.current
    ) {
      return;
    }

    batchTranslationCancelRequestedRef.current = true;
    batchTranslationPausedRef.current = false;
    batchTranslationRateLimitAbortControllerRef.current?.abort();
    setBatchTranslationPaused(false);
    setBatchTranslationProgress((current) =>
      current.running
        ? {
            ...current,
            paused: false,
            cancelRequested: true,
            currentLabel:
              current.currentLabel ||
              l(
                '等待当前翻译请求完成并保存后停止…',
                'Waiting for the current translation request to finish and save before stopping...',
              ),
          }
        : current,
    );
    setStatusMessage(
      l(
        '当前翻译请求完成并写入缓存后停止；其返回译文会保留。',
        'The batch will stop after the current translation request is saved; its returned translation will be kept.',
      ),
    );
  }, [l, setStatusMessage]);

  const handleToggleBatchSummaryPause = useCallback(() => {
    if (!batchSummaryRunningRef.current) {
      return;
    }

    const nextPaused = !batchSummaryPausedRef.current;
    batchSummaryPausedRef.current = nextPaused;
    setBatchSummaryPaused(nextPaused);
    setBatchSummaryProgress((current) =>
      current.running
        ? {
            ...current,
            paused: nextPaused,
            cancelRequested: batchSummaryCancelRequestedRef.current,
          }
        : current,
    );
    setStatusMessage(
      nextPaused
        ? l('已暂停批量概览生成', 'Paused the batch overview generation')
        : l('已继续批量概览生成', 'Resumed the batch overview generation'),
    );
  }, [l, setStatusMessage]);

  const handleCancelBatchSummary = useCallback(() => {
    if (!batchSummaryRunningRef.current || batchSummaryCancelRequestedRef.current) {
      return;
    }

    batchSummaryCancelRequestedRef.current = true;
    batchSummaryPausedRef.current = false;
    setBatchSummaryPaused(false);
    setBatchSummaryProgress((current) =>
      current.running
        ? {
            ...current,
            paused: false,
            cancelRequested: true,
            currentLabel:
              current.currentLabel ||
              l(
                '正在等待当前任务结束后取消…',
                'Waiting for the current task to finish before cancelling...',
              ),
          }
        : current,
    );
    setStatusMessage(
      l(
        '正在取消批量概览生成，当前进行中的任务完成后将停止。',
        'Cancelling the batch overview generation. It will stop after the current tasks finish.',
      ),
    );
  }, [l, setStatusMessage]);

  useEffect(() => {
    autoMineruAttemptedRef.current.clear();
  }, [
    mineruApiToken,
    settings.mineruApiBaseUrl,
    settings.autoLoadSiblingJson,
    settings.autoMineruParse,
    settings.mineruCacheDir,
  ]);

  useEffect(() => {
    autoSummaryAttemptedRef.current.clear();
  }, [
    settings.autoGenerateSummary,
    settings.autoLoadSiblingJson,
    settings.mineruCacheDir,
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
    summaryConfigured,
  ]);

  useEffect(() => {
    autoTranslationAttemptedRef.current.clear();
    autoTranslationBlockedSignatureRef.current = null;
  }, [
    settings.autoLoadSiblingJson,
    settings.autoTranslateEnglishLibrary,
    settings.mineruCacheDir,
    translationConfigurationKey,
    translationConfigured,
  ]);

  useEffect(() => {
    if (
      !configHydrated ||
      (!settings.autoMineruParse &&
        !settings.autoGenerateSummary &&
        !settings.autoTranslateEnglishLibrary)
    ) {
      return;
    }

    autoPipelineLatestRunRef.current = async () => {
      if (settings.autoMineruParse) {
        await handleBatchMineruParse({ auto: true });
      }

      if (settings.autoGenerateSummary && summaryConfigured) {
        await handleBatchGenerateSummaries({ auto: true });
      }

      if (settings.autoTranslateEnglishLibrary && translationConfigured) {
        await handleBatchTranslateEnglish({ auto: true });
      }
    };

    if (autoPipelineRunningRef.current) {
      autoPipelineRerunRequestedRef.current = true;
      return;
    }

    autoPipelineRunningRef.current = true;
    void (async () => {
      try {
        do {
          autoPipelineRerunRequestedRef.current = false;
          await autoPipelineLatestRunRef.current?.();
        } while (autoPipelineRerunRequestedRef.current);
      } finally {
        autoPipelineRunningRef.current = false;
      }
    })();
  }, [
    allKnownItems,
    batchMineruRunning,
    batchSummaryRunning,
    batchTranslationRunning,
    configHydrated,
    handleBatchGenerateSummaries,
    handleBatchMineruParse,
    handleBatchTranslateEnglish,
    itemParseStatusMap,
    settings.autoGenerateSummary,
    settings.autoMineruParse,
    settings.autoTranslateEnglishLibrary,
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
    summaryConfigured,
    translationConfigured,
  ]);

  return {
    batchMineruPaused,
    batchMineruProgress,
    batchMineruRunning,
    batchTranslationPaused,
    batchTranslationProgress,
    batchTranslationRunning,
    batchSummaryPaused,
    batchSummaryProgress,
    batchSummaryRunning,
    handleBatchGenerateSummaries,
    handleBatchMineruParse,
    handleBatchTranslateEnglish,
    handleCancelBatchMineru,
    handleCancelBatchTranslation,
    handleCancelBatchSummary,
    handleToggleBatchMineruPause,
    handleToggleBatchTranslationPause,
    handleToggleBatchSummaryPause,
  };
}
