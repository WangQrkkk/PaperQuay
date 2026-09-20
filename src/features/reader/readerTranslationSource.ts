import type { TranslationBlockInput, TranslationMap } from '../../types/reader';

export interface TranslationSourceMetadata {
  blockSourceFingerprints: Record<string, string>;
  sourceFingerprint: string;
}

export interface SourceBoundTranslationCache {
  blockSourceFingerprints?: Record<string, string>;
  legacySourceBinding?: boolean;
  sourceFingerprint?: string;
  translations: TranslationMap;
}

function normalizeTranslationSourceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash.toString(16).padStart(16, '0');
}

function blockSourcePayload(block: TranslationBlockInput): string {
  const blockId = normalizeTranslationSourceText(block.blockId);
  const text = normalizeTranslationSourceText(block.text);
  return `${blockId.length}:${blockId}${text.length}:${text}`;
}

export function buildTranslationSourceMetadata(
  blocks: TranslationBlockInput[],
): TranslationSourceMetadata {
  const blockSourceFingerprints: Record<string, string> = {};
  const sourceParts: string[] = [];

  for (const block of blocks) {
    const blockId = block.blockId.trim();
    if (!blockId) continue;

    const payload = blockSourcePayload(block);
    blockSourceFingerprints[blockId] = `fnv1a64-v1:${fnv1a64(payload)}`;
    sourceParts.push(payload);
  }

  return {
    blockSourceFingerprints,
    sourceFingerprint: `fnv1a64-v1:${fnv1a64(sourceParts.join('\u001e'))}`,
  };
}

export function selectReusableCachedTranslations(
  cached: SourceBoundTranslationCache | null | undefined,
  sourceBlocks: TranslationBlockInput[],
): TranslationMap {
  if (
    !cached ||
    cached.legacySourceBinding ||
    !cached.sourceFingerprint ||
    !cached.blockSourceFingerprints
  ) {
    return {};
  }

  const currentSource = buildTranslationSourceMetadata(sourceBlocks);

  if (cached.sourceFingerprint !== currentSource.sourceFingerprint) {
    return {};
  }

  const reusable: TranslationMap = {};

  for (const block of sourceBlocks) {
    const blockId = block.blockId.trim();
    const translatedText = cached.translations[blockId]?.trim();

    if (
      !blockId ||
      !translatedText ||
      cached.blockSourceFingerprints[blockId] !==
        currentSource.blockSourceFingerprints[blockId]
    ) {
      continue;
    }

    reusable[blockId] = translatedText;
  }

  return reusable;
}
