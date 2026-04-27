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
  HelpCircle,
  Languages,
  Library,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  Square,
  Sun,
  X,
} from 'lucide-react';
import TabBar from '../../components/tabs/TabBar';
import OnboardingGuide from './OnboardingGuide';
import LibraryPreviewPane from '../library/LibraryPreviewPane';
import LibraryWorkspace from '../library/LibraryWorkspace';
import LiteratureLibraryView from '../literature/LiteratureLibraryView';
import DocumentReaderTab, {
  type LibraryPreviewSyncPayload,
  type ReaderTabBridgeState,
} from './DocumentReaderTab';
import {
  getAppDefaultPaths,
  readLocalBinaryFile,
  readLocalTextFile,
  runMineruCloudParse,
  openExternalUrl,
  selectDirectory,
  selectLocalPdfSource,
  writeLocalTextFile,
} from '../../services/desktop';
import type { AppDefaultPaths } from '../../services/desktop';
import {
  extractTextFromMineruBlock,
  flattenMineruPages,
  parseMineruPages,
} from '../../services/mineru';
import { testOpenAICompatibleChat } from '../../services/llm';
import { updateLibraryPaper } from '../../services/library';
import { summarizeDocumentOpenAICompatible } from '../../services/summary';
import { translateBlocksOpenAICompatible } from '../../services/translation';
import {
  buildMineruMarkdownDocument,
  buildSummaryBlockInputs,
  extractPdfTextByPdfJs,
  resolveSummaryOutputLanguage,
  SUMMARY_PROMPT_VERSION,
} from '../../services/summarySource';
import {
  detectLocalZoteroDataDir,
  listLocalZoteroCollectionItems,
  listLocalZoteroCollections,
  listLocalZoteroLibraryItems,
  selectLocalZoteroDataDir,
} from '../../services/zotero';
import {
  getHomeTabTitle,
  HOME_TAB_ID,
  useTabsStore,
  type ReaderTab,
} from '../../stores/useTabsStore';
import { useThemeStore } from '../../stores/useThemeStore';
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
  TranslationMap,
  UiLanguage,
  PositionedMineruBlock,
  WorkspaceItem,
  ZoteroCollection,
  ZoteroLibraryItem,
} from '../../types/reader';
import type { LiteraturePaper } from '../../types/library';
import { AppLocaleProvider, useAppLocale } from '../../i18n/uiLanguage';
import { truncateMiddle, getFileNameFromPath } from '../../utils/text';
import {
  buildLegacyMineruCachePaths,
  buildLegacyMineruSummaryCachePath,
  buildMineruCachePaths,
  buildMineruSummaryCachePath,
  buildMineruTranslationCachePath,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache';
import { loadPaperHistory } from '../../utils/paperHistory';

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'paper-reader-left-sidebar-collapsed-v1';
const ONBOARDING_SEEN_STORAGE_KEY = 'paperquay-onboarding-seen-v1';
const ONBOARDING_WELCOME_CACHE_DIR = '/onboarding/mineru-cache/welcome-bfc1ec86';
const ONBOARDING_WELCOME_ITEM: WorkspaceItem = {
  itemKey: 'onboarding:welcome',
  title: 'Welcome to PaperQuay',
  creators: 'PaperQuay',
  year: '2026',
  itemType: 'pdf',
  attachmentFilename: 'welcome.pdf',
  localPdfPath: '/onboarding/welcome.pdf',
  source: 'onboarding',
  workspaceId: 'onboarding:welcome',
  groupKey: 'onboarding:welcome',
};
const WELCOME_STANDALONE_ITEM: WorkspaceItem = {
  ...ONBOARDING_WELCOME_ITEM,
  itemKey: 'standalone:onboarding:welcome',
  creators: 'PaperQuay Demo',
  source: 'standalone',
};

function isOnboardingWelcomeItem(item: WorkspaceItem | null | undefined): boolean {
  return item?.workspaceId === ONBOARDING_WELCOME_ITEM.workspaceId;
}

interface OnboardingDemoRevealState {
  parsed: boolean;
  translated: boolean;
  summarized: boolean;
}

const EMPTY_ONBOARDING_DEMO_REVEAL: OnboardingDemoRevealState = {
  parsed: false,
  translated: false,
  summarized: false,
};

type PreferencesSectionKey = 'general' | 'library' | 'reading' | 'mineru' | 'translation' | 'models' | 'summaryQa';

const DEFAULT_QA_PRESET_ID = 'default';
const READER_CONFIG_VERSION = 1;

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

function buildLanguageOptions(locale: UiLanguage) {
  return [
    { value: 'auto', label: pickLocaleText(locale, '自动识别', 'Auto Detect') },
    { value: 'English', label: 'English' },
    { value: 'Chinese', label: pickLocaleText(locale, '中文', 'Chinese') },
    { value: 'Japanese', label: pickLocaleText(locale, '日语', 'Japanese') },
    { value: 'Korean', label: pickLocaleText(locale, '韩语', 'Korean') },
    { value: 'French', label: pickLocaleText(locale, '法语', 'French') },
    { value: 'German', label: 'Deutsch' },
    { value: 'Spanish', label: pickLocaleText(locale, '西班牙语', 'Spanish') },
  ];
}

function buildSummaryLanguageOptions(locale: UiLanguage) {
  return [
    { value: 'follow-ui', label: pickLocaleText(locale, '跟随界面语言', 'Follow UI Language') },
    { value: 'Chinese', label: pickLocaleText(locale, '中文', 'Chinese') },
    { value: 'English', label: 'English' },
    { value: 'Japanese', label: pickLocaleText(locale, '日语', 'Japanese') },
    { value: 'Korean', label: pickLocaleText(locale, '韩语', 'Korean') },
    { value: 'French', label: pickLocaleText(locale, '法语', 'French') },
    { value: 'German', label: 'Deutsch' },
    { value: 'Spanish', label: pickLocaleText(locale, '西班牙语', 'Spanish') },
  ];
}

function buildSummarySourceOptions(locale: UiLanguage): Array<{
  value: SummarySourceMode;
  label: string;
  description: string;
}> {
  return [
    {
      value: 'mineru-markdown',
      label: 'MinerU Markdown',
      description: pickLocaleText(
        locale,
        '优先读取 full.md 作为主要输入，若不存在则回退到块级文本。',
        'Prefer reading full.md as the primary input, and fall back to block text if it is unavailable.',
      ),
    },
    {
      value: 'pdf-text',
      label: pickLocaleText(locale, 'PDF 文本', 'PDF Text'),
      description: pickLocaleText(
        locale,
        '使用 pdf.js 提取 PDF 全文，适合没有 MinerU Markdown 的场景。',
        'Use pdf.js to extract full PDF text, suitable when MinerU Markdown is unavailable.',
      ),
    },
  ];
}

function buildQaSourceOptions(locale: UiLanguage): Array<{
  value: ReaderSettings['qaSourceMode'];
  label: string;
  description: string;
}> {
  return [
    {
      value: 'mineru-markdown',
      label: 'MinerU Markdown',
      description: pickLocaleText(
        locale,
        '优先使用 MinerU 结构化内容中的 Markdown 作为问答上下文。',
        'Prefer MinerU Markdown content as the QA context.',
      ),
    },
    {
      value: 'pdf-text',
      label: pickLocaleText(locale, 'PDF 文本', 'PDF Text'),
      description: pickLocaleText(
        locale,
        '使用 pdf.js 提取 PDF 全文作为问答上下文。',
        'Use full PDF text extracted by pdf.js as the QA context.',
      ),
    },
  ];
}

const DEFAULT_SETTINGS: ReaderSettings = {
  uiLanguage: 'zh-CN',
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
  summaryOutputLanguage: 'follow-ui',
  qaSourceMode: 'mineru-markdown',
  translationSourceLanguage: 'English',
  translationTargetLanguage: 'Chinese',
  translationDisplayMode: 'translated',
  qaActivePresetId: 'default',
};

const DEFAULT_QA_PRESET: QaModelPreset = {
  id: DEFAULT_QA_PRESET_ID,
  label: 'gpt-4o-mini',
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
      label: settings.summaryModel?.trim() || 'Paper Overview',
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

interface TranslationCacheEnvelope {
  version: number;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

interface BatchProgressState {
  running: boolean;
  paused: boolean;
  cancelRequested: boolean;
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
  currentPdfName: '',
  currentJsonName: '',
  statusMessage: '',
  sourceKey: '',
};

const EMPTY_BATCH_PROGRESS: BatchProgressState = {
  running: false,
  paused: false,
  cancelRequested: false,
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
  outputLanguage: string,
  hasParse: boolean,
): string {
  return `${item.workspaceId}::${sourceMode}::${outputLanguage}::${item.localPdfPath?.trim() ?? ''}::${hasParse ? 'parsed' : 'unparsed'}`;
}

function clampBatchConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function getPathSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

function joinSystemPath(basePath: string, ...segments: string[]): string {
  const separator = getPathSeparator(basePath);
  const normalizedBase = basePath.replace(/[\\/]+$/, '');

  return [normalizedBase, ...segments.filter(Boolean)].join(separator);
}

function buildLegacyConfigPath(executableDir: string): string {
  return joinSystemPath(executableDir, 'paperquay-data', 'paperquay.config.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
    uiLanguage: merged.uiLanguage === 'en-US' ? 'en-US' : 'zh-CN',
    libraryBatchConcurrency: clampBatchConcurrency(merged.libraryBatchConcurrency),
    translationBatchSize: clampTranslationBatchSize(merged.translationBatchSize),
    translationConcurrency: clampTranslationConcurrency(merged.translationConcurrency),
    summaryOutputLanguage: merged.summaryOutputLanguage?.trim() || 'follow-ui',
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

function createStandaloneItem(path: string, locale: UiLanguage): WorkspaceItem {
  const filename = getFileNameFromPath(path);
  const title =
    filename.replace(/\.pdf$/i, '') || pickLocaleText(locale, '未命名 PDF', 'Untitled PDF');

  const workspaceId = `standalone:${path}`;

  return {
    itemKey: workspaceId,
    title,
    creators: pickLocaleText(locale, '独立 PDF', 'Standalone PDF'),
    year: '',
    itemType: 'pdf',
    localPdfPath: path,
    source: 'standalone',
    workspaceId,
    groupKey: workspaceId,
  };
}

function createNativeLibraryWorkspaceItem(paper: LiteraturePaper): WorkspaceItem | null {
  const attachment = paper.attachments.find((item) => item.kind === 'pdf' && item.storedPath.trim());

  if (!attachment) {
    return null;
  }

  const workspaceId = `native-library:${paper.id}`;

  return {
    itemKey: paper.id,
    title: paper.title,
    creators: paper.authors.length > 0
      ? paper.authors.map((author) => author.name).join(', ')
      : 'Unknown Authors',
    year: paper.year ?? '',
    itemType: 'pdf',
    attachmentFilename: attachment.fileName,
    localPdfPath: attachment.storedPath,
    source: 'native-library',
    workspaceId,
    groupKey: workspaceId,
  };
}

function textSignature(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }

  return chunks;
}

function formatPaperSummaryForLibrary(summary: PaperSummary): string {
  const sections = [
    ['Overview', summary.overview || summary.abstract],
    ['Background', summary.background],
    ['Research Problem', summary.researchProblem],
    ['Approach', summary.approach],
    ['Experiment Setup', summary.experimentSetup],
    ['Key Findings', summary.keyFindings.join('\n')],
    ['Conclusions', summary.conclusions],
    ['Limitations', summary.limitations],
    ['Takeaways', summary.takeaways.join('\n')],
    ['Keywords', summary.keywords.join(', ')],
  ]
    .map(([title, content]) => [title, content.trim()] as const)
    .filter(([, content]) => content.length > 0)
    .map(([title, content]) => `## ${title}\n${content}`);

  return sections.join('\n\n').trim();
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
  const locale = useAppLocale();
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
        <span>{pickLocaleText(locale, `成功 ${progress.succeeded}`, `Succeeded ${progress.succeeded}`)}</span>
        <span>{pickLocaleText(locale, `跳过 ${progress.skipped}`, `Skipped ${progress.skipped}`)}</span>
        <span>{pickLocaleText(locale, `失败 ${progress.failed}`, `Failed ${progress.failed}`)}</span>
        {progress.paused ? (
          <span>{pickLocaleText(locale, '已暂停', 'Paused')}</span>
        ) : null}
        {progress.cancelRequested ? (
          <span>{pickLocaleText(locale, '取消中', 'Cancelling')}</span>
        ) : null}
      </div>
      {progress.currentLabel ? (
        <div className="mt-2 truncate text-xs text-slate-500">{progress.currentLabel}</div>
      ) : null}
    </div>
  );
}

interface PreferencesWindowProps {
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
function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-chrome-800 dark:shadow-none">
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-chrome-100">{label}</div>
        {description ? <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-300">{description}</div> : null}
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
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-100 dark:placeholder:text-chrome-400 dark:focus:border-accent-teal dark:focus:bg-chrome-700',
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
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-100 dark:focus:border-accent-teal dark:focus:bg-chrome-700',
        props.className,
      )}
    />
  );
}

function PreferencesWindow({
  open,
  onClose,
  preferredSection,
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
  onToggleBatchMineruPause,
  onCancelBatchMineru,
  onToggleBatchSummaryPause,
  onCancelBatchSummary,
  batchMineruRunning = false,
  batchSummaryRunning = false,
  batchMineruPaused = false,
  batchSummaryPaused = false,
  batchMineruProgress,
  batchSummaryProgress,
}: PreferencesWindowProps) {
  const uiLanguage = settings.uiLanguage;
  const l = <T,>(zh: T, en: T) => pickLocaleText(uiLanguage, zh, en);
  const languageOptions = buildLanguageOptions(uiLanguage);
  const summaryLanguageOptions = buildSummaryLanguageOptions(uiLanguage);
  const summarySourceOptions = buildSummarySourceOptions(uiLanguage);
  const qaSourceOptions = buildQaSourceOptions(uiLanguage);
  const resolvedSummaryLanguage = resolveSummaryOutputLanguage(settings);
  const [activeSection, setActiveSection] = useState<PreferencesSectionKey>('general');
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

    if (preferredSection) {
      setActiveSection(preferredSection);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, preferredSection]);

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
        message: nextError instanceof Error ? nextError.message : l('测试连接失败', 'Connection test failed'),
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
          message: nextError instanceof Error ? nextError.message : l('模型测试失败', 'Model test failed'),
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
      key: 'general' as const,
      title: l('通用', 'General'),
      description: l('语言、主题和基础应用行为', 'Language, theme, and basic application behavior'),
      icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'library' as const,
      title: l('文库与 Zotero', 'Library & Zotero'),
      description: l('Zotero、本地路径和 PDF 来源', 'Zotero, local paths, and PDF sources'),
      icon: <Library className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'reading' as const,
      title: l('阅读显示', 'Reader Display'),
      description: l('联动、滚动、布局和结构块显示', 'Linking, scrolling, layout, and block display'),
      icon: <BookOpenText className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'mineru' as const,
      title: 'MinerU',
      description: l('API Key、缓存、自动解析和批量任务', 'API key, cache, auto parse, and batch jobs'),
      icon: <Database className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'translation' as const,
      title: l('翻译', 'Translation'),
      description: l('全文翻译、划词翻译、语言和吞吐', 'Full translation, selection translation, languages, and throughput'),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'models' as const,
      title: l('AI 模型', 'AI Models'),
      description: l('OpenAI 兼容模型预设和测试', 'OpenAI-compatible model presets and tests'),
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'summaryQa' as const,
      title: l('概览与问答', 'Overview & QA'),
      description: l('概览输入、批量概览和问答上下文', 'Overview input, batch overview, and QA context'),
      icon: <Database className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/62 backdrop-blur-sm">
      <button
        type="button"
        aria-label={l('关闭设置窗口', 'Close settings window')}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="paperquay-settings relative flex h-[min(760px,calc(100vh-32px))] w-[min(1080px,calc(100vw-32px))] overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)] shadow-[0_36px_120px_rgba(15,23,42,0.20)] dark:border-white/10 dark:bg-chrome-950 dark:shadow-[0_36px_120px_rgba(0,0,0,0.48)]">
        <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/76 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-900">
          <div className="shrink-0 px-3 pb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
              {l('设置', 'Settings')}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-chrome-100">
              {l('设置', 'Settings')}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-chrome-300">
              {l(
                '像桌面应用一样管理文库、阅读、解析与模型能力。',
                'Manage library, reading, parsing, and model capabilities in a desktop-first workflow.',
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200',
                  activeSection === section.key
                    ? 'bg-accent-teal/18 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.18)] dark:bg-accent-teal/18 dark:text-chrome-100 dark:shadow-none'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-chrome-300 dark:hover:bg-chrome-700 dark:hover:text-chrome-100',
                )}
              >
                <span className={clsx('mt-0.5', activeSection === section.key ? 'text-accent-teal dark:text-accent-teal' : 'text-slate-400 dark:text-chrome-400')}>
                  {section.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.title}</span>
                  <span
                    className={clsx(
                      'mt-1 block text-xs leading-5',
                      activeSection === section.key
                        ? 'text-slate-600 dark:text-chrome-300'
                        : 'text-slate-400 dark:text-chrome-400',
                    )}
                  >
                    {section.description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 shrink-0 rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300">
            {l(
              `当前翻译缓存：${translatedCount} 个结构块`,
              `Translation cache: ${translatedCount} blocks`,
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/70 px-6 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-chrome-400">
                {sections.find((section) => section.key === activeSection)?.title}
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-chrome-100">
                {sections.find((section) => section.key === activeSection)?.description}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:bg-chrome-700"
            >
              <X className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('关闭', 'Close')}
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 pb-10">
            <div className="mx-auto max-w-3xl space-y-4">
              {activeSection === 'general' ? (
                <>
                  <SettingsField
                    label={l('软件语言', 'Software Language')}
                    description={l('切换后，主界面与设置界面会同步切换中英文。', 'Switch the main interface and settings between Chinese and English.')}
                  >
                    <SettingsSelect
                      value={settings.uiLanguage}
                      onChange={(event) =>
                        onSettingChange('uiLanguage', event.target.value as ReaderSettings['uiLanguage'])
                      }
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="en-US">English</option>
                    </SettingsSelect>
                  </SettingsField>
                </>
              ) : null}
              {activeSection === 'library' ? (
                <>
                  <div data-tour="zotero-settings">
                  <SettingsField
                    label={l('Zotero 本地数据目录', 'Zotero Local Data Directory')}
                    description={l(
                      '用于读取 Zotero 附件与分类树，目录中应包含 zotero.sqlite。',
                      'Used to read Zotero attachments and collection trees. The directory should contain zotero.sqlite.',
                    )}
                  >
                    <SettingsInput
                      value={zoteroLocalDataDir}
                      onChange={(event) => onZoteroLocalDataDirChange(event.target.value)}
                      placeholder={l('例如 C:\\Users\\Lenovo\\Zotero', 'Example: C:\\Users\\Lenovo\\Zotero')}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onDetectLocalZotero}
                        disabled={libraryLoading}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {l('自动查找', 'Auto Detect')}
                      </button>
                      <button
                        type="button"
                        onClick={onSelectLocalZoteroDir}
                        disabled={libraryLoading}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {l('选择目录', 'Select Directory')}
                      </button>
                      <button
                        type="button"
                        onClick={onReloadLocalZotero}
                        disabled={libraryLoading}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {l('重新读取', 'Reload')}
                      </button>
                    </div>
                  </SettingsField>

                  </div>

                  <SettingsField
                    label={l('Zotero Web 回退', 'Zotero Web Fallback')}
                    description={l(
                      '当本地 PDF 缺失时，通过 Zotero Web API 回退获取附件。',
                      'When the local PDF is missing, fetch the attachment through the Zotero Web API fallback.',
                    )}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">API Key</div>
                        <SettingsInput
                          value={zoteroApiKey}
                          onChange={(event) => onZoteroApiKeyChange(event.target.value)}
                          type="password"
                          placeholder={l(
                            '仅在本地 PDF 缺失时填写 API Key',
                            'Only required when the local PDF is missing.',
                          )}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">User ID</div>
                        <SettingsInput
                          value={zoteroUserId}
                          onChange={(event) => onZoteroUserIdChange(event.target.value)}
                          placeholder={l('可留空，首次回退时自动获取', 'Optional. Auto-detected on first fallback.')}
                        />
                      </div>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={l('远程 PDF 下载目录', 'Remote PDF Download Directory')}
                    description={l(
                      '当通过 Zotero Web 获取 PDF 时，保存到此目录。',
                      'When downloading PDFs through Zotero Web, save them to this directory.',
                    )}
                  >
                    <SettingsInput
                      value={settings.remotePdfDownloadDir}
                      onChange={(event) =>
                        onSettingChange('remotePdfDownloadDir', event.target.value)
                      }
                      placeholder={l('选择本地目录保存下载的 PDF', 'Choose a local directory for downloaded PDFs')}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSelectRemotePdfDownloadDir}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                        {l('选择目录', 'Select Directory')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSettingChange('remotePdfDownloadDir', '')}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        {l('清空路径', 'Clear Path')}
                      </button>
                    </div>
                  </SettingsField>

                </>
              ) : null}

              {activeSection === 'reading' ? (
                <>
                  <ToggleRow
                    title={l('自动加载同名 JSON', 'Auto Load Sibling JSON')}
                    description={l(
                      '打开 PDF 时，自动尝试加载同目录下对应的 content_list_v2.json。',
                      'When opening a PDF, automatically try to load the matching content_list_v2.json from the same directory.',
                    )}
                    checked={settings.autoLoadSiblingJson}
                    onChange={(checked) => onSettingChange('autoLoadSiblingJson', checked)}
                  />
                  <ToggleRow
                    title={l('平滑滚动联动', 'Smooth Linked Scrolling')}
                    description={l(
                      '在 PDF 与结构块之间联动时，使用更平滑的滚动定位。',
                      'Use smoother scrolling when navigating between the PDF and structured blocks.',
                    )}
                    checked={settings.smoothScroll}
                    onChange={(checked) => onSettingChange('smoothScroll', checked)}
                  />
                  <ToggleRow
                    title={l('紧凑阅读模式', 'Compact Reading Mode')}
                    description={l(
                      '压缩结构块列表的间距，适合长文快速通读。',
                      'Reduce block spacing for faster reading in long documents.',
                    )}
                    checked={settings.compactReading}
                    onChange={(checked) => onSettingChange('compactReading', checked)}
                  />
                  <ToggleRow
                    title={l('显示块元信息', 'Show Block Metadata')}
                    description={l(
                      '在结构块中显示页码、类型等辅助信息。',
                      'Show page numbers, block types, and related metadata in the block view.',
                    )}
                    checked={settings.showBlockMeta}
                    onChange={(checked) => onSettingChange('showBlockMeta', checked)}
                  />
                  <ToggleRow
                    title={l('隐藏页眉页脚类块', 'Hide Page Decoration Blocks')}
                    description={l(
                      '在右侧结构块视图中隐藏 page_number、page_footer 等页面装饰内容。',
                      'Hide page_header, page_footer, page_number, page_footnote, and similar decorative content from the block view.',
                    )}
                    checked={settings.hidePageDecorationsInBlockView}
                    onChange={(checked) =>
                      onSettingChange('hidePageDecorationsInBlockView', checked)
                    }
                  />
                  <ToggleRow
                    title={l('柔和页面阴影', 'Soft Page Shadow')}
                    description={l(
                      '为 PDF 页面添加更轻的阴影层次。',
                      'Render PDF pages with a softer shadow treatment.',
                    )}
                    checked={settings.softPageShadow}
                    onChange={(checked) => onSettingChange('softPageShadow', checked)}
                  />
                </>
              ) : null}

              {activeSection === 'mineru' ? (
                <>
                  <SettingsField
                    label="MinerU API Token"
                    description={
                      <span>
                        {l(
                          '配置后可将本地 PDF 发送给 MinerU 并生成结构化 JSON。可前往 ',
                          'Configure this to send local PDFs to MinerU and generate structured JSON. Visit ',
                        )}
                        <button
                          type="button"
                          onClick={() => void openExternalUrl('https://mineru.net/')}
                          className="font-semibold text-sky-600 underline decoration-sky-300 underline-offset-2 transition hover:text-sky-700 dark:text-sky-300 dark:decoration-sky-500/70 dark:hover:text-sky-200"
                        >
                          https://mineru.net/
                        </button>
                        {l(' 获取或管理免费 API Key。', ' to get or manage your free API key.')}
                      </span>
                    }
                  >
                    <SettingsInput
                      value={mineruApiToken}
                      onChange={(event) => onMineruApiTokenChange(event.target.value)}
                      type="password"
                      placeholder={l('输入 MinerU API Token', 'Enter MinerU API Token')}
                    />
                  </SettingsField>

                  <SettingsField
                    label={l('MinerU 缓存目录', 'MinerU Cache Directory')}
                    description={l(
                      '用于保存 content_list_v2.json、middle.json、full.md 与 manifest 等解析产物。',
                      'Stores content_list_v2.json, middle.json, full.md, manifest, and related parse outputs.',
                    )}
                  >
                    <SettingsInput
                      value={settings.mineruCacheDir}
                      onChange={(event) => onSettingChange('mineruCacheDir', event.target.value)}
                      placeholder={l(
                        '选择一个本地目录保存 MinerU 结果',
                        'Choose a local directory to store MinerU outputs',
                      )}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSelectMineruCacheDir}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        <FolderOpen className="mr-2 inline h-4 w-4" strokeWidth={1.8} />
                        {l('选择目录', 'Select Directory')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSettingChange('mineruCacheDir', '')}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                      >
                        {l('清空路径', 'Clear Path')}
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={l('MinerU 自动解析与批量任务', 'MinerU Automation and Batch Jobs')}
                    description={l(
                      '控制 MinerU 自动解析、批量解析和并发数。',
                      'Control MinerU auto parsing, batch parsing, and concurrency.',
                    )}
                  >
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="text-sm font-medium text-slate-900">
                            {l('MinerU 批处理并发数', 'MinerU Batch Concurrency')}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">
                            {l(
                              '控制批量 MinerU 解析的并发度，数值过高可能导致限流或性能波动。',
                              'Controls batch MinerU parse concurrency. Values that are too high may cause rate limits or unstable performance.',
                            )}
                          </div>
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
                        title={l('自动执行 MinerU 解析', 'Auto Run MinerU Parse')}
                        description={l(
                          '检测到可处理 PDF 时自动触发 MinerU 解析。',
                          'Automatically trigger MinerU parsing when a processable PDF is detected.',
                        )}
                        checked={settings.autoMineruParse}
                        onChange={(checked) => onSettingChange('autoMineruParse', checked)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={onBatchMineruParse}
                          disabled={batchMineruRunning}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                        >
                          {batchMineruRunning
                            ? l('处理中...', 'Processing...')
                            : l('启动 MinerU 批量解析', 'Start MinerU Batch Parse')}
                        </button>
                        {batchMineruRunning ? (
                          <button
                            type="button"
                            onClick={onToggleBatchMineruPause}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            {batchMineruPaused ? l('继续', 'Resume') : l('暂停', 'Pause')}
                          </button>
                        ) : null}
                        {batchMineruRunning ? (
                          <button
                            type="button"
                            onClick={onCancelBatchMineru}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100"
                          >
                            {l('取消', 'Cancel')}
                          </button>
                        ) : null}
                      </div>
                      <BatchProgressCard
                        title={l('MinerU 批量解析进度', 'MinerU Batch Progress')}
                        progress={batchMineruProgress}
                        tone="indigo"
                      />
                    </div>
                  </SettingsField>
                </>
              ) : null}

              {activeSection === 'models' ? (
                <>
                  <SettingsField
                    label={l('模型预设库', 'Model Presets')}
                    description={l(
                      '统一维护翻译、概览与问答共用的 OpenAI 兼容模型配置。',
                      'Maintain shared OpenAI-compatible model configurations for translation, overview, and QA.',
                    )}
                  >
                    <div className="space-y-3">
                      {qaModelPresets.map((preset) => (
                        <div
                          key={preset.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">
                              {preset.label || preset.model || l('未命名模型', 'Unnamed Preset')}
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
                              {presetTestLoadingMap[preset.id]
                                ? l('测试中...', 'Testing...')
                                : l('测试', 'Test')}
                            </button>
                            <button
                              type="button"
                              onClick={() => onQaModelPresetRemove(preset.id)}
                              disabled={qaModelPresets.length <= 1}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                            >
                              {l('删除', 'Delete')}
                            </button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-slate-500">
                                {l('显示名称', 'Display Name')}
                              </div>
                              <SettingsInput
                                value={preset.label}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { label: event.target.value })
                                }
                                placeholder={l(
                                  '例如：DeepSeek Chat',
                                  'Example: DeepSeek Chat',
                                )}
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-slate-500">
                                {l('模型名称', 'Model Name')}
                              </div>
                              <SettingsInput
                                value={preset.model}
                                onChange={(event) =>
                                  onQaModelPresetChange(preset.id, { model: event.target.value })
                                }
                                placeholder="gpt-4o-mini / deepseek-chat / qwen-plus"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <div className="text-xs font-medium text-slate-500">
                                {l('地址', 'Endpoint')}
                              </div>
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
                                placeholder={l(
                                  '输入该模型预设的 API Key',
                                  'Enter the API key for this preset',
                                )}
                              />
                            </div>
                          </div>

                            {!preset.baseUrl.trim() ||
                            !preset.model.trim() ||
                            !preset.apiKey.trim() ? (
                              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                                {l(
                                  'Base URL、模型名称和 API Key 需要同时填写，才能用于测试与调用。',
                                  'Fill in the Base URL, model name, and API key before testing or using this preset.',
                                )}
                              </div>
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
                                {presetTestResultMap[preset.id]?.ok
                                  ? l('连接成功', 'Connection Succeeded')
                                  : l('连接失败', 'Connection Failed')}
                                {presetTestResultMap[preset.id]?.latencyMs
                                  ? ` · ${presetTestResultMap[preset.id]!.latencyMs} ms`
                                  : ''}
                              </div>
                              <div className="mt-1 break-all">
                                {l('地址', 'Endpoint')}:{' '}
                                {presetTestResultMap[preset.id]?.endpoint ||
                                  l('未返回', 'Unavailable')}
                              </div>
                              <div className="mt-1 break-all">
                                {l('模型', 'Model')}:{' '}
                                {presetTestResultMap[preset.id]?.responseModel ||
                                  presetTestResultMap[preset.id]?.model ||
                                  l('未返回', 'Unavailable')}
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
                        {l('新增模型预设', 'Add Model Preset')}
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={l('功能角色绑定', 'Feature Role Binding')}
                    description={l(
                      '为文档翻译、划词翻译、概览与问答分别选择默认模型。',
                      'Choose default presets for document translation, selection translation, overview, and QA.',
                    )}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          {l('文档翻译', 'Document Translation')}
                        </div>
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
                        <div className="text-xs font-medium text-slate-500">
                          {l('划词翻译', 'Selection Translation')}
                        </div>
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
                        <div className="text-xs font-medium text-slate-500">
                          {l('论文概览', 'Paper Overview')}
                        </div>
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
                        <div className="text-xs font-medium text-slate-500">
                          {l('问答默认模型', 'Default QA Model')}
                        </div>
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
                          label: 'Overview / Preview',
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
                            {llmTestResult!.latencyMs ? ` · ${llmTestResult!.latencyMs} ms` : ''}
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
                <>
                  <SettingsField
                    label={l('翻译体验', 'Translation Experience')}
                    description={l(
                      '配置语言方向、自动划词翻译和文档级翻译操作。',
                      'Configure language direction, auto selection translation, and document-level translation actions.',
                    )}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          {l('源语言', 'Source Language')}
                        </div>
                        <SettingsSelect
                          value={settings.translationSourceLanguage}
                          onChange={(event) =>
                            onSettingChange('translationSourceLanguage', event.target.value)
                          }
                        >
                          {languageOptions.map((language) => (
                            <option key={language.value} value={language.value}>
                              {language.label}
                            </option>
                          ))}
                        </SettingsSelect>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          {l('目标语言', 'Target Language')}
                        </div>
                        <SettingsSelect
                          value={settings.translationTargetLanguage}
                          onChange={(event) =>
                            onSettingChange('translationTargetLanguage', event.target.value)
                          }
                        >
                          {languageOptions
                            .filter((language) => language.value !== 'auto')
                            .map((language) => (
                              <option key={language.value} value={language.value}>
                                {language.label}
                              </option>
                            ))}
                        </SettingsSelect>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
                      {l(
                        '整篇翻译会按结构块分批调用模型，并将结果缓存到当前文档会话中。',
                        'Full-document translation is executed in batches by structured blocks and cached in the current document session.',
                      )}
                    </div>

                    <ToggleRow
                      title={l('自动翻译划词', 'Auto Translate Selection')}
                      description={l(
                        '选中文本后自动请求翻译，无需手动点击翻译按钮。',
                        'Automatically translate selected text without requiring a manual click.',
                      )}
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
                        {translating
                          ? l('翻译中...', 'Translating...')
                          : l('开始整篇翻译', 'Translate Document')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onClearTranslations?.()}
                        disabled={!canClearTranslations}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {l('清空翻译缓存', 'Clear Translation Cache')}
                      </button>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={l('翻译吞吐配置', 'Translation Throughput')}
                    description={l(
                      '控制整篇翻译时每批块数与并发数。',
                      'Control batch size and concurrency for full-document translation.',
                    )}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">
                          {l('每批块数', 'Blocks Per Batch')}
                        </div>
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
                        <div className="text-xs font-medium text-slate-500">
                          {l('并发数', 'Concurrency')}
                        </div>
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
                </>
              ) : null}

              {activeSection === 'summaryQa' ? (
                <>
                  <SettingsField
                    label={l('概览输入来源', 'Overview Input Source')}
                    description={l(
                      '决定概览生成优先读取 PDF 文本还是 MinerU Markdown。',
                      'Decide whether overview generation should prefer PDF text or MinerU Markdown.',
                    )}
                  >
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                        {l('当前概览模型', 'Current Overview Preset')}
                      </div>
                      <div className="mt-2 text-sm font-medium text-slate-900">
                        {activeSummaryPreset?.label ||
                          activeSummaryPreset?.model ||
                          l('未选择', 'Unselected')}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {activeSummaryPreset?.baseUrl || l('未配置 Base URL', 'Base URL not configured')}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium text-slate-500">
                        {l('概览输入模式', 'Overview Source Mode')}
                      </div>
                      <div className="grid gap-2">
                        {summarySourceOptions.map((option) => (
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
                    label={l('概览输出语言', 'Overview Output Language')}
                    description={l(
                      '控制 AI 概览的生成语言；切换后会使用新的缓存 key，不会混用旧语言结果。',
                      'Choose the language used for AI overviews. Changing it uses a separate cache key.',
                    )}
                  >
                    <div className="grid gap-3">
                      <SettingsSelect
                        value={
                          summaryLanguageOptions.some((option) => option.value === settings.summaryOutputLanguage)
                            ? settings.summaryOutputLanguage
                            : 'custom'
                        }
                        onChange={(event) => {
                          if (event.target.value === 'custom') {
                            return;
                          }

                          onSettingChange('summaryOutputLanguage', event.target.value);
                        }}
                      >
                        {summaryLanguageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        <option value="custom">{l('自定义语言', 'Custom Language')}</option>
                      </SettingsSelect>

                      <SettingsInput
                        value={
                          settings.summaryOutputLanguage === 'follow-ui'
                            ? ''
                            : settings.summaryOutputLanguage
                        }
                        placeholder={l(
                          `例如：Chinese / English / Japanese；留空则${resolvedSummaryLanguage}`,
                          `e.g. Chinese / English / Japanese; leave empty for ${resolvedSummaryLanguage}`,
                        )}
                        onChange={(event) =>
                          onSettingChange(
                            'summaryOutputLanguage',
                            event.target.value.trimStart() || 'follow-ui',
                          )
                        }
                      />
                      <div className="text-xs text-slate-500 dark:text-chrome-300">
                        {l(
                          `当前实际输出语言：${resolvedSummaryLanguage}`,
                          `Effective output language: ${resolvedSummaryLanguage}`,
                        )}
                      </div>
                    </div>
                  </SettingsField>

                  <SettingsField
                    label={l('问答上下文来源', 'QA Context Source')}
                    description={l(
                      '控制问答时优先使用 MinerU Markdown 还是 PDF 文本。',
                      'Choose whether QA should prefer MinerU Markdown or extracted PDF text.',
                    )}
                  >
                    <div className="grid gap-2">
                      {qaSourceOptions.map((option) => (
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
                    label={l('批量概览生成', 'Batch Overview Generation')}
                    description={l(
                      '为文库中已解析的论文批量生成概览。',
                      'Generate overviews in batch for parsed papers in the library.',
                    )}
                  >
                    <div className="space-y-3">
                      <ToggleRow
                        title={l('自动生成概览', 'Auto Generate Overview')}
                        description={l(
                          '检测到结构化内容后自动生成概览预览。',
                          'Automatically generate an overview preview once structured content is available.',
                        )}
                        checked={settings.autoGenerateSummary}
                        onChange={(checked) => onSettingChange('autoGenerateSummary', checked)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={onBatchGenerateSummaries}
                          disabled={batchSummaryRunning}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                        >
                          {batchSummaryRunning
                            ? l('处理中...', 'Processing...')
                            : l('全部生成概览', 'Generate All Overviews')}
                        </button>
                        {batchSummaryRunning ? (
                          <button
                            type="button"
                            onClick={onToggleBatchSummaryPause}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            {batchSummaryPaused ? l('继续', 'Resume') : l('暂停', 'Pause')}
                          </button>
                        ) : null}
                        {batchSummaryRunning ? (
                          <button
                            type="button"
                            onClick={onCancelBatchSummary}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600 transition hover:bg-rose-100"
                          >
                            {l('取消', 'Cancel')}
                          </button>
                        ) : null}
                      </div>
                      <BatchProgressCard
                        title={l('批量概览生成进度', 'Batch Overview Progress')}
                        progress={batchSummaryProgress}
                        tone="emerald"
                      />
                    </div>
                  </SettingsField>
                </>
              ) : null}
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
  const batchMineruPausedRef = useRef(false);
  const batchSummaryPausedRef = useRef(false);
  const batchMineruCancelRequestedRef = useRef(false);
  const batchSummaryCancelRequestedRef = useRef(false);

  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTab = useTabsStore((state) => state.openTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setHomeTabTitle = useTabsStore((state) => state.setHomeTabTitle);

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [readerSecrets, setReaderSecrets] = useState<ReaderSecrets>(loadSecrets);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferredPreferencesSection, setPreferredPreferencesSection] = useState<PreferencesSectionKey | undefined>(undefined);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const [onboardingDemoReveal, setOnboardingDemoReveal] = useState<OnboardingDemoRevealState>(
    EMPTY_ONBOARDING_DEMO_REVEAL,
  );
  const onboardingPreviousThemeModeRef = useRef<'light' | 'dark' | 'system' | null>(null);
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
  const [nativeLibraryItems, setNativeLibraryItems] = useState<WorkspaceItem[]>([]);
  const [selectedSectionKey, setSelectedSectionKey] = useState<LibrarySectionKey>('recent');
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryDisplayMode, setLibraryDisplayMode] = useState<'list' | 'card'>('list');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoadingSection, setLibraryLoadingSection] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [readerBridges, setReaderBridges] = useState<Record<string, ReaderTabBridgeState>>({});
  const savedNativeSummaryKeysRef = useRef<Set<string>>(new Set());
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const [libraryPreviewStates, setLibraryPreviewStates] = useState<
    Record<string, LibraryPreviewState>
  >({});
  const [itemParseStatusMap, setItemParseStatusMap] = useState<Record<string, boolean | undefined>>(
    {},
  );
  const [pendingCloudParseTabId, setPendingCloudParseTabId] = useState<string | null>(null);
  const [pendingTranslateTabId, setPendingTranslateTabId] = useState<string | null>(null);
  const [pendingSummaryTabId, setPendingSummaryTabId] = useState<string | null>(null);
  const [batchMineruRunning, setBatchMineruRunning] = useState(false);
  const [batchSummaryRunning, setBatchSummaryRunning] = useState(false);
  const [batchMineruPaused, setBatchMineruPaused] = useState(false);
  const [batchSummaryPaused, setBatchSummaryPaused] = useState(false);
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
  const l = useCallback(
    <T,>(zh: T, en: T) => pickLocaleText(settings.uiLanguage, zh, en),
    [settings.uiLanguage],
  );
  useEffect(() => {
    setHomeTabTitle(getHomeTabTitle(settings.uiLanguage));
  }, [setHomeTabTitle, settings.uiLanguage]);
  const notLoadedText = l('未加载', 'Not Loaded');
  const noPdfLoadedText = l('未加载 PDF', 'No PDF Loaded');
  const noJsonLoadedText = l('未加载 JSON', 'No JSON Loaded');
  const noSelectionText = l('未选择', 'Unselected');
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
          try {
            const legacyConfigText = await readLocalTextFile(
              buildLegacyConfigPath(defaultPaths.executableDir),
            );
            const parsedLegacyConfig = JSON.parse(legacyConfigText) as Partial<ReaderConfigFile>;

            nextConfig = mergeReaderConfigWithDefaults(
              parsedLegacyConfig,
              loadSettings(),
              loadSecrets(),
              defaultPaths,
            );
          } catch {
          }
        }
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
    setPreferredPreferencesSection(undefined);
    setPreferencesOpen(true);
  }, []);

  const markOnboardingSeen = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, 'true');
    } catch {
    }
  }, []);

  const handleOpenOnboarding = useCallback(() => {
    if (!onboardingOpen) {
      onboardingPreviousThemeModeRef.current = themeMode;
    }
    setThemeMode('light');
    setPreferencesOpen(false);
    setActiveTab(HOME_TAB_ID);
    setOnboardingStepIndex(0);
    setOnboardingDemoReveal(EMPTY_ONBOARDING_DEMO_REVEAL);
    setLibraryPreviewStates((current) => {
      const next = { ...current };
      delete next[ONBOARDING_WELCOME_ITEM.workspaceId];
      return next;
    });
    setItemParseStatusMap((current) => ({
      ...current,
      [ONBOARDING_WELCOME_ITEM.workspaceId]: false,
    }));
    setOnboardingOpen(true);
  }, [onboardingOpen, setActiveTab, setThemeMode, themeMode]);

  const handleCloseOnboarding = useCallback(() => {
    markOnboardingSeen();
    setOnboardingOpen(false);
    const previousThemeMode = onboardingPreviousThemeModeRef.current;
    onboardingPreviousThemeModeRef.current = null;
    if (previousThemeMode && previousThemeMode !== 'light') {
      setThemeMode(previousThemeMode);
    }
  }, [markOnboardingSeen, setThemeMode]);

  const handleFinishOnboarding = useCallback(() => {
    setStandaloneItems((current) => {
      const existingItems = current.filter(
        (item) => item.workspaceId !== WELCOME_STANDALONE_ITEM.workspaceId,
      );

      return [WELCOME_STANDALONE_ITEM, ...existingItems];
    });
    setSelectedSectionKey('standalone');
    setSelectedLibraryItemId(WELCOME_STANDALONE_ITEM.workspaceId);
    handleCloseOnboarding();
  }, [handleCloseOnboarding]);

  const handleOnboardingStepChange = useCallback((nextStepIndex: number) => {
    setOnboardingStepIndex(nextStepIndex);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === 'true') {
        return;
      }
    } catch {
    }

    onboardingPreviousThemeModeRef.current = themeMode;
    setThemeMode('light');
    setOnboardingOpen(true);
  }, [setThemeMode, themeMode]);

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
      return l('最近', 'Recent');
    }

    if (selectedSectionKey === 'all') {
      return l('全部 PDF', 'All PDFs');
    }

    if (selectedSectionKey === 'standalone') {
      return l('独立 PDF', 'Standalone PDFs');
    }

    const collectionKey = selectedSectionKey.slice('collection:'.length);

    return collectionNameMap.get(collectionKey) ?? l('未命名分类', 'Untitled Collection');
  }, [collectionNameMap, l, selectedSectionKey]);

  const currentSectionItems = useMemo(() => {
    if (onboardingOpen) {
      return [ONBOARDING_WELCOME_ITEM];
    }

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
  }, [collectionItemsCache, onboardingOpen, selectedSectionKey, standaloneItems, zoteroAllItems]);

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

    if (onboardingOpen) {
      applyItems([ONBOARDING_WELCOME_ITEM]);
    } else {
      applyItems(zoteroAllItems);
      applyItems(standaloneItems);
      applyItems(nativeLibraryItems);
      Object.values(collectionItemsCache).forEach(applyItems);
    }

    return itemMap;
  }, [collectionItemsCache, nativeLibraryItems, onboardingOpen, standaloneItems, zoteroAllItems]);

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

  const onboardingDemoItem = onboardingOpen
    ? ONBOARDING_WELCOME_ITEM
    : selectedLibraryItem ?? visibleItems[0] ?? allKnownItems[0] ?? null;
  const onboardingDemoTabId = onboardingDemoItem
    ? readerTabs.find((tab) => tab.documentId === onboardingDemoItem.workspaceId)?.id ?? null
    : null;
  const onboardingWorkspaceStage = onboardingOpen
    ? onboardingStepIndex === 11
      ? 'overview'
      : onboardingStepIndex >= 7 && onboardingStepIndex <= 10
        ? 'reading'
        : null
    : null;
  const onboardingDemoItemId = onboardingDemoItem?.workspaceId ?? null;
  const onboardingDemoItemTitle = onboardingDemoItem?.title ?? '';
  const onboardingExistingTabId = onboardingDemoItemId
    ? readerTabs.find((tab) => tab.documentId === onboardingDemoItemId)?.id ?? null
    : null;
  const selectedItemIsOnboardingWelcome = isOnboardingWelcomeItem(selectedLibraryItem);
  const displayedLibraryPreviewState = selectedItemIsOnboardingWelcome && onboardingOpen
    ? {
        ...activeLibraryPreviewState,
        summary: onboardingDemoReveal.summarized ? activeLibraryPreviewState.summary : null,
        hasBlocks: onboardingDemoReveal.parsed && activeLibraryPreviewState.hasBlocks,
        blockCount: onboardingDemoReveal.parsed ? activeLibraryPreviewState.blockCount : 0,
        currentPdfName: activeLibraryPreviewState.currentPdfName || 'welcome.pdf',
        currentJsonName: onboardingDemoReveal.parsed
          ? activeLibraryPreviewState.currentJsonName || 'content_list_v2.json'
          : l('尚未解析', 'Not parsed yet'),
        statusMessage: onboardingDemoReveal.parsed
          ? onboardingDemoReveal.translated
            ? l(
                'Welcome 演示文档已显示内置解析和全文翻译结果，可以继续查看概览或进入阅读器。',
                'The Welcome demo now shows the built-in parse and full-translation results. Continue to the overview or open the reader.',
              )
            : activeLibraryPreviewState.statusMessage ||
              l(
                '已显示内置 MinerU 解析结果。下一步可以点击全文翻译显示内置译文。',
                'The built-in MinerU parse result is visible. Next, click Translate Document to reveal the bundled translation.',
              )
          : l(
              '这是新手引导内置的 Welcome 文档。请按引导先点击 MinerU 解析，解析结果会立即显示，不会调用 API。',
              'This is the built-in Welcome document for onboarding. Follow the guide and click MinerU Parse first; the result appears instantly without calling any API.',
            ),
        loading: false,
        error: '',
      }
    : activeLibraryPreviewState;

  useEffect(() => {
    if (!onboardingOpen) {
      return;
    }

    if (selectedLibraryItemId !== ONBOARDING_WELCOME_ITEM.workspaceId) {
      setSelectedLibraryItemId(ONBOARDING_WELCOME_ITEM.workspaceId);
    }

    if (onboardingStepIndex === 0) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
      return;
    }

    if (onboardingStepIndex === 1) {
      setActiveTab(HOME_TAB_ID);
      setPreferredPreferencesSection('library');
      setPreferencesOpen(true);
      return;
    }

    if (onboardingStepIndex >= 2 && onboardingStepIndex <= 6) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
      if (onboardingStepIndex >= 3 && !selectedLibraryItemId && onboardingDemoItemId) {
        setSelectedLibraryItemId(onboardingDemoItemId);
      }
      return;
    }

    if (onboardingStepIndex >= 7 && onboardingStepIndex <= 10) {
      setPreferencesOpen(false);
      if (!onboardingDemoItemId) {
        setActiveTab(HOME_TAB_ID);
        return;
      }

      if (selectedLibraryItemId !== onboardingDemoItemId) {
        setSelectedLibraryItemId(onboardingDemoItemId);
      }

      const nextTabId = onboardingExistingTabId ?? openTab(onboardingDemoItemId, onboardingDemoItemTitle);
      setActiveTab(nextTabId);
      return;
    }

    if (onboardingStepIndex >= 11) {
      setPreferencesOpen(false);
      setActiveTab(HOME_TAB_ID);
    }
  }, [
    onboardingDemoItemId,
    onboardingDemoItemTitle,
    onboardingExistingTabId,
    onboardingOpen,
    onboardingStepIndex,
    openTab,
    selectedLibraryItemId,
    setActiveTab,
  ]);

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

  const persistNativeLibraryOverview = useCallback(
    async (item: WorkspaceItem, summary: PaperSummary, sourceKey: string) => {
      if (item.source !== 'native-library') {
        return;
      }

      const summaryText = formatPaperSummaryForLibrary(summary);

      if (!summaryText) {
        return;
      }

      const saveKey = `${item.itemKey}::${sourceKey || 'overview'}::${textSignature(summaryText)}`;

      if (savedNativeSummaryKeysRef.current.has(saveKey)) {
        return;
      }

      savedNativeSummaryKeysRef.current.add(saveKey);
      const updatedPaper = await updateLibraryPaper({
        paperId: item.itemKey,
        aiSummary: summaryText,
      });

      window.dispatchEvent(
        new CustomEvent('paperquay:native-summary-updated', {
          detail: {
            paperId: updatedPaper.id,
            aiSummary: updatedPaper.aiSummary,
          },
        }),
      );
    },
    [],
  );

  const handleLibraryPreviewSync = useCallback((payload: LibraryPreviewSyncPayload) => {
    const isWelcomeDemoPayload = isOnboardingWelcomeItem(payload.item);

    if (payload.summary) {
      void persistNativeLibraryOverview(
        payload.item,
        payload.summary,
        payload.sourceKey ?? 'overview',
      ).catch(() => undefined);
    }

    if (payload.item.source === 'native-library' && payload.hasBlocks) {
      window.dispatchEvent(
        new CustomEvent('paperquay:native-mineru-status-updated', {
          detail: {
            paperId: payload.item.itemKey,
            mineruParsed: true,
          },
        }),
      );
    }

    setItemParseStatusMap((current) => ({
      ...current,
      [payload.item.workspaceId]: isWelcomeDemoPayload && onboardingOpen
        ? onboardingDemoReveal.parsed
        : payload.hasBlocks,
    }));

    setLibraryPreviewStates((current) => {
      const existingState = current[payload.item.workspaceId];
      const hasSummary = Object.prototype.hasOwnProperty.call(payload, 'summary');
      const hasLoading = Object.prototype.hasOwnProperty.call(payload, 'loading');
      const hasError = Object.prototype.hasOwnProperty.call(payload, 'error');

      return {
        ...current,
        [payload.item.workspaceId]: {
          summary: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.summarized
            ? null
            : hasSummary ? payload.summary ?? null : existingState?.summary ?? null,
          loading: hasLoading ? Boolean(payload.loading) : false,
          error: hasError ? payload.error ?? '' : '',
          hasBlocks: isWelcomeDemoPayload && onboardingOpen
            ? onboardingDemoReveal.parsed && payload.hasBlocks
            : payload.hasBlocks,
          blockCount: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? 0
            : payload.blockCount,
          currentPdfName: payload.currentPdfName,
          currentJsonName: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? l('尚未解析', 'Not parsed yet')
            : payload.currentJsonName,
          statusMessage: isWelcomeDemoPayload && onboardingOpen && !onboardingDemoReveal.parsed
            ? l(
                '请按新手引导点击 MinerU 解析，内置结构块会在这里显示。',
                'Follow the onboarding guide and click MinerU Parse to reveal the bundled structure blocks here.',
              )
            : payload.statusMessage,
          sourceKey: payload.sourceKey,
        },
      };
    });
  }, [
    l,
    onboardingDemoReveal.parsed,
    onboardingDemoReveal.summarized,
    onboardingOpen,
    persistNativeLibraryOverview,
  ]);

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
        : noPdfLoadedText;

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
    [noPdfLoadedText],
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
            setStatusMessage(l('未找到 Zotero 本地目录', 'No Zotero local directory found'));
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
      setStatusMessage(
        l(
          `已加载 Zotero 本地文库，共发现 ${items.length} 篇 PDF 记录`,
          `Loaded the local Zotero library with ${items.length} PDF records`,
        ),
      );
    } catch (nextError) {
      if (!silent) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : l('读取 Zotero 文库失败', 'Failed to load the Zotero library'),
        );
      }

      setStatusMessage(l('读取 Zotero 文库失败', 'Failed to load the Zotero library'));
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
      setStatusMessage(
        l(
          `已加载分类：${collectionNameMap.get(collectionKey) ?? l('未命名分类', 'Untitled Collection')}`,
          `Loaded collection: ${
            collectionNameMap.get(collectionKey) ?? l('Untitled Collection', 'Untitled Collection')
          }`,
        ),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : l('读取分类文献失败', 'Failed to load collection items'),
      );
      setStatusMessage(l('读取分类文献失败', 'Failed to load collection items'));
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
        setStatusMessage(l('未找到 Zotero 本地目录', 'No Zotero local directory found'));
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
        setStatusMessage(l('未选择 Zotero 目录', 'No Zotero directory selected'));
        return;
      }

      await loadLocalLibrary(dataDir);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : l('选择 Zotero 目录失败', 'Failed to choose the Zotero directory'),
      );
      setStatusMessage(l('选择 Zotero 目录失败', 'Failed to choose the Zotero directory'));
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
    const pdfName = item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText;

    if (isOnboardingWelcomeItem(item)) {
      const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/content_list_v2.json`);
      const jsonText = await response.text();
      const pages = parseMineruPages(jsonText);
      const blocks = flattenMineruPages(pages);

      return {
        blocks,
        currentPdfName: 'welcome.pdf',
        currentJsonName: 'content_list_v2.json',
        statusMessage: l(
          `已加载 Welcome 内置解析结果：${blocks.length} 个结构块`,
          `Loaded built-in Welcome parse result: ${blocks.length} structured blocks`,
        ),
      };
    }

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
            statusMessage: l(
              `已从缓存加载 ${blocks.length} 个结构块`,
              `Loaded ${blocks.length} structured blocks from cache`,
            ),
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
          statusMessage: l(
            `已从同目录 JSON 加载 ${blocks.length} 个结构块`,
            `Loaded ${blocks.length} structured blocks from the sibling JSON`,
          ),
        };
      } catch {
        return {
          blocks: [],
          currentPdfName: pdfName,
          currentJsonName: noJsonLoadedText,
          statusMessage: l(
            '未找到同目录 JSON，请手动选择 MinerU JSON。',
            'No sibling JSON was found. Please choose a MinerU JSON file manually.',
          ),
        };
      }
    }

    return {
      blocks: [],
      currentPdfName: pdfName,
      currentJsonName: settings.autoLoadSiblingJson ? notLoadedText : noJsonLoadedText,
      statusMessage: item.localPdfPath
        ? l(
            '尚未检测到结构化结果，请手动选择 JSON 或执行 MinerU 解析。',
            'No structured result detected yet. Choose a JSON file or run MinerU parsing.',
          )
        : l(
            '当前文献没有可用 PDF，因此暂时无法匹配对应的 JSON。',
            'This document has no available PDF, so a matching JSON cannot be resolved yet.',
          ),
    };
  };

  const buildLibraryPreviewSummaryInputs = (blocks: PositionedMineruBlock[]) =>
    buildSummaryBlockInputs(blocks);

  const resolveLibraryPreviewSummaryRequest = async (
    item: WorkspaceItem,
    blocks: PositionedMineruBlock[],
  ) => {
    const summaryInputs = buildLibraryPreviewSummaryInputs(blocks);
    const summaryLanguage = resolveSummaryOutputLanguage(settings);

    if (isOnboardingWelcomeItem(item)) {
      try {
        const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/full.md`);
        const documentText = response.ok ? await response.text() : buildMineruMarkdownDocument(blocks);

        return {
          summaryInputs,
          sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::welcome::${blocks.length}`,
          documentText,
          errorMessage: '',
        };
      } catch {
        return {
          summaryInputs,
          sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::welcome::${blocks.length}`,
          documentText: buildMineruMarkdownDocument(blocks),
          errorMessage: '',
        };
      }
    }

    if (settings.summarySourceMode === 'pdf-text') {
      const pdfPath = item.localPdfPath?.trim() ?? '';
      const sourceKey = `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::pdf-text::${pdfPath || 'no-pdf'}`;

      if (!pdfPath) {
        return {
          summaryInputs,
          sourceKey,
          documentText: '',
          errorMessage: l(
            '概览模式要求读取 PDF 文本，但当前文献没有可用 PDF。',
            'Overview mode requires PDF text, but no PDF is available for the current document.',
          ),
        };
      }

      const pdfData = await readLocalBinaryFile(pdfPath);
      const documentText = await extractPdfTextByPdfJs(pdfData);

      if (!documentText.trim()) {
        return {
          summaryInputs,
          sourceKey: `${sourceKey}::${pdfData.byteLength}`,
          documentText: '',
          errorMessage: l(
            '未能从 PDF 中提取可用文本。',
            'Failed to extract usable text from the PDF.',
          ),
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
            sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::${candidatePath}::${blocks.length}`,
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
        sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::empty`,
        documentText: '',
        errorMessage: l(
          '未能生成可用的 MinerU Markdown 内容。',
          'Failed to generate usable MinerU Markdown content.',
        ),
      };
    }

    return {
      summaryInputs,
      sourceKey: `${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${summaryLanguage}::mineru-markdown::blocks::${blocks.length}`,
      documentText,
      errorMessage: '',
    };
  };

  const tryLoadSavedPreviewSummary = async (item: WorkspaceItem, sourceKey: string) => {
    if (isOnboardingWelcomeItem(item)) {
      try {
        const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`);
        const parsed = (await response.json()) as Partial<SummaryCacheEnvelope>;

        return parsed.summary ?? null;
      } catch {
        return null;
      }
    }

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

      if (cachedState.hasBlocks && !allowGenerate) {
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...cachedState,
            loading: false,
            error: '',
            statusMessage:
              cachedState.statusMessage ||
              l(
                '结构化内容已就绪，可以手动生成概览。',
                'Structured content is ready. You can generate the overview manually.',
              ),
          },
        }));
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
        currentPdfName: item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText,
        currentJsonName: current[item.workspaceId]?.currentJsonName ?? notLoadedText,
        statusMessage: l(
          '正在整理预览内容并生成 AI 概览...',
          'Preparing the preview and generating the AI overview...',
        ),
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
            statusMessage: l('已从阅读历史恢复概览', 'Overview restored from reading history'),
            sourceKey,
          },
        }));
        void persistNativeLibraryOverview(item, historySummary, sourceKey).catch(() => undefined);
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
            statusMessage: l('已加载缓存概览', 'Loaded the cached overview'),
            sourceKey,
          },
        }));
        void persistNativeLibraryOverview(item, cachedSummary, sourceKey).catch(() => undefined);
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
            statusMessage: l(
              '概览模型尚未配置完成，请检查 Base URL、模型名称和 API Key。',
              'The overview model is not configured yet. Check the Base URL, model name, and API key.',
            ),
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
              ? l(
                  '结构化内容已就绪，可以手动生成概览。',
                  'Structured content is ready. You can generate the overview manually.',
                )
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
        outputLanguage: resolveSummaryOutputLanguage(settings),
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
          statusMessage: l('AI 概览已生成', 'AI overview generated'),
          sourceKey,
        },
      }));
      void persistNativeLibraryOverview(item, summary, sourceKey).catch(() => undefined);
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
          error:
            nextError instanceof Error
              ? nextError.message
              : l('生成预览概览失败', 'Failed to generate the preview overview'),
          hasBlocks: current[item.workspaceId]?.hasBlocks ?? false,
          blockCount: current[item.workspaceId]?.blockCount ?? 0,
          currentPdfName:
            current[item.workspaceId]?.currentPdfName ??
            (item.localPdfPath ? getFileNameFromPath(item.localPdfPath) : noPdfLoadedText),
          currentJsonName: current[item.workspaceId]?.currentJsonName ?? notLoadedText,
          statusMessage: l('生成预览概览失败', 'Failed to generate the preview overview'),
          sourceKey: current[item.workspaceId]?.sourceKey ?? '',
        },
      }));
      return 'failed';
    }
  };

  const saveLibraryTranslationCache = useCallback(
    async (item: WorkspaceItem, translations: TranslationMap) => {
      if (!settings.mineruCacheDir.trim()) {
        return;
      }

      const cachePath = buildMineruTranslationCachePath(
        settings.mineruCacheDir.trim(),
        item,
        settings.translationTargetLanguage,
      );
      const payload: TranslationCacheEnvelope = {
        version: 1,
        sourceLanguage: settings.translationSourceLanguage,
        targetLanguage: settings.translationTargetLanguage,
        translatedAt: new Date().toISOString(),
        translations,
      };

      await writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2));
    },
    [
      settings.mineruCacheDir,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
    ],
  );

  const runLibraryItemMineruParse = useCallback(
    async (item: WorkspaceItem) => {
      const pdfPath = item.localPdfPath?.trim() ?? '';

      if (!pdfPath) {
        const message = l('这篇文献缺少可解析的 PDF 文件', 'This paper has no PDF file to parse');
        setError(message);
        setStatusMessage(message);
        return;
      }

      setError('');
      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: true,
          error: '',
          currentPdfName: getFileNameFromPath(pdfPath),
          statusMessage: l('正在执行 MinerU 解析...', 'Running MinerU parsing...'),
        },
      }));
      setStatusMessage(l(`正在解析：${item.title}`, `Parsing: ${item.title}`));

      try {
        const existingParse = await findExistingMineruJson(item);

        if (existingParse) {
          syncLibraryParsedState(
            item,
            existingParse.jsonText,
            existingParse.path,
            l('已复用已有的 MinerU 结果', 'Reused the existing MinerU result'),
          );
          window.dispatchEvent(
            new CustomEvent('paperquay:native-mineru-status-updated', {
              detail: {
                paperId: item.itemKey,
                mineruParsed: true,
              },
            }),
          );
          setStatusMessage(l('已复用已有的 MinerU 解析结果', 'Reused the existing MinerU parse result'));
          return;
        }

        if (!mineruApiToken.trim()) {
          setPreferredPreferencesSection('mineru');
          setPreferencesOpen(true);
          throw new Error(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
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
          throw new Error(l('MinerU 未返回可用的 JSON 结果', 'MinerU did not return a usable JSON result'));
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

        syncLibraryParsedState(
          item,
          jsonText,
          resolvedJsonPath,
          savedPaths
            ? l(
                `已完成 MinerU 解析并写入缓存：${savedPaths.directory}`,
                `MinerU parsing finished and was cached in: ${savedPaths.directory}`,
              )
            : l('已完成 MinerU 解析', 'MinerU parsing finished'),
        );
        window.dispatchEvent(
          new CustomEvent('paperquay:native-mineru-status-updated', {
            detail: {
              paperId: item.itemKey,
              mineruParsed: true,
            },
          }),
        );
        setStatusMessage(l('MinerU 解析已完成', 'MinerU parsing finished'));
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : l('MinerU 解析失败', 'MinerU parsing failed');
        setError(message);
        setStatusMessage(message);
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error: message,
            statusMessage: message,
          },
        }));
      }
    },
    [
      findExistingMineruJson,
      l,
      mineruApiToken,
      saveLibraryMineruParseCache,
      settings.mineruCacheDir,
      syncLibraryParsedState,
    ],
  );

  const runLibraryItemTranslation = useCallback(
    async (item: WorkspaceItem) => {
      if (!translationModelPreset?.apiKey.trim() || !translationModelPreset.baseUrl.trim()) {
        setPreferredPreferencesSection('models');
        setPreferencesOpen(true);
        const message = l('请先配置可用的翻译模型', 'Configure an available translation model first');
        setError(message);
        setStatusMessage(message);
        return;
      }

      setError('');
      setLibraryPreviewStates((current) => ({
        ...current,
        [item.workspaceId]: {
          ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: true,
          error: '',
          statusMessage: l('正在准备全文翻译...', 'Preparing full-document translation...'),
        },
      }));
      setStatusMessage(l(`正在准备翻译：${item.title}`, `Preparing translation: ${item.title}`));

      try {
        const previewContext = await loadLibraryPreviewBlocks(item);
        const blocksToTranslate = previewContext.blocks
          .map((block) => ({
            blockId: block.blockId,
            text: extractTextFromMineruBlock(block),
          }))
          .filter((block) => block.text.trim().length > 0);

        if (blocksToTranslate.length === 0) {
          throw new Error(l('当前没有可翻译的结构化文本，请先执行 MinerU 解析。', 'There is no structured text to translate. Run MinerU parsing first.'));
        }

        const batchSize = Math.max(1, settings.translationBatchSize);
        const concurrency = Math.max(1, settings.translationConcurrency);
        const batches = chunkItems(blocksToTranslate, batchSize);
        const collectedTranslations = new Map<string, string>();
        let completedBlocks = 0;
        let cursor = 0;

        const runWorker = async () => {
          while (true) {
            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= batches.length) {
              return;
            }

            const batch = batches[currentIndex];
            const translations = await translateBlocksOpenAICompatible({
              baseUrl: translationModelPreset.baseUrl,
              apiKey: translationModelPreset.apiKey.trim(),
              model: translationModelPreset.model,
              sourceLanguage: settings.translationSourceLanguage,
              targetLanguage: settings.translationTargetLanguage,
              blocks: batch,
              batchSize: batch.length,
              concurrency: 1,
            });

            for (const translation of translations) {
              if (translation.translatedText.trim()) {
                collectedTranslations.set(translation.blockId, translation.translatedText);
              }
            }

            completedBlocks = Math.min(blocksToTranslate.length, completedBlocks + batch.length);
            setStatusMessage(
              l(
                `正在翻译 ${completedBlocks}/${blocksToTranslate.length} 个块`,
                `Translating ${completedBlocks}/${blocksToTranslate.length} blocks`,
              ),
            );
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(concurrency, batches.length) }, () => runWorker()),
        );

        const translations: TranslationMap = {};

        for (const [blockId, translatedText] of collectedTranslations.entries()) {
          translations[blockId] = translatedText;
        }

        await saveLibraryTranslationCache(item, translations).catch(() => undefined);
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error: '',
            hasBlocks: previewContext.blocks.length > 0,
            blockCount: previewContext.blocks.length,
            currentPdfName: previewContext.currentPdfName,
            currentJsonName: previewContext.currentJsonName,
            statusMessage: l(
              `全文翻译完成，已生成 ${Object.keys(translations).length} 段译文`,
              `Full translation complete. Generated ${Object.keys(translations).length} translated blocks`,
            ),
          },
        }));
        setStatusMessage(
          l(
            `全文翻译完成：${Object.keys(translations).length} 段`,
            `Full translation complete: ${Object.keys(translations).length} blocks`,
          ),
        );
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : l('全文翻译失败', 'Full translation failed');
        setError(message);
        setStatusMessage(message);
        setLibraryPreviewStates((current) => ({
          ...current,
          [item.workspaceId]: {
            ...(current[item.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
            loading: false,
            error: message,
            statusMessage: message,
          },
        }));
      }
    },
    [
      l,
      loadLibraryPreviewBlocks,
      saveLibraryTranslationCache,
      settings.translationBatchSize,
      settings.translationConcurrency,
      settings.translationSourceLanguage,
      settings.translationTargetLanguage,
      translationModelPreset,
    ],
  );

  const handleBatchMineruParse = useCallback(
    async (options?: { auto?: boolean }) => {
      const auto = options?.auto ?? false;

      if (batchMineruRunningRef.current) {
        return;
      }

      if (!mineruApiToken.trim()) {
        if (!auto) {
          setPreferencesOpen(true);
          setError(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
          setStatusMessage(l('缺少 MinerU API Token', 'MinerU API Token is missing'));
        }
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage(l('当前没有可解析的文献', 'No documents are available for parsing'));
        }
        return;
      }

      const candidates = allKnownItems.filter((item) => {
        const attemptKey = getAutoParseAttemptKey(item);
        return !(auto && autoMineruAttemptedRef.current.has(attemptKey));
      });

      if (candidates.length === 0) {
        if (!auto) {
          setStatusMessage(l('当前没有需要执行解析的文献', 'No documents require parsing right now'));
        }
        return;
      }

      const concurrency = clampBatchConcurrency(settings.libraryBatchConcurrency);

      batchMineruRunningRef.current = true;
      batchMineruPausedRef.current = false;
      batchMineruCancelRequestedRef.current = false;
      setBatchMineruRunning(true);
      setBatchMineruPaused(false);
      setBatchMineruProgress({
        running: true,
        paused: false,
        cancelRequested: false,
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

      const waitForResumeOrCancel = async () => {
        while (batchMineruPausedRef.current && !batchMineruCancelRequestedRef.current) {
          await sleep(120);
        }

        return batchMineruCancelRequestedRef.current;
      };

      const updateProgress = (currentLabel: string) => {
        setBatchMineruProgress({
          running: true,
          paused: batchMineruPausedRef.current,
          cancelRequested: batchMineruCancelRequestedRef.current,
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
            if (await waitForResumeOrCancel()) {
              return;
            }

            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length || batchMineruCancelRequestedRef.current) {
              return;
            }

            const item = candidates[currentIndex];
            const attemptKey = getAutoParseAttemptKey(item);
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${item.title}`;

            if (!auto) {
              setStatusMessage(
                l(
                  `批量 MinerU 解析中：${currentLabel}`,
                  `Running MinerU batch parsing: ${currentLabel}`,
                ),
              );
            }

            updateProgress(currentLabel);

            try {
              const existingParse = await findExistingMineruJson(item);

              if (existingParse) {
                syncLibraryParsedState(
                  item,
                  existingParse.jsonText,
                  existingParse.path,
                  l('已复用已有的 MinerU 结果', 'Reused the existing MinerU result'),
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
                throw new Error(
                  l(
                    'MinerU 未返回可用的 JSON 结果',
                    'MinerU did not return a usable JSON result',
                  ),
                );
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
                ? l(
                    `已完成 MinerU 解析并写入缓存：${savedPaths.directory}`,
                    `MinerU parsing finished and was cached in: ${savedPaths.directory}`,
                  )
                : l('已完成 MinerU 解析', 'MinerU parsing finished');

              syncLibraryParsedState(item, jsonText, resolvedJsonPath, status);
              parsedCount += 1;
              successCount += 1;
            } catch (nextError) {
              failedCount += 1;
              lastErrorMessage =
                nextError instanceof Error
                  ? nextError.message
                  : l('MinerU 解析失败', 'MinerU parsing failed');
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
        const wasCancelled = batchMineruCancelRequestedRef.current;
        batchMineruRunningRef.current = false;
        batchMineruPausedRef.current = false;
        setBatchMineruRunning(false);
        setBatchMineruPaused(false);
        setBatchMineruProgress({
          running: false,
          paused: false,
          cancelRequested: wasCancelled,
          total: candidates.length,
          completed: completedCount,
          succeeded: successCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            wasCancelled
              ? l(
                  `MinerU 批处理已取消，已完成 ${completedCount}/${candidates.length}`,
                  `MinerU batch cancelled after ${completedCount}/${candidates.length}`,
                )
              : candidates.length > 0
              ? l(
                  `批量解析进度 ${completedCount}/${candidates.length}`,
                  `Batch parse progress ${completedCount}/${candidates.length}`,
                )
              : '',
        });
      }

      if (!auto) {
        if (lastErrorMessage && !batchMineruCancelRequestedRef.current) {
          setError(lastErrorMessage);
        }

        setStatusMessage(
          batchMineruCancelRequestedRef.current
            ? l(
                `MinerU 批处理已取消：新增 ${parsedCount}，复用 ${existingCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `MinerU batch cancelled: parsed ${parsedCount}, reused ${existingCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : l(
                `MinerU 批处理完成：新增 ${parsedCount}，复用 ${existingCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `MinerU batch finished: parsed ${parsedCount}, reused ${existingCount}, skipped ${skippedCount}, failed ${failedCount}`,
              ),
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
          setError(l('缺少概览模型配置', 'Overview model configuration is missing'));
          setStatusMessage(l('缺少概览模型配置', 'Overview model configuration is missing'));
        }
        return;
      }

      if (allKnownItems.length === 0) {
        if (!auto) {
          setStatusMessage(l('当前没有可生成概览的文献', 'No documents are available for overview generation'));
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
            resolveSummaryOutputLanguage(settings),
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
          setStatusMessage(l('当前没有需要生成概览的文献', 'No documents require overview generation right now'));
        }
        return;
      }

      batchSummaryRunningRef.current = true;
      batchSummaryPausedRef.current = false;
      batchSummaryCancelRequestedRef.current = false;
      setBatchSummaryRunning(true);
      setBatchSummaryPaused(false);
      setBatchSummaryProgress({
        running: true,
        paused: false,
        cancelRequested: false,
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

      const waitForResumeOrCancel = async () => {
        while (batchSummaryPausedRef.current && !batchSummaryCancelRequestedRef.current) {
          await sleep(120);
        }

        return batchSummaryCancelRequestedRef.current;
      };

      const updateProgress = (currentLabel: string) => {
        setBatchSummaryProgress({
          running: true,
          paused: batchSummaryPausedRef.current,
          cancelRequested: batchSummaryCancelRequestedRef.current,
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
            if (await waitForResumeOrCancel()) {
              return;
            }

            const currentIndex = cursor;
            cursor += 1;

            if (currentIndex >= candidates.length || batchSummaryCancelRequestedRef.current) {
              return;
            }

            const candidate = candidates[currentIndex];
            const currentLabel = `${currentIndex + 1}/${candidates.length} ${candidate.item.title}`;

            if (!auto) {
              setStatusMessage(
                l(
                  `正在批量生成概览：${currentLabel}`,
                  `Generating overviews in batch: ${currentLabel}`,
                ),
              );
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
        const wasCancelled = batchSummaryCancelRequestedRef.current;
        batchSummaryRunningRef.current = false;
        batchSummaryPausedRef.current = false;
        setBatchSummaryRunning(false);
        setBatchSummaryPaused(false);
        setBatchSummaryProgress({
          running: false,
          paused: false,
          cancelRequested: wasCancelled,
          total: candidates.length,
          completed: completedCount,
          succeeded: succeededCount,
          skipped: skippedCount,
          failed: failedCount,
          currentLabel:
            wasCancelled
              ? l(
                  `批量概览已取消，已完成 ${completedCount}/${candidates.length}`,
                  `Batch overview cancelled after ${completedCount}/${candidates.length}`,
                )
              : candidates.length > 0
              ? l(
                  `批量概览进度 ${completedCount}/${candidates.length}`,
                  `Batch overview progress ${completedCount}/${candidates.length}`,
                )
              : '',
        });
      }

      if (!auto) {
        setStatusMessage(
          batchSummaryCancelRequestedRef.current
            ? l(
                `概览批处理已取消：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `Overview batch cancelled: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
              )
            : l(
                `概览批处理完成：成功 ${succeededCount}，跳过 ${skippedCount}，失败 ${failedCount}`,
                `Overview batch finished: succeeded ${succeededCount}, skipped ${skippedCount}, failed ${failedCount}`,
              ),
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
        setStatusMessage(l('未选择 PDF 文件', 'No PDF file selected'));
        return;
      }

      const standaloneItem = createStandaloneItem(source.path, settings.uiLanguage);

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
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('打开独立 PDF 失败', 'Failed to open the standalone PDF');
      setError(message);
      setStatusMessage(message);
    }
  };

  const registerNativeLibraryWorkspace = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = createNativeLibraryWorkspaceItem(paper);

      if (!workspaceItem) {
        const message = l('这篇文献缺少可打开的 PDF 附件', 'This paper has no openable PDF attachment');
        setError(message);
        setStatusMessage(message);
        return;
      }

      setNativeLibraryItems((current) => {
        const existingItems = current.filter((item) => item.workspaceId !== workspaceItem.workspaceId);
        return [workspaceItem, ...existingItems];
      });
      setSelectedLibraryItemId(workspaceItem.workspaceId);
      return workspaceItem;
    },
    [l],
  );

  const openNativeLibraryWorkspace = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = registerNativeLibraryWorkspace(paper);

      if (!workspaceItem) {
        return;
      }

      const tabId = openTab(workspaceItem.workspaceId, workspaceItem.title);

      return { workspaceItem, tabId };
    },
    [openTab, registerNativeLibraryWorkspace],
  );

  const handleOpenNativeLibraryPaper = useCallback(
    (paper: LiteraturePaper) => {
      openNativeLibraryWorkspace(paper);
    },
    [openNativeLibraryWorkspace],
  );

  const handleNativeLibraryMineruParse = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = registerNativeLibraryWorkspace(paper);

      if (!workspaceItem) {
        return;
      }

      void runLibraryItemMineruParse(workspaceItem);
    },
    [registerNativeLibraryWorkspace, runLibraryItemMineruParse],
  );

  const handleNativeLibraryTranslate = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = registerNativeLibraryWorkspace(paper);

      if (!workspaceItem) {
        return;
      }

      void runLibraryItemTranslation(workspaceItem);
    },
    [registerNativeLibraryWorkspace, runLibraryItemTranslation],
  );

  const handleNativeLibraryGenerateSummary = useCallback(
    (paper: LiteraturePaper) => {
      const workspaceItem = registerNativeLibraryWorkspace(paper);

      if (!workspaceItem) {
        return;
      }

      setStatusMessage(l(`正在生成概览：${workspaceItem.title}`, `Generating overview: ${workspaceItem.title}`));
      void generateLibraryPreview(workspaceItem, true, { allowGenerate: true });
    },
    [generateLibraryPreview, l, registerNativeLibraryWorkspace],
  );

  const handleLibraryItemClick = (item: WorkspaceItem) => {
    if (libraryItemClickTimerRef.current) {
      window.clearTimeout(libraryItemClickTimerRef.current);
    }

    libraryItemClickTimerRef.current = window.setTimeout(() => {
      libraryItemClickTimerRef.current = null;
      setSelectedLibraryItemId(item.workspaceId);
      setStatusMessage(l(`已选择文献：${item.title}`, `Selected document: ${item.title}`));
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
      const message =
        nextError instanceof Error ? nextError.message : l('关闭窗口失败', 'Failed to close the window');
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleSelectMineruCacheDir = async () => {
    try {
      const selectedDir = await selectDirectory(
        l('选择 MinerU 缓存目录', 'Select the MinerU cache directory'),
      );

      if (!selectedDir) {
        setStatusMessage(l('未选择 MinerU 缓存目录', 'No MinerU cache directory selected'));
        return;
      }

      setSettings((current) => ({
        ...current,
        mineruCacheDir: selectedDir,
      }));
      setStatusMessage(
        l(
          `已更新 MinerU 缓存目录：${truncateMiddle(selectedDir, 48)}`,
          `Updated the MinerU cache directory: ${truncateMiddle(selectedDir, 48)}`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l(
              '选择 MinerU 缓存目录失败',
              'Failed to select the MinerU cache directory',
            );
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleSelectRemotePdfDownloadDir = async () => {
    try {
      const selectedDir = await selectDirectory(
        l('选择远程 PDF 下载目录', 'Select the remote PDF download directory'),
      );

      if (!selectedDir) {
        setStatusMessage(
          l('未选择远程 PDF 下载目录', 'No remote PDF download directory selected'),
        );
        return;
      }

      setSettings((current) => ({
        ...current,
        remotePdfDownloadDir: selectedDir,
      }));
      setStatusMessage(
        l(
          `已更新远程 PDF 下载目录：${truncateMiddle(selectedDir, 48)}`,
          `Updated the remote PDF download directory: ${truncateMiddle(selectedDir, 48)}`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l(
              '选择远程 PDF 下载目录失败',
              'Failed to select the remote PDF download directory',
            );
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleTestLlmConnection = async (
    preset?: QaModelPreset,
  ): Promise<OpenAICompatibleTestResult> => {
    setError('');
    setStatusMessage(l('正在测试 AI 接口连接...', 'Testing the AI endpoint connection...'));

    try {
      const targetPreset = preset ?? translationModelPreset;

      if (!targetPreset) {
        throw new Error(
          l(
            '没有可用于测试的模型预设，请先完成模型配置。',
            'No model preset is available for testing. Configure a model first.',
          ),
        );
      }

      const result = await testOpenAICompatibleChat({
        baseUrl: targetPreset.baseUrl,
        apiKey: targetPreset.apiKey.trim(),
        model: targetPreset.model,
      });

      if (result.ok) {
        setError('');
        setStatusMessage(
          l(
            `AI 接口连接成功：${result.responseModel || result.model}`,
            `AI endpoint connected: ${result.responseModel || result.model}`,
          ),
        );
      } else {
        setError(result.message);
        setStatusMessage(
          l(`AI 接口连接失败：${result.message}`, `AI endpoint connection failed: ${result.message}`),
        );
      }

      return result;
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : l('测试 AI 接口失败', 'Failed to test the AI endpoint');

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

    if (onboardingOpen && isOnboardingWelcomeItem(selectedLibraryItem)) {
      setOnboardingDemoReveal((current) => ({ ...current, parsed: true }));
      void generateLibraryPreview(selectedLibraryItem, false, { allowGenerate: false });
      return;
    }

    void runLibraryItemMineruParse(selectedLibraryItem);
  }, [
    generateLibraryPreview,
    onboardingOpen,
    runLibraryItemMineruParse,
    selectedLibraryItem,
  ]);

  const handlePreviewTranslateDocument = useCallback(() => {
    if (!selectedLibraryItem) {
      return;
    }

    if (onboardingOpen && isOnboardingWelcomeItem(selectedLibraryItem)) {
      setOnboardingDemoReveal((current) => ({ ...current, parsed: true, translated: true }));
      void generateLibraryPreview(selectedLibraryItem, false, { allowGenerate: false });
      return;
    }

    void runLibraryItemTranslation(selectedLibraryItem);
  }, [
    generateLibraryPreview,
    onboardingOpen,
    runLibraryItemTranslation,
    selectedLibraryItem,
  ]);

  const revealOnboardingWelcomeSummary = useCallback(async () => {
    setOnboardingDemoReveal((current) => ({ ...current, parsed: true, summarized: true }));

    try {
      const previewContext = await loadLibraryPreviewBlocks(ONBOARDING_WELCOME_ITEM);
      const response = await fetch(`${ONBOARDING_WELCOME_CACHE_DIR}/summaries/614ada92.json`);
      const parsed = response.ok ? (await response.json()) as Partial<SummaryCacheEnvelope> : null;
      const summary = parsed?.summary ?? null;

      setLibraryPreviewStates((current) => ({
        ...current,
        [ONBOARDING_WELCOME_ITEM.workspaceId]: {
          ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          summary,
          loading: false,
          error: '',
          hasBlocks: true,
          blockCount: previewContext.blocks.length,
          currentPdfName: 'welcome.pdf',
          currentJsonName: 'content_list_v2.json',
          statusMessage: l(
            '已显示 Welcome 内置 AI 概览。这个演示结果来自随软件打包的数据，没有调用 API。',
            'Displayed the built-in Welcome AI overview. This demo result is bundled with the app and did not call any API.',
          ),
          sourceKey: parsed?.sourceKey || 'onboarding:welcome::summary',
        },
      }));
    } catch (nextError) {
      setLibraryPreviewStates((current) => ({
        ...current,
        [ONBOARDING_WELCOME_ITEM.workspaceId]: {
          ...(current[ONBOARDING_WELCOME_ITEM.workspaceId] ?? EMPTY_LIBRARY_PREVIEW_STATE),
          loading: false,
          error: nextError instanceof Error ? nextError.message : l('加载内置概览失败', 'Failed to load the built-in overview'),
          statusMessage: l('加载内置概览失败', 'Failed to load the built-in overview'),
        },
      }));
    }
  }, [l]);

  const handleToggleBatchMineruPause = useCallback(() => {
    if (!batchMineruRunningRef.current) {
      return;
    }

    const nextPaused = !batchMineruPausedRef.current;
    batchMineruPausedRef.current = nextPaused;
    setBatchMineruPaused(nextPaused);
    setBatchMineruProgress((current) =>
      current.running
        ? {
            ...current,
            paused: nextPaused,
            cancelRequested: batchMineruCancelRequestedRef.current,
          }
        : current,
    );
    setStatusMessage(
      nextPaused
        ? l('已暂停 MinerU 批量解析', 'Paused the MinerU batch parsing')
        : l('已继续 MinerU 批量解析', 'Resumed the MinerU batch parsing'),
    );
  }, [l]);

  const handleCancelBatchMineru = useCallback(() => {
    if (!batchMineruRunningRef.current || batchMineruCancelRequestedRef.current) {
      return;
    }

    batchMineruCancelRequestedRef.current = true;
    batchMineruPausedRef.current = false;
    setBatchMineruPaused(false);
    setBatchMineruProgress((current) =>
      current.running
        ? {
            ...current,
            paused: false,
            cancelRequested: true,
            currentLabel:
              current.currentLabel ||
              l('正在等待当前任务结束后取消…', 'Waiting for the current task to finish before cancelling...'),
          }
        : current,
    );
    setStatusMessage(
      l(
        '正在取消 MinerU 批量解析，当前进行中的任务完成后将停止。',
        'Cancelling the MinerU batch parsing. It will stop after the current tasks finish.',
      ),
    );
  }, [l]);

  const handleToggleBatchSummaryPause = useCallback(() => {
    if (!batchSummaryRunningRef.current) {
      return;
    }

    const nextPaused = !batchSummaryPausedRef.current;
    batchSummaryPausedRef.current = nextPaused;
    setBatchSummaryPaused(nextPaused);
    setBatchSummaryProgress((current) =>
      current.running
        ? {
            ...current,
            paused: nextPaused,
            cancelRequested: batchSummaryCancelRequestedRef.current,
          }
        : current,
    );
    setStatusMessage(
      nextPaused
        ? l('已暂停批量概览生成', 'Paused the batch overview generation')
        : l('已继续批量概览生成', 'Resumed the batch overview generation'),
    );
  }, [l]);

  const handleCancelBatchSummary = useCallback(() => {
    if (!batchSummaryRunningRef.current || batchSummaryCancelRequestedRef.current) {
      return;
    }

    batchSummaryCancelRequestedRef.current = true;
    batchSummaryPausedRef.current = false;
    setBatchSummaryPaused(false);
    setBatchSummaryProgress((current) =>
      current.running
        ? {
            ...current,
            paused: false,
            cancelRequested: true,
            currentLabel:
              current.currentLabel ||
              l('正在等待当前任务结束后取消…', 'Waiting for the current task to finish before cancelling...'),
          }
        : current,
    );
    setStatusMessage(
      l(
        '正在取消批量概览生成，当前进行中的任务完成后将停止。',
        'Cancelling the batch overview generation. It will stop after the current tasks finish.',
      ),
    );
  }, [l]);

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
    if (!pendingTranslateTabId) {
      return;
    }

    const bridge = readerBridges[pendingTranslateTabId];

    if (!bridge) {
      return;
    }

    bridge.onTranslate();
    setPendingTranslateTabId(null);
  }, [pendingTranslateTabId, readerBridges]);

  useEffect(() => {
    if (!pendingSummaryTabId) {
      return;
    }

    const bridge = readerBridges[pendingSummaryTabId];

    if (!bridge) {
      return;
    }

    bridge.onGenerateSummary();
    setPendingSummaryTabId(null);
  }, [pendingSummaryTabId, readerBridges]);

  useEffect(() => {
    if (!configHydrated) {
      return;
    }

    void loadLocalLibrary(undefined, true);
  }, [configHydrated]);

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
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
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
    settings.summaryOutputLanguage,
    settings.summarySourceMode,
    settings.uiLanguage,
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
    settings.summaryOutputLanguage,
    settings.uiLanguage,
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
    <AppLocaleProvider value={settings.uiLanguage}>
      <div className="relative h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] text-slate-900 dark:bg-chrome-950 dark:text-chrome-100">
      <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/70 bg-white/55 shadow-[0_26px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/8 dark:bg-chrome-950 dark:shadow-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/72 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
          <div
            className="flex min-w-0 items-center gap-3"
            data-tauri-drag-region
            onDoubleClick={handleWindowToggleMaximize}
          >
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_10px_28px_rgba(15,23,42,0.16)] ring-1 ring-slate-200/80 dark:bg-chrome-800 dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)] dark:ring-white/10">
              <img
                src="/icon.png"
                alt="PaperQuay"
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-chrome-100">PaperQuay</div>
              <div className="truncate text-xs text-slate-500 dark:text-chrome-400">
                {l(
                  '桌面优先的论文阅读与研究工作台',
                  'A desktop-first workspace for paper reading and research analysis',
                )}
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
              type="button"
              onClick={() => setLeftSidebarCollapsed((current) => !current)}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              {leftSidebarCollapsed ? (
                <PanelLeftOpen className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : (
                <PanelLeftClose className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {leftSidebarCollapsed ? l('展开文库', 'Expand Library') : l('折叠文库', 'Collapse Library')}
            </button>
            <button
              type="button"
              onClick={handleOpenStandalonePdf}
              data-tour="open-pdf"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              <Library className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('打开 PDF', 'Open PDF')}
            </button>
            <button
              type="button"
              onClick={handleOpenOnboarding}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              <HelpCircle className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('新手引导', 'Guide')}
            </button>
            <button
              type="button"
              onClick={handleOpenPreferences}
              data-tour="settings"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              <Settings2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('设置', 'Settings')}
            </button>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, 'light' | 'dark' | 'system'> = {
                  light: 'dark',
                  dark: 'system',
                  system: 'light',
                };
                setThemeMode(next[themeMode]);
              }}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
              title={
                themeMode === 'light'
                  ? l('浅色模式', 'Light Mode')
                  : themeMode === 'dark'
                    ? l('深色模式', 'Dark Mode')
                    : l('跟随系统', 'System Theme')
              }
            >
              {themeMode === 'light' ? (
                <Sun className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : themeMode === 'dark' ? (
                <Moon className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Sun className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {themeMode === 'light'
                ? l('浅色', 'Light')
                : themeMode === 'dark'
                  ? l('深色', 'Dark')
                  : l('自动', 'Auto')}
            </button>
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-chrome-700 dark:bg-chrome-800">
              <button
                type="button"
                onClick={handleWindowMinimize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
                aria-label={l('最小化窗口', 'Minimize Window')}
              >
                <Minus className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowToggleMaximize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
                aria-label={l('切换窗口缩放', 'Toggle Window Maximize')}
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowClose}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 dark:text-chrome-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-400"
                aria-label={l('关闭窗口', 'Close Window')}
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>

        <div data-tour="reader-tabs">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTab}
            onClose={closeTab}
          />
        </div>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0" hidden={activeTabId !== HOME_TAB_ID}>
            {onboardingOpen ? (
              <LibraryWorkspace
                leftSidebarCollapsed={leftSidebarCollapsed}
                zoteroLocalDataDir={zoteroLocalDataDir}
                zoteroAllItemsCount={0}
                standaloneItemsCount={1}
                flattenedCollections={[]}
                selectedSectionKey={selectedSectionKey}
                selectedSectionTitle={l('新手引导演示文档', 'Onboarding Demo')}
                visibleItems={visibleItems}
                itemParseStatusMap={itemParseStatusMap}
                selectedItemId={selectedItemId}
                librarySearchQuery=""
                libraryDisplayMode={libraryDisplayMode}
                libraryLoading={false}
                libraryLoadingSection={libraryLoadingSection}
                statusMessage={l('新手引导模式：当前只显示 Welcome 演示文档。', 'Onboarding mode: only the Welcome demo document is shown.')}
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
                    currentPdfName={displayedLibraryPreviewState.currentPdfName}
                    currentJsonName={displayedLibraryPreviewState.currentJsonName}
                    hasBlocks={displayedLibraryPreviewState.hasBlocks}
                    blockCount={displayedLibraryPreviewState.blockCount}
                    statusMessage={displayedLibraryPreviewState.statusMessage}
                    summary={displayedLibraryPreviewState.summary}
                    loading={displayedLibraryPreviewState.loading}
                    error={displayedLibraryPreviewState.error}
                    demoMode={selectedItemIsOnboardingWelcome}
                    translationReady={selectedItemIsOnboardingWelcome ? onboardingDemoReveal.translated : undefined}
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
                    onTranslateDocument={handlePreviewTranslateDocument}
                    onCloudParse={handlePreviewCloudParse}
                    onGenerateSummary={() => {
                      if (selectedLibraryItem) {
                        if (isOnboardingWelcomeItem(selectedLibraryItem)) {
                          void revealOnboardingWelcomeSummary();
                          return;
                        }

                        void generateLibraryPreview(selectedLibraryItem, true, { allowGenerate: true });
                      }
                    }}
                  />
                }
              />
            ) : (
              <LiteratureLibraryView
                onOpenPaper={handleOpenNativeLibraryPaper}
                onOpenSettings={handleOpenPreferences}
                mineruCacheDir={settings.mineruCacheDir}
                autoLoadSiblingJson={settings.autoLoadSiblingJson}
                onRunMineruParse={handleNativeLibraryMineruParse}
                onTranslatePaper={handleNativeLibraryTranslate}
                onGenerateSummary={handleNativeLibraryGenerateSummary}
              />
            )}
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
                  onboardingWorkspaceStage={
                    tab.id === activeTabId && tab.id === onboardingDemoTabId
                      ? onboardingWorkspaceStage
                      : null
                  }
                  onboardingDemoReveal={
                    tab.id === onboardingDemoTabId ? onboardingDemoReveal : undefined
                  }
                />
              </div>
            );
          })}
        </main>
      </div>

      <OnboardingGuide
        open={onboardingOpen}
        language={settings.uiLanguage}
        stepIndex={onboardingStepIndex}
        onStepIndexChange={handleOnboardingStepChange}
        onClose={handleCloseOnboarding}
        onFinish={handleFinishOnboarding}
      />

      <PreferencesWindow
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        preferredSection={preferredPreferencesSection}
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
        onToggleBatchMineruPause={handleToggleBatchMineruPause}
        onCancelBatchMineru={handleCancelBatchMineru}
        onToggleBatchSummaryPause={handleToggleBatchSummaryPause}
        onCancelBatchSummary={handleCancelBatchSummary}
        batchMineruRunning={batchMineruRunning}
        batchSummaryRunning={batchSummaryRunning}
        batchMineruPaused={batchMineruPaused}
        batchSummaryPaused={batchSummaryPaused}
        batchMineruProgress={batchMineruProgress}
        batchSummaryProgress={batchSummaryProgress}
      />
      </div>
    </AppLocaleProvider>
  );
}

export default Reader;











