import type { ReactNode } from 'react';

import type {
  OpenAICompatibleModelListResult,
  OpenAICompatibleTestResult,
  QaModelPreset,
  ReaderSettings,
} from '../../types/reader';
import type { LibrarySettings } from '../../types/library';
import type { BatchProgressState, PreferencesSectionKey } from './readerShared';

export type ReaderPreferencesLocalizer = <T>(zh: T, en: T) => T;

export type ReaderSettingsChangeHandler = <Key extends keyof ReaderSettings>(
  key: Key,
  value: ReaderSettings[Key],
) => void;

export interface ReaderPreferencesSectionDescriptor {
  key: PreferencesSectionKey;
  title: string;
  description: string;
  icon: ReactNode;
}

export interface ReaderPreferencesWindowProps {
  open: boolean;
  onClose: () => void;
  preferredSection?: PreferencesSectionKey;
  settings: ReaderSettings;
  librarySettings: LibrarySettings | null;
  zoteroLocalDataDir: string;
  mineruApiToken: string;
  translationApiKey: string;
  summaryApiKey: string;
  embeddingApiKey: string;
  qaModelPresets: QaModelPreset[];
  zoteroApiKey: string;
  zoteroUserId: string;
  libraryLoading: boolean;
  mineruBatchCandidateCount: number;
  mineruBatchHydrating?: boolean;
  statusMessage?: string;
  errorMessage?: string;
  translating?: boolean;
  translatedCount?: number;
  onSettingChange: ReaderSettingsChangeHandler;
  onNativeLibrarySettingsChange: (patch: Partial<LibrarySettings>) => void;
  onSelectLibraryStorageDir: () => void;
  onZoteroLocalDataDirChange: (value: string) => void;
  onMineruApiTokenChange: (value: string) => void;
  onTranslationApiKeyChange: (value: string) => void;
  onSummaryApiKeyChange: (value: string) => void;
  onEmbeddingApiKeyChange: (value: string) => void;
  onZoteroApiKeyChange: (value: string) => void;
  onZoteroUserIdChange: (value: string) => void;
  onDetectLocalZotero: () => void;
  onSelectLocalZoteroDir: () => void;
  onReloadLocalZotero: () => void;
  onImportLocalZotero: () => void;
  onEnrichAllLibraryMetadata: () => void;
  onSelectMineruCacheDir: () => void;
  onSelectRemotePdfDownloadDir: () => void;
  onListLlmModels: (preset: QaModelPreset) => Promise<OpenAICompatibleModelListResult>;
  onTestLlmConnection: (preset?: QaModelPreset) => Promise<OpenAICompatibleTestResult>;
  onQaModelPresetAdd: () => void;
  onQaModelPresetRemove: (presetId: string) => void;
  onQaModelPresetChange: (presetId: string, patch: Partial<QaModelPreset>) => void;
  onTranslate?: (() => void) | null;
  onCancelTranslate?: (() => void) | null;
  onClearTranslations?: (() => void) | null;
  onBatchMineruParse: () => void;
  onBatchTranslateEnglish: () => void;
  onBatchGenerateSummaries: () => void;
  onToggleBatchMineruPause: () => void;
  onCancelBatchMineru: () => void;
  onToggleBatchTranslationPause: () => void;
  onCancelBatchTranslation: () => void;
  onToggleBatchSummaryPause: () => void;
  onCancelBatchSummary: () => void;
  batchMineruRunning?: boolean;
  batchTranslationRunning?: boolean;
  batchSummaryRunning?: boolean;
  batchMineruPaused?: boolean;
  batchTranslationPaused?: boolean;
  batchSummaryPaused?: boolean;
  batchMineruProgress: BatchProgressState;
  batchTranslationProgress: BatchProgressState;
  batchSummaryProgress: BatchProgressState;
}
