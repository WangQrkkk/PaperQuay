import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import {
  readLocalBinaryFile,
  readLocalTextFileIfExists,
} from './desktop';
import { resolveLocalRagContext } from './localRag';
import {
  paperAuthors,
  paperPdfPath,
  normalizeComparable,
  stripKnownReadPrefix,
  uniqueTags,
} from './libraryAgentPlanHelpers';
import { readReaderConfigFile } from './readerConfig';
import {
  buildMineruMarkdownDocument,
  extractPdfTextByPdfJs,
} from './summarySource';
import {
  flattenMineruPages,
  parseMineruPages,
} from './mineru';
import {
  buildMineruCachePathCandidates,
  guessSiblingJsonPath,
  guessSiblingMarkdownPath,
} from '../utils/mineruCache';
import type { LiteratureCategory, LiteraturePaper, UpdatePaperRequest } from '../types/library';
import type {
  DocumentChatAttachment,
  ModelRuntimeConfig,
  ModelReasoningEffort,
  OpenAICompatibleApiMode,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderConfigFile,
  ReaderSecrets,
  ReaderSettings,
  WorkspaceItem,
} from '../types/reader';

export type LibraryAgentTool =
  | 'rename'
  | 'metadata'
  | 'smart-tags'
  | 'clean-tags'
  | 'classify';

export type LibraryAgentToolChoice = LibraryAgentTool | 'auto';

export type RenameOperation =
  | { mode: 'suffix'; value: string }
  | { mode: 'prefix'; value: string }
  | { mode: 'replace'; from: string; to: string };

export interface LibraryAgentPlanItem {
  id: string;
  tool: LibraryAgentTool;
  paperId: string;
  paperTitle: string;
  title: string;
  description: string;
  before?: string;
  after?: string;
  updateRequest?: UpdatePaperRequest;
  targetCategoryName?: string;
  targetCategoryParentName?: string;
  metadataSource?: string;
}

export interface LibraryAgentPlan {
  id: string;
  tool: LibraryAgentTool;
  title: string;
  description: string;
  items: LibraryAgentPlanItem[];
  createdAt: number;
}

export interface ApplyLibraryAgentPlanResult {
  applied: number;
  failed: number;
  errors: string[];
}

interface LibraryAgentPaperInput {
  id: string;
  title: string;
  authors: string[];
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  aiSummary?: string | null;
  userNote?: string | null;
  contextSource?: string | null;
  contextText?: string | null;
  keywords: string[];
  tags: string[];
  categoryIds: string[];
  categories: string[];
  categoryPaths: string[];
}

interface LibraryAgentCategoryInput {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  paperCount: number;
}

export interface LibraryAgentPaperScopeInput {
  id: string;
  label: string;
  paperIds: string[];
  source: 'current' | 'history';
  messageRole?: 'assistant' | 'user';
  messageContent?: string;
}

interface OpenAICompatibleLibraryAgentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiMode?: OpenAICompatibleApiMode;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  responseLanguage?: string;
  allowContextRequest?: boolean;
  tool: LibraryAgentToolChoice;
  instruction?: string | null;
  messages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
  categories?: LibraryAgentCategoryInput[];
  papers: LibraryAgentPaperInput[];
}

type LibraryAgentModelPreset = QaModelPreset & {
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
};

interface LibraryAgentPaperUpdate {
  title?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  keywords?: string[] | null;
  tags?: string[] | null;
  authors?: string[] | null;
}

interface LibraryAgentGeneratedItem {
  paperId?: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
  before?: string | null;
  after?: string | null;
  update?: LibraryAgentPaperUpdate | null;
  updateRequest?: LibraryAgentPaperUpdate | null;
  newTitle?: string | null;
  targetTitle?: string | null;
  updatedTitle?: string | null;
  afterTitle?: string | null;
  titleAfter?: string | null;
  targetCategoryName?: string | null;
  targetCategoryParentName?: string | null;
  [key: string]: unknown;
}

interface LibraryAgentGeneratedPlan {
  tool?: LibraryAgentTool | string | null;
  summary?: string | null;
  description?: string | null;
  items?: LibraryAgentGeneratedItem[] | null;
  updates?: LibraryAgentGeneratedItem[] | null;
  paperUpdates?: LibraryAgentGeneratedItem[] | null;
  papers?: LibraryAgentGeneratedItem[] | null;
  [key: string]: unknown;
}

interface LibraryAgentGeneratedResponse {
  kind: 'answer' | 'plan' | 'context-request' | 'choice-request';
  answer?: string | null;
  thinking?: string | null;
  plan?: LibraryAgentGeneratedPlan | null;
  contextRequest?: LibraryAgentContextRequest | null;
  userChoices?: LibraryAgentUserChoiceRequest | null;
}

interface LibraryAgentPaperContextDecision {
  kind: 'paper-skill-decision';
  action: 'load-context' | 'continue-without-context' | 'ask-user-to-select-papers';
  summary: string;
  reason: string;
  mode: LibraryAgentContextRequest['mode'];
  paperIds: string[];
  thinking?: string | null;
}

export type LibraryAgentRunResult =
  | { kind: 'answer'; answer: string; contextLabel: string; thinking?: string | null }
  | { kind: 'choice'; answer: string; choices: LibraryAgentUserChoice[]; thinking?: string | null }
  | {
    kind: 'paper-selection';
    answer: string;
    request: LibraryAgentPaperSelectionRequest;
    thinking?: string | null;
  }
  | { kind: 'plan'; plan: LibraryAgentPlan; thinking?: string | null };

interface LibraryAgentContextRequest {
  summary: string;
  mode: 'summary' | 'pdf-text';
  paperIds?: string[];
  reason: string;
}

export interface LibraryAgentPaperSelectionRequest {
  summary: string;
  mode: LibraryAgentContextRequest['mode'];
  reason: string;
  instruction: string;
}

interface PaperContextPayload {
  source: string;
  text: string;
}

export interface LibraryAgentUserChoice {
  id: string;
  label: string;
  description: string;
  instruction: string;
}

interface LibraryAgentUserChoiceRequest {
  summary: string;
  reason: string;
  options?: LibraryAgentUserChoice[];
}

export interface LibraryAgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
  paperScopeIds?: string[];
  attachments?: DocumentChatAttachment[];
}

export {
  applyLibraryAgentPlan,
  buildAutoClassifyPlan,
  buildCleanTagsPlan,
  buildMetadataCompletionPlan,
  buildRenamePlan,
  buildSmartTagPlan,
  inferCollectionNameForPaper,
  inferSmartTagsForPaper,
  normalizeAgentTagName,
  normalizeComparable,
  paperAuthors,
  paperPdfPath,
  parseRenameCommand,
  uniqueTags,
} from './libraryAgentPlanHelpers';

const AGENT_STREAM_EVENT = 'paperquay://agent-stream';
const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const AUTO_CLASSIFY_PARENT_NAME = 'Agent 自动归类';

interface LibraryAgentStreamEventPayload {
  requestId: string;
  kind: 'delta' | 'answer-delta' | 'thinking-delta' | 'done' | 'error';
  text?: string | null;
  error?: string | null;
}

