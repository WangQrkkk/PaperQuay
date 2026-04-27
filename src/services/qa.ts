import { invoke } from '@tauri-apps/api/core';
import type {
  OpenAICompatibleQaOptions,
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

export async function askDocumentOpenAICompatible(
  options: OpenAICompatibleQaOptions,
): Promise<string> {
  try {
    return await invoke<string>('ask_document_openai_compatible', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用论文问答接口失败'));
  }
}
