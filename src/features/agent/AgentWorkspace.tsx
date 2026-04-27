import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  Clipboard,
  Database,
  FileText,
  GitBranch,
  Layers3,
  Loader2,
  MessageSquareText,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Plus,
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
  loadLibraryAgentModelPreset,
  runConversationalLibraryAgent,
  type LibraryAgentPlan,
} from '../../services/libraryAgent';
import { listLibraryPapers } from '../../services/library';
import type { LiteraturePaper } from '../../types/library';
import { useThemeStore } from '../../stores/useThemeStore';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import {
  agentCapabilities,
  buildErrorTrace,
  buildAgentHistorySession,
  buildPreviewToolCall,
  buildSuccessTrace,
  buildToolCallView,
  durationLabel,
  formatPaperMeta,
  loadAgentHistorySessions,
  newAgentSessionId,
  newMessageId,
  paperMatchesQuery,
  promptSuggestions,
  saveAgentHistorySessions,
  toolFunctionName,
  toolLabel,
  uniqueTagNames,
} from './AgentWorkspace.model';
import type { AgentChatMessage, AgentHistorySession, AgentToolCallView } from './AgentWorkspace.types';

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
  const [activeSessionId, setActiveSessionId] = useState(() => newAgentSessionId());
  const [historySessions, setHistorySessions] = useState<AgentHistorySession[]>(() => loadAgentHistorySessions());
  const [historySidebarCollapsed, setHistorySidebarCollapsed] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [
    {
      id: newMessageId(),
      role: 'assistant',
      content:
        '选择左侧文献后，直接用自然语言提问或描述任务。普通问答会直接回答；需要修改文库时，我会调用工具生成可审查计划，只有确认后才写入本地文库。',
      meta: '支持问答、重命名、元数据补全、智能标签、标签清洗、自动归类',
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
  const sortedHistorySessions = useMemo(
    () => historySessions.slice().sort((left, right) => right.updatedAt - left.updatedAt),
    [historySessions],
  );
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

  useEffect(() => {
    const nextSession = buildAgentHistorySession({
      id: activeSessionId,
      messages,
      selectedPaperIds: [...selectedPaperIds],
      lastInstruction,
    });

    setHistorySessions((current) => {
      const otherSessions = current.filter((session) => session.id !== activeSessionId);
      return [nextSession, ...otherSessions].slice(0, 30);
    });
  }, [activeSessionId, lastInstruction, messages, selectedPaperIds]);

  useEffect(() => {
    saveAgentHistorySessions(historySessions);
  }, [historySessions]);

  const updateMessage = (messageId: string, updater: (message: AgentChatMessage) => AgentChatMessage) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const togglePaper = (paperId: string) => {
    const paper = papers.find((item) => item.id === paperId);

    setSelectedPaperIds((current) => {
      const next = new Set(current);
      const selected = next.has(paperId);

      if (selected) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      setStatusMessage(`${selected ? '已取消选择' : '已选择'}：${paper?.title ?? '论文'}`);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedPaperIds(new Set(filteredPapers.map((paper) => paper.id)));
    setStatusMessage(`已选择当前结果中的 ${filteredPapers.length} 篇文献。`);
  };

  const clearSelection = () => {
    setSelectedPaperIds(new Set());
    setStatusMessage('已清空当前选中的文献。');
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
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolCall.rawParameters, null, 2));
      setStatusMessage(`已复制 ${toolCall.functionName} 的工具参数。`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '复制工具参数失败';
      setError(message);
      setStatusMessage(message);
    }
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
        content: '正在判断这次请求是否需要调用工具...',
        meta: 'Agent running',
        createdAt: Date.now(),
      },
    ]);
    setComposerValue('');
    setWorking(true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);

    try {
      const preset = loadLibraryAgentModelPreset();

      if (!preset) {
        throw new Error('请先在设置里配置 Agent 工具调用模型。');
      }

      setAgentPresetName(preset.label || preset.model);
      setStatusMessage(`正在调用大模型 Agent：${preset.label || preset.model}...`);

      const result = await runConversationalLibraryAgent({
        papers: selectedPapers,
        instruction,
        preset,
      });
      const durationMs = Math.round(performance.now() - startedAt);

      if (result.kind === 'answer') {
        updateMessage(assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `direct answer · ${durationLabel(durationMs)}`,
          trace: undefined,
          toolCall: undefined,
          plan: undefined,
        }));
        setStatusMessage(`已直接回答，无需工具调用。${durationLabel(durationMs)}`);
        return;
      }

      const nextPlan = result.plan;
      const nextToolCall = buildToolCallView(nextPlan, instruction, paperCount, durationMs);

      setNextPlan(nextPlan);
      setExpandedStepKeys((current) => new Set([
        ...current,
        `${assistantMessageId}:intent`,
        `${assistantMessageId}:tool-call`,
        `${assistantMessageId}:tool-result`,
      ]));

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
    const item = plan?.items.find((planItem) => planItem.id === itemId);

    setApprovedItemIds((current) => {
      const next = new Set(current);
      const wasApproved = next.has(itemId);

      if (wasApproved) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      setStatusMessage(
        `${wasApproved ? '已取消勾选' : '已勾选'}：${item?.paperTitle ?? '计划项'}`,
      );
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
      const expanded = next.has(toolCallId);

      if (expanded) {
        next.delete(toolCallId);
      } else {
        next.add(toolCallId);
      }

      setStatusMessage(expanded ? '已收起工具调用详情。' : '已展开工具调用详情。');
      return next;
    });
  };

  const handleOpenPreferences = () => {
    setStatusMessage('正在打开设置，请在 AI 模型里检查 Agent 工具调用模型。');
    onOpenPreferences?.();
  };

  const handleToggleThemeMode = () => {
    const nextMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    setThemeMode(nextMode);
    setStatusMessage(
      nextMode === 'light'
        ? '已切换到浅色主题。'
        : nextMode === 'dark'
          ? '已切换到深色主题。'
          : '已切换到跟随系统主题。',
    );
  };

  const handleWindowMinimize = () => {
    setStatusMessage('正在最小化窗口。');
    void appWindow.minimize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口最小化失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowToggleMaximize = () => {
    setStatusMessage('正在切换窗口大小。');
    void appWindow.toggleMaximize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '窗口缩放失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowClose = () => {
    setStatusMessage('正在关闭窗口。');
    void appWindow.close().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : '关闭窗口失败';
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleModifyPreviousParameters = () => {
    const nextInstruction = `修改上一版参数：${lastInstruction || composerValue}`;
    setComposerValue(nextInstruction);
    setStatusMessage('已把修改参数指令放入输入框，请编辑后重新发送。');
  };

  const handlePreviewOnly = () => {
    setStatusMessage('当前计划仅预览，未写入文库。你可以继续检查 diff 或取消勾选计划项。');
  };

  const handleRetryAgent = (instruction: string) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage('没有可重试的上一条指令。');
      return;
    }

    setStatusMessage('正在重新生成 Agent 计划。');
    void runAgent(nextInstruction);
  };

  const createWelcomeMessage = (): AgentChatMessage => ({
    id: newMessageId(),
    role: 'assistant',
    content:
      '选择左侧文献后，直接用自然语言提问或描述任务。普通问答会直接回答；需要修改文库时，我会调用工具生成可审查计划，只有确认后才写入本地文库。',
    meta: '支持问答、重命名、元数据补全、智能标签、标签清洗、自动归类',
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
  });

  const handleNewAgentSession = () => {
    setActiveSessionId(newAgentSessionId());
    setMessages([createWelcomeMessage()]);
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setLastInstruction('');
    setComposerValue('');
    setError('');
    setStatusMessage('已创建新的 Agent 对话。');
  };

  const handleOpenHistorySession = (session: AgentHistorySession) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setSelectedPaperIds(new Set(session.selectedPaperIds));
    setLastInstruction(session.lastInstruction);
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setComposerValue('');
    setError('');
    setStatusMessage(`已打开历史对话：${session.title}`);
  };

  const handleClearAgentHistory = () => {
    const nextSessionId = newAgentSessionId();
    const nextMessages = [createWelcomeMessage()];

    setActiveSessionId(nextSessionId);
    setMessages(nextMessages);
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setLastInstruction('');
    setComposerValue('');
    setHistorySessions([
      buildAgentHistorySession({
        id: nextSessionId,
        messages: nextMessages,
        selectedPaperIds: [...selectedPaperIds],
        lastInstruction: '',
      }),
    ]);
    setStatusMessage('已清空 Agent 历史记录。');
  };

  const formatHistoryTime = (timestamp: number) =>
    new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] text-slate-900 dark:bg-chrome-950 dark:text-chrome-100">
      <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/70 bg-white/55 shadow-[0_26px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/8 dark:bg-chrome-950 dark:shadow-none">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/72 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
          <div
            className="flex min-w-0 items-center gap-3"
            data-tauri-drag-region
            onDoubleClick={handleWindowToggleMaximize}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_28px_rgba(15,23,42,0.16)] ring-1 ring-slate-200/80 dark:bg-teal-300 dark:text-slate-950 dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)] dark:ring-white/10">
              <Bot className="h-4 w-4" strokeWidth={2.2} />
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

          <div
            className="mx-4 min-w-8 flex-1 self-stretch"
            data-tauri-drag-region
            onDoubleClick={handleWindowToggleMaximize}
          />

          <div className="flex items-center gap-2">
            <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400 md:block">
              {agentPresetName ? `Agent · ${agentPresetName}` : 'Agent · 使用设置中的 Agent 模型'}
            </div>
            <button
              type="button"
              onClick={() => void refreshPapers()}
              disabled={loading || working}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              <RefreshCw className={loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} strokeWidth={1.8} />
              刷新
            </button>
            <button
              type="button"
              onClick={handleOpenPreferences}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
              title="设置"
            >
              <Settings2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              设置
            </button>
            <button
              type="button"
              onClick={handleToggleThemeMode}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
              title="切换主题"
            >
              {themeMode === 'dark' ? (
                <Moon className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Sun className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '自动'}
            </button>
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-chrome-700 dark:bg-chrome-800">
              <button
                type="button"
                onClick={handleWindowMinimize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
                aria-label="最小化窗口"
                title="最小化"
              >
                <Minus className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowToggleMaximize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
                aria-label="最大化或还原窗口"
                title="最大化/还原"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowClose}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 dark:text-chrome-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-400"
                aria-label="关闭窗口"
                title="关闭"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>

        <main
          className="grid min-h-0 flex-1 overflow-hidden"
          style={{
            gridTemplateColumns: historySidebarCollapsed
              ? '76px 350px minmax(0,1fr) 420px'
              : '280px 350px minmax(0,1fr) 420px',
          }}
        >
          <aside className="min-h-0 border-r border-slate-200/80 bg-white/64 backdrop-blur-xl dark:border-white/10 dark:bg-[#101720]/86">
            {historySidebarCollapsed ? (
              <div className="flex h-full min-h-0 flex-col items-center gap-3 px-2 py-4">
                <button
                  type="button"
                  onClick={() => setHistorySidebarCollapsed(false)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                  title="展开历史记录"
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={handleNewAgentSession}
                  className="rounded-xl bg-slate-950 p-2 text-white transition hover:bg-slate-800 dark:bg-teal-300 dark:text-slate-950"
                  title="新建对话"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                </button>
                <div className="mt-1 flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
                  {sortedHistorySessions.slice(0, 12).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => handleOpenHistorySession(session)}
                      className={[
                        'h-2.5 w-2.5 rounded-full transition',
                        session.id === activeSessionId
                          ? 'bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.14)]'
                          : session.status === 'error'
                            ? 'bg-rose-400 hover:bg-rose-500'
                            : 'bg-slate-300 hover:bg-slate-400 dark:bg-chrome-600 dark:hover:bg-chrome-500',
                      ].join(' ')}
                      title={session.title}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-slate-200/70 p-4 dark:border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                        <Clock3 className="h-4 w-4 text-teal-600 dark:text-teal-300" strokeWidth={2} />
                        历史记录
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-chrome-400">
                        {sortedHistorySessions.length} 个 Agent 对话
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistorySidebarCollapsed(true)}
                      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                      title="折叠历史记录"
                    >
                      <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleNewAgentSession}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      新对话
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAgentHistory}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {sortedHistorySessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => handleOpenHistorySession(session)}
                        className={[
                          'w-full rounded-[22px] border p-3 text-left transition',
                          session.id === activeSessionId
                            ? 'border-teal-300 bg-teal-50 shadow-[0_14px_35px_rgba(20,184,166,0.12)] dark:border-teal-300/30 dark:bg-teal-300/10'
                            : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white dark:bg-chrome-900/54 dark:hover:border-white/10 dark:hover:bg-chrome-900',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-black text-slate-950 dark:text-white">
                            {session.title}
                          </span>
                          <span
                            className={[
                              'h-2 w-2 shrink-0 rounded-full',
                              session.status === 'error'
                                ? 'bg-rose-400'
                                : session.status === 'running'
                                  ? 'bg-amber-400'
                                  : 'bg-teal-400',
                            ].join(' ')}
                          />
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                          {session.summary}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-slate-400 dark:text-chrome-500">
                          <span>{formatHistoryTime(session.updatedAt)}</span>
                          <span>{session.selectedPaperIds.length} papers</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </aside>

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
                              onRetry={() => handleRetryAgent(lastInstruction || composerValue)}
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
                                  onInspect={() => {
                                    setSelectedInspectorItemId(item.id);
                                    setStatusMessage(`正在查看计划项：${item.paperTitle}`);
                                  }}
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
                              onClick={handleModifyPreviousParameters}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <Clipboard className="h-4 w-4" />
                              修改参数
                            </button>
                            <button
                              type="button"
                              onClick={handlePreviewOnly}
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
                              onClick={() => handleRetryAgent(lastInstruction)}
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
                      onClick={() => {
                        setComposerValue(suggestion);
                        setStatusMessage('已填入示例指令，可直接发送或继续编辑。');
                      }}
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
                            onInspect={() => {
                              setSelectedInspectorItemId(item.id);
                              setStatusMessage(`正在查看计划项：${item.paperTitle}`);
                            }}
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
