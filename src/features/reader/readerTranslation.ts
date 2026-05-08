import {
  readLocalTextFile,
  writeLocalTextFile,
} from '../../services/desktop';
import { translateBlocksOpenAICompatible } from '../../services/translation';
import type {
  OpenAICompatibleTranslateOptions,
  TranslationBlockInput,
  TranslationBlockOutput,
  TranslationMap,
  WorkspaceItem,
} from '../../types/reader';
import {
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
} from '../../utils/mineruCache';
import type { TranslationCacheEnvelope } from './readerShared';

export type TranslationTextFn = (zh: string, en: string) => string;

export interface TranslationCacheReadResult {
  path: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

export interface IncrementalTranslationProgress {
  failedBlockCount: number;
  pendingCount: number;
  totalBlocks: number;
  translatedCount: number;
  translations: TranslationMap;
}

export interface IncrementalTranslationResult {
  failedBlocks: TranslationBlockInput[];
  failureMessages: string[];
  totalBlocks: number;
  translatedCount: number;
  translations: TranslationMap;
}

export interface TranslateBlocksBestEffortOptions {
  apiKey: string;
  baseUrl: string;
  batchSize: number;
  blocks: TranslationBlockInput[];
  concurrency: number;
  existingTranslations?: TranslationMap;
  model: string;
  onProgress?: (progress: IncrementalTranslationProgress) => Promise<void> | void;
  reasoningEffort?: OpenAICompatibleTranslateOptions['reasoningEffort'];
  requestsPerMinute?: number;
  sourceLanguage: string;
  targetLanguage: string;
  temperature?: number;
  translateBatch?: (
    options: OpenAICompatibleTranslateOptions,
  ) => Promise<TranslationBlockOutput[]>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}

function normalizeTranslationMap(translations: TranslationMap | null | undefined): TranslationMap {
  const normalized: TranslationMap = {};

  if (!translations) {
    return normalized;
  }

  for (const [blockId, translatedText] of Object.entries(translations)) {
    const nextBlockId = blockId.trim();
    const nextTranslatedText = translatedText.trim();

    if (!nextBlockId || !nextTranslatedText) {
      continue;
    }

    normalized[nextBlockId] = nextTranslatedText;
  }

  return normalized;
}

function mergeTranslationMaps(...translationMaps: Array<TranslationMap | null | undefined>): TranslationMap {
  const merged: TranslationMap = {};

  for (const translationMap of translationMaps) {
    Object.assign(merged, normalizeTranslationMap(translationMap));
  }

  return merged;
}

function chunkTranslationBlocks(
  blocks: TranslationBlockInput[],
  size: number,
): TranslationBlockInput[][] {
  const nextSize = Math.max(1, size);
  const chunks: TranslationBlockInput[][] = [];

  for (let index = 0; index < blocks.length; index += nextSize) {
    chunks.push(blocks.slice(index, index + nextSize));
  }

  return chunks;
}

function buildAllowedTranslationMap(
  translations: TranslationMap | null | undefined,
  allowedBlockIds: Set<string>,
): TranslationMap {
  const normalized = normalizeTranslationMap(translations);
  const nextTranslations: TranslationMap = {};

  for (const [blockId, translatedText] of Object.entries(normalized)) {
    if (!allowedBlockIds.has(blockId)) {
      continue;
    }

    nextTranslations[blockId] = translatedText;
  }

  return nextTranslations;
}

function buildRequestedBlockIds(blocks: TranslationBlockInput[]): Set<string> {
  return new Set(
    blocks
      .map((block) => block.blockId.trim())
      .filter((blockId) => blockId.length > 0),
  );
}

export function countTranslatedBlocks(translations: TranslationMap | null | undefined): number {
  return Object.keys(normalizeTranslationMap(translations)).length;
}

export function getPendingTranslationBlocks(
  blocks: TranslationBlockInput[],
  existingTranslations: TranslationMap | null | undefined,
): TranslationBlockInput[] {
  const normalizedTranslations = normalizeTranslationMap(existingTranslations);

  return blocks.filter((block) => !normalizedTranslations[block.blockId]?.trim());
}

export function sanitizeTranslationErrorMessage(
  error: unknown,
  l: TranslationTextFn,
  context: 'document' | 'selection' = 'document',
): string {
  const message = toErrorMessage(error).trim();

  if (!message) {
    return context === 'selection'
      ? l(
          '划词翻译失败，请稍后重试。',
          'Selected-text translation failed. Please try again later.',
        )
      : l('全文翻译失败，请稍后重试。', 'Full-document translation failed. Please try again later.');
  }

  if (
    message.includes('Translation output was not valid JSON') ||
    message.includes('Fallback translation returned empty text') ||
    message.includes('Translation did not produce usable content')
  ) {
    return context === 'selection'
      ? l(
          '模型没有返回可用的划词译文，请稍后重试，或更换翻译模型后再试。',
          'The model did not return a usable translation for the selected text. Try again later or switch to another translation model.',
        )
      : l(
          '部分翻译请求没有返回可用内容，已保留成功译文。请稍后重试剩余部分，或更换翻译模型后再试。',
          'Some translation requests did not return usable content. Successful translations were kept. Retry the remaining parts later or switch to another translation model.',
        );
  }

  return message;
}

export async function readTranslationCache({
  item,
  mineruCacheDir,
  targetLanguage,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  targetLanguage: string;
}): Promise<TranslationCacheReadResult | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidatePaths = buildMineruTranslationCachePathCandidates(
    mineruCacheDir.trim(),
    item,
    targetLanguage,
  );

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readLocalTextFile(candidatePath);
      const parsed = JSON.parse(raw) as Partial<TranslationCacheEnvelope>;
      const translations = normalizeTranslationMap(parsed?.translations);

