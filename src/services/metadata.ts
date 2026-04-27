import { invoke } from '@tauri-apps/api/core';
import type {
  MetadataLookupRequest,
  MetadataLookupResult,
} from '../types/metadata';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function lookupLiteratureMetadata(
  request: MetadataLookupRequest,
): Promise<MetadataLookupResult | null> {
  try {
    return await invoke<MetadataLookupResult | null>('lookup_literature_metadata', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '自动补全文献元数据失败'));
  }
}
