import { useCallback, useEffect, useRef, useState } from 'react';

import { runMineruCloudParse } from '../../services/desktop';
import { resolveSummaryOutputLanguage } from '../../services/summarySource';
import { buildMineruCachePaths } from '../../utils/mineruCache';
import {
  clampBatchConcurrency,
  EMPTY_BATCH_PROGRESS,
  getAutoParseAttemptKey,
  getAutoSummaryAttemptKey,
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
    | 'mineruApiToken'
    | 'saveLibraryMineruParseCache'
    | 'setError'
    | 'setPreferencesOpen'
    | 'setStatusMessage'
    | 'settings'
    | 'summaryConfigured'
    | 'syncLibraryParsedState'
  > {}

export interface UseReaderLibraryBatchActionsResult {
  batchMineruPaused: boolean;
  batchMineruProgress: BatchProgressState;
  batchMineruRunning: boolean;
  batchSummaryPaused: boolean;
  batchSummaryProgress: BatchProgressState;
  batchSummaryRunning: boolean;
  handleBatchGenerateSummaries: (options?: { auto?: boolean }) => Promise<void>;
  handleBatchMineruParse: (options?: { auto?: boolean }) => Promise<void>;
  handleCancelBatchMineru: () => void;
  handleCancelBatchSummary: () => void;
  handleToggleBatchMineruPause: () => void;
  handleToggleBatchSummaryPause: () => void;
}

export function useReaderLibraryBatchActions({
  allKnownItems,
  configHydrated,
  findExistingMineruJson,
  generateLibraryPreview,
  itemParseStatusMap,
  l,
  mineruApiToken,
  saveLibraryMineruParseCache,
  setError,
  setPreferencesOpen,
  setStatusMessage,
  settings,
  summaryConfigured,
  syncLibraryParsedState,
}: UseReaderLibraryBatchActionsOptions): UseReaderLibraryBatchActionsResult {
  const autoMineruAttemptedRef = useRef<Set<string>>(new Set());
  const autoSummaryAttemptedRef = useRef<Set<string>>(new Set());
  const batchMineruRunningRef = useRef(false);
  const batchSummaryRunningRef = useRef(false);
  const batchMineruPausedRef = useRef(false);
  const batchSummaryPausedRef = useRef(false);
  const batchMineruCancelRequestedRef = useRef(false);
  const batchSummaryCancelRequestedRef = useRef(false);

  const [batchMineruRunning, setBatchMineruRunning] = useState(false);
  const [batchSummaryRunning, setBatchSummaryRunning] = useState(false);
  const [batchMineruPaused, setBatchMineruPaused] = useState(false);
  const [batchSummaryPaused, setBatchSummaryPaused] = useState(false);
  const [batchMineruProgress, setBatchMineruProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );

  const handleBatchMineruParse = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchMineruRunningRef.current) {
        return;
      }

      if (!mineruApiToken.trim()) {
        if (!auto) {
          setPreferencesOpen(true);
          setError(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
          setStatusMessage(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
        }
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage(
            l('当前没有可解析的文献', 'No documents are available for parsing'),
          );
        }
        return;
      }

      const candidates = allKnownItems.filter((item) => {
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
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);

      batchMineruRunningRef.current = true;
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
              }).catch(() => null);

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
              parsedCount += 1;
              successCount += 1;
            } catch (nextError) {
              failedCount += 1;
              lastErrorMessage =
                nextError instanceof Error
                  ? nextError.message
                  : l('MinerU 解析失败', 'MinerU parsing failed');
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
            wasCancelled
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
      }

      if (!auto) {
        if (lastErrorMessage && !batchMineruCancelRequestedRef.current) {
          setError(lastErrorMessage);
        }

        setStatusMessage(
          batchMineruCancelRequestedRef.current
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
      findExistingMineruJson,
      l,
      mineruApiToken,
      saveLibraryMineruParseCache,
      setError,
      setPreferencesOpen,
      setStatusMessage,
      settings.libraryBatchConcurrency,
      settings.mineruCacheDir,
      syncLibraryParsedState,
    ],
  );

  const handleBatchGenerateSummaries = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchSummaryRunningRef.current) {
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
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);
      const preparedCandidates = await Promise.all(
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
      allKnownItems,
      findExistingMineruJson,
      generateLibraryPreview,
      l,
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
    if (!configHydrated || !settings.autoMineruParse) {
      return;
    }

    if (batchMineruRunningRef.current) {
      return;
    }

    void handleBatchMineruParse({ auto: true });
  }, [
    allKnownItems,
    configHydrated,
    handleBatchMineruParse,
    settings.autoMineruParse,
  ]);

  useEffect(() => {
    if (!configHydrated || !settings.autoGenerateSummary || !summaryConfigured) {
      return;
    }

    if (batchSummaryRunningRef.current) {
      return;
    }

    void handleBatchGenerateSummaries({ auto: true });
  }, [
    allKnownItems,
    configHydrated,
    handleBatchGenerateSummaries,
    itemParseStatusMap,
    settings.autoGenerateSummary,
    settings.summaryOutputLanguage,
    settings.uiLanguage,
    summaryConfigured,
  ]);

  return {
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
    handleToggleBatchMineruPause,
    handleToggleBatchSummaryPause,
  };
}
