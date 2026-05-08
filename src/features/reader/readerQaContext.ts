import type {
  DocumentChatCitation,
  DocumentChatQaContext,
  DocumentChatQaContextOrigin,
  DocumentChatQaContextState,
  RagDocumentIndexStatus,
} from '../../types/reader';

export interface QaRequestContextResolution {
  blocks: {
    blockId: string;
    blockType: string;
    pageIndex: number;
    text: string;
  }[];
  documentText: string;
  qaContext: DocumentChatQaContext;
  citations: DocumentChatCitation[];
}

export interface LocalRagResolutionSuccess {
  kind: 'retrieved';
  documentText: string;
  retrievedChunkCount: number;
  citations: DocumentChatCitation[];
  indexedChunkCount?: number;
  totalChunkCount?: number;
}

export interface LocalRagResolutionSkipped {
  kind:
    | 'disabled'
    | 'missing-embedding-config'
    | 'no-sources'
    | 'indexing'
    | 'empty';
  indexedChunkCount?: number;
  totalChunkCount?: number;
  errorMessage?: string | null;
}

export interface LocalRagResolutionFailed {
  kind: 'failed';
  errorMessage: string;
}

export type LocalRagResolution =
  | LocalRagResolutionSuccess
  | LocalRagResolutionSkipped
  | LocalRagResolutionFailed;

export type QaContextBadgeTone = 'success' | 'warning' | 'neutral';

type LocaleTextPicker = (zh: string, en: string) => string;

function toQaContextState(kind: LocalRagResolution['kind']): DocumentChatQaContextState {
  switch (kind) {
    case 'retrieved':
      return 'retrieved';
    case 'disabled':
      return 'disabled';
    case 'missing-embedding-config':
      return 'missing-embedding-config';
    case 'no-sources':
      return 'no-sources';
    case 'indexing':
      return 'indexing';
    case 'empty':
      return 'empty';
    case 'failed':
      return 'failed';
  }
}

export function buildQaContext(options: {
  origin: DocumentChatQaContextOrigin;
  rag?: LocalRagResolution | null;
}): DocumentChatQaContext {
  if (!options.rag) {
    return {
      origin: options.origin,
      retrievalState: 'disabled',
    };
  }

  return {
    origin: options.origin,
    retrievalState: toQaContextState(options.rag.kind),
    retrievedChunkCount:
      options.rag.kind === 'retrieved' ? options.rag.retrievedChunkCount : undefined,
    indexedChunkCount:
      options.rag.kind === 'retrieved' || options.rag.kind === 'indexing'
        ? options.rag.indexedChunkCount
        : undefined,
    totalChunkCount:
      options.rag.kind === 'retrieved' || options.rag.kind === 'indexing'
        ? options.rag.totalChunkCount
        : undefined,
    errorMessage:
      options.rag.kind === 'failed' || options.rag.kind === 'indexing'
        ? options.rag.errorMessage ?? null
        : undefined,
  };
}

export function summarizeRagIndexStatuses(
  statuses: Array<RagDocumentIndexStatus | null>,
): Pick<LocalRagResolutionSkipped, 'indexedChunkCount' | 'totalChunkCount' | 'errorMessage'> {
  const validStatuses = statuses.filter(Boolean) as RagDocumentIndexStatus[];

  if (validStatuses.length === 0) {
    return {};
  }

  const indexedChunkCount = validStatuses.reduce(
    (count, status) => count + Math.max(0, status.indexedChunkCount),
    0,
  );
  const totalChunkCount = validStatuses.reduce(
    (count, status) => count + Math.max(0, status.totalChunkCount),
    0,
  );
  const failedStatus = validStatuses.find((status) => status.lastError?.trim());

  return {
    indexedChunkCount,
    totalChunkCount,
    errorMessage: failedStatus?.lastError ?? null,
  };
}

function formatOriginLabel(origin: DocumentChatQaContextOrigin, l: LocaleTextPicker): string {
  switch (origin) {
    case 'local-rag':
      return 'RAG';
    case 'pdf-text':
      return l('PDF 全文', 'PDF text');
    case 'mineru-markdown':
      return l('MinerU 全文', 'MinerU Markdown');
  }
}

function hasRetrievedChunks(context: DocumentChatQaContext): boolean {
  return typeof context.retrievedChunkCount === 'number' && context.retrievedChunkCount > 0;
}

function formatIndexedProgress(
  context: DocumentChatQaContext,
  l: LocaleTextPicker,
): string {
  if (
    typeof context.indexedChunkCount !== 'number' ||
    typeof context.totalChunkCount !== 'number'
  ) {
    return '';
  }

  return l(
    `当前索引 ${context.indexedChunkCount}/${context.totalChunkCount} 段`,
    `Current index coverage: ${context.indexedChunkCount}/${context.totalChunkCount} chunks`,
  );
}

export function isQaContextRagRetrieved(
  context: DocumentChatQaContext | undefined,
): boolean {
  return Boolean(context && context.origin === 'local-rag' && context.retrievalState === 'retrieved');
}

