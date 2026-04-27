import { invoke } from '@tauri-apps/api/core';
import type {
  OpenAICompatibleSummaryOptions,
  PaperSummary,
} from '../types/reader';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function summarizeDocumentOpenAICompatible(
  options: OpenAICompatibleSummaryOptions,
): Promise<PaperSummary> {
  try {
    return await invoke<PaperSummary>('summarize_document_openai_compatible', {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用论文总览摘要接口失败'));
  }
}
