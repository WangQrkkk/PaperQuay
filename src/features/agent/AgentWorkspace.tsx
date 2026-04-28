import { Component, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import {
  applyLibraryAgentPlan,
  loadLibraryAgentModelPreset,
  runConversationalLibraryAgent,
  type LibraryAgentConversationMessage,
  type LibraryAgentPlan,
} from '../../services/libraryAgent';
import { listLibraryPapers } from '../../services/library';
import type { LiteraturePaper } from '../../types/library';
import { useThemeStore } from '../../stores/useThemeStore';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import {
  patchAgentHistorySessionMessage,
  upsertAgentHistorySession,
} from './agentSessionState';
import {
  isAgentSessionRunning,
  updateAgentRunningSessions,
} from './agentRunningSessions';
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
  promptSuggestionsEn,
  saveAgentHistorySessions,
  toolFunctionName,
  toolLabel,
  uniqueTagNames,
} from './AgentWorkspace.model';
import type { AgentChatMessage, AgentHistorySession, AgentToolCallView } from './AgentWorkspace.types';
import { normalizeMarkdownMath } from '../../utils/markdown';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import { emitOpenPreferences } from '../../app/appEvents';

interface AgentWorkspaceProps {
  onOpenPreferences?: () => void;
}

class AgentMarkdownBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    resetKey: string;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function AgentMarkdownFallback({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 dark:border-white/10 dark:bg-chrome-950/80 dark:text-chrome-200">
      {content}
    </pre>
  );
}

function AgentMarkdown({ content }: { content: string }) {
  const normalizedContent = useMemo(() => {
    try {
      return normalizeMarkdownMath(content);
    } catch {
      return content;
    }
  }, [content]);
  const fallback = <AgentMarkdownFallback content={content} />;

  return (
    <AgentMarkdownBoundary resetKey={normalizedContent} fallback={fallback}>
      <ReactMarkdown
        className={[
          'max-w-none text-sm leading-7 text-slate-700 dark:text-chrome-200',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:border-b [&_h1]:border-slate-200 [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:tracking-tight [&_h1]:text-slate-950 dark:[&_h1]:border-white/10 dark:[&_h1]:text-white',
          '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-black [&_h2]:tracking-tight [&_h2]:text-slate-950 dark:[&_h2]:text-white',
          '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-slate-900 dark:[&_h3]:text-chrome-100',
          '[&_p]:my-2 [&_p]:leading-7 [&_strong]:font-bold [&_strong]:text-slate-950 dark:[&_strong]:text-white [&_em]:text-slate-700 dark:[&_em]:text-chrome-200',
          '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_li]:pl-1',
          '[&_blockquote]:my-4 [&_blockquote]:rounded-2xl [&_blockquote]:border [&_blockquote]:border-teal-200/70 [&_blockquote]:bg-teal-50/70 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-slate-700 dark:[&_blockquote]:border-teal-300/20 dark:[&_blockquote]:bg-teal-300/10 dark:[&_blockquote]:text-teal-50',
          '[&_hr]:my-5 [&_hr]:border-slate-200 dark:[&_hr]:border-white/10',
          '[&_code]:rounded-md [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-teal-700 dark:[&_code]:bg-white/10 dark:[&_code]:text-teal-100',
          '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:p-4 dark:[&_pre]:border-white/10 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-100',
          '[&_a]:font-semibold [&_a]:text-teal-700 [&_a]:underline [&_a]:underline-offset-4 dark:[&_a]:text-teal-200',
          '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-2xl [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 dark:[&_th]:border-white/10 dark:[&_th]:bg-white/5 dark:[&_td]:border-white/10',
          '[&_.katex]:text-slate-900 dark:[&_.katex]:text-chrome-100 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2',
        ].join(' ')}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: true }]]}
      >
        {normalizedContent}
      </ReactMarkdown>
    </AgentMarkdownBoundary>
  );
}

function containsLegacyMojibake(value: string): boolean {
  return /[\uFFFD]|\u93b6|\u95ab|\u7b49|\u93c0|\u7025/.test(value);
}

