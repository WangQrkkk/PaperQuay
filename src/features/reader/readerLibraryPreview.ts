import {
  readLocalBinaryFile,
  readLocalTextFile,
  writeLocalTextFile,
} from '../../services/desktop';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
  SUMMARY_PROMPT_VERSION,
} from '../../services/summarySource';
import {
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import type {
  PaperSummary,
  PositionedMineruBlock,
  ReaderSettings,
  TranslationMap,
  WorkspaceItem,
} from '../../types/reader';
import { getFileNameFromPath } from '../../utils/text';
import {
  buildMineruCachePathCandidates,
  buildMineruCachePaths,
  buildMineruSummaryCachePath,
  buildMineruSummaryCachePathCandidates,
  buildMineruTranslationCachePath,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache';
import {
  isOnboardingWelcomeItem,
  ONBOARDING_WELCOME_CACHE_DIR,
  type LibraryPreviewLoadResult,
  type MineruCacheManifest,
  type SummaryCacheEnvelope,
  type TranslationCacheEnvelope,
} from './readerShared';

type LocaleTextFn = (zh: string, en: string) => string;

export type ExistingMineruJson = {
  path: string;
  jsonText: string;
};

type PreviewSummaryRequest = {
  summaryInputs: ReturnType<typeof buildSummaryBlockInputs>;
  sourceKey: string;
  documentText: string;
  errorMessage: string;
};

function resolvePreviewSummaryLanguage(
  settings: Pick<ReaderSettings, 'summaryOutputLanguage' | 'uiLanguage'>,
) {
  return settings.summaryOutputLanguage === 'follow-ui'
    ? settings.uiLanguage === 'en-US'
      ? 'English'
      : 'Chinese'
    : settings.summaryOutputLanguage.trim() || (settings.uiLanguage === 'en-US' ? 'English' : 'Chinese');
}

export function resolvePreviewJsonCandidatePaths(
  item: WorkspaceItem,
  options: {
    autoLoadSiblingJson: boolean;
    mineruCacheDir: string;
  },
): string[] {
  const candidates = new Set<string>();

  if (options.mineruCacheDir.trim()) {
    for (const cachePaths of buildMineruCachePathCandidates(options.mineruCacheDir.trim(), item)) {
      candidates.add(cachePaths.contentJsonPath);
      candidates.add(cachePaths.middleJsonPath);
    }
  }

  if (item.localPdfPath && options.autoLoadSiblingJson) {
    candidates.add(guessSiblingJsonPath(item.localPdfPath));
  }

  return Array.from(candidates);
}

export async function readExistingMineruJson(
  item: WorkspaceItem,
  options: {
    autoLoadSiblingJson: boolean;
    mineruCacheDir: string;
  },
): Promise<ExistingMineruJson | null> {
  for (const candidatePath of resolvePreviewJsonCandidatePaths(item, options)) {
    try {
      const jsonText = await readLocalTextFile(candidatePath);

      if (jsonText.trim()) {
        return {
          path: candidatePath,
          jsonText,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function writeMineruParseCache({
  item,
  pdfPath,
  sourceKind,
  contentJsonText,
  middleJsonText,
  markdownText,
  batchId,
  dataId,
  fileName,
  zipEntries,
  mineruCacheDir,
}: {
  item: WorkspaceItem;
  pdfPath: string;
  sourceKind: MineruCacheManifest['sourceKind'];
  contentJsonText?: string | null;
  middleJsonText?: string | null;
  markdownText?: string | null;
  batchId?: string;
  dataId?: string;
  fileName?: string;
  zipEntries?: string[];
  mineruCacheDir: string;
}) {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const cachePaths = buildMineruCachePaths(mineruCacheDir.trim(), item);
  const writeTasks: Promise<void>[] = [];

  if (contentJsonText?.trim()) {
    writeTasks.push(writeLocalTextFile(cachePaths.contentJsonPath, contentJsonText));
  }

  if (middleJsonText?.trim()) {
    writeTasks.push(writeLocalTextFile(cachePaths.middleJsonPath, middleJsonText));
  }

  if (markdownText?.trim()) {
    writeTasks.push(writeLocalTextFile(cachePaths.markdownPath, markdownText));
  }

  const manifest: MineruCacheManifest = {
    version: 1,
    documentKey: item.itemKey,
    title: item.title,
    pdfPath,
    savedAt: new Date().toISOString(),
    sourceKind,
    batchId,
    dataId,
    fileName,
    zipEntries,
  };

  writeTasks.push(
    writeLocalTextFile(cachePaths.manifestPath, JSON.stringify(manifest, null, 2)),
  );

  await Promise.all(writeTasks);
  return cachePaths;
}

export async function loadReaderLibraryPreviewBlocks({
  item,
  settings,
  l,
  noJsonLoadedText,
  noPdfLoadedText,
  notLoadedText,
}: {
  item: WorkspaceItem;
  settings: Pick<ReaderSettings, 'autoLoadSiblingJson' | 'mineruCacheDir'>;
  l: LocaleTextFn;
  noJsonLoadedText: string;
  noPdfLoadedText: string;
  notLoadedText: string;
}): Promise<LibraryPreviewLoadResult> {
  const pdfName = item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText;

  if (isOnboardingWelcomeItem(item)) {
    const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`);
    const jsonText = await response.text();
    const pages = parseMineruPages(jsonText);
    const blocks = flattenMineruPages(pages);

    return {
      blocks,
      currentPdfName: 'welcome.pdf',
      currentJsonName: 'content_list_v2.json',
      statusMessage: l(
        `已加载 Welcome 内置解析结果：${blocks.length} 个结构块`,
        `Loaded built-in Welcome parse result: ${blocks.length} structured blocks`,
      ),
    };
  }

  if (settings.mineruCacheDir.trim()) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir.trim(), item)) {
      for (const candidatePath of [cachePaths.contentJsonPath, cachePaths.middleJsonPath]) {
        try {
          const jsonText = await readLocalTextFile(candidatePath);
          const pages = parseMineruPages(jsonText);
          const blocks = flattenMineruPages(pages);

          return {
            blocks,
            currentPdfName: pdfName,
            currentJsonName: getFileNameFromPath(candidatePath),
            statusMessage: l(
              `已从缓存加载 ${blocks.length} 个结构块`,
              `Loaded ${blocks.length} structured blocks from cache`,
            ),
          };
        } catch {
          continue;
        }
      }
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    const siblingJsonPath = guessSiblingJsonPath(item.localPdfPath);

    try {
      const jsonText = await readLocalTextFile(siblingJsonPath);
      const pages = parseMineruPages(jsonText);
      const blocks = flattenMineruPages(pages);

      return {
        blocks,
        currentPdfName: pdfName,
        currentJsonName: getFileNameFromPath(siblingJsonPath),
        statusMessage: l(
          `已从同目录 JSON 加载 ${blocks.length} 个结构块`,
          `Loaded ${blocks.length} structured blocks from the sibling JSON`,
        ),
      };
    } catch {
      return {
        blocks: [],
        currentPdfName: pdfName,
        currentJsonName: noJsonLoadedText,
        statusMessage: l(
          '未找到同目录 JSON，请手动选择 MinerU JSON。',
          'No sibling JSON was found. Please choose a MinerU JSON file manually.',
        ),
      };
    }
  }

  return {
    blocks: [],
    currentPdfName: pdfName,
    currentJsonName: settings.autoLoadSiblingJson ? notLoadedText : noJsonLoadedText,
    statusMessage: item.localPdfPath
      ? l(
          '尚未检测到结构化结果，请手动选择 JSON 或执行 MinerU 解析。',
          'No structured result detected yet. Choose a JSON file or run MinerU parsing.',
        )
      : l(
          '当前文献没有可用 PDF，因此暂时无法匹配对应的 JSON。',
          'This document has no available PDF, so a matching JSON cannot be resolved yet.',
        ),
  };
}

export async function buildLibraryPreviewSummaryRequest({
  item,
  blocks,
  settings,
  l,
}: {
  item: WorkspaceItem;
  blocks: PositionedMineruBlock[];
  settings: Pick<
    ReaderSettings,
    'autoLoadSiblingJson' | 'mineruCacheDir' | 'summaryOutputLanguage' | 'summarySourceMode' | 'uiLanguage'
  >;
  l: LocaleTextFn;
}): Promise<PreviewSummaryRequest> {
  const summaryInputs = buildSummaryBlockInputs(blocks);
  const summaryLanguage = resolvePreviewSummaryLanguage(settings);

  if (isOnboardingWelcomeItem(item)) {
    try {
      const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/full.md`);
      const documentText = response.ok ? await response.text() : buildMineruMarkdownDocument(blocks);

      return {
        summaryInputs,
        sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::welcome::${blocks.length}`,
        documentText,
        errorMessage: '',
      };
    } catch {
      return {
        summaryInputs,
        sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::welcome::${blocks.length}`,
        documentText: buildMineruMarkdownDocument(blocks),
        errorMessage: '',
      };
    }
  }

  if (settings.summarySourceMode === 'pdf-text') {
    const pdfPath = item.localPdfPath?.trim() ?? '';
    const sourceKey = `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::pdf-text::${pdfPath || 'no-pdf'}`;

    if (!pdfPath) {
      return {
        summaryInputs,
        sourceKey,
        documentText: '',
        errorMessage: l(
          '概览模式要求读取 PDF 文本，但当前文献没有可用 PDF。',
          'Overview mode requires PDF text, but no PDF is available for the current document.',
        ),
      };
    }

    const pdfData = await readLocalBinaryFile(pdfPath);
    const documentText = await extractPdfTextByPdfJs(pdfData);

    if (!documentText.trim()) {
      return {
        summaryInputs,
        sourceKey: `${sourceKey}::${pdfData.byteLength}`,
        documentText: '',
        errorMessage: l(
          '未能从 PDF 中提取可用文本。',
          'Failed to extract usable text from the PDF.',
        ),
      };
    }

    return {
      summaryInputs,
      sourceKey: `${sourceKey}::${pdfData.byteLength}`,
      documentText,
      errorMessage: '',
    };
  }

  const candidateMarkdownPaths = new Set<string>();

  if (settings.mineruCacheDir.trim()) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir.trim(), item)) {
      candidateMarkdownPaths.add(cachePaths.markdownPath);
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    candidateMarkdownPaths.add(guessSiblingMarkdownPath(item.localPdfPath));
  }

  for (const candidatePath of candidateMarkdownPaths) {
    try {
      const documentText = await readLocalTextFile(candidatePath);

      if (documentText.trim()) {
        return {
          summaryInputs,
          sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::${candidatePath}::${blocks.length}`,
          documentText,
          errorMessage: '',
        };
      }
    } catch {
      continue;
    }
  }

  const documentText = buildMineruMarkdownDocument(blocks);

  if (!documentText.trim()) {
    return {
      summaryInputs,
      sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::empty`,
      documentText: '',
      errorMessage: l(
        '未能生成可用的 MinerU Markdown 内容。',
        'Failed to generate usable MinerU Markdown content.',
      ),
    };
  }

  return {
    summaryInputs,
    sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::blocks::${blocks.length}`,
    documentText,
    errorMessage: '',
  };
}

export async function readSavedPreviewSummary({
  item,
  mineruCacheDir,
  sourceKey,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceKey: string;
}): Promise<PaperSummary | null> {
  if (isOnboardingWelcomeItem(item)) {
    try {
      const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`);
      const parsed = (await response.json()) as Partial<SummaryCacheEnvelope>;

      return parsed.summary ?? null;
    } catch {
      return null;
    }
  }

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
      const raw = await readLocalTextFile(candidatePath);
      const parsed = JSON.parse(raw) as Partial<SummaryCacheEnvelope>;

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.sourceKey !== sourceKey ||
        !parsed.summary
      ) {
        continue;
      }

      return parsed.summary as PaperSummary;
    } catch {
      continue;
    }
  }

  return null;
}

export async function writePreviewSummaryCache({
  item,
  mineruCacheDir,
  sourceKey,
  summary,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceKey: string;
  summary: PaperSummary;
}) {
  if (!mineruCacheDir.trim() || !sourceKey.trim()) {
    return;
  }

  const cachePath = buildMineruSummaryCachePath(mineruCacheDir.trim(), item, sourceKey);
  const payload: SummaryCacheEnvelope = {
    version: 1,
    sourceKey,
    summarizedAt: new Date().toISOString(),
    summary,
  };

  await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
}

export async function writeLibraryTranslationCache({
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
    translations,
  };

  await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
  return cachePath;
}
