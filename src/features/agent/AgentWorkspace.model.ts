import { FileSearch, FolderTree, Sparkles, Tags, WandSparkles } from 'lucide-react';
import type { LibraryAgentPlan, LibraryAgentTool } from '../../services/libraryAgent';
import type { LiteraturePaper } from '../../types/library';
import type { DocumentChatAttachment, UiLanguage } from '../../types/reader';
import type {
  AgentCapability,
  AgentChatMessage,
  AgentHistorySession,
  AgentStepStatus,
  AgentToolCallView,
  AgentTraceStep,
} from './AgentWorkspace.types';

const AGENT_HISTORY_STORAGE_KEY = 'paperquay-agent-history-v1';
const MAX_AGENT_HISTORY_SESSIONS = 30;

function pickLocaleText<T>(locale: UiLanguage, zh: T, en: T): T {
  return locale === 'en-US' ? en : zh;
}

export const agentCapabilities: AgentCapability[] = [
  {
    key: 'rename',
    functionName: 'rename_papers',
    title: '批量重命名',
    titleEn: 'Batch Rename',
    description: '添加、替换、规范化或重写论文标题。',
    descriptionEn: 'Add, replace, normalize, or rewrite paper titles.',
    icon: WandSparkles,
  },
  {
    key: 'metadata',
    functionName: 'update_paper_metadata',
    title: '元数据补全',
    titleEn: 'Metadata Completion',
    description: '补全标题、作者、年份、期刊、DOI、摘要和关键词。',
    descriptionEn: 'Complete title, authors, year, venue, DOI, abstract, and keywords.',
    icon: FileSearch,
  },
  {
    key: 'smart-tags',
    functionName: 'update_paper_tags',
    title: '智能标签',
    titleEn: 'Smart Tags',
    description: '根据标题、摘要和关键词生成学术标签。',
    descriptionEn: 'Generate academic tags from titles, abstracts, and keywords.',
    icon: Sparkles,
  },
  {
    key: 'clean-tags',
    functionName: 'clean_paper_tags',
    title: '标签清洗',
    titleEn: 'Tag Cleanup',
    description: '合并同义词、大小写变体、重复标签和拼写差异。',
    descriptionEn: 'Merge synonyms, casing variants, duplicate tags, and spelling variants.',
    icon: Tags,
  },
  {
    key: 'classify',
    functionName: 'classify_papers',
    title: '自动归类',
    titleEn: 'Auto Classification',
    description: '动态创建 Collection，并把论文归入合适主题。',
    descriptionEn: 'Create dynamic Collections and classify papers into suitable topics.',
    icon: FolderTree,
  },
];

export const promptSuggestions = [
  '把选中的论文标题的前面加上已读',
  '给这些论文自动补全元数据，只修改有把握的字段',
  '清理这些论文的标签，合并同义词并移除重复项',
  '根据研究主题给这些论文自动归类到新的 Collection',
  '给这些论文生成 3 到 6 个简洁的学术标签',
];

export const promptSuggestionsEn = [
  'Add "Read" to the beginning of the selected paper titles',
  'Auto-complete metadata for these papers, only changing well-supported fields',
  'Clean these paper tags by merging synonyms and removing duplicates',
  'Create dynamic Collections and classify these papers by research topic',
  'Generate 3 to 6 concise academic tags for these papers',
];