export function getQaContextBadgeTone(
  context: DocumentChatQaContext | undefined,
): QaContextBadgeTone {
  if (!context) {
    return 'neutral';
  }

  if (isQaContextRagRetrieved(context)) {
    return 'success';
  }

  if (context.retrievalState === 'disabled') {
    return 'neutral';
  }

  return 'warning';
}

export function formatQaContextBadge(
  context: DocumentChatQaContext | undefined,
  l: LocaleTextPicker,
): string | null {
  if (!context) {
    return null;
  }

  if (isQaContextRagRetrieved(context)) {
    return hasRetrievedChunks(context)
      ? l(`本地 RAG · ${context.retrievedChunkCount} 组`, `Local RAG · ${context.retrievedChunkCount} groups`)
      : l('本地 RAG', 'Local RAG');
  }

  if (context.retrievalState !== 'disabled') {
    return l(
      `回退 · ${formatOriginLabel(context.origin, l)}`,
      `Fallback · ${formatOriginLabel(context.origin, l)}`,
    );
  }

  return formatOriginLabel(context.origin, l);
}

export function formatQaContextHint(
  context: DocumentChatQaContext | undefined,
  l: LocaleTextPicker,
): string | null {
  if (!context) {
    return null;
  }

  const originLabel = formatOriginLabel(context.origin, l);
  const indexProgress = formatIndexedProgress(context, l);

  switch (context.retrievalState) {
    case 'retrieved':
      return hasRetrievedChunks(context)
        ? l(
            indexProgress
              ? `已命中本地 RAG，整理出 ${context.retrievedChunkCount} 组候选上下文。${indexProgress}。`
              : `已命中本地 RAG，整理出 ${context.retrievedChunkCount} 组候选上下文。`,
            indexProgress
              ? `Used local RAG with ${context.retrievedChunkCount} context groups. ${indexProgress}.`
              : `Used local RAG with ${context.retrievedChunkCount} context groups.`,
          )
        : l('已命中本地 RAG。', 'Used local RAG retrieval.');
    case 'disabled':
      return l(
        `本次直接使用${originLabel}，未启用本地 RAG。`,
        `This answer used ${originLabel} directly without local RAG.`,
      );
    case 'missing-embedding-config':
      return l(
        `本次未命中本地 RAG：Embedding 模型未配置，已回退到${originLabel}。`,
        `RAG not used: the local embedding model is not configured. Fell back to ${originLabel}.`,
      );
    case 'no-sources':
      return l(
        `本次未命中本地 RAG：当前文档没有可建立本地索引的文本，已回退到${originLabel}。`,
        `RAG not used: no eligible text was available for local indexing. Fell back to ${originLabel}.`,
      );
    case 'indexing':
      return l(
        indexProgress
          ? `本次未命中本地 RAG：本地索引仍在构建中，${indexProgress}，已先回退到${originLabel}。`
          : `本次未命中本地 RAG：本地索引仍在构建中，已先回退到${originLabel}。`,
        indexProgress
          ? `RAG not used: the local index is still building. ${indexProgress}. Fell back to ${originLabel} for now.`
          : `RAG not used: the local index is still building. Fell back to ${originLabel} for now.`,
      );
    case 'empty':
      return l(
        `本次未命中本地 RAG：未检索到相关片段，已回退到${originLabel}。`,
        `RAG was attempted, but no relevant chunks were retrieved. Fell back to ${originLabel}.`,
      );
    case 'failed':
      return context.errorMessage?.trim()
        ? l(
            `本次未命中本地 RAG：检索失败，已回退到${originLabel}。错误：${context.errorMessage.trim()}`,
            `RAG failed and fell back to ${originLabel}: ${context.errorMessage.trim()}`,
          )
        : l(
            `本次未命中本地 RAG：检索失败，已回退到${originLabel}。`,
            `RAG failed and fell back to ${originLabel}.`,
          );
  }
}

export function formatQaContextStatus(
  context: DocumentChatQaContext | undefined,
  l: LocaleTextPicker,
): string {
  if (!context) {
    return l('文档问答已完成', 'Document QA completed');
  }

  const originLabel = formatOriginLabel(context.origin, l);

  if (isQaContextRagRetrieved(context)) {
    return hasRetrievedChunks(context)
      ? l(
          `文档问答已完成，命中本地 RAG（${context.retrievedChunkCount} 组）`,
          `Document QA completed with local RAG (${context.retrievedChunkCount} groups)`,
        )
      : l('文档问答已完成，已使用本地 RAG', 'Document QA completed with local RAG');
  }

  if (context.retrievalState === 'disabled') {
    return l(
      `文档问答已完成，使用${originLabel}`,
      `Document QA completed using ${originLabel}`,
    );
  }

  return l(
    `文档问答已完成，已回退到${originLabel}`,
    `Document QA completed after falling back to ${originLabel}`,
  );
}