function AgentWorkspace({ onOpenPreferences }: AgentWorkspaceProps) {
  const appWindow = getCurrentWindow();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const locale = useAppLocale();
  const l = useLocaleText();
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const [paperSearchQuery, setPaperSearchQuery] = useState('');
  const [composerValue, setComposerValue] = useState('');
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
        l(
          '选择左侧文献后，直接用自然语言提问或描述任务。普通问答会直接回答；需要修改文库时，我会调用工具生成可审查计划，只有确认后才写入本地文库。',
          'You can chat directly, or select papers on the left to add literature context. Plain Q&A is answered directly; library edits are converted into reviewable tool plans and written only after confirmation.',
        ),
      meta: l(
        '支持问答、重命名、元数据补全、智能标签、标签清洗、自动归类',
        'Q&A, renaming, metadata completion, smart tags, tag cleanup, and auto-classification',
      ),
      createdAt: Date.now(),
      trace: [
        {
          id: 'welcome-intent',
          type: 'intent',
          title: l('等待用户指令', 'Waiting for user instruction'),
          summary: l('可直接输入问题，也可以先在左侧选择论文后再执行任务。', 'You can type a question directly, or select papers on the left before running a task.'),
          status: 'waiting',
        },
      ],
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const runningSessionIdsRef = useRef(runningSessionIds);
  const activeSessionIdRef = useRef(activeSessionId);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const createLocalizedWelcomeMessage = (): AgentChatMessage => ({
    id: newMessageId(),
    role: 'assistant',
    content: l(
      '选择左侧文献后，直接用自然语言提问或描述任务。普通问答会直接回答；需要修改文库时，我会调用工具生成可审查计划，只有确认后才写入本地文库。',
      'You can chat directly, or select papers on the left to add literature context. Plain Q&A is answered directly; library edits are converted into reviewable tool plans and written only after confirmation.',
    ),
    meta: l(
      '支持问答、重命名、元数据补全、智能标签、标签清洗、自动归类',
      'Q&A, renaming, metadata completion, smart tags, tag cleanup, and auto-classification',
    ),
    createdAt: Date.now(),
    trace: [
      {
        id: 'welcome-intent',
        type: 'intent',
        title: l('等待用户指令', 'Waiting for user instruction'),
        summary: l('可直接输入问题，也可以先在左侧选择论文后再执行任务。', 'You can type a question directly, or select papers on the left before running a task.'),
        status: 'waiting',
      },
    ],
  });

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
  const activeSessionRunning = useMemo(
    () => isAgentSessionRunning(runningSessionIds, activeSessionId),
    [activeSessionId, runningSessionIds],
  );
  const sortedHistorySessions = useMemo(
    () => historySessions.slice().sort((left, right) => right.updatedAt - left.updatedAt),
    [historySessions],
  );
  const selectedInspectorItem =
    plan?.items.find((item) => item.id === selectedInspectorItemId) ?? plan?.items[0] ?? null;
  const localizedCapabilityTitles: Record<string, string> = {
    rename: l('批量重命名', 'Batch Rename'),
    metadata: l('元数据补全', 'Metadata Completion'),
    'smart-tags': l('智能标签', 'Smart Tags'),
    'clean-tags': l('标签清洗', 'Tag Cleanup'),
    classify: l('自动归类', 'Auto Classification'),
  };
  const localizedToolLabel = (tool: LibraryAgentPlan['tool']) =>
    localizedCapabilityTitles[tool] ?? (locale === 'en-US' ? toolFunctionName(tool) : toolLabel(tool));

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
      setStatusMessage(l(`已加载 ${nextPapers.length} 篇文献。`, `Loaded ${nextPapers.length} papers.`));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('加载文库失败', 'Failed to load library');
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
    setComposerValue((current) =>
      containsLegacyMojibake(current)
        || current === 'Append 123 to the selected paper titles'
        || current === 'Add "Read" to the beginning of the selected paper titles'
        ? ''
        : current,
    );
  }, []);

  useEffect(() => {
    setComposerValue((current) =>
      containsLegacyMojibake(current) ? '' : current,
    );
    setMessages((current) => {
      if (
        current.length !== 1 ||
        !current[0]?.trace?.some((step) => step.id === 'welcome-intent') ||
        !containsLegacyMojibake(current[0].content)
      ) {
        return current;
      }

      const localized = createLocalizedWelcomeMessage();
      return [
        {
          ...localized,
          id: current[0].id,
          createdAt: current[0].createdAt,
        },
      ];
    });
  }, [locale]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeSessionRunning, applyingPlan, messages]);

  useEffect(() => {
    const nextSession = buildAgentHistorySession({
      id: activeSessionId,
      messages,
      selectedPaperIds: [...selectedPaperIds],
      lastInstruction,
      locale,
    });

    setHistorySessions((current) => {
      const otherSessions = current.filter((session) => session.id !== activeSessionId);
      return [nextSession, ...otherSessions].slice(0, 30);
    });
  }, [activeSessionId, lastInstruction, locale, messages, selectedPaperIds]);

  useEffect(() => {
    saveAgentHistorySessions(historySessions);
  }, [historySessions]);

  useEffect(() => {
    runningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const updateMessage = (messageId: string, updater: (message: AgentChatMessage) => AgentChatMessage) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const upsertSessionSnapshot = (
    sessionId: string,
    nextMessages: AgentChatMessage[],
    nextSelectedPaperIds: string[],
    nextInstruction: string,
  ) => {
    setHistorySessions((current) =>
      upsertAgentHistorySession(current, {
        sessionId,
        messages: nextMessages,
        selectedPaperIds: nextSelectedPaperIds,
        lastInstruction: nextInstruction,
        locale,
      }),
    );
  };

  const updateSessionMessage = (
    sessionId: string,
    messageId: string,
    updater: (message: AgentChatMessage) => AgentChatMessage,
  ) => {
    setHistorySessions((current) =>
      patchAgentHistorySessionMessage(current, {
        sessionId,
        messageId,
        updater,
        locale,
      }),
    );

    if (activeSessionIdRef.current === sessionId) {
      updateMessage(messageId, updater);
    }
  };

  const restoreDraftStateFromMessages = (sessionMessages: AgentChatMessage[]) => {
    const latestPlanMessage = [...sessionMessages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.plan);
    const nextPlan = latestPlanMessage?.plan ?? null;

    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan?.items.map((item) => item.id) ?? []));
    setSelectedInspectorItemId(nextPlan?.items[0]?.id ?? null);
  };

  const setAgentSessionRunning = (sessionId: string, running: boolean) => {
    setRunningSessionIds((current) => updateAgentRunningSessions(current, sessionId, running));
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

      setStatusMessage(
        l(
          `${selected ? '已取消选择' : '已选择'}：${paper?.title ?? '论文'}`,
          `${selected ? 'Unselected' : 'Selected'}: ${paper?.title ?? 'paper'}`,
        ),
      );
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedPaperIds(new Set(filteredPapers.map((paper) => paper.id)));
    setStatusMessage(l(`已选择当前结果中的 ${filteredPapers.length} 篇文献。`, `Selected ${filteredPapers.length} papers from the current results.`));
  };

  const clearSelection = () => {
    setSelectedPaperIds(new Set());
    setStatusMessage(l('已清空当前选中的文献。', 'Cleared the current paper selection.'));
  };

  const setNextPlan = (nextPlan: LibraryAgentPlan) => {
    setPlan(nextPlan);
    setApprovedItemIds(new Set(nextPlan.items.map((item) => item.id)));
    setSelectedInspectorItemId(nextPlan.items[0]?.id ?? null);
    setStatusMessage(nextPlan.description);
  };

  const appendAssistantMessageToSession = (
    sessionId: string,
    content: string,
    meta?: string,
  ) => {
    const nextMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'assistant',
      content,
      meta,
      createdAt: Date.now(),
    };

    setHistorySessions((current) => {
      const targetSession = current.find((session) => session.id === sessionId);

      if (!targetSession) {
        return current;
      }

      return upsertAgentHistorySession(current, {
        sessionId,
        messages: [...targetSession.messages, nextMessage],
        selectedPaperIds: targetSession.selectedPaperIds,
        lastInstruction: targetSession.lastInstruction,
        locale,
      });
    });

    if (activeSessionIdRef.current === sessionId) {
      setMessages((existingMessages) => [...existingMessages, nextMessage]);
    }
  };

  const copyToolParameters = async (toolCall: AgentToolCallView) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolCall.rawParameters, null, 2));
      setStatusMessage(l(`已复制 ${toolCall.functionName} 的工具参数。`, `Copied parameters for ${toolCall.functionName}.`));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('复制工具参数失败', 'Failed to copy tool parameters');
      setError(message);
      setStatusMessage(message);
    }
  };

  const buildConversationHistory = (): LibraryAgentConversationMessage[] =>
    messages
      .filter((message) => message.role === 'user' || (message.role === 'assistant' && !message.plan))
      .filter((message) => !message.trace?.some((step) => step.id === 'welcome-intent'))
      .filter((message) => message.content.trim() && !message.error)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }));

  const runAgent = async (rawInstruction: string) => {
    const instruction = rawInstruction.trim();

    if (!instruction) {
      setError(l('请输入 Agent 指令。', 'Enter an Agent instruction.'));
      return;
    }

    const sessionId = activeSessionId;

    if (isAgentSessionRunning(runningSessionIdsRef.current, sessionId)) {
      setStatusMessage(
        l(
          '当前对话仍在处理中，请等待这一轮回复完成后再继续发送。',
          'This chat is still processing. Wait for the current reply to finish before sending another message.',
        ),
      );
      return;
    }

    const selectedPapersSnapshot = selectedPapers;
    const selectedPaperIdsSnapshot = [...selectedPaperIds];
    const startedAt = performance.now();
    const assistantMessageId = newMessageId();
    const paperCount = selectedPapersSnapshot.length;
    const historyMessages = buildConversationHistory();
    const userMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: instruction,
      meta: paperCount > 0
        ? l(`作用于 ${paperCount} 篇论文`, `Applied to ${paperCount} papers`)
        : l('未选择论文，按通用对话处理', 'No papers selected; using general chat context'),
      createdAt: Date.now(),
    };
    const pendingAssistantMessage: AgentChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: l('Agent 正在回复...', 'Agent is replying...'),
      meta: l('执行中', 'Running'),
      createdAt: Date.now(),
      trace: [
        {
          id: `${assistantMessageId}:intent`,
          type: 'intent',
          title: l('正在分析请求', 'Analyzing request'),
          summary: instruction,
          status: 'running',
        },
      ],
    };
    const nextMessages = [...messages, userMessage, pendingAssistantMessage];
    const isTargetSessionActive = () => activeSessionIdRef.current === sessionId;

    setLastInstruction(instruction);
    setMessages(nextMessages);
    upsertSessionSnapshot(sessionId, nextMessages, selectedPaperIdsSnapshot, instruction);
    setComposerValue('');
    setAgentSessionRunning(sessionId, true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);

    try {
      const preset = await loadLibraryAgentModelPreset();

      if (!preset) {
        throw new Error(l('请先在设置里配置 Agent 工具调用模型。', 'Configure the Agent tool-calling model in Settings first.'));
      }

      setAgentPresetName(preset.label || preset.model);
      if (isTargetSessionActive()) {
        setStatusMessage(
          l(
            `正在调用大模型 Agent：${preset.label || preset.model}...`,
            `Calling Agent model: ${preset.label || preset.model}...`,
          ),
        );
      }

      const result = await runConversationalLibraryAgent({
        papers: selectedPapersSnapshot,
        instruction,
        preset,
        historyMessages,
        responseLanguage: locale === 'en-US' ? 'English' : 'Simplified Chinese',
      });
      const durationMs = Math.round(performance.now() - startedAt);

      if (result.kind === 'answer') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
        meta: `${result.contextLabel} · ${durationLabel(durationMs, locale)}`,
          trace: undefined,
          toolCall: undefined,
          plan: undefined,
          choices: undefined,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(
            l(
              `已直接回答，无需工具调用。${durationLabel(durationMs, locale)}`,
              `Answered directly without tool calls. ${durationLabel(durationMs, locale)}`,
            ),
          );
        }
        return;
      }

      if (result.kind === 'choice') {
        updateSessionMessage(sessionId, assistantMessageId, (message) => ({
          ...message,
          content: result.answer,
          meta: `waiting for choice · ${durationLabel(durationMs, locale)}`,
          trace: [
            {
              id: `${assistantMessageId}:choice`,
              type: 'plan',
              title: l('等待你的选择', 'Waiting for your choice'),
              summary: l('Agent 需要你确认下一步。', 'The Agent needs your confirmation for the next step.'),
              status: 'waiting',
              durationMs,
            },
          ],
          toolCall: undefined,
          plan: undefined,
          choices: result.choices,
          error: undefined,
        }));
        if (isTargetSessionActive()) {
          setStatusMessage(
            l(
              `Agent 需要你选择下一步，共 ${result.choices.length} 个选项。`,
              `The Agent needs your next-step choice. ${result.choices.length} options available.`,
            ),
          );
        }
        return;
      }

      const nextPlan = result.plan;
      const nextToolCall = buildToolCallView(nextPlan, instruction, paperCount, durationMs, locale);

      updateSessionMessage(sessionId, assistantMessageId, (message) => ({
        ...message,
        content:
          nextPlan.items.length > 0
            ? l(
              `已自动选择「${localizedToolLabel(nextPlan.tool)}」，生成 ${nextPlan.items.length} 个可审查计划项。`,
              `Selected "${localizedToolLabel(nextPlan.tool)}" and generated ${nextPlan.items.length} reviewable plan items.`,
            )
            : l(
              `已自动选择「${localizedToolLabel(nextPlan.tool)}」，当前没有需要变更的计划项。`,
              `Selected "${localizedToolLabel(nextPlan.tool)}"; there are no changes to apply.`,
            ),
        meta: `${toolFunctionName(nextPlan.tool)} · ${durationLabel(durationMs, locale)}`,
        trace: buildSuccessTrace(instruction, paperCount, nextPlan, durationMs, locale),
        toolCall: nextToolCall,
        plan: nextPlan,
        choices: undefined,
        error: undefined,
      }));
      if (isTargetSessionActive()) {
        setNextPlan(nextPlan);
        setExpandedStepKeys((current) => new Set([
          ...current,
          `${assistantMessageId}:intent`,
          `${assistantMessageId}:tool-call`,
          `${assistantMessageId}:tool-result`,
        ]));
        setStatusMessage(nextPlan.description);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('生成 Agent 计划失败', 'Failed to generate Agent plan');
      const durationMs = Math.round(performance.now() - startedAt);

      updateSessionMessage(sessionId, assistantMessageId, (chatMessage) => ({
        ...chatMessage,
        content: message.includes('tool call')
          ? l(
            '当前模型没有返回 tool call。请换用支持 OpenAI-compatible tools/function calling 的模型。',
            'The current model did not return a tool call. Use a model that supports OpenAI-compatible tools/function calling.',
          )
          : l(`生成计划失败：${message}`, `Plan generation failed: ${message}`),
        meta: `error · ${durationLabel(durationMs, locale)}`,
        trace: buildErrorTrace(instruction, paperCount, message, durationMs, locale),
        toolCall: buildPreviewToolCall(instruction, paperCount, 'error', locale),
        plan: undefined,
        choices: undefined,
        error: message,
      }));
      if (isTargetSessionActive()) {
        setError(message);
        setStatusMessage(message);
      }
    } finally {
      setAgentSessionRunning(sessionId, false);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAgent(composerValue);
  };

  const applyPlan = async () => {
    if (applyingPlan) {
      return;
    }
    if (!plan || approvedItemIds.size === 0) {
      setError(l('没有可执行的计划项。', 'There are no executable plan items.'));
      return;
    }

    const sessionId = activeSessionId;
    const planToApply = plan;
    const approvedIdsSnapshot = new Set(approvedItemIds);
    const isTargetSessionActive = () => activeSessionIdRef.current === sessionId;

    setApplyingPlan(true);
    setError('');
    if (isTargetSessionActive()) {
      setStatusMessage(
        l(
          `正在执行 ${approvedIdsSnapshot.size} 个计划项...`,
          `Running ${approvedIdsSnapshot.size} plan items...`,
        ),
      );
    }

    try {
      const result = await applyLibraryAgentPlan(planToApply, approvedIdsSnapshot);

      await refreshPapers();
      if (isTargetSessionActive()) {
        setPlan(null);
        setApprovedItemIds(new Set());
        setSelectedInspectorItemId(null);
        setStatusMessage(
          l(
            `执行完成：成功 ${result.applied}，失败 ${result.failed}。`,
            `Execution finished: ${result.applied} succeeded, ${result.failed} failed.`,
          ),
        );
      }
      appendAssistantMessageToSession(
        sessionId,
        l(`已执行计划：成功 ${result.applied} 项，失败 ${result.failed} 项。`, `Plan executed: ${result.applied} succeeded, ${result.failed} failed.`),
        result.failed > 0 ? result.errors.join('\n') : l('本地写入已完成', 'Local write completed'),
      );

      if (result.failed > 0) {
        if (isTargetSessionActive()) {
          setError(result.errors.join('\n') || l('部分计划项执行失败。', 'Some plan items failed.'));
        }
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('执行 Agent 计划失败', 'Failed to execute Agent plan');
      if (isTargetSessionActive()) {
        setError(message);
        setStatusMessage(message);
      }
      appendAssistantMessageToSession(
        sessionId,
        l(`执行计划失败：${message}`, `Plan execution failed: ${message}`),
      );
    } finally {
      setApplyingPlan(false);
    }
  };

  const cancelPlan = () => {
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setStatusMessage(l('已取消当前计划。', 'Canceled the current plan.'));
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
        l(
          `${wasApproved ? '已取消勾选' : '已勾选'}：${item?.paperTitle ?? '计划项'}`,
          `${wasApproved ? 'Unchecked' : 'Checked'}: ${item?.paperTitle ?? 'plan item'}`,
        ),
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

      setStatusMessage(expanded ? l('已收起工具调用详情。', 'Collapsed tool-call details.') : l('已展开工具调用详情。', 'Expanded tool-call details.'));
      return next;
    });
  };

  const handleOpenPreferences = () => {
    setStatusMessage(l('正在打开设置，请在 AI 模型里检查 Agent 工具调用模型。', 'Opening Settings. Check the Agent tool-calling model under AI Models.'));
    if (onOpenPreferences) {
      onOpenPreferences();
      return;
    }

    emitOpenPreferences('models');
  };

  const handleToggleThemeMode = () => {
    const nextMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    setThemeMode(nextMode);
    setStatusMessage(
      nextMode === 'light'
        ? l('已切换到浅色主题。', 'Switched to light theme.')
        : nextMode === 'dark'
          ? l('已切换到深色主题。', 'Switched to dark theme.')
          : l('已切换到跟随系统主题。', 'Switched to system theme.'),
    );
  };

  const handleWindowMinimize = () => {
    setStatusMessage(l('正在最小化窗口。', 'Minimizing window.'));
    void appWindow.minimize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : l('窗口最小化失败', 'Failed to minimize window');
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowToggleMaximize = () => {
    setStatusMessage(l('正在切换窗口大小。', 'Toggling window size.'));
    void appWindow.toggleMaximize().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : l('窗口缩放失败', 'Failed to resize window');
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleWindowClose = () => {
    setStatusMessage(l('正在关闭窗口。', 'Closing window.'));
    void appWindow.close().catch((nextError) => {
      const message = nextError instanceof Error ? nextError.message : l('关闭窗口失败', 'Failed to close window');
      setError(message);
      setStatusMessage(message);
    });
  };

  const handleModifyPreviousParameters = () => {
    const nextInstruction = l(`修改上一版参数：${lastInstruction || composerValue}`, `Modify the previous parameters: ${lastInstruction || composerValue}`);
    setComposerValue(nextInstruction);
    setStatusMessage(l('已把修改参数指令放入输入框，请编辑后重新发送。', 'The parameter-edit instruction was placed into the input. Edit it and send again.'));
  };

  const handlePreviewOnly = () => {
    setStatusMessage(l('当前计划仅预览，未写入文库。你可以继续检查 diff 或取消勾选计划项。', 'This plan is preview-only and has not been written to the library. You can keep checking diffs or uncheck items.'));
  };

  const handleRetryAgent = (instruction: string) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage(l('没有可重试的上一条指令。', 'There is no previous instruction to retry.'));
      return;
    }

    setStatusMessage(l('正在重新生成 Agent 计划。', 'Regenerating the Agent plan.'));
    void runAgent(nextInstruction);
  };

  const handleAgentChoice = (instruction: string) => {
    const nextInstruction = instruction.trim();

    if (!nextInstruction) {
      setStatusMessage(l('这个选项没有可执行指令。', 'This option has no executable instruction.'));
      return;
    }

    setComposerValue(nextInstruction);
    setStatusMessage(l('已选择 Agent 建议，正在继续执行。', 'Selected the Agent suggestion. Continuing execution.'));
    void runAgent(nextInstruction);
  };

  const createWelcomeMessage = (): AgentChatMessage => ({
    id: newMessageId(),
    role: 'assistant',
    content: l(
      '选择左侧文献后，直接用自然语言提问或描述任务。普通问答会直接回答；需要修改文库时，我会调用工具生成可审查计划，只有确认后才写入本地文库。',
      'You can chat directly, or select papers on the left to add literature context. Plain Q&A is answered directly; library edits are converted into reviewable tool plans and written only after confirmation.',
    ),
    meta: l(
      '支持问答、重命名、元数据补全、智能标签、标签清洗、自动归类',
      'Q&A, renaming, metadata completion, smart tags, tag cleanup, and auto-classification',
    ),
    createdAt: Date.now(),
    trace: [
      {
        id: 'welcome-intent',
        type: 'intent',
        title: l('等待用户指令', 'Waiting for user instruction'),
        summary: l('可直接输入问题，也可以先在左侧选择论文后再执行任务。', 'You can type a question directly, or select papers on the left before running a task.'),
        status: 'waiting',
      },
    ],
  });

  const handleNewAgentSession = () => {
    setActiveSessionId(newAgentSessionId());
    setMessages([createLocalizedWelcomeMessage()]);
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);
    setLastInstruction('');
    setComposerValue('');
    setError('');
    setStatusMessage(l('已创建新的 Agent 对话。', 'Created a new Agent chat.'));
  };

  const handleOpenHistorySession = (session: AgentHistorySession) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setSelectedPaperIds(new Set(session.selectedPaperIds));
    setLastInstruction(session.lastInstruction);
    restoreDraftStateFromMessages(session.messages);
    setComposerValue('');
    setError('');
    setStatusMessage(l(`已打开历史对话：${session.title}`, `Opened history chat: ${session.title}`));
  };

  const handleDeleteHistorySession = (sessionId: string) => {
    setHistorySessions((current) => current.filter((session) => session.id !== sessionId));

    if (sessionId === activeSessionId) {
      setActiveSessionId(newAgentSessionId());
      setMessages([createLocalizedWelcomeMessage()]);
      setPlan(null);
      setApprovedItemIds(new Set());
      setSelectedInspectorItemId(null);
      setLastInstruction('');
      setComposerValue('');
      setError('');
    }

    setStatusMessage(l('已删除 Agent 历史对话。', 'Deleted the Agent chat history item.'));
  };

  const handleClearAgentHistory = () => {
    const nextSessionId = newAgentSessionId();
    const nextMessages = [createLocalizedWelcomeMessage()];

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
        locale,
      }),
    ]);
    setStatusMessage(l('已清空 Agent 历史记录。', 'Cleared Agent history.'));
  };

  const formatHistoryTime = (timestamp: number) =>
    new Intl.DateTimeFormat(locale, {
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
                {l('论文助手 · 工具调用工作台', 'Paper Assistant · Tool Workspace')}
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
              {agentPresetName ? `Agent · ${agentPresetName}` : l('Agent · 使用设置中的 Agent 模型', 'Agent · Using the model configured in Settings')}
            </div>
            <button
              type="button"
              onClick={() => void refreshPapers()}
              disabled={loading || applyingPlan}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
            >
              <RefreshCw className={loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} strokeWidth={1.8} />
              {l('刷新', 'Refresh')}
            </button>
            <button
              type="button"
              onClick={handleOpenPreferences}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
              title={l('设置', 'Settings')}
            >
              <Settings2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
              {l('设置', 'Settings')}
            </button>
            <button
              type="button"
              onClick={handleToggleThemeMode}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
              title={l('切换主题', 'Toggle Theme')}
            >
              {themeMode === 'dark' ? (
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
                title={l('最小化', 'Minimize')}
              >
                <Minus className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowToggleMaximize}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
                aria-label={l('最大化或还原窗口', 'Maximize or Restore Window')}
                title={l('最大化/还原', 'Maximize/Restore')}
              >
                <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={handleWindowClose}
                className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 dark:text-chrome-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-400"
                aria-label={l('关闭窗口', 'Close Window')}
                title={l('关闭', 'Close')}
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
                  title={l('展开历史记录', 'Expand History')}
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={handleNewAgentSession}
                  className="rounded-xl bg-slate-950 p-2 text-white transition hover:bg-slate-800 dark:bg-teal-300 dark:text-slate-950"
                  title={l('新建对话', 'New Chat')}
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
                        {l('历史记录', 'History')}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-chrome-400">
                        {l(`${sortedHistorySessions.length} 个 Agent 对话`, `${sortedHistorySessions.length} Agent chats`)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistorySidebarCollapsed(true)}
                      className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                      title={l('折叠历史记录', 'Collapse History')}
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
                      {l('新对话', 'New Chat')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAgentHistory}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      {l('清空', 'Clear')}
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {sortedHistorySessions.map((session) => (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenHistorySession(session)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleOpenHistorySession(session);
                          }
                        }}
                        className={[
                          'group w-full cursor-pointer rounded-[22px] border p-3 text-left transition',
                          session.id === activeSessionId
                            ? 'border-teal-300 bg-teal-50 shadow-[0_14px_35px_rgba(20,184,166,0.12)] dark:border-teal-300/30 dark:bg-teal-300/10'
                            : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white dark:bg-chrome-900/54 dark:hover:border-white/10 dark:hover:bg-chrome-900',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-black text-slate-950 dark:text-white">
                            {session.title}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={[
                                'h-2 w-2 rounded-full',
                                session.status === 'error'
                                  ? 'bg-rose-400'
                                  : session.status === 'running'
                                    ? 'bg-amber-400'
                                    : 'bg-teal-400',
                              ].join(' ')}
                            />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteHistorySession(session.id);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
                              aria-label={l('删除历史对话', 'Delete history item')}
                              title={l('删除历史对话', 'Delete history item')}
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          </span>
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                          {session.summary}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-slate-400 dark:text-chrome-500">
                          <span>{formatHistoryTime(session.updatedAt)}</span>
                          <span>{session.selectedPaperIds.length} papers</span>
                        </div>
                      </div>
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
                      {l('上下文文献', 'Context Papers')}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                      {l(
                        `已选择 ${selectedPaperIds.size} · 当前结果 ${filteredPapers.length} · 全部 ${papers.length}`,
                        `Selected ${selectedPaperIds.size} · Results ${filteredPapers.length} · Total ${papers.length}`,
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      disabled={filteredPapers.length === 0}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      {l('选择结果', 'Select Results')}
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      {l('清空', 'Clear')}
                    </button>
                  </div>
                </div>

                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-chrome-900/84 dark:text-chrome-300">
                  <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-chrome-500" strokeWidth={2} />
                  <input
                    value={paperSearchQuery}
                    onChange={(event) => setPaperSearchQuery(event.target.value)}
                    placeholder={l('搜索标题、作者、年份、标签...', 'Search title, author, year, tags...')}
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-chrome-100 dark:placeholder:text-chrome-500"
                  />
                </label>

                {selectedTags.length > 0 ? (
                  <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-chrome-950/60">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-chrome-400">
                      <Tags className="h-3.5 w-3.5" />
                      {l('当前标签', 'Current Tags')}
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
                    {l('正在加载文库...', 'Loading library...')}
                  </div>
                ) : papers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    {l('当前文库为空。先在文库工作区导入 PDF，再回到 Agent 页面批处理。', 'The library is empty. Import PDFs in the Library workspace first, then return to Agent for batch operations.')}
                  </div>
                ) : filteredPapers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    {l('没有匹配的文献。换一个关键词再试。', 'No matching papers. Try another keyword.')}
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
                              {formatPaperMeta(paper, locale) || l('暂无元数据', 'No metadata')}
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
                    {l('对话驱动的论文 Agent 执行链路', 'Conversation-driven Paper Agent workflow')}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-chrome-300">
                    {l(
                      'Agent 会把你的自然语言指令转换成可审查时间线、工具调用和 diff 计划。本地文库只有在你点击确认后才会被修改。',
                      'The Agent converts natural-language requests into reviewable timelines, tool calls, and diff plans. Your local library is modified only after confirmation.',
                    )}
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
                        {localizedCapabilityTitles[capability.key] ?? capability.title}
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
                            <div className="mt-3">
                              <AgentMarkdown content={message.content} />
                            </div>
                            {message.choices && message.choices.length > 0 ? (
                              <div className="mt-4 grid gap-2">
                                {message.choices.map((choice) => (
                                  <button
                                    key={choice.id}
                                    type="button"
                                    onClick={() => handleAgentChoice(choice.instruction)}
                                    disabled={activeSessionRunning}
                                    className="group rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:border-teal-200 hover:bg-teal-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-950/70 dark:hover:border-teal-300/30 dark:hover:bg-teal-300/10"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-sm font-black text-slate-950 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-200">
                                        {choice.label}
                                      </span>
                                      <PlayCircle className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-300" />
                                    </div>
                                    {choice.description ? (
                                      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                                        {choice.description}
                                      </div>
                                    ) : null}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {messagePlan ? (
                            <div className="shrink-0 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-chrome-950/70">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                                {l('当前工具', 'Current Tool')}
                              </div>
                              <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                                {localizedToolLabel(messagePlan.tool)}
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
                                  {l('结果 Diff 预览', 'Result Diff Preview')}
                                </div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
                                  {l('原值与新值分开展示，确认前不会写入数据库。', 'Original and new values are shown separately. Nothing is written before confirmation.')}
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
                                      setStatusMessage(l('这是历史计划，只能查看，不能修改审批状态。', 'This is a historical plan. You can view it, but cannot change its approval state.'));
                                    }
                                  }}
                                  onInspect={() => {
                                    setSelectedInspectorItemId(item.id);
                                    setStatusMessage(l(`正在查看计划项：${item.paperTitle}`, `Inspecting plan item: ${item.paperTitle}`));
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
                              disabled={applyingPlan || activeSessionRunning || !isActivePlan || approvedItemIds.size === 0}
                              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                            >
                              <PlayCircle className="h-4 w-4" />
                              {isActivePlan ? l('确认执行', 'Confirm Execution') : l('历史计划', 'Historical Plan')}
                            </button>
                            <button
                              type="button"
                              onClick={handleModifyPreviousParameters}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <Clipboard className="h-4 w-4" />
                              {l('修改参数', 'Modify Parameters')}
                            </button>
                            <button
                              type="button"
                              onClick={handlePreviewOnly}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <FileText className="h-4 w-4" />
                              {l('只预览', 'Preview Only')}
                            </button>
                            <button
                              type="button"
                              onClick={cancelPlan}
                              disabled={applyingPlan || activeSessionRunning || !isActivePlan}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <X className="h-4 w-4" />
                              {l('取消', 'Cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRetryAgent(lastInstruction)}
                              disabled={!lastInstruction || applyingPlan || activeSessionRunning}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                            >
                              <RotateCcw className="h-4 w-4" />
                              {l('重新生成', 'Regenerate')}
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
                  {(locale === 'en-US' ? promptSuggestionsEn : promptSuggestions).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setComposerValue(suggestion);
                        setStatusMessage(l('已填入示例指令，可直接发送或继续编辑。', 'Example instruction inserted. Send it directly or keep editing.'));
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
                    placeholder={l('在此处发送消息...', 'Send a message here...')}
                  />
                  <button
                    type="submit"
                    disabled={activeSessionRunning || !composerValue.trim()}
                    className="inline-flex h-[58px] items-center gap-2 rounded-[22px] bg-slate-950 px-5 text-sm font-black text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:opacity-50 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {activeSessionRunning ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Send className="h-4 w-4" strokeWidth={2} />}
                    {l('发送', 'Send')}
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
                      {plan
                        ? l(`${approvedItemIds.size} / ${plan.items.length} 项待执行`, `${approvedItemIds.size} / ${plan.items.length} items pending`)
                        : l('等待 Agent 计划', 'Waiting for Agent plan')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyPlan()}
                    disabled={!plan || approvedItemIds.size === 0 || applyingPlan || activeSessionRunning}
                    className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {applyingPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {l('执行', 'Run')}
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-chrome-950/58">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                      <Database className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                      {l('当前上下文', 'Current Context')}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedPapers.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{l('论文', 'Papers')}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedTags.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{l('标签', 'Tags')}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{new Set(selectedPapers.flatMap((paper) => paper.categoryIds)).size}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{l('分类', 'Collections')}</div>
                      </div>
                    </div>
                  </section>

                  {!plan ? (
                    <section className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/60 dark:text-chrome-400">
                      {l('发送对话后，Agent 会在这里展示工具、参数、返回结果、diff 和审批按钮。', 'After you send a message, the Agent will show tools, parameters, results, diffs, and approval controls here.')}
                    </section>
                  ) : (
                    <>
                      <section className="rounded-[26px] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-chrome-900/72">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                          <BrainCircuit className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                          {l('计划概览', 'Plan Overview')}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-chrome-400">
                          {plan.description}
                        </div>
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Tool</div>
                          <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                            {localizedToolLabel(plan.tool)}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{toolFunctionName(plan.tool)}</div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                            <Layers3 className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                            {l('审批项', 'Approval Items')}
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
                              setStatusMessage(l(`正在查看计划项：${item.paperTitle}`, `Inspecting plan item: ${item.paperTitle}`));
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
                        {l('选中项详情', 'Selected Item Details')}
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
                    {l(`将应用 ${selectedPlanItems.length} 个已勾选计划项。`, `${selectedPlanItems.length} checked plan items will be applied.`)}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void applyPlan()}
                      disabled={selectedPlanItems.length === 0 || applyingPlan || activeSessionRunning}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {l('确认执行', 'Confirm Execution')}
                    </button>
                    <button
                      type="button"
                      onClick={cancelPlan}
                      disabled={applyingPlan || activeSessionRunning}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-200"
                    >
                      <X className="h-4 w-4" />
                      {l('取消', 'Cancel')}
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