export interface LibraryAgentStreamHandlers {
  onDelta?: (text: string, fullText: string) => void;
  onThinkingDelta?: (text: string, fullText: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function newPlanId(tool: LibraryAgentTool): string {
  return `agent-plan:${tool}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
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

function readStorageJson<T>(key: string): Partial<T> {
  try {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return {};
    }

    return JSON.parse(rawValue) as Partial<T>;
  } catch {
    return {};
  }
}

async function loadPersistedReaderConfig(): Promise<Partial<ReaderConfigFile> | null> {
  try {
    return await readReaderConfigFile();
  } catch {
    return null;
  }
}

function normalizeAgentRuntimeConfig(settings: Partial<ReaderSettings>): ModelRuntimeConfig {
  const config = settings.modelRuntimeConfigs?.agent ?? {};
  const temperature =
    typeof config.temperature === 'number' && Number.isFinite(config.temperature)
      ? Math.min(2, Math.max(0, config.temperature))
      : undefined;
  const reasoningEffort =
    config.reasoningEffort === 'low' ||
    config.reasoningEffort === 'medium' ||
    config.reasoningEffort === 'high' ||
    config.reasoningEffort === 'xhigh'
      ? config.reasoningEffort
      : 'auto';

  return { temperature, reasoningEffort };
}

function normalizeAgentApiMode(value: unknown): OpenAICompatibleApiMode {
  return value === 'responses' ? 'responses' : 'chat_completions';
}

function normalizeLibraryAgentModelPreset(preset: QaModelPreset): QaModelPreset {
  return {
    ...preset,
    apiMode: normalizeAgentApiMode((preset as Partial<QaModelPreset>).apiMode),
  };
}

function normalizeStoredReaderSettings(value: Partial<ReaderSettings>): Pick<
  ReaderSettings,
  | 'localRagEnabled'
  | 'localRagTopK'
  | 'ragSourceMode'
  | 'embeddingBaseUrl'
  | 'embeddingModel'
  | 'embeddingDimensions'
  | 'embeddingRequestTimeoutSeconds'
  | 'embeddingBatchSize'
> {
  return {
    localRagEnabled: value.localRagEnabled !== false,
    localRagTopK:
      typeof value.localRagTopK === 'number' && Number.isFinite(value.localRagTopK)
        ? Math.max(1, Math.min(12, Math.trunc(value.localRagTopK)))
        : 6,
    ragSourceMode:
      value.ragSourceMode === 'off' ||
      value.ragSourceMode === 'mineru-markdown' ||
      value.ragSourceMode === 'pdf-text' ||
      value.ragSourceMode === 'hybrid'
        ? value.ragSourceMode
        : 'hybrid',
    embeddingBaseUrl: value.embeddingBaseUrl?.trim() || 'https://api.openai.com',
    embeddingModel: value.embeddingModel?.trim() || 'text-embedding-3-small',
    embeddingDimensions:
      typeof value.embeddingDimensions === 'number' && Number.isFinite(value.embeddingDimensions)
        ? Math.max(1, Math.min(4096, Math.trunc(value.embeddingDimensions)))
        : null,
    embeddingRequestTimeoutSeconds:
      typeof value.embeddingRequestTimeoutSeconds === 'number' &&
      Number.isFinite(value.embeddingRequestTimeoutSeconds)
        ? Math.max(10, Math.min(600, Math.trunc(value.embeddingRequestTimeoutSeconds)))
        : 180,
    embeddingBatchSize:
      typeof value.embeddingBatchSize === 'number' && Number.isFinite(value.embeddingBatchSize)
        ? Math.max(1, Math.min(128, Math.trunc(value.embeddingBatchSize)))
        : 24,
  };
}

export async function loadLibraryAgentModelPreset(): Promise<LibraryAgentModelPreset | null> {
  return loadLibraryAgentModelPresetById();
}

export async function loadLibraryAgentModelPresetById(
  preferredPresetId?: string | null,
): Promise<LibraryAgentModelPreset | null> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSettings = readStorageJson<ReaderSettings>(SETTINGS_STORAGE_KEY);
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);
  const settings = {
    ...(persistedConfig?.settings ?? {}),
    ...storedSettings,
  };
  const secrets = {
    ...(persistedConfig?.secrets ?? {}),
    ...storedSecrets,
  };
  const presets = Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeLibraryAgentModelPreset)
    : [];
  const preferredId =
    preferredPresetId ||
    settings.agentModelPresetId ||
    settings.qaActivePresetId ||
    settings.summaryModelPresetId ||
    settings.translationModelPresetId ||
    presets[0]?.id;

  const preset = presets.find((item) => item.id === preferredId) ?? presets[0] ?? null;

  if (!preset) {
    return null;
  }

  const runtimeConfig = normalizeAgentRuntimeConfig(settings);

  return {
    ...preset,
    temperature: runtimeConfig.temperature,
    reasoningEffort: runtimeConfig.reasoningEffort,
  };
}

export async function loadLibraryAgentAvailableModelPresets(): Promise<QaModelPreset[]> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);
  const secrets = {
    ...(persistedConfig?.secrets ?? {}),
    ...storedSecrets,
  };

  return Array.isArray(secrets.qaModelPresets)
    ? secrets.qaModelPresets.map(normalizeLibraryAgentModelPreset)
    : [];
}

function normalizeAgentContext(value: string): string {
  return value.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildAgentInstructionWithHistory(
  instruction: string,
  historyMessages: LibraryAgentConversationMessage[] = [],
): string {
  const history = historyMessages
    .filter((message) => message.content.trim())
    .slice(-12)
    .map((message) => {
      const paperScopeSection = message.paperScopeIds?.length
        ? `\n[Paper scope IDs]\n${message.paperScopeIds.join(', ')}`
        : '';
      const attachmentSection = message.attachments?.length
        ? `\n[Attachments]\n${message.attachments
          .map((attachment) => {
            const details = [
              attachment.summary?.trim(),
              attachment.textContent?.trim(),
            ].filter(Boolean).join('\n');

            return details ? `${attachment.name}\n${details}` : attachment.name;
          })
          .join('\n\n')}`
        : '';

      return `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim()}${paperScopeSection}${attachmentSection}`;
    })
    .join('\n\n');

  if (!history) {
    return instruction;
  }

  return [
    'Recent conversation in the current Agent window:',
    history,
    '',
    'Current user request. This request has priority over the history above:',
    instruction,
  ].join('\n');
}

function fallbackSummaryContext(paper: LiteraturePaper): PaperContextPayload {
  const sections = [
    paper.aiSummary?.trim() ? `AI overview:\n${paper.aiSummary.trim()}` : '',
    paper.abstractText?.trim() ? `Abstract:\n${paper.abstractText.trim()}` : '',
    paper.userNote?.trim() ? `User note:\n${paper.userNote.trim()}` : '',
  ].filter(Boolean);

  return {
    source: sections.length > 0 ? 'summary' : 'metadata',
    text: sections.join('\n\n'),
  };
}

function paperToWorkspaceItem(paper: LiteraturePaper): WorkspaceItem | null {
  const pdfPath = paperPdfPath(paper);

  if (!pdfPath) {
    return null;
  }

  return {
    itemKey: paper.id,
    title: paper.title,
    creators: paperAuthors(paper).join(', '),
    year: paper.year ?? '',
    itemType: 'pdf',
    attachmentFilename: pdfPath.split(/[\\/]/).pop() || 'paper.pdf',
    localPdfPath: pdfPath,
    source: 'native-library',
    workspaceId: `native-library:${paper.id}`,
    groupKey: `native-library:${paper.id}`,
  };
}

interface AgentDocumentContextSettings {
  autoLoadSiblingJson: boolean;
  mineruCacheDir: string;
}

interface MineruAgentContext {
  source: string;
  text: string;
  blocks: PositionedMineruBlock[];
}

function normalizeAgentDocumentContextSettings(settings: Partial<ReaderSettings>): AgentDocumentContextSettings {
  return {
    autoLoadSiblingJson: settings.autoLoadSiblingJson === true,
    mineruCacheDir: settings.mineruCacheDir?.trim() || '',
  };
}

async function loadAgentSettingsAndSecrets(): Promise<{
  settings: Partial<ReaderSettings>;
  secrets: Partial<ReaderSecrets>;
}> {
  const persistedConfig = await loadPersistedReaderConfig();
  const storedSettings = readStorageJson<ReaderSettings>(SETTINGS_STORAGE_KEY);
  const storedSecrets = readStorageJson<ReaderSecrets>(SECRETS_STORAGE_KEY);

  return {
    settings: {
      ...(persistedConfig?.settings ?? {}),
      ...storedSettings,
    },
    secrets: {
      ...(persistedConfig?.secrets ?? {}),
      ...storedSecrets,
    },
  };
}

function mineruMarkdownCandidatePaths(item: WorkspaceItem, settings: AgentDocumentContextSettings): string[] {
  const candidates = new Set<string>();

  if (settings.mineruCacheDir) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir, item)) {
      candidates.add(cachePaths.markdownPath);
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    candidates.add(guessSiblingMarkdownPath(item.localPdfPath));
  }

  return [...candidates];
}

function mineruJsonCandidatePaths(item: WorkspaceItem, settings: AgentDocumentContextSettings): string[] {
  const candidates = new Set<string>();

  if (settings.mineruCacheDir) {
    for (const cachePaths of buildMineruCachePathCandidates(settings.mineruCacheDir, item)) {
      candidates.add(cachePaths.contentJsonPath);
      candidates.add(cachePaths.middleJsonPath);
    }
  }

  if (item.localPdfPath && settings.autoLoadSiblingJson) {
    candidates.add(guessSiblingJsonPath(item.localPdfPath));
  }

  return [...candidates];
}

async function loadMineruAgentContext(
  item: WorkspaceItem,
  settings: AgentDocumentContextSettings,
): Promise<MineruAgentContext | null> {
  for (const candidatePath of mineruMarkdownCandidatePaths(item, settings)) {
    try {
      const text = await readLocalTextFileIfExists(candidatePath);

      if (text?.trim()) {
        return {
          source: 'mineru-markdown',
          text: normalizeAgentContext(text),
          blocks: [],
        };
      }
    } catch {
      continue;
    }
  }

  for (const candidatePath of mineruJsonCandidatePaths(item, settings)) {
    try {
      const jsonText = await readLocalTextFileIfExists(candidatePath);

      if (!jsonText?.trim()) {
        continue;
      }

      const blocks = flattenMineruPages(parseMineruPages(jsonText));
      const markdown = buildMineruMarkdownDocument(blocks, candidatePath);

      if (markdown.trim()) {
        return {
          source: 'mineru-json',
          text: normalizeAgentContext(markdown),
          blocks,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function loadPaperContext(
  paper: LiteraturePaper,
  mode: LibraryAgentContextRequest['mode'],
  requestReason: string,
  preset: LibraryAgentModelPreset,
  options?: {
    ragEnabled?: boolean;
  },
): Promise<PaperContextPayload> {
  if (mode === 'summary') {
    const context = fallbackSummaryContext(paper);

    return {
      ...context,
      text: normalizeAgentContext(context.text),
    };
  }

  const pdfPath = paperPdfPath(paper);

  if (!pdfPath) {
    const fallback = fallbackSummaryContext(paper);

    return {
      source: `${fallback.source}-fallback-no-pdf`,
      text: normalizeAgentContext(fallback.text),
    };
  }

  try {
    const { settings, secrets } = await loadAgentSettingsAndSecrets();
    const documentContextSettings = normalizeAgentDocumentContextSettings(settings);
    const ragSettings = normalizeStoredReaderSettings(settings);
    const workspaceItem = paperToWorkspaceItem(paper);
    const mineruContext = workspaceItem
      ? await loadMineruAgentContext(workspaceItem, documentContextSettings)
      : null;
    let normalizedPdfText = '';

    if (!mineruContext || ragSettings.ragSourceMode === 'pdf-text') {
      try {
        const pdfData = await readLocalBinaryFile(pdfPath);
        const pdfText = await extractPdfTextByPdfJs(pdfData);
        normalizedPdfText = normalizeAgentContext(pdfText);
      } catch (error) {
        console.warn('Failed to load Agent PDF context', error);
      }
    }

    if (
      options?.ragEnabled !== false &&
      workspaceItem &&
      (normalizedPdfText || (mineruContext?.text && mineruContext.blocks.length > 0)) &&
      secrets.embeddingApiKey?.trim() &&
      ragSettings.embeddingBaseUrl.trim() &&
      ragSettings.embeddingModel.trim()
    ) {
      try {
        const ragText = await resolveLocalRagContext({
          item: workspaceItem,
          settings: ragSettings,
          embedding: {
            baseUrl: ragSettings.embeddingBaseUrl,
            apiKey: secrets.embeddingApiKey.trim(),
            model: ragSettings.embeddingModel,
            dimensions: ragSettings.embeddingDimensions,
            timeoutSeconds: ragSettings.embeddingRequestTimeoutSeconds,
          },
          question: requestReason,
          mineruBlocks: mineruContext?.blocks ?? [],
          mineruDocumentText: mineruContext?.text ?? '',
          pdfDocumentText: normalizedPdfText,
        });

        if (ragText.trim()) {
          return {
            source: `${mineruContext?.source ?? 'pdf-text'}-rag`,
            text: normalizeAgentContext(ragText),
          };
        }
      } catch (error) {
        console.warn('Failed to build local Agent RAG context', error);
      }
    }

    if (mineruContext?.text) {
      return {
        source: mineruContext.source,
        text: mineruContext.text,
      };
    }

    if (normalizedPdfText) {
      return {
        source: 'pdf-text',
        text: normalizedPdfText,
      };
    }
  } catch (error) {
    console.warn('Failed to load Agent document context', error);
  }

  const fallback = fallbackSummaryContext(paper);

  return {
    source: `${fallback.source}-fallback-pdf-error`,
    text: normalizeAgentContext(fallback.text),
  };
}

async function buildPapersWithRequestedContext(
  papers: LiteraturePaper[],
  request: LibraryAgentContextRequest,
  preset: LibraryAgentModelPreset,
  options?: {
    ragEnabled?: boolean;
    categoryPathById?: Map<string, string>;
  },
): Promise<{ inputs: LibraryAgentPaperInput[]; label: string }> {
  const requestedIds = new Set((Array.isArray(request.paperIds) ? request.paperIds : []).filter(Boolean));
  const requestedPapers = requestedIds.size > 0
    ? papers.filter((paper) => requestedIds.has(paper.id))
    : [];
  const targetPapers = requestedIds.size > 0 && requestedPapers.length > 0
    ? requestedPapers
    : papers;
  const targetIds = new Set(targetPapers.map((paper) => paper.id));
  const contextByPaperId = new Map<string, PaperContextPayload>();
  const contextMode: LibraryAgentContextRequest['mode'] = request.mode === 'pdf-text' ? 'pdf-text' : 'summary';
  const requestReason = request.reason?.trim() || 'Selected paper context requested by the Agent.';

  for (const paper of targetPapers) {
    contextByPaperId.set(
      paper.id,
      await loadPaperContext(paper, contextMode, requestReason, preset, options),
    );
  }

  const sourceCounts = new Map<string, number>();

  for (const context of contextByPaperId.values()) {
    sourceCounts.set(context.source, (sourceCounts.get(context.source) ?? 0) + 1);
  }

  const label = [...sourceCounts.entries()]
    .map(([source, count]) => `${source} x${count}`)
    .join(', ') || 'metadata only';

  return {
    inputs: papers.map((paper) => paperToAgentInput(
      paper,
      targetIds.has(paper.id) ? contextByPaperId.get(paper.id) : undefined,
      options?.categoryPathById,
    )),
    label,
  };
}

function categoryDisplayNameForAgent(category: LiteratureCategory): string {
  switch (category.systemKey) {
    case 'all':
      return 'All Papers';
    case 'recent':
      return 'Recently Imported';
    case 'uncategorized':
      return 'Uncategorized';
    case 'favorites':
      return 'Favorites';
    default:
      return category.name;
  }
}

function buildCategoryPathMap(categories: LiteratureCategory[]): Map<string, string> {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const pathById = new Map<string, string>();

  const resolvePath = (category: LiteratureCategory, seen = new Set<string>()): string => {
    const cached = pathById.get(category.id);

    if (cached) {
      return cached;
    }

    const name = categoryDisplayNameForAgent(category);

    if (!category.parentId || seen.has(category.id)) {
      pathById.set(category.id, name);
      return name;
    }

    seen.add(category.id);
    const parent = categoryById.get(category.parentId);
    const path = parent ? `${resolvePath(parent, seen)} / ${name}` : name;
    pathById.set(category.id, path);
    return path;
  };

  for (const category of categories) {
    resolvePath(category);
  }

  return pathById;
}

function categoriesToAgentInputs(
  categories: LiteratureCategory[],
  categoryPathById = buildCategoryPathMap(categories),
): LibraryAgentCategoryInput[] {
  return categories.map((category) => ({
    id: category.id,
    name: categoryDisplayNameForAgent(category),
    path: categoryPathById.get(category.id) ?? categoryDisplayNameForAgent(category),
    parentId: category.parentId,
    paperCount: category.paperCount,
  }));
}

function buildAgentCategoryPayload(categories: LiteratureCategory[] = []) {
  const categoryPathById = buildCategoryPathMap(categories);

  return {
    categories: categoriesToAgentInputs(categories, categoryPathById),
    categoryPathById,
  };
}

function isInsufficientMetadataOnlyAnswer(answer: string): boolean {
  const normalized = answer.toLocaleLowerCase();
  const metadataOnlySignals = [
    '仅基于论文标题',
    '仅基于标题',
    '仅基于元数据',
    '基于论文标题、标签和元数据',
    '未读取到全文',
    '未读取全文',
    '未读取到摘要',
    '未读取摘要',
    '建议加载',
    '仅基于论文标题',
    '仅基于标题',
    '仅基于元数据',
    '基于论文标题、标签和元数据',
    '未读取到全文',
    '未读取全文',
    '未读取到摘要',
    '未读取摘要',
    '建议加载',
    'load the abstract',
    'load abstracts',
    'load the pdf',
    'load pdf',
    'metadata only',
    'titles and metadata',
  ];

  return metadataOnlySignals.filter((signal) => normalized.includes(signal.toLocaleLowerCase())).length >= 2;
}

function currentScopePapers(papers: LiteraturePaper[], currentPaperScopeIds: string[] = []): LiteraturePaper[] {
  if (currentPaperScopeIds.length === 0) {
    return papers;
  }

  const idSet = new Set(currentPaperScopeIds);
  const scopedPapers = papers.filter((paper) => idSet.has(paper.id));

  return scopedPapers.length > 0 ? scopedPapers : papers;
}

function uniqueAvailablePaperIds(
  ids: Array<string | null | undefined>,
  availablePaperIds: Set<string>,
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawId of ids) {
    const id = rawId?.trim();

    if (!id || seen.has(id) || !availablePaperIds.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function buildEffectiveContextRequest(
  request: LibraryAgentContextRequest | null | undefined,
  papers: LiteraturePaper[],
  currentPaperScopeIds: string[] = [],
): LibraryAgentContextRequest | null {
  const availablePaperIds = new Set(papers.map((paper) => paper.id));
  const requestedPaperIds = uniqueAvailablePaperIds(request?.paperIds ?? [], availablePaperIds);
  const currentPaperIds = uniqueAvailablePaperIds(currentPaperScopeIds, availablePaperIds);
  const paperIds = requestedPaperIds.length > 0 ? requestedPaperIds : currentPaperIds;

  if (!request && paperIds.length === 0) {
    return null;
  }

  return {
    summary: request?.summary?.trim() || 'Use the papers already selected for this turn.',
    mode: request?.mode === 'pdf-text' ? 'pdf-text' : 'summary',
    reason: request?.reason?.trim() || 'The user already selected the target papers, so PaperQuay should load context for that scope.',
    paperIds,
  };
}

function buildEmptyAgentAnswerFallback(
  papers: LiteraturePaper[],
  responseLanguage?: string,
): string {
  const useEnglish = responseLanguage?.toLocaleLowerCase().includes('english') ?? false;
  const scopedPapers = papers.slice(0, 6);

  if (useEnglish) {
    if (scopedPapers.length === 0) {
      return 'The model returned no usable content. Please restate the request with the target papers or the exact change you want.';
    }

    return [
      `I have ${papers.length} paper(s) in the current scope, but the request still needs the exact change to apply.`,
      'Please provide the new title for each paper, or a clear rename rule such as adding a prefix/suffix.',
      scopedPapers.map((paper, index) => `${index + 1}. ${paper.title}`).join('\n'),
    ].join('\n\n');
  }

  if (scopedPapers.length === 0) {
    return '模型没有返回可用内容。请重新说明目标论文，或补充你希望执行的具体修改。';
  }

  return [
    `当前范围内有 ${papers.length} 篇论文，但还需要你补充具体要怎么改。`,
    '请提供每篇论文的新标题，或给出统一规则，例如“标题前加已读”“去掉标题里的 PDF 编号”“改成 DOI 查询到的正式标题”。',
    scopedPapers.map((paper, index) => `${index + 1}. ${paper.title}`).join('\n'),
  ].join('\n\n');
}

function isLikelyContextSizeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLocaleLowerCase();

  return [
    'context length',
    'maximum context',
    'too many tokens',
    'token limit',
    'request too large',
    'payload too large',
    '413',
  ].some((signal) => normalized.includes(signal));
}

function choiceResultFromRequest(request: LibraryAgentUserChoiceRequest): LibraryAgentRunResult {
  const choices = (Array.isArray(request.options) ? request.options : [])
    .map((option, index) => ({
      id: option.id?.trim() || `option-${index + 1}`,
      label: option.label?.trim() || `选项 ${index + 1}`,
      description: option.description?.trim() || '',
      instruction: option.instruction?.trim() || option.label?.trim() || '',
    }))
    .filter((option) => option.instruction);

  return {
    kind: 'choice',
    answer: [
      request.summary?.trim() || '当前请求存在多个可行路径，请选择下一步。',
      request.reason?.trim() ? `\n${request.reason.trim()}` : '',
    ].filter(Boolean).join('\n'),
    choices,
  };
}

function paperSelectionResultFromContextRequest(
  request: LibraryAgentContextRequest | null | undefined,
  instruction: string,
  thinking?: string | null,
): LibraryAgentRunResult {
  const mode = request?.mode === 'pdf-text' ? 'pdf-text' : 'summary';
  const summary = request?.summary?.trim() || '需要先选择要提供给模型的文献。';
  const reason = request?.reason?.trim() || '当前任务需要论文上下文，但本轮还没有明确的目标文献。';

  return {
    kind: 'paper-selection',
    answer: [summary, reason].filter(Boolean).join('\n\n'),
    request: {
      summary,
      mode,
      reason,
      instruction,
    },
    thinking,
  };
}

function normalizeModelThinking(value: string | null | undefined): string | null {
  const normalized = value?.replace(/<\/?think\b[^>]*>/gi, '').trim();
  return normalized || null;
}

function hasValidUserChoices(request: LibraryAgentUserChoiceRequest | null | undefined): request is LibraryAgentUserChoiceRequest {
  return Boolean(
    request &&
    Array.isArray(request.options) &&
    request.options.some((option) => Boolean(option?.instruction?.trim() || option?.label?.trim())),
  );
}

function resultFromGeneratedResponse({
  response,
  papers,
  contextLabel,
  fallbackTool = 'classify',
  responseLanguage,
  currentPaperScopeIds = [],
}: {
  response: LibraryAgentGeneratedResponse;
  papers: LiteraturePaper[];
  contextLabel: string;
  fallbackTool?: LibraryAgentTool;
  responseLanguage?: string;
  currentPaperScopeIds?: string[];
}): LibraryAgentRunResult | null {
  if (response.kind === 'answer') {
    return {
      kind: 'answer',
      answer: response.answer?.trim() || buildEmptyAgentAnswerFallback(
        currentScopePapers(papers, currentPaperScopeIds),
        responseLanguage,
      ),
      contextLabel,
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  if (response.plan) {
    return {
      kind: 'plan',
      plan: convertGeneratedAgentPlan(response.plan.tool ?? fallbackTool, papers, response.plan),
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  if (response.kind === 'choice-request' && hasValidUserChoices(response.userChoices)) {
    return {
      ...choiceResultFromRequest(response.userChoices),
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  return null;
}

function paperToAgentInput(
  paper: LiteraturePaper,
  context?: PaperContextPayload,
  categoryPathById?: Map<string, string>,
): LibraryAgentPaperInput {
  const categoryPaths = paper.categoryIds.map((id) => categoryPathById?.get(id) ?? id);

  return {
    id: paper.id,
    title: paper.title,
    authors: paperAuthors(paper),
    year: paper.year,
    publication: paper.publication,
    doi: paper.doi,
    url: paper.url,
    abstractText: paper.abstractText,
    aiSummary: paper.aiSummary,
    userNote: paper.userNote,
    contextSource: context?.source ?? null,
    contextText: context?.text ?? null,
    keywords: paper.keywords,
    tags: paper.tags.map((tag) => tag.name).filter(Boolean),
    categoryIds: paper.categoryIds,
    categories: categoryPaths.map((path) => {
      const segments = path.split(' / ');
      return segments[segments.length - 1] ?? path;
    }),
    categoryPaths,
  };
}

function describePaperState(paper: LiteraturePaper): string {
  return [
    paper.title,
    paperAuthors(paper).join(', '),
    paper.year,
    paper.publication,
    paper.doi,
    paper.tags.length > 0 ? `tags: ${paper.tags.map((tag) => tag.name).join('、')}` : '',
  ].filter(Boolean).join(' · ');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstStringFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stringValue(item))
      .filter((item): item is string => Boolean(item));

    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const items = value
      .split(/[,\n;；、]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function firstStringArrayFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  for (const key of keys) {
    const value = stringArrayValue(record[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function firstObjectFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record[key];

    if (isObjectRecord(value)) {
      return value;
    }
  }

  return undefined;
}

function isLibraryAgentTool(value: string): value is LibraryAgentTool {
  return ['rename', 'metadata', 'smart-tags', 'clean-tags', 'classify'].includes(value);
}

function normalizeGeneratedTool(
  value: string | null | undefined,
  fallbackTool: string | null | undefined,
): LibraryAgentTool {
  const aliases: Record<string, LibraryAgentTool> = {
    rename: 'rename',
    rename_papers: 'rename',
    batch_rename: 'rename',
    metadata: 'metadata',
    update_paper_metadata: 'metadata',
    metadata_completion: 'metadata',
    smart_tags: 'smart-tags',
    smart_tag: 'smart-tags',
    'smart-tags': 'smart-tags',
    update_paper_tags: 'smart-tags',
    clean_tags: 'clean-tags',
    clean_tag: 'clean-tags',
    'clean-tags': 'clean-tags',
    clean_paper_tags: 'clean-tags',
    classify: 'classify',
    classification: 'classify',
    classify_papers: 'classify',
    auto_classify: 'classify',
  };
  const candidates = [value, fallbackTool]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const normalized = candidate.toLocaleLowerCase().replace(/\s+/g, '_');
    const tool = aliases[normalized] ?? aliases[normalized.replace(/-/g, '_')];

    if (tool) {
      return tool;
    }

    if (isLibraryAgentTool(candidate)) {
      return candidate;
    }
  }

  return 'classify';
}

function generatedPlanItems(generatedPlan: LibraryAgentGeneratedPlan): LibraryAgentGeneratedItem[] {
  const record = generatedPlan as Record<string, unknown>;
  const args = firstObjectFromRecord(record, ['arguments', 'parameters', 'args']);
  const candidates = [
    generatedPlan.items,
    generatedPlan.updates,
    generatedPlan.paperUpdates,
    generatedPlan.papers,
    record.paper_items,
    record.paperUpdates,
    args?.items,
    args?.updates,
    args?.paperUpdates,
    args?.papers,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isObjectRecord) as LibraryAgentGeneratedItem[];
    }
  }

  return [];
}

function generatedPlanTool(generatedPlan: LibraryAgentGeneratedPlan): string | null | undefined {
  const record = generatedPlan as Record<string, unknown>;
  const args = firstObjectFromRecord(record, ['arguments', 'parameters', 'args']);

  return (
    stringValue(generatedPlan.tool) ||
    firstStringFromRecord(record, ['tool', 'name', 'functionName']) ||
    (args ? firstStringFromRecord(args, ['tool', 'name', 'functionName']) : undefined)
  );
}

function generatedPaperId(item: LibraryAgentGeneratedItem): string | undefined {
  const record = item as Record<string, unknown>;

  return firstStringFromRecord(record, [
    'paperId',
    'paperID',
    'paper_id',
    'id',
    'itemId',
    'item_id',
  ]);
}

function normalizeGeneratedPaperUpdate(value: unknown): LibraryAgentPaperUpdate | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { title: value.trim() };
  }

  if (!isObjectRecord(value)) {
    return undefined;
  }

  const update: LibraryAgentPaperUpdate = {};
  const title = firstStringFromRecord(value, [
    'title',
    'newTitle',
    'targetTitle',
    'updatedTitle',
    'after',
    'afterTitle',
    'titleAfter',
  ]);
  const year = firstStringFromRecord(value, ['year', 'publicationYear']);
  const publication = firstStringFromRecord(value, ['publication', 'venue', 'journal', 'conference']);
  const doi = firstStringFromRecord(value, ['doi', 'DOI']);
  const url = firstStringFromRecord(value, ['url', 'URL', 'link']);
  const abstractText = firstStringFromRecord(value, ['abstractText', 'abstract', 'summary']);
  const keywords = firstStringArrayFromRecord(value, ['keywords', 'keyword']);
  const tags = firstStringArrayFromRecord(value, ['tags', 'tagNames', 'tag']);
  const authors = firstStringArrayFromRecord(value, ['authors', 'creators']);

  if (title) update.title = title;
  if (year) update.year = year;
  if (publication) update.publication = publication;
  if (doi) update.doi = doi;
  if (url) update.url = url;
  if (abstractText) update.abstractText = abstractText;
  if (keywords) update.keywords = keywords;
  if (tags) update.tags = tags;
  if (authors) update.authors = authors;

  return Object.keys(update).length > 0 ? update : undefined;
}

function inferRenameTitleFromGeneratedItem(
  paper: LiteraturePaper,
  item: LibraryAgentGeneratedItem,
): string | undefined {
  const record = item as Record<string, unknown>;
  const title = firstStringFromRecord(record, [
    'after',
    'newTitle',
    'targetTitle',
    'updatedTitle',
    'afterTitle',
    'titleAfter',
  ]);

  if (!title || title === paper.title) {
    return undefined;
  }

  return title;
}

function updateRequestFromGeneratedAgentItem(
  paper: LiteraturePaper,
  item: LibraryAgentGeneratedItem,
  tool: LibraryAgentTool,
): UpdatePaperRequest | undefined {
  const record = item as Record<string, unknown>;
  const explicitUpdate =
    normalizeGeneratedPaperUpdate(record.update) ??
    normalizeGeneratedPaperUpdate(record.updateRequest) ??
    normalizeGeneratedPaperUpdate(record.changes) ??
    normalizeGeneratedPaperUpdate(record.patch);

  if (tool !== 'rename') {
    return updateRequestFromAgentItem(paper, explicitUpdate);
  }

  const renameTitle = explicitUpdate?.title?.trim() || inferRenameTitleFromGeneratedItem(paper, item);

  return updateRequestFromAgentItem(paper, {
    ...(explicitUpdate ?? {}),
    title: renameTitle,
  });
}

function updateRequestFromAgentItem(
  paper: LiteraturePaper,
  update: LibraryAgentPaperUpdate | null | undefined,
): UpdatePaperRequest | undefined {
  if (!update) {
    return undefined;
  }

  const request: UpdatePaperRequest = { paperId: paper.id };
  let changed = false;
  const assignString = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    let normalized = nextValue?.trim();

    if (
      key === 'title' &&
      normalized &&
      normalizeComparable(normalized) === normalizeComparable(stripKnownReadPrefix(paper.title))
    ) {
      normalized = stripKnownReadPrefix(paper.title);
    }

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    (request[key] as string | null | undefined) = normalized;
    changed = true;
  };
  const assignArray = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string[],
    nextValue: string[] | null | undefined,
  ) => {
    const normalized = uniqueTags(nextValue ?? []);

    if (
      normalized.length === 0 ||
      normalized.join('\n').toLocaleLowerCase() === currentValue.join('\n').toLocaleLowerCase()
    ) {
      return;
    }

    (request[key] as string[] | undefined) = normalized;
    changed = true;
  };

  assignString('title', paper.title, update.title);
  assignString('year', paper.year, update.year);
  assignString('publication', paper.publication, update.publication);
  assignString('doi', paper.doi, update.doi);
  assignString('url', paper.url, update.url);
  assignString('abstractText', paper.abstractText, update.abstractText);
  assignArray('keywords', paper.keywords, update.keywords);
  assignArray('tags', paper.tags.map((tag) => tag.name), update.tags);

  const nextAuthors = update.authors?.map((author) => author.trim()).filter(Boolean) ?? [];

  if (
    nextAuthors.length > 0 &&
    nextAuthors.join('\n').toLocaleLowerCase() !== paperAuthors(paper).join('\n').toLocaleLowerCase()
  ) {
    request.authors = nextAuthors;
    changed = true;
  }

  return changed ? request : undefined;
}

function convertGeneratedAgentPlan(
  fallbackTool: LibraryAgentTool | string | null | undefined,
  papers: LiteraturePaper[],
  generatedPlan: LibraryAgentGeneratedPlan,
): LibraryAgentPlan {
  const tool = normalizeGeneratedTool(generatedPlanTool(generatedPlan), fallbackTool);
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const generatedItems = generatedPlanItems(generatedPlan);
  const items = generatedItems
    .map((item, index): LibraryAgentPlanItem | null => {
      const record = item as Record<string, unknown>;
      const paperId = generatedPaperId(item);
      const paper = paperId ? paperById.get(paperId) : undefined;

      if (!paper) {
        return null;
      }

      const updateRequest = updateRequestFromGeneratedAgentItem(paper, item, tool);
      const targetCategoryName = firstStringFromRecord(record, [
        'targetCategoryName',
        'categoryName',
        'collectionName',
        'targetCollectionName',
      ]);

      if (!updateRequest && !targetCategoryName) {
        return null;
      }

      const before = firstStringFromRecord(record, ['before', 'oldTitle', 'currentTitle', 'from']);
      const after = firstStringFromRecord(record, [
        'after',
        'newTitle',
        'targetTitle',
        'updatedTitle',
        'afterTitle',
        'titleAfter',
        'to',
      ]);

      return {
        id: `${paper.id}:${tool}:llm:${index}`,
        tool,
        paperId: paper.id,
        paperTitle: paper.title,
        title: firstStringFromRecord(record, ['title', 'label']) || 'Agent 工具调用',
        description: firstStringFromRecord(record, ['description', 'summary']) || '模型通过 tool call 生成的计划项。',
        before: before || describePaperState(paper),
        after:
          after ||
          [
            updateRequest?.title,
            updateRequest?.authors?.join(', '),
            updateRequest?.year,
            updateRequest?.publication,
            updateRequest?.doi,
            updateRequest?.tags ? `tags: ${updateRequest.tags.join('、')}` : '',
            targetCategoryName,
          ].filter(Boolean).join(' · '),
        updateRequest,
        targetCategoryName,
        targetCategoryParentName:
          firstStringFromRecord(record, ['targetCategoryParentName', 'categoryParentName', 'parentCategoryName']) ||
          AUTO_CLASSIFY_PARENT_NAME,
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId(tool),
    tool,
    title: `大模型工具调用：${generatedPlan.summary || tool}`,
    description: generatedPlan.summary || `模型返回 ${items.length} 个 tool call 计划项。`,
    items,
    createdAt: Date.now(),
  };
}

function isLikelyAgentStreamUnsupportedError(message: string): boolean {
  const normalized = message.toLocaleLowerCase();

  return [
    'stream',
    'sse',
    'event-stream',
    'readable body',
    'readablestream',
  ].some((signal) => normalized.includes(signal));
}

async function generateLibraryAgentPlanOpenAICompatible(
  options: OpenAICompatibleLibraryAgentOptions,
  streamHandlers?: LibraryAgentStreamHandlers,
): Promise<LibraryAgentGeneratedResponse> {
  try {
    if (streamHandlers) {
      const requestId = crypto.randomUUID();
      let answer = '';
      let thinking = '';
      let streamError = '';
      const unlisten = await listen<LibraryAgentStreamEventPayload>(AGENT_STREAM_EVENT, (event) => {
        const payload = event.payload;

        if (!payload || payload.requestId !== requestId) {
          return;
        }

        if (payload.kind === 'delta' || payload.kind === 'answer-delta') {
          const delta = payload.text ?? '';

          if (!delta) {
            return;
          }

          answer += delta;
          streamHandlers.onDelta?.(delta, answer);
          return;
        }

        if (payload.kind === 'thinking-delta') {
          const delta = payload.text ?? '';

          if (!delta) {
            return;
          }

          thinking += delta;
          streamHandlers.onThinkingDelta?.(delta, thinking);
          return;
        }

        if (payload.kind === 'error') {
          streamError = payload.error || 'Agent stream failed';
          return;
        }

        streamHandlers.onDone?.();
      });

      try {
        const response = await invoke<LibraryAgentGeneratedResponse>('generate_library_agent_plan_openai_compatible_stream', {
          requestId,
          options,
        });

        if (streamError) {
          throw new Error(streamError);
        }

        return response;
      } catch (error) {
        const message = toErrorMessage(error, streamError || 'Agent stream request failed');

        if (isLikelyAgentStreamUnsupportedError(message)) {
          return await invoke<LibraryAgentGeneratedResponse>('generate_library_agent_plan_openai_compatible', {
            options,
          });
        }

        streamHandlers.onError?.(message);
        throw new Error(message);
      } finally {
        unlisten();
      }
    }

    return await invoke<LibraryAgentGeneratedResponse>('generate_library_agent_plan_openai_compatible', {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用大模型 Agent 工具失败'));
  }
}

async function decideLibraryAgentPaperContextOpenAICompatible(
  options: OpenAICompatibleLibraryAgentOptions,
): Promise<LibraryAgentPaperContextDecision | null> {
  if (!Array.isArray(options.papers) || options.papers.length === 0) {
    return null;
  }

  try {
    return await invoke<LibraryAgentPaperContextDecision>('decide_library_agent_paper_context_openai_compatible', {
      options,
    });
  } catch (error) {
    console.warn('Failed to run paper-context decision', error);
    return null;
  }
}

async function retryWithoutUserChoice({
  papers,
  categories = [],
  instruction,
  preset,
  streamHandlers,
  responseLanguage,
  historyMessages = [],
  currentPaperScopeIds = [],
  paperScopes = [],
  contextLabel,
  paperInputs,
  reason,
}: {
  papers: LiteraturePaper[];
  categories?: LiteratureCategory[];
  instruction: string;
  preset: LibraryAgentModelPreset;
  streamHandlers?: LibraryAgentStreamHandlers;
  responseLanguage?: string;
  historyMessages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
  contextLabel: string;
  paperInputs?: LibraryAgentPaperInput[];
  reason?: string;
}): Promise<LibraryAgentRunResult> {
  const categoryPayload = buildAgentCategoryPayload(categories);
  const retryResponse = await generateLibraryAgentPlanOpenAICompatible(
    {
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey.trim(),
      model: preset.model,
      apiMode: preset.apiMode,
      temperature: preset.temperature,
      reasoningEffort: preset.reasoningEffort,
      responseLanguage,
      allowContextRequest: false,
      tool: 'auto',
      instruction: [
        instruction,
        '',
        'The user has already selected the target papers for this turn.',
        'Do not return kind "choice-request" or "context-request".',
        'If the request is actionable, return kind "plan" with reviewable items for the selected papers.',
        'If the request is underspecified, return kind "answer" and ask one concise clarification question.',
        reason ? `Previous invalid response reason: ${reason}` : '',
      ].filter(Boolean).join('\n'),
      messages: historyMessages,
      currentPaperScopeIds,
      paperScopes,
      categories: categoryPayload.categories,
      papers: paperInputs ?? papers.map((paper) => paperToAgentInput(
        paper,
        undefined,
        categoryPayload.categoryPathById,
      )),
    },
    streamHandlers,
  );

  const parsed = resultFromGeneratedResponse({
    response: retryResponse,
    papers,
    contextLabel,
    responseLanguage,
    currentPaperScopeIds,
  });

  if (parsed) {
    return parsed;
  }

  return {
    kind: 'answer',
    contextLabel,
    answer: [
      '已收到本轮选择的论文，但模型没有返回可执行计划。',
      '请补充标题修改规则或目标标题，例如“把标题改成 DOI 查询到的正式标题”或“给标题前加上已读”。',
    ].join('\n'),
    thinking: normalizeModelThinking(retryResponse.thinking),
  };
}

async function requestDynamicUserChoices({
  papers,
  categories = [],
  instruction,
  previousAnswer,
  preset,
  streamHandlers,
  responseLanguage,
  historyMessages = [],
  currentPaperScopeIds = [],
  paperScopes = [],
}: {
  papers: LiteraturePaper[];
  categories?: LiteratureCategory[];
  instruction: string;
  previousAnswer: string;
  preset: LibraryAgentModelPreset;
  streamHandlers?: LibraryAgentStreamHandlers;
  responseLanguage?: string;
  historyMessages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
}): Promise<LibraryAgentRunResult> {
  const categoryPayload = buildAgentCategoryPayload(categories);
  const response = await generateLibraryAgentPlanOpenAICompatible(
    {
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey.trim(),
      model: preset.model,
      apiMode: preset.apiMode,
      temperature: preset.temperature,
      reasoningEffort: preset.reasoningEffort,
      responseLanguage,
      allowContextRequest: true,
      tool: 'auto',
      instruction: [
        instruction,
        '',
        'Your previous draft was not actionable enough because it only said the answer was based on metadata or suggested loading more content.',
        `Previous draft: ${previousAnswer}`,
        'Do not answer directly. Call present_user_options and generate 2 to 5 dynamic next-step choices tailored to this request and these papers. Each option must include an executable instruction for the app to run if the user clicks it.',
      ].join('\n'),
      messages: historyMessages,
      currentPaperScopeIds,
      paperScopes,
      categories: categoryPayload.categories,
      papers: papers.map((paper) => paperToAgentInput(paper, undefined, categoryPayload.categoryPathById)),
    },
    streamHandlers,
  );

  if (response.kind === 'choice-request' && hasValidUserChoices(response.userChoices)) {
    return {
      ...choiceResultFromRequest(response.userChoices),
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  const parsed = resultFromGeneratedResponse({
    response,
    papers,
    contextLabel: 'metadata only',
    responseLanguage,
    currentPaperScopeIds,
  });

  if (parsed) {
    return parsed;
  }

  if (response.kind === 'answer') {
    return {
      kind: 'answer',
      answer: response.answer?.trim() || previousAnswer,
      contextLabel: 'metadata only',
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  if (response.plan) {
    return {
      kind: 'plan',
      plan: convertGeneratedAgentPlan(response.plan.tool ?? 'classify', papers, response.plan),
      thinking: normalizeModelThinking(response.thinking),
    };
  }

  return {
    kind: 'answer',
    answer: previousAnswer,
    contextLabel: 'metadata only',
    thinking: normalizeModelThinking(response.thinking),
  };
}

export async function buildToolUseLibraryAgentPlan({
  tool,
  papers,
  categories = [],
  instruction,
  preset,
}: {
  tool: LibraryAgentTool;
  papers: LiteraturePaper[];
  categories?: LiteratureCategory[];
  instruction?: string;
  preset: LibraryAgentModelPreset;
}): Promise<LibraryAgentPlan> {
  if (!preset.baseUrl.trim() || !preset.apiKey.trim() || !preset.model.trim()) {
    throw new Error('请先在设置里配置支持 tool/function calling 的 OpenAI-compatible 模型。');
  }

  const categoryPayload = buildAgentCategoryPayload(categories);
  const generatedResponse = await generateLibraryAgentPlanOpenAICompatible({
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey.trim(),
    model: preset.model,
    apiMode: preset.apiMode,
    temperature: preset.temperature,
    reasoningEffort: preset.reasoningEffort,
    tool,
    instruction,
    categories: categoryPayload.categories,
    papers: papers.map((paper) => paperToAgentInput(paper, undefined, categoryPayload.categoryPathById)),
  });
  const generatedPlan = generatedResponse.plan;

  if (!generatedPlan) {
    throw new Error('模型没有返回可审查的工具计划。');
  }

  return convertGeneratedAgentPlan(tool, papers, generatedPlan);
}

export async function runConversationalLibraryAgent({
  papers,
  categories = [],
  instruction,
  preset,
  streamHandlers,
  historyMessages = [],
  currentPaperScopeIds = [],
  paperScopes = [],
  responseLanguage,
  ragEnabled = true,
}: {
  papers: LiteraturePaper[];
  categories?: LiteratureCategory[];
  instruction: string;
  preset: LibraryAgentModelPreset;
  streamHandlers?: LibraryAgentStreamHandlers;
  historyMessages?: LibraryAgentConversationMessage[];
  currentPaperScopeIds?: string[];
  paperScopes?: LibraryAgentPaperScopeInput[];
  responseLanguage?: string;
  ragEnabled?: boolean;
}): Promise<LibraryAgentRunResult> {
  if (!preset.baseUrl.trim() || !preset.apiKey.trim() || !preset.model.trim()) {
    throw new Error('请先在设置里配置支持 tool/function calling 的 OpenAI-compatible 模型。');
  }

  const normalizedInstruction = instruction.trim();
  const instructionForModel = buildAgentInstructionWithHistory(normalizedInstruction, historyMessages);
  const categoryPayload = buildAgentCategoryPayload(categories);

  if (!normalizedInstruction) {
    throw new Error('请输入要让 Agent 执行的文库整理指令。');
  }
  const metadataContextLabel = papers.length > 0 ? 'metadata only' : 'general chat';
  const paperInputsWithoutContext = papers.map((paper) => paperToAgentInput(
    paper,
    undefined,
    categoryPayload.categoryPathById,
  ));
  const paperContextDecision = await decideLibraryAgentPaperContextOpenAICompatible(
    {
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey.trim(),
      model: preset.model,
      apiMode: preset.apiMode,
      temperature: preset.temperature,
      reasoningEffort: preset.reasoningEffort,
      responseLanguage,
      allowContextRequest: true,
      tool: 'auto',
      instruction: instructionForModel,
      messages: historyMessages,
      currentPaperScopeIds,
      paperScopes,
      categories: categoryPayload.categories,
      papers: paperInputsWithoutContext,
    },
  );

  if (paperContextDecision?.action === 'ask-user-to-select-papers' && paperContextDecision.paperIds.length === 0) {
    return paperSelectionResultFromContextRequest(
      {
        summary: paperContextDecision.summary,
        mode: paperContextDecision.mode,
        reason: paperContextDecision.reason,
        paperIds: [],
      },
      normalizedInstruction,
      normalizeModelThinking(paperContextDecision.thinking),
    );
  }

  const generatedResponse = paperContextDecision?.action === 'load-context'
    ? {
      kind: 'context-request' as const,
      thinking: paperContextDecision.thinking,
      contextRequest: {
        summary: paperContextDecision.summary,
        mode: paperContextDecision.mode,
        reason: paperContextDecision.reason,
        paperIds: paperContextDecision.paperIds,
      },
    }
    : await generateLibraryAgentPlanOpenAICompatible(
    {
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey.trim(),
      model: preset.model,
      apiMode: preset.apiMode,
      temperature: preset.temperature,
      reasoningEffort: preset.reasoningEffort,
      responseLanguage,
      allowContextRequest: true,
      tool: 'auto',
      instruction: instructionForModel,
      messages: historyMessages,
      currentPaperScopeIds,
      paperScopes,
      categories: categoryPayload.categories,
      papers: paperInputsWithoutContext,
    },
    streamHandlers,
  );

  if (generatedResponse.kind === 'answer') {
    const answer = generatedResponse.answer?.trim() || buildEmptyAgentAnswerFallback(
      currentScopePapers(papers, currentPaperScopeIds),
      responseLanguage,
    );

    if (isInsufficientMetadataOnlyAnswer(answer)) {
      return requestDynamicUserChoices({
        papers,
        categories,
        instruction: instructionForModel,
        previousAnswer: answer,
        preset,
        streamHandlers,
        responseLanguage,
        historyMessages,
        currentPaperScopeIds,
        paperScopes,
      });
    }

    return {
      kind: 'answer',
      contextLabel: metadataContextLabel,
      answer,
      thinking: normalizeModelThinking(generatedResponse.thinking),
    };
  }

  if (generatedResponse.kind === 'choice-request') {
    if (!hasValidUserChoices(generatedResponse.userChoices)) {
      if (papers.length > 0) {
        return retryWithoutUserChoice({
          papers,
          categories,
          instruction: instructionForModel,
          preset,
          streamHandlers,
          responseLanguage,
          historyMessages,
          currentPaperScopeIds,
          paperScopes,
          contextLabel: metadataContextLabel,
          reason: 'Model returned choice-request without valid options even though target papers were already provided.',
        });
      }

      return paperSelectionResultFromContextRequest(
        null,
        normalizedInstruction,
        normalizeModelThinking(generatedResponse.thinking),
      );
    }

    if (!generatedResponse.userChoices) {
      throw new Error('模型请求用户选择，但没有返回有效选项。');
    }

    return {
      ...choiceResultFromRequest(generatedResponse.userChoices),
      thinking: normalizeModelThinking(generatedResponse.thinking),
    };
  }

  if (generatedResponse.kind === 'context-request') {
    const contextRequest = generatedResponse.contextRequest;
    const thinking = normalizeModelThinking(generatedResponse.thinking);
    const effectiveContextRequest = buildEffectiveContextRequest(
      contextRequest,
      papers,
      currentPaperScopeIds,
    );
    const contextPapers = currentScopePapers(papers, effectiveContextRequest?.paperIds ?? currentPaperScopeIds);

    if (!effectiveContextRequest) {
      return paperSelectionResultFromContextRequest(contextRequest, normalizedInstruction, thinking);
    }

    if (contextPapers.length === 0) {
      return paperSelectionResultFromContextRequest(effectiveContextRequest, normalizedInstruction, thinking);
    }

    const enrichedContext = await buildPapersWithRequestedContext(contextPapers, effectiveContextRequest, preset, {
      ragEnabled,
      categoryPathById: categoryPayload.categoryPathById,
    });
    let enrichedResponse: LibraryAgentGeneratedResponse;

    try {
      enrichedResponse = await generateLibraryAgentPlanOpenAICompatible(
        {
          baseUrl: preset.baseUrl,
          apiKey: preset.apiKey.trim(),
          model: preset.model,
          apiMode: preset.apiMode,
          temperature: preset.temperature,
          reasoningEffort: preset.reasoningEffort,
          responseLanguage,
          allowContextRequest: false,
          tool: 'auto',
          instruction: [
            instructionForModel,
            '',
            'The app has loaded the paper context requested by the previous tool call.',
            `Context mode: ${effectiveContextRequest.mode}.`,
            `Context reason: ${effectiveContextRequest.reason}.`,
            `Context paperIds: ${effectiveContextRequest.paperIds?.join(', ') || 'current selected papers'}.`,
            'Use the provided contextText fields when answering. Do not call request_paper_context again unless the loaded context is empty for all target papers.',
          ].join('\n'),
          messages: historyMessages,
          currentPaperScopeIds,
          paperScopes,
          categories: categoryPayload.categories,
          papers: enrichedContext.inputs,
        },
        streamHandlers,
      );
    } catch (contextError) {
      if (!isLikelyContextSizeError(contextError)) {
        throw contextError;
      }

      return requestDynamicUserChoices({
        papers,
        categories,
        instruction: [
          instructionForModel,
          '',
          `The app tried to send ${enrichedContext.label}, but the model request failed, likely because the context was too large or the network rejected the large payload.`,
          'Offer dynamic next-step choices such as summary-only context, narrowing the selected papers, metadata-only answer, or metadata completion when appropriate.',
        ].join('\n'),
        previousAnswer: contextError instanceof Error ? contextError.message : String(contextError),
        preset,
        streamHandlers,
        responseLanguage,
        historyMessages,
        currentPaperScopeIds,
        paperScopes,
      });
    }

    if (enrichedResponse.kind === 'answer') {
      return {
        kind: 'answer',
        answer: enrichedResponse.answer?.trim() || buildEmptyAgentAnswerFallback(
          currentScopePapers(papers, currentPaperScopeIds),
          responseLanguage,
        ),
        contextLabel: enrichedContext.label,
        thinking: normalizeModelThinking(enrichedResponse.thinking),
      };
    }

    if (enrichedResponse.kind === 'choice-request') {
      if (!hasValidUserChoices(enrichedResponse.userChoices)) {
        return retryWithoutUserChoice({
          papers,
          categories,
          instruction: [
            instructionForModel,
            '',
            `The app already loaded ${enrichedContext.label} for the selected papers.`,
            'Do not ask the user to choose papers again.',
          ].join('\n'),
          preset,
          streamHandlers,
          responseLanguage,
          historyMessages,
          currentPaperScopeIds,
          paperScopes,
          contextLabel: enrichedContext.label,
          paperInputs: enrichedContext.inputs,
          reason: 'Model returned choice-request without valid options after paper context was loaded.',
        });
      }

      if (!enrichedResponse.userChoices) {
        throw new Error('模型请求用户选择，但没有返回有效选项。');
      }

      return {
        ...choiceResultFromRequest(enrichedResponse.userChoices),
        thinking: normalizeModelThinking(enrichedResponse.thinking),
      };
    }

    if (enrichedResponse.kind === 'context-request') {
      throw new Error('模型已经读取过一次文献上下文，但仍继续请求上下文。请减少选中的论文数量，或直接指定要分析的文献。');
    }

    if (!enrichedResponse.plan) {
      throw new Error('模型没有返回可审查的工具计划。');
    }

      return {
        kind: 'plan',
        plan: convertGeneratedAgentPlan(enrichedResponse.plan.tool ?? 'classify', contextPapers, enrichedResponse.plan),
        thinking: normalizeModelThinking(enrichedResponse.thinking),
      };
  }

  if (!generatedResponse.plan) {
    throw new Error('模型没有返回可审查的工具计划。');
  }

  return {
    kind: 'plan',
    plan: convertGeneratedAgentPlan(generatedResponse.plan.tool ?? 'classify', papers, generatedResponse.plan),
    thinking: normalizeModelThinking(generatedResponse.thinking),
  };
}
