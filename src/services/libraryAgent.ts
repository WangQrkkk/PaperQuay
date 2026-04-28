import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  listLibraryCategories,
  updateLibraryPaper,
} from './library';
import { invoke } from '@tauri-apps/api/core';
import { lookupLiteratureMetadata } from './metadata';
import { readLocalBinaryFile } from './desktop';
import { readReaderConfigFile } from './readerConfig';
import { extractPdfTextByPdfJs } from './summarySource';
import type {
  CreateCategoryRequest,
  LiteratureCategory,
  LiteraturePaper,
  UpdatePaperRequest,
} from '../types/library';
import type { MetadataLookupResult } from '../types/metadata';
import type {
  ModelRuntimeConfig,
  ModelReasoningEffort,
  QaModelPreset,
  ReaderConfigFile,
  ReaderSecrets,
  ReaderSettings,
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
}

interface OpenAICompatibleLibraryAgentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  reasoningEffort?: ModelReasoningEffort;
  responseLanguage?: string;
  allowContextRequest?: boolean;
  tool: LibraryAgentToolChoice;
  instruction?: string | null;
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
  paperId: string;
  title?: string | null;
  description?: string | null;
  before?: string | null;
  after?: string | null;
  update?: LibraryAgentPaperUpdate | null;
  targetCategoryName?: string | null;
  targetCategoryParentName?: string | null;
}

interface LibraryAgentGeneratedPlan {
  tool?: LibraryAgentTool | null;
  summary: string;
  items: LibraryAgentGeneratedItem[];
}

interface LibraryAgentGeneratedResponse {
  kind: 'answer' | 'plan' | 'context-request' | 'choice-request';
  answer?: string | null;
  plan?: LibraryAgentGeneratedPlan | null;
  contextRequest?: LibraryAgentContextRequest | null;
  userChoices?: LibraryAgentUserChoiceRequest | null;
}

export type LibraryAgentRunResult =
  | { kind: 'answer'; answer: string; contextLabel: string }
  | { kind: 'choice'; answer: string; choices: LibraryAgentUserChoice[] }
  | { kind: 'plan'; plan: LibraryAgentPlan };

interface LibraryAgentContextRequest {
  summary: string;
  mode: 'summary' | 'pdf-text';
  paperIds: string[];
  reason: string;
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
  options: LibraryAgentUserChoice[];
}

export interface LibraryAgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
}

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const AUTO_CLASSIFY_PARENT_NAME = 'Agent 自动归类';
const GENERIC_COLLECTION_NAMES = new Set([
  'A',
  'An',
  'And',
  'Are',
  'As',
  'Based',
  'By',
  'For',
  'From',
  'In',
  'Into',
  'Is',
  'Method',
  'Methods',
  'Model',
  'Models',
  'New',
  'Of',
  'On',
  'Paper',
  'Problem',
  'Research',
  'Study',
  'The',
  'This',
  'To',
  'Using',
  'With',
  '方法',
  '模型',
  '研究',
  '论文',
  '问题',
  '系统',
  '一种',
  '一个',
  '基于',
]);

