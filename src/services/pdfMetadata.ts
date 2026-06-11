import { pdfjs } from 'react-pdf';
import { readLocalBinaryFile } from './desktop';
import type { LocalPdfMetadataPreview } from '../types/metadata';
import { buildPdfJsDataDocumentInit } from '../utils/pdfJsCompatibility';
import { getFileNameFromPath } from '../utils/text';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  avgHeight: number;
  orderIndex: number;
}

interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orderIndex: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u00a0\u2000-\u200d\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodePdfMetadataValue(value: unknown): string {
  return typeof value === 'string' ? normalizeWhitespace(value) : '';
}

function fileStem(path: string): string {
  return getFileNameFromPath(path).replace(/\.pdf$/i, '').trim();
}

function looksGenericTitle(value: string, path: string): boolean {
  const normalized = normalizeWhitespace(value).toLocaleLowerCase();
  const stem = fileStem(path).toLocaleLowerCase();

  if (!normalized || normalized.length < 6) {
    return true;
  }

  if (normalized === stem) {
    return true;
  }

  return [
    'untitled',
    'microsoft word',
    'wps',
    'adobe',
    'acrobat',
    'pdf',
    'sciencedirect',
    '中国知网',
    'cnki',
  ].some((token) => normalized.includes(token));
}

function isArticleTypeLine(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (!normalized || normalized.length > 90) {
    return false;
  }

  return [
    /^full\s+length\s+article$/,
    /^research\s+(?:paper|article)$/,
    /^original\s+(?:research\s+)?article$/,
    /^review\s+(?:paper|article)$/,
    /^article$/,
    /^review$/,
    /^short\s+communication$/,
    /^case\s+report$/,
    /^technical\s+note$/,
    /^perspective$/,
    /^commentary$/,
    /\bfull\s+length\s+article\b/,
    /\bresearch\s+(?:paper|article)\b/,
    /\boriginal\s+(?:research\s+)?article\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isPublisherOrHeaderLine(value: string): boolean {
  const normalized = normalizeWhitespace(value);

  return [
    /^contents\s+lists\s+available\s+at\s+sciencedirect$/i,
    /^science\s*direct$/i,
    /^elsevier$/i,
    /^journal\s+homepage\b/i,
    /^available\s+online\b/i,
    /^received\b/i,
    /^revised\b/i,
    /^accepted\b/i,
    /^article\s+history\b/i,
    /^article\s+info$/i,
    /^a\s+r\s+t\s+i\s+c\s+l\s+e\s+i\s+n\s+f\s+o$/i,
    /^keywords?[:：]?$/i,
  ].some((pattern) => pattern.test(normalized));
}

function cleanTitleCandidate(value: string, path: string): string | null {
  const normalized = normalizeWhitespace(value)
    .replace(/^(?:[【[]\s*)?(?:摘要|abstract)\s*(?:[】\]])?/i, '')
    .trim();

  if (
    !normalized ||
    normalized.length < 6 ||
    normalized.length > 220 ||
    /^(doi|摘要|abstract|关键词|key words?)[:：]?$/i.test(normalized) ||
    /^(references|acknowledg(?:e)?ments|introduction|conclusion)$/i.test(normalized) ||
    /^(vol\.?|volume|issue|issn|isbn)\b/i.test(normalized) ||
    /^https?:\/\//i.test(normalized) ||
    isArticleTypeLine(normalized) ||
    isPublisherOrHeaderLine(normalized) ||
    looksGenericTitle(normalized, path)
  ) {
    return null;
  }

  return normalized;
}

function splitAuthors(value: string): string[] {
  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return [];
  }

  const primary = normalized
    .split(/\s*(?:;|；|、|\/|\band\b)\s*/gi)
    .map((part) => part.trim())
    .filter(Boolean);

  if (primary.length > 1) {
    return primary;
  }

  if (normalized.includes(',') && normalized.split(',').length <= 4) {
    const commaSplit = normalized
      .split(/\s*,\s*/g)
      .map((part) => part.trim())
      .filter(Boolean);

    if (commaSplit.length > 1 && commaSplit.every((part) => part.length >= 2)) {
      return commaSplit;
    }
  }

  return [normalized];
}

function cleanAuthorsCandidate(value: string): string[] {
  const authors = splitAuthors(value).filter((author) => {
    if (author.length < 2 || author.length > 64) {
      return false;
    }

    if (/^(摘要|abstract|关键词|key words?|doi|中国知网|cnki)$/i.test(author)) {
      return false;
    }

    return /[\u4e00-\u9fffA-Za-z]/.test(author);
  });

  return authors.length <= 8 ? authors : [];
}

function extractDoiCandidate(value: string): string | null {
  const match = normalizeWhitespace(value).match(DOI_PATTERN);
  return match ? match[0].replace(/[.,;)\]}]+$/, '') : null;
}