export function newAgentSessionId(): string {
  return `agent-session:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function newMessageId(): string {
  return `agent-message:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeMessage(message: AgentChatMessage | undefined, locale: UiLanguage): string {
  if (!message) {
    return pickLocaleText(locale, '等待新的 Agent 指令', 'Waiting for a new Agent instruction');
  }

  return stripMarkdown(message.content).slice(0, 88) || pickLocaleText(locale, '空消息', 'Empty message');
}

function sessionStatusFromMessages(messages: AgentChatMessage[]): AgentStepStatus {
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');

  if (latestAssistant?.error) {
    return 'error';
  }

  const trace = latestAssistant?.trace;
  const latestTraceStatus = trace?.[trace.length - 1]?.status;

  return latestTraceStatus ?? 'success';
}

export function buildAgentHistorySession({
  id,
  messages,
  selectedPaperIds,
  lastInstruction,
  ragEnabled = true,
  selectedModelPresetId,
  attachments = [],
  locale = 'zh-CN',
}: {
  id: string;
  messages: AgentChatMessage[];
  selectedPaperIds: string[];
  lastInstruction: string;
  ragEnabled?: boolean;
  selectedModelPresetId?: string;
  attachments?: DocumentChatAttachment[];
  locale?: UiLanguage;
}): AgentHistorySession {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const title = latestUserMessage
    ? summarizeMessage(latestUserMessage, locale)
    : pickLocaleText(locale, '新的 Agent 对话', 'New Agent Chat');
  const summary = latestAssistantMessage?.meta
    ? `${latestAssistantMessage.meta} · ${summarizeMessage(latestAssistantMessage, locale)}`
    : summarizeMessage(latestAssistantMessage, locale);

  return {
    id,
    title,
    summary,
    updatedAt: Date.now(),
    messages,
    selectedPaperIds,
    lastInstruction,
    ragEnabled,
    selectedModelPresetId,
    attachments,
    status: sessionStatusFromMessages(messages),
  };
}

export function loadAgentHistorySessions(): AgentHistorySession[] {
  try {
    const rawValue = window.localStorage.getItem(AGENT_HISTORY_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is AgentHistorySession => Boolean(item && typeof item === 'object' && item.id))
      .slice(0, MAX_AGENT_HISTORY_SESSIONS);
  } catch {
    return [];
  }
}

export function saveAgentHistorySessions(sessions: AgentHistorySession[]) {
  const normalized = sessions
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_AGENT_HISTORY_SESSIONS);

  window.localStorage.setItem(AGENT_HISTORY_STORAGE_KEY, JSON.stringify(normalized));
}

export function paperAuthors(paper: LiteraturePaper, locale: UiLanguage = 'zh-CN'): string {
  return paper.authors.length > 0
    ? paper.authors.map((author) => author.name).join(', ')
    : pickLocaleText(locale, '未知作者', 'Unknown author');
}

export function formatPaperMeta(paper: LiteraturePaper, locale: UiLanguage = 'zh-CN'): string {
  return [paperAuthors(paper, locale), paper.year, paper.publication].filter(Boolean).join(' · ');
}

export function capabilityForTool(tool: LibraryAgentTool): AgentCapability {
  return agentCapabilities.find((item) => item.key === tool) ?? agentCapabilities[0];
}

export function capabilityTitle(tool: LibraryAgentTool, locale: UiLanguage = 'zh-CN'): string {
  const capability = capabilityForTool(tool);
  return pickLocaleText(locale, capability.title, capability.titleEn);
}

export function capabilityDescription(tool: LibraryAgentTool, locale: UiLanguage = 'zh-CN'): string {
  const capability = capabilityForTool(tool);
  return pickLocaleText(locale, capability.description, capability.descriptionEn);
}

export function toolLabel(tool: LibraryAgentTool, locale: UiLanguage = 'zh-CN'): string {
  return capabilityTitle(tool, locale);
}

export function toolFunctionName(tool: LibraryAgentTool): string {
  return capabilityForTool(tool).functionName;
}

