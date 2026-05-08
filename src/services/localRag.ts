import type { PositionedMineruBlock, ReaderSettings, WorkspaceItem } from '../types/reader';
import {
  buildRagContextText,
  buildRagRetrievalQuery,
  prepareReaderRagDocument,
} from '../features/reader/readerRag';
import type { LocalRagResolution } from '../features/reader/readerQaContext';
import { summarizeRagIndexStatuses } from '../features/reader/readerQaContext';
import {
  buildRagEmbeddingModelKey,
  embedRagChunks,
  embedRagText,
  ragGetDocumentIndexStatus,
  ragIndexDocument,
  ragReportDocumentIndexFailure,
  ragRetrieveDocumentChunks,
  type RagEmbeddingOptions,
} from './rag';

const RAG_INDEX_FAILURE_COOLDOWN_MS = 60_000;
const RAG_RESULT_MIN_MARGIN = 0.12;
const RAG_RESULT_MAX_MARGIN = 0.45;
const RAG_RESULT_RELATIVE_MARGIN = 0.4;

const ragIndexFailureCache = new Map<string, { failedAt: number; message: string }>();

function ragFailureCacheKey(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
): string {
  return `${documentKey}::${sourceType}::${sourceSignature}::${embeddingModelKey}`;
}

function getCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
) {
  const key = ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey);
  const cached = ragIndexFailureCache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.failedAt > RAG_INDEX_FAILURE_COOLDOWN_MS) {
    ragIndexFailureCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
  message: string,
) {
  ragIndexFailureCache.set(
    ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey),
    {
      failedAt: Date.now(),
      message,
    },
  );
}

function clearCachedRagIndexFailure(
  documentKey: string,
  sourceType: string,
  sourceSignature: string,
  embeddingModelKey: string,
) {
  ragIndexFailureCache.delete(
    ragFailureCacheKey(documentKey, sourceType, sourceSignature, embeddingModelKey),
  );
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }

  return chunks;
}

function shouldSkipFailedStatus(cooldownUntil?: number | null) {
  return typeof cooldownUntil === 'number' && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now();
}

function filterRelevantRetrievals(
  results: Awaited<ReturnType<typeof ragRetrieveDocumentChunks>>,
  topK: number,
) {
  if (results.length <= 1) {
    return results.slice(0, topK);
  }

  const sorted = [...results].sort((left, right) => left.score - right.score);
  const bestScore = sorted[0]?.score ?? 0;
  const dynamicMargin = Math.max(
    RAG_RESULT_MIN_MARGIN,
    Math.min(RAG_RESULT_MAX_MARGIN, Math.abs(bestScore) * RAG_RESULT_RELATIVE_MARGIN),
  );
  const threshold = bestScore + dynamicMargin;
  const filtered = sorted.filter((result, index) => index === 0 || result.score <= threshold);

  return (filtered.length > 0 ? filtered : sorted).slice(0, topK);
}

async function ensurePreparedSourceIndexed(input: {
  documentKey: string;
  title: string;
  sourceType: 'mineru-markdown' | 'pdf-text';
  sourceSignature: string;
  chunks: Array<{
    chunkId: string;
    chunkIndex: number;
    pageIndex: number | null;
    blockId?: string | null;
    text: string;
  }>;
  embedding: RagEmbeddingOptions;
  batchSize: number;
}) {
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const currentStatus = await ragGetDocumentIndexStatus(input.documentKey, input.sourceType);
  const cachedFailure = getCachedRagIndexFailure(
    input.documentKey,
    input.sourceType,
    input.sourceSignature,
    embeddingModelKey,
  );

  if (
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey &&
    currentStatus.indexedChunkCount >= input.chunks.length &&
    currentStatus.status === 'ready'
  ) {
    clearCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
    );
    return;
  }

  if (
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey &&
    currentStatus.status === 'failed' &&
    shouldSkipFailedStatus(currentStatus.cooldownUntil)
  ) {
    return;
  }

  if (cachedFailure) {
    return;
  }

  const alreadyIndexedCount =
    currentStatus?.sourceSignature === input.sourceSignature &&
    currentStatus.embeddingModelKey === embeddingModelKey
      ? Math.max(0, currentStatus.indexedChunkCount)
      : 0;
  const remainingChunks = input.chunks.slice(alreadyIndexedCount);

  if (remainingChunks.length === 0) {
    return;
  }

  try {
    for (const batch of chunkItems(remainingChunks, input.batchSize)) {
      const indexedChunks = await embedRagChunks(batch, input.embedding);
      const indexedChunkById = new Map(indexedChunks.map((chunk) => [chunk.chunkId, chunk]));
      const contiguousReadyChunks = [];

      for (const chunk of batch) {
        const indexedChunk = indexedChunkById.get(chunk.chunkId);

        if (!indexedChunk) {
          break;
        }

        contiguousReadyChunks.push(indexedChunk);
      }

      if (contiguousReadyChunks.length > 0) {
        await ragIndexDocument({
          documentKey: input.documentKey,
          title: input.title,
          sourceType: input.sourceType,
          sourceSignature: input.sourceSignature,
          embeddingModelKey,
          totalChunkCount: input.chunks.length,
          chunks: contiguousReadyChunks,
        });
      }

      if (contiguousReadyChunks.length !== batch.length) {
        throw new Error(`Embedding service returned incomplete vectors for ${input.sourceType}`);
      }
    }

    clearCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    setCachedRagIndexFailure(
      input.documentKey,
      input.sourceType,
      input.sourceSignature,
      embeddingModelKey,
      message,
    );
    await ragReportDocumentIndexFailure({
      documentKey: input.documentKey,
      title: input.title,
      sourceType: input.sourceType,
      sourceSignature: input.sourceSignature,
      embeddingModelKey,
      totalChunkCount: input.chunks.length,
      errorMessage: message,
      retryAfterMs: RAG_INDEX_FAILURE_COOLDOWN_MS,
    });
  }
}

