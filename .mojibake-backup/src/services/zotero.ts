import { invoke } from '@tauri-apps/api/core';
import type {
  ZoteroCollection,
  ZoteroDownloadResult,
  ZoteroKeyInfo,
  ZoteroLibraryItem,
  ZoteroRelatedNote,
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

export async function lookupZoteroKey(apiKey: string): Promise<ZoteroKeyInfo> {
  try {
    return await invoke<ZoteroKeyInfo>('zotero_lookup_key', { apiKey });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Zotero API Key 信息失败'));
  }
}

export async function listZoteroLibraryItems(options: {
  apiKey: string;
  userId: string;
  limit?: number;
}): Promise<ZoteroLibraryItem[]> {
  try {
    return await invoke<ZoteroLibraryItem[]>('zotero_list_library_items', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Zotero 閺傚洨灏炴惔鎾炽亼鐠?));
  }
}

export async function detectLocalZoteroDataDir(): Promise<string | null> {
  try {
    return await invoke<string | null>('zotero_detect_local_data_dir');
  } catch (error) {
    throw new Error(toErrorMessage(error, '自动查找本地 Zotero 数据目录失败'));
  }
}

export async function selectLocalZoteroDataDir(): Promise<string | null> {
  try {
    return await invoke<string | null>('zotero_select_local_data_dir');
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择本地 Zotero 数据目录失败'));
  }
}

export async function listLocalZoteroCollections(options: {
  dataDir?: string;
}): Promise<ZoteroCollection[]> {
  try {
    return await invoke<ZoteroCollection[]>('zotero_list_local_collections', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 Zotero 分类失败'));
  }
}

export async function listLocalZoteroLibraryItems(options: {
  dataDir?: string;
  limit?: number;
}): Promise<ZoteroLibraryItem[]> {
  try {
    return await invoke<ZoteroLibraryItem[]>('zotero_list_local_library_items', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 Zotero 閺傚洨灏炴惔鎾炽亼鐠?));
  }
}

export async function listLocalZoteroCollectionItems(options: {
  dataDir?: string;
  collectionKey: string;
  limit?: number;
}): Promise<ZoteroLibraryItem[]> {
  try {
    return await invoke<ZoteroLibraryItem[]>('zotero_list_local_collection_items', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取本地 Zotero 分类文献失败'));
  }
}

export async function downloadZoteroAttachmentPdf(options: {
  apiKey: string;
  userId: string;
  attachmentKey: string;
  filename?: string;
}): Promise<ZoteroDownloadResult> {
  try {
    return await invoke<ZoteroDownloadResult>('zotero_download_attachment_pdf', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '下载 Zotero PDF 附件失败'));
  }
}

export async function listLocalZoteroRelatedNotes(options: {
  dataDir?: string;
  itemKey: string;
}): Promise<ZoteroRelatedNote[]> {
  try {
    return await invoke<ZoteroRelatedNote[]>('zotero_list_related_notes', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Zotero 关联笔记失败'));
  }
}

export function buildZoteroAttachmentPdfUrl(userId: string, attachmentKey: string): string {
  return `https://api.zotero.org/users/${encodeURIComponent(userId)}/items/${encodeURIComponent(
    attachmentKey,
  )}/file`;
}
