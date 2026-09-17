import { readReaderConfigFile } from '../../services/readerConfig';
import { embedRagText, type RagEmbeddingOptions } from '../../services/rag';
import type { ReaderSecrets, ReaderSettings } from '../../types/reader';
import { cosineSimilarity, type ScoredPaper } from './reviewRetrieval';

// Semantic rerank for the literature-review retrieval. This module depends on
// the electron-backed embedding service, so it is kept separate from the pure
// reviewRetrieval module (which must stay test-friendly).

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const MAX_RERANK_CANDIDATES = 30;
const MAX_EMBED_TEXT_LENGTH = 1600;

export interface ReviewEmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  inputFormat: ReaderSettings['embeddingInputFormat'];
  dimensions: number | null;
  timeoutSeconds: number;
}

function readStorageJson<T>(key: string): Partial<T> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

async function loadConfig(): Promise<{
  settings: Partial<ReaderSettings>;
  secrets: Partial<ReaderSecrets>;
}> {
  let persisted: { settings?: Partial<ReaderSettings>; secrets?: Partial<ReaderSecrets> } | null = null;

  try {
    persisted = await readReaderConfigFile();
  } catch {
    persisted = null;
  }

  return {
    settings: { ...(persisted?.settings ?? {}), ...readStorageJson<ReaderSettings>(SETTINGS_STORAGE_KEY) },
    secrets: { ...(persisted?.secrets ?? {}), ...readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY) },
  };
}

/**
 * Returns the embedding config when fully configured, otherwise null.
 * Used to enable/disable the "semantic rerank" toggle.
 */
export async function loadReviewEmbeddingConfig(): Promise<ReviewEmbeddingConfig | null> {
  const { settings, secrets } = await loadConfig();
  const apiKey = secrets.embeddingApiKey?.trim();
  const baseUrl = settings.embeddingBaseUrl?.trim();
  const model = settings.embeddingModel?.trim();

  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  return {
    apiKey,
    baseUrl,
    model,
    inputFormat: settings.embeddingInputFormat === 'query-passage' ? 'query-passage' : 'plain',
    dimensions:
      typeof settings.embeddingDimensions === 'number' && Number.isFinite(settings.embeddingDimensions)
        ? settings.embeddingDimensions
        : null,
    timeoutSeconds:
      typeof settings.embeddingRequestTimeoutSeconds === 'number' &&
      Number.isFinite(settings.embeddingRequestTimeoutSeconds)
        ? settings.embeddingRequestTimeoutSeconds
        : 180,
  };
}

function candidateEmbedText(item: ScoredPaper): string {
  const { paper } = item;
  return [paper.title, paper.abstractText || paper.aiSummary || '']
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_EMBED_TEXT_LENGTH);
}

/**
 * Rerank keyword candidates by semantic similarity to the query.
 * Only the top {MAX_RERANK_CANDIDATES} keyword hits are embedded (cost guard).
 * On any failure, throws so the caller can fall back to keyword order.
 */
export async function semanticRerankPapers(
  query: string,
  candidates: ScoredPaper[],
  config: ReviewEmbeddingConfig,
): Promise<ScoredPaper[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || candidates.length <= 1) {
    return candidates;
  }

  const embedding: RagEmbeddingOptions = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    inputFormat: config.inputFormat,
    dimensions: config.dimensions,
    timeoutSeconds: config.timeoutSeconds,
  };

  const head = candidates.slice(0, MAX_RERANK_CANDIDATES);
  const tail = candidates.slice(MAX_RERANK_CANDIDATES);

  const [queryVector, candidateVectors] = await Promise.all([
    embedRagText(trimmedQuery, embedding),
    Promise.all(head.map((item) => embedRagText(candidateEmbedText(item), embedding, 'passage'))),
  ]);

  const reranked = head
    .map((item, index) => ({
      item,
      similarity: cosineSimilarity(queryVector, candidateVectors[index]),
    }))
    .sort((left, right) => right.similarity - left.similarity)
    // Preserve the keyword score on the item; expose similarity via score blend
    // is unnecessary — keep original score for display, reorder only.
    .map(({ item }) => item);

  return [...reranked, ...tail];
}
