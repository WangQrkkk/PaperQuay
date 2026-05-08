import type { AppDefaultPaths } from '../../services/desktop';
import type {
  ModelReasoningEffort,
  ModelRuntimeConfig,
  ModelRuntimeRole,
  PaperSummary,
  PositionedMineruBlock,
  QaModelPreset,
  RagSourceMode,
  ReaderConfigFile,
  ReaderSecrets,
  ReaderSettings,
  SummarySourceMode,
  TranslationMap,
  UiLanguage,
  WorkspaceItem,
} from '../../types/reader';
import type { LiteraturePaper, LiteraturePaperTaskState } from '../../types/library';
import { getFileNameFromPath } from '../../utils/text';

export const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
export const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
export const CONFIG_WRITE_DEBOUNCE_MS = 350;
export const ONBOARDING_SEEN_STORAGE_KEY = 'paperquay-onboarding-seen-v1';
export const ONBOARDING_WELCOME_CACHE_DIR = '/onboarding/mineru-cache/welcome-bfc1ec86';
export const ONBOARDING_SETTINGS_STEP = 2;
export const ONBOARDING_LIBRARY_START_STEP = 3;
export const ONBOARDING_LIBRARY_END_STEP = 7;
export const ONBOARDING_READER_READING_START_STEP = 8;
export const ONBOARDING_READER_READING_END_STEP = 9;
export const ONBOARDING_READER_OVERVIEW_STEP = 10;
export const ONBOARDING_AGENT_STEP = 11;

