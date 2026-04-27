import { pdfjs } from 'react-pdf';
import type {
  PositionedMineruBlock,
  ReaderSettings,
  SummaryBlockInput,
} from '../types/reader';
import {
  buildRenderableBlocks,
  extractTextFromMineruBlock,
} from './mineru';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const SUMMARY_PROMPT_VERSION = 'summary-prompt-v3';

export function resolveSummaryOutputLanguage(settings: ReaderSettings): string {
  const configured = settings.summaryOutputLanguage.trim();

  if (!configured || configured === 'follow-ui') {
    return settings.uiLanguage === 'en-US' ? 'English' : 'Chinese';
  }

  return configured;
}

function normalizePdfPageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildSummaryBlockInputs(
  blocks: PositionedMineruBlock[],
): SummaryBlockInput[] {
  return blocks
    .map((block) => ({
      blockId: block.blockId,
      blockType: block.type,
      pageIndex: block.pageIndex,
      text: extractTextFromMineruBlock(block),
    }))
    .filter((block) => block.text.trim().length > 0);
}

export function buildMineruMarkdownDocument(
  blocks: PositionedMineruBlock[],
  mineruPath?: string,
): string {
  return buildRenderableBlocks(blocks, mineruPath)
    .map((renderable) => renderable.markdown.trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function extractPdfTextByPdfJs(
  pdfData: Uint8Array,
): Promise<string> {
  // pdf.js 可能会转移传入的 ArrayBuffer，这里始终复制一份，避免后续再次问答或摘要时原始数据被 detached。
  const safePdfData = new Uint8Array(pdfData);
  const loadingTask = pdfjs.getDocument({ data: safePdfData });
  const pdfDocument = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = normalizePdfPageText(
        textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      );

      if (pageText) {
        pages.push(`# Page ${pageNumber}\n${pageText}`);
      }

      page.cleanup();
    }
  } finally {
    await pdfDocument.destroy();
  }

  return pages.join('\n\n');
}