function parsePdfMetadataDate(value: string): string | null {
  const match = value.match(/(?:D:)?((?:19|20)\d{2})/);
  return match ? match[1] : null;
}

function isLowSignalLine(value: string): boolean {
  const normalized = normalizeWhitespace(value);

  if (!normalized || normalized.length < 4 || normalized.length > 240) {
    return true;
  }

  return [
    /^https?:\/\//i,
    /www\./i,
    /中国知网/i,
    /\bcnki\b/i,
    /^doi[:：]/i,
    /^摘要[:：]?$/i,
    /^abstract[:：]?$/i,
    /^关键词[:：]?$/i,
    /^key words?[:：]?$/i,
    /^中图分类号/i,
    /^收稿日期/i,
    /^基金项目/i,
  ].some((pattern) => pattern.test(normalized));
}

function estimatedItemRight(item: PdfTextItem): number {
  if (item.width > 0) {
    return item.x + item.width;
  }

  return item.x + item.text.length * Math.max(item.height, 7) * 0.48;
}

function splitVisualRowByColumns(row: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...row].sort((left, right) => left.x - right.x);
  const groups: PdfTextItem[][] = [];

  for (const item of sorted) {
    const current = groups[groups.length - 1];

    if (!current) {
      groups.push([item]);
      continue;
    }

    const previous = current[current.length - 1];
    const averageHeight =
      current.reduce((sum, value) => sum + Math.max(value.height, 0), 0) / Math.max(current.length, 1);
    const gap = item.x - estimatedItemRight(previous);
    const columnGapThreshold = Math.max(28, Math.min(96, averageHeight * 3.2));

    if (gap > columnGapThreshold) {
      groups.push([item]);
    } else {
      current.push(item);
    }
  }

  return groups;
}

function lineFromItems(items: PdfTextItem[]): TextLine {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  const text = normalizeWhitespace(sorted.map((item) => item.text).join(' '));
  const x = sorted.reduce((min, item) => Math.min(min, item.x), Number.POSITIVE_INFINITY);
  const right = sorted.reduce(
    (max, item) => Math.max(max, estimatedItemRight(item)),
    Number.NEGATIVE_INFINITY,
  );
  const y = sorted.reduce((sum, item) => sum + item.y, 0) / sorted.length;
  const avgHeight = sorted.reduce((sum, item) => sum + item.height, 0) / Math.max(sorted.length, 1);
  const orderIndex = sorted.reduce(
    (min, item) => Math.min(min, item.orderIndex),
    Number.POSITIVE_INFINITY,
  );

  return {
    text,
    x: Number.isFinite(x) ? x : 0,
    y,
    width: Number.isFinite(right) && Number.isFinite(x) ? Math.max(0, right - x) : 0,
    avgHeight,
    orderIndex: Number.isFinite(orderIndex) ? orderIndex : 0,
  };
}

function collectPageLines(textContent: {
  items: Array<Record<string, unknown>>;
}): TextLine[] {
  const textItems = (textContent.items as Array<Record<string, unknown>>)
    .map((item, orderIndex): PdfTextItem => ({
      text: typeof item.str === 'string' ? item.str : '',
      x: Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0,
      orderIndex,
    }))
    .filter((item) => item.text.trim());

  const sorted = [...textItems].sort((left, right) => {
    if (Math.abs(right.y - left.y) > 2.4) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const visualRows: PdfTextItem[][] = [];

  for (const item of sorted) {
    const currentRow = visualRows[visualRows.length - 1];

    if (!currentRow) {
      visualRows.push([item]);
      continue;
    }

    const currentY =
      currentRow.reduce((sum, value) => sum + value.y, 0) / Math.max(currentRow.length, 1);

    if (Math.abs(currentY - item.y) <= 2.8) {
      currentRow.push(item);
    } else {
      visualRows.push([item]);
    }
  }

  return visualRows
    .flatMap(splitVisualRowByColumns)
    .map(lineFromItems)
    .filter((line) => !isLowSignalLine(line.text))
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > 2.4) {
        return right.y - left.y;
      }

      return left.x - right.x;
    });
}

