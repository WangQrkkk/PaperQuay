import { readLocalBinaryFile } from './desktop';
import { bytesToDataUrl, guessMimeTypeFromPath } from '../utils/files';

const localAssetUrlCache = new Map<string, Promise<string>>();

export async function loadLocalAssetDataUrl(path: string): Promise<string> {
  const normalizedPath = path.trim();

  if (!normalizedPath) {
    throw new Error('Asset path is empty');
  }

  if (/^[a-zA-Z]+:\/\//.test(normalizedPath)) {
    return normalizedPath;
  }

  const existingTask = localAssetUrlCache.get(normalizedPath);

  if (existingTask) {
    return existingTask;
  }

  const nextTask = readLocalBinaryFile(normalizedPath).then((bytes) =>
    bytesToDataUrl(bytes, guessMimeTypeFromPath(normalizedPath)),
  );

  localAssetUrlCache.set(normalizedPath, nextTask);

  try {
    return await nextTask;
  } catch (error) {
    localAssetUrlCache.delete(normalizedPath);
    throw error;
  }
}

export function clearLocalAssetDataUrlCache(path?: string): void {
  if (path) {
    localAssetUrlCache.delete(path.trim());
    return;
  }

  localAssetUrlCache.clear();
}