      if (Object.keys(translations).length === 0) {
        continue;
      }

      return {
        path: candidatePath,
        sourceLanguage: parsed?.sourceLanguage ?? '',
        targetLanguage: parsed?.targetLanguage ?? targetLanguage,
        translatedAt: parsed?.translatedAt ?? '',
        translations,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function writeTranslationCache({
  item,
  mineruCacheDir,
  sourceLanguage,
  targetLanguage,
  translations,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  translations: TranslationMap;
}) {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const normalizedTranslations = normalizeTranslationMap(translations);
  const cachePath = buildMineruTranslationCachePath(
    mineruCacheDir.trim(),
    item,
    targetLanguage,
  );
  const payload: TranslationCacheEnvelope = {
    version: 1,
    sourceLanguage,
    targetLanguage,
    translatedAt: new Date().toISOString(),
    translations: normalizedTranslations,
  };

  await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
  return cachePath;
}

export async function translateBlocksBestEffort({
  apiKey,
  baseUrl,
  batchSize,
  blocks,
  concurrency,
  existingTranslations,
  model,
  onProgress,
  reasoningEffort,
  requestsPerMinute,
  sourceLanguage,
  targetLanguage,
  temperature,
  translateBatch = translateBlocksOpenAICompatible,
}: TranslateBlocksBestEffortOptions): Promise<IncrementalTranslationResult> {
  const requestedBlocks = blocks.filter((block) => block.text.trim().length > 0);
  const requestedBlockIds = buildRequestedBlockIds(requestedBlocks);
  const collectedTranslations = new Map<string, string>(
    Object.entries(buildAllowedTranslationMap(existingTranslations, requestedBlockIds)),
  );
  const failedBlocksById = new Map<string, TranslationBlockInput>();
  const failureMessages: string[] = [];
  const pendingBlocks = getPendingTranslationBlocks(
    requestedBlocks,
    Object.fromEntries(collectedTranslations),
  );
  const batches = chunkTranslationBlocks(pendingBlocks, batchSize);

  if (requestedBlocks.length === 0) {
    return {
      failedBlocks: [],
      failureMessages: [],
      totalBlocks: 0,
      translatedCount: 0,
      translations: {},
    };
  }

  let progressChain = Promise.resolve();
  const emitProgress = () => {
    if (!onProgress) {
      return progressChain;
    }

    const translations = Object.fromEntries(collectedTranslations);
    const translatedCount = Object.keys(translations).length;

    progressChain = progressChain.then(() =>
      onProgress({
        failedBlockCount: failedBlocksById.size,
        pendingCount: Math.max(0, requestedBlocks.length - translatedCount),
        totalBlocks: requestedBlocks.length,
        translatedCount,
        translations,
      }),
    );

    return progressChain;
  };

  if (batches.length === 0) {
    await emitProgress();

    const translations = Object.fromEntries(collectedTranslations);

    return {
      failedBlocks: [],
      failureMessages: [],
      totalBlocks: requestedBlocks.length,
      translatedCount: Object.keys(translations).length,
      translations,
    };
  }

  let cursor = 0;
  const runWorker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= batches.length) {
        return;
      }

      const batch = batches[currentIndex];

      try {
        const outputs = await translateBatch({
          apiKey,
          baseUrl,
          batchSize: batch.length,
          blocks: batch,
          concurrency: 1,
          model,
          reasoningEffort,
          requestsPerMinute,
          sourceLanguage,
          targetLanguage,
          temperature,
        });
        const nextTranslations = new Map<string, string>();

        for (const output of outputs) {
          const translatedText = output.translatedText.trim();

          if (!translatedText) {
            continue;
          }

          nextTranslations.set(output.blockId, translatedText);
        }

        if (nextTranslations.size === 0) {
          failureMessages.push('Translation returned no usable content.');

          for (const block of batch) {
            failedBlocksById.set(block.blockId, block);
          }

          await emitProgress();
          continue;
        }

        for (const block of batch) {
          const translatedText = nextTranslations.get(block.blockId);

          if (!translatedText) {
            failedBlocksById.set(block.blockId, block);
            continue;
          }

          collectedTranslations.set(block.blockId, translatedText);
          failedBlocksById.delete(block.blockId);
        }

        await emitProgress();
      } catch (error) {
        const message = toErrorMessage(error).trim();

        if (message) {
          failureMessages.push(message);
        }

        for (const block of batch) {
          failedBlocksById.set(block.blockId, block);
        }

        await emitProgress();
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), batches.length) }, () => runWorker()),
  );
  await progressChain;

  const translations = Object.fromEntries(collectedTranslations);

  return {
    failedBlocks: requestedBlocks.filter((block) => !translations[block.blockId]?.trim()),
    failureMessages,
    totalBlocks: requestedBlocks.length,
    translatedCount: Object.keys(translations).length,
    translations,
  };
}

export function mergeReaderTranslations(
  currentTranslations: TranslationMap | null | undefined,
  incomingTranslations: TranslationMap | null | undefined,
): TranslationMap {
  return mergeTranslationMaps(currentTranslations, incomingTranslations);
}