export function durationLabel(durationMs?: number, locale: UiLanguage = 'zh-CN'): string {
  if (typeof durationMs !== 'number') {
    return pickLocaleText(locale, '待执行', 'Pending');
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function paperMatchesQuery(paper: LiteraturePaper, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    paper.title,
    paper.year,
    paper.publication,
    paper.doi,
    paper.url,
    paper.abstractText,
    paperAuthors(paper),
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

export function buildRunningTrace(
  instruction: string,
  paperCount: number,
  locale: UiLanguage = 'zh-CN',
): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: pickLocaleText(locale, '用户意图识别', 'User Intent Recognition'),
      summary: pickLocaleText(locale, `已接收指令：${instruction}`, `Instruction received: ${instruction}`),
      status: 'success',
      durationMs: 120,
      detail: pickLocaleText(
        locale,
        `当前上下文包含 ${paperCount} 篇选中文献。`,
        `The current context contains ${paperCount} selected papers.`,
      ),
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: pickLocaleText(locale, '思路摘要', 'Reasoning Summary'),
      summary: pickLocaleText(
        locale,
        '将请求交给支持 tool/function calling 的模型，由模型选择最合适的工具。',
        'The request is sent to a tool/function-calling model so it can choose the most suitable tool.',
      ),
      status: 'success',
      durationMs: 180,
      detail: pickLocaleText(
        locale,
        '这里只展示可审查的任务摘要，不展示完整推理链。',
        'Only a reviewable task summary is shown here, not the full reasoning chain.',
      ),
    },
    {
      id: 'plan',
      type: 'plan',
      title: pickLocaleText(locale, '任务计划', 'Task Plan'),
      summary: pickLocaleText(locale, '正在生成可审批的执行计划。', 'Generating a reviewable execution plan.'),
      status: 'running',
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: pickLocaleText(locale, '工具调用', 'Tool Call'),
      summary: pickLocaleText(locale, '等待模型返回工具名和参数。', 'Waiting for the model to return the tool name and parameters.'),
      status: 'waiting',
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: pickLocaleText(locale, '工具返回结果', 'Tool Result'),
      summary: pickLocaleText(locale, '等待工具调用结果转换为本地计划项。', 'Waiting to convert the tool result into local plan items.'),
      status: 'waiting',
    },
    {
      id: 'final',
      type: 'final',
      title: pickLocaleText(locale, '最终回答', 'Final Answer'),
      summary: pickLocaleText(locale, '等待生成最终可审查回复。', 'Waiting for the final reviewable response.'),
      status: 'waiting',
    },
  ];
}

export function buildSuccessTrace(
  instruction: string,
  paperCount: number,
  plan: LibraryAgentPlan,
  durationMs: number,
  locale: UiLanguage = 'zh-CN',
): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: pickLocaleText(locale, '用户意图识别', 'User Intent Recognition'),
      summary: pickLocaleText(
        locale,
        `识别到用户希望处理 ${paperCount} 篇文献。`,
        `The Agent identified a request involving ${paperCount} papers.`,
      ),
      status: 'success',
      durationMs: 140,
      detail: instruction,
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: pickLocaleText(locale, '思路摘要', 'Reasoning Summary'),
      summary: pickLocaleText(
        locale,
        `模型选择了“${toolLabel(plan.tool, locale)}”，并返回可审查的工具参数。`,
        `The model selected "${toolLabel(plan.tool, locale)}" and returned reviewable tool parameters.`,
      ),
      status: 'success',
      durationMs: 240,
      detail: pickLocaleText(
        locale,
        '完整推理不展示。这里仅保留任务理解、工具选择和执行摘要，方便用户审查。',
        'Full reasoning is not shown. This keeps only task understanding, tool selection, and execution summary for review.',
      ),
    },
    {
      id: 'plan',
      type: 'plan',
      title: pickLocaleText(locale, '任务计划', 'Task Plan'),
      summary: plan.description || pickLocaleText(locale, `生成 ${plan.items.length} 个计划项。`, `Generated ${plan.items.length} plan items.`),
      status: 'success',
      durationMs: Math.max(300, Math.round(durationMs * 0.24)),
      detail: plan.title,
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: pickLocaleText(locale, '工具调用', 'Tool Call'),
      summary: `${toolFunctionName(plan.tool)} · ${paperCount} papers`,
      status: 'success',
      durationMs: Math.max(500, Math.round(durationMs * 0.56)),
      detail: pickLocaleText(
        locale,
        '模型只返回工具调用参数，本地数据库尚未被修改。',
        'The model only returned tool-call parameters. The local database has not been modified.',
      ),
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: pickLocaleText(locale, '工具返回结果', 'Tool Result'),
      summary: pickLocaleText(
        locale,
        `转换为 ${plan.items.length} 个可勾选计划项。`,
        `Converted into ${plan.items.length} checkable plan items.`,
      ),
      status: 'success',
      durationMs: Math.max(160, Math.round(durationMs * 0.14)),
      detail: pickLocaleText(
        locale,
        '计划项将在用户确认后由本地命令执行。',
        'Plan items will be executed by local commands after user confirmation.',
      ),
    },
    {
      id: 'final',
      type: 'final',
      title: pickLocaleText(locale, '最终回答', 'Final Answer'),
      summary: pickLocaleText(
        locale,
        '已生成执行预览，请在右侧确认、修改或取消。',
        'Execution preview is ready. Confirm, modify, or cancel it on the right.',
      ),
      status: 'success',
      durationMs: Math.max(80, Math.round(durationMs * 0.06)),
    },
  ];
}

