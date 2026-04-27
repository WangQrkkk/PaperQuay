import { invoke } from '@tauri-apps/api/core';
import type {
  OpenAICompatibleTranslateOptions,
  TranslationBlockOutput,
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

export async function translateBlocksOpenAICompatible(
  options: OpenAICompatibleTranslateOptions,
): Promise<TranslationBlockOutput[]> {
  try {
    return await invoke<TranslationBlockOutput[]>('translate_blocks_openai_compatible', {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用 OpenAI 兼容翻译接口失败'));
  }
}
