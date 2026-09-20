import type {
  TranslationBlockInput,
  TranslationMap,
  WorkspaceItem,
} from '../../types/reader';
import { readLocalTextFileIfExists, writeLocalTextFile } from '../../services/desktop';
import {
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
} from '../../utils/mineruCache.ts';
import type { TranslationCacheEnvelope } from './readerShared';
import { normalizeTranslationMap } from './readerTranslation';
import { buildTranslationSourceMetadata } from './readerTranslationSource';

const translationCacheWriteChains = new Map<string, Promise<unknown>>();

async function enqueueTranslationCacheWrite<T>(
  cachePath: string,
  write: () => Promise<T>,
): Promise<T> {
  const previousWrite = translationCacheWriteChains.get(cachePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(write);

  translationCacheWriteChains.set(cachePath, nextWrite);

  try {
    return await nextWrite;
  } finally {
    if (translationCacheWriteChains.get(cachePath) === nextWrite) {
      translationCacheWriteChains.delete(cachePath);
    }
  }
}

export interface TranslationCacheReadResult {
  blockSourceFingerprints: Record<string, string>;
  legacySourceBinding: boolean;
  path: string;
  sourceFingerprint: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

function normalizeBlockSourceFingerprints(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0].trim()) &&
          typeof entry[1] === 'string' &&
          Boolean(entry[1].trim()),
      )
      .map(([blockId, fingerprint]) => [blockId.trim(), fingerprint.trim()]),
  );
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
  let lastReadError: unknown = null;

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readLocalTextFileIfExists(candidatePath);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as Partial<TranslationCacheEnvelope>;
      const translations = normalizeTranslationMap(parsed?.translations);
      const blockSourceFingerprints = normalizeBlockSourceFingerprints(
        parsed?.blockSourceFingerprints,
      );
      const sourceFingerprint =
        typeof parsed?.sourceFingerprint === 'string'
          ? parsed.sourceFingerprint.trim()
          : '';

      if (Object.keys(translations).length === 0) {
        continue;
      }

      return {
        blockSourceFingerprints,
        legacySourceBinding:
          !sourceFingerprint || Object.keys(blockSourceFingerprints).length === 0,
        path: candidatePath,
        sourceFingerprint,
        sourceLanguage:
          typeof parsed?.sourceLanguage === 'string' ? parsed.sourceLanguage : '',
        targetLanguage:
          typeof parsed?.targetLanguage === 'string'
            ? parsed.targetLanguage
            : targetLanguage,
        translatedAt:
          typeof parsed?.translatedAt === 'string' ? parsed.translatedAt : '',
        translations,
      };
    } catch (error) {
      lastReadError = error;
      continue;
    }
  }

  if (lastReadError) {
    const message = lastReadError instanceof Error
      ? lastReadError.message
      : String(lastReadError);
    throw new Error(`Failed to read translation cache: ${message}`);
  }

  return null;
}

export async function writeTranslationCache({
  item,
  mineruCacheDir,
  sourceLanguage,
  targetLanguage,
  translations,
  sourceBlocks,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  translations: TranslationMap;
  sourceBlocks?: TranslationBlockInput[];
}) {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const cachePath = buildMineruTranslationCachePath(
    mineruCacheDir.trim(),
    item,
    targetLanguage,
  );
  const sourceMetadata = sourceBlocks?.length
    ? buildTranslationSourceMetadata(sourceBlocks)
    : null;
  const allowedBlockIds = sourceMetadata
    ? new Set(sourceBlocks?.map((block) => block.blockId.trim()).filter(Boolean))
    : null;
  const normalizedTranslations = normalizeTranslationMap(translations);
  const cacheTranslations = allowedBlockIds
    ? Object.fromEntries(
        Object.entries(normalizedTranslations).filter(([blockId]) =>
          allowedBlockIds.has(blockId),
        ),
      )
    : normalizedTranslations;
  const payload: TranslationCacheEnvelope = {
    version: sourceMetadata ? 2 : 1,
    sourceLanguage,
    targetLanguage,
    translatedAt: new Date().toISOString(),
    translations: cacheTranslations,
    ...(sourceMetadata ?? {}),
  };

  await enqueueTranslationCacheWrite(cachePath, () =>
    writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2)),
  );
  return cachePath;
}
