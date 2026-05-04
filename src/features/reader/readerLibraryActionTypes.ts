import type { Dispatch, SetStateAction } from 'react';

import type {
  MineruPage,
  OpenAICompatibleTestResult,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderSettings,
  TranslationMap,
  WorkspaceItem,
} from '../../types/reader';
import type {
  LiteraturePaperTaskKind,
  LiteraturePaperTaskState,
} from '../../types/library';
import type {
  BatchProgressState,
  LibraryPreviewLoadResult,
  LibraryPreviewOutcome,
  LibraryPreviewState,
  MineruCacheManifest,
  PreferencesSectionKey,
} from './readerShared';

export type LocaleTextFn = <T,>(zh: T, en: T) => T;

export type CreatePaperTaskState = (
  kind: LiteraturePaperTaskKind,
  status: LiteraturePaperTaskState['status'],
  message: string,
  completed?: number | null,
  total?: number | null,
) => LiteraturePaperTaskState;

export type AppWindowLike = {
  minimize: () => Promise<unknown>;
  toggleMaximize: () => Promise<unknown>;
  close: () => Promise<unknown>;
};

export interface UseReaderLibraryActionsOptions {
  allKnownItems: WorkspaceItem[];
  appWindow: AppWindowLike;
  configHydrated: boolean;
  createPaperTaskState: CreatePaperTaskState;
  findExistingMineruJson: (
    item: WorkspaceItem,
  ) => Promise<
    Awaited<
      ReturnType<typeof import('./readerLibraryPreview').readExistingMineruJson>
    >
  >;
  generateLibraryPreview: (
    item: WorkspaceItem,
    force?: boolean,
    options?: { allowGenerate?: boolean },
  ) => Promise<LibraryPreviewOutcome>;
  itemParseStatusMap: Record<string, boolean | undefined>;
  l: LocaleTextFn;
  libraryPreviewStates: Record<string, LibraryPreviewState>;
  loadLibraryPreviewBlocks: (item: WorkspaceItem) => Promise<LibraryPreviewLoadResult>;
  mineruApiToken: string;
  settings: ReaderSettings;
  setError: (value: string) => void;
  setLibraryPreviewStates: Dispatch<
    SetStateAction<Record<string, LibraryPreviewState>>
  >;
  setLibraryTranslationSnapshots: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          targetLanguage: string;
          translations: TranslationMap;
          updatedAt: number;
        }
      >
    >
  >;
  setNativeLibraryItems: Dispatch<SetStateAction<WorkspaceItem[]>>;
  setPreferencesOpen: (value: boolean) => void;
  setPreferredPreferencesSection: (value: PreferencesSectionKey | undefined) => void;
  setSelectedLibraryItemId: Dispatch<SetStateAction<string | null>>;
  setStandaloneItems: Dispatch<SetStateAction<WorkspaceItem[]>>;
  setStatusMessage: (value: string) => void;
  summaryConfigured: boolean;
  syncLibraryParsedState: (
    item: WorkspaceItem,
    jsonText: string,
    jsonPath: string,
    status: string,
  ) => {
    pages: MineruPage[];
    blocks: PositionedMineruBlock[];
  };
  translationModelPreset: QaModelPreset | null | undefined;
  updateLibraryPreviewOperation: (
    item: WorkspaceItem,
    operation: LiteraturePaperTaskState | null,
    patch?: Partial<Omit<LibraryPreviewState, 'operation'>>,
  ) => void;
  updateSetting: <Key extends keyof ReaderSettings>(
    key: Key,
    value: ReaderSettings[Key],
  ) => void;
  saveLibraryMineruParseCache: (options: {
    item: WorkspaceItem;
    pdfPath: string;
    sourceKind: MineruCacheManifest['sourceKind'];
    contentJsonText?: string | null;
    middleJsonText?: string | null;
    markdownText?: string | null;
    batchId?: string;
    dataId?: string;
    fileName?: string;
    zipEntries?: string[];
  }) => Promise<
    Awaited<
      ReturnType<typeof import('./readerLibraryPreview').writeMineruParseCache>
    >
  >;
  openTab: (documentId: string, title: string) => string;
}