const tagAliases = new Map<string, string>([
  ['ai', 'AI'],
  ['artificial intelligence', 'AI'],
  ['人工智能', 'AI'],
  ['ml', 'Machine Learning'],
  ['machine learning', 'Machine Learning'],
  ['机器学习', 'Machine Learning'],
  ['dl', 'Deep Learning'],
  ['deep learning', 'Deep Learning'],
  ['深度学习', 'Deep Learning'],
  ['llm', 'LLM'],
  ['llms', 'LLM'],
  ['large language model', 'LLM'],
  ['large language models', 'LLM'],
  ['大语言模型', 'LLM'],
  ['nlp', 'NLP'],
  ['natural language processing', 'NLP'],
  ['自然语言处理', 'NLP'],
  ['cv', 'Computer Vision'],
  ['computer vision', 'Computer Vision'],
  ['计算机视觉', 'Computer Vision'],
  ['rl', 'Reinforcement Learning'],
  ['reinforcement learning', 'Reinforcement Learning'],
  ['强化学习', 'Reinforcement Learning'],
  ['uav', 'UAV'],
  ['uavs', 'UAV'],
  ['drone', 'UAV'],
  ['drones', 'UAV'],
  ['unmanned aerial vehicle', 'UAV'],
  ['unmanned aerial vehicles', 'UAV'],
  ['无人机', 'UAV'],
  ['robot', 'Robotics'],
  ['robots', 'Robotics'],
  ['robotics', 'Robotics'],
  ['机器人', 'Robotics'],
  ['optimization', 'Optimization'],
  ['optimisation', 'Optimization'],
  ['优化', 'Optimization'],
  ['survey', 'Survey'],
  ['review', 'Survey'],
  ['综述', 'Survey'],
]);

const tagRules: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'UAV', pattern: /\b(uav|uavs|drone|drones|unmanned aerial)\b|无人机/i },
  { tag: 'LLM', pattern: /\b(llm|llms|large language model|transformer)\b|大语言模型|语言模型/i },
  { tag: 'Machine Learning', pattern: /\b(machine learning|ml)\b|机器学习/i },
  { tag: 'Deep Learning', pattern: /\b(deep learning|neural network|deep belief)\b|深度学习|神经网络/i },
  { tag: 'Reinforcement Learning', pattern: /\b(reinforcement learning|rl|markov decision|mdp)\b|强化学习/i },
  { tag: 'Optimization', pattern: /\b(optimization|optimisation|scheduling|allocation)\b|优化|调度|分配/i },
  { tag: 'Robotics', pattern: /\b(robot|robotics|manipulator)\b|机器人/i },
  { tag: 'Computer Vision', pattern: /\b(computer vision|image|segmentation|detection)\b|计算机视觉|图像|检测/i },
  { tag: 'NLP', pattern: /\b(nlp|natural language processing|language model)\b|自然语言处理/i },
  { tag: 'Survey', pattern: /\b(survey|review|overview)\b|综述|回顾/i },
];

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
    config.reasoningEffort === 'high'
      ? config.reasoningEffort
      : 'auto';

  return { temperature, reasoningEffort };
}

