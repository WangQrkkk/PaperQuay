import { pdfjs } from 'react-pdf';
import { readLocalBinaryFile } from './desktop';
import type { LocalPdfMetadataPreview } from '../types/metadata';
import { getFileNameFromPath } from '../utils/text';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

interface TextLine {
  text: string;
  y: number;
  avgHeight: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
    '中国知网',
    'cnki',
  ].some((token) => normalized.includes(token));
}

function cleanTitleCandidate(value: string, path: string): string | null {
  const normalized = normalizeWhitespace(value)
    .replace(/^[【\[]?摘\s*要[】\]]?/i, '')
    .replace(/^[【\[]?abstract[】\]]?/i, '')
    .trim();

  if (
    !normalized ||
    normalized.length < 6 ||
    normalized.length > 220 ||
    /^(doi|摘要|abstract|关键词|key words?)[:：]?$/i.test(normalized) ||
    /^https?:\/\//i.test(normalized) ||
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
    .split(/\s*(?:;|；|、|\/| and | AND )\s*/g)
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

  if (!normalized) {
    return true;
  }

  if (normalized.length < 4 || normalized.length > 240) {
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

function collectPageLines(textContent: {
  items: Array<Record<string, unknown>>;
}): TextLine[] {
  const textItems = (textContent.items as Array<Record<string, unknown>>)
    .map((item) => ({
      text: typeof item.str === 'string' ? item.str : '',
      x: Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0,
      height: typeof item.height === 'number' ? item.height : 0,
    }))
    .filter((item) => item.text.trim());

  const sorted = [...textItems].sort((left, right) => {
    if (Math.abs(right.y - left.y) > 2.4) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const lines: Array<Array<typeof sorted[number]>> = [];

  for (const item of sorted) {
    const currentLine = lines[lines.length - 1];

    if (!currentLine) {
      lines.push([item]);
      continue;
    }

    const currentY =
      currentLine.reduce((sum, value) => sum + value.y, 0) / Math.max(currentLine.length, 1);

    if (Math.abs(currentY - item.y) <= 2.8) {
      currentLine.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines
    .map((line) => {
      const sortedLine = [...line].sort((left, right) => left.x - right.x);
      const text = normalizeWhitespace(sortedLine.map((item) => item.text).join(' '));
      const y = sortedLine.reduce((sum, item) => sum + item.y, 0) / sortedLine.length;
      const avgHeight =
        sortedLine.reduce((sum, item) => sum + item.height, 0) / Math.max(sortedLine.length, 1);

      return { text, y, avgHeight };
    })
    .filter((line) => !isLowSignalLine(line.text));
}

function titleScore(line: TextLine, index: number): number {
  const lengthScore = Math.max(0, 36 - Math.abs(line.text.length - 36));
  const topScore = Math.max(0, 20 - index * 2);
  const fontScore = Math.min(40, line.avgHeight * 3.2);
  const digitPenalty = /\d{4,}/.test(line.text) ? 8 : 0;
  const punctuationPenalty = /[;；。！？!?]$/.test(line.text) ? 6 : 0;

  return fontScore + topScore + lengthScore - digitPenalty - punctuationPenalty;
}

function pickTitleFromLines(lines: TextLine[], path: string): string | null {
  const candidates = lines
    .slice(0, 12)
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

function pickDoiFromLines(lines: TextLine[]): string | null {
  for (const line of lines.slice(0, 24)) {
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
  const loadingTask = pdfjs.getDocument({ data: safePdfData });
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
      cleanTitleCandidate(rawTitle, path) ??
      pickTitleFromLines(lines, path) ??
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
