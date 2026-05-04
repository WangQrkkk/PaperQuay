import { useCallback, useEffect } from 'react';

import {
  detectLocalZoteroDataDir,
  selectLocalZoteroDataDir,
} from '../../services/zotero';
import {
  emitZoteroImportRequest,
  LIBRARY_SETTINGS_UPDATED_EVENT,
  type LibrarySettingsUpdatedEventDetail,
} from '../literature/libraryEvents';

type LocaleTextFn = (zh: string, en: string) => string;

type SyncNativeLibraryZoteroDir = (
  dataDir: string,
  source?: string,
) => Promise<unknown>;

export interface UseReaderZoteroSyncOptions {
  l: LocaleTextFn;
  zoteroLocalDataDir: string;
  setZoteroLocalDataDir: (value: string) => void;
  setLibraryLoading: (value: boolean) => void;
  setError: (value: string) => void;
  setStatusMessage: (value: string) => void;
  syncNativeLibraryZoteroDir: SyncNativeLibraryZoteroDir;
}

export function useReaderZoteroSync({
  l,
  zoteroLocalDataDir,
  setZoteroLocalDataDir,
  setLibraryLoading,
  setError,
  setStatusMessage,
  syncNativeLibraryZoteroDir,
}: UseReaderZoteroSyncOptions) {
  const syncAndQueueZoteroImport = useCallback(
    async (dataDir: string, source: string) => {
      const normalizedDataDir = dataDir.trim();

      if (!normalizedDataDir) {
        setStatusMessage(
          l(
            '未找到 Zotero 本地目录，请先自动查找或手动选择包含 zotero.sqlite 的目录。',
            'No Zotero local directory was found. Detect or choose the folder containing zotero.sqlite first.',
          ),
        );
        return false;
      }

      setZoteroLocalDataDir(normalizedDataDir);
      await syncNativeLibraryZoteroDir(normalizedDataDir, source);
      emitZoteroImportRequest(normalizedDataDir, source);
      setStatusMessage(
        l(
          '已提交 Zotero 导入任务，分类、标签和 PDF 将导入当前文库。',
          'Zotero import has been submitted. Collections, tags, and PDFs will be imported into the current library.',
        ),
      );
      return true;
    },
    [l, setStatusMessage, setZoteroLocalDataDir, syncNativeLibraryZoteroDir],
  );

  const handleDetectLocalZotero = useCallback(async () => {
    setLibraryLoading(true);
    setError('');

    try {
      const dataDir = await detectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage(l('未找到 Zotero 本地目录', 'No Zotero local directory found'));
        return;
      }

      setZoteroLocalDataDir(dataDir);
      await syncNativeLibraryZoteroDir(dataDir, 'reader-zotero-detect');
      setStatusMessage(
        l(
          '已找到 Zotero 本地目录。点击“读取并导入本地文库”即可导入分类和 PDF。',
          'Zotero local directory found. Click "Read and Import to Library" to import collections and PDFs.',
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('自动查找 Zotero 目录失败', 'Failed to auto-detect the Zotero directory');
      setError(message);
      setStatusMessage(message);
    } finally {
      setLibraryLoading(false);
    }
  }, [
    l,
    setError,
    setLibraryLoading,
    setStatusMessage,
    setZoteroLocalDataDir,
    syncNativeLibraryZoteroDir,
  ]);

  const handleSelectLocalZoteroDir = useCallback(async () => {
    setError('');

    try {
      const dataDir = await selectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage(l('未选择 Zotero 目录', 'No Zotero directory selected'));
        return;
      }

      setZoteroLocalDataDir(dataDir);
      await syncNativeLibraryZoteroDir(dataDir, 'reader-zotero-select');
      setStatusMessage(
        l(
          '已选择 Zotero 本地目录。点击“读取并导入本地文库”即可导入分类和 PDF。',
          'Zotero local directory selected. Click "Read and Import to Library" to import collections and PDFs.',
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('选择 Zotero 目录失败', 'Failed to choose the Zotero directory');
      setError(message);
      setStatusMessage(message);
    }
  }, [
    l,
    setError,
    setStatusMessage,
    setZoteroLocalDataDir,
    syncNativeLibraryZoteroDir,
  ]);

  const handleReloadLocalZotero = useCallback(async () => {
    setLibraryLoading(true);
    setError('');

    try {
      const dataDir = zoteroLocalDataDir.trim() || (await detectLocalZoteroDataDir()) || '';
      await syncAndQueueZoteroImport(dataDir, 'reader-zotero-reload');
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('重新读取 Zotero 文库失败', 'Failed to reload the Zotero library');
      setError(message);
      setStatusMessage(message);
    } finally {
      setLibraryLoading(false);
    }
  }, [
    l,
    setError,
    setLibraryLoading,
    setStatusMessage,
    syncAndQueueZoteroImport,
    zoteroLocalDataDir,
  ]);

  const handleImportLocalZoteroToNativeLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setError('');

    try {
      const dataDir = zoteroLocalDataDir.trim() || (await detectLocalZoteroDataDir()) || '';
      await syncAndQueueZoteroImport(dataDir, 'reader-preferences');
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('提交 Zotero 导入失败', 'Failed to submit Zotero import');

      setError(message);
      setStatusMessage(message);
    } finally {
      setLibraryLoading(false);
    }
  }, [
    l,
    setError,
    setLibraryLoading,
    setStatusMessage,
    syncAndQueueZoteroImport,
    zoteroLocalDataDir,
  ]);

  useEffect(() => {
    const handleLibrarySettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LibrarySettingsUpdatedEventDetail>).detail;

      if (!detail?.settings || detail.source?.startsWith('reader')) {
        return;
      }

      setZoteroLocalDataDir(detail.settings.zoteroLocalDataDir.trim());
    };

    window.addEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);

    return () => {
      window.removeEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
    };
  }, [setZoteroLocalDataDir]);

  return {
    handleDetectLocalZotero,
    handleImportLocalZoteroToNativeLibrary,
    handleReloadLocalZotero,
    handleSelectLocalZoteroDir,
  };
}