function titleScore(line: TextLine, index: number): number {
  const lengthScore = Math.max(0, 36 - Math.abs(line.text.length - 36));
  const topScore = Math.max(0, 20 - index * 2);
  const fontScore = Math.min(40, line.avgHeight * 3.2);
  const digitPenalty = /\d{4,}/.test(line.text) ? 8 : 0;
  const punctuationPenalty = /[;；。！？?]$/.test(line.text) ? 6 : 0;

  return fontScore + topScore + lengthScore - digitPenalty - punctuationPenalty;
}

function pickTitleFromLines(lines: TextLine[], path: string): string | null {
  const candidates = lines
    .slice(0, 16)
    .map((line, index) => ({
      line,
      score: titleScore(line, index),
      cleaned: cleanTitleCandidate(line.text, path),
    }))
    .filter((candidate) => candidate.cleaned);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].cleaned;
}

function isLikelyAuthorLine(line: TextLine): boolean {
  const normalized = normalizeWhitespace(line.text);
  const commaCount = (normalized.match(/,/g) ?? []).length;
  const latinNameCount =
    (normalized.match(/\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)+\b/g) ?? []).length;
  const hasAffiliationMarkers = /(?:^|[\s,])(?:[a-z]\s*,|\d\s*,|[a-z]\d|\*)/i.test(normalized);

  if (latinNameCount >= 2 && (commaCount >= 1 || hasAffiliationMarkers)) {
    return true;
  }

  if (latinNameCount >= 1 && commaCount >= 2) {
    return true;
  }

  return false;
}

function isLikelyAffiliationLine(line: TextLine): boolean {
  return /\b(?:university|institute|department|school|college|laboratory|academy|email|corresponding author)\b/i.test(
    normalizeWhitespace(line.text),
  );
}

function isBibliographicHeaderLine(line: TextLine): boolean {
  return isPublisherOrHeaderLine(line.text);
}

function linesAreInSameTitleBlock(first: TextLine, next: TextLine): boolean {
  const xTolerance = Math.max(56, first.avgHeight * 4.5);
  const compatibleX = Math.abs(next.x - first.x) <= xTolerance || next.x >= first.x - 12;
  const compatibleFont = next.avgHeight >= Math.max(7, first.avgHeight * 0.62);

  return compatibleX && compatibleFont;
}

function fontBucket(line: TextLine): number {
  return Math.round(Math.max(line.avgHeight, 0) * 2) / 2;
}

function sameFontBucket(left: TextLine, rightBucket: number): boolean {
  return Math.abs(fontBucket(left) - rightBucket) <= 0.25;
}

function sortedFontBuckets(lines: TextLine[]): number[] {
  return Array.from(new Set(lines.map(fontBucket).filter((value) => value > 0))).sort(
    (left, right) => right - left,
  );
}

function joinTitleLines(lines: TextLine[]): string {
  return normalizeWhitespace(lines.map((line) => line.text).join(' '))
    .replace(/-\s+/g, '')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
    .replace(/([([{（【])\s+/g, '$1')
    .replace(/\s+([)\]}）】])/g, '$1')
    .trim();
}

function titleLinePenalty(title: string): number {
  let penalty = 0;

  if (/\b(?:journal|transactions|proceedings|conference|symposium)\b/i.test(title)) {
    penalty += 16;
  }

  if (/\b(?:vol\.?|volume|issue|no\.?)\s*\d+/i.test(title)) {
    penalty += 20;
  }

  if (/\b(?:issn|isbn|elsevier|sciencedirect)\b/i.test(title)) {
    penalty += 30;
  }

  if ((title.match(/\d/g) ?? []).length >= 8) {
    penalty += 10;
  }

  if (/^[A-Z\s,.;:-]{12,}$/.test(title) && title.includes(',')) {
    penalty += 8;
  }

  return penalty;
}