export function buildErrorTrace(
  instruction: string,
  paperCount: number,
  errorMessage: string,
  durationMs: number,
  locale: UiLanguage = 'zh-CN',
): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: pickLocaleText(locale, '用户意图识别', 'User Intent Recognition'),
      summary: pickLocaleText(
        locale,
        `已接收指令，目标范围为 ${paperCount} 篇文献。`,
        `Instruction received. Target scope: ${paperCount} papers.`,
      ),
      status: 'success',
      durationMs: 120,
      detail: instruction,
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: pickLocaleText(locale, '思路摘要', 'Reasoning Summary'),
      summary: pickLocaleText(
        locale,
        '准备通过工具调用生成计划，但执行链路中断。',
        'The Agent prepared to generate a tool-based plan, but the execution chain was interrupted.',
      ),
      status: 'success',
      durationMs: 160,
    },
    {
      id: 'plan',
      type: 'plan',
      title: pickLocaleText(locale, '任务计划', 'Task Plan'),
      summary: pickLocaleText(locale, '计划生成失败。', 'Plan generation failed.'),
      status: 'error',
      durationMs,
      detail: errorMessage,
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: pickLocaleText(locale, '工具调用', 'Tool Call'),
      summary: pickLocaleText(locale, '未获得可执行工具调用。', 'No executable tool call was returned.'),
      status: 'error',
      detail: errorMessage,
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: pickLocaleText(locale, '工具返回结果', 'Tool Result'),
      summary: pickLocaleText(locale, '无返回结果。', 'No result returned.'),
      status: 'waiting',
    },
    {
      id: 'final',
      type: 'final',
      title: pickLocaleText(locale, '最终回答', 'Final Answer'),
      summary: pickLocaleText(
        locale,
        '请检查模型配置、API Key 或更换支持 tools/function calling 的模型。',
        'Check the model configuration, API key, or switch to a model that supports tools/function calling.',
      ),
      status: 'error',
    },
  ];
}

export function buildToolCallView(
  plan: LibraryAgentPlan,
  instruction: string,
  paperCount: number,
  durationMs: number,
  locale: UiLanguage = 'zh-CN',
): AgentToolCallView {
  return {
    id: `${plan.id}:tool-call`,
    tool: plan.tool,
    functionName: toolFunctionName(plan.tool),
    status: 'success',
    durationMs,
    parameterSummary: `${paperCount} papers · instruction="${instruction.slice(0, 52)}${instruction.length > 52 ? '...' : ''}"`,
    resultSummary: pickLocaleText(
      locale,
      `${plan.items.length} 个计划项 · ${plan.items.filter((item) => item.updateRequest).length} 个字段更新 · ${plan.items.filter((item) => item.targetCategoryName).length} 个归类建议`,
      `${plan.items.length} plan items · ${plan.items.filter((item) => item.updateRequest).length} field updates · ${plan.items.filter((item) => item.targetCategoryName).length} classification suggestions`,
    ),
    rawParameters: {
      instruction,
      selectedPaperCount: paperCount,
      tool: plan.tool,
      planId: plan.id,
      generatedItems: plan.items.length,
    },
  };
}

export function buildPreviewToolCall(
  instruction: string,
  paperCount: number,
  status: AgentStepStatus,
  locale: UiLanguage = 'zh-CN',
): AgentToolCallView {
  return {
    id: `preview-tool:${Date.now()}`,
    tool: 'classify',
    functionName: 'auto tool selection',
    status,
    parameterSummary: `${paperCount} papers · instruction="${instruction.slice(0, 52)}${instruction.length > 52 ? '...' : ''}"`,
    resultSummary: status === 'error'
      ? pickLocaleText(locale, '工具调用失败', 'Tool call failed')
      : pickLocaleText(locale, '等待模型选择工具', 'Waiting for the model to select a tool'),
    rawParameters: {
      instruction,
      selectedPaperCount: paperCount,
      toolChoice: 'auto',
    },
  };
}

export function uniqueTagNames(papers: LiteraturePaper[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const paper of papers) {
    for (const tag of paper.tags) {
      const name = tag.name.trim();
      const key = name.toLocaleLowerCase();

      if (!name || seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(name);
    }
  }

  return output.slice(0, 12);
}
