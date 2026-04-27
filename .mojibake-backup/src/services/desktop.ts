import { invoke } from '@tauri-apps/api/core';
import type { PdfSource } from '../types/reader';

export interface AppDefaultPaths {
  executableDir: string;
  configPath: string;
  mineruCacheDir: string;
  remotePdfDownloadDir: string;
}

export interface LocalDirectoryFileEntry {
  path: string;
  name: string;
  size: number;
  modifiedAtMs: number;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function decodeAscii(bytes: Uint8Array): string {
  let text = '';

  for (let index = 0; index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }

  return text;
}

function assertProbablyCompletePdf(bytes: Uint8Array, sourceLabel: string): void {
  const head = decodeAscii(bytes.slice(0, Math.min(bytes.length, 1024)));
  const tail = decodeAscii(bytes.slice(Math.max(0, bytes.length - 8192)));

  if (!head.includes('%PDF-') || !tail.includes('%%EOF')) {
    throw new Error(`PDF 鏂囦欢涓嶅畬鏁存垨鏍煎紡寮傚父锛?{sourceLabel}`);
  }
}

export async function selectLocalPdfSource(): Promise<PdfSource> {
  try {
    const path = await invoke<string | null>('select_pdf_file');

    return path ? { kind: 'local-path', path } : null;
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择 PDF 文件失败'));
  }
}

export async function selectLocalMineruJsonPath(): Promise<string | null> {
  try {
    return await invoke<string | null>('select_json_file');
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择 MinerU JSON 文件失败'));
  }
}

export async function selectChatAttachmentPaths(
  kind: 'image' | 'file' = 'file',
): Promise<string[]> {
  try {
    return (await invoke<string[] | null>('select_attachment_files', { kind })) ?? [];
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择问答附件失败'));
  }
}

export async function selectDirectory(title?: string): Promise<string | null> {
  try {
    return await invoke<string | null>('select_directory', { title });
  } catch (error) {
    throw new Error(toErrorMessage(error, '閫夋嫨鏂囦欢澶瑰け璐?));
  }
}

export async function listLocalDirectoryFiles(
  directory: string,
  extensionFilter?: string,
): Promise<LocalDirectoryFileEntry[]> {
  try {
    return await invoke<LocalDirectoryFileEntry[]>('list_directory_files', {
      directory,
      extensionFilter: extensionFilter ?? null,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, `璇诲彇鐩綍澶辫触锛?{directory}`));
  }
}

export async function selectSavePdfPath(options?: {
  suggestedFileName?: string;
  initialDirectory?: string;
}): Promise<string | null> {
  try {
    return await invoke<string | null>('select_save_pdf_path', {
      suggestedFileName: options?.suggestedFileName ?? null,
      initialDirectory: options?.initialDirectory ?? null,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择 PDF 保存路径失败'));
  }
}

export async function getAppDefaultPaths(): Promise<AppDefaultPaths> {
  try {
    return await invoke<AppDefaultPaths>('get_app_default_paths');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取桌面应用默认路径失败'));
  }
}

export async function readLocalTextFile(path: string): Promise<string> {
  try {
    return await invoke<string>('read_text_file', { path });
  } catch (error) {
    throw new Error(toErrorMessage(error, `鐠囪褰囬弬鍥ㄦ拱閺傚洣娆㈡径杈Е閿?{path}`));
  }
}

export async function writeLocalTextFile(path: string, content: string): Promise<void> {
  try {
    await invoke('write_text_file', { path, content });
  } catch (error) {
    throw new Error(toErrorMessage(error, `閸愭瑥鍙嗛弬鍥ㄦ拱閺傚洣娆㈡径杈Е閿?{path}`));
  }
}

export async function readLocalBinaryFile(path: string): Promise<Uint8Array> {
  try {
    const base64 = await invoke<string>('read_binary_file_base64', { path });

    return decodeBase64(base64);
  } catch (error) {
    throw new Error(toErrorMessage(error, `读取二进制文件失败：${path}`));
  }
}

export async function writeLocalBinaryFile(path: string, data: Uint8Array): Promise<void> {
  try {
    await invoke('write_binary_file_base64', {
      path,
      contentBase64: encodeBase64(data),
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, `写入二进制文件失败：${path}`));
  }
}

export async function downloadRemoteFileToPath(
  url: string,
  path: string,
  headers?: Record<string, string>,
): Promise<void> {
  try {
    await invoke('download_remote_file_to_path', {
      url,
      path,
      headers: headers ?? null,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, `鏉╂粎鈻奸弬鍥︽娑撳娴囨径杈Е閿?{path}`));
  }
}

export async function loadPdfBinary(source: PdfSource): Promise<Uint8Array | null> {
  if (!source) {
    return null;
  }

  if (source.kind === 'local-path') {
    const bytes = await readLocalBinaryFile(source.path);
    assertProbablyCompletePdf(bytes, source.path);

    return bytes;
  }

  const response = await fetch(source.url, {
    headers: source.headers,
  });

  if (!response.ok) {
    throw new Error(`远程 PDF 閸旂姾娴囨径杈Е閿?{response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const bytes = new Uint8Array(buffer);
  assertProbablyCompletePdf(bytes, source.fileName || source.url);

  return bytes;
}

export async function runMineruPlaceholder(pdfPath: string): Promise<string> {
  try {
    return await invoke<string>('run_mineru_placeholder', { pdfPath });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用 MinerU 预留入口失败'));
  }
}

export interface MineruCloudParseOptions {
  apiToken: string;
  pdfPath: string;
  extractDir?: string;
  language?: string;
  modelVersion?: string;
  enableFormula?: boolean;
  enableTable?: boolean;
  isOcr?: boolean;
  timeoutSecs?: number;
  pollIntervalSecs?: number;
}

export interface MineruCloudParseResult {
  batchId: string;
  dataId: string;
  fileName: string;
  state: string;
  fullZipUrl: string;
  contentJsonText: string | null;
  middleJsonText: string | null;
  markdownText: string | null;
  assetRootDir: string | null;
  contentJsonPath: string | null;
  middleJsonPath: string | null;
  markdownPath: string | null;
  zipEntries: string[];
}

export async function runMineruCloudParse(
  options: MineruCloudParseOptions,
): Promise<MineruCloudParseResult> {
  try {
    return await invoke<MineruCloudParseResult>('run_mineru_cloud_parse', { options });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用 MinerU 云端解析失败'));
  }
}
