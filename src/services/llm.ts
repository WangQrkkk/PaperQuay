import { invoke } from '@tauri-apps/api/core';
import type {
  OpenAICompatibleTestOptions,
  OpenAICompatibleTestResult,
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

export async function testOpenAICompatibleChat(
  options: OpenAICompatibleTestOptions,
): Promise<OpenAICompatibleTestResult> {
  try {
    return await invoke<OpenAICompatibleTestResult>('test_openai_compatible_chat', {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '测试 OpenAI 兼容接口失败'));
  }
}
