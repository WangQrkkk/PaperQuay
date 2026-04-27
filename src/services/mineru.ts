import type {
  BBox,
  BBoxCoordinateSystem,
  BBoxPageSize,
  MineruBlockBase,
  MineruPage,
  PositionedMineruBlock,
  RenderableMineruBlock,
} from '../types/reader';
import { isValidBBox } from '../utils/bbox';
import { normalizeLatexExpression, normalizeRawLatexExpression } from '../utils/markdown';
import { joinReadableText } from '../utils/text';

function collectTextParts(input: unknown): string[] {
  if (input == null) {
    return [];
  }

  if (typeof input === 'string') {
    return [input];
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return [String(input)];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => collectTextParts(item));
  }

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const ignoredKeys = new Set([
      'type',
      'bbox',
      'path',
      'image_source',
      'table_type',
      'table_nest_level',
      'level',
      'text_level',
      'math_type',
      'list_type',
      'item_type',
      'bboxCoordinateSystem',
      'bboxPageSize',
    ]);

    return Object.entries(record).flatMap(([key, value]) => {
      if (ignoredKeys.has(key)) {
        return [];
      }

      return collectTextParts(value);
    });
  }

  return [];
}

function getRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function removeSpelledMineruTokenNoise(value: string): string {
  const chars = ['t', 'e', 'x', 't', 'l', 'i', 's', 't'];
  const spacedTokenPattern = new RegExp(
    `(?:^|\s)${chars.join('[\s\u200b\u200c\u200d\ufeff_\-]*')}(?=\s|[\x00\u2022\u25cf\u25aa\u25ab\u25e6\ufffd])`,
    'gi',
  );

  return value.replace(spacedTokenPattern, ' ');
}

function getDirectoryPath(filePath: string): string {
  const lastSlashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));

  return lastSlashIndex >= 0 ? filePath.slice(0, lastSlashIndex) : '.';
}

function joinPath(basePath: string, ...segments: string[]): string {
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedSegments = segments
    .filter(Boolean)
    .flatMap((segment) => segment.replace(/\\/g, '/').split('/'));
  const output: string[] = normalizedBase.split('/');

  for (const segment of normalizedSegments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (output.length > 0) {
        output.pop();
      }
      continue;
    }

    output.push(segment);
  }

  if (/^[a-zA-Z]:$/.test(output[0] ?? '')) {
    return output.join('\\');
  }

  if (basePath.startsWith('\\') || basePath.startsWith('/')) {
    return `/${output.filter(Boolean).join('/')}`;
  }

  return output.join('/');
}

function extractTypedContentText(
  block: PositionedMineruBlock,
  preferredKeys: string[],
): string {
  const content = getRecord(block.content);

  if (!content) {
    return joinReadableText(collectTextParts(block.content));
  }

  const preferredParts = preferredKeys.flatMap((key) => collectTextParts(content[key]));

  if (preferredParts.length > 0) {
    return joinReadableText(preferredParts);
  }

  return joinReadableText(collectTextParts(block.content));
}

function normalizeRawBlockType(rawType: unknown): string {
  const type = typeof rawType === 'string' ? rawType : 'paragraph';
  const lowerType = type.toLowerCase();

  if (lowerType.includes('title')) {
    return 'title';
  }

  if (lowerType.includes('table')) {
    return 'table';
  }

  if (lowerType.includes('image')) {
    return 'image';
  }

  if (lowerType.includes('equation')) {
    return 'equation';
  }

  if (lowerType.includes('list')) {
    return 'list';
  }

  return type;
}

function extractMathText(input: unknown): string {
  const record = getRecord(input);
  const candidates = [
    record?.math_content,
    record?.content,
    record?.latex,
    record?.text,
    record?.value,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeRawLatexExpression(candidate);
    }
  }

  return normalizeRawLatexExpression(joinReadableText(collectTextParts(input)));
}

function renderInlineMarkdownContent(input: unknown): string {
  if (input == null) {
    return '';
  }

  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => renderInlineMarkdownContent(item)).join('');
  }

  const record = getRecord(input);

  if (!record) {
    return '';
  }

  const nodeType = typeof record.type === 'string' ? record.type.toLowerCase() : '';

  if (nodeType === 'text') {
    const textContent = record.content ?? record.text ?? record.value;
    return typeof textContent === 'string' ? textContent : renderInlineMarkdownContent(textContent);
  }

  if (nodeType === 'equation_inline') {
    const mathText = extractMathText(record);
    return mathText ? `$${mathText}$` : '';
  }

  if (nodeType.includes('equation')) {
    const mathText = extractMathText(record);
    return mathText ? `$$\n${mathText}\n$$` : '';
  }

  for (const key of [
    'paragraph_content',
    'title_content',
    'list_content',
    'list_items',
    'item_content',
    'caption_content',
    'table_caption',
    'image_caption',
    'caption',
    'content',
    'value',
  ]) {
    if (!(key in record)) {
      continue;
    }

    const rendered = renderInlineMarkdownContent(record[key]);

    if (rendered) {
      return rendered;
    }
  }

  return Object.entries(record)
    .filter(([key]) => key !== 'type' && key !== 'math_type')
    .map(([, value]) => renderInlineMarkdownContent(value))
    .join('');
}

