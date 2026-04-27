import { FileSearch, FolderTree, Sparkles, Tags, WandSparkles } from 'lucide-react';
import type { LibraryAgentPlan, LibraryAgentTool } from '../../services/libraryAgent';
import type { LiteraturePaper } from '../../types/library';
import type { AgentCapability, AgentStepStatus, AgentToolCallView, AgentTraceStep } from './AgentWorkspace.types';

export const agentCapabilities: AgentCapability[] = [
  {
    key: 'rename',
    functionName: 'rename_papers',
    title: '批量重命名',
    description: '添加、替换、规范化或重写论文标题。',
    icon: WandSparkles,
  },
  {
    key: 'metadata',
    functionName: 'update_paper_metadata',
    title: '元数据补全',
    description: '补全标题、作者、年份、期刊、DOI、摘要和关键词。',
    icon: FileSearch,
  },
  {
    key: 'smart-tags',
    functionName: 'update_paper_tags',
    title: '智能标签',
    description: '根据标题、摘要、关键词生成学术标签。',
    icon: Sparkles,
  },
  {
    key: 'clean-tags',
    functionName: 'clean_paper_tags',
    title: '标签清洗',
    description: '合并同义词、大小写变体、重复标签和拼写差异。',
    icon: Tags,
  },
  {
    key: 'classify',
    functionName: 'classify_papers',
    title: '自动归类',
    description: '动态创建 Collection，并把论文归入合适主题。',
    icon: FolderTree,
  },
];

export const promptSuggestions = [
  '把选中的论文标题后面加 123',
  '给这些论文自动补全元数据，只改有把握的字段',
  '清理这些论文的标签，合并同义词并去掉重复项',
  '根据研究主题给这些论文自动归类到新的 Collection',
  '给这些论文生成 3 到 6 个简洁的学术标签',
];

export function newMessageId(): string {
  return `agent-message:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function paperAuthors(paper: LiteraturePaper): string {
  return paper.authors.length > 0
    ? paper.authors.map((author) => author.name).join(', ')
    : '未知作者';
}

export function formatPaperMeta(paper: LiteraturePaper): string {
  return [paperAuthors(paper), paper.year, paper.publication].filter(Boolean).join(' · ');
}

export function capabilityForTool(tool: LibraryAgentTool): AgentCapability {
  return agentCapabilities.find((item) => item.key === tool) ?? agentCapabilities[0];
}

export function toolLabel(tool: LibraryAgentTool): string {
  return capabilityForTool(tool).title;
}

export function toolFunctionName(tool: LibraryAgentTool): string {
  return capabilityForTool(tool).functionName;
}

export function durationLabel(durationMs?: number): string {
  if (typeof durationMs !== 'number') {
    return '待执行';
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

export function buildRunningTrace(instruction: string, paperCount: number): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: '用户意图识别',
      summary: `已接收指令：${instruction}`,
      status: 'success',
      durationMs: 120,
      detail: `当前上下文包含 ${paperCount} 篇选中文献。`,
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: '思路摘要',
      summary: '将请求交给支持 tool/function calling 的模型，由模型选择最合适的工具。',
      status: 'success',
      durationMs: 180,
      detail: '这里只展示可审查的任务摘要，不展示完整推理链。',
    },
    {
      id: 'plan',
      type: 'plan',
      title: '任务计划',
      summary: '正在生成可审批的执行计划。',
      status: 'running',
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: '工具调用',
      summary: '等待模型返回工具名和参数。',
      status: 'waiting',
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: '工具返回结果',
      summary: '等待工具调用结果转换为本地计划项。',
      status: 'waiting',
    },
    {
      id: 'final',
      type: 'final',
      title: '最终回答',
      summary: '等待生成最终可审查回复。',
      status: 'waiting',
    },
  ];
}

export function buildSuccessTrace(
  instruction: string,
  paperCount: number,
  plan: LibraryAgentPlan,
  durationMs: number,
): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: '用户意图识别',
      summary: `识别到用户希望处理 ${paperCount} 篇文献。`,
      status: 'success',
      durationMs: 140,
      detail: instruction,
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: '思路摘要',
      summary: `模型选择了「${toolLabel(plan.tool)}」，并返回可审查的工具参数。`,
      status: 'success',
      durationMs: 240,
      detail: '完整推理不展示。这里仅保留任务理解、工具选择和执行摘要，方便用户审查。',
    },
    {
      id: 'plan',
      type: 'plan',
      title: '任务计划',
      summary: plan.description || `生成 ${plan.items.length} 个计划项。`,
      status: 'success',
      durationMs: Math.max(300, Math.round(durationMs * 0.24)),
      detail: plan.title,
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: '工具调用',
      summary: `${toolFunctionName(plan.tool)} · ${paperCount} papers`,
      status: 'success',
      durationMs: Math.max(500, Math.round(durationMs * 0.56)),
      detail: '模型只返回工具调用参数，本地数据库尚未被修改。',
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: '工具返回结果',
      summary: `转换为 ${plan.items.length} 个可勾选计划项。`,
      status: 'success',
      durationMs: Math.max(160, Math.round(durationMs * 0.14)),
      detail: '计划项将在用户确认后由本地命令执行。',
    },
    {
      id: 'final',
      type: 'final',
      title: '最终回答',
      summary: '已生成执行预览，请在右侧确认、修改或取消。',
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
): AgentTraceStep[] {
  return [
    {
      id: 'intent',
      type: 'intent',
      title: '用户意图识别',
      summary: `已接收指令，目标范围为 ${paperCount} 篇文献。`,
      status: 'success',
      durationMs: 120,
      detail: instruction,
    },
    {
      id: 'thought-summary',
      type: 'thought-summary',
      title: '思路摘要',
      summary: '准备通过工具调用生成计划，但执行链路中断。',
      status: 'success',
      durationMs: 160,
    },
    {
      id: 'plan',
      type: 'plan',
      title: '任务计划',
      summary: '计划生成失败。',
      status: 'error',
      durationMs,
      detail: errorMessage,
    },
    {
      id: 'tool-call',
      type: 'tool-call',
      title: '工具调用',
      summary: '未获得可执行工具调用。',
      status: 'error',
      detail: errorMessage,
    },
    {
      id: 'tool-result',
      type: 'tool-result',
      title: '工具返回结果',
      summary: '无返回结果。',
      status: 'waiting',
    },
    {
      id: 'final',
      type: 'final',
      title: '最终回答',
      summary: '请检查模型配置、API Key 或更换支持 tools/function calling 的模型。',
      status: 'error',
    },
  ];
}

export function buildToolCallView(
  plan: LibraryAgentPlan,
  instruction: string,
  paperCount: number,
  durationMs: number,
): AgentToolCallView {
  return {
    id: `${plan.id}:tool-call`,
    tool: plan.tool,
    functionName: toolFunctionName(plan.tool),
    status: 'success',
    durationMs,
    parameterSummary: `${paperCount} papers · instruction="${instruction.slice(0, 52)}${instruction.length > 52 ? '...' : ''}"`,
    resultSummary: `${plan.items.length} 个计划项 · ${plan.items.filter((item) => item.updateRequest).length} 个字段更新 · ${plan.items.filter((item) => item.targetCategoryName).length} 个归类建议`,
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
): AgentToolCallView {
  return {
    id: `preview-tool:${Date.now()}`,
    tool: 'classify',
    functionName: 'auto tool selection',
    status,
    parameterSummary: `${paperCount} papers · instruction="${instruction.slice(0, 52)}${instruction.length > 52 ? '...' : ''}"`,
    resultSummary: status === 'error' ? '工具调用失败' : '等待模型选择工具',
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