function scoreTitleCandidate(lines: TextLine[], title: string, methodBonus = 0): number {
  const avgHeight =
    lines.reduce((sum, line) => sum + Math.max(line.avgHeight, 0), 0) / Math.max(lines.length, 1);
  const firstOrderIndex = Math.min(...lines.map((line) => Math.max(0, line.orderIndex)));
  const lengthScore = Math.max(0, 46 - Math.abs(title.length - 58) * 0.45);
  const lineCountPenalty = Math.max(0, lines.length - 4) * 8;
  const orderScore = Math.max(0, 18 - firstOrderIndex * 0.25);
  const shortMastheadPenalty =
    lines.length === 1 && title.length <= 32 && !/[;:：?？]/.test(title) ? 12 : 0;

  return (
    avgHeight * 4 +
    lengthScore +
    orderScore +
    methodBonus -
    lineCountPenalty -
    shortMastheadPenalty -
    titleLinePenalty(title)
  );
}

function candidateFromLines(
  lines: TextLine[],
  path: string,
  methodBonus = 0,
): { title: string; score: number } | null {
  if (lines.length === 0 || lines.length > 6) {
    return null;
  }

  const title = cleanTitleCandidate(joinTitleLines(lines), path);

  if (!title) {
    return null;
  }

  return {
    title,
    score: scoreTitleCandidate(lines, title, methodBonus),
  };
}

function pickTitleAfterArticleType(lines: TextLine[], path: string): string | null {
  const markerIndex = lines.findIndex((line, index) => index < 70 && isArticleTypeLine(line.text));

  if (markerIndex < 0) {
    return null;
  }

  const marker = lines[markerIndex];
  const following = lines.slice(markerIndex + 1, markerIndex + 24);
  const candidates: Array<{ title: string; score: number }> = [];

  for (let startIndex = 0; startIndex < following.length; startIndex += 1) {
    const first = following[startIndex];

    if (
      isBibliographicHeaderLine(first) ||
      isLikelyAuthorLine(first) ||
      isLikelyAffiliationLine(first) ||
      !cleanTitleCandidate(first.text, path)
    ) {
      continue;
    }

    if (marker.x > 120 && first.x < marker.x - 40) {
      continue;
    }

    const titleLines: TextLine[] = [];

    for (const line of following.slice(startIndex, startIndex + 5)) {
      if (isBibliographicHeaderLine(line) || isLikelyAffiliationLine(line)) {
        if (titleLines.length > 0) break;
        continue;
      }

      if (isLikelyAuthorLine(line)) {
        if (titleLines.length > 0) break;
        continue;
      }

      if (!cleanTitleCandidate(line.text, path)) {
        if (titleLines.length > 0) break;
        continue;
      }

      if (titleLines.length > 0 && !linesAreInSameTitleBlock(titleLines[0], line)) {
        break;
      }

      titleLines.push(line);
      const candidate = candidateFromLines(titleLines, path, 72 - startIndex * 1.8);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].title;
}

function consecutiveAllowedLines(
  orderedLines: TextLine[],
  startIndex: number,
  allowedBuckets: Set<number>,
): TextLine[] {
  const picked: TextLine[] = [];

  if (startIndex < 0) {
    return picked;
  }

  for (let index = startIndex; index < orderedLines.length; index += 1) {
    const line = orderedLines[index];
    const bucket = fontBucket(line);

    if (!allowedBuckets.has(bucket)) {
      if (picked.length > 0) {
        break;
      }

      continue;
    }

    picked.push(line);

    if (picked.length >= 6) {
      break;
    }
  }

  return picked;
}

function pickPdfTitleFromLines(lines: TextLine[], path: string): string | null {
  const articleBodyTitle = pickTitleAfterArticleType(lines, path);

  if (articleBodyTitle) {
    return articleBodyTitle;
  }

  const topLines = lines.slice(0, 32);
  const usableLines = topLines.filter((line) => cleanTitleCandidate(line.text, path));
  const fontBuckets = sortedFontBuckets(usableLines);

  if (usableLines.length === 0 || fontBuckets.length === 0) {
    return pickTitleFromLines(lines, path);
  }

  const candidates: Array<{ title: string; score: number }> = [];
  const maxFont = fontBuckets[0];
  const secondFont = fontBuckets[1];

  const originalStart = topLines.findIndex((line) => sameFontBucket(line, maxFont));
  if (originalStart >= 0) {
    const originalLines: TextLine[] = [];

    for (let index = originalStart; index < topLines.length; index += 1) {
      const line = topLines[index];

      if (!sameFontBucket(line, maxFont)) {
        if (originalLines.length > 0) break;
        continue;
      }

      originalLines.push(line);
      if (originalLines.length >= 5) break;
    }

    const candidate = candidateFromLines(originalLines, path, 12);
    if (candidate) candidates.push(candidate);
  }

  if (secondFont) {
    const allowed = new Set([maxFont, secondFont]);
    const naturalOrderLines = [...topLines].sort((left, right) => left.orderIndex - right.orderIndex);
    const max2Start = naturalOrderLines.findIndex((line) => sameFontBucket(line, maxFont));
    const max2Candidate = candidateFromLines(
      consecutiveAllowedLines(naturalOrderLines, max2Start, allowed),
      path,
      8,
    );
    if (max2Candidate) candidates.push(max2Candidate);

    const yxOrderLines = [...topLines].sort((left, right) => {
      if (Math.abs(right.y - left.y) > 2.4) return right.y - left.y;
      return left.x - right.x;
    });
    const eliotStart = yxOrderLines.findIndex((line) => allowed.has(fontBucket(line)));
    const eliotCandidate = candidateFromLines(
      consecutiveAllowedLines(yxOrderLines, eliotStart, allowed),
      path,
      10,
    );
    if (eliotCandidate) candidates.push(eliotCandidate);
  }

  const scoredLineCandidates = topLines
    .map((line, index) => {
      const title = cleanTitleCandidate(line.text, path);
      if (!title) return null;

      return {
        title,
        score: titleScore(line, index) + 4 - titleLinePenalty(title),
      };
    })
    .filter((candidate): candidate is { title: string; score: number } => Boolean(candidate));

  candidates.push(...scoredLineCandidates);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].title;
}

