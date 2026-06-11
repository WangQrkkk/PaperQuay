import type { MineruPage, PaperSummary, PdfSource, WorkspaceItem } from '../../types/reader.ts';
import {
  buildMineruCachePathCandidates,
  buildMineruSummaryCachePathCandidates,
} from '../../utils/mineruCache.ts';
import { isMineruCacheManifest } from './documentReaderManifest.ts';
type Localize = (zh: string, en: string) => string;

type ReadLocalTextFileIfExists = (path: string) => Promise<string | null>;
type LoadPdfBinary = (source: PdfSource) => Promise<Uint8Array | null>;
type ParseMineruPages = (payload: string | unknown) => MineruPage[];
type SummaryCacheEnvelope = {
  sourceKey: string;
  summary: PaperSummary;
};

export interface SavedMineruPagesResult {
  pages: MineruPage[];
  path: string;
  message: string;
}

export function isMatchingSummaryCacheEnvelope(
  value: unknown,
  sourceKey: string,
): value is SummaryCacheEnvelope {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<SummaryCacheEnvelope>).sourceKey === sourceKey &&
      (value as Partial<SummaryCacheEnvelope>).summary,
  );
}

export async function loadSavedSummaryCache({
  item,
  mineruCacheDir,
  sourceKey,
  readText,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceKey: string;
  readText: ReadLocalTextFileIfExists;
}): Promise<PaperSummary | null> {
  if (!mineruCacheDir.trim() || !sourceKey.trim()) {
    return null;
  }

  const candidatePaths = buildMineruSummaryCachePathCandidates(
    mineruCacheDir.trim(),
    item,
    sourceKey,
  );

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readText(candidatePath);
      if (!raw) continue;

      const parsed = JSON.parse(raw);

      if (!isMatchingSummaryCacheEnvelope(parsed, sourceKey)) {
        continue;
      }

      return parsed.summary;
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadSavedMineruPages({
  item,
  mineruCacheDir,
  l,
  readText,
  parsePages,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  l: Localize;
  readText: ReadLocalTextFileIfExists;
  parsePages: ParseMineruPages;
}): Promise<SavedMineruPagesResult | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidateCaches = buildMineruCachePathCandidates(mineruCacheDir.trim(), item);

  for (const cachePaths of candidateCaches) {
    for (const candidatePath of [cachePaths.contentJsonPath, cachePaths.middleJsonPath]) {
      try {
        const jsonText = await readText(candidatePath);
        if (!jsonText) continue;

        return {
          pages: parsePages(jsonText),
          path: candidatePath,
          message: l(
            `已从本地缓存恢复《${item.title}》的解析结果`,
            `Restored the parsing result for "${item.title}" from the local cache`,
          ),
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

export async function resolveSavedPdfPath({
  item,
  mineruCacheDir,
  readText,
  loadPdf,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  readText: ReadLocalTextFileIfExists;
  loadPdf: LoadPdfBinary;
}): Promise<string | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidateCaches = buildMineruCachePathCandidates(mineruCacheDir.trim(), item);

  for (const cachePaths of candidateCaches) {
    try {
      const manifestText = await readText(cachePaths.manifestPath);
      if (!manifestText) continue;

      const parsed = JSON.parse(manifestText);

      if (!isMineruCacheManifest(parsed) || !parsed.pdfPath.trim()) {
        continue;
      }

      try {
        await loadPdf({ kind: 'local-path', path: parsed.pdfPath } satisfies PdfSource);
        return parsed.pdfPath;
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return null;
}