export async function resolveLocalRagContext(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}): Promise<string> {
  const result = await resolveLocalRag(input);
  return result.kind === 'retrieved' ? result.documentText : '';
}

export async function resolveLocalRag(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}): Promise<LocalRagResolution> {
  if (!input.settings.localRagEnabled || input.settings.ragSourceMode === 'off') {
    return {
      kind: 'disabled',
    };
  }

  const preparedDocument = prepareReaderRagDocument({
    item: input.item,
    settings: input.settings,
    mineruBlocks: input.mineruBlocks,
    mineruDocumentText: input.mineruDocumentText,
    pdfDocumentText: input.pdfDocumentText,
  });

  if (preparedDocument.sources.length === 0) {
    return {
      kind: 'no-sources',
    };
  }

  try {
    for (const source of preparedDocument.sources) {
      await ensurePreparedSourceIndexed({
        documentKey: preparedDocument.documentKey,
        title: preparedDocument.title,
        sourceType: source.sourceType,
        sourceSignature: source.sourceSignature,
        chunks: source.chunks,
        embedding: input.embedding,
        batchSize: Math.max(1, input.settings.embeddingBatchSize || 24),
      });
    }
  } catch (error) {
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const statuses = await Promise.all(
    preparedDocument.sources.map((source) =>
      ragGetDocumentIndexStatus(preparedDocument.documentKey, source.sourceType),
    ),
  );
  const statusSummary = summarizeRagIndexStatuses(statuses);
  const embeddingModelKey = buildRagEmbeddingModelKey(input.embedding);
  const readySources = preparedDocument.sources.filter((source, index) => {
    const status = statuses[index];

    return (
      status?.status === 'ready' &&
      status.sourceSignature === source.sourceSignature &&
      status.embeddingModelKey === embeddingModelKey
    );
  });
  const hasFailedSource = statuses.some((status, index) => {
    const source = preparedDocument.sources[index];

    return (
      status?.status === 'failed' &&
      status.sourceSignature === source?.sourceSignature &&
      status.embeddingModelKey === embeddingModelKey
    );
  });

  if (readySources.length === 0) {
    if (hasFailedSource) {
      return {
        kind: 'failed',
        errorMessage: statusSummary.errorMessage || '本地 RAG 索引失败',
      };
    }

    return {
      kind: 'indexing',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
      errorMessage: statusSummary.errorMessage,
    };
  }

  let queryEmbedding: number[];

  try {
    queryEmbedding = await embedRagText(
      buildRagRetrievalQuery(input.question, input.excerptText),
      input.embedding,
    );
  } catch (error) {
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  if (queryEmbedding.length === 0) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  let retrievals;

  try {
    retrievals = await Promise.all(
      readySources.map((source) =>
        ragRetrieveDocumentChunks({
          documentKey: preparedDocument.documentKey,
          sourceType: source.sourceType,
          queryEmbedding,
          topK: input.settings.localRagTopK,
        }),
      ),
    );
  } catch (error) {
    return {
      kind: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const merged = filterRelevantRetrievals(
    retrievals
    .flat()
    .sort((left, right) => left.score - right.score),
    input.settings.localRagTopK,
  );

  if (merged.length === 0) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  const contextDocument = buildRagContextText({
    results: merged,
    topK: input.settings.localRagTopK,
    mineruBlocks: input.mineruBlocks,
    preparedSources: preparedDocument.sources,
  });

  if (!contextDocument.documentText.trim()) {
    return {
      kind: 'empty',
      indexedChunkCount: statusSummary.indexedChunkCount,
      totalChunkCount: statusSummary.totalChunkCount,
    };
  }

  return {
    kind: 'retrieved',
    documentText: contextDocument.documentText,
    retrievedChunkCount: contextDocument.sectionCount,
    citations: contextDocument.citations,
    indexedChunkCount: statusSummary.indexedChunkCount,
    totalChunkCount: statusSummary.totalChunkCount,
  };
}

export async function resolveLibraryPaperRagContext(input: {
  item: WorkspaceItem;
  settings: Pick<
    ReaderSettings,
    'localRagEnabled' | 'localRagTopK' | 'ragSourceMode' | 'embeddingBatchSize'
  >;
  embedding: RagEmbeddingOptions;
  question: string;
  excerptText?: string | null;
  mineruBlocks?: PositionedMineruBlock[];
  mineruDocumentText?: string;
  pdfDocumentText: string;
}): Promise<string> {
  return resolveLocalRagContext({
    item: input.item,
    settings: input.settings,
    embedding: input.embedding,
    question: input.question,
    excerptText: input.excerptText,
    mineruBlocks: input.mineruBlocks ?? [],
    mineruDocumentText: input.mineruDocumentText ?? '',
    pdfDocumentText: input.pdfDocumentText,
  });
}