function pickDoiFromLines(lines: TextLine[]): string | null {
  for (const line of lines.slice(0, 32)) {
    const doi = extractDoiCandidate(line.text);
    if (doi) {
      return doi;
    }
  }

  return null;
}

export async function extractLocalPdfMetadataPreview(
  path: string,
): Promise<LocalPdfMetadataPreview> {
  const pdfData = await readLocalBinaryFile(path);
  const safePdfData = new Uint8Array(pdfData);
  const loadingTask = pdfjs.getDocument(buildPdfJsDataDocumentInit(safePdfData) as any);
  const pdfDocument = await loadingTask.promise;

  try {
    const metadata = await pdfDocument.getMetadata().catch(() => null);
    const info = (metadata?.info ?? {}) as Record<string, unknown>;
    const rawTitle = decodePdfMetadataValue(info.Title);
    const rawAuthor = decodePdfMetadataValue(info.Author);
    const rawSubject = decodePdfMetadataValue(info.Subject);
    const rawKeywords = decodePdfMetadataValue(info.Keywords);
    const dateYear =
      decodePdfMetadataValue(info.CreationDate) || decodePdfMetadataValue(info.ModDate);

    const firstPage = await pdfDocument.getPage(1);
    const textContent = await firstPage.getTextContent();
    const lines = collectPageLines(textContent);
    const firstPageText = normalizeWhitespace(lines.map((line) => line.text).join(' '));
    const title =
      pickPdfTitleFromLines(lines, path) ??
      cleanTitleCandidate(rawTitle, path) ??
      cleanTitleCandidate(fileStem(path), path);
    const doi =
      extractDoiCandidate(rawTitle) ??
      extractDoiCandidate(rawSubject) ??
      extractDoiCandidate(rawKeywords) ??
      pickDoiFromLines(lines);
    const authors = cleanAuthorsCandidate(rawAuthor);
    const publication =
      rawSubject && !/^(摘要|abstract|keywords?)$/i.test(rawSubject) ? rawSubject : null;
    const year = parsePdfMetadataDate(dateYear);

    firstPage.cleanup();

    return {
      title,
      authors,
      doi,
      publication,
      year,
      firstPageText,
    };
  } finally {
    await pdfDocument.destroy();
  }
}
