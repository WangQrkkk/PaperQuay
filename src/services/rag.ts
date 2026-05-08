import { invoke } from '@tauri-apps/api/core';

import type {
  RagChunkInput,
  RagDocumentIndexStatus,
  RagIndexDocumentRequest,
  RagIndexedChunkInput,
  RagReportDocumentIndexFailureRequest,
  RagRetrievalResult,
  RagSourceMode,
} from '../types/reader';

interface RagEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number | null;
  timeoutSeconds?: number;
}

interface RagRetrieveRequest {
  documentKey: string;
  sourceType?: Exclude<RagSourceMode, 'off' | 'hybrid'> | null;
  queryEmbedding: number[];
  topK: number;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

function normalizeBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/+$/, '');

  if (/\/v\d+$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/v1`;
}

export function buildRagEmbeddingModelKey(options: RagEmbeddingOptions): string {
  return `${normalizeBaseUrl(options.baseUrl) ?? ''}::${options.model.trim()}::${options.dimensions ?? 'default'}`;
}

export async function embedRagText(
  text: string,
  options: RagEmbeddingOptions,
): Promise<number[]> {
  try {
    return await invoke<number[]>('rag_embed_text', {
      request: {
        text,
        embedding: {
          ...options,
          baseUrl: normalizeBaseUrl(options.baseUrl) ?? options.baseUrl.trim(),
        },
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 文本向量生成失败'));
  }
}

export async function embedRagChunks(
  chunks: RagChunkInput[],
  options: RagEmbeddingOptions,
): Promise<RagIndexedChunkInput[]> {
  try {
    return await invoke<RagIndexedChunkInput[]>('rag_embed_chunks', {
      request: {
        chunks,
        embedding: {
          ...options,
          baseUrl: normalizeBaseUrl(options.baseUrl) ?? options.baseUrl.trim(),
        },
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 分块向量生成失败'));
  }
}

export async function ragIndexDocument(
  request: RagIndexDocumentRequest,
): Promise<void> {
  try {
    await invoke('rag_index_document', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 索引写入失败'));
  }
}

export async function ragReportDocumentIndexFailure(
  request: RagReportDocumentIndexFailureRequest,
): Promise<void> {
  try {
    await invoke('rag_report_document_index_failure', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 索引失败状态写入失败'));
  }
}

export async function ragGetDocumentIndexStatus(
  documentKey: string,
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>,
): Promise<RagDocumentIndexStatus | null> {
  try {
    return await invoke<RagDocumentIndexStatus | null>('rag_get_document_index_status', {
      request: {
        documentKey,
        sourceType,
      },
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 RAG 索引状态失败'));
  }
}

export async function ragRetrieveDocumentChunks(
  request: RagRetrieveRequest,
): Promise<RagRetrievalResult[]> {
  try {
    return await invoke<RagRetrievalResult[]>('rag_retrieve_document_chunks', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '本地 RAG 检索失败'));
  }
}

export type { RagEmbeddingOptions, RagRetrieveRequest };
