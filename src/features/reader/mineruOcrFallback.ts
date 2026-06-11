import {
  runMineruCloudParse,
  type MineruCloudParseOptions,
  type MineruCloudParseResult,
} from '../../services/desktop';
import { parseMineruPages } from '../../services/mineru';

export interface MineruParseWithFallbackResult {
  result: MineruCloudParseResult;
  jsonText: string;
  blockCount: number;
  usedOcr: boolean;
}

function getMineruJsonText(result: MineruCloudParseResult): string {
  return result.contentJsonText ?? result.middleJsonText ?? '';
}

function countParsedBlocks(jsonText: string): number {
  return parseMineruPages(jsonText).reduce((count, page) => count + page.length, 0);
}

function createEmptyResultError() {
  return new Error('MinerU returned an empty structured result.');
}

function shouldRetryWithOcr(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (!message.trim()) {
    return true;
  }

  return !/(api\s*token|authorization|unauthori[sz]ed|forbidden|http\s*(?:401|403)|upload url|upload failed|zip download|timed?\s*out|timeout)/i.test(
    message,
  );
}

async function runAttempt(
  options: MineruCloudParseOptions,
  usedOcr: boolean,
): Promise<MineruParseWithFallbackResult> {
  const result = await runMineruCloudParse({
    ...options,
    isOcr: usedOcr,
  });
  const jsonText = getMineruJsonText(result);

  if (!jsonText.trim()) {
    throw createEmptyResultError();
  }

  const blockCount = countParsedBlocks(jsonText);

  if (blockCount <= 0) {
    throw createEmptyResultError();
  }

  return {
    result,
    jsonText,
    blockCount,
    usedOcr,
  };
}

export async function runMineruCloudParseWithOcrFallback(
  options: MineruCloudParseOptions,
  onRetry?: () => void,
): Promise<MineruParseWithFallbackResult> {
  try {
    return await runAttempt(options, options.isOcr === true);
  } catch (firstError) {
    if (options.isOcr === true || !shouldRetryWithOcr(firstError)) {
      throw firstError;
    }

    onRetry?.();
    return runAttempt(options, true);
  }
}
