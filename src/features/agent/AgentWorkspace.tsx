import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import {
  applyLibraryAgentPlan,
  loadLibraryAgentAvailableModelPresets,
  loadLibraryAgentModelPresetById,
  runConversationalLibraryAgent,
  type LibraryAgentConversationMessage,
  type LibraryAgentPlan,
} from '../../services/libraryAgent';
import { listLibraryPapers } from '../../services/library';
import type { LiteraturePaper } from '../../types/library';
import type { DocumentChatAttachment, QaModelPreset } from '../../types/reader';
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
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';
import { emitOpenPreferences } from '../../app/appEvents';
import AgentWorkspaceView from './AgentWorkspaceView';
import { buildAttachmentFromPath, buildScreenshotAttachmentFromPath } from '../reader/documentReaderShared';
import { captureSystemScreenshot, selectChatAttachmentPaths } from '../../services/desktop';
import { mergeUniqueAgentAttachments } from './agentAttachmentUtils';

interface AgentWorkspaceProps {
  onOpenPreferences?: () => void;
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
  const [agentModelPresets, setAgentModelPresets] = useState<QaModelPreset[]>([]);
  const [plan, setPlan] = useState<LibraryAgentPlan | null>(null);
  const [approvedItemIds, setApprovedItemIds] = useState<Set<string>>(() => new Set());
  const [expandedStepKeys, setExpandedStepKeys] = useState<Set<string>>(() => new Set());
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const [selectedInspectorItemId, setSelectedInspectorItemId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(() => newAgentSessionId());
  const [historySessions, setHistorySessions] = useState<AgentHistorySession[]>(() => loadAgentHistorySessions());
  const [historySidebarCollapsed, setHistorySidebarCollapsed] = useState(false);
  const [agentAttachments, setAgentAttachments] = useState<DocumentChatAttachment[]>([]);
  const [agentRagEnabled, setAgentRagEnabled] = useState(true);
  const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
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
  const historySidebarRef = useRef<HTMLElement | null>(null);
  const paperSidebarRef = useRef<HTMLElement | null>(null);
  const conversationPanelRef = useRef<HTMLElement | null>(null);
  const inspectorSidebarRef = useRef<HTMLElement | null>(null);
  const handleHistoryWheelCapture = useWheelScrollDelegate({ rootRef: historySidebarRef });
  const handlePaperWheelCapture = useWheelScrollDelegate({ rootRef: paperSidebarRef });
  const handleConversationWheelCapture = useWheelScrollDelegate({ rootRef: conversationPanelRef });
  const handleInspectorWheelCapture = useWheelScrollDelegate({ rootRef: inspectorSidebarRef });

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
    let cancelled = false;

    const loadModelPresets = async () => {
      try {
        const presets = await loadLibraryAgentAvailableModelPresets();

        if (cancelled) {
          return;
        }

        setAgentModelPresets(presets);
        setSelectedAgentPresetId((current) => current ?? presets[0]?.id ?? null);
        if (presets[0]) {
          setAgentPresetName(presets[0].label || presets[0].model);
        }
      } catch {
        if (!cancelled) {
          setAgentModelPresets([]);
        }
      }
    };

    void loadModelPresets();

    return () => {
      cancelled = true;
    };
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
      ragEnabled: agentRagEnabled,
      selectedModelPresetId: selectedAgentPresetId ?? undefined,
      attachments: agentAttachments,
      locale,
    });

    setHistorySessions((current) => {
      const otherSessions = current.filter((session) => session.id !== activeSessionId);
      return [nextSession, ...otherSessions].slice(0, 30);
    });
  }, [
    activeSessionId,
    agentAttachments,
    agentRagEnabled,
    lastInstruction,
    locale,
    messages,
    selectedAgentPresetId,
    selectedPaperIds,
  ]);

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
        ragEnabled: agentRagEnabled,
        selectedModelPresetId: selectedAgentPresetId ?? undefined,
        attachments: agentAttachments,
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
        ragEnabled: targetSession.ragEnabled,
        selectedModelPresetId: targetSession.selectedModelPresetId,
        attachments: targetSession.attachments,
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
      .filter((message) => (message.content.trim() || message.attachments?.length) && !message.error)
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
        attachments: message.attachments,
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
    const attachmentsSnapshot = [...agentAttachments];
    const userMessage: AgentChatMessage = {
      id: newMessageId(),
      role: 'user',
      content: instruction,
      attachments: attachmentsSnapshot,
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
    setAgentAttachments([]);
    setAgentSessionRunning(sessionId, true);
    setError('');
    setPlan(null);
    setApprovedItemIds(new Set());
    setSelectedInspectorItemId(null);

    try {
      const preset = await loadLibraryAgentModelPresetById(selectedAgentPresetId);

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
        ragEnabled: agentRagEnabled,
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

  const handleSelectAgentAttachments = async (kind: 'image' | 'file') => {
    try {
      const paths = await selectChatAttachmentPaths(kind);

      if (paths.length === 0) {
        setStatusMessage(
          kind === 'image'
            ? l('已取消选择图片附件。', 'Cancelled image attachment selection.')
            : l('已取消选择文件附件。', 'Cancelled file attachment selection.'),
        );
        return;
      }

      const attachments = await Promise.all(
        paths.map((path) => buildAttachmentFromPath(path, kind, locale)),
      );

      setAgentAttachments((current) => mergeUniqueAgentAttachments(current, attachments));
      setStatusMessage(
        l(`已添加 ${attachments.length} 个附件。`, `Added ${attachments.length} attachment(s).`),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('加载 Agent 附件失败', 'Failed to load Agent attachments');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleCaptureAgentScreenshot = async () => {
    if (capturingScreenshot) {
      return;
    }

    try {
      setCapturingScreenshot(true);
      setError('');
      setStatusMessage(l('正在启动系统截图...', 'Starting system screenshot...'));
      const screenshot = await captureSystemScreenshot();

      if (!screenshot) {
        setStatusMessage(l('已取消系统截图。', 'System screenshot cancelled.'));
        return;
      }

      const attachment = await buildScreenshotAttachmentFromPath(screenshot.path, locale);
      setAgentAttachments((current) => mergeUniqueAgentAttachments(current, [attachment]));
      setStatusMessage(
        l(`已添加系统截图：${attachment.name}`, `Screenshot attached: ${attachment.name}`),
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : l('系统截图失败', 'System screenshot failed');
      setError(message);
      setStatusMessage(message);
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const handleRemoveAgentAttachment = (attachmentId: string) => {
    setAgentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleToggleAgentRag = () => {
    setAgentRagEnabled((current) => {
      const next = !current;

      setStatusMessage(
        next
          ? l('已开启 Agent RAG，上下文请求会优先尝试本地检索。', 'Agent RAG enabled. Context requests will try local retrieval first.')
          : l('已关闭 Agent RAG，上下文请求将直接使用 PDF 全文。', 'Agent RAG disabled. Context requests will use raw PDF text directly.'),
      );

      return next;
    });
  };

  const handleAgentPresetChange = (presetId: string) => {
    const nextPreset = agentModelPresets.find((preset) => preset.id === presetId) ?? agentModelPresets[0] ?? null;

    if (!nextPreset) {
      return;
    }

    setSelectedAgentPresetId(nextPreset.id);
    setAgentPresetName(nextPreset.label || nextPreset.model);
    setStatusMessage(
      l(`已切换 Agent 模型：${nextPreset.label || nextPreset.model}`, `Switched Agent model: ${nextPreset.label || nextPreset.model}`),
    );
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
    setAgentAttachments([]);
    setAgentRagEnabled(true);
    setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
    if (agentModelPresets[0]) {
      setAgentPresetName(agentModelPresets[0].label || agentModelPresets[0].model);
    }
    setError('');
    setStatusMessage(l('已创建新的 Agent 对话。', 'Created a new Agent chat.'));
  };

  const handleOpenHistorySession = (session: AgentHistorySession) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setSelectedPaperIds(new Set(session.selectedPaperIds));
    setLastInstruction(session.lastInstruction);
    setAgentRagEnabled(session.ragEnabled !== false);
    setSelectedAgentPresetId(session.selectedModelPresetId ?? agentModelPresets[0]?.id ?? null);
    const restoredPreset =
      agentModelPresets.find((preset) => preset.id === session.selectedModelPresetId) ??
      agentModelPresets[0] ??
      null;
    if (restoredPreset) {
      setAgentPresetName(restoredPreset.label || restoredPreset.model);
    }
    setAgentAttachments(session.attachments ?? []);
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
      setAgentAttachments([]);
      setAgentRagEnabled(true);
      setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
      if (agentModelPresets[0]) {
        setAgentPresetName(agentModelPresets[0].label || agentModelPresets[0].model);
      }
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
    setAgentAttachments([]);
    setAgentRagEnabled(true);
    setSelectedAgentPresetId((current) => current ?? agentModelPresets[0]?.id ?? null);
    if (agentModelPresets[0]) {
      setAgentPresetName(agentModelPresets[0].label || agentModelPresets[0].model);
    }
    setHistorySessions([
      buildAgentHistorySession({
        id: nextSessionId,
        messages: nextMessages,
        selectedPaperIds: [...selectedPaperIds],
        lastInstruction: '',
        ragEnabled: true,
        selectedModelPresetId: selectedAgentPresetId ?? undefined,
        attachments: [],
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
    <AgentWorkspaceView
      activeSessionId={activeSessionId}
      activeSessionRunning={activeSessionRunning}
      agentAttachments={agentAttachments}
      agentCapabilities={agentCapabilities}
      agentModelPresets={agentModelPresets}
      agentPresetName={agentPresetName}
      agentRagEnabled={agentRagEnabled}
      applyingPlan={applyingPlan}
      approvedItemIds={approvedItemIds}
      chatScrollRef={chatScrollRef}
      composerValue={composerValue}
      conversationPanelRef={conversationPanelRef}
      error={error}
      expandedStepKeys={expandedStepKeys}
      expandedToolIds={expandedToolIds}
      filteredPapers={filteredPapers}
      formatHistoryTime={formatHistoryTime}
      formatPaperMeta={formatPaperMeta}
      handleAgentChoice={handleAgentChoice}
      handleClearAgentHistory={handleClearAgentHistory}
      handleConversationWheelCapture={handleConversationWheelCapture}
      handleDeleteHistorySession={handleDeleteHistorySession}
      handleHistoryWheelCapture={handleHistoryWheelCapture}
      handleModifyPreviousParameters={handleModifyPreviousParameters}
      handleNewAgentSession={handleNewAgentSession}
      handleOpenHistorySession={handleOpenHistorySession}
      handleOpenPreferences={handleOpenPreferences}
      handleInspectorWheelCapture={handleInspectorWheelCapture}
      handlePaperWheelCapture={handlePaperWheelCapture}
      handlePreviewOnly={handlePreviewOnly}
      handleRetryAgent={handleRetryAgent}
      handleToggleThemeMode={handleToggleThemeMode}
      handleWindowClose={handleWindowClose}
      handleWindowMinimize={handleWindowMinimize}
      handleWindowToggleMaximize={handleWindowToggleMaximize}
      historySidebarCollapsed={historySidebarCollapsed}
      historySidebarRef={historySidebarRef}
      inspectorSidebarRef={inspectorSidebarRef}
      l={l}
      lastInstruction={lastInstruction}
      loading={loading}
      locale={locale}
      localizedCapabilityTitles={localizedCapabilityTitles}
      localizedToolLabel={localizedToolLabel}
      messages={messages}
      onApplyPlan={() => {
        void applyPlan();
      }}
      onCancelPlan={cancelPlan}
      onClearSelection={clearSelection}
      onComposerChange={setComposerValue}
      onCopyToolParameters={(toolCall) => {
        void copyToolParameters(toolCall);
      }}
      onAgentPresetChange={handleAgentPresetChange}
      onCaptureScreenshot={() => {
        void handleCaptureAgentScreenshot();
      }}
      onHistorySidebarCollapsedChange={setHistorySidebarCollapsed}
      onInspectPlanItem={(itemId, paperTitle) => {
        setSelectedInspectorItemId(itemId);
        setStatusMessage(l(`正在查看计划项：${paperTitle}`, `Inspecting plan item: ${paperTitle}`));
      }}
      onPaperSearchQueryChange={setPaperSearchQuery}
      onRefreshPapers={() => {
        void refreshPapers();
      }}
      onRemoveAttachment={handleRemoveAgentAttachment}
      onSelectAllVisible={selectAllVisible}
      onSelectFileAttachments={() => {
        void handleSelectAgentAttachments('file');
      }}
      onSelectImageAttachments={() => {
        void handleSelectAgentAttachments('image');
      }}
      onSubmitPrompt={submitPrompt}
      onToggleAgentRag={handleToggleAgentRag}
      onTogglePaper={togglePaper}
      onTogglePlanItem={togglePlanItem}
      onToggleStep={toggleStep}
      onToggleTool={toggleTool}
      paperSearchQuery={paperSearchQuery}
      paperSidebarRef={paperSidebarRef}
      papers={papers}
      plan={plan}
      promptSuggestions={locale === 'en-US' ? promptSuggestionsEn : promptSuggestions}
      selectedInspectorItem={selectedInspectorItem}
      selectedAgentPresetId={selectedAgentPresetId ?? ''}
      selectedPaperIds={selectedPaperIds}
      selectedPapers={selectedPapers}
      selectedPlanItems={selectedPlanItems}
      selectedTags={selectedTags}
      screenshotLoading={capturingScreenshot}
      setStatusMessage={setStatusMessage}
      sortedHistorySessions={sortedHistorySessions}
      statusMessage={statusMessage}
      submitPromptFromEnter={() => {
        void runAgent(composerValue);
      }}
      themeMode={themeMode}
    />
  );
}

export default AgentWorkspace;
