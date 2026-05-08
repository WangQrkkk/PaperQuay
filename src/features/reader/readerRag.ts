import { SentenceSplitter } from 'llamaindex';
import type {
  DocumentChatCitation,
  PositionedMineruBlock,
  RagChunkInput,
  RagRetrievalResult,
  RagSourceMode,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader';
import { extractTextFromMineruBlock } from '../../services/mineru';
import { textSignature } from './readerShared';

export interface ReaderRagPreparedSource {
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>;
  sourceSignature: string;
  chunks: RagChunkInput[];
}

export interface ReaderRagPreparedDocument {
  documentKey: string;
  title: string;
  sources: ReaderRagPreparedSource[];
}

export interface ReaderRagContextDocument {
  documentText: string;
  sectionCount: number;
  citations: DocumentChatCitation[];
}

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const MAX_HEADING_NEIGHBOR_BLOCKS = 3;
const MAX_HEADING_SECTION_CHARS = 2_400;
const MAX_HEADING_LENGTH = 140;

function normalizeChunkText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildSplitter() {
  return new SentenceSplitter({
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  });
}

function splitTextIntoChunks(
  prefix: string,
  text: string,
  pageIndex: number | null,
  blockId?: string | null,
): RagChunkInput[] {
  const normalized = normalizeChunkText(text);

  if (!normalized) {
    return [];
  }

  const splitter = buildSplitter();

  return splitter
    .splitText(normalized)
    .map((chunkText, index) => ({
      chunkId: `${prefix}:${index}`,
      chunkIndex: index,
      pageIndex,
      blockId,
      text: normalizeChunkText(chunkText),
    }))
    .filter((chunk) => chunk.text);
}

function buildBlockScopedChunk(
  prefix: string,
  text: string,
  pageIndex: number | null,
  blockId?: string | null,
): RagChunkInput | null {
  const normalized = normalizeChunkText(text);

  if (!normalized) {
    return null;
  }

  return {
    chunkId: `${prefix}:0`,
    chunkIndex: 0,
    pageIndex,
    blockId,
    text: normalized,
  };
}

export function buildReaderRagDocumentKey(item: WorkspaceItem): string {
  if (item.source === 'native-library') {
    return item.itemKey;
  }

  return item.workspaceId;
}

export function buildMineruRagChunks(
  blocks: PositionedMineruBlock[],
): RagChunkInput[] {
  return blocks
    .flatMap((block) => {
      const prefix = `mineru:${block.blockId}`;
      const pageIndex = Number.isFinite(block.pageIndex) ? block.pageIndex : null;
      const text = extractTextFromMineruBlock(block);
      const normalized = normalizeChunkText(text);

      if (!normalized) {
        return [];
      }

      if (normalized.length <= DEFAULT_CHUNK_SIZE) {
        const chunk = buildBlockScopedChunk(prefix, normalized, pageIndex, block.blockId);
        return chunk ? [chunk] : [];
      }

      return splitTextIntoChunks(prefix, normalized, pageIndex, block.blockId);
    })
    .map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
    }));
}

export function buildPdfRagChunks(documentText: string): RagChunkInput[] {
  const sections = documentText
    .split(/\n\s*# Page /)
    .map((section, index) => {
      if (index === 0 && !section.startsWith('1\n')) {
        return {
          pageIndex: null,
          text: section,
        };
      }

      const normalized = index === 0 ? section : `# Page ${section}`;
      const match = normalized.match(/^# Page\s+(\d+)\s*\n([\s\S]*)$/);

      return {
        pageIndex: match ? Number(match[1]) - 1 : null,
        text: match ? match[2] : normalized,
      };
    })
    .filter((section) => section.text.trim());

  return sections
    .flatMap((section, index) => splitTextIntoChunks(`pdf:${index}`, section.text, section.pageIndex))
    .map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
    }));
}

