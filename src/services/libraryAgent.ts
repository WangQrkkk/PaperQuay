import { invoke } from '@tauri-apps/api/core';
import { readLocalBinaryFile } from './desktop';
import {
  paperAuthors,
  paperPdfPath,
  uniqueTags,
} from './libraryAgentPlanHelpers';
import { readReaderConfigFile } from './readerConfig';
import { extractPdfTextByPdfJs } from './summarySource';
import type { LiteraturePaper, UpdatePaperRequest } from '../types/library';
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

const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';
const SECRETS_STORAGE_KEY = 'paper-reader-secrets-v1';
const AUTO_CLASSIFY_PARENT_NAME = 'Agent 自动归类';

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