function cleanMineruListText(value: string): string {
  return removeSpelledMineruTokenNoise(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\btext\s*[_-]?\s*l\s*ist\s*text\b/gi, '')
    .replace(/\btext\s*[_-]\s*list\s*text\b/gi, '')
    .replace(/\btext\s*list\s*text\b/gi, '')
    .replace(/\btext\s*ist\s*text\b/gi, '')
    .replace(/\btextlist\s*text\b/gi, '')
    .replace(/\btext\s*(?=[\x00\u2022\u25cf\u25aa\u25ab\u25e6\ufffd*+-])/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMineruListMetadataNoise(value: string): boolean {
  const normalized = value
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();

  return normalized === 'text' || normalized === 'list' || normalized === 'textlist';
}
function splitBulletListItems(value: string): string[] {
  const cleaned = cleanMineruListText(value);

  if (!cleaned) {
    return [];
  }

  const normalized = cleaned
    .replace(/\s*[\x00\u2022\u25cf\u25aa\u25ab\u25e6\ufffd]\s*/g, '\n- ')
    .replace(/\btext\s+(?=[\u4e00-\u9fff])/gi, '\n- ')
    .replace(/\s+(?=\d+[.)]\s+)/g, '\n');

  return normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((line) => Boolean(line) && !isMineruListMetadataNoise(line));
}

function getMineruListItems(input: unknown): unknown[] {
  const record = getRecord(input);

  if (record) {
    if (Array.isArray(record.list_items)) {
      return record.list_items;
    }

    if (Array.isArray(record.list_content)) {
      return record.list_content;
    }

    if (Array.isArray(record.item_content)) {
      return [record.item_content];
    }

    if (Array.isArray(record.content)) {
      return record.content;
    }
  }

  return Array.isArray(input) ? input : [input];
}

export function renderListMarkdownContent(input: unknown): string {
  const rawItems = getMineruListItems(input);
  const items = rawItems.flatMap((item) => {
    const record = getRecord(item);
    const content = record?.item_content ?? record?.list_content ?? record?.content ?? item;

    return splitBulletListItems(renderInlineMarkdownContent(content));
  });

  return items.map((item) => `- ${item}`).join('\n');
}

export function extractTableHtmlFromMineruBlock(
  block: PositionedMineruBlock,
): string | undefined {
  const content = getRecord(block.content);
  const html = content?.html ?? content?.table_body;

  return typeof html === 'string' && html.trim() ? html : undefined;
}

export function extractMineruAssetPathFromBlock(
  block: PositionedMineruBlock,
): string | undefined {
  const content = getRecord(block.content);
  const imageSource = getRecord(content?.image_source);
  const candidate =
    imageSource?.path ??
    content?.img_path ??
    content?.path ??
    content?.image_path;

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function resolveMineruAssetPath(
  mineruPath: string,
  assetPath: string,
): string | undefined {
  if (!mineruPath.trim() || !assetPath.trim()) {
    return undefined;
  }

  if (/^[a-zA-Z]:[\\/]/.test(assetPath) || assetPath.startsWith('/') || assetPath.startsWith('\\')) {
    return assetPath;
  }

  if (/^[a-zA-Z]+:\/\//.test(assetPath)) {
    return assetPath;
  }

  if (mineruPath.startsWith('cloud:')) {
    return undefined;
  }

  return joinPath(getDirectoryPath(mineruPath), assetPath);
}

export function extractCaptionFromMineruBlock(block: PositionedMineruBlock): string {
  switch (block.type) {
    case 'table':
      return extractTypedContentText(block, ['table_caption', 'caption']);
    case 'image':
      return extractTypedContentText(block, ['image_caption', 'caption']);
    default:
      return '';
  }
}

function toMarkdownFragment(block: PositionedMineruBlock, plainText: string): string {
  const structuredMarkdown = renderInlineMarkdownContent(block.content).trim();
  const safeText = plainText || `未提取到 ${block.type} 文本`;

  switch (block.type) {
    case 'title':
      return `## ${structuredMarkdown || safeText}`;
    case 'list': {
      const listMarkdown = renderListMarkdownContent(block.content);
      const fallbackListMarkdown = renderListMarkdownContent(structuredMarkdown || safeText);

      return listMarkdown || fallbackListMarkdown || `- ${safeText}`;
    }
    case 'equation': {
      const mathText = extractMathText(block.content);
      return mathText ? `$$\n${mathText}\n$$` : structuredMarkdown || safeText;
    }
    case 'image':
      return `**图片说明** ${structuredMarkdown || safeText}`;
    case 'table':
      return `**表格说明** ${structuredMarkdown || safeText}`;
    case 'caption':
      return `> ${structuredMarkdown || safeText}`;
    default:
      return structuredMarkdown || safeText;
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBBox(value: unknown): BBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }

  const numbers = value.map(toFiniteNumber);

  if (numbers.some((number) => number == null)) {
    return undefined;
  }

  const bbox = numbers as BBox;

  return isValidBBox(bbox) ? bbox : undefined;
}

function readPageSize(value: unknown): BBoxPageSize | undefined {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }

  const width = toFiniteNumber(value[0]);
  const height = toFiniteNumber(value[1]);

  if (!width || !height || width <= 0 || height <= 0) {
    return undefined;
  }

  return [width, height];
}

function readCoordinateSystem(
  value: unknown,
  fallback: BBoxCoordinateSystem,
): BBoxCoordinateSystem {
  return value === 'pdf' || value === 'normalized-1000' ? value : fallback;
}

function normalizeMineruBlock(
  input: unknown,
  pageIndex: number,
  blockIndex: number,
  fallbackCoordinateSystem: BBoxCoordinateSystem,
): MineruBlockBase {
  if (!input || typeof input !== 'object') {
    throw new Error(`第 ${pageIndex + 1} 页第 ${blockIndex + 1} 个块不是有效对象`);
  }

  const rawBlock = input as Record<string, unknown>;
  const bbox = readBBox(rawBlock.bbox);

  return {
    type: normalizeRawBlockType(rawBlock.type),
    content: rawBlock.content ?? null,
    bbox,
    bboxCoordinateSystem: readCoordinateSystem(
      rawBlock.bboxCoordinateSystem,
      fallbackCoordinateSystem,
    ),
    bboxPageSize: readPageSize(rawBlock.bboxPageSize),
  };
}

function mapFlatContentType(rawBlock: Record<string, unknown>): string {
  const rawType = typeof rawBlock.type === 'string' ? rawBlock.type : 'text';
  const lowerType = rawType.toLowerCase();
  const textLevel = toFiniteNumber(rawBlock.text_level);

  if (lowerType === 'text') {
    return textLevel && textLevel > 0 ? 'title' : 'paragraph';
  }

  if (lowerType.includes('equation')) {
    return 'equation';
  }

  if (lowerType.includes('table')) {
    return 'table';
  }

  if (lowerType.includes('image')) {
    return 'image';
  }

  if (lowerType.includes('list')) {
    return 'list';
  }

  return rawType;
}

function pickFlatContent(rawBlock: Record<string, unknown>): Record<string, unknown> {
  const contentKeys = [
    'text',
    'text_level',
    'table_body',
    'table_caption',
    'table_footnote',
    'image_caption',
    'image_footnote',
    'img_path',
    'code_body',
    'code_caption',
    'code_footnote',
    'sub_type',
  ];
  const content: Record<string, unknown> = {};

  for (const key of contentKeys) {
    if (key in rawBlock) {
      content[key] = rawBlock[key];
    }
  }

  return Object.keys(content).length > 0 ? content : { value: rawBlock.content ?? null };
}

function parseFlatContentList(items: unknown[]): MineruPage[] {
  const pages: MineruPage[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawBlock = item as Record<string, unknown>;
    const rawPageIndex = toFiniteNumber(rawBlock.page_idx);
    const pageIndex = rawPageIndex != null && rawPageIndex >= 0 ? Math.floor(rawPageIndex) : 0;
    const page = pages[pageIndex] ?? [];

    page.push({
      type: mapFlatContentType(rawBlock),
      content: pickFlatContent(rawBlock),
      bbox: readBBox(rawBlock.bbox),
      bboxCoordinateSystem: 'normalized-1000',
    });

    pages[pageIndex] = page;
  }

  return pages.map((page) => page ?? []);
}

function mapMiddleBlockType(rawType: unknown): string {
  const type = typeof rawType === 'string' ? rawType : 'paragraph';
  const lowerType = type.toLowerCase();

  if (lowerType.includes('title')) {
    return 'title';
  }

  if (lowerType.includes('table')) {
    return 'table';
  }

  if (lowerType.includes('image')) {
    return 'image';
  }

  if (lowerType.includes('equation')) {
    return 'equation';
  }

  if (lowerType.includes('list')) {
    return 'list';
  }

  return 'paragraph';
}

function extractMiddleContent(rawBlock: Record<string, unknown>): Record<string, unknown> {
  const lines = Array.isArray(rawBlock.lines) ? rawBlock.lines : [];
  const spanTextParts = lines.flatMap((line) => {
    if (!line || typeof line !== 'object') {
      return [];
    }

    const spans = (line as Record<string, unknown>).spans;

    if (!Array.isArray(spans)) {
      return [];
    }

    return spans.flatMap((span) => {
      if (!span || typeof span !== 'object') {
        return [];
      }

      const rawSpan = span as Record<string, unknown>;

      return collectTextParts(
        rawSpan.content ?? rawSpan.text ?? rawSpan.latex ?? rawSpan.img_path ?? null,
      );
    });
  });

  return {
    text: joinReadableText(spanTextParts),
    raw_type: rawBlock.type,
  };
}

function parseMiddleJson(raw: Record<string, unknown>): MineruPage[] {
  if (!Array.isArray(raw.pdf_info)) {
    throw new Error('MinerU middle JSON 缺少 pdf_info 数组');
  }

  const pages: MineruPage[] = [];

  for (const pageInfo of raw.pdf_info) {
    if (!pageInfo || typeof pageInfo !== 'object') {
      continue;
    }

    const rawPage = pageInfo as Record<string, unknown>;
    const rawPageIndex = toFiniteNumber(rawPage.page_idx);
    const pageIndex = rawPageIndex != null && rawPageIndex >= 0 ? Math.floor(rawPageIndex) : pages.length;
    const pageSize = readPageSize(rawPage.page_size);
    const paraBlocks = Array.isArray(rawPage.para_blocks) ? rawPage.para_blocks : [];

    pages[pageIndex] = paraBlocks
      .filter((block) => block && typeof block === 'object')
      .map((block) => {
        const rawBlock = block as Record<string, unknown>;

        return {
          type: mapMiddleBlockType(rawBlock.type),
          content: extractMiddleContent(rawBlock),
          bbox: readBBox(rawBlock.bbox),
          bboxCoordinateSystem: 'pdf',
          bboxPageSize: pageSize,
        };
      });
  }

  return pages.map((page) => page ?? []);
}

export function parseMineruPages(payload: string | unknown): MineruPage[] {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;

  if (Array.isArray(parsed)) {
    if (parsed.every(Array.isArray)) {
      return parsed.map((page, pageIndex) => {
        if (!Array.isArray(page)) {
          throw new Error(`第 ${pageIndex + 1} 页不是有效的块数组`);
        }

        return page.map((block, blockIndex) => {
          return normalizeMineruBlock(block, pageIndex, blockIndex, 'normalized-1000');
        });
      });
    }

    return parseFlatContentList(parsed);
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).pdf_info)) {
    return parseMiddleJson(parsed as Record<string, unknown>);
  }

  throw new Error('MinerU JSON 必须是 content_list_v2、content_list 或 middle JSON');
}