function uniqueChunks(chunks: RagChunkInput[]): RagChunkInput[] {
  const seen = new Set<string>();

  return chunks.filter((chunk) => {
    const signature = `${chunk.pageIndex ?? 'na'}::${chunk.blockId ?? 'na'}::${textSignature(chunk.text)}`;

    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

export function prepareReaderRagDocument(input: {
  item: WorkspaceItem;
  settings: Pick<ReaderSettings, 'ragSourceMode'>;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}): ReaderRagPreparedDocument {
  const documentKey = buildReaderRagDocumentKey(input.item);
  const sources: ReaderRagPreparedSource[] = [];
  const wantMineru =
    input.settings.ragSourceMode === 'mineru-markdown' ||
    input.settings.ragSourceMode === 'hybrid';
  const wantPdf =
    input.settings.ragSourceMode === 'pdf-text' ||
    input.settings.ragSourceMode === 'hybrid';

  if (wantMineru) {
    const mineruSourceText = normalizeChunkText(input.mineruDocumentText);
    const mineruChunks = uniqueChunks(buildMineruRagChunks(input.mineruBlocks));

    if (mineruSourceText && mineruChunks.length > 0) {
      sources.push({
        sourceType: 'mineru-markdown',
        sourceSignature: textSignature(mineruSourceText),
        chunks: mineruChunks,
      });
    }
  }

  if (wantPdf) {
    const pdfSourceText = normalizeChunkText(input.pdfDocumentText);
    const pdfChunks = uniqueChunks(buildPdfRagChunks(input.pdfDocumentText));

    if (pdfSourceText && pdfChunks.length > 0) {
      sources.push({
        sourceType: 'pdf-text',
        sourceSignature: textSignature(pdfSourceText),
        chunks: pdfChunks,
      });
    }
  }

  return {
    documentKey,
    title: input.item.title,
    sources,
  };
}

export function buildRagRetrievalQuery(question: string, excerptText?: string | null): string {
  const trimmedQuestion = question.trim();
  const trimmedExcerpt = excerptText?.trim();

  return trimmedExcerpt
    ? `Question:\n${trimmedQuestion}\n\nSelected excerpt:\n${trimmedExcerpt}`
    : trimmedQuestion;
}

function looksLikeSectionHeading(text: string): boolean {
  const normalized = normalizeChunkText(text);

  if (!normalized || normalized.length > MAX_HEADING_LENGTH) {
    return false;
  }

  const collapsed = normalized.replace(/\s+/g, ' ').trim();
  const lineCount = normalized.split('\n').filter(Boolean).length;

  if (lineCount > 2 || collapsed.length > MAX_HEADING_LENGTH) {
    return false;
  }

  if (/^(abstract|introduction|background|related work|method|methods|approach|experiment|experiments|results|discussion|conclusion|conclusions|references)\b/i.test(collapsed)) {
    return true;
  }

  if (/^(section\s+)?\d+(\.\d+)*[\s.:_-]+[A-Z]/.test(collapsed)) {
    return true;
  }

  if (/^[一二三四五六七八九十0-9]+[、.\s]/.test(collapsed)) {
    return true;
  }

  return /^[A-Z][A-Za-z0-9\s:()/_-]{0,120}$/.test(collapsed) && collapsed.split(/\s+/).length <= 10;
}

function buildChunkLookup(
  preparedSources: ReaderRagPreparedSource[],
): Map<string, Map<string, RagChunkInput[]>> {
  const lookup = new Map<string, Map<string, RagChunkInput[]>>();

  preparedSources.forEach((source) => {
    const byBlockId = new Map<string, RagChunkInput[]>();

    source.chunks.forEach((chunk) => {
      const blockId = chunk.blockId?.trim();

      if (!blockId) {
        return;
      }

      const existing = byBlockId.get(blockId) ?? [];
      existing.push(chunk);
      byBlockId.set(blockId, existing);
    });

    byBlockId.forEach((chunks) => {
      chunks.sort((left, right) => left.chunkIndex - right.chunkIndex);
    });

    lookup.set(source.sourceType, byBlockId);
  });

  return lookup;
}

function isHeadingResult(
  result: RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  if (result.sourceType !== 'mineru-markdown' || !result.blockId) {
    return false;
  }

  const block = blockById.get(result.blockId);

  if (block?.type === 'title') {
    return true;
  }

  return looksLikeSectionHeading(result.text);
}

function buildExpandedHeadingSection(
  seed: RagRetrievalResult,
  orderedBlocks: PositionedMineruBlock[],
  blockById: Map<string, PositionedMineruBlock>,
  blockOrder: Map<string, number>,
  chunksBySourceAndBlock: Map<string, Map<string, RagChunkInput[]>>,
  usedChunkIds: Set<string>,
): RagRetrievalResult[] {
  if (!seed.blockId || !isHeadingResult(seed, blockById)) {
    return [];
  }

  const startIndex = blockOrder.get(seed.blockId);

  if (typeof startIndex !== 'number') {
    return [];
  }

  const additions: RagRetrievalResult[] = [];
  let collectedChars = 0;
  let collectedBlocks = 0;

  for (let cursor = startIndex + 1; cursor < orderedBlocks.length; cursor += 1) {
    const nextBlock = orderedBlocks[cursor];
    const nextText = normalizeChunkText(extractTextFromMineruBlock(nextBlock));

    if (!nextText) {
      continue;
    }

    if (nextBlock.type === 'title') {
      break;
    }

    const chunks = chunksBySourceAndBlock.get(seed.sourceType)?.get(nextBlock.blockId) ?? [];

    if (chunks.length === 0) {
      continue;
    }

    chunks.forEach((chunk) => {
      if (usedChunkIds.has(chunk.chunkId)) {
        return;
      }

      additions.push({
        chunkId: chunk.chunkId,
        sourceType: seed.sourceType,
        pageIndex: chunk.pageIndex,
        blockId: chunk.blockId,
        text: chunk.text,
        score: seed.score,
      });
      collectedChars += chunk.text.length;
    });

    collectedBlocks += 1;

    if (
      collectedBlocks >= MAX_HEADING_NEIGHBOR_BLOCKS ||
      collectedChars >= MAX_HEADING_SECTION_CHARS
    ) {
      break;
    }
  }

  return additions;
}

function buildContextSection(
  results: RagRetrievalResult[],
  index: number,
  anchor: RagRetrievalResult,
): string {
  const body = results
    .map((result) => result.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const anchorHint =
    anchor?.pageIndex !== null && anchor?.pageIndex !== undefined
      ? `Page ${anchor.pageIndex + 1}`
      : anchor?.sourceType ?? 'Context';

  return `# Source [${index + 1}]\n${anchorHint}\n${body}`;
}

function selectCitationAnchor(
  results: RagRetrievalResult[],
  blockById: Map<string, PositionedMineruBlock>,
): RagRetrievalResult | null {
  if (results.length === 0) {
    return null;
  }

  const nonHeading = results.find((result) => !isHeadingResult(result, blockById));

  return nonHeading ?? results[0] ?? null;
}

function buildCitation(
  anchor: RagRetrievalResult | null,
  results: RagRetrievalResult[],
  index: number,
): DocumentChatCitation | null {
  if (!anchor) {
    return null;
  }

  return {
    id: `cite:${index + 1}`,
    label: String(index + 1),
    sourceType: anchor.sourceType,
    pageIndex: anchor.pageIndex,
    blockId: anchor.blockId,
    previewText: results
      .map((result) => normalizeChunkText(result.text))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 480),
  };
}

export function buildRagContextText(input: {
  results: RagRetrievalResult[];
  topK: number;
  mineruBlocks: PositionedMineruBlock[];
  preparedSources: ReaderRagPreparedSource[];
}): ReaderRagContextDocument {
  const seeds = input.results.slice(0, input.topK);

  if (seeds.length === 0) {
    return {
      documentText: '',
      sectionCount: 0,
      citations: [],
    };
  }

  const orderedBlocks = [...input.mineruBlocks].sort((left, right) => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }

    return left.blockIndex - right.blockIndex;
  });
  const blockById = new Map(orderedBlocks.map((block) => [block.blockId, block]));
  const blockOrder = new Map(orderedBlocks.map((block, index) => [block.blockId, index]));
  const chunksBySourceAndBlock = buildChunkLookup(input.preparedSources);
  const usedChunkIds = new Set<string>();
  const sections: string[] = [];
  const citations: DocumentChatCitation[] = [];

  seeds.forEach((seed) => {
    if (usedChunkIds.has(seed.chunkId)) {
      return;
    }

    const sectionResults = [seed];
    usedChunkIds.add(seed.chunkId);

    buildExpandedHeadingSection(
      seed,
      orderedBlocks,
      blockById,
      blockOrder,
      chunksBySourceAndBlock,
      usedChunkIds,
    ).forEach((result) => {
      if (usedChunkIds.has(result.chunkId)) {
        return;
      }

      sectionResults.push(result);
      usedChunkIds.add(result.chunkId);
    });

    const sectionIndex = sections.length;
    const anchor = selectCitationAnchor(sectionResults, blockById);
    if (!anchor) {
      return;
    }

    sections.push(buildContextSection(sectionResults, sectionIndex, anchor));
    const citation = buildCitation(anchor, sectionResults, sectionIndex);

    if (citation) {
      citations.push(citation);
    }
  });

  return {
    documentText: sections.join('\n\n').trim(),
    sectionCount: sections.length,
    citations,
  };
}
