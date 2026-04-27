import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpenText,
  Database,
  FolderOpen,
  Languages,
  Library,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import TabBar from '../../components/tabs/TabBar';
import LibraryPreviewPane from '../library/LibraryPreviewPane';
import LibraryWorkspace from '../library/LibraryWorkspace';
import DocumentReaderTab, {
  type LibraryPreviewSyncPayload,
  type ReaderTabBridgeState,
} from './DocumentReaderTab';
import {
  getAppDefaultPaths,
  readLocalBinaryFile,
  readLocalTextFile,
  runMineruCloudParse,
  selectDirectory,
  selectLocalPdfSource,
  writeLocalTextFile,
} from '../../services/desktop';
import type { AppDefaultPaths } from '../../services/desktop';
import {
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import { testOpenAICompatibleChat } from '../../services/llm';
import { summarizeDocumentOpenAICompatible } from '../../services/summary';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
} from '../../services/summarySource';
import {
  detectLocalZoteroDataDir,
  listLocalZoteroCollectionItems,
  listLocalZoteroCollections,
  listLocalZoteroLibraryItems,
  selectLocalZoteroDataDir,
} from '../../services/zotero';
import { HOME_TAB_ID, useTabsStore, type ReaderTab } from '../../stores/useTabsStore';
import type {
  FlatCollection,
  LibrarySectionKey,
  OpenAICompatibleTestResult,
  PaperSummary,
  QaModelPreset,
  ReaderConfigFile,
  ReaderSecrets,
  ReaderSettings,
  SummarySourceMode,
  TranslationDisplayMode,
  PositionedMineruBlock,
  WorkspaceItem,
  ZoteroCollection,
  ZoteroLibraryItem,
} from '../../types/reader';
import { truncateMiddle, getFileNameFromPath } from '../../utils/text';
import {
  buildLegacyMineruCachePaths,
  buildLegacyMineruSummaryCachePath,
  buildMineruCachePaths,
  buildMineruSummaryCachePath,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache';
import { loadPaperHistory } from '../../utils/paperHistory';

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'paper-reader-left-sidebar-collapsed-v1';
const DEFAULT_QA_PRESET_ID = 'default';
const READER_CONFIG_VERSION = 1;

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'English', label: 'English' },
  { value: 'Chinese', label: '中文' },
  { value: 'Japanese', label: '鏃ユ湰瑾? },
  { value: 'Korean', label: '頃滉淡鞏? },
  { value: 'French', label: 'Fran?ais' },
  { value: 'German', label: 'Deutsch' },
  { value: 'Spanish', label: 'Espa?ol' },
];

const SUMMARY_SOURCE_OPTIONS: Array<{
  value: SummarySourceMode;
  label: string;
  description: string;
}> = [
  {
    value: 'mineru-markdown',
    label: 'MinerU Markdown',
    description: '优先读取 full.md閿涘本鐥呴張澶嬫閻劌缍嬮崜宥囩波閺嬪嫬娼￠幏鍏煎复閹?Markdown 閸愬秴褰傜紒娆愭喅鐟曚焦膩閸ㄥ鈧?,
  },
  {
    value: 'pdf-text',
    label: 'PDF 文本',
    description: '使用 pdf.js 閸︺劍婀伴崷鐗堝絹閸?PDF 鏂囨湰锛屽啀鍙戠粰鎽樿妯″瀷銆?,
  },
];

const QA_SOURCE_OPTIONS: Array<{
  value: ReaderSettings['qaSourceMode'];
  label: string;
  description: string;
}> = [
  {
    value: 'mineru-markdown',
    label: 'MinerU 内容',
    description: '优先使用 MinerU 解析结果或拼接后的结构化 Markdown 浣滀负闂瓟涓婁笅鏂囥€?,
  },
  {
    value: 'pdf-text',
    label: '本地 PDF 文本',
    description: '使用 pdf.js 鍦ㄦ湰鍦版彁鍙栨暣绡?PDF 閺傚洦婀伴敍灞藉晙閹绘劒绶电紒娆撴６缁涙梹膩閸ㄥ鈧?,
  },
];

const DEFAULT_SETTINGS: ReaderSettings = {
  autoLoadSiblingJson: false,
  autoMineruParse: false,
  autoGenerateSummary: false,
  libraryBatchConcurrency: 1,
  autoTranslateSelection: false,
  smoothScroll: true,
  compactReading: false,
  showBlockMeta: true,
  hidePageDecorationsInBlockView: false,
  softPageShadow: true,
  mineruCacheDir: '',
  remotePdfDownloadDir: '',
  translationBatchSize: 10,
  translationConcurrency: 1,
  translationBaseUrl: 'https://api.openai.com',
  translationModel: 'gpt-4o-mini',
  summaryBaseUrl: 'https://api.openai.com',
  summaryModel: 'gpt-4o-mini',
  translationModelPresetId: 'default',
  selectionTranslationModelPresetId: 'default',
  summaryModelPresetId: 'default',
  summarySourceMode: 'mineru-markdown',
  qaSourceMode: 'mineru-markdown',
  translationSourceLanguage: 'English',
  translationTargetLanguage: 'Chinese',
  translationDisplayMode: 'translated',
  qaActivePresetId: 'default',
};

const DEFAULT_QA_PRESET: QaModelPreset = {
  id: DEFAULT_QA_PRESET_ID,
  label: '默认问答模型',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  labelCustomized: false,
};

const DEFAULT_SECRETS: ReaderSecrets = {
  mineruApiToken: '',
  translationApiKey: '',
  summaryApiKey: '',
  zoteroApiKey: '',
  zoteroUserId: '',
  qaModelPresets: [DEFAULT_QA_PRESET],
};

function createQaPreset(partial?: Partial<QaModelPreset>): QaModelPreset {
  const nextModel = partial?.model ?? DEFAULT_QA_PRESET.model;
  const explicitLabel = typeof partial?.label === 'string' ? partial.label : undefined;
  const labelCustomized =
    partial?.labelCustomized ??
    (explicitLabel !== undefined &&
      explicitLabel.trim() !== '' &&
      explicitLabel.trim() !== nextModel.trim());
  const nextLabel =
    explicitLabel !== undefined
      ? explicitLabel || (!labelCustomized ? nextModel : '')
      : partial?.id === DEFAULT_QA_PRESET_ID
        ? DEFAULT_QA_PRESET.label
        : labelCustomized
          ? ''
          : nextModel;

  return {
    id: partial?.id?.trim() || `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    label: nextLabel,
    baseUrl: partial?.baseUrl ?? DEFAULT_QA_PRESET.baseUrl,
    apiKey: partial?.apiKey ?? '',
    model: nextModel,
    labelCustomized,
  };
}

function getQaModelPresetKey(preset: QaModelPreset) {
  return `${preset.baseUrl.trim()}::${preset.model.trim()}::${preset.apiKey.trim()}`;
}

function getQaModelPresetScore(preset: QaModelPreset) {
  let score = 0;

  if (preset.baseUrl.trim()) {
    score += 1;
  }

  if (preset.model.trim()) {
    score += 1;
  }

  if (preset.apiKey.trim()) {
    score += 2;
  }

  if (preset.label.trim()) {
    score += 1;
  }

  if (preset.labelCustomized) {
    score += 1;
  }

  return score;
}

function isDefaultQaPresetPlaceholder(preset: QaModelPreset) {
  const normalizedLabel = preset.label.trim();

  return (
    !preset.apiKey.trim() &&
    preset.baseUrl.trim() === DEFAULT_QA_PRESET.baseUrl &&
    preset.model.trim() === DEFAULT_QA_PRESET.model &&
    (!preset.labelCustomized ||
      normalizedLabel === '' ||
      normalizedLabel === DEFAULT_QA_PRESET.label ||
      normalizedLabel === DEFAULT_QA_PRESET.model)
  );
}

function normalizeQaModelPresets(presets: unknown): QaModelPreset[] {
  if (!Array.isArray(presets)) {
    return [DEFAULT_QA_PRESET];
  }

  const normalized = presets
    .filter((preset): preset is Partial<QaModelPreset> => Boolean(preset && typeof preset === 'object'))
    .map((preset) => createQaPreset(preset));

  return normalized.length > 0 ? dedupeQaModelPresets(normalized) : [DEFAULT_QA_PRESET];
}

function dedupeQaModelPresets(presets: QaModelPreset[]): QaModelPreset[] {
  const bestById = new Map<string, QaModelPreset>();

  for (const preset of presets.map((item) => createQaPreset(item))) {
    const existing = bestById.get(preset.id);

    if (!existing || getQaModelPresetScore(preset) > getQaModelPresetScore(existing)) {
      bestById.set(preset.id, preset);
    }
  }

  const bestByKey = new Map<string, QaModelPreset>();

  for (const preset of bestById.values()) {
    const key = getQaModelPresetKey(preset);
    const existing = bestByKey.get(key);

    if (!existing || getQaModelPresetScore(preset) > getQaModelPresetScore(existing)) {
      bestByKey.set(key, preset);
    }
  }

  const normalized = Array.from(bestByKey.values());
  const filtered =
    normalized.length > 1
      ? normalized.filter((preset) => !isDefaultQaPresetPlaceholder(preset))
      : normalized;

  return filtered.length > 0 ? filtered.map((preset) => createQaPreset(preset)) : [DEFAULT_QA_PRESET];
}

function buildLegacyModelPresets(
  settings: Partial<ReaderSettings>,
  secrets: Partial<ReaderSecrets>,
): QaModelPreset[] {
  const presets = normalizeQaModelPresets(secrets.qaModelPresets);
  const existingKeys = new Set(
    presets.map((preset) => `${preset.baseUrl.trim()}::${preset.model.trim()}::${preset.apiKey.trim()}`),
  );
  const extras: QaModelPreset[] = [];

  if (
    settings.translationBaseUrl?.trim() ||
    settings.translationModel?.trim() ||
    secrets.translationApiKey?.trim()
  ) {
    const legacyTranslationPreset = createQaPreset({
      id: 'legacy-translation',
      label: settings.translationModel?.trim() || 'Document Translation',
      model: settings.translationModel?.trim() || DEFAULT_QA_PRESET.model,
      baseUrl: settings.translationBaseUrl?.trim() || DEFAULT_QA_PRESET.baseUrl,
      apiKey: secrets.translationApiKey?.trim() || '',
    });
    const translationKey = `${legacyTranslationPreset.baseUrl.trim()}::${legacyTranslationPreset.model.trim()}::${legacyTranslationPreset.apiKey.trim()}`;

    if (!existingKeys.has(translationKey)) {
      extras.push(legacyTranslationPreset);
      existingKeys.add(translationKey);
    }
  }

  if (
    settings.summaryBaseUrl?.trim() ||
    settings.summaryModel?.trim() ||
    secrets.summaryApiKey?.trim()
  ) {
    const legacySummaryPreset = createQaPreset({
      id: 'legacy-summary',
      label: settings.summaryModel?.trim() || 'Paper Summary',
      model: settings.summaryModel?.trim() || DEFAULT_QA_PRESET.model,
      baseUrl: settings.summaryBaseUrl?.trim() || DEFAULT_QA_PRESET.baseUrl,
      apiKey: secrets.summaryApiKey?.trim() || '',
    });
    const summaryKey = `${legacySummaryPreset.baseUrl.trim()}::${legacySummaryPreset.model.trim()}::${legacySummaryPreset.apiKey.trim()}`;

    if (!existingKeys.has(summaryKey)) {
      extras.push(legacySummaryPreset);
    }
  }

  return dedupeQaModelPresets([...presets, ...extras]);
}

function resolveModelPreset(
  presets: QaModelPreset[],
  presetId: string | undefined,
): QaModelPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null;
}

interface LibraryPreviewState {
  summary: PaperSummary | null;
  loading: boolean;
  error: string;
  hasBlocks: boolean;
  blockCount: number;
  currentPdfName: string;
  currentJsonName: string;
  statusMessage: string;
  sourceKey: string;
}

interface LibraryPreviewLoadResult {
  blocks: PositionedMineruBlock[];
  currentPdfName: string;
  currentJsonName: string;
  statusMessage: string;
  pdfPath?: string;
  markdownText?: string;
}

type LibraryPreviewOutcome = 'loaded' | 'generated' | 'skipped' | 'failed';

interface SummaryCacheEnvelope {
  version: number;
  sourceKey: string;
  summarizedAt: string;
  summary: PaperSummary;
}

interface BatchProgressState {
  running: boolean;
  total: number;
  completed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  currentLabel: string;
}

interface MineruCacheManifest {
  version: number;
  documentKey: string;
  title: string;
  pdfPath: string;
  savedAt: string;
  sourceKind: 'cloud' | 'manual-json' | 'sibling-json';
  batchId?: string;
  dataId?: string;
  fileName?: string;
  zipEntries?: string[];
}

const EMPTY_LIBRARY_PREVIEW_STATE: LibraryPreviewState = {
  summary: null,
  loading: false,
  error: '',
  hasBlocks: false,
  blockCount: 0,
  currentPdfName: '未选择',
  currentJsonName: '鏈姞杞?,
  statusMessage: '閫夋嫨涓€绡囪鏂囧悗浼氬湪杩欓噷鐢熸垚姒傝銆?,
  sourceKey: '',
};

const EMPTY_BATCH_PROGRESS: BatchProgressState = {
  running: false,
  total: 0,
  completed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  currentLabel: '',
};

function getAutoParseAttemptKey(item: WorkspaceItem): string {
  return `${item.workspaceId}::${item.localPdfPath?.trim() ?? ''}`;
}

function getAutoSummaryAttemptKey(
  item: WorkspaceItem,
  sourceMode: SummarySourceMode,
  hasParse: boolean,
): string {
  return `${item.workspaceId}::${sourceMode}::${item.localPdfPath?.trim() ?? ''}::${hasParse ? 'parsed' : 'unparsed'}`;
}

function clampBatchConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function clampTranslationBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.translationBatchSize;
  }

  return Math.min(50, Math.max(1, Math.trunc(value)));
}

function clampTranslationConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.translationConcurrency;
  }

  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function normalizeReaderSettings(value?: Partial<ReaderSettings> | null): ReaderSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(value ?? {}),
  };

  return {
    ...merged,
    libraryBatchConcurrency: clampBatchConcurrency(merged.libraryBatchConcurrency),
    translationBatchSize: clampTranslationBatchSize(merged.translationBatchSize),
    translationConcurrency: clampTranslationConcurrency(merged.translationConcurrency),
    translationDisplayMode: 'translated',
  };
}

function loadSettings(): ReaderSettings {
  try {
    const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);

    return storedSettings
      ? normalizeReaderSettings(JSON.parse(storedSettings) as Partial<ReaderSettings>)
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadSecrets(): ReaderSecrets {
  try {
    const storedSecrets = localStorage.getItem(SECRETS_STORAGE_KEY);

    if (!storedSecrets) {
      return DEFAULT_SECRETS;
    }

    const parsed = JSON.parse(storedSecrets) as Partial<ReaderSecrets>;

    return {
      ...DEFAULT_SECRETS,
      ...parsed,
      qaModelPresets: normalizeQaModelPresets(parsed.qaModelPresets),
    };
  } catch {
    return DEFAULT_SECRETS;
  }
}

function mergeReaderConfigWithDefaults(
  value: Partial<ReaderConfigFile> | null | undefined,
  fallbackSettings: ReaderSettings,
  fallbackSecrets: ReaderSecrets,
  defaultPaths: AppDefaultPaths,
): ReaderConfigFile {
  const nextSettings = normalizeReaderSettings({
    ...fallbackSettings,
    ...(value?.settings ?? {}),
  });
  const nextSecrets: ReaderSecrets = {
    ...DEFAULT_SECRETS,
    ...fallbackSecrets,
    ...(value?.secrets ?? {}),
    qaModelPresets: normalizeQaModelPresets(
      value?.secrets?.qaModelPresets ?? fallbackSecrets.qaModelPresets,
    ),
  };

  if (!nextSettings.mineruCacheDir.trim()) {
    nextSettings.mineruCacheDir = defaultPaths.mineruCacheDir;
  }

  if (!nextSettings.remotePdfDownloadDir.trim()) {
    nextSettings.remotePdfDownloadDir = defaultPaths.remotePdfDownloadDir;
  }

  return {
    version: value?.version ?? READER_CONFIG_VERSION,
    settings: nextSettings,
    secrets: nextSecrets,
    zoteroLocalDataDir: value?.zoteroLocalDataDir ?? '',
    leftSidebarCollapsed: value?.leftSidebarCollapsed ?? false,
  };
}

function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

function mergeLocalPdfPath<T extends { localPdfPath?: string }>(current: T, incoming: T): string | undefined {
  return Object.prototype.hasOwnProperty.call(incoming, 'localPdfPath')
    ? incoming.localPdfPath
    : current.localPdfPath;
}

function normalizeWorkspaceItem(
  item: ZoteroLibraryItem,
  source: WorkspaceItem['source'] = 'zotero-local',
): WorkspaceItem {
  const workspaceId =
    source === 'standalone'
      ? item.itemKey
      : `${item.itemKey}::${item.attachmentKey ?? item.localPdfPath ?? item.attachmentFilename ?? 'default'}`;

  return {
    ...item,
    source,
    workspaceId,
    groupKey: source === 'standalone' ? workspaceId : `zotero:${item.itemKey}`,
  };
}

function createStandaloneItem(path: string): WorkspaceItem {
  const filename = getFileNameFromPath(path);
  const title = filename.replace(/\.pdf$/i, '') || '鏈懡鍚?PDF';

  const workspaceId = `standalone:${path}`;

  return {
    itemKey: workspaceId,
    title,
    creators: '独立 PDF',
    year: '',
    itemType: 'pdf',
    localPdfPath: path,
    source: 'standalone',
    workspaceId,
    groupKey: workspaceId,
  };
}

function buildFlatCollections(collections: ZoteroCollection[]): FlatCollection[] {
  const grouped = new Map<string | null, ZoteroCollection[]>();
  const collectionMap = new Map(collections.map((collection) => [collection.collectionKey, collection]));

  for (const collection of collections) {
    const parentKey = collection.parentCollectionKey ?? null;
    const bucket = grouped.get(parentKey) ?? [];
    bucket.push(collection);
    grouped.set(parentKey, bucket);
  }

  const sortCollections = (items: ZoteroCollection[]) =>
    [...items].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

  const visited = new Set<string>();
  const output: FlatCollection[] = [];

  const walk = (parentKey: string | null, depth: number) => {
    for (const collection of sortCollections(grouped.get(parentKey) ?? [])) {
      visited.add(collection.collectionKey);
      output.push({
        ...collection,
        depth,
      });
      walk(collection.collectionKey, depth + 1);
    }
  };

  walk(null, 0);

  for (const collection of sortCollections(collections)) {
    if (visited.has(collection.collectionKey)) {
      continue;
    }

    const parentExists = collection.parentCollectionKey
      ? collectionMap.has(collection.parentCollectionKey)
      : false;

    output.push({
      ...collection,
      depth: parentExists ? 1 : 0,
    });
  }

  return output;
}

function matchesLibraryQuery(item: WorkspaceItem, query: string): boolean {
  if (!query.trim()) {
    return true;
  }

  const normalizedQuery = query.trim().toLowerCase();

  return [item.title, item.creators, item.year, item.attachmentFilename]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalizedQuery));
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:border-slate-300 hover:bg-white"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-indigo-500' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

function ProgressBar({
  value,
  total,
  tone = 'indigo',
}: {
  value: number;
  total: number;
  tone?: 'indigo' | 'emerald';
}) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className={clsx(
          'h-full rounded-full transition-all duration-300',
          tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500',
        )}
        style={{ width: `${ratio}%` }}
      />
    </div>
  );
}

function BatchProgressCard({
  title,
  progress,
  tone = 'indigo',
}: {
  title: string;
  progress: BatchProgressState;
  tone?: 'indigo' | 'emerald';
}) {
  if (!progress.running && progress.total === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-slate-500">
          {progress.completed}/{progress.total}
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={progress.completed} total={progress.total} tone={tone} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>成功 {progress.succeeded}</span>
        <span>跳过 {progress.skipped}</span>
        <span>失败 {progress.failed}</span>
      </div>
      {progress.currentLabel ? (
        <div className="mt-2 truncate text-xs text-slate-500">{progress.currentLabel}</div>
      ) : null}
    </div>
  );
}

function PreferencesPanel({
  open,
  onClose,
  settings,
  zoteroLocalDataDir,
  mineruApiToken,
  translationApiKey,
  summaryApiKey,
  qaModelPresets,
  zoteroApiKey,
  zoteroUserId,
  libraryLoading,
  translating = false,
  translatedCount = 0,
  onSettingChange,
  onZoteroLocalDataDirChange,
  onMineruApiTokenChange,
  onTranslationApiKeyChange,
  onSummaryApiKeyChange,
  onZoteroApiKeyChange,
  onZoteroUserIdChange,
  onDetectLocalZotero,
  onSelectLocalZoteroDir,
  onReloadLocalZotero,
  onSelectMineruCacheDir,
  onSelectRemotePdfDownloadDir,
  onTestLlmConnection,
  onQaModelPresetAdd,
  onQaModelPresetRemove,
  onQaModelPresetChange,
  onTranslate,
  onClearTranslations,
  onBatchMineruParse,
  onBatchGenerateSummaries,
  batchMineruRunning = false,
  batchSummaryRunning = false,
  batchMineruProgress,
  batchSummaryProgress,
}: {
  open: boolean;
  onClose: () => void;
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
  onSettingChange: <Key extends keyof ReaderSettings>(
    key: Key,
    value: ReaderSettings[Key],
  ) => void;
  onZoteroLocalDataDirChange: (value: string) => void;
  onMineruApiTokenChange: (value: string) => void;
  onTranslationApiKeyChange: (value: string) => void;
  onSummaryApiKeyChange: (value: string) => void;
  onZoteroApiKeyChange: (value: string) => void;
  onZoteroUserIdChange: (value: string) => void;
  onDetectLocalZotero: () => void;
  onSelectLocalZoteroDir: () => void;
  onReloadLocalZotero: () => void;
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
  batchMineruRunning?: boolean;
  batchSummaryRunning?: boolean;
  batchMineruProgress: BatchProgressState;
  batchSummaryProgress: BatchProgressState;
}) {
  const [llmTestLoading, setLlmTestLoading] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<OpenAICompatibleTestResult | null>(null);

  if (!open) {
    return null;
  }

  const canTriggerTranslate = Boolean(onTranslate);
  const canClearTranslations = Boolean(onClearTranslations);
  const canTestLlm = Boolean(
    settings.translationBaseUrl.trim() &&
      settings.translationModel.trim() &&
      translationApiKey.trim(),
  );

  const handleTestLlmConnection = async () => {
    setLlmTestLoading(true);
    setLlmTestResult(null);

    try {
      const result = await onTestLlmConnection();
      setLlmTestResult(result);
    } catch (nextError) {
      setLlmTestResult({
        ok: false,
        endpoint: settings.translationBaseUrl.trim(),
        model: settings.translationModel.trim(),
        latencyMs: 0,
        message: nextError instanceof Error ? nextError.message : '濞村鐦径褎膩閸ㄥ绻涢幒銉ャ亼鐠?,
      });
    } finally {
      setLlmTestLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-[#3b352d]/18 backdrop-blur-[1px]">
      <button type="button" className="flex-1 cursor-default" onClick={onClose} aria-label="关闭偏好设置" />
      <aside className="flex h-full w-[440px] max-w-[calc(100vw-24px)] flex-col border-l border-[#ddd8cf] bg-[#f7f5f1] shadow-[-24px_0_48px_rgba(45,39,30,0.08)]">
        <div className="flex items-center justify-between border-b border-[#ddd8cf] px-5 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a9387]">
              Preferences
            </div>
            <h2 className="mt-1 text-lg font-semibold text-[#2f2c28]">偏好设置</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#ddd8cf] bg-white px-3 py-1.5 text-sm text-[#5f594f] transition hover:bg-[#fcfbf8]"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a9387]">
              本地文库
            </div>
            <div className="space-y-3 rounded-2xl border border-[#ddd8cf] bg-white p-4">
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">Zotero 数据目录</span>
                <input
                  value={zoteroLocalDataDir}
                  onChange={(event) => onZoteroLocalDataDirChange(event.target.value)}
                  placeholder="例如 C:\\Users\\Lenovo\\Zotero"
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={onDetectLocalZotero}
                  disabled={libraryLoading}
                  className="rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#5f594f] transition hover:bg-[#f1ede6] disabled:opacity-60"
                >
                  自动查找
                </button>
                <button
                  type="button"
                  onClick={onSelectLocalZoteroDir}
                  disabled={libraryLoading}
                  className="rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#5f594f] transition hover:bg-[#f1ede6] disabled:opacity-60"
                >
                  选择目录
                </button>
                <button
                  type="button"
                  onClick={onReloadLocalZotero}
                  disabled={libraryLoading}
                  className="rounded-xl border border-[#d8c4ae] bg-[#efe4d8] px-3 py-2 text-sm font-medium text-[#7a4c38] transition hover:bg-[#ead8c5] disabled:opacity-60"
                >
                  重新读取
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a9387]">
              阅读
            </div>
            <div className="space-y-3 rounded-2xl border border-[#ddd8cf] bg-white p-4">
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a9387]">
              MinerU 涓庣炕璇?
            </div>
            <div className="space-y-3 rounded-2xl border border-[#ddd8cf] bg-white p-4">
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">MinerU API Token</span>
                <input
                  value={mineruApiToken}
                  onChange={(event) => onMineruApiTokenChange(event.target.value)}
                  type="password"
                  placeholder="用于云端解析 PDF"
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">解析缓存目录</span>
                <input
                  value={settings.mineruCacheDir}
                  onChange={(event) => onSettingChange('mineruCacheDir', event.target.value)}
                  placeholder="用于保存 content_list_v2.json / full.md / manifest"
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onSelectMineruCacheDir}
                    className="rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#5f594f] transition hover:bg-[#f1ede6]"
                  >
                    选择目录
                  </button>
                  <button
                    type="button"
                    onClick={() => onSettingChange('mineruCacheDir', '')}
                    className="rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#5f594f] transition hover:bg-[#f1ede6]"
                  >
                    清空路径
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">OpenAI 兼容 Base URL</span>
                <input
                  value={settings.translationBaseUrl}
                  onChange={(event) => onSettingChange('translationBaseUrl', event.target.value)}
                  placeholder="https://api.openai.com"
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
                <div className="mt-2 rounded-xl border border-[#e7dfd6] bg-[#fbfaf8] px-3 py-2 text-xs leading-5 text-[#7b7468]">
                  推荐只填服务根地址：`https://api.openai.com`，程序会自动拼接
                  `/v1/chat/completions`銆傚鏋滃吋瀹规湇鍔″彧缁欏畬鏁村湴鍧€锛屼篃鍙互鐩存帴濉?
                  `https://xxx.example.com/v1/chat/completions`閿涘瞼鈻兼惔蹇庣窗鐠囧棗鍩嗛獮鍫曚缉閸忓秹鍣告径宥嗗閹恒儯鈧?
                </div>
                <div className="mt-2 grid gap-2 text-xs text-[#7b7468]">
                  <div className="rounded-lg bg-[#f6f1eb] px-3 py-2">
                    OpenAI 示例：Base URL = `https://api.openai.com`，Model = `gpt-4o-mini`
                  </div>
                  <div className="rounded-lg bg-[#f6f1eb] px-3 py-2">
                    兼容服务示例：Base URL = `https://api.deepseek.com`，Model = `deepseek-chat`
                  </div>
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">OpenAI 兼容 API Key</span>
                <input
                  value={translationApiKey}
                  onChange={(event) => onTranslationApiKeyChange(event.target.value)}
                  type="password"
                  placeholder="OpenAI 鎴栧吋瀹规湇鍔?
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">模型名称</span>
                <input
                  value={settings.translationModel}
                  onChange={(event) => onSettingChange('translationModel', event.target.value)}
                  placeholder="gpt-4o-mini / qwen-plus / deepseek-chat"
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
              <div className="rounded-2xl border border-[#e7dfd6] bg-[#fbfaf8] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#2f2c28]">娴嬭瘯澶фā鍨嬭繛鎺?/div>
                    <div className="mt-1 text-xs leading-5 text-[#7b7468]">
                      使用当前 Base URL、API Key 鍜屾ā鍨嬪悕鍙戦€佷竴娆℃渶灏?`chat/completions` 璇锋眰銆?
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestLlmConnection()}
                    disabled={!canTestLlm || llmTestLoading}
                    className="shrink-0 rounded-xl bg-[#2f2c28] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1f1d1a] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {llmTestLoading ? '娴嬭瘯涓€? : '测试'}
                  </button>
                </div>
                {!canTestLlm ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                    请先填写 Base URL、API Key 鍜屾ā鍨嬪悕绉般€?
                  </div>
                ) : null}
                {llmTestResult ? (
                  <div
                    className={clsx(
                      'mt-3 rounded-xl border px-3 py-2 text-xs leading-5',
                      llmTestResult.ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700',
                    )}
                  >
                    <div className="font-medium">
                      {llmTestResult.ok ? '连接成功' : '连接失败'}
                      {llmTestResult.latencyMs ? ` 璺?${llmTestResult.latencyMs} ms` : ''}
                    </div>
                    <div className="mt-1 break-all">Endpoint：{llmTestResult.endpoint || '閺堫亣袙閺?}</div>
                    <div className="mt-1 break-all">
                      Model：{llmTestResult.responseModel || llmTestResult.model || '鏈繑鍥?}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{llmTestResult.message}</div>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#2f2c28]">原文语言</span>
                  <select
                    value={settings.translationSourceLanguage}
                    onChange={(event) =>
                      onSettingChange('translationSourceLanguage', event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                  >
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#2f2c28]">目标语言</span>
                  <select
                    value={settings.translationTargetLanguage}
                    onChange={(event) =>
                      onSettingChange('translationTargetLanguage', event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                  >
                    {LANGUAGE_OPTIONS.filter((language) => language.value !== 'auto').map(
                      (language) => (
                        <option key={language.value} value={language.value}>
                          {language.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-[#2f2c28]">右侧显示模式</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['original', '原文'],
                    ['translated', '译文'],
                    ['bilingual', '双语'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        onSettingChange('translationDisplayMode', value as TranslationDisplayMode)
                      }
                      className={clsx(
                        'rounded-xl border px-3 py-2 text-sm transition',
                        settings.translationDisplayMode === value
                          ? 'border-[#c6a78b] bg-[#f3e5d5] text-[#7a4c38]'
                          : 'border-[#ddd8cf] bg-[#fbfaf8] text-[#5f594f] hover:bg-[#f1ede6]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onTranslate?.()}
                  disabled={!canTriggerTranslate || translating}
                  className="rounded-xl bg-[#b8624e] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#a85541] disabled:opacity-60"
                >
                  {translating ? '缈昏瘧涓€? : '翻译当前文稿'}
                </button>
                <button
                  type="button"
                  onClick={() => onClearTranslations?.()}
                  disabled={!canClearTranslations}
                  className="rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-4 py-2.5 text-sm text-[#5f594f] transition hover:bg-[#f1ede6] disabled:opacity-60"
                >
                  清空译文
                </button>
              </div>
              <div className="rounded-xl bg-[#f6f1eb] px-3 py-2 text-xs text-[#7b7468]">
                瑜版挸澧犲鑼处鐎?{translatedCount} 涓粨鏋勫潡璇戞枃銆?
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#9a9387]">
              Zotero Web 回退
            </div>
            <div className="space-y-3 rounded-2xl border border-[#ddd8cf] bg-white p-4">
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">Zotero API Key</span>
                <input
                  value={zoteroApiKey}
                  onChange={(event) => onZoteroApiKeyChange(event.target.value)}
                  type="password"
                  placeholder="仅在本地 PDF 缂傚搫銇戦弮鏈靛▏閻?
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#2f2c28]">User ID</span>
                <input
                  value={zoteroUserId}
                  onChange={(event) => onZoteroUserIdChange(event.target.value)}
                  placeholder="鍙暀绌猴紝棣栨浣跨敤鏃惰嚜鍔ㄨ鍙?
                  className="mt-2 w-full rounded-xl border border-[#ddd8cf] bg-[#fbfaf8] px-3 py-2 text-sm text-[#2f2c28] outline-none transition focus:border-[#b38d6d] focus:bg-white"
                />
              </label>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

type PreferencesWindowProps = Parameters<typeof PreferencesPanel>[0];

function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div>
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {description ? <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function SettingsInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white',
        props.className,
      )}
    />
  );
}

function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white',
        props.className,
      )}
    />
  );
}

function PreferencesWindow({
  open,
  onClose,
  settings,
  zoteroLocalDataDir,
  mineruApiToken,
  translationApiKey,
  summaryApiKey,
  qaModelPresets,
  zoteroApiKey,
  zoteroUserId,
  libraryLoading,
  translating = false,
  translatedCount = 0,
  onSettingChange,
  onZoteroLocalDataDirChange,
  onMineruApiTokenChange,
  onTranslationApiKeyChange,
  onSummaryApiKeyChange,
  onZoteroApiKeyChange,
  onZoteroUserIdChange,
  onDetectLocalZotero,
  onSelectLocalZoteroDir,
  onReloadLocalZotero,
  onSelectMineruCacheDir,
  onSelectRemotePdfDownloadDir,
  onTestLlmConnection,
  onQaModelPresetAdd,
  onQaModelPresetRemove,
  onQaModelPresetChange,
  onTranslate,
  onClearTranslations,
  onBatchMineruParse,
  onBatchGenerateSummaries,
  batchMineruRunning = false,
  batchSummaryRunning = false,
  batchMineruProgress,
  batchSummaryProgress,
}: PreferencesWindowProps) {
  const [activeSection, setActiveSection] = useState<
    'library' | 'reading' | 'mineru' | 'translation'
  >('library');
  const [llmTestLoading, setLlmTestLoading] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<OpenAICompatibleTestResult | null>(null);
  const [presetTestLoadingMap, setPresetTestLoadingMap] = useState<Record<string, boolean>>({});
  const [presetTestResultMap, setPresetTestResultMap] = useState<
    Record<string, OpenAICompatibleTestResult | null>
  >({});
  const activeTranslationPreset = resolveModelPreset(
    qaModelPresets,
    settings.translationModelPresetId,
  );
  const activeSelectionTranslationPreset = resolveModelPreset(
    qaModelPresets,
    settings.selectionTranslationModelPresetId,
  );
  const activeSummaryPreset = resolveModelPreset(
    qaModelPresets,
    settings.summaryModelPresetId,
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const canTriggerTranslate = Boolean(onTranslate);
  const canClearTranslations = Boolean(onClearTranslations);
  const canTestLlm = Boolean(
    activeTranslationPreset?.baseUrl.trim() &&
      activeTranslationPreset?.model.trim() &&
      activeTranslationPreset?.apiKey.trim(),
  );
  const handleTestLlmConnection = async () => {
    setLlmTestLoading(true);
    setLlmTestResult(null);

    try {
      const result = await onTestLlmConnection();
      setLlmTestResult(result);
    } catch (nextError) {
      setLlmTestResult({
        ok: false,
        endpoint: settings.translationBaseUrl.trim(),
        model: settings.translationModel.trim(),
        latencyMs: 0,
        message: nextError instanceof Error ? nextError.message : '濞村鐦径褎膩閸ㄥ绻涢幒銉ャ亼鐠?,
      });
    } finally {
      setLlmTestLoading(false);
    }
  };

  const handleTestModelPreset = async (preset: QaModelPreset) => {
    setPresetTestLoadingMap((current) => ({
      ...current,
      [preset.id]: true,
    }));
    setPresetTestResultMap((current) => ({
      ...current,
      [preset.id]: null,
    }));

    try {
      const result = await onTestLlmConnection(preset);
      setPresetTestResultMap((current) => ({
        ...current,
        [preset.id]: result,
      }));
    } catch (nextError) {
      setPresetTestResultMap((current) => ({
        ...current,
        [preset.id]: {
          ok: false,
          endpoint: preset.baseUrl.trim(),
          model: preset.model.trim(),
          latencyMs: 0,
          message: nextError instanceof Error ? nextError.message : '濡€崇€峰Λ鈧ù瀣亼鐠?,
        },
      }));
    } finally {
      setPresetTestLoadingMap((current) => ({
        ...current,
        [preset.id]: false,
      }));
    }
  };

  const sections = [
    {
      key: 'library' as const,
      title: '鏂囧簱涓?Zotero',
      description: '配置本地 Zotero 数据目录与回退能力',
      icon: <Library className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'reading' as const,
      title: '阅读体验',
      description: '控制联动、滚动、版式与显示细节',
      icon: <BookOpenText className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'mineru' as const,
      title: 'MinerU 解析',
      description: '閰嶇疆浜戠瑙ｆ瀽涓庤В鏋愮紦瀛樼洰褰?,
      icon: <Database className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'translation' as const,
      title: '缈昏瘧涓?AI',
      description: '闁板秶鐤嗗Ο鈥崇€烽妴浣筋嚔鐟封偓閸滃本绁寸拠鏇＄箾閹?,
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/28 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭设置窗口"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="relative flex h-[min(760px,calc(100vh-32px))] w-[min(1080px,calc(100vw-32px))] overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)] shadow-[0_36px_120px_rgba(15,23,42,0.20)]">
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/76 px-4 py-4 backdrop-blur-xl">
          <div className="px-3 pb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Settings
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">设置</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              閸嶅繑顢戦棃銏犵安閻劋绔撮弽椋庮吀閻炲棙鏋冩惔鎾扁偓渚€妲勭拠姹団偓浣叫掗弸鎰瑢濡€崇€烽懗钘夊閵?
            </div>
          </div>

          <div className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200',
                  activeSection === section.key
                    ? 'bg-slate-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
                )}
              >
                <span className={clsx('mt-0.5', activeSection === section.key ? 'text-white' : 'text-slate-400')}>
                  {section.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.title}</span>
                  <span
                    className={clsx(
                      'mt-1 block text-xs leading-5',
                      activeSection === section.key ? 'text-white/72' : 'text-slate-400',
                    )}
                  >
                    {section.description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-auto rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs leading-5 text-slate-500">
            当前翻译缓存：{translatedCount} 个结构块
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/70 px-6 py-4 backdrop-blur-xl">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {sections.find((section) => section.key === activeSection)?.title}
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-950">
                {sections.find((section) => section.key === activeSection)?.description}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50"
            >
              <X className="mr-2 h-4 w-4" strokeWidth={1.8} />
              关闭
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-3xl space-y-4">
              {activeSection === 'library' ? (
                <>
                  <SettingsField
                    label="Zotero 本地数据目录"
                    description="优先读取本地 Zotero 闂勫嫪娆㈡稉搴″瀻缁粯鐖查妴鍌滄窗瑜版洑鑵戞惔鏂垮瘶閸?`zotero.sqlite`閵?
                  >
                    <SettingsInput
                      value={zoteroLocalDataDir}
                      onChange={(event) => onZoteroLocalDataDirChange(event.target.value)}
                      placeholder="例如 C:\\Users\\Lenovo\\Zotero"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onDetectLocalZotero}
                        disabled={libraryLoading}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        自动查找
                      </button>
                      <button
                        type="button"
                        onClick={onSelectLocalZoteroDir}
                        disabled={libraryLoading}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        选择目录
                      </button>
                      <button
                        type="button"
                        onClick={onReloadLocalZotero}
                        disabled={libraryLoading}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        重新读取
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="Zotero Web 回退"
                    description="褰撴湰鍦?PDF 缺失时，直接通过 Zotero Web API 閹垫挸绱戦梽鍕閵?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">API Key</div>
                        <SettingsInput
                          value={zoteroApiKey}
                          onChange={(event) => onZoteroApiKeyChange(event.target.value)}
                          type="password"
                          placeholder="仅在本地 PDF 缂傚搫銇戦弮鏈靛▏閻?
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">User ID</div>
                        <SettingsInput
                          value={zoteroUserId}
                          onChange={(event) => onZoteroUserIdChange(event.target.value)}
                          placeholder="閸欘垳鏆€缁岀尨绱濇＃鏍偧閸ョ偤鈧偓閺冩儼鍤滈崝銊嚢閸?
                        />
                      </div>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="远程 PDF 下载目录"
                    description="当通过 Zotero Web 鎵撳紑闄勪欢鏃讹紝灏?PDF 閼奉亜濮╂穱婵嗙摠閸掔増婀伴崷甯礉閸氬海鐢绘导妯哄帥婢跺秶鏁ら張顒€婀撮弬鍥︽閵?
                  >
                    <SettingsInput
                      value={settings.remotePdfDownloadDir}
                      onChange={(event) =>
                        onSettingChange('remotePdfDownloadDir', event.target.value)
                      }
                      placeholder="选择一个本地目录保存下载的 PDF"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSelectRemotePdfDownloadDir}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                        选择目录
                      </button>
                      <button
                        type="button"
                        onClick={() => onSettingChange('remotePdfDownloadDir', '')}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        清空路径
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="文库自动处理"
                    description="瀵瑰綋鍓嶅凡鍔犺浇鍒?paperquay 閻ㄥ嫭鏋冮悮顔藉⒔鐞涘本澹掗柌蹇擃槱閻炲棴绱濋幋鏍ф躬濡偓濞村鍩岄弬鐗堟瀮閻氼喖鎷伴張顏勵槱閻炲棙鏋冮悮顔芥閼奉亜濮╂径鍕倞閵?
                  >
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="text-sm font-medium text-slate-900">鏂囧簱骞惰鏂囩珷鏁?/div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            鎺у埗鈥滃叏閮?MinerU 鐟欙絾鐎介垾婵嗘嫲閳ユ粌鍙忛柈銊︽喅鐟曚胶鏁撻幋鎰ㄢ偓婵呯濞嗏€虫倱閺冭泛顦╅悶鍡楊樋鐏忔垹鐦掗弬鍥╃彿閵?                          </div>
                        </div>
                        <SettingsInput
                          type="number"
                          min={1}
                          max={8}
                          step={1}
                          value={String(settings.libraryBatchConcurrency)}
                          onChange={(event) =>
                            onSettingChange(
                              'libraryBatchConcurrency',
                              clampBatchConcurrency(Number(event.target.value)),
                            )
                          }
                        />
                      </div>
                      <ToggleRow
                        title="自动 MinerU 解析"
                        description="妫€娴嬪埌鏂板姞鍏ユ垨灏氭湭瑙ｆ瀽鐨勬枃鐚椂锛岃嚜鍔ㄦ墽琛?MinerU 瑙ｆ瀽骞跺啓鍏ユ湰鍦扮紦瀛樼洰褰曘€?
                        checked={settings.autoMineruParse}
                        onChange={(checked) => onSettingChange('autoMineruParse', checked)}
                      />
                      <ToggleRow
                        title="自动摘要生成"
                        description="妫€娴嬪埌鏂板姞鍏ユ垨灏氭湭鐢熸垚鎽樿鐨勬枃鐚椂锛屾寜褰撳墠鎽樿鏉ユ簮鍜屾憳瑕佹ā鍨嬭嚜鍔ㄥ鐞嗐€?
                        checked={settings.autoGenerateSummary}
                        onChange={(checked) => onSettingChange('autoGenerateSummary', checked)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={onBatchMineruParse}
                          disabled={batchMineruRunning}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                        >
                          {batchMineruRunning ? '鎵归噺瑙ｆ瀽涓€? : '全部 MinerU 解析'}
                        </button>
                        <button
                          type="button"
                          onClick={onBatchGenerateSummaries}
                          disabled={batchSummaryRunning}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                        >
                          {batchSummaryRunning ? '閹靛綊鍣洪幗妯款洣娑擃厸鈧? : '全部摘要生成'}
                        </button>
                      </div>
                      <BatchProgressCard
                        title="MinerU 批量解析进度"
                        progress={batchMineruProgress}
                        tone="indigo"
                      />
                      <BatchProgressCard
                        title="批量摘要生成进度"
                        progress={batchSummaryProgress}
                        tone="emerald"
                      />
                    </div>
                  </SettingsField>
                </>
              ) : null}

              {activeSection === 'reading' ? (
                <>
                  <ToggleRow
                    title="鑷姩璇诲彇鍚岀洰褰?JSON"
                    description="打开本地 PDF 鍚庯紝鑷姩灏濊瘯鍔犺浇鍚岀洰褰?`content_list_v2.json`閵?
                    checked={settings.autoLoadSiblingJson}
                    onChange={(checked) => onSettingChange('autoLoadSiblingJson', checked)}
                  />
                  <ToggleRow
                    title="平滑滚动联动"
                    description="点击 PDF 鎴栫粨鏋勫潡鏃朵娇鐢ㄥ钩婊戞粴鍔ㄨ繃娓°€?
                    checked={settings.smoothScroll}
                    onChange={(checked) => onSettingChange('smoothScroll', checked)}
                  />
                  <ToggleRow
                    title="紧凑正文布局"
                    description="閸戝繐鐨紒鎾寸€崠鏍劀閺傚洨鏆€閻ф枻绱濈拋鈺呮鐠囪灏弴鎾肠娑擃厹鈧?
                    checked={settings.compactReading}
                    onChange={(checked) => onSettingChange('compactReading', checked)}
                  />
                  <ToggleRow
                    title="显示块元信息"
                    description="閺勫墽銇氭い鐢电垳閵嗕礁娼℃惔蹇撳娇娑?MinerU 鍧楃被鍨嬨€?
                    checked={settings.showBlockMeta}
                    onChange={(checked) => onSettingChange('showBlockMeta', checked)}
                  />
                  <ToggleRow
                    title="隐藏页码与页脚块"
                    description="鍙充晶缁撴瀯鍖栨鏂囬噷涓嶆樉绀?`page_number` 娑?`page_footer`閿涘奔绮庤ぐ鍗炴惙闂冨懓顕扮憴鍡楁禈閵?
                    checked={settings.hidePageDecorationsInBlockView}
                    onChange={(checked) =>
                      onSettingChange('hidePageDecorationsInBlockView', checked)
                    }
                  />
                  <ToggleRow
                    title="柔和页面阴影"
                    description="鐠?PDF 妞ょ敻娼伴張澶嬫纯鏉炶崵娈戝宀勬桨妫板嫯顫嶇仦鍌涱偧閵?
                    checked={settings.softPageShadow}
                    onChange={(checked) => onSettingChange('softPageShadow', checked)}
                  />
                </>
              ) : null}

              {activeSection === 'mineru' ? (
                <>
                  <SettingsField
                    label="MinerU API Token"
                    description="用于云端解析 PDF銆傛病鏈?Token 时，仍可手动加载本地 JSON閵?
                  >
                    <SettingsInput
                      value={mineruApiToken}
                      onChange={(event) => onMineruApiTokenChange(event.target.value)}
                      type="password"
                      placeholder="输入 MinerU API Token"
                    />
                  </SettingsField>

                  <SettingsField
                    label="解析缓存目录"
                    description="保存 `content_list_v2.json`、`middle.json`、`full.md` 娑?manifest閿涘苯鍑＄憴锝嗙€介弬鍥╁盀閸欘垳娲块幒銉╁櫢鏉炲鈧?
                  >
                    <SettingsInput
                      value={settings.mineruCacheDir}
                      onChange={(event) => onSettingChange('mineruCacheDir', event.target.value)}
                      placeholder="选择一个稳定的本地目录作为解析缓存"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSelectMineruCacheDir}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                        选择目录
                      </button>
                      <button
                        type="button"
                        onClick={() => onSettingChange('mineruCacheDir', '')}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        清空路径
                      </button>
                    </div>
                  </SettingsField>
                </>
              ) : null}

              {activeSection === 'translation' ? (
                <>
                  <SettingsField
                    label="瀹歌弓绻氱€涙ɑ膩閸?
                    description="缁熶竴淇濆瓨鏄剧ず鍚嶇О銆佹ā鍨嬪悕绉般€佸湴鍧€鍜?API Key閿涘苯鍙忛弬鍥╃倳鐠囨垯鈧礁鍨濈拠宥囩倳鐠囨垯鈧焦鎲崇憰浣告嫲闂傤喚鐡熼柈鎴掔矤鏉╂瑩鍣烽柅澶嬪閵?
                  >
                    <div className="space-y-3">
                      {qaModelPresets.map((preset) => (
                        <div
                          key={preset.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">
                              {preset.label || preset.model || '鏈懡鍚嶆ā鍨?}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleTestModelPreset(preset)}
                              disabled={
                                !preset.baseUrl.trim() ||
                                !preset.model.trim() ||
                                !preset.apiKey.trim() ||
                                Boolean(presetTestLoadingMap[preset.id])
                              }
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                            >
                              {presetTestLoadingMap[preset.id] ? '妫€娴嬩腑鈥? : '濡偓濞?}
                            </button>
                            <button
                              type="button"
                              onClick={() => onQaModelPresetRemove(preset.id)}
                              disabled={qaModelPresets.length <= 1}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                            >
                              删除
                            </button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-slate-500">閼奉亜鐣炬稊澶嬫▔缁€鍝勬倳缁?/div>
                              <SettingsInput
                                value={preset.label}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { label: event.target.value })
                                }
                                placeholder="例如：DeepSeek 翻译"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-slate-500">模型名称</div>
                              <SettingsInput
                                value={preset.model}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { model: event.target.value })
                                }
                                placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <div className="text-xs font-medium text-slate-500">地址</div>
                              <SettingsInput
                                value={preset.baseUrl}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { baseUrl: event.target.value })
                                }
                                placeholder="https://api.openai.com"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <div className="text-xs font-medium text-slate-500">API Key</div>
                              <SettingsInput
                                value={preset.apiKey}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { apiKey: event.target.value })
                                }
                                type="password"
                                placeholder="为这个模型保存单独的 API Key"
                              />
                            </div>
                          </div>

                          {!preset.baseUrl.trim() ||
                          !preset.model.trim() ||
                          !preset.apiKey.trim() ? (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                              填写地址、API Key 鍜屾ā鍨嬪悕绉板悗鎵嶈兘妫€娴嬨€?                            </div>
                          ) : null}

                          {presetTestResultMap[preset.id] ? (
                            <div
                              className={clsx(
                                'mt-3 rounded-xl border px-3 py-2 text-xs leading-5',
                                presetTestResultMap[preset.id]?.ok
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-rose-200 bg-rose-50 text-rose-700',
                              )}
                            >
                              <div className="font-medium">
                                {presetTestResultMap[preset.id]?.ok ? '连接成功' : '连接失败'}
                                {presetTestResultMap[preset.id]?.latencyMs
                                  ? ` 璺?${presetTestResultMap[preset.id]!.latencyMs} ms`
                                  : ''}
                              </div>
                              <div className="mt-1 break-all">
                                Endpoint：{presetTestResultMap[preset.id]?.endpoint || '閺堫亣袙閺?}
                              </div>
                              <div className="mt-1 break-all">
                                Model閿?                                {presetTestResultMap[preset.id]?.responseModel ||
                                  presetTestResultMap[preset.id]?.model ||
                                  '鏈繑鍥?}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap">
                                {presetTestResultMap[preset.id]?.message}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={onQaModelPresetAdd}
                        className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                      >
                        新增模型
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="闂瓟涓婁笅鏂囨潵婧?
                    description="控制文档问答优先基于本地 PDF 閺傚洦婀伴敍宀冪箷閺勵垰鐔€娴?MinerU 瑙ｆ瀽鍐呭銆傛病鏈夊垝璇嶆椂涔熶細鎸夎繖閲岀殑鏉ユ簮鎻愪緵鏁寸瘒涓婁笅鏂囥€?
                  >
                    <div className="grid gap-2">
                      {QA_SOURCE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onSettingChange('qaSourceMode', option.value)}
                          className={clsx(
                            'rounded-2xl border px-4 py-3 text-left transition',
                            settings.qaSourceMode === option.value
                              ? 'border-indigo-200 bg-indigo-50/80 text-indigo-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
                          )}
                        >
                          <div className="text-sm font-medium">{option.label}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            {option.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="功能模型绑定"
                    description="鍚勫姛鑳介兘缁戝畾鍒板凡淇濆瓨妯″瀷锛岄棶绛旈粯璁ゆā鍨嬩篃浠庡悓涓€濂楁ā鍨嬪簱閫夋嫨銆?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">全文翻译</div>
                        <SettingsSelect
                          value={settings.translationModelPresetId}
                          onChange={(event) =>
                            onSettingChange('translationModelPresetId', event.target.value)
                          }
                        >
                          {qaModelPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label || preset.model}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">划词翻译</div>
                        <SettingsSelect
                          value={settings.selectionTranslationModelPresetId}
                          onChange={(event) =>
                            onSettingChange('selectionTranslationModelPresetId', event.target.value)
                          }
                        >
                          {qaModelPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label || preset.model}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">??</div>
                        <SettingsSelect
                          value={settings.summaryModelPresetId}
                          onChange={(event) =>
                            onSettingChange('summaryModelPresetId', event.target.value)
                          }
                        >
                          {qaModelPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label || preset.model}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">默认问答</div>
                        <SettingsSelect
                          value={settings.qaActivePresetId}
                          onChange={(event) => onSettingChange('qaActivePresetId', event.target.value)}
                        >
                          {qaModelPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label || preset.model}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="缈昏瘧鎵规涓庡苟鍙?
                    description="鎺у埗鍏ㄦ枃缈昏瘧鏃舵瘡娆″彂閫佸灏戠粨鏋勫潡锛屼互鍙婂悓鏃跺苟鍙戝灏戞壒璇锋眰銆?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">每批块数</div>
                        <SettingsInput
                          type="number"
                          min={1}
                          max={50}
                          value={String(settings.translationBatchSize)}
                          onChange={(event) =>
                            onSettingChange(
                              'translationBatchSize',
                              Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">楠炶泛褰傞幍瑙勵偧閺?/div>
                        <SettingsInput
                          type="number"
                          min={1}
                          max={8}
                          value={String(settings.translationConcurrency)}
                          onChange={(event) =>
                            onSettingChange(
                              'translationConcurrency',
                              Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                            )
                          }
                        />
                      </div>
                    </div>
                  </SettingsField>

                  {false ? (
                  <SettingsField
                    label="Model Status and Test"
                    description="Saved models are shared across document translation, selection translation, summary, and QA. This test uses the current document translation model."
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { label: 'Document', preset: activeTranslationPreset },
                        {
                          label: 'Selection',
                          preset: activeSelectionTranslationPreset ?? activeTranslationPreset,
                        },
                        {
                          label: 'Summary / Preview',
                          preset: activeSummaryPreset ?? activeTranslationPreset,
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
                        >
                          <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                            {item.label}
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-900">
                            {item.preset?.label || item.preset?.model || 'Unselected'}
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">
                            {item.preset?.model || 'No model configured'}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">Test Current Translation Model</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            Send a minimal `chat/completions` request with the model bound to document translation.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleTestLlmConnection()}
                          disabled={!canTestLlm || llmTestLoading}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-55"
                        >
                          {llmTestLoading ? 'Testing...' : 'Test Connection'}
                        </button>
                      </div>

                      {!canTestLlm ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                          Bind a saved model with Base URL, API key, and model name before testing.
                        </div>
                      ) : null}

                      {llmTestResult ? (
                        <div
                          className={clsx(
                            'mt-3 rounded-xl border px-3 py-2 text-xs leading-5',
                            llmTestResult!.ok
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-rose-200 bg-rose-50 text-rose-700',
                          )}
                        >
                          <div className="font-medium">
                            {llmTestResult!.ok ? 'Connected' : 'Failed'}
                            {llmTestResult!.latencyMs ? ` 璺?${llmTestResult!.latencyMs} ms` : ''}
                          </div>
                          <div className="mt-1 break-all">
                            Endpoint: {llmTestResult!.endpoint || 'Unresolved'}
                          </div>
                          <div className="mt-1 break-all">
                            Model: {llmTestResult!.responseModel || llmTestResult!.model || 'No response model'}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">{llmTestResult!.message}</div>
                        </div>
                      ) : null}
                    </div>
                  </SettingsField>
                  ) : null}

                    </>
                  ) : null}

                  {activeSection === 'translation' ? (
                    <SettingsField
                      label="摘要来源"
                      description="閫夋嫨鎽樿鐢熸垚鏃朵娇鐢ㄦ湰鍦?PDF 鏂囨湰锛岃繕鏄娇鐢?MinerU 解析后的 Markdown閵?
                    >
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                          当前摘要模型
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-900">
                          {activeSummaryPreset?.label || activeSummaryPreset?.model || '未选择'}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {activeSummaryPreset?.baseUrl || '请先在上方绑定一个已保存模型'}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-medium text-slate-500">摘要输入</div>
                        <div className="grid gap-2">
                          {SUMMARY_SOURCE_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onSettingChange('summarySourceMode', option.value)}
                              className={clsx(
                                'rounded-2xl border px-4 py-3 text-left transition',
                                settings.summarySourceMode === option.value
                                  ? 'border-indigo-200 bg-indigo-50/70'
                                  : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100',
                              )}
                            >
                              <div className="text-sm font-medium text-slate-900">{option.label}</div>
                              <div className="mt-1 text-xs leading-5 text-slate-500">
                                {option.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </SettingsField>
                  ) : null}

                  {/*

                  <SettingsField
                    label="翻译模型"
                    description="用于全文翻译与划词翻译。推荐填写服务根地址；程序会自动拼接 `/v1/chat/completions`閵?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-xs font-medium text-slate-500">Base URL</div>
                        <SettingsInput
                          value={settings.translationBaseUrl}
                          onChange={(event) => onSettingChange('translationBaseUrl', event.target.value)}
                          placeholder="https://api.openai.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">API Key</div>
                        <SettingsInput
                          value={translationApiKey}
                          onChange={(event) => onTranslationApiKeyChange(event.target.value)}
                          type="password"
                          placeholder="OpenAI 或兼容服务的 API Key"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">模型名称</div>
                        <SettingsInput
                          value={settings.translationModel}
                          onChange={(event) => onSettingChange('translationModel', event.target.value)}
                          placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">测试翻译模型连接</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            鐢ㄥ綋鍓?Base URL、API Key 鍜屾ā鍨嬪悕鍙戦€佷竴娆℃渶灏?`chat/completions` 璇锋眰銆?                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleTestLlmConnection()}
                          disabled={!canTestLlm || llmTestLoading}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-55"
                        >
                          {llmTestLoading ? '娴嬭瘯涓€? : '测试连接'}
                        </button>
                      </div>

                      {llmTestResult ? (
                        <div
                          className={clsx(
                            'mt-3 rounded-xl border px-3 py-2 text-xs leading-5',
                            llmTestResult.ok
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-rose-200 bg-rose-50 text-rose-700',
                          )}
                        >
                          <div className="font-medium">
                            {llmTestResult.ok ? '连接成功' : '连接失败'}
                            {llmTestResult.latencyMs ? ` 璺?${llmTestResult.latencyMs} ms` : ''}
                          </div>
                          <div className="mt-1 break-all">Endpoint：{llmTestResult.endpoint || '閺堫亣袙閺?}</div>
                          <div className="mt-1 break-all">
                            Model：{llmTestResult.responseModel || llmTestResult.model || '鏈繑鍥?}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">{llmTestResult.message}</div>
                        </div>
                      ) : null}
                    </div>
                  </SettingsField>

                  */}

                  <SettingsField
                    label="翻译体验"
                    description="闁板秶鐤嗛崚鎺曠槤缂堟槒鐦ч妴浣稿弿閺傚洨鐐曠拠鎴滅瑢閸欏厖鏅跺锝嗘瀮閺勫墽銇氬Ο鈥崇础閵?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">原文语言</div>
                        <SettingsSelect
                          value={settings.translationSourceLanguage}
                          onChange={(event) => onSettingChange('translationSourceLanguage', event.target.value)}
                        >
                          {LANGUAGE_OPTIONS.map((language) => (
                            <option key={language.value} value={language.value}>
                              {language.label}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">目标语言</div>
                        <SettingsSelect
                          value={settings.translationTargetLanguage}
                          onChange={(event) => onSettingChange('translationTargetLanguage', event.target.value)}
                        >
                          {LANGUAGE_OPTIONS.filter((language) => language.value !== 'auto').map((language) => (
                            <option key={language.value} value={language.value}>
                              {language.label}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
                      鍙充晶姝ｆ枃鍥哄畾鏄剧ず璇戞枃锛屼笉鍐嶆彁渚涘師鏂囨垨鍙岃鍒囨崲銆?                    </div>

                    {false ? (
                    <div>
                      <div className="mb-2 text-xs font-medium text-slate-500">右侧显示模式</div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {[
                          ['original', '原文'],
                          ['translated', '译文'],
                          ['bilingual', '双语'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              onSettingChange('translationDisplayMode', value as TranslationDisplayMode)
                            }
                            className={clsx(
                              'rounded-xl border px-3 py-2 text-sm transition',
                              settings.translationDisplayMode === value
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    ) : null}

                    <ToggleRow
                      title="鍒掕瘝鍚庤嚜鍔ㄧ炕璇?
                      description="閸?PDF 閹存牕褰告笟褎顒滈弬鍥﹁厬闁鑵戦崘鍛啇閸氬函绱濋懛顏勫З鐟欙箑褰傜紙鏄忕槯楠炶埖妯夌粈鍝勬躬韫囶偅宓庡ù顔肩湴娑擃厹鈧?
                      checked={settings.autoTranslateSelection}
                      onChange={(checked) => onSettingChange('autoTranslateSelection', checked)}
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onTranslate?.()}
                        disabled={!canTriggerTranslate || translating}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <Languages className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                        {translating ? '缈昏瘧涓€? : '翻译当前文档'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onClearTranslations?.()}
                        disabled={!canClearTranslations}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        清空译文
                      </button>
                    </div>
                  </SettingsField>

                  {/*

                  <SettingsField
                    label="摘要模型"
                    description="鐢ㄤ簬鐢熸垚璁烘枃姒傝銆佹枃搴撻瑙堟憳瑕侊紝涓庣炕璇戞ā鍨嬪畬鍏ㄥ垎寮€銆?
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-xs font-medium text-slate-500">Base URL</div>
                        <SettingsInput
                          value={settings.summaryBaseUrl}
                          onChange={(event) => onSettingChange('summaryBaseUrl', event.target.value)}
                          placeholder="https://api.openai.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">API Key</div>
                        <SettingsInput
                          value={summaryApiKey}
                          onChange={(event) => onSummaryApiKeyChange(event.target.value)}
                          type="password"
                          placeholder="鎽樿妯″瀷鐨?API Key"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">模型名称</div>
                        <SettingsInput
                          value={settings.summaryModel}
                          onChange={(event) => onSettingChange('summaryModel', event.target.value)}
                          placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-slate-500">摘要内容来源</div>
                      <div className="grid gap-2">
                        {SUMMARY_SOURCE_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => onSettingChange('summarySourceMode', option.value)}
                            className={clsx(
                              'rounded-2xl border px-4 py-3 text-left transition',
                              settings.summarySourceMode === option.value
                                ? 'border-indigo-200 bg-indigo-50/70'
                                : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100',
                            )}
                          >
                            <div className="text-sm font-medium text-slate-900">{option.label}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-500">
                              {option.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label="问答模型预设"
                    description="閸欘垶鍘ょ純顔碱樋娑擃亪妫剁粵鏃€膩閸ㄥ绱濋獮璺烘躬閼卞﹤銇夊鍡曡厬閸?ChatGPT 娑撯偓閺嶇兘娈㈤弮璺哄瀼閹诡潿鈧?
                  >
                    <div className="space-y-3">
                      {qaModelPresets.map((preset, index) => {
                        const active = settings.qaActivePresetId === preset.id;

                        return (
                          <div
                            key={preset.id}
                            className={clsx(
                              'rounded-2xl border p-4 transition',
                              active
                                ? 'border-indigo-200 bg-indigo-50/60'
                                : 'border-slate-200 bg-slate-50/70',
                            )}
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-slate-900">
                                  预设 {index + 1}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {active ? '当前默认问答模型' : '可在聊天框中切换使用'}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => onSettingChange('qaActivePresetId', preset.id)}
                                  className={clsx(
                                    'rounded-xl px-3 py-2 text-sm font-medium transition',
                                    active
                                      ? 'bg-slate-900 text-white'
                                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
                                  )}
                                >
                                  {active ? '榛樿涓? : '设为默认'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onQaModelPresetRemove(preset.id)}
                                  disabled={qaModelPresets.length <= 1}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                                >
                                  删除
                                </button>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-slate-500">名称</div>
                                <SettingsInput
                                  value={preset.label}
                                  onChange={(event) =>
                                    onQaModelPresetChange(preset.id, { label: event.target.value })
                                  }
                                  placeholder="例如：OpenAI 视觉问答"
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-slate-500">模型名称</div>
                                <SettingsInput
                                  value={preset.model}
                                  onChange={(event) =>
                                    onQaModelPresetChange(preset.id, { model: event.target.value })
                                  }
                                  placeholder="gpt-4o-mini / qwen-vl-plus"
                                />
                              </div>
                              <div className="space-y-2 md:col-span-2">
                                <div className="text-xs font-medium text-slate-500">Base URL</div>
                                <SettingsInput
                                  value={preset.baseUrl}
                                  onChange={(event) =>
                                    onQaModelPresetChange(preset.id, { baseUrl: event.target.value })
                                  }
                                  placeholder="https://api.openai.com"
                                />
                              </div>
                              <div className="space-y-2 md:col-span-2">
                                <div className="text-xs font-medium text-slate-500">API Key</div>
                                <SettingsInput
                                  value={preset.apiKey}
                                  onChange={(event) =>
                                    onQaModelPresetChange(preset.id, { apiKey: event.target.value })
                                  }
                                  type="password"
                                  placeholder="褰撳墠闂瓟妯″瀷鐨?API Key"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={onQaModelPresetAdd}
                        className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                      >
                        新增问答模型预设
                      </button>
                    </div>
                  </SettingsField>

                  */}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Reader() {
  const appWindow = getCurrentWindow();
  const librarySearchInputRef = useRef<HTMLInputElement>(null);
  const libraryItemClickTimerRef = useRef<number | null>(null);
  const libraryPreviewRequestIdRef = useRef<Record<string, number>>({});
  const legacyModelPresetMigrationDoneRef = useRef(false);
  const autoMineruAttemptedRef = useRef<Set<string>>(new Set());
  const autoSummaryAttemptedRef = useRef<Set<string>>(new Set());
  const batchMineruRunningRef = useRef(false);
  const batchSummaryRunningRef = useRef(false);

  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [readerSecrets, setReaderSecrets] = useState<ReaderSecrets>(loadSecrets);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [zoteroLocalDataDir, setZoteroLocalDataDir] = useState('');
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    loadStoredBoolean(LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY),
  );
  const [appDefaultPaths, setAppDefaultPaths] = useState<AppDefaultPaths | null>(null);
  const [configHydrated, setConfigHydrated] = useState(false);

  const [zoteroCollections, setZoteroCollections] = useState<ZoteroCollection[]>([]);
  const [zoteroAllItems, setZoteroAllItems] = useState<WorkspaceItem[]>([]);
  const [collectionItemsCache, setCollectionItemsCache] = useState<Record<string, WorkspaceItem[]>>(
    {},
  );
  const [standaloneItems, setStandaloneItems] = useState<WorkspaceItem[]>([]);
  const [selectedSectionKey, setSelectedSectionKey] = useState<LibrarySectionKey>('recent');
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryDisplayMode, setLibraryDisplayMode] = useState<'list' | 'card'>('list');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoadingSection, setLibraryLoadingSection] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('就绪');
  const [error, setError] = useState('');
  const [readerBridges, setReaderBridges] = useState<Record<string, ReaderTabBridgeState>>({});
  const [libraryPreviewStates, setLibraryPreviewStates] = useState<
    Record<string, LibraryPreviewState>
  >({});
  const [itemParseStatusMap, setItemParseStatusMap] = useState<Record<string, boolean | undefined>>(
    {},
  );
  const [pendingCloudParseTabId, setPendingCloudParseTabId] = useState<string | null>(null);
  const [batchMineruRunning, setBatchMineruRunning] = useState(false);
  const [batchSummaryRunning, setBatchSummaryRunning] = useState(false);
  const [batchMineruProgress, setBatchMineruProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<BatchProgressState>(
    EMPTY_BATCH_PROGRESS,
  );
  const {
    mineruApiToken,
    translationApiKey,
    summaryApiKey,
    zoteroApiKey,
    zoteroUserId,
    qaModelPresets,
  } = readerSecrets;
  const translationModelPreset = useMemo(
    () => resolveModelPreset(qaModelPresets, settings.translationModelPresetId),
    [qaModelPresets, settings.translationModelPresetId],
  );
  const selectionTranslationModelPreset = useMemo(
    () =>
      resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId) ??
      translationModelPreset,
    [qaModelPresets, settings.selectionTranslationModelPresetId, translationModelPreset],
  );
  const summaryModelPreset = useMemo(
    () => resolveModelPreset(qaModelPresets, settings.summaryModelPresetId) ?? translationModelPreset,
    [qaModelPresets, settings.summaryModelPresetId, translationModelPreset],
  );
  const summaryConfigured = Boolean(
    summaryModelPreset?.apiKey.trim() &&
      summaryModelPreset?.baseUrl.trim() &&
      summaryModelPreset?.model.trim(),
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const defaultPaths = await getAppDefaultPaths();

        if (cancelled) {
          return;
        }

        setAppDefaultPaths(defaultPaths);
        let nextConfig = mergeReaderConfigWithDefaults(
          null,
          loadSettings(),
          loadSecrets(),
          defaultPaths,
        );

        try {
          const configText = await readLocalTextFile(defaultPaths.configPath);
          const parsedConfig = JSON.parse(configText) as Partial<ReaderConfigFile>;

          nextConfig = mergeReaderConfigWithDefaults(
            parsedConfig,
            loadSettings(),
            loadSecrets(),
            defaultPaths,
          );
        } catch {
          // 閰嶇疆鏂囦欢涓嶅瓨鍦ㄦ椂鍥為€€鍒版湰鍦版祻瑙堝櫒瀛樺偍锛屽苟琛ラ綈榛樿鐩綍銆?        }

        if (cancelled) {
          return;
        }

        setSettings(nextConfig.settings);
        setReaderSecrets(nextConfig.secrets);
        setZoteroLocalDataDir(nextConfig.zoteroLocalDataDir);
        setLeftSidebarCollapsed(nextConfig.leftSidebarCollapsed);
      } finally {
        if (!cancelled) {
          setConfigHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenPreferences = useCallback(() => {
    setPreferencesOpen(true);
  }, []);

  useEffect(() => {
    if (legacyModelPresetMigrationDoneRef.current) {
      return;
    }

    legacyModelPresetMigrationDoneRef.current = true;

    const nextPresets = buildLegacyModelPresets(settings, readerSecrets);
    const hasPresetMismatch =
      nextPresets.length !== qaModelPresets.length ||
      nextPresets.some((preset, index) => qaModelPresets[index]?.id !== preset.id);
    const fallbackPresetId = nextPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;
    const nextTranslationPresetId =
      resolveModelPreset(nextPresets, settings.translationModelPresetId)?.id ?? fallbackPresetId;
    const nextSelectionTranslationPresetId =
      resolveModelPreset(nextPresets, settings.selectionTranslationModelPresetId)?.id ??
      nextTranslationPresetId;
    const nextSummaryPresetId =
      resolveModelPreset(nextPresets, settings.summaryModelPresetId)?.id ?? fallbackPresetId;
    const nextQaPresetId =
      resolveModelPreset(nextPresets, settings.qaActivePresetId)?.id ?? fallbackPresetId;
    const nextTranslationPreset =
      resolveModelPreset(nextPresets, nextTranslationPresetId) ?? DEFAULT_QA_PRESET;
    const nextSummaryPreset =
      resolveModelPreset(nextPresets, nextSummaryPresetId) ?? DEFAULT_QA_PRESET;

    if (hasPresetMismatch) {
      setReaderSecrets((current) => ({
        ...current,
        qaModelPresets: nextPresets,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
      }));
    } else if (
      readerSecrets.translationApiKey !== nextTranslationPreset.apiKey ||
      readerSecrets.summaryApiKey !== nextSummaryPreset.apiKey
    ) {
      setReaderSecrets((current) => ({
        ...current,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
      }));
    }

    if (
      settings.translationModelPresetId !== nextTranslationPresetId ||
      settings.selectionTranslationModelPresetId !== nextSelectionTranslationPresetId ||
      settings.summaryModelPresetId !== nextSummaryPresetId ||
      settings.qaActivePresetId !== nextQaPresetId ||
      settings.translationBaseUrl !== nextTranslationPreset.baseUrl ||
      settings.translationModel !== nextTranslationPreset.model ||
      settings.summaryBaseUrl !== nextSummaryPreset.baseUrl ||
      settings.summaryModel !== nextSummaryPreset.model
    ) {
      setSettings((current) => ({
        ...current,
        translationModelPresetId: nextTranslationPresetId,
        selectionTranslationModelPresetId: nextSelectionTranslationPresetId,
        summaryModelPresetId: nextSummaryPresetId,
        qaActivePresetId: nextQaPresetId,
        translationBaseUrl: nextTranslationPreset.baseUrl,
        translationModel: nextTranslationPreset.model,
        summaryBaseUrl: nextSummaryPreset.baseUrl,
        summaryModel: nextSummaryPreset.model,
      }));
    }
  }, [
    qaModelPresets,
    readerSecrets,
    settings,
  ]);

  useEffect(() => {
    const fallbackPresetId = qaModelPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;
    const nextTranslationPresetId =
      resolveModelPreset(qaModelPresets, settings.translationModelPresetId)?.id ?? fallbackPresetId;
    const nextSelectionTranslationPresetId =
      resolveModelPreset(qaModelPresets, settings.selectionTranslationModelPresetId)?.id ??
      nextTranslationPresetId;
    const nextSummaryPresetId =
      resolveModelPreset(qaModelPresets, settings.summaryModelPresetId)?.id ?? fallbackPresetId;
    const nextQaPresetId =
      resolveModelPreset(qaModelPresets, settings.qaActivePresetId)?.id ?? fallbackPresetId;
    const nextTranslationPreset =
      resolveModelPreset(qaModelPresets, nextTranslationPresetId) ?? DEFAULT_QA_PRESET;
    const nextSummaryPreset =
      resolveModelPreset(qaModelPresets, nextSummaryPresetId) ?? DEFAULT_QA_PRESET;

    if (
      settings.translationModelPresetId !== nextTranslationPresetId ||
      settings.selectionTranslationModelPresetId !== nextSelectionTranslationPresetId ||
      settings.summaryModelPresetId !== nextSummaryPresetId ||
      settings.qaActivePresetId !== nextQaPresetId ||
      settings.translationBaseUrl !== nextTranslationPreset.baseUrl ||
      settings.translationModel !== nextTranslationPreset.model ||
      settings.summaryBaseUrl !== nextSummaryPreset.baseUrl ||
      settings.summaryModel !== nextSummaryPreset.model
    ) {
      setSettings((current) => ({
        ...current,
        translationModelPresetId: nextTranslationPresetId,
        selectionTranslationModelPresetId: nextSelectionTranslationPresetId,
        summaryModelPresetId: nextSummaryPresetId,
        qaActivePresetId: nextQaPresetId,
        translationBaseUrl: nextTranslationPreset.baseUrl,
        translationModel: nextTranslationPreset.model,
        summaryBaseUrl: nextSummaryPreset.baseUrl,
        summaryModel: nextSummaryPreset.model,
      }));
    }

    if (
      readerSecrets.translationApiKey !== nextTranslationPreset.apiKey ||
      readerSecrets.summaryApiKey !== nextSummaryPreset.apiKey
    ) {
      setReaderSecrets((current) => ({
        ...current,
        translationApiKey: nextTranslationPreset.apiKey,
        summaryApiKey: nextSummaryPreset.apiKey,
      }));
    }
  }, [
    qaModelPresets,
    readerSecrets.summaryApiKey,
    readerSecrets.translationApiKey,
    settings.qaActivePresetId,
    settings.selectionTranslationModelPresetId,
    settings.summaryBaseUrl,
    settings.summaryModel,
    settings.summaryModelPresetId,
    settings.translationBaseUrl,
    settings.translationModel,
    settings.translationModelPresetId,
  ]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const flattenedCollections = useMemo(
    () => buildFlatCollections(zoteroCollections),
    [zoteroCollections],
  );

  const collectionNameMap = useMemo(
    () => new Map(flattenedCollections.map((collection) => [collection.collectionKey, collection.name])),
    [flattenedCollections],
  );

  const selectedSectionTitle = useMemo(() => {
    if (selectedSectionKey === 'recent') {
      return '鏈€杩戞坊鍔?;
    }

    if (selectedSectionKey === 'all') {
      return '全部 PDF';
    }

    if (selectedSectionKey === 'standalone') {
      return '独立 PDF';
    }

    const collectionKey = selectedSectionKey.slice('collection:'.length);

    return collectionNameMap.get(collectionKey) ?? '閺堫亜鎳￠崥宥呭瀻缁?;
  }, [collectionNameMap, selectedSectionKey]);

  const currentSectionItems = useMemo(() => {
    if (selectedSectionKey === 'recent') {
      return zoteroAllItems.slice(0, 30);
    }

    if (selectedSectionKey === 'all') {
      return zoteroAllItems;
    }

    if (selectedSectionKey === 'standalone') {
      return standaloneItems;
    }

    const collectionKey = selectedSectionKey.slice('collection:'.length);

    return collectionItemsCache[collectionKey] ?? [];
  }, [collectionItemsCache, selectedSectionKey, standaloneItems, zoteroAllItems]);

  const visibleItems = useMemo(
    () => currentSectionItems.filter((item) => matchesLibraryQuery(item, librarySearchQuery)),
    [currentSectionItems, librarySearchQuery],
  );

  const workspaceItemMap = useMemo(() => {
    const itemMap = new Map<string, WorkspaceItem>();

    const applyItems = (items: WorkspaceItem[]) => {
      for (const item of items) {
        const existingItem = itemMap.get(item.workspaceId);

        if (!existingItem) {
          itemMap.set(item.workspaceId, item);
          continue;
        }

        itemMap.set(item.workspaceId, {
          ...existingItem,
          ...item,
          localPdfPath: mergeLocalPdfPath(existingItem, item),
        });
      }
    };

    applyItems(zoteroAllItems);
    applyItems(standaloneItems);
    Object.values(collectionItemsCache).forEach(applyItems);

    return itemMap;
  }, [collectionItemsCache, standaloneItems, zoteroAllItems]);

  const allKnownItems = useMemo(
    () => Array.from(workspaceItemMap.values()),
    [workspaceItemMap],
  );

  const readerTabs = useMemo(
    () => tabs.filter((tab): tab is ReaderTab => tab.type === 'reader'),
    [tabs],
  );

  const selectedLibraryItem = useMemo(() => {
    if (!selectedLibraryItemId) {
      return null;
    }

    return workspaceItemMap.get(selectedLibraryItemId) ?? null;
  }, [selectedLibraryItemId, workspaceItemMap]);

  const activeReaderBridge =
    activeTab?.type === 'reader' ? readerBridges[activeTab.id] ?? null : null;

  const selectedItemId =
    activeTab?.type === 'reader' ? activeTab.documentId : selectedLibraryItemId;

  const activeLibraryPreviewState = selectedLibraryItem
    ? libraryPreviewStates[selectedLibraryItem.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE
    : EMPTY_LIBRARY_PREVIEW_STATE;

  const mapZoteroItems = (items: ZoteroLibraryItem[]): WorkspaceItem[] =>
    items.map((item) => normalizeWorkspaceItem(item, 'zotero-local'));

  const handleWorkspaceItemResolved = useCallback((resolvedItem: WorkspaceItem) => {
    const mergeItem = (item: WorkspaceItem) =>
      item.workspaceId === resolvedItem.workspaceId
        ? {
            ...item,
            ...resolvedItem,
            localPdfPath: mergeLocalPdfPath(item, resolvedItem),
          }
        : item;

    setZoteroAllItems((current) => current.map(mergeItem));
    setStandaloneItems((current) => current.map(mergeItem));
    setCollectionItemsCache((current) =>
      Object.fromEntries(
        Object.entries(current).map(([collectionKey, items]) => [
          collectionKey,
          items.map(mergeItem),
        ]),
      ),
    );
    setLibraryPreviewStates((current) => {
      const existingState = current[resolvedItem.workspaceId];

      if (!existingState || !resolvedItem.localPdfPath) {
        return current;
      }

      const nextPdfName = getFileNameFromPath(resolvedItem.localPdfPath);

      if (existingState.currentPdfName === nextPdfName) {
        return current;
      }

      return {
        ...current,
        [resolvedItem.workspaceId]: {
          ...existingState,
          currentPdfName: nextPdfName,
        },
      };
    });
  }, []);

  const handleLibraryPreviewSync = useCallback((payload: LibraryPreviewSyncPayload) => {
    setItemParseStatusMap((current) => ({
      ...current,
      [payload.item.workspaceId]: payload.hasBlocks,
    }));

    setLibraryPreviewStates((current) => {
      const existingState = current[payload.item.workspaceId];
      const hasSummary = Object.prototype.hasOwnProperty.call(payload, 'summary');
      const hasLoading = Object.prototype.hasOwnProperty.call(payload, 'loading');
      const hasError = Object.prototype.hasOwnProperty.call(payload, 'error');

      return {
        ...current,
        [payload.item.workspaceId]: {
          summary: hasSummary ? payload.summary ?? null : existingState?.summary ?? null,
          loading: hasLoading ? Boolean(payload.loading) : false,
          error: hasError ? payload.error ?? '' : '',
          hasBlocks: payload.hasBlocks,
          blockCount: payload.blockCount,
          currentPdfName: payload.currentPdfName,
          currentJsonName: payload.currentJsonName,
          statusMessage: payload.statusMessage,
          sourceKey: payload.sourceKey,
        },
      };
    });
  }, []);

  const resolveMineruJsonCandidatePaths = useCallback((item: WorkspaceItem): string[] => {
    const candidates = new Set<string>();

    if (settings.mineruCacheDir.trim()) {
      for (const cachePaths of [
        buildMineruCachePaths(settings.mineruCacheDir.trim(), item),
        buildLegacyMineruCachePaths(settings.mineruCacheDir.trim(), item),
      ]) {
        candidates.add(cachePaths.contentJsonPath);
        candidates.add(cachePaths.middleJsonPath);
      }
    }

    if (item.localPdfPath && settings.autoLoadSiblingJson) {
      candidates.add(guessSiblingJsonPath(item.localPdfPath));
    }

    return Array.from(candidates);
  }, [settings.autoLoadSiblingJson, settings.mineruCacheDir]);

  const findExistingMineruJson = useCallback(
    async (item: WorkspaceItem) => {
      for (const candidatePath of resolveMineruJsonCandidatePaths(item)) {
        try {
          const jsonText = await readLocalTextFile(candidatePath);

          if (jsonText.trim()) {
            return {
              path: candidatePath,
              jsonText,
            };
          }
        } catch {
          continue;
        }
      }

      return null;
    },
    [resolveMineruJsonCandidatePaths],
  );

  useEffect(() => {
    if (allKnownItems.length === 0) {
      setItemParseStatusMap({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const nextEntries = await Promise.all(
        allKnownItems.map(async (item) => [item.workspaceId, Boolean(await findExistingMineruJson(item))] as const),
      );

      if (cancelled) {
        return;
      }

      setItemParseStatusMap((current) => ({
        ...current,
        ...Object.fromEntries(nextEntries),
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [allKnownItems, findExistingMineruJson]);

  const saveLibraryMineruParseCache = useCallback(
    async ({
      item,
      pdfPath,
      sourceKind,
      contentJsonText,
      middleJsonText,
      markdownText,
      batchId,
      dataId,
      fileName,
      zipEntries,
    }: {
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
    }) => {
      if (!settings.mineruCacheDir.trim()) {
        return null;
      }

      const cachePaths = buildMineruCachePaths(settings.mineruCacheDir.trim(), item);
      const writeTasks: Promise<void>[] = [];

      if (contentJsonText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.contentJsonPath, contentJsonText));
      }

      if (middleJsonText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.middleJsonPath, middleJsonText));
      }

      if (markdownText?.trim()) {
        writeTasks.push(writeLocalTextFile(cachePaths.markdownPath, markdownText));
      }

      const manifest: MineruCacheManifest = {
        version: 1,
        documentKey: item.itemKey,
        title: item.title,
        pdfPath,
        savedAt: new Date().toISOString(),
        sourceKind,
        batchId,
        dataId,
        fileName,
        zipEntries,
      };

      writeTasks.push(
        writeLocalTextFile(cachePaths.manifestPath, JSON.stringify(manifest, null, 2)),
      );

      await Promise.all(writeTasks);

      return cachePaths;
    },
    [settings.mineruCacheDir],
  );

  const syncLibraryParsedState = useCallback(
    (
      item: WorkspaceItem,
      jsonText: string,
      jsonPath: string,
      status: string,
    ) => {
      const pages = parseMineruPages(jsonText);
      const blocks = flattenMineruPages(pages);
      const currentJsonName = getFileNameFromPath(jsonPath);
      const currentPdfName = item.localPdfPath
        ? getFileNameFromPath(item.localPdfPath)
        : '本地 PDF 鏈壘鍒?;

      setItemParseStatusMap((current) => ({
        ...current,
        [item.workspaceId]: true,
      }));
      setLibraryPreviewStates((current) => {
        const previousState = current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE;

        return {
          ...current,
          [item.workspaceId]: {
            ...previousState,
            loading: false,
            error: '',
            hasBlocks: blocks.length > 0,
            blockCount: blocks.length,
            currentPdfName,
            currentJsonName,
            statusMessage: status,
            sourceKey:
              previousState.sourceKey || `${item.workspaceId}::${currentJsonName}::${blocks.length}`,
          },
        };
      });

      return {
        pages,
        blocks,
      };
    },
    [],
  );

  const loadLocalLibrary = async (preferredDataDir?: string, silent = false) => {
    setLibraryLoading(true);
    setError('');

    try {
      const resolvedDataDir =
        preferredDataDir?.trim() ||
        zoteroLocalDataDir.trim() ||
        (await detectLocalZoteroDataDir()) ||
        '';

      if (!resolvedDataDir) {
        setZoteroCollections([]);
        setZoteroAllItems([]);
        setCollectionItemsCache({});

        if (!silent) {
          setStatusMessage('未检测到本地 Zotero 数据目录');
        }

        return;
      }

      const [collections, items] = await Promise.all([
        listLocalZoteroCollections({ dataDir: resolvedDataDir }),
        listLocalZoteroLibraryItems({ dataDir: resolvedDataDir, limit: 400 }),
      ]);

      setZoteroLocalDataDir(resolvedDataDir);
      setZoteroCollections(collections);
      setZoteroAllItems(mapZoteroItems(items));
      setCollectionItemsCache({});
      setStatusMessage(`瀹歌尪绻涢幒銉︽拱閸?Zotero，读取到 ${items.length} 篇带 PDF 的文献`);
    } catch (nextError) {
      if (!silent) {
        setError(nextError instanceof Error ? nextError.message : '读取本地 Zotero 文库失败');
      }

      setStatusMessage('读取本地 Zotero 文库失败');
    } finally {
      setLibraryLoading(false);
    }
  };

  const ensureCollectionItems = async (collectionKey: string) => {
    if (!zoteroLocalDataDir.trim() || collectionItemsCache[collectionKey]) {
      return;
    }

    setLibraryLoadingSection(collectionKey);

    try {
      const items = await listLocalZoteroCollectionItems({
        dataDir: zoteroLocalDataDir.trim(),
        collectionKey,
        limit: 400,
      });

      setCollectionItemsCache((current) => ({
        ...current,
        [collectionKey]: mapZoteroItems(items),
      }));
      setStatusMessage(`瀹歌尪顕伴崣鏍у瀻缁儵鈧?{collectionNameMap.get(collectionKey) ?? '閺堫亜鎳￠崥宥呭瀻缁?}”`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取分类文献失败');
      setStatusMessage('读取分类文献失败');
    } finally {
      setLibraryLoadingSection((current) => (current === collectionKey ? null : current));
    }
  };

  const handleDetectLocalZotero = async () => {
    setLibraryLoading(true);
    setError('');

    try {
      const dataDir = await detectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage('没有找到本地 Zotero 数据目录');
        return;
      }

      await loadLocalLibrary(dataDir);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleSelectLocalZoteroDir = async () => {
    setError('');

    try {
      const dataDir = await selectLocalZoteroDataDir();

      if (!dataDir) {
        setStatusMessage('已取消选择 Zotero 数据目录');
        return;
      }

      await loadLocalLibrary(dataDir);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '选择 Zotero 数据目录失败');
      setStatusMessage('选择 Zotero 数据目录失败');
    }
  };

  const handleReloadLocalZotero = async () => {
    await loadLocalLibrary();
  };

  const handleSelectLibrarySection = async (sectionKey: LibrarySectionKey) => {
    setSelectedSectionKey(sectionKey);
    setLibrarySearchQuery('');

    if (sectionKey.startsWith('collection:')) {
      const collectionKey = sectionKey.slice('collection:'.length);
      await ensureCollectionItems(collectionKey);
    }
  };

  const loadLibraryPreviewBlocks = async (
    item: WorkspaceItem,
  ): Promise<LibraryPreviewLoadResult> => {
    const pdfName = item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : '本地 PDF 鏈壘鍒?;

    if (settings.mineruCacheDir.trim()) {
      const cachePaths = buildMineruCachePaths(settings.mineruCacheDir.trim(), item);

      for (const candidatePath of [cachePaths.contentJsonPath, cachePaths.middleJsonPath]) {
        try {
          const jsonText = await readLocalTextFile(candidatePath);
          const pages = parseMineruPages(jsonText);
          const blocks = flattenMineruPages(pages);

          return {
            blocks,
            currentPdfName: pdfName,
            currentJsonName: getFileNameFromPath(candidatePath),
            statusMessage: `已从解析缓存加载 ${blocks.length} 个结构块，可用于生成预览概览。`,
          };
        } catch {
          continue;
        }
      }
    }

    if (item.localPdfPath && settings.autoLoadSiblingJson) {
      const siblingJsonPath = guessSiblingJsonPath(item.localPdfPath);

      try {
        const jsonText = await readLocalTextFile(siblingJsonPath);
        const pages = parseMineruPages(jsonText);
        const blocks = flattenMineruPages(pages);

        return {
          blocks,
          currentPdfName: pdfName,
          currentJsonName: getFileNameFromPath(siblingJsonPath),
          statusMessage: `已从 PDF 閸氬瞼娲拌ぐ鏇炲鏉?${blocks.length} 个结构块，可用于生成预览概览。`,
        };
      } catch {
        return {
          blocks: [],
          currentPdfName: pdfName,
          currentJsonName: '未找到同目录 JSON',
          statusMessage: '鏈壘鍒拌В鏋愮紦瀛樻垨鍚岀洰褰?MinerU JSON閵嗗倸寮婚崙鏄忕箻閸忋儵妲勭拠璇叉倵閸欘垱澧滈崝銊ュ鏉?JSON 鎴栦簯绔В鏋愩€?,
        };
      }
    }

    return {
      blocks: [],
      currentPdfName: pdfName,
      currentJsonName: settings.autoLoadSiblingJson ? '鏈姞杞? : '瀹告彃鍙ч梻顓炴倱閻╊喖缍嶉懛顏勫З濡偓濞?,
      statusMessage: item.localPdfPath
        ? '尚未加载结构化内容。可以在设置中启用同目录 JSON 检测，或进入阅读页加载 / 解析 MinerU JSON閵?
        : '璇ユ潯鐩病鏈夋湰鍦?PDF 鐠侯垰绶為敍宀勬付鏉╂稑鍙嗛梼鍛邦嚢妞ゅ吀绗呮潪鑺ュ灗閸忓疇浠堥梽鍕閸氬骸鍟€閻㈢喐鍨氬鍌濐潔閵?,
    };
  };

  const buildLibraryPreviewSummaryInputs = (blocks: PositionedMineruBlock[]) =>
    buildSummaryBlockInputs(blocks);

  const resolveLibraryPreviewSummaryRequest = async (
    item: WorkspaceItem,
    blocks: PositionedMineruBlock[],
  ) => {
    const summaryInputs = buildLibraryPreviewSummaryInputs(blocks);

    if (settings.summarySourceMode === 'pdf-text') {
      const pdfPath = item.localPdfPath?.trim() ?? '';
      const sourceKey = `${item.workspaceId}::pdf-text::${pdfPath || 'no-pdf'}`;

      if (!pdfPath) {
        return {
          summaryInputs,
          sourceKey,
          documentText: '',
          errorMessage: '当前文献没有本地 PDF 璺緞锛屾棤娉曚娇鐢?PDF 閺傚洦婀伴悽鐔稿灇妫板嫯顫嶉幗妯款洣閵?,
        };
      }

      const pdfData = await readLocalBinaryFile(pdfPath);
      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        return {
          summaryInputs,
          sourceKey: `${sourceKey}::${pdfData.byteLength}`,
          documentText: '',
          errorMessage: '閺堫亣鍏樻禒搴㈡拱閸?PDF 閹绘劕褰囬崚鏉垮讲閻劍鏋冮張顒婄礉鐠囧嘲鐨剧拠鏇熸纯閹广垺鎲崇憰浣规降濠ф劑鈧?,
        };
      }

      return {
        summaryInputs,
        sourceKey: `${sourceKey}::${pdfData.byteLength}`,
        documentText,
        errorMessage: '',
      };
    }

    const candidateMarkdownPaths = new Set<string>();

    if (settings.mineruCacheDir.trim()) {
      for (const cachePaths of [
        buildMineruCachePaths(settings.mineruCacheDir.trim(), item),
        buildLegacyMineruCachePaths(settings.mineruCacheDir.trim(), item),
      ]) {
        candidateMarkdownPaths.add(cachePaths.markdownPath);
      }
    }

    if (item.localPdfPath && settings.autoLoadSiblingJson) {
      candidateMarkdownPaths.add(guessSiblingMarkdownPath(item.localPdfPath));
    }

    for (const candidatePath of candidateMarkdownPaths) {
      try {
        const documentText = await readLocalTextFile(candidatePath);

        if (documentText.trim()) {
          return {
            summaryInputs,
            sourceKey: `${item.workspaceId}::mineru-markdown::${candidatePath}::${blocks.length}`,
            documentText,
            errorMessage: '',
          };
        }
      } catch {
        continue;
      }
    }

    const documentText = buildMineruMarkdownDocument(blocks);

    if (!documentText.trim()) {
      return {
        summaryInputs,
        sourceKey: `${item.workspaceId}::mineru-markdown::empty`,
        documentText: '',
        errorMessage: '鏈壘鍒?MinerU Markdown 鎴栫粨鏋勫潡锛屾棤娉曠敓鎴愭枃搴撻瑙堟憳瑕併€?,
      };
    }

    return {
      summaryInputs,
      sourceKey: `${item.workspaceId}::mineru-markdown::blocks::${blocks.length}`,
      documentText,
      errorMessage: '',
    };
  };

  const tryLoadSavedPreviewSummary = async (item: WorkspaceItem, sourceKey: string) => {
    if (!settings.mineruCacheDir.trim() || !sourceKey.trim()) {
      return null;
    }

    const candidatePaths = [
      buildMineruSummaryCachePath(settings.mineruCacheDir.trim(), item, sourceKey),
      buildLegacyMineruSummaryCachePath(settings.mineruCacheDir.trim(), item, sourceKey),
    ];

    for (const candidatePath of candidatePaths) {
      try {
        const raw = await readLocalTextFile(candidatePath);
        const parsed = JSON.parse(raw) as Partial<SummaryCacheEnvelope>;

        if (
          !parsed ||
          typeof parsed !== 'object' ||
          parsed.sourceKey !== sourceKey ||
          !parsed.summary
        ) {
          continue;
        }

        return parsed.summary as PaperSummary;
      } catch {
        continue;
      }
    }

    return null;
  };

  const savePreviewSummary = async (
    item: WorkspaceItem,
    sourceKey: string,
    summary: PaperSummary,
  ) => {
    if (!settings.mineruCacheDir.trim() || !sourceKey.trim()) {
      return;
    }

    const cachePath = buildMineruSummaryCachePath(settings.mineruCacheDir.trim(), item, sourceKey);
    const payload: SummaryCacheEnvelope = {
      version: 1,
      sourceKey,
      summarizedAt: new Date().toISOString(),
      summary,
    };

    await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
  };

  const generateLibraryPreview = async (
    item: WorkspaceItem,
    force = false,
    options?: {
      allowGenerate?: boolean;
    },
  ): Promise<LibraryPreviewOutcome> => {
    const allowGenerate = options?.allowGenerate ?? true;
    const cachedState = libraryPreviewStates[item.workspaceId];

    if (!force && cachedState) {
      if (cachedState.loading || cachedState.summary) {
        return 'loaded';
      }
    }

    const requestId = (libraryPreviewRequestIdRef.current[item.workspaceId] ?? 0) + 1;
    libraryPreviewRequestIdRef.current[item.workspaceId] = requestId;

    setLibraryPreviewStates((current) => ({
      ...current,
      [item.workspaceId]: {
        summary: force ? null : current[item.workspaceId]?.summary ?? null,
        loading: true,
        error: '',
        hasBlocks: current[item.workspaceId]?.hasBlocks ?? false,
        blockCount: current[item.workspaceId]?.blockCount ?? 0,
        currentPdfName: item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : '本地 PDF 鏈壘鍒?,
        currentJsonName: current[item.workspaceId]?.currentJsonName ?? '检测中',
        statusMessage: '正在检测解析缓存并准备 AI 姒傝鈥?,
        sourceKey: current[item.workspaceId]?.sourceKey ?? '',
      },
    }));

    try {
      const previewContext = await loadLibraryPreviewBlocks(item);
      const summaryRequest = await resolveLibraryPreviewSummaryRequest(item, previewContext.blocks);
      const {
        summaryInputs,
        sourceKey,
        documentText,
        errorMessage,
      } = summaryRequest;
      const historySummary =
        loadPaperHistory(item.workspaceId)?.paperSummarySourceKey === sourceKey
          ? loadPaperHistory(item.workspaceId)?.paperSummary ?? null
          : null;
      const cachedSummary = force ? null : await tryLoadSavedPreviewSummary(item, sourceKey);

      if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
        return 'skipped';
      }

      if (errorMessage && !documentText.trim() && summaryInputs.length === 0) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: null,
            loading: false,
            error: '',
            hasBlocks: false,
            blockCount: 0,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: errorMessage,
            sourceKey,
          },
        }));
        return 'skipped';
      }

      if (!force && historySummary) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: historySummary,
            loading: false,
            error: '',
            hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: '瀹歌弓绮犻梼鍛邦嚢閸樺棗褰堕幁銏狀槻鐠囥儴顔戦弬鍥╂畱閹芥顩︽０鍕潔閵?,
            sourceKey,
          },
        }));
        return 'loaded';
      }

      if (!force && cachedSummary) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: cachedSummary,
            loading: false,
            error: '',
            hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: '瀹歌弓绮犻張顒€婀撮幗妯款洣缂傛挸鐡ㄩ幁銏狀槻妫板嫯顫嶇紒鎾寸亯閵?,
            sourceKey,
          },
        }));
        return 'loaded';
      }

      if (!summaryModelPreset || !summaryModelPreset.apiKey.trim() || !summaryModelPreset.baseUrl.trim()) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: null,
            loading: false,
            error: '',
            hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: '宸叉壘鍒扮粨鏋勫寲鍐呭銆傚～鍐?OpenAI 兼容 API Key 后可生成 AI 姒傝銆?,
            sourceKey,
          },
        }));
        return 'skipped';
      }

      if (!force && cachedState?.summary && cachedState.sourceKey === sourceKey) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...cachedState,
            loading: false,
          },
        }));
        return 'loaded';
      }

      if (!allowGenerate) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            summary: null,
            loading: false,
            error: '',
            hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: previewContext.blocks.length > 0
              ? '瀹告彃濮炴潪鍊熜掗弸鎰波閺嬫粣绱濋崣顖涘閸斻劎鏁撻幋鎰喅鐟?
              : previewContext.statusMessage,
            sourceKey,
          },
        }));
        return 'skipped';
      }

      const summary = await summarizeDocumentOpenAICompatible({
        baseUrl: summaryModelPreset.baseUrl,
        apiKey: summaryModelPreset.apiKey.trim(),
        model: summaryModelPreset.model,
        title: item.title,
        authors: item.creators || undefined,
        year: item.year || undefined,
        blocks: summaryInputs,
        documentText,
      });

      if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
        return 'skipped';
      }

      await savePreviewSummary(item, sourceKey, summary).catch(() => undefined);

      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          summary,
          loading: false,
          error: '',
          hasBlocks: Boolean(documentText.trim()) || previewContext.blocks.length > 0,
          blockCount: previewContext.blocks.length,
          currentPdfName: previewContext.currentPdfName,
          currentJsonName: previewContext.currentJsonName,
          statusMessage: 'AI 姒傝宸茬敓鎴愩€傚弻鍑诲垪琛ㄩ」鍙繘鍏ュ畬鏁撮槄璇昏鍥俱€?,
          sourceKey,
        },
      }));
      return 'generated';
    } catch (nextError) {
      if (libraryPreviewRequestIdRef.current[item.workspaceId] !== requestId) {
        return 'skipped';
      }

      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          summary: null,
          loading: false,
          error: nextError instanceof Error ? nextError.message : '生成文库预览概览失败',
          hasBlocks: current[item.workspaceId]?.hasBlocks ?? false,
          blockCount: current[item.workspaceId]?.blockCount ?? 0,
          currentPdfName:
            current[item.workspaceId]?.currentPdfName ??
            (item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : '本地 PDF 鏈壘鍒?),
          currentJsonName: current[item.workspaceId]?.currentJsonName ?? '鏈姞杞?,
          statusMessage: '閻㈢喐鍨氶弬鍥х氨妫板嫯顫嶅鍌濐潔婢惰精瑙﹂敍灞藉讲娴犮儳鈼㈤崥搴ㄥ櫢鐠囨洘鍨ㄦ潻娑樺弳闂冨懓顕版い鍨叀閻鈧?,
          sourceKey: current[item.workspaceId]?.sourceKey ?? '',
        },
      }));
      return 'failed';
    }
  };

  const handleBatchMineruParse = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchMineruRunningRef.current) {
        return;
      }

      if (!mineruApiToken.trim()) {
        if (!auto) {
          setPreferencesOpen(true);
          setError('请先在设置中填写 MinerU API Token');
          setStatusMessage('缺少 MinerU API Token');
        }
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage('当前没有可处理的文献');
        }
        return;
      }

      const candidates = allKnownItems.filter((item) => {
        const attemptKey = getAutoParseAttemptKey(item);
        return !(auto && autoMineruAttemptedRef.current.has(attemptKey));
      });

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage('当前没有待解析的文献');
        }
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);

      batchMineruRunningRef.current = true;
      setBatchMineruRunning(true);
      setBatchMineruProgress({
        running: true,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: candidates[0]?.title ?? '',
      });

      let parsedCount = 0;
      let existingCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let completedCount = 0;
      let successCount = 0;
      let lastErrorMessage = '';
      let cursor = 0;

      const updateProgress = (currentLabel: string) => {
        setBatchMineruProgress({
          running: true,
          total: candidates.length,
          completed: completedCount,
          succeeded: successCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel,
        });
      };

      try {
        const runWorker = async () => {
          while (true) {
            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length) {
              return;
            }

            const item = candidates[currentIndex];
            const attemptKey = getAutoParseAttemptKey(item);
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${item.title}`;

            if (!auto) {
              setStatusMessage(`批量 MinerU 解析中：${currentLabel}`);
            }

            updateProgress(currentLabel);

            try {
              const existingParse = await findExistingMineruJson(item);

              if (existingParse) {
                syncLibraryParsedState(
                  item,
                  existingParse.jsonText,
                  existingParse.path,
                  '已检测到本地 MinerU 解析结果',
                );
                existingCount += 1;
                successCount += 1;
                continue;
              }

              const pdfPath = item.localPdfPath?.trim() ?? '';

              if (!pdfPath) {
                skippedCount += 1;
                continue;
              }

              const cachePaths = settings.mineruCacheDir.trim()
                ? buildMineruCachePaths(settings.mineruCacheDir.trim(), item)
                : null;
              const result = await runMineruCloudParse({
                apiToken: mineruApiToken.trim(),
                pdfPath,
                extractDir: cachePaths?.directory,
                language: 'ch',
                modelVersion: 'vlm',
                enableFormula: true,
                enableTable: true,
                isOcr: false,
                timeoutSecs: 900,
                pollIntervalSecs: 5,
              });
              const jsonText = result.contentJsonText ?? result.middleJsonText;

              if (!jsonText?.trim()) {
                throw new Error('MinerU 返回结果中没有可用的 JSON');
              }

              const savedPaths = await saveLibraryMineruParseCache({
                item,
                pdfPath,
                sourceKind: 'cloud',
                contentJsonText: result.contentJsonText,
                middleJsonText: result.middleJsonText,
                markdownText: result.markdownText,
                batchId: result.batchId,
                dataId: result.dataId,
                fileName: result.fileName,
                zipEntries: result.zipEntries,
              }).catch(() => null);

              const resolvedJsonPath =
                result.contentJsonPath ||
                result.middleJsonPath ||
                (savedPaths
                  ? result.contentJsonText?.trim()
                    ? savedPaths.contentJsonPath
                    : savedPaths.middleJsonPath
                  : 'content_list_v2.json');
              const status = savedPaths
                ? `宸插畬鎴?MinerU 解析并保存到 ${savedPaths.directory}`
                : '宸插畬鎴?MinerU 解析';

              syncLibraryParsedState(item, jsonText, resolvedJsonPath, status);
              parsedCount += 1;
              successCount += 1;
            } catch (nextError) {
              failedCount += 1;
              lastErrorMessage =
                nextError instanceof Error ? nextError.message : 'MinerU 解析失败';
            } finally {
              completedCount += 1;
              autoMineruAttemptedRef.current.add(attemptKey);
              updateProgress(currentLabel);
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, candidates.length) }, () => runWorker()),
        );
      } finally {
        batchMineruRunningRef.current = false;
        setBatchMineruRunning(false);
        setBatchMineruProgress({
          running: false,
          total: candidates.length,
          completed: completedCount,
          succeeded: successCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            candidates.length > 0 ? `宸插畬鎴?${completedCount}/${candidates.length}` : '',
        });
      }

      if (!auto) {
        if (lastErrorMessage) {
          setError(lastErrorMessage);
        }

        setStatusMessage(
          `批量 MinerU 鐟欙絾鐎界€瑰本鍨氶敍姘煀婢?${parsedCount}，已存在 ${existingCount}锛岃烦杩?${skippedCount}锛屽け璐?${failedCount}`,
        );
      }
    },
    [
      allKnownItems,
      findExistingMineruJson,
      mineruApiToken,
      saveLibraryMineruParseCache,
      settings.libraryBatchConcurrency,
      settings.mineruCacheDir,
      syncLibraryParsedState,
    ],
  );

  const handleBatchGenerateSummaries = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchSummaryRunningRef.current) {
        return;
      }

      if (!summaryConfigured) {
        if (!auto) {
          setPreferencesOpen(true);
          setError('请先配置摘要模型');
          setStatusMessage('缺少摘要模型配置');
        }
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage('当前没有可处理的文献');
        }
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);
      const preparedCandidates = await Promise.all(
        allKnownItems.map(async (item) => {
          const parseResult =
            settings.summarySourceMode === 'mineru-markdown'
              ? await findExistingMineruJson(item)
              : null;
          const hasParse = Boolean(parseResult);
          const attemptKey = getAutoSummaryAttemptKey(
            item,
            settings.summarySourceMode,
            hasParse,
          );

          return {
            item,
            hasParse,
            attemptKey,
          };
        }),
      );
      const candidates = preparedCandidates.filter(
        ({ attemptKey }) => !(auto && autoSummaryAttemptedRef.current.has(attemptKey)),
      );

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage('当前没有待生成摘要的文献');
        }
        return;
      }

      batchSummaryRunningRef.current = true;
      setBatchSummaryRunning(true);
      setBatchSummaryProgress({
        running: true,
        total: candidates.length,
        completed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        currentLabel: candidates[0]?.item.title ?? '',
      });

      let succeededCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let completedCount = 0;
      let cursor = 0;

      const updateProgress = (currentLabel: string) => {
        setBatchSummaryProgress({
          running: true,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel,
        });
      };

      try {
        const runWorker = async () => {
          while (true) {
            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length) {
              return;
            }

            const candidate = candidates[currentIndex];
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${candidate.item.title}`;

            if (!auto) {
              setStatusMessage(`批量摘要生成中：${currentLabel}`);
            }

            updateProgress(currentLabel);

            try {
              if (
                settings.summarySourceMode === 'pdf-text' &&
                !candidate.item.localPdfPath?.trim()
              ) {
                skippedCount += 1;
                continue;
              }

              if (settings.summarySourceMode === 'mineru-markdown' && !candidate.hasParse) {
                skippedCount += 1;
                continue;
              }

              const outcome = await generateLibraryPreview(candidate.item, false, {
                allowGenerate: true,
              });

              if (outcome === 'failed') {
                failedCount += 1;
              } else if (outcome === 'skipped') {
                skippedCount += 1;
              } else {
                succeededCount += 1;
              }
            } finally {
              completedCount += 1;
              autoSummaryAttemptedRef.current.add(candidate.attemptKey);
              updateProgress(currentLabel);
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, candidates.length) }, () => runWorker()),
        );
      } finally {
        batchSummaryRunningRef.current = false;
        setBatchSummaryRunning(false);
        setBatchSummaryProgress({
          running: false,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            candidates.length > 0 ? `宸插畬鎴?${completedCount}/${candidates.length}` : '',
        });
      }

      if (!auto) {
        setStatusMessage(
          `閹靛綊鍣洪幗妯款洣婢跺嫮鎮婄€瑰本鍨氶敍姘灇閸?${succeededCount}锛岃烦杩?${skippedCount}锛屽け璐?${failedCount}`,
        );
      }
    },
    [
      allKnownItems,
      findExistingMineruJson,
      generateLibraryPreview,
      settings.libraryBatchConcurrency,
      settings.summarySourceMode,
      summaryConfigured,
    ],
  );

  const handleOpenStandalonePdf = async () => {
    setError('');

    try {
      const source = await selectLocalPdfSource();

      if (!source || source.kind !== 'local-path') {
        setStatusMessage('已取消选择 PDF');
        return;
      }

      const standaloneItem = createStandaloneItem(source.path);

      setStandaloneItems((current) => {
        const existingItems = current.filter(
          (item) => item.workspaceId !== standaloneItem.workspaceId,
        );
        return [standaloneItem, ...existingItems];
      });
      setSelectedSectionKey('standalone');
      setSelectedLibraryItemId(standaloneItem.workspaceId);
      openTab(standaloneItem.workspaceId, standaloneItem.title);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '打开独立 PDF 失败');
      setStatusMessage('打开独立 PDF 失败');
    }
  };

  const handleLibraryItemClick = (item: WorkspaceItem) => {
    if (libraryItemClickTimerRef.current) {
      window.clearTimeout(libraryItemClickTimerRef.current);
    }

    libraryItemClickTimerRef.current = window.setTimeout(() => {
      libraryItemClickTimerRef.current = null;
      setSelectedLibraryItemId(item.workspaceId);
      setStatusMessage(`瀹告煡鈧鑵戦弬鍥╁盀閵?{item.title}》`);
    }, 220);
  };

  const handleLibraryItemDoubleClick = (item: WorkspaceItem) => {
    if (libraryItemClickTimerRef.current) {
      window.clearTimeout(libraryItemClickTimerRef.current);
      libraryItemClickTimerRef.current = null;
    }

    setSelectedLibraryItemId(item.workspaceId);
    openTab(item.workspaceId, item.title);
  };

  const handleWindowMinimize = () => {
    void appWindow.minimize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口最小化失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowToggleMaximize = () => {
    void appWindow.toggleMaximize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口缩放失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowClose = () => {
    void appWindow.close().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口关闭失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleSelectMineruCacheDir = async () => {
    try {
      const selectedDir = await selectDirectory('选择 MinerU 解析缓存目录');

      if (!selectedDir) {
        setStatusMessage('已取消选择解析缓存目录');
        return;
      }

      setSettings((current) => ({
        ...current,
        mineruCacheDir: selectedDir,
      }));
      setStatusMessage(`已设置解析缓存目录：${truncateMiddle(selectedDir, 48)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '选择解析缓存目录失败');
      setStatusMessage('选择解析缓存目录失败');
    }
  };

  const handleSelectRemotePdfDownloadDir = async () => {
    try {
      const selectedDir = await selectDirectory('选择远程 PDF 下载目录');

      if (!selectedDir) {
        setStatusMessage('已取消选择远程 PDF 下载目录');
        return;
      }

      setSettings((current) => ({
        ...current,
        remotePdfDownloadDir: selectedDir,
      }));
      setStatusMessage(`瀹歌尪顔曠純顔跨箼缁?PDF 娑撳娴囬惄顔肩秿閿?{truncateMiddle(selectedDir, 48)}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '选择远程 PDF 下载目录失败');
      setStatusMessage('选择远程 PDF 下载目录失败');
    }
  };

  const handleTestLlmConnection = async (
    preset?: QaModelPreset,
  ): Promise<OpenAICompatibleTestResult> => {
    setError('');
    setStatusMessage('正在测试 AI 閹恒儱褰涙潻鐐村复閳?);

    try {
      const targetPreset = preset ?? translationModelPreset;

      if (!targetPreset) {
        throw new Error('鐠囧嘲鍘涢崷銊啎缂冾喕鑵戞穱婵嗙摠閼峰啿鐨稉鈧稉顏勫讲閻劎娈戞径褎膩閸ㄥ鈧?);
      }

      const result = await testOpenAICompatibleChat({
        baseUrl: targetPreset.baseUrl,
        apiKey: targetPreset.apiKey.trim(),
        model: targetPreset.model,
      });

      if (result.ok) {
        setError('');
        setStatusMessage(`AI 鎺ュ彛娴嬭瘯閫氳繃锛?{result.responseModel || result.model}`);
      } else {
        setError(result.message);
        setStatusMessage(`AI 鎺ュ彛娴嬭瘯澶辫触锛?{result.message}`);
      }

      return result;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '测试 AI 接口失败';

      setError(message);
      setStatusMessage(message);
      throw nextError;
    }
  };

  const handleBridgeStateChange = useCallback((tabId: string, bridge: ReaderTabBridgeState | null) => {
    setReaderBridges((current) => {
      if (!bridge) {
        if (!(tabId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[tabId];
        return next;
      }

      return {
        ...current,
        [tabId]: bridge,
      };
    });
  }, []);

  const handlePreviewCloudParse = useCallback(() => {
    if (!selectedLibraryItem) {
      return;
    }

    const tabId = openTab(selectedLibraryItem.workspaceId, selectedLibraryItem.title);
    const bridge = readerBridges[tabId];

    if (bridge) {
      bridge.onCloudParse();
      return;
    }

    setPendingCloudParseTabId(tabId);
  }, [openTab, readerBridges, selectedLibraryItem]);

  const updateSetting = useCallback(<Key extends keyof ReaderSettings>(
    key: Key,
    value: ReaderSettings[Key],
  ) => {
    setSettings((current) =>
      normalizeReaderSettings({
        ...current,
        [key]: key === 'translationDisplayMode' ? 'translated' : value,
      }),
    );
  }, []);

  const updateReaderSecret = useCallback(<Key extends keyof ReaderSecrets>(
    key: Key,
    value: ReaderSecrets[Key],
  ) => {
    setReaderSecrets((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const updateQaModelPreset = useCallback((presetId: string, patch: Partial<QaModelPreset>) => {
    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: current.qaModelPresets.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        const nextModel = Object.prototype.hasOwnProperty.call(patch, 'model')
          ? patch.model ?? ''
          : preset.model;
        const hasExplicitLabel = Object.prototype.hasOwnProperty.call(patch, 'label');
        const nextLabelSource = hasExplicitLabel ? patch.label ?? '' : preset.label;
        const currentLabelCustomized = preset.labelCustomized ?? false;
        const nextLabelCustomized =
          patch.labelCustomized ??
          (hasExplicitLabel
            ? nextLabelSource.trim() !== '' && nextLabelSource.trim() !== nextModel.trim()
            : currentLabelCustomized);
        const nextLabel =
          hasExplicitLabel
            ? nextLabelSource || (!nextLabelCustomized ? nextModel : '')
            : Object.prototype.hasOwnProperty.call(patch, 'model') &&
                (!currentLabelCustomized || preset.label.trim() === preset.model.trim())
              ? nextModel
              : preset.label;

        return createQaPreset({
          ...preset,
          ...patch,
          model: nextModel,
          label: nextLabel,
          labelCustomized: nextLabelCustomized,
        });
      }),
    }));
  }, []);

  const addQaModelPreset = useCallback(() => {
    const nextPreset = createQaPreset({
      baseUrl: '',
      model: '',
      label: '',
      apiKey: '',
      labelCustomized: false,
    });

    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: [...current.qaModelPresets, nextPreset],
    }));
  }, []);

  const removeQaModelPreset = useCallback((presetId: string) => {
    const nextPresets = qaModelPresets.filter((preset) => preset.id !== presetId);

    if (nextPresets.length === 0 || nextPresets.length === qaModelPresets.length) {
      return;
    }

    setReaderSecrets((current) => ({
      ...current,
      qaModelPresets: nextPresets,
    }));

    const fallbackPresetId = nextPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;

    setSettings((current) => {
      return {
        ...current,
        qaActivePresetId:
          current.qaActivePresetId === presetId ? fallbackPresetId : current.qaActivePresetId,
        translationModelPresetId:
          current.translationModelPresetId === presetId
            ? fallbackPresetId
            : current.translationModelPresetId,
        selectionTranslationModelPresetId:
          current.selectionTranslationModelPresetId === presetId
            ? fallbackPresetId
            : current.selectionTranslationModelPresetId,
        summaryModelPresetId:
          current.summaryModelPresetId === presetId
            ? fallbackPresetId
            : current.summaryModelPresetId,
      };
    });
  }, [qaModelPresets]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(SECRETS_STORAGE_KEY, JSON.stringify(readerSecrets));
  }, [readerSecrets]);

  useEffect(() => {
    if (qaModelPresets.some((preset) => preset.id === settings.qaActivePresetId)) {
      return;
    }

    const fallbackPresetId = qaModelPresets[0]?.id ?? DEFAULT_QA_PRESET_ID;

    setSettings((current) => ({
      ...current,
      qaActivePresetId: fallbackPresetId,
    }));
  }, [qaModelPresets, settings.qaActivePresetId]);

  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY, String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  useEffect(() => {
    if (!configHydrated || !appDefaultPaths) {
      return;
    }

    const nextConfig: ReaderConfigFile = {
      version: READER_CONFIG_VERSION,
      settings,
      secrets: readerSecrets,
      zoteroLocalDataDir,
      leftSidebarCollapsed,
    };

    void writeLocalTextFile(appDefaultPaths.configPath, JSON.stringify(nextConfig, null, 2)).catch(
      () => undefined,
    );
  }, [
    appDefaultPaths,
    configHydrated,
    leftSidebarCollapsed,
    readerSecrets,
    settings,
    zoteroLocalDataDir,
  ]);

  useEffect(() => {
    if (!pendingCloudParseTabId) {
      return;
    }

    const bridge = readerBridges[pendingCloudParseTabId];

    if (!bridge) {
      return;
    }

    bridge.onCloudParse();
    setPendingCloudParseTabId(null);
  }, [pendingCloudParseTabId, readerBridges]);

  useEffect(() => {
    void loadLocalLibrary(undefined, true);
  }, []);

  useEffect(() => {
    autoMineruAttemptedRef.current.clear();
  }, [
    mineruApiToken,
    settings.autoLoadSiblingJson,
    settings.autoMineruParse,
    settings.mineruCacheDir,
  ]);

  useEffect(() => {
    autoSummaryAttemptedRef.current.clear();
  }, [
    settings.autoGenerateSummary,
    settings.autoLoadSiblingJson,
    settings.mineruCacheDir,
    settings.summarySourceMode,
    summaryConfigured,
  ]);

  useEffect(() => {
    if (activeTabId !== HOME_TAB_ID || !selectedLibraryItem) {
      return;
    }

    void generateLibraryPreview(selectedLibraryItem, false, { allowGenerate: false });
  }, [
    activeTabId,
    selectedLibraryItem?.workspaceId,
    settings.mineruCacheDir,
    settings.autoLoadSiblingJson,
    settings.summaryBaseUrl,
    settings.summaryModel,
    settings.summarySourceMode,
    summaryApiKey,
  ]);

  useEffect(() => {
    if (!configHydrated || !settings.autoMineruParse) {
      return;
    }

    if (batchMineruRunningRef.current) {
      return;
    }

    void handleBatchMineruParse({ auto: true });
  }, [
    configHydrated,
    settings.autoMineruParse,
    allKnownItems,
  ]);

  useEffect(() => {
    if (!configHydrated || !settings.autoGenerateSummary || !summaryConfigured) {
      return;
    }

    if (batchSummaryRunningRef.current) {
      return;
    }

    void handleBatchGenerateSummaries({ auto: true });
  }, [
    allKnownItems,
    configHydrated,
    itemParseStatusMap,
    settings.autoGenerateSummary,
    summaryConfigured,
  ]);

  useEffect(() => {
    if (!selectedSectionKey.startsWith('collection:')) {
      return;
    }

    const collectionKey = selectedSectionKey.slice('collection:'.length);
    void ensureCollectionItems(collectionKey);
  }, [selectedSectionKey, zoteroLocalDataDir]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (activeTab?.type !== 'library') {
          return;
        }

        event.preventDefault();
        librarySearchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape' && preferencesOpen) {
        setPreferencesOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab?.type, preferencesOpen]);

  useEffect(() => {
    return () => {
      if (libraryItemClickTimerRef.current) {
        window.clearTimeout(libraryItemClickTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] text-slate-900">
      <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/70 bg-white/55 shadow-[0_26px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/72 px-4 backdrop-blur-xl">
          <div
            className="flex min-w-0 items-center gap-3"
            data-tauri-drag-region
            onDoubleClick={handleWindowToggleMaximize}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <BookOpenText className="h-4 w-4" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">paperquay</div>
              <div className="truncate text-xs text-slate-500">
                {activeTab?.type === 'reader'
                  ? truncateMiddle(activeTab.title, 44)
                  : '濡楀矂娼版导妯哄帥閻ㄥ嫯顔戦弬鍥鐠囪绗岄崙鐘辩秿閼辨柨濮╁銉ょ稊閸?}
              </div>
            </div>
          </div>

          <div
            className="mx-4 min-w-8 flex-1 self-stretch"
            data-tauri-drag-region
            onDoubleClick={handleWindowToggleMaximize}
          />

          <div className="flex items-center gap-2">
            <button
              hidden
              type="button"
              onClick={() => setLeftSidebarCollapsed((current) => !current)}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              {leftSidebarCollapsed ? (
                <PanelLeftOpen className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : (
                <PanelLeftClose className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {leftSidebarCollapsed ? '展开文库' : '折叠文库'}
            </button>
            <button
              hidden
              type="button"
              onClick={handleOpenStandalonePdf}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              <Library className="mr-2 h-4 w-4" strokeWidth={1.8} />
              打开 PDF
            </button>
            <button
              type="button"
              onClick={handleOpenPreferences}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              <Settings2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              设置
            </button>
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={handleWindowMinimize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700"
                aria-label="最小化"
              >
                <Minus className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowToggleMaximize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700"
                aria-label="窗口缩放"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowClose}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600"
                aria-label="关闭"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>

        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTab}
          onClose={closeTab}
        />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0" hidden={activeTabId !== HOME_TAB_ID}>
            <LibraryWorkspace
              leftSidebarCollapsed={leftSidebarCollapsed}
              zoteroLocalDataDir={zoteroLocalDataDir}
              zoteroAllItemsCount={zoteroAllItems.length}
              standaloneItemsCount={standaloneItems.length}
              flattenedCollections={flattenedCollections}
              selectedSectionKey={selectedSectionKey}
              selectedSectionTitle={selectedSectionTitle}
              visibleItems={visibleItems}
              itemParseStatusMap={itemParseStatusMap}
              selectedItemId={selectedItemId}
              librarySearchQuery={librarySearchQuery}
              libraryDisplayMode={libraryDisplayMode}
              libraryLoading={libraryLoading}
              libraryLoadingSection={libraryLoadingSection}
              statusMessage={statusMessage}
              error={error}
              librarySearchInputRef={librarySearchInputRef}
              onToggleLeftSidebar={() => setLeftSidebarCollapsed((current) => !current)}
              onSelectSection={(sectionKey) => void handleSelectLibrarySection(sectionKey)}
              onSearchQueryChange={setLibrarySearchQuery}
              onDisplayModeChange={setLibraryDisplayMode}
              onOpenStandalonePdf={() => void handleOpenStandalonePdf()}
              onReloadLocalZotero={() => void handleReloadLocalZotero()}
              onOpenPreferences={handleOpenPreferences}
              onItemClick={handleLibraryItemClick}
              onItemDoubleClick={handleLibraryItemDoubleClick}
              previewPane={
                <LibraryPreviewPane
                  selectedItem={selectedLibraryItem}
                  currentPdfName={activeLibraryPreviewState.currentPdfName}
                  currentJsonName={activeLibraryPreviewState.currentJsonName}
                  hasBlocks={activeLibraryPreviewState.hasBlocks}
                  blockCount={activeLibraryPreviewState.blockCount}
                  statusMessage={activeLibraryPreviewState.statusMessage}
                  summary={activeLibraryPreviewState.summary}
                  loading={activeLibraryPreviewState.loading}
                  error={activeLibraryPreviewState.error}
                  aiConfigured={Boolean(
                    summaryModelPreset &&
                      summaryModelPreset.apiKey.trim() &&
                      summaryModelPreset.baseUrl.trim() &&
                      summaryModelPreset.model.trim(),
                  )}
                  onOpenReader={() => {
                    if (selectedLibraryItem) {
                      openTab(selectedLibraryItem.workspaceId, selectedLibraryItem.title);
                    }
                  }}
                  onCloudParse={handlePreviewCloudParse}
                  onGenerateSummary={() => {
                    if (selectedLibraryItem) {
                      void generateLibraryPreview(selectedLibraryItem, true, { allowGenerate: true });
                    }
                  }}
                />
              }
            />
          </div>

          {readerTabs.map((tab) => {
            const item = workspaceItemMap.get(tab.documentId);

            if (!item) {
              return null;
            }

            return (
              <div key={tab.id} className="h-full min-h-0" hidden={tab.id !== activeTabId}>
                <DocumentReaderTab
                  tabId={tab.id}
                  document={item}
                  isActive={tab.id === activeTabId}
                  settings={settings}
                  zoteroLocalDataDir={zoteroLocalDataDir}
                  mineruApiToken={mineruApiToken}
                  translationApiKey={translationApiKey}
                  summaryApiKey={summaryApiKey}
                  qaModelPresets={qaModelPresets}
                  zoteroApiKey={zoteroApiKey}
                  zoteroUserId={zoteroUserId}
                  onZoteroUserIdChange={(value) => updateReaderSecret('zoteroUserId', value)}
                  onQaActivePresetChange={(presetId) => updateSetting('qaActivePresetId', presetId)}
                  onDocumentResolved={handleWorkspaceItemResolved}
                  onLibraryPreviewSync={handleLibraryPreviewSync}
                  onOpenPreferences={handleOpenPreferences}
                  onOpenStandalonePdf={() => void handleOpenStandalonePdf()}
                  onBridgeStateChange={handleBridgeStateChange}
                />
              </div>
            );
          })}
        </main>
      </div>

      <PreferencesWindow
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        settings={settings}
        zoteroLocalDataDir={zoteroLocalDataDir}
        mineruApiToken={mineruApiToken}
        translationApiKey={translationApiKey}
        summaryApiKey={summaryApiKey}
        qaModelPresets={qaModelPresets}
        zoteroApiKey={zoteroApiKey}
        zoteroUserId={zoteroUserId}
        libraryLoading={libraryLoading}
        translating={activeReaderBridge?.translating ?? false}
        translatedCount={activeReaderBridge?.translatedCount ?? 0}
        onSettingChange={updateSetting}
        onZoteroLocalDataDirChange={setZoteroLocalDataDir}
        onMineruApiTokenChange={(value) => updateReaderSecret('mineruApiToken', value)}
        onTranslationApiKeyChange={(value) => updateReaderSecret('translationApiKey', value)}
        onSummaryApiKeyChange={(value) => updateReaderSecret('summaryApiKey', value)}
        onZoteroApiKeyChange={(value) => updateReaderSecret('zoteroApiKey', value)}
        onZoteroUserIdChange={(value) => updateReaderSecret('zoteroUserId', value)}
        onDetectLocalZotero={() => void handleDetectLocalZotero()}
        onSelectLocalZoteroDir={() => void handleSelectLocalZoteroDir()}
        onReloadLocalZotero={() => void handleReloadLocalZotero()}
        onSelectMineruCacheDir={() => void handleSelectMineruCacheDir()}
        onSelectRemotePdfDownloadDir={() => void handleSelectRemotePdfDownloadDir()}
        onTestLlmConnection={handleTestLlmConnection}
        onQaModelPresetAdd={addQaModelPreset}
        onQaModelPresetRemove={removeQaModelPreset}
        onQaModelPresetChange={updateQaModelPreset}
        onTranslate={activeReaderBridge?.onTranslate}
        onClearTranslations={activeReaderBridge?.onClearTranslations}
        onBatchMineruParse={() => void handleBatchMineruParse()}
        onBatchGenerateSummaries={() => void handleBatchGenerateSummaries()}
        batchMineruRunning={batchMineruRunning}
        batchSummaryRunning={batchSummaryRunning}
        batchMineruProgress={batchMineruProgress}
        batchSummaryProgress={batchSummaryProgress}
      />
    </div>
  );
}

export default Reader;
