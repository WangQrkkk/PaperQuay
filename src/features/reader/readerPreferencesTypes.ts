import type { ReactNode } from 'react';

import type {
  OpenAICompatibleTestResult,
  QaModelPreset,
  ReaderSettings,
} from '../../types/reader';
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
  zoteroLocalDataDir: string;
  mineruApiToken: string;
  translationApiKey: string;
  summaryApiKey: string;
  qaModelPresets: QaModelPreset[];
  zoteroApiKey: string;
  zoteroUserId: string;
  libraryLoading: boolean;
  translating?: boolean;
  translatedCount?: number;
  onSettingChange: ReaderSettingsChangeHandler;
  onZoteroLocalDataDirChange: (value: string) => void;
  onMineruApiTokenChange: (value: string) => void;
  onTranslationApiKeyChange: (value: string) => void;
  onSummaryApiKeyChange: (value: string) => void;
  onZoteroApiKeyChange: (value: string) => void;
  onZoteroUserIdChange: (value: string) => void;
  onDetectLocalZotero: () => void;
  onSelectLocalZoteroDir: () => void;
  onReloadLocalZotero: () => void;
  onImportLocalZotero: () => void;
  onSelectMineruCacheDir: () => void;
  onSelectRemotePdfDownloadDir: () => void;
  onTestLlmConnection: (preset?: QaModelPreset) => Promise<OpenAICompatibleTestResult>;
  onQaModelPresetAdd: () => void;
  onQaModelPresetRemove: (presetId: string) => void;
  onQaModelPresetChange: (presetId: string, patch: Partial<QaModelPreset>) => void;
  onTranslate?: (() => void) | null;
  onClearTranslations?: (() => void) | null;
  onBatchMineruParse: () => void;
  onBatchGenerateSummaries: () => void;
  onToggleBatchMineruPause: () => void;
  onCancelBatchMineru: () => void;
  onToggleBatchSummaryPause: () => void;
  onCancelBatchSummary: () => void;
  batchMineruRunning?: boolean;
  batchSummaryRunning?: boolean;
  batchMineruPaused?: boolean;
  batchSummaryPaused?: boolean;
  batchMineruProgress: BatchProgressState;
  batchSummaryProgress: BatchProgressState;
}