export async function loadLibraryAgentModelPreset(): Promise<LibraryAgentModelPreset | null> {
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
  const presets = Array.isArray(secrets.qaModelPresets) ? secrets.qaModelPresets : [];
  const preferredId =
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

function normalizeComparable(value: string): string {
  return value
    .trim()
    .replace(/[，、；;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function titleCaseEnglish(value: string): string {
  if (!/^[a-z][a-z0-9 -]+$/i.test(value)) {
    return value;
  }

  const minorWords = new Set(['and', 'or', 'of', 'for', 'the', 'in', 'on', 'to', 'with']);

  return value
    .split(/\s+/)
    .map((part, index) => {
      if (index > 0 && minorWords.has(part.toLocaleLowerCase())) {
        return part.toLocaleLowerCase();
      }

      return part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase();
    })
    .join(' ');
}

export function normalizeAgentTagName(rawName: string): string {
  const normalized = rawName
    .trim()
    .replace(/^#+/, '')
    .replace(/[，、；;]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return '';
  }

  const comparable = normalizeComparable(normalized);
  const alias = tagAliases.get(comparable);

  return alias ?? titleCaseEnglish(normalized);
}

function uniqueTags(tags: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const normalized = normalizeAgentTagName(tag);
    const key = normalizeComparable(normalized);

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function paperPdfPath(paper: LiteraturePaper): string | null {
  const storedPath = paper.attachments
    .find((attachment) => attachment.kind === 'pdf' && attachment.storedPath.trim())
    ?.storedPath
    .trim();

  return storedPath || null;
}

function paperAuthors(paper: LiteraturePaper): string[] {
  return paper.authors.map((author) => author.name.trim()).filter(Boolean);
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
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content.trim()}`)
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

async function loadPaperContext(
  paper: LiteraturePaper,
  mode: LibraryAgentContextRequest['mode'],
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
    const pdfData = await readLocalBinaryFile(pdfPath);
    const pdfText = await extractPdfTextByPdfJs(pdfData);
    const normalizedPdfText = normalizeAgentContext(pdfText);

    if (normalizedPdfText) {
      return {
        source: 'pdf-text',
        text: normalizedPdfText,
      };
    }
  } catch (error) {
    console.warn('Failed to load Agent PDF context', error);
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
): Promise<{ inputs: LibraryAgentPaperInput[]; label: string }> {
  const requestedIds = new Set(request.paperIds.filter(Boolean));
  const targetPapers = requestedIds.size > 0
    ? papers.filter((paper) => requestedIds.has(paper.id))
    : papers;
  const targetIds = new Set(targetPapers.map((paper) => paper.id));
  const contextByPaperId = new Map<string, PaperContextPayload>();

  for (const paper of targetPapers) {
    contextByPaperId.set(paper.id, await loadPaperContext(paper, request.mode));
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
    )),
    label,
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
  const choices = request.options
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

function paperToAgentInput(
  paper: LiteraturePaper,
  context?: PaperContextPayload,
): LibraryAgentPaperInput {
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
    const normalized = nextValue?.trim();

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
  fallbackTool: LibraryAgentTool,
  papers: LiteraturePaper[],
  generatedPlan: LibraryAgentGeneratedPlan,
): LibraryAgentPlan {
  const tool = generatedPlan.tool ?? fallbackTool;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const items = generatedPlan.items
    .map((item, index): LibraryAgentPlanItem | null => {
      const paper = paperById.get(item.paperId);

      if (!paper) {
        return null;
      }

      const updateRequest = updateRequestFromAgentItem(paper, item.update);
      const targetCategoryName = item.targetCategoryName?.trim() || undefined;

      if (!updateRequest && !targetCategoryName) {
        return null;
      }

      return {
        id: `${paper.id}:${tool}:llm:${index}`,
        tool,
        paperId: paper.id,
        paperTitle: paper.title,
        title: item.title?.trim() || 'Agent 工具调用',
        description: item.description?.trim() || '模型通过 tool call 生成的计划项。',
        before: item.before?.trim() || describePaperState(paper),
        after:
          item.after?.trim() ||
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
        targetCategoryParentName: item.targetCategoryParentName?.trim() || AUTO_CLASSIFY_PARENT_NAME,
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

async function generateLibraryAgentPlanOpenAICompatible(
  options: OpenAICompatibleLibraryAgentOptions,
): Promise<LibraryAgentGeneratedResponse> {
  try {
    return await invoke<LibraryAgentGeneratedResponse>('generate_library_agent_plan_openai_compatible', {
      options,
    });
  } catch (error) {
    throw new Error(toErrorMessage(error, '调用大模型 Agent 工具失败'));
  }
}

async function requestDynamicUserChoices({
  papers,
  instruction,
  previousAnswer,
  preset,
  responseLanguage,
}: {
  papers: LiteraturePaper[];
  instruction: string;
  previousAnswer: string;
  preset: LibraryAgentModelPreset;
  responseLanguage?: string;
}): Promise<LibraryAgentRunResult> {
  const response = await generateLibraryAgentPlanOpenAICompatible({
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey.trim(),
    model: preset.model,
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
    papers: papers.map((paper) => paperToAgentInput(paper)),
  });

  if (response.kind === 'choice-request' && response.userChoices) {
    return choiceResultFromRequest(response.userChoices);
  }

  if (response.kind === 'answer') {
    return {
      kind: 'answer',
      answer: response.answer?.trim() || previousAnswer,
      contextLabel: 'metadata only',
    };
  }

  if (response.plan) {
    return {
      kind: 'plan',
      plan: convertGeneratedAgentPlan(response.plan.tool ?? 'classify', papers, response.plan),
    };
  }

  return {
    kind: 'choice',
    answer: previousAnswer,
    choices: [],
  };
}

export async function buildToolUseLibraryAgentPlan({
  tool,
  papers,
  instruction,
  preset,
}: {
  tool: LibraryAgentTool;
  papers: LiteraturePaper[];
  instruction?: string;
  preset: LibraryAgentModelPreset;
}): Promise<LibraryAgentPlan> {
  if (!preset.baseUrl.trim() || !preset.apiKey.trim() || !preset.model.trim()) {
    throw new Error('请先在设置里配置支持 tool/function calling 的 OpenAI-compatible 模型。');
  }

  const generatedResponse = await generateLibraryAgentPlanOpenAICompatible({
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey.trim(),
    model: preset.model,
    temperature: preset.temperature,
    reasoningEffort: preset.reasoningEffort,
    tool,
    instruction,
    papers: papers.map((paper) => paperToAgentInput(paper)),
  });
  const generatedPlan = generatedResponse.plan;

  if (!generatedPlan) {
    throw new Error('模型没有返回可审查的工具计划。');
  }

  return convertGeneratedAgentPlan(tool, papers, generatedPlan);
}

export async function runConversationalLibraryAgent({
  papers,
  instruction,
  preset,
  historyMessages = [],
  responseLanguage,
}: {
  papers: LiteraturePaper[];
  instruction: string;
  preset: LibraryAgentModelPreset;
  historyMessages?: LibraryAgentConversationMessage[];
  responseLanguage?: string;
}): Promise<LibraryAgentRunResult> {
  if (!preset.baseUrl.trim() || !preset.apiKey.trim() || !preset.model.trim()) {
    throw new Error('请先在设置里配置支持 tool/function calling 的 OpenAI-compatible 模型。');
  }

  const normalizedInstruction = instruction.trim();
  const instructionForModel = buildAgentInstructionWithHistory(normalizedInstruction, historyMessages);

  if (!normalizedInstruction) {
    throw new Error('请输入要让 Agent 执行的文库整理指令。');
  }

  const generatedResponse = await generateLibraryAgentPlanOpenAICompatible({
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey.trim(),
    model: preset.model,
    temperature: preset.temperature,
    reasoningEffort: preset.reasoningEffort,
    responseLanguage,
    allowContextRequest: true,
    tool: 'auto',
    instruction: instructionForModel,
    papers: papers.map((paper) => paperToAgentInput(paper)),
  });

  if (generatedResponse.kind === 'answer') {
    const answer = generatedResponse.answer?.trim() || '模型没有返回有效回答。';

    if (isInsufficientMetadataOnlyAnswer(answer)) {
      return requestDynamicUserChoices({
        papers,
        instruction: instructionForModel,
        previousAnswer: answer,
        preset,
        responseLanguage,
      });
    }

    return {
      kind: 'answer',
      contextLabel: 'metadata only',
      answer: generatedResponse.answer?.trim() || '模型没有返回有效回答。',
    };
  }

  if (generatedResponse.kind === 'choice-request') {
    if (!generatedResponse.userChoices) {
      throw new Error('模型请求用户选择，但没有返回有效选项。');
    }

    return choiceResultFromRequest(generatedResponse.userChoices);
  }

  if (generatedResponse.kind === 'context-request') {
    const contextRequest = generatedResponse.contextRequest;

    if (!contextRequest) {
      throw new Error('模型请求了文献上下文，但没有返回有效的上下文参数。');
    }

    const enrichedContext = await buildPapersWithRequestedContext(papers, contextRequest);
    let enrichedResponse: LibraryAgentGeneratedResponse;

    try {
      enrichedResponse = await generateLibraryAgentPlanOpenAICompatible({
        baseUrl: preset.baseUrl,
        apiKey: preset.apiKey.trim(),
        model: preset.model,
        temperature: preset.temperature,
        reasoningEffort: preset.reasoningEffort,
        responseLanguage,
        allowContextRequest: false,
        tool: 'auto',
        instruction: [
          instructionForModel,
          '',
          'The app has loaded the paper context requested by the previous tool call.',
          `Context mode: ${contextRequest.mode}.`,
          `Context reason: ${contextRequest.reason}.`,
          'Use the provided contextText fields when answering. Do not call request_paper_context again unless the loaded context is empty for all target papers.',
        ].join('\n'),
        papers: enrichedContext.inputs,
      });
    } catch (contextError) {
      if (!isLikelyContextSizeError(contextError)) {
        throw contextError;
      }

      return requestDynamicUserChoices({
        papers,
        instruction: [
          instructionForModel,
          '',
          `The app tried to send ${enrichedContext.label}, but the model request failed, likely because the context was too large or the network rejected the large payload.`,
          'Offer dynamic next-step choices such as summary-only context, narrowing the selected papers, metadata-only answer, or metadata completion when appropriate.',
        ].join('\n'),
        previousAnswer: contextError instanceof Error ? contextError.message : String(contextError),
        preset,
        responseLanguage,
      });
    }

    if (enrichedResponse.kind === 'answer') {
      return {
        kind: 'answer',
        answer: enrichedResponse.answer?.trim() || '模型没有返回有效回答。',
        contextLabel: enrichedContext.label,
      };
    }

    if (enrichedResponse.kind === 'choice-request') {
      if (!enrichedResponse.userChoices) {
        throw new Error('模型请求用户选择，但没有返回有效选项。');
      }

      return choiceResultFromRequest(enrichedResponse.userChoices);
    }

    if (enrichedResponse.kind === 'context-request') {
      throw new Error('模型已经读取过一次文献上下文，但仍继续请求上下文。请减少选中的论文数量，或直接指定要分析的文献。');
    }

    if (!enrichedResponse.plan) {
      throw new Error('模型没有返回可审查的工具计划。');
    }

    return {
      kind: 'plan',
      plan: convertGeneratedAgentPlan(enrichedResponse.plan.tool ?? 'classify', papers, enrichedResponse.plan),
    };
  }

  if (!generatedResponse.plan) {
    throw new Error('模型没有返回可审查的工具计划。');
  }

  return {
    kind: 'plan',
    plan: convertGeneratedAgentPlan(generatedResponse.plan.tool ?? 'classify', papers, generatedResponse.plan),
  };
}

function metadataUpdateForPaper(
  paper: LiteraturePaper,
  metadata: MetadataLookupResult,
): UpdatePaperRequest | null {
  const request: UpdatePaperRequest = { paperId: paper.id };
  let changed = false;

  const assignString = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    const normalized = nextValue?.trim();

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    (request[key] as string | null | undefined) = normalized;
    changed = true;
  };

  assignString('title', paper.title, metadata.title);
  assignString('year', paper.year, metadata.year);
  assignString('publication', paper.publication, metadata.publication);
  assignString('doi', paper.doi, metadata.doi);
  assignString('url', paper.url, metadata.url);
  assignString('abstractText', paper.abstractText, metadata.abstractText);

  const nextAuthors = metadata.authors.map((author) => author.trim()).filter(Boolean);

  if (nextAuthors.length > 0) {
    const currentAuthors = paperAuthors(paper);

    if (
      nextAuthors.join('\n').toLocaleLowerCase() !== currentAuthors.join('\n').toLocaleLowerCase()
    ) {
      request.authors = nextAuthors;
      changed = true;
    }
  }

  return changed ? request : null;
}

export function parseRenameCommand(command: string): RenameOperation | null {
  const normalized = command.trim();

  if (!normalized) {
    return null;
  }

  const replaceMatch = normalized.match(/把\s*(.+?)\s*(?:替换成|改成|换成)\s*(.+)$/);

  if (replaceMatch) {
    return {
      mode: 'replace',
      from: replaceMatch[1].trim(),
      to: replaceMatch[2].trim(),
    };
  }

  const prefixMatch = normalized.match(/(?:前面|开头|标题前|名字前)\s*(?:加上|添加|加)\s*(.+)$/);

  if (prefixMatch) {
    return { mode: 'prefix', value: prefixMatch[1].trim() };
  }

  const suffixMatch = normalized.match(/(?:后面|末尾|结尾|标题后|名字后)?\s*(?:加上|添加|加)\s*(.+)$/);

  if (suffixMatch) {
    return { mode: 'suffix', value: suffixMatch[1].trim() };
  }

  return { mode: 'suffix', value: normalized };
}

function renameTitle(title: string, operation: RenameOperation): string {
  if (operation.mode === 'prefix') {
    return `${operation.value}${title}`;
  }

  if (operation.mode === 'suffix') {
    return `${title}${operation.value}`;
  }

  return title.split(operation.from).join(operation.to);
}

export function buildRenamePlan(
  papers: LiteraturePaper[],
  operation: RenameOperation,
): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const nextTitle = renameTitle(paper.title, operation).trim();

      if (!nextTitle || nextTitle === paper.title) {
        return null;
      }

      return {
        id: `${paper.id}:rename`,
        tool: 'rename',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '重命名论文标题',
        description: `${paper.title} -> ${nextTitle}`,
        before: paper.title,
        after: nextTitle,
        updateRequest: {
          paperId: paper.id,
          title: nextTitle,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('rename'),
    tool: 'rename',
    title: '批量重命名论文',
    description: `准备更新 ${items.length} 篇文献标题。`,
    items,
    createdAt: Date.now(),
  };
}

export async function buildMetadataCompletionPlan(
  papers: LiteraturePaper[],
  onProgress?: (message: string) => void,
): Promise<LibraryAgentPlan> {
  const items: LibraryAgentPlanItem[] = [];

  for (const [index, paper] of papers.entries()) {
    onProgress?.(`正在补全元数据 ${index + 1}/${papers.length}: ${paper.title}`);

    const metadata = await lookupLiteratureMetadata({
      doi: paper.doi,
      title: paper.title,
      path: paperPdfPath(paper),
    });

    if (!metadata) {
      continue;
    }

    const updateRequest = metadataUpdateForPaper(paper, metadata);

    if (!updateRequest) {
      continue;
    }

    const changedFields = Object.keys(updateRequest).filter((key) => key !== 'paperId');

    items.push({
      id: `${paper.id}:metadata`,
      tool: 'metadata',
      paperId: paper.id,
      paperTitle: paper.title,
      title: '自动补全文献元数据',
      description: `来源：${metadata.source}；字段：${changedFields.join(', ')}`,
      before: [
        paper.title,
        paperAuthors(paper).join(', '),
        paper.year,
        paper.publication,
        paper.doi,
      ].filter(Boolean).join(' · '),
      after: [
        updateRequest.title ?? paper.title,
        updateRequest.authors?.join(', ') ?? paperAuthors(paper).join(', '),
        updateRequest.year ?? paper.year,
        updateRequest.publication ?? paper.publication,
        updateRequest.doi ?? paper.doi,
      ].filter(Boolean).join(' · '),
      updateRequest,
      metadataSource: metadata.source,
    });
  }

  return {
    id: newPlanId('metadata'),
    tool: 'metadata',
    title: '自动补全元数据',
    description: `识别到 ${items.length} 条可更新记录。`,
    items,
    createdAt: Date.now(),
  };
}

export function inferSmartTagsForPaper(paper: LiteraturePaper): string[] {
  const sourceText = [
    paper.title,
    paper.publication,
    paper.abstractText,
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ].filter(Boolean).join('\n');
  const inferred = tagRules
    .filter((rule) => rule.pattern.test(sourceText))
    .map((rule) => rule.tag);

  return uniqueTags([
    ...paper.tags.map((tag) => tag.name),
    ...paper.keywords,
    ...inferred,
  ]).slice(0, 8);
}

function collectionCandidateText(paper: LiteraturePaper): string {
  return [
    paper.title,
    paper.publication,
    paper.abstractText,
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ].filter(Boolean).join('\n');
}

function extractEnglishPhrases(value: string): string[] {
  const phrases: string[] = [];
  const matches = value.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z]?[A-Za-z0-9]+){0,4}\b/g);

  for (const match of matches) {
    const phrase = titleCaseEnglish(match[0].replace(/\s+/g, ' ').trim());
    const words = phrase.split(/\s+/);

    if (phrase.length < 3 || phrase.length > 52) {
      continue;
    }

    if (words.length === 1 && GENERIC_COLLECTION_NAMES.has(phrase)) {
      continue;
    }

    if (words.every((word) => GENERIC_COLLECTION_NAMES.has(word))) {
      continue;
    }

    phrases.push(phrase);
  }

  return phrases;
}

function extractChinesePhrases(value: string): string[] {
  const phrases: string[] = [];
  const matches = value.matchAll(/[\u4e00-\u9fa5]{2,12}/g);

  for (const match of matches) {
    const phrase = match[0].trim();

    if (GENERIC_COLLECTION_NAMES.has(phrase)) {
      continue;
    }

    phrases.push(phrase);
  }

  return phrases;
}

function scoreCollectionCandidate(candidate: string, sourceText: string): number {
  const comparable = normalizeComparable(candidate);
  const lowerText = sourceText.toLocaleLowerCase();
  const occurrenceCount = lowerText.split(comparable).length - 1;
  const wordCount = candidate.split(/\s+/).length;
  const isKnownAlias = tagAliases.has(comparable);

  return occurrenceCount * 3 + Math.min(wordCount, 4) + (isKnownAlias ? 5 : 0);
}

export function inferCollectionNameForPaper(paper: LiteraturePaper): string {
  const sourceText = collectionCandidateText(paper);
  const candidates = [
    ...inferSmartTagsForPaper(paper),
    ...paper.keywords,
    ...paper.tags.map((tag) => tag.name),
    ...extractEnglishPhrases(sourceText),
    ...extractChinesePhrases(sourceText),
  ]
    .map(normalizeAgentTagName)
    .filter(Boolean)
    .filter((candidate) => !GENERIC_COLLECTION_NAMES.has(candidate));
  const ranked = new Map<string, { label: string; score: number }>();

  for (const candidate of candidates) {
    const key = normalizeComparable(candidate);
    const previous = ranked.get(key);
    const score = scoreCollectionCandidate(candidate, sourceText);

    if (!previous || score > previous.score) {
      ranked.set(key, { label: candidate, score });
    }
  }

  return [...ranked.values()].sort((left, right) => right.score - left.score)[0]?.label ?? '未命名主题';
}

export function buildSmartTagPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const currentTags = uniqueTags(paper.tags.map((tag) => tag.name));
      const nextTags = inferSmartTagsForPaper(paper);

      if (
        nextTags.length === currentTags.length &&
        nextTags.every((tag, index) => normalizeComparable(tag) === normalizeComparable(currentTags[index]))
      ) {
        return null;
      }

      return {
        id: `${paper.id}:smart-tags`,
        tool: 'smart-tags',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '智能标签建议',
        description: `建议标签：${nextTags.join('、') || '无'}`,
        before: currentTags.join('、') || '无标签',
        after: nextTags.join('、') || '无标签',
        updateRequest: {
          paperId: paper.id,
          tags: nextTags,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('smart-tags'),
    tool: 'smart-tags',
    title: '智能标签',
    description: `准备为 ${items.length} 篇文献更新标签。`,
    items,
    createdAt: Date.now(),
  };
}

export function buildCleanTagsPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers
    .map((paper): LibraryAgentPlanItem | null => {
      const currentTags = paper.tags.map((tag) => tag.name.trim()).filter(Boolean);
      const nextTags = uniqueTags(currentTags);

      if (
        nextTags.length === currentTags.length &&
        nextTags.every((tag, index) => tag === currentTags[index])
      ) {
        return null;
      }

      return {
        id: `${paper.id}:clean-tags`,
        tool: 'clean-tags',
        paperId: paper.id,
        paperTitle: paper.title,
        title: '标签清洗 / 合并',
        description: '合并大小写、同义词和重复标签。',
        before: currentTags.join('、') || '无标签',
        after: nextTags.join('、') || '无标签',
        updateRequest: {
          paperId: paper.id,
          tags: nextTags,
        },
      };
    })
    .filter((item): item is LibraryAgentPlanItem => item !== null);

  return {
    id: newPlanId('clean-tags'),
    tool: 'clean-tags',
    title: '标签清洗 / 合并',
    description: `准备清洗 ${items.length} 篇文献的标签。`,
    items,
    createdAt: Date.now(),
  };
}

export function buildAutoClassifyPlan(papers: LiteraturePaper[]): LibraryAgentPlan {
  const items = papers.map((paper): LibraryAgentPlanItem => {
    const categoryName = inferCollectionNameForPaper(paper);

    return {
      id: `${paper.id}:classify:${categoryName}`,
      tool: 'classify',
      paperId: paper.id,
      paperTitle: paper.title,
      title: '自动归类 Collection',
      description: `加入 ${AUTO_CLASSIFY_PARENT_NAME} / ${categoryName}`,
      before: paper.categoryIds.length > 0 ? `${paper.categoryIds.length} 个已有分类` : '未分类',
      after: `${AUTO_CLASSIFY_PARENT_NAME} / ${categoryName}`,
      targetCategoryName: categoryName,
      targetCategoryParentName: AUTO_CLASSIFY_PARENT_NAME,
    };
  });

  return {
    id: newPlanId('classify'),
    tool: 'classify',
    title: '自动归类 Collection',
    description: `准备为 ${items.length} 篇文献加入自动分类。`,
    items,
    createdAt: Date.now(),
  };
}

function categoryKey(name: string, parentId: string | null): string {
  return `${parentId ?? 'root'}::${normalizeComparable(name)}`;
}

async function ensureCategory(
  categories: LiteratureCategory[],
  request: CreateCategoryRequest,
): Promise<{ category: LiteratureCategory; categories: LiteratureCategory[] }> {
  const expectedKey = categoryKey(request.name, request.parentId ?? null);
  const existing = categories.find(
    (category) => categoryKey(category.name, category.parentId) === expectedKey,
  );

  if (existing) {
    return { category: existing, categories };
  }

  const category = await createLibraryCategory(request);

  return {
    category,
    categories: [...categories, category],
  };
}

export async function applyLibraryAgentPlan(
  plan: LibraryAgentPlan,
  itemIds: Set<string>,
): Promise<ApplyLibraryAgentPlanResult> {
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  let categories = await listLibraryCategories();

  for (const item of plan.items) {
    if (!itemIds.has(item.id)) {
      continue;
    }

    try {
      if (item.updateRequest) {
        await updateLibraryPaper(item.updateRequest);
        applied += 1;
        continue;
      }

      if (item.tool === 'classify' && item.targetCategoryName) {
        const parentResult = await ensureCategory(categories, {
          name: item.targetCategoryParentName ?? AUTO_CLASSIFY_PARENT_NAME,
          parentId: null,
        });
        categories = parentResult.categories;

        const childResult = await ensureCategory(categories, {
          name: item.targetCategoryName,
          parentId: parentResult.category.id,
        });
        categories = childResult.categories;

        await assignPaperToLibraryCategory({
          paperId: item.paperId,
          categoryId: childResult.category.id,
        });
        applied += 1;
        continue;
      }
    } catch (error) {
      failed += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { applied, failed, errors };
}
