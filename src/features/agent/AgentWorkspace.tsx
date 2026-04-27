import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clipboard,
  Database,
  FileText,
  GitBranch,
  Layers3,
  Loader2,
  MessageSquareText,
  Minus,
  Moon,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Tags,
  User,
  X,
} from 'lucide-react';
import {
  applyLibraryAgentPlan,
  buildConversationalLibraryAgentPlan,
  loadLibraryAgentModelPreset,
  type LibraryAgentPlan,
} from '../../services/libraryAgent';
import { listLibraryPapers } from '../../services/library';
import type { LiteraturePaper } from '../../types/library';
import { useThemeStore } from '../../stores/useThemeStore';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import {
  agentCapabilities,
  buildErrorTrace,
  buildPreviewToolCall,
  buildRunningTrace,
  buildSuccessTrace,
  buildToolCallView,
  durationLabel,
  formatPaperMeta,
  newMessageId,
  paperMatchesQuery,
  promptSuggestions,
  toolFunctionName,
  toolLabel,
  uniqueTagNames,
} from './AgentWorkspace.model';
import type { AgentChatMessage, AgentToolCallView } from './AgentWorkspace.types';

interface AgentWorkspaceProps {
  onOpenPreferences?: () => void;
}

function AgentWorkspace({ onOpenPreferences }: AgentWorkspaceProps) {
  const appWindow = getCurrentWindow();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const [paperSearchQuery, setPaperSearchQuery] = useState('');
  const [composerValue, setComposerValue] = useState('把选中的论文标题后面加 123');
  const [lastInstruction, setLastInstruction] = useState('');
  const [agentPresetName, setAgentPresetName] = useState('');
  const [plan, setPlan] = useState<LibraryAgentPlan | null>(null);
  const [approvedItemIds, setApprovedItemIds] = useState<Set<string>>(() => new Set());
  const [expandedStepKeys, setExpandedStepKeys] = useState<Set<string>>(() => new Set());
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const [selectedInspectorItemId, setSelectedInspectorItemId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [
    {
      id: newMessageId(),
      role: 'assistant',
      content:
        '选择左侧文献后，直接用自然语言描述任务。我会自动选择工具，生成可审查执行链路和计划，只有在你确认后才会写入本地文库。',
      meta: '支持重命名、元数据补全、智能标签、标签清洗、自动归类',
      createdAt: Date.now(),
      trace: [
        {
          id: 'welcome-intent',
          type: 'intent',
          title: '等待用户指令',
          summary: '从左侧选择论文，然后输入要执行的任务。',
          status: 'waiting',
        },
      ],
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const filteredPapers = useMemo(
    () => papers.filter((paper) => paperMatchesQuery(paper, paperSearchQuery)),
    [papers, paperSearchQuery],
  );
  const selectedPapers = useMemo(
    () => papers.filter((paper) => selectedPaperIds.has(paper.id)),
    [papers, selectedPaperIds],
  );
  const selectedPlanItems = useMemo(
    () => plan?.items.filter((item) => approvedItemIds.has(item.id)) ?? [],
    [approvedItemIds, plan],
  );
  const selectedTags = useMemo(() => uniqueTagNames(selectedPapers), [selectedPapers]);
  const selectedInspectorItem =
    plan?.items.find((item) => item.id === selectedInspectorItemId) ?? plan?.items[0] ?? null;

  const refreshPapers = async () => {
    setLoading(true);
    setError('');

    try {
      const nextPapers = await listLibraryPapers({
        sortBy: 'manual',
        sortDirection: 'asc',
        limit: 1000,
      });

      setPapers(nextPapers);
      setSelectedPaperIds((current) => {
        const nextIds = new Set(nextPapers.map((paper) => paper.id));
        return new Set([...current].filter((id) => nextIds.has(id)));
      });
      setStatusMessage(`已加载 ${nextPapers.length} 篇文献。`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '加载文库失败';
      setError(message);
      setStatusMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshPapers();
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, working]);

  const updateMessage = (messageId: string, updater: (message: AgentChatMessage) => AgentChatMessage) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const togglePaper = (paperId: string) => {
    setSelectedPaperIds((current) => {
      const next = new Set(current);

      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedPaperIds(new Set(filteredPapers.map((paper) => paper.id)));
  };

  const clearSelection = () => {
    setSelectedPaperIds(new Set());
  };

  const setNextPlan = (nextPlan: LibraryAgentPlan) => {
    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan.items.map((item) => item.id)));
    setSelectedInspectorItemId(nextPlan.items[0]?.id ?? null);
    setStatusMessage(nextPlan.description);
  };

  const appendAssistantMessage = (content: string, meta?: string) => {
    setMessages((current) => [
      ...current,
      {
        id: newMessageId(),
        role: 'assistant',
        content,
        meta,
        createdAt: Date.now(),
      },
    ]);
  };

  const copyToolParameters = async (toolCall: AgentToolCallView) => {
    await navigator.clipboard.writeText(JSON.stringify(toolCall.rawParameters, null, 2));
    setStatusMessage('已复制工具参数。');
  };

  const runAgent = async (rawInstruction: string) => {
    const instruction = rawInstruction.trim();

    if (!instruction) {
      setError('请输入 Agent 指令。');
      return;
    }

    if (selectedPapers.length === 0) {
      setError('请先在左侧选择至少一篇文献。');
      return;
    }

    const startedAt = performance.now();
    const assistantMessageId = newMessageId();
    const paperCount = selectedPapers.length;

    setLastInstruction(instruction);
    setMessages((current) => [
      ...current,
      {
        id: newMessageId(),
        role: 'user',
        content: instruction,
        meta: `作用于 ${paperCount} 篇文献`,
        createdAt: Date.now(),
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '正在识别意图、选择工具并生成可审查计划。',
        meta: 'Agent run started',
        createdAt: Date.now(),
        trace: buildRunningTrace(instruction, paperCount),
        toolCall: buildPreviewToolCall(instruction, paperCount, 'running'),
      },
    ]);
    setExpandedStepKeys((current) => new Set([...current, `${assistantMessageId}:intent`]));
    setComposerValue('');
    setWorking(true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);

    try {
      const preset = loadLibraryAgentModelPreset();

      if (!preset) {
        throw new Error('请先在设置里配置问答/概览模型，Agent 会复用该 OpenAI-compatible 模型配置。');
      }

      setAgentPresetName(preset.label || preset.model);
      setStatusMessage(`正在调用大模型 Agent：${preset.label || preset.model}...`);

      const nextPlan = await buildConversationalLibraryAgentPlan({
        papers: selectedPapers,
        instruction,
        preset,
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const nextToolCall = buildToolCallView(nextPlan, instruction, paperCount, durationMs);

      setNextPlan(nextPlan);
      setExpandedStepKeys((current) => new Set([...current, `${assistantMessageId}:tool-call`, `${assistantMessageId}:tool-result`]));

      updateMessage(assistantMessageId, (message) => ({
        ...message,
        content:
          nextPlan.items.length > 0
            ? `已自动选择「${toolLabel(nextPlan.tool)}」，生成 ${nextPlan.items.length} 个可审查计划项。`
            : `已自动选择「${toolLabel(nextPlan.tool)}」，当前没有需要变更的计划项。`,
        meta: `${toolFunctionName(nextPlan.tool)} · ${durationLabel(durationMs)}`,
        trace: buildSuccessTrace(instruction, paperCount, nextPlan, durationMs),
        toolCall: nextToolCall,
        plan: nextPlan,
      }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '生成 Agent 计划失败';
      const durationMs = Math.round(performance.now() - startedAt);

      setError(message);
      setStatusMessage(message);
      updateMessage(assistantMessageId, (chatMessage) => ({
        ...chatMessage,
        content: message.includes('tool call')
          ? '当前模型没有返回 tool call。请换用支持 OpenAI-compatible tools/function calling 的模型。'
          : `生成计划失败：${message}`,
        meta: `error · ${durationLabel(durationMs)}`,
        trace: buildErrorTrace(instruction, paperCount, message, durationMs),
        toolCall: buildPreviewToolCall(instruction, paperCount, 'error'),
        error: message,
      }));
    } finally {
      setWorking(false);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAgent(composerValue);
  };

  const applyPlan = async () => {
    if (!plan || approvedItemIds.size === 0) {
      setError('没有可执行的计划项。');
      return;
    }

    setWorking(true);
    setError('');
    setStatusMessage(`正在执行 ${approvedItemIds.size} 个计划项...`);

    try {
      const result = await applyLibraryAgentPlan(plan, approvedItemIds);

      await refreshPapers();
      setPlan(null);
      setApprovedItemIds(new Set());
      setSelectedInspectorItemId(null);
      setStatusMessage(`执行完成：成功 ${result.applied}，失败 ${result.failed}。`);
      appendAssistantMessage(
        `已执行计划：成功 ${result.applied} 项，失败 ${result.failed} 项。`,
        result.failed > 0 ? result.errors.join('\n') : 'Local write completed',
      );

      if (result.failed > 0) {
        setError(result.errors.join('\n') || '部分计划项执行失败。');
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '执行 Agent 计划失败';
      setError(message);
      setStatusMessage(message);
      appendAssistantMessage(`执行计划失败：${message}`);
    } finally {
      setWorking(false);
    }
  };

  const cancelPlan = () => {
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setStatusMessage('已取消当前计划。');
  };

  const togglePlanItem = (itemId: string) => {
    setApprovedItemIds((current) => {
      const next = new Set(current);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      return next;
    });
  };

  const toggleStep = (stepKey: string) => {
    setExpandedStepKeys((current) => {
      const next = new Set(current);

      if (next.has(stepKey)) {
        next.delete(stepKey);
      } else {
        next.add(stepKey);
      }

      return next;
    });
  };

  const toggleTool = (toolCallId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);

      if (next.has(toolCallId)) {
        next.delete(toolCallId);
      } else {
        next.add(toolCallId);
      }

      return next;
    });
  };

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[#f6f8fb] text-slate-950 dark:bg-[#0f141b] dark:text-chrome-100">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/82 px-5 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/88">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.20)] dark:bg-teal-300 dark:text-slate-950">
              <Bot className="h-4.5 w-4.5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
                PaperQuay Agent
              </div>
              <div className="mt-0.5 truncate text-sm font-black text-slate-950 dark:text-white">
                论文助手 · 工具调用工作台
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400 md:block">
              {agentPresetName ? `Model · ${agentPresetName}` : 'Model · 使用设置中的问答/概览模型'}
            </div>
            <button
              type="button"
              onClick={() => void refreshPapers()}
              disabled={loading || working}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200 dark:hover:bg-chrome-800"
            >
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={2} />
              刷新
            </button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[350px_minmax(0,1fr)_420px]">
          <aside className="min-h-0 border-r border-slate-200/80 bg-white/70 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/74">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/70 p-4 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                      <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                      上下文文献
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                      已选择 {selectedPaperIds.size} · 当前结果 {filteredPapers.length} · 全部 {papers.length}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      disabled={filteredPapers.length === 0}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      选择结果
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-chrome-900/84 dark:text-chrome-300">
                  <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-chrome-500" strokeWidth={2} />
                  <input
                    value={paperSearchQuery}
                    onChange={(event) => setPaperSearchQuery(event.target.value)}
                    placeholder="搜索标题、作者、年份、标签..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-chrome-100 dark:placeholder:text-chrome-500"
                  />
                </label>

                {selectedTags.length > 0 ? (
                  <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-chrome-950/60">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-chrome-400">
                      <Tags className="h-3.5 w-3.5" />
                      当前标签
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                    正在加载文库...
                  </div>
                ) : papers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    当前文库为空。先在文库工作区导入 PDF，再回到 Agent 页面批处理。
                  </div>
                ) : filteredPapers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    没有匹配的文献。换一个关键词再试。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredPapers.map((paper) => {
                      const selected = selectedPaperIds.has(paper.id);

                      return (
                        <button
                          key={paper.id}
                          type="button"
                          onClick={() => togglePaper(paper.id)}
                          className={[
                            'flex w-full items-start gap-3 rounded-[22px] border p-3 text-left transition',
                            selected
                              ? 'border-teal-300 bg-teal-50 shadow-[0_14px_35px_rgba(20,184,166,0.12)] dark:border-teal-300/30 dark:bg-teal-300/10'
                              : 'border-transparent bg-white/74 hover:border-slate-200 hover:bg-white dark:bg-chrome-900/58 dark:hover:border-white/10 dark:hover:bg-chrome-900',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                              selected
                                ? 'border-teal-500 bg-teal-500 text-white'
                                : 'border-slate-300 bg-white text-transparent dark:border-white/20 dark:bg-chrome-950',
                            ].join(' ')}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-sm font-bold text-slate-950 dark:text-white">
                              {paper.title}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-500 dark:text-chrome-400">
                              {formatPaperMeta(paper) || '暂无元数据'}
                            </span>
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              {paper.tags.slice(0, 4).map((tag) => (
                                <span
                                  key={tag.id}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400"
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-slate-200/70 bg-white/50 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-[#0f141b]/60">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-200">
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    Human-in-the-loop · Tool Use
                  </div>
                  <h1 className="mt-3 text-xl font-black tracking-tight text-slate-950 dark:text-white">
                    对话驱动的论文 Agent 执行链路
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-chrome-300">
                    Agent 会把你的自然语言指令转换成可审查时间线、工具调用和 diff 计划。本地文库只有在你点击确认后才会被修改。
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-white/82 px-3 py-2 text-center dark:border-white/10 dark:bg-chrome-900/70">
                    <div className="text-lg font-black text-slate-950 dark:text-white">{selectedPaperIds.size}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">papers</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/82 px-3 py-2 text-center dark:border-white/10 dark:bg-chrome-900/70">
                    <div className="text-lg font-black text-slate-950 dark:text-white">{plan?.items.length ?? 0}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">steps</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/82 px-3 py-2 text-center dark:border-white/10 dark:bg-chrome-900/70">
                    <div className="text-lg font-black text-slate-950 dark:text-white">{selectedPlanItems.length}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">approved</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-5">
                {agentCapabilities.map((capability) => {
                  const Icon = capability.icon;

                  return (
                    <div
                      key={capability.key}
                      className="rounded-[20px] border border-white/80 bg-white/66 p-3 dark:border-white/10 dark:bg-chrome-900/54"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                        <Icon className="h-3.5 w-3.5 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                        {capability.title}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-slate-400 dark:text-chrome-500">
                        {capability.functionName}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-5xl space-y-5">
                {messages.map((message) => {
                  const isUser = message.role === 'user';

                  if (isUser) {
                    return (
                      <article key={message.id} className="flex items-start justify-end gap-3">
                        <div className="max-w-[72%] rounded-[24px] border border-teal-300 bg-teal-600 px-4 py-3 text-sm leading-7 text-white shadow-[0_18px_40px_rgba(20,184,166,0.18)] dark:border-teal-300/30 dark:bg-teal-300 dark:text-slate-950">
                          <div className="whitespace-pre-wrap">{message.content}</div>
                          {message.meta ? (
                            <div className="mt-2 text-xs text-teal-50/85 dark:text-slate-700">{message.meta}</div>
                          ) : null}
                        </div>
                        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-lg dark:bg-chrome-900 dark:text-chrome-100">
                          <User className="h-4 w-4" strokeWidth={2} />
                        </span>
                      </article>
                    );
                  }

                  const messagePlan = message.plan;
                  const toolCall = message.toolCall;
                  const isActivePlan = Boolean(messagePlan && plan?.id === messagePlan.id);

                  return (
                    <article key={message.id} className="flex items-start gap-3">
                      <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-teal-300 dark:text-slate-950">
                        <Bot className="h-4.5 w-4.5" strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0 flex-1 rounded-[30px] border border-white/80 bg-white/86 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#171d26]/86 dark:shadow-none">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400">
                                Agent Reply
                              </span>
                              {message.meta ? (
                                <span className="text-xs font-semibold text-slate-400 dark:text-chrome-500">
                                  {message.meta}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-chrome-200">
                              {message.content}
                            </div>
                          </div>
                          {messagePlan ? (
                            <div className="shrink-0 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-chrome-950/70">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                                当前工具
                              </div>
                              <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                                {toolLabel(messagePlan.tool)}
                              </div>
                              <div className="mt-1 font-mono text-[11px] text-slate-400">
                                {toolFunctionName(messagePlan.tool)}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {message.trace ? (
                          <div className="mt-5">
                            <TraceTimeline
                              steps={message.trace}
                              traceKey={message.id}
                              expandedStepKeys={expandedStepKeys}
                              onToggleStep={toggleStep}
                            />
                          </div>
                        ) : null}

                        {toolCall ? (
                          <div className="mt-4">
                            <ToolCallCard
                              toolCall={toolCall}
                              expanded={expandedToolIds.has(toolCall.id)}
                              onToggle={() => toggleTool(toolCall.id)}
                              onCopyParameters={() => void copyToolParameters(toolCall)}
                              onRetry={() => void runAgent(lastInstruction || composerValue)}
                            />
                          </div>
                        ) : null}

                        {messagePlan && messagePlan.items.length > 0 ? (
                          <div className="mt-4 rounded-[26px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-chrome-950/54">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-black text-slate-950 dark:text-white">
                                  结果 Diff 预览
                                </div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                                  原值与新值分开展示，确认前不会写入数据库。
                                </div>
                              </div>
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400">
                                {messagePlan.items.length} changes
                              </span>
                            </div>
                            <div className="grid gap-3 xl:grid-cols-2">
                              {messagePlan.items.slice(0, 4).map((item) => (
                                <PlanDiffCard
                                  key={item.id}
                                  item={item}
                                  approved={isActivePlan && approvedItemIds.has(item.id)}
                                  onToggle={() => {
                                    if (isActivePlan) {
                                      togglePlanItem(item.id);
                                    } else {
                                      setStatusMessage('这是历史计划，只能查看，不能修改审批状态。');
                                    }
                                  }}
                                  onInspect={() => setSelectedInspectorItemId(item.id)}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {messagePlan ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void applyPlan()}
                              disabled={working || !isActivePlan || approvedItemIds.size === 0}
                              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                            >
                              <PlayCircle className="h-4 w-4" />
                              {isActivePlan ? '确认执行' : '历史计划'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setComposerValue(`修改上一版参数：${lastInstruction}`)}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <Clipboard className="h-4 w-4" />
                              修改参数
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatusMessage('当前计划仅预览，未写入文库。')}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <FileText className="h-4 w-4" />
                              只预览
                            </button>
                            <button
                              type="button"
                              onClick={cancelPlan}
                              disabled={working || !isActivePlan}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <X className="h-4 w-4" />
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => void runAgent(lastInstruction)}
                              disabled={!lastInstruction || working}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <RotateCcw className="h-4 w-4" />
                              重新生成
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200/70 bg-white/68 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/72">
              <div className="mx-auto max-w-5xl">
                <div className="mb-3 flex flex-wrap gap-2">
                  {promptSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setComposerValue(suggestion)}
                      className="rounded-full border border-slate-200 bg-white/82 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-300 dark:hover:border-teal-300/30 dark:hover:bg-teal-300/10 dark:hover:text-teal-200"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {error ? (
                  <div className="mb-3 whitespace-pre-wrap rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm leading-6 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                    {error}
                  </div>
                ) : null}

                {statusMessage ? (
                  <div className="mb-3 rounded-[20px] border border-slate-200 bg-white/72 px-4 py-2.5 text-xs text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    {statusMessage}
                  </div>
                ) : null}

                <form onSubmit={submitPrompt} className="flex items-end gap-3">
                  <textarea
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void runAgent(composerValue);
                      }
                    }}
                    className="min-h-[58px] flex-1 resize-none rounded-[24px] border border-slate-200 bg-white/95 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm outline-none transition focus:border-teal-300 focus:bg-white dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-100 dark:focus:border-teal-300/50"
                    placeholder="例如：把选中的论文标题后面加 123，或者清理标签并自动归类..."
                  />
                  <button
                    type="submit"
                    disabled={working || selectedPapers.length === 0 || !composerValue.trim()}
                    className="inline-flex h-[58px] items-center gap-2 rounded-[22px] bg-slate-950 px-5 text-sm font-black text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {working ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Send className="h-4 w-4" strokeWidth={2} />}
                    发送
                  </button>
                </form>
              </div>
            </div>
          </section>

          <aside className="min-h-0 border-l border-slate-200/80 bg-white/72 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/74">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/70 p-4 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                      <GitBranch className="h-4 w-4 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                      Inspector
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                      {plan ? `${approvedItemIds.size} / ${plan.items.length} 项待执行` : '等待 Agent 计划'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyPlan()}
                    disabled={!plan || approvedItemIds.size === 0 || working}
                    className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    执行
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-chrome-950/58">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                      <Database className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                      当前上下文
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedPapers.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">论文</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedTags.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">标签</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{new Set(selectedPapers.flatMap((paper) => paper.categoryIds)).size}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">分类</div>
                      </div>
                    </div>
                  </section>

                  {!plan ? (
                    <section className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/60 dark:text-chrome-400">
                      发送对话后，Agent 会在这里展示工具、参数、返回结果、diff 和审批按钮。
                    </section>
                  ) : (
                    <>
                      <section className="rounded-[26px] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-chrome-900/72">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                          <BrainCircuit className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                          计划概览
                        </div>
                        <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                          {plan.description}
                        </div>
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Tool</div>
                          <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                            {toolLabel(plan.tool)}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{toolFunctionName(plan.tool)}</div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                            <Layers3 className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                            审批项
                          </div>
                          <span className="text-xs font-bold text-slate-400">{selectedPlanItems.length} selected</span>
                        </div>
                        {plan.items.map((item) => (
                          <PlanDiffCard
                            key={item.id}
                            item={item}
                            approved={approvedItemIds.has(item.id)}
                            onToggle={() => togglePlanItem(item.id)}
                            onInspect={() => setSelectedInspectorItemId(item.id)}
                          />
                        ))}
                      </section>
                    </>
                  )}

                  {selectedInspectorItem ? (
                    <section className="rounded-[26px] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-chrome-900/72">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                        <MessageSquareText className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                        选中项详情
                      </div>
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Paper</div>
                          <div className="mt-1 text-xs font-bold leading-5 text-slate-700 dark:text-chrome-200">
                            {selectedInspectorItem.paperTitle}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Action</div>
                          <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-chrome-300">
                            {selectedInspectorItem.description}
                          </div>
                        </div>
                        {selectedInspectorItem.targetCategoryName ? (
                          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-700 dark:border-teal-300/20 dark:bg-teal-300/10 dark:text-teal-200">
                            Collection · {selectedInspectorItem.targetCategoryParentName} / {selectedInspectorItem.targetCategoryName}
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>

              {plan && plan.items.length > 0 ? (
                <div className="border-t border-slate-200/70 p-4 dark:border-white/10">
                  <div className="mb-3 text-xs text-slate-500 dark:text-chrome-400">
                    将应用 {selectedPlanItems.length} 个已勾选计划项。
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void applyPlan()}
                      disabled={selectedPlanItems.length === 0 || working}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                    >
                      <PlayCircle className="h-4 w-4" />
                      确认执行
                    </button>
                    <button
                      type="button"
                      onClick={cancelPlan}
                      disabled={working}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                    >
                      <X className="h-4 w-4" />
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

export default AgentWorkspace;