export const ONBOARDING_WELCOME_ITEM: WorkspaceItem = {
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

export const WELCOME_STANDALONE_ITEM: WorkspaceItem = {
  ...ONBOARDING_WELCOME_ITEM,
  itemKey: 'standalone:onboarding:welcome',
  creators: 'PaperQuay Demo',
  source: 'standalone',
};

export function isOnboardingWelcomeItem(item: WorkspaceItem | null | undefined): boolean {
  return item?.workspaceId === ONBOARDING_WELCOME_ITEM.workspaceId;
}

export interface OnboardingDemoRevealState {
  parsed: boolean;
  translated: boolean;
  summarized: boolean;
}

export const EMPTY_ONBOARDING_DEMO_REVEAL: OnboardingDemoRevealState = {
  parsed: false,
  translated: false,
  summarized: false,
};

export type PreferencesSectionKey =
  | 'general'
  | 'library'
  | 'reading'
  | 'mineru'
  | 'translation'
  | 'models'
  | 'embedding'
  | 'summaryQa';

export const DEFAULT_QA_PRESET_ID = 'default';
export const READER_CONFIG_VERSION = 1;

export function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

export function buildLanguageOptions(locale: UiLanguage) {
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

export function resolveLanguageLabel(locale: UiLanguage, value: string): string {
  return buildLanguageOptions(locale).find((language) => language.value === value)?.label ?? value;
}

export function buildSummaryLanguageOptions(locale: UiLanguage) {
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

export function buildSummarySourceOptions(locale: UiLanguage): Array<{
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

export function buildQaSourceOptions(locale: UiLanguage): Array<{
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

export function buildRagSourceOptions(locale: UiLanguage): Array<{
  value: RagSourceMode;
  label: string;
  description: string;
}> {
  return [
    {
      value: 'off',
      label: pickLocaleText(locale, '关闭', 'Off'),
      description: pickLocaleText(
        locale,
        '关闭本地检索增强，继续沿用现有整篇上下文回退逻辑。',
        'Disable local retrieval augmentation and keep the existing full-context fallback behavior.',
      ),
    },
    {
      value: 'mineru-markdown',
      label: 'MinerU Markdown',
      description: pickLocaleText(
        locale,
        '仅为 MinerU Markdown / 结构化文本建立本地索引并检索。',
        'Build and query the local index from MinerU Markdown or structured block text only.',
      ),
    },
    {
      value: 'pdf-text',
      label: pickLocaleText(locale, 'PDF 文本', 'PDF Text'),
      description: pickLocaleText(
        locale,
        '仅使用 pdf.js 抽取的全文文本建立本地索引并检索。',
        'Build and query the local index from full PDF text extracted by pdf.js only.',
      ),
    },
    {
      value: 'hybrid',
      label: pickLocaleText(locale, '混合模式', 'Hybrid'),
      description: pickLocaleText(
        locale,
        '优先使用 MinerU Markdown，并在可用时同时补充 PDF 全文切块。',
        'Prefer MinerU Markdown and supplement it with PDF text chunks when both are available.',
      ),
    },
  ];
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  uiLanguage: 'zh-CN',
  autoLoadSiblingJson: false,
  autoMineruParse: false,
  autoGenerateSummary: false,
  localRagEnabled: true,
  localRagTopK: 6,
  ragSourceMode: 'hybrid',
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
  translationRequestsPerMinute: 0,
  translationBaseUrl: 'https://api.openai.com',
  translationModel: 'gpt-4o-mini',
  summaryBaseUrl: 'https://api.openai.com',
  summaryModel: 'gpt-4o-mini',
  translationModelPresetId: 'default',
  selectionTranslationModelPresetId: 'default',
  summaryModelPresetId: 'default',
  agentModelPresetId: 'default',
  embeddingBaseUrl: 'https://api.openai.com',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: null,
  embeddingRequestTimeoutSeconds: 180,
  embeddingBatchSize: 24,
  ragEmbeddingModelPresetId: 'default',
  modelRuntimeConfigs: {},
  summarySourceMode: 'mineru-markdown',
  summaryOutputLanguage: 'follow-ui',
  qaSourceMode: 'mineru-markdown',
  translationSourceLanguage: 'English',
  translationTargetLanguage: 'Chinese',
  translationDisplayMode: 'translated',
  qaActivePresetId: 'default',
};

export const DEFAULT_QA_PRESET: QaModelPreset = {
  id: DEFAULT_QA_PRESET_ID,
  label: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  labelCustomized: false,
};

export const DEFAULT_SECRETS: ReaderSecrets = {
  mineruApiToken: '',
  translationApiKey: '',
  summaryApiKey: '',
  embeddingApiKey: '',
  zoteroApiKey: '',
  zoteroUserId: '',
  qaModelPresets: [DEFAULT_QA_PRESET],
};

export const MODEL_REASONING_OPTIONS: Array<{
  value: ModelReasoningEffort;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  {
    value: 'auto',
    labelZh: '自动',
    labelEn: 'Auto',
    descriptionZh: '不额外发送 reasoning_effort，保持模型或服务商默认行为。',
    descriptionEn: 'Do not send reasoning_effort; keep the model or provider default.',
  },
  {
    value: 'low',
    labelZh: '低',
    labelEn: 'Low',
    descriptionZh: '更快、更省 token，适合翻译、整理和简单批处理。',
    descriptionEn: 'Faster and cheaper, suitable for translation, cleanup, and simple batch jobs.',
  },
  {
    value: 'medium',
    labelZh: '中',
    labelEn: 'Medium',
    descriptionZh: '平衡速度和复杂任务稳定性。',
    descriptionEn: 'Balances speed with stability for moderately complex tasks.',
  },
  {
    value: 'high',
    labelZh: '高',
    labelEn: 'High',
    descriptionZh: '更适合复杂推理、Agent 工具选择和长上下文分析。',
    descriptionEn: 'Better for complex reasoning, Agent tool choice, and long-context analysis.',
  },
];

export function normalizeModelTemperature(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(2, Math.max(0, Number(parsed.toFixed(2))));
}

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort {
  return MODEL_REASONING_OPTIONS.some((option) => option.value === value)
    ? (value as ModelReasoningEffort)
    : 'auto';
}

export function normalizeModelRuntimeConfig(value: unknown): ModelRuntimeConfig {
  if (!value || typeof value !== 'object') {
    return { reasoningEffort: 'auto' };
  }

  const config = value as Partial<ModelRuntimeConfig>;

  return {
    temperature: normalizeModelTemperature(config.temperature),
    reasoningEffort: normalizeModelReasoningEffort(config.reasoningEffort),
  };
}

export function normalizeModelRuntimeConfigs(
  value: unknown,
): Partial<Record<ModelRuntimeRole, ModelRuntimeConfig>> {
  const rawConfigs = value && typeof value === 'object'
    ? (value as Partial<Record<ModelRuntimeRole, unknown>>)
    : {};

  return {
    translation: normalizeModelRuntimeConfig(rawConfigs.translation),
    selectionTranslation: normalizeModelRuntimeConfig(rawConfigs.selectionTranslation),
    summary: normalizeModelRuntimeConfig(rawConfigs.summary),
    agent: normalizeModelRuntimeConfig(rawConfigs.agent),
    qa: normalizeModelRuntimeConfig(rawConfigs.qa),
  };
}

export function getModelRuntimeConfig(
  settings: ReaderSettings,
  role: ModelRuntimeRole,
): ModelRuntimeConfig {
  return normalizeModelRuntimeConfig(settings.modelRuntimeConfigs?.[role]);
}

export function createQaPreset(partial?: Partial<QaModelPreset>): QaModelPreset {
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

export function normalizeQaModelPresets(presets: unknown): QaModelPreset[] {
  if (!Array.isArray(presets)) {
    return [DEFAULT_QA_PRESET];
  }

  const normalized = presets
    .filter((preset): preset is Partial<QaModelPreset> => Boolean(preset && typeof preset === 'object'))
    .map((preset) => createQaPreset(preset));

  return normalized.length > 0 ? dedupeQaModelPresets(normalized) : [DEFAULT_QA_PRESET];
}

export function dedupeQaModelPresets(presets: QaModelPreset[]): QaModelPreset[] {
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

export function buildLegacyModelPresets(
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

export function resolveModelPreset(
  presets: QaModelPreset[],
  presetId: string | undefined,
): QaModelPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null;
}

export interface LibraryPreviewState {
  summary: PaperSummary | null;
  loading: boolean;
  error: string;
  operation: LiteraturePaperTaskState | null;
  hasBlocks: boolean;
  blockCount: number;
  currentPdfName: string;
  currentJsonName: string;
  statusMessage: string;
  sourceKey: string;
}

export interface LibraryPreviewLoadResult {
  blocks: PositionedMineruBlock[];
  currentPdfName: string;
  currentJsonName: string;
  statusMessage: string;
  pdfPath?: string;
  markdownText?: string;
}

export type LibraryPreviewOutcome = 'loaded' | 'generated' | 'skipped' | 'failed';

export interface SummaryCacheEnvelope {
  version: number;
  sourceKey: string;
  summarizedAt: string;
  summary: PaperSummary;
}

export interface TranslationCacheEnvelope {
  version: number;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

export interface BatchProgressState {
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

export interface MineruCacheManifest {
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

export const EMPTY_LIBRARY_PREVIEW_STATE: LibraryPreviewState = {
  summary: null,
  loading: false,
  error: '',
  operation: null,
  hasBlocks: false,
  blockCount: 0,
  currentPdfName: '',
  currentJsonName: '',
  statusMessage: '',
  sourceKey: '',
};

export const EMPTY_BATCH_PROGRESS: BatchProgressState = {
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

export function getAutoParseAttemptKey(item: WorkspaceItem): string {
  return `${item.workspaceId}::${item.localPdfPath?.trim() ?? ''}`;
}

export function getAutoSummaryAttemptKey(
  item: WorkspaceItem,
  sourceMode: SummarySourceMode,
  outputLanguage: string,
  hasParse: boolean,
): string {
  return `${item.workspaceId}::${sourceMode}::${outputLanguage}::${item.localPdfPath?.trim() ?? ''}::${hasParse ? 'parsed' : 'unparsed'}`;
}

export function clampBatchConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function getPathSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

export function joinSystemPath(basePath: string, ...segments: string[]): string {
  const separator = getPathSeparator(basePath);
  const normalizedBase = basePath.replace(/[\\/]+$/, '');

  return [normalizedBase, ...segments.filter(Boolean)].join(separator);
}

export function buildLegacyConfigPath(executableDir: string): string {
  return joinSystemPath(executableDir, 'paperquay-data', 'paperquay.config.json');
}

export function sleep(ms: number): Promise<void> {
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

function clampTranslationRequestsPerMinute(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.translationRequestsPerMinute;
  }

  return Math.min(600, Math.max(0, Math.trunc(value)));
}

function clampLocalRagTopK(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.localRagTopK;
  }

  return Math.min(12, Math.max(1, Math.trunc(value)));
}

function clampEmbeddingDimensions(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value === 0) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.embeddingDimensions;
  }

  return Math.min(4096, Math.max(1, Math.trunc(value)));
}

function clampEmbeddingRequestTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.embeddingRequestTimeoutSeconds;
  }

  return Math.min(600, Math.max(10, Math.trunc(value)));
}

function clampEmbeddingBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.embeddingBatchSize;
  }

  return Math.min(128, Math.max(1, Math.trunc(value)));
}

function normalizeRagSourceMode(value: unknown): RagSourceMode {
  return value === 'off' ||
    value === 'mineru-markdown' ||
    value === 'pdf-text' ||
    value === 'hybrid'
    ? value
    : DEFAULT_SETTINGS.ragSourceMode;
}

export function normalizeReaderSettings(value?: Partial<ReaderSettings> | null): ReaderSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(value ?? {}),
  };

  return {
    ...merged,
    uiLanguage: merged.uiLanguage === 'en-US' ? 'en-US' : 'zh-CN',
    localRagEnabled: merged.localRagEnabled !== false,
    localRagTopK: clampLocalRagTopK(merged.localRagTopK),
    ragSourceMode: normalizeRagSourceMode(merged.ragSourceMode),
    libraryBatchConcurrency: clampBatchConcurrency(merged.libraryBatchConcurrency),
    translationBatchSize: clampTranslationBatchSize(merged.translationBatchSize),
    translationConcurrency: clampTranslationConcurrency(merged.translationConcurrency),
    translationRequestsPerMinute: clampTranslationRequestsPerMinute(
      merged.translationRequestsPerMinute,
    ),
    embeddingBaseUrl: merged.embeddingBaseUrl?.trim() || DEFAULT_SETTINGS.embeddingBaseUrl,
    embeddingModel: merged.embeddingModel?.trim() || DEFAULT_SETTINGS.embeddingModel,
    embeddingDimensions: clampEmbeddingDimensions(merged.embeddingDimensions),
    embeddingRequestTimeoutSeconds: clampEmbeddingRequestTimeoutSeconds(
      merged.embeddingRequestTimeoutSeconds,
    ),
    embeddingBatchSize: clampEmbeddingBatchSize(merged.embeddingBatchSize),
    modelRuntimeConfigs: normalizeModelRuntimeConfigs(merged.modelRuntimeConfigs),
    summaryOutputLanguage: merged.summaryOutputLanguage?.trim() || 'follow-ui',
    translationDisplayMode:
      merged.translationDisplayMode === 'original' || merged.translationDisplayMode === 'bilingual'
        ? merged.translationDisplayMode
        : 'translated',
  };
}

export function loadSettings(): ReaderSettings {
  try {
    const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);

    return storedSettings
      ? normalizeReaderSettings(JSON.parse(storedSettings) as Partial<ReaderSettings>)
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSecrets(): ReaderSecrets {
  try {
    const storedSecrets = localStorage.getItem(SECRETS_STORAGE_KEY);

    if (!storedSecrets) {
      return DEFAULT_SECRETS;
    }

    const parsed = JSON.parse(storedSecrets) as Partial<ReaderSecrets>;

    return {
      ...DEFAULT_SECRETS,
      ...parsed,
      embeddingApiKey: parsed.embeddingApiKey?.trim() ?? '',
      qaModelPresets: normalizeQaModelPresets(parsed.qaModelPresets),
    };
  } catch {
    return DEFAULT_SECRETS;
  }
}

export function mergeReaderConfigWithDefaults(
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
    embeddingApiKey: value?.secrets?.embeddingApiKey ?? fallbackSecrets.embeddingApiKey ?? '',
    qaModelPresets: normalizeQaModelPresets(
      value?.secrets?.qaModelPresets ?? fallbackSecrets.qaModelPresets,
    ),
  };

  if (
    (!nextSettings.embeddingBaseUrl.trim() ||
      !nextSettings.embeddingModel.trim() ||
      !nextSecrets.embeddingApiKey.trim()) &&
    nextSettings.ragEmbeddingModelPresetId.trim()
  ) {
    const legacyEmbeddingPreset = normalizeQaModelPresets(nextSecrets.qaModelPresets).find(
      (preset) => preset.id === nextSettings.ragEmbeddingModelPresetId,
    );

    if (legacyEmbeddingPreset) {
      nextSettings.embeddingBaseUrl =
        nextSettings.embeddingBaseUrl.trim() || legacyEmbeddingPreset.baseUrl.trim();
      nextSettings.embeddingModel =
        nextSettings.embeddingModel.trim() || legacyEmbeddingPreset.model.trim();
      nextSecrets.embeddingApiKey =
        nextSecrets.embeddingApiKey.trim() || legacyEmbeddingPreset.apiKey.trim();
    }
  }

  if (!nextSettings.mineruCacheDir.trim()) {
    nextSettings.mineruCacheDir = defaultPaths.mineruCacheDir;
  } else if (looksLikeCorruptedGeneratedPath(nextSettings.mineruCacheDir)) {
    nextSettings.mineruCacheDir = defaultPaths.mineruCacheDir;
  }

  if (!nextSettings.remotePdfDownloadDir.trim()) {
    nextSettings.remotePdfDownloadDir = defaultPaths.remotePdfDownloadDir;
  } else if (looksLikeCorruptedGeneratedPath(nextSettings.remotePdfDownloadDir)) {
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

function looksLikeCorruptedGeneratedPath(path: string): boolean {
  const normalizedPath = path.trim();

  if (!normalizedPath) {
    return false;
  }

  const commonMojibakeMarkers = [
    '\u5bee\u20ac\u934f',
    '\u95ab',
    '\u7490',
    '\u934f',
    '\u9435',
    '\ufffd',
  ];
  const hasMojibakeMarker =
    /[\u0000-\u001f]/.test(normalizedPath) ||
    commonMojibakeMarkers.some((marker) => normalizedPath.includes(marker));
  const isGeneratedAppPath = /(?:paperdock-data|paperquay-data|\.mineru-cache|\.downloads|mineru-cache|pdfs)/i.test(
    normalizedPath,
  );

  return hasMojibakeMarker && isGeneratedAppPath;
}

export function mergeLocalPdfPath<T extends { localPdfPath?: string }>(
  current: T,
  incoming: T,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(incoming, 'localPdfPath')
    ? incoming.localPdfPath
    : current.localPdfPath;
}

export function createStandaloneItem(path: string, locale: UiLanguage): WorkspaceItem {
  const filename = getFileNameFromPath(path);
  const title = filename.replace(/\.pdf$/i, '') || pickLocaleText(locale, '未命名 PDF', 'Untitled PDF');
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

export function createNativeLibraryWorkspaceItem(paper: LiteraturePaper): WorkspaceItem | null {
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

export function textSignature(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }

  return chunks;
}

export function formatPaperSummaryForLibrary(summary: PaperSummary): string {
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