export function flattenMineruPages(pages: MineruPage[]): PositionedMineruBlock[] {
  return pages.flatMap((page, pageIndex) =>
    page.map((block, blockIndex) => ({
      ...block,
      blockId: `page-${pageIndex + 1}-block-${blockIndex + 1}`,
      pageIndex,
      blockIndex,
    })),
  );
}

export function extractTextFromMineruBlock(block: PositionedMineruBlock): string {
  if (block.type === 'table') {
    const caption = extractCaptionFromMineruBlock(block);
    const tableHtml = extractTableHtmlFromMineruBlock(block);

    return caption || (tableHtml ? stripHtml(tableHtml) : '');
  }

  if (block.type === 'image') {
    return extractTypedContentText(block, ['image_caption', 'image_footnote', 'caption']);
  }

  if (block.type === 'equation') {
    return extractMathText(block.content);
  }

  return joinReadableText(collectTextParts(block.content));
}

export function buildRenderableBlocks(
  blocks: PositionedMineruBlock[],
  mineruPath?: string,
): RenderableMineruBlock[] {
  return blocks.map((block) => {
    const plainText = extractTextFromMineruBlock(block);
    const mathText = block.type === 'equation' ? extractMathText(block.content) : undefined;
    const tableHtml = block.type === 'table' ? extractTableHtmlFromMineruBlock(block) : undefined;
    const captionText =
      block.type === 'table' || block.type === 'image'
        ? extractCaptionFromMineruBlock(block)
        : undefined;
    const relativeAssetPath = extractMineruAssetPathFromBlock(block);

    return {
      block,
      plainText,
      markdown: toMarkdownFragment(block, plainText),
      mathText,
      tableHtml,
      captionText,
      assetPath:
        mineruPath && relativeAssetPath
          ? resolveMineruAssetPath(mineruPath, relativeAssetPath)
          : undefined,
      isInteractive: isValidBBox(block.bbox),
    };
  });
}
