import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type Ref,
  type WheelEventHandler,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Brain,
  Camera,
  BookOpen,
  Check,
  Database,
  ImagePlus,
  Loader2,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Tags,
  X,
} from 'lucide-react';
import { ModelPresetPicker } from '../../components/ModelPresetPicker';
import type { LibraryAgentPlan } from '../../services/libraryAgent';
import type { LiteraturePaper } from '../../types/library';
import type { DocumentChatAttachment, ModelReasoningEffort, QaModelPreset, UiLanguage } from '../../types/reader';
import type {
  AgentChatMessage,
  AgentHistorySession,
  AgentToolCallView,
} from './AgentWorkspace.types';
import { AssistantMessageCard, UserMessageCard } from './AgentWorkspaceMessages';
import { formatFileSize } from '../../utils/files';

interface AgentWorkspaceViewProps {
  activeSessionId: string;
  activeSessionRunning: boolean;
  agentAttachments: DocumentChatAttachment[];
  agentModelPresets: QaModelPreset[];
  agentRagEnabled: boolean;
  applyingPlan: boolean;
  approvedItemIds: Set<string>;
  chatScrollRef: Ref<HTMLDivElement>;
  composerValue: string;
  conversationPanelRef: Ref<HTMLElement>;
  error: string;
  expandedStepKeys: Set<string>;
  expandedToolIds: Set<string>;
  filteredPapers: LiteraturePaper[];
  formatHistoryTime: (timestamp: number) => string;
  formatPaperMeta: (paper: LiteraturePaper, locale: UiLanguage) => string;
  handleAgentChoice: (instruction: string, paperScopeIds?: string[]) => void;
  handleClearAgentHistory: () => void;
  handleConversationWheelCapture: WheelEventHandler<HTMLElement>;
  handleDeleteHistorySession: (sessionId: string) => void;
  handleHistoryWheelCapture: WheelEventHandler<HTMLElement>;
  handleModifyPreviousParameters: () => void;
  handleNewAgentSession: () => void;
  handleOpenHistorySession: (session: AgentHistorySession) => void;
  handleRetryAgent: (instruction: string) => void;
  historySidebarCollapsed: boolean;
  historySidebarRef: Ref<HTMLElement>;
  l: (zh: string, en: string) => string;
  lastInstruction: string;
  loading: boolean;
  locale: UiLanguage;
  localizedToolLabel: (tool: LibraryAgentPlan['tool']) => string;
  messages: AgentChatMessage[];
  onApplyPlan: () => void;
  onAgentPresetChange: (presetId: string) => void;
  onAgentReasoningEffortChange: (reasoningEffort: ModelReasoningEffort) => void;
  onCancelPlan: () => void;
  onCaptureScreenshot: () => void;
  onClearSelection: () => void;
  onComposerChange: (value: string) => void;
  onCopyToolParameters: (toolCall: AgentToolCallView) => void;
  onHistorySidebarCollapsedChange: (collapsed: boolean) => void;
  onInlinePaperSelectionContinue: (instruction: string, paperIds: string[]) => void;
  onInspectPlanItem: (itemId: string, paperTitle: string) => void;
  onPaperSearchQueryChange: (value: string) => void;
  onRefreshPapers: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onFindPapers: () => void;
  onRecommendPapers: () => void;
  onSelectAllVisible: () => void;
  onSelectFileAttachments: () => void;
  onSelectImageAttachments: () => void;
  onSubmitPrompt: (event: FormEvent<HTMLFormElement>) => void;
  onToggleAgentRag: () => void;
  onTogglePaper: (paperId: string) => void;
  onUseFullLibraryRag: () => void;
  onTogglePlanItem: (itemId: string) => void;
  onToggleStep: (stepKey: string) => void;
  onToggleTool: (toolCallId: string) => void;
  paperSearchQuery: string;
  papers: LiteraturePaper[];
  plan: LibraryAgentPlan | null;
  promptSuggestions: string[];
  selectedAgentPresetId: string;
  selectedAgentReasoningEffort: ModelReasoningEffort;
  selectedPaperIds: Set<string>;
  selectedPapers: LiteraturePaper[];
  selectedTags: string[];
  screenshotLoading: boolean;
  setStatusMessage: (message: string) => void;
  sortedHistorySessions: AgentHistorySession[];
  submitPromptFromEnter: () => void;
}

const agentIconButtonClass =
  'pq-icon-button h-9 w-9 border border-[var(--pq-border)] bg-white/60 disabled:opacity-50';
const agentHistoryIconButtonClass =
  'pq-icon-button h-8 w-8 border border-transparent bg-transparent text-[var(--pq-text-muted)] hover:border-[var(--pq-border)] hover:bg-[var(--pq-surface-2)] disabled:opacity-50';
const agentToolbarButtonClass = 'pq-button px-3 py-1.5 text-xs';
const agentToolbarPrimaryButtonClass = 'pq-button-primary px-3 py-1.5 text-xs';
const agentTagClass = 'pq-chip px-2 py-0.5 text-[11px] font-semibold';
const agentComposerIconButtonClass =
  'pq-icon-button h-10 w-10 shrink-0 border border-[var(--pq-border)] bg-white/60 disabled:cursor-not-allowed disabled:opacity-50';
const agentReasoningOptions: Array<{ value: ModelReasoningEffort; labelZh: string; labelEn: string }> = [
  { value: 'auto', labelZh: '自动', labelEn: 'Auto' },
  { value: 'low', labelZh: '低', labelEn: 'Low' },
  { value: 'medium', labelZh: '中', labelEn: 'Medium' },
  { value: 'high', labelZh: '高', labelEn: 'High' },
  { value: 'xhigh', labelZh: '极高', labelEn: 'XHigh' },
];

function AgentReasoningPicker({
  l,
  onChange,
  value,
}: {
  l: (zh: string, en: string) => string;
  onChange: (reasoningEffort: ModelReasoningEffort) => void;
  value: ModelReasoningEffort;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selectedOption = agentReasoningOptions.find((option) => option.value === value) ?? agentReasoningOptions[0];
  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button || typeof window === 'undefined') {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = Math.min(190, Math.max(160, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));

    setMenuStyle({
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
      left,
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setOpen(false);
    };
    const handleViewportChange = () => updateMenuPosition();

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="pq-card fixed z-[9999] overflow-hidden p-1 shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
      style={menuStyle}
    >
      {agentReasoningOptions.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            className={[
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
              selected
                ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]'
                : 'text-[var(--pq-text)] hover:bg-[var(--pq-surface-2)]',
            ].join(' ')}
          >
            <span>{l(option.labelZh, option.labelEn)}</span>
            {selected ? <Check className="h-4 w-4" strokeWidth={2.2} /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={`${l('思考强度', 'Reasoning effort')}: ${l(selectedOption.labelZh, selectedOption.labelEn)}`}
        aria-label={l('选择思考强度', 'Choose reasoning effort')}
        aria-expanded={open}
        className={[
          'pq-icon-button h-10 w-10 border bg-white/60',
          value === 'auto'
            ? 'border-[var(--pq-border)] text-slate-400 dark:bg-white/5 dark:text-[var(--pq-text-faint)]'
            : 'border-[var(--pq-accent)] bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]',
        ].join(' ')}
      >
        <Brain className="h-4 w-4" strokeWidth={1.8} />
      </button>

      {typeof document === 'undefined' || !menu ? null : createPortal(menu, document.body)}
    </div>
  );
}

export default function AgentWorkspaceView({
  activeSessionId,
  activeSessionRunning,
  agentAttachments,
  agentModelPresets,
  agentRagEnabled,
  applyingPlan,
  approvedItemIds,
  chatScrollRef,
  composerValue,
  conversationPanelRef,
  error,
  expandedStepKeys,
  expandedToolIds,
  filteredPapers,
  formatHistoryTime,
  formatPaperMeta,
  handleAgentChoice,
  handleClearAgentHistory,
  handleConversationWheelCapture,
  handleDeleteHistorySession,
  handleHistoryWheelCapture,
  handleModifyPreviousParameters,
  handleNewAgentSession,
  handleOpenHistorySession,
  handleRetryAgent,
  historySidebarCollapsed,
  historySidebarRef,
  l,
  lastInstruction,
  loading,
  locale,
  localizedToolLabel,
  messages,
  onApplyPlan,
  onAgentPresetChange,
  onAgentReasoningEffortChange,
  onCancelPlan,
  onCaptureScreenshot,
  onClearSelection,
  onComposerChange,
  onCopyToolParameters,
  onHistorySidebarCollapsedChange,
  onInlinePaperSelectionContinue,
  onInspectPlanItem,
  onPaperSearchQueryChange,
  onRefreshPapers,
  onRemoveAttachment,
  onFindPapers,
  onRecommendPapers,
  onSelectAllVisible,
  onSelectFileAttachments,
  onSelectImageAttachments,
  onSubmitPrompt,
  onToggleAgentRag,
  onTogglePaper,
  onUseFullLibraryRag,
  onTogglePlanItem,
  onToggleStep,
  onToggleTool,
  paperSearchQuery,
  papers,
  plan,
  promptSuggestions,
  selectedAgentPresetId,
  selectedAgentReasoningEffort,
  selectedPaperIds,
  selectedPapers,
  selectedTags,
  screenshotLoading,
  setStatusMessage,
  sortedHistorySessions,
  submitPromptFromEnter,
}: AgentWorkspaceViewProps) {
  const [paperToolOpen, setPaperToolOpen] = useState(false);
  const isFreshAgentSession =
    messages.length === 1 &&
    messages[0]?.role === 'assistant' &&
    Boolean(messages[0]?.trace?.some((step) => step.id === 'welcome-intent')) &&
    !activeSessionRunning &&
    !plan;

  return (
    <div className="pq-saas-scope pq-agent-workspace pq-workspace-surface relative h-full min-h-0 overflow-hidden text-[var(--pq-text)]">
      <div className="flex h-full min-h-0 flex-col bg-transparent">
        <main
          className="grid min-h-0 flex-1 overflow-hidden"
          style={{
            gridTemplateColumns: historySidebarCollapsed
              ? '64px minmax(0,1fr)'
              : '260px minmax(0,1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
          }}
        >
          <aside
            ref={historySidebarRef}
            onWheelCapture={handleHistoryWheelCapture}
            className="pq-agent-pane min-h-0 border-r"
          >
            {historySidebarCollapsed ? (
              <div className="flex h-full min-h-0 flex-col items-center gap-3 px-2 py-4">
                <button
                  type="button"
                  onClick={() => onHistorySidebarCollapsedChange(false)}
                  className={agentHistoryIconButtonClass}
                  title={l('展开历史记录', 'Expand History')}
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={handleNewAgentSession}
                  className="pq-button-primary h-9 w-9 rounded-full p-0"
                  title={l('新建对话', 'New Chat')}
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                </button>
                <div
                  data-wheel-scroll-target
                  className="mt-1 flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-y-contain"
                >
                  {sortedHistorySessions.slice(0, 12).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => handleOpenHistorySession(session)}
                      className={[
                        'h-2.5 w-2.5 rounded-full transition',
                        session.id === activeSessionId
                          ? 'bg-[#55a99b] ring-4 ring-[#55a99b]/15'
                          : session.status === 'error'
                            ? 'bg-rose-400 hover:bg-rose-500'
                            : 'bg-slate-300 hover:bg-slate-400 dark:bg-[var(--pq-surface-3)] dark:hover:bg-[var(--pq-surface-3)]',
                      ].join(' ')}
                      title={session.title}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-[var(--pq-border-subtle)] px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate px-1 text-sm font-semibold text-[var(--pq-text)]">
                      {l('对话', 'Chats')}
                    </div>
                    <button
                      type="button"
                      onClick={() => onHistorySidebarCollapsedChange(true)}
                      className={agentHistoryIconButtonClass}
                      title={l('折叠历史记录', 'Collapse History')}
                    >
                      <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleNewAgentSession}
                    className="mt-3 flex h-9 w-full items-center gap-2 rounded-[var(--pq-radius-sm)] px-2.5 text-left text-sm font-medium text-[var(--pq-text)] transition hover:bg-[var(--pq-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pq-focus-ring)]"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-[var(--pq-text-muted)]" strokeWidth={2} />
                    <span className="truncate">{l('新对话', 'New Chat')}</span>
                  </button>
                </div>

                <div
                  data-wheel-scroll-target
                  className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2"
                >
                  <div className="space-y-0.5">
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
                          'group relative w-full cursor-pointer rounded-[var(--pq-radius-sm)] px-2.5 py-2 text-left transition',
                          session.id === activeSessionId
                            ? 'bg-[var(--pq-surface-2)]'
                            : 'bg-transparent hover:bg-[var(--pq-surface-2)]',
                        ].join(' ')}
                      >
                        {session.id === activeSessionId ? (
                          <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--pq-accent)]" />
                        ) : null}
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1">
                            <span
                              className={[
                                'block truncate text-sm',
                                session.id === activeSessionId
                                  ? 'font-semibold text-[var(--pq-text)]'
                                  : 'font-medium text-[var(--pq-text-muted)] group-hover:text-[var(--pq-text)]',
                              ].join(' ')}
                            >
                              {session.title}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--pq-text-faint)]">
                              <span
                                className={[
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  session.status === 'error'
                                    ? 'bg-rose-400'
                                    : session.status === 'running'
                                      ? 'bg-amber-400'
                                      : 'bg-slate-300 dark:bg-white/20',
                                ].join(' ')}
                              />
                              <span className="truncate">{formatHistoryTime(session.updatedAt)}</span>
                              {session.selectedPaperIds.length > 0 ? (
                                <span className="shrink-0">
                                  {l(`${session.selectedPaperIds.length} 篇`, `${session.selectedPaperIds.length} papers`)}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteHistorySession(session.id);
                            }}
                            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--pq-radius-sm)] text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
                            aria-label={l('删除历史对话', 'Delete history item')}
                            title={l('删除历史对话', 'Delete history item')}
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-[var(--pq-border-subtle)] px-3 py-2">
                  <button
                    type="button"
                    onClick={handleClearAgentHistory}
                    className="flex h-8 w-full items-center rounded-[var(--pq-radius-sm)] px-2.5 text-left text-xs font-medium text-[var(--pq-text-faint)] transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
                  >
                    {l('清空历史记录', 'Clear history')}
                  </button>
                </div>
              </div>
            )}
          </aside>

          <section
            ref={conversationPanelRef}
            onWheelCapture={handleConversationWheelCapture}
            className={isFreshAgentSession ? 'flex min-h-0 flex-col justify-center px-6 py-10' : 'flex min-h-0 flex-col'}
          >
            <div
              ref={chatScrollRef}
              data-wheel-scroll-target
              className={isFreshAgentSession ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4'}
            >
              <div className="mx-auto max-w-5xl space-y-5">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <UserMessageCard key={message.id} message={message} />
                  ) : (
                    <AssistantMessageCard
                      key={message.id}
                      activeSessionRunning={activeSessionRunning}
                      approvedItemIds={approvedItemIds}
                      applyingPlan={applyingPlan}
                      composerValue={composerValue}
                      expandedStepKeys={expandedStepKeys}
                      expandedToolIds={expandedToolIds}
                      formatPaperMeta={formatPaperMeta}
                      handleAgentChoice={handleAgentChoice}
                      handleModifyPreviousParameters={handleModifyPreviousParameters}
                      handleRetryAgent={handleRetryAgent}
                      isActivePlan={Boolean(message.plan && plan?.id === message.plan.id)}
                      l={l}
                      lastInstruction={lastInstruction}
                      loading={loading}
                      locale={locale}
                      localizedToolLabel={localizedToolLabel}
                      message={message}
                      onApplyPlan={onApplyPlan}
                      onCancelPlan={onCancelPlan}
                      onCopyToolParameters={onCopyToolParameters}
                      onContinueWithSelectedPapers={onInlinePaperSelectionContinue}
                      onInspectPlanItem={onInspectPlanItem}
                      onTogglePlanItem={onTogglePlanItem}
                      onToggleStep={onToggleStep}
                      onToggleTool={onToggleTool}
                      papers={papers}
                      setStatusMessage={setStatusMessage}
                    />
                  ),
                )}
              </div>
            </div>

            <div className={isFreshAgentSession ? 'bg-transparent px-0 py-0' : 'border-t border-[var(--pq-border)] bg-white/62 px-5 py-4 backdrop-blur-xl dark:bg-white/5'}>
              <div className={isFreshAgentSession ? 'mx-auto w-full max-w-3xl' : 'mx-auto max-w-5xl'}>
                {isFreshAgentSession ? (
                  <div className="mb-7 text-center">
                    <div className="text-2xl font-semibold tracking-tight text-[var(--pq-text)]">PaperQuay Agent</div>
                    <div className="mt-2 text-sm text-[var(--pq-text-muted)]">
                      {l('直接提问；需要限定范围时再选择文献。', 'Ask directly; select papers only when you need to limit the scope.')}
                    </div>
                  </div>
                ) : null}

                <div className={isFreshAgentSession ? 'hidden' : 'mb-3 flex flex-wrap gap-2'}>
                  {promptSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        onComposerChange(suggestion);
                        setStatusMessage(
                          l(
                            '已填入示例指令，可直接发送或继续编辑。',
                            'Example instruction inserted. Send it directly or keep editing.',
                          ),
                        );
                      }}
                      className={agentToolbarButtonClass}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {error ? (
                  <div className="mb-3 whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm leading-6 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                    {error}
                  </div>
                ) : null}

                {agentAttachments.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {agentAttachments.map((attachment) => {
                      const AttachmentIcon =
                        attachment.kind === 'image'
                          ? ImagePlus
                          : attachment.kind === 'screenshot'
                            ? Camera
                            : Paperclip;

                      return (
                        <div
                          key={attachment.id}
                          className="pq-card group inline-flex items-center gap-3 px-3 py-2 text-xs text-[var(--pq-text-muted)]"
                        >
                          {attachment.dataUrl &&
                          (attachment.kind === 'image' || attachment.kind === 'screenshot') ? (
                            <img
                              src={attachment.dataUrl}
                              alt={attachment.name}
                              className="h-10 w-10 rounded-lg border border-[var(--pq-border)] object-cover"
                            />
                          ) : (
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]">
                              <AttachmentIcon className="h-4 w-4" strokeWidth={1.8} />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="max-w-[180px] truncate font-medium text-slate-700 dark:text-[var(--pq-text-muted)]">
                              {attachment.name}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400 dark:text-[var(--pq-text-faint)]">
                              {formatFileSize(attachment.size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveAttachment(attachment.id)}
                            className="pq-icon-button h-7 w-7 rounded-lg"
                            aria-label={l('移除附件', 'Remove attachment')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {paperToolOpen ? (
                  <div className="pq-card mb-3 overflow-hidden p-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--pq-border)] px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
                          <BookOpen className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={2} />
                          {l('选择文献', 'Select Papers')}
                          <span className="rounded-md bg-[var(--pq-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pq-accent)]">
                            {agentRagEnabled ? 'RAG on' : 'RAG off'}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-[var(--pq-text-faint)]">
                          {l(
                            `手动选择 ${selectedPaperIds.size} · 搜索结果 ${filteredPapers.length} · 全库 ${papers.length}。未选择时，RAG 自动使用全库候选。`,
                            `Manual ${selectedPaperIds.size} · Results ${filteredPapers.length} · Library ${papers.length}. When none are selected, RAG automatically uses the full library.`,
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onRefreshPapers}
                          disabled={loading || applyingPlan}
                          className={agentIconButtonClass}
                          title={l('刷新文库', 'Refresh Library')}
                          aria-label={l('刷新文库', 'Refresh Library')}
                        >
                          <RefreshCw
                            className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
                            strokeWidth={1.8}
                          />
                        </button>
                        <button type="button" onClick={onFindPapers} className={agentToolbarButtonClass}>
                          {l('找文献', 'Find Papers')}
                        </button>
                        <button type="button" onClick={onRecommendPapers} className={agentToolbarButtonClass}>
                          {l('推荐论文', 'Recommend')}
                        </button>
                        <button type="button" onClick={onUseFullLibraryRag} className={agentToolbarPrimaryButtonClass}>
                          {l('使用全库', 'Use Full Library')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaperToolOpen(false)}
                          className={agentIconButtonClass}
                          aria-label={l('收起选择文献', 'Collapse paper selection')}
                          title={l('收起选择文献', 'Collapse paper selection')}
                        >
                          <X className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <label className="pq-input flex min-w-[240px] flex-1 items-center gap-2 px-3 py-2.5 text-sm text-[var(--pq-text-muted)]">
                          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-[var(--pq-text-faint)]" strokeWidth={2} />
                          <input
                            value={paperSearchQuery}
                            onChange={(event) => onPaperSearchQueryChange(event.target.value)}
                            placeholder={l('搜索标题、作者、年份、标签...', 'Search title, author, year, tags...')}
                            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-[var(--pq-text)] dark:placeholder:text-[var(--pq-text-faint)]"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={onSelectAllVisible}
                          disabled={filteredPapers.length === 0}
                          className={agentToolbarButtonClass}
                        >
                          {l('选择结果', 'Select Results')}
                        </button>
                        <button
                          type="button"
                          onClick={onClearSelection}
                          className={agentToolbarButtonClass}
                        >
                          {l('清空', 'Clear')}
                        </button>
                      </div>

                      {selectedTags.length > 0 ? (
                        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
                          <Tags className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          {selectedTags.map((tag) => (
                            <span key={tag} className={agentTagClass}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div
                        data-wheel-scroll-target
                        className="max-h-72 overflow-y-auto overscroll-y-contain rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)]"
                      >
                        {loading ? (
                          <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                            {l('正在加载文库...', 'Loading library...')}
                          </div>
                        ) : papers.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[var(--pq-border)] p-4 text-sm leading-7 text-[var(--pq-text-muted)]">
                            {l(
                              '当前文库为空。先在文库工作区导入 PDF，再回到 Agent 进行检索、推荐或批处理。',
                              'The library is empty. Import PDFs in the Library workspace first, then return to Agent for retrieval, recommendation, or batch work.',
                            )}
                          </div>
                        ) : filteredPapers.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[var(--pq-border)] p-4 text-sm leading-7 text-[var(--pq-text-muted)]">
                            {l('没有匹配的文献。换一个关键词再试。', 'No matching papers. Try another keyword.')}
                          </div>
                        ) : (
                          <div className="divide-y divide-[var(--pq-border-subtle)]">
                            {filteredPapers.map((paper) => {
                              const selected = selectedPaperIds.has(paper.id);

                              return (
                                <button
                                  key={paper.id}
                                  type="button"
                                  onClick={() => onTogglePaper(paper.id)}
                                  className={[
                                    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                                    selected
                                      ? 'bg-[var(--pq-accent-soft)]'
                                      : 'bg-transparent hover:bg-[var(--pq-surface-2)]',
                                  ].join(' ')}
                                >
                                  <span
                                    className={[
                                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                      selected
                                        ? 'border-[var(--pq-accent)] bg-[var(--pq-accent)] text-[var(--pq-accent-text)]'
                                        : 'border-slate-300 bg-white text-transparent dark:border-white/20 dark:bg-[var(--pq-bg-primary)]',
                                    ].join(' ')}
                                  >
                                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="truncate text-sm font-semibold text-[var(--pq-text)]">
                                      {paper.title}
                                    </span>
                                    <span className="mt-1 block truncate text-xs text-slate-500 dark:text-[var(--pq-text-faint)]">
                                      {formatPaperMeta(paper, locale) || l('暂无元数据', 'No metadata')}
                                    </span>
                                  </span>
                                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
                                    {paper.year || ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <form
                  onSubmit={onSubmitPrompt}
                  className={
                    isFreshAgentSession
                      ? 'pq-chat-composer p-3 shadow-[0_18px_48px_rgba(15,23,42,0.12)]'
                      : 'pq-chat-composer p-3'
                  }
                >
                  <textarea
                    value={composerValue}
                    onChange={(event) => onComposerChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submitPromptFromEnter();
                      }
                    }}
                    className={
                      isFreshAgentSession
                        ? 'min-h-[72px] w-full resize-none rounded-xl border-0 bg-transparent px-1 py-1 text-sm leading-7 text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]'
                        : 'min-h-[96px] w-full resize-none rounded-xl border-0 bg-transparent px-1 py-1 text-sm leading-7 text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]'
                    }
                    placeholder={l('在此处发送消息...', 'Send a message here...')}
                  />
                  <div className="mt-3 flex flex-nowrap items-end justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button
                        type="button"
                        onClick={onSelectImageAttachments}
                        title={l('添加图片', 'Add images')}
                        aria-label={l('添加图片', 'Add images')}
                        className={agentComposerIconButtonClass}
                      >
                        <ImagePlus className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={onSelectFileAttachments}
                        title={l('添加文件', 'Add files')}
                        aria-label={l('添加文件', 'Add files')}
                        className={agentComposerIconButtonClass}
                      >
                        <Paperclip className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={onCaptureScreenshot}
                        disabled={screenshotLoading}
                        title={screenshotLoading ? l('截图中...', 'Capturing...') : l('截图', 'Screenshot')}
                        aria-label={screenshotLoading ? l('截图中...', 'Capturing...') : l('截图', 'Screenshot')}
                        className={agentComposerIconButtonClass}
                      >
                        {screenshotLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                        ) : (
                          <Camera className="h-4 w-4" strokeWidth={1.8} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={onToggleAgentRag}
                        title={agentRagEnabled ? l('关闭 RAG', 'Disable RAG') : l('开启 RAG', 'Enable RAG')}
                        aria-label={agentRagEnabled ? l('关闭 RAG', 'Disable RAG') : l('开启 RAG', 'Enable RAG')}
                        className={[
                          'pq-icon-button relative h-10 w-10 shrink-0 border transition',
                          agentRagEnabled
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] dark:border-emerald-400/40 dark:bg-emerald-400/12 dark:text-emerald-200'
                            : 'border-[var(--pq-border)] bg-white/60 text-slate-400 dark:bg-white/5 dark:text-[var(--pq-text-faint)]',
                        ].join(' ')}
                      >
                        <Database className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaperToolOpen((open) => !open)}
                        title={l('选择文献范围', 'Select paper scope')}
                        aria-label={l('选择文献范围', 'Select paper scope')}
                        className={[
                          'pq-icon-button h-10 shrink-0 gap-2 border px-3 text-xs font-semibold',
                          selectedPaperIds.size > 0 || paperToolOpen
                            ? 'border-[var(--pq-accent)] bg-[var(--pq-accent-soft)] text-[var(--pq-accent)]'
                            : 'border-[var(--pq-border)] bg-white/60',
                        ].join(' ')}
                      >
                        <BookOpen className="h-4 w-4" strokeWidth={1.8} />
                        {selectedPaperIds.size > 0
                          ? l(`${selectedPaperIds.size} 篇`, `${selectedPaperIds.size} papers`)
                          : l('选择文献', 'Select Papers')}
                      </button>
                      <ModelPresetPicker
                        l={l}
                        presets={agentModelPresets}
                        selectedPresetId={selectedAgentPresetId}
                        onChange={onAgentPresetChange}
                        title={l('选择 Agent 模型', 'Choose Agent model')}
                      />
                      <AgentReasoningPicker
                        l={l}
                        value={selectedAgentReasoningEffort}
                        onChange={onAgentReasoningEffortChange}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={activeSessionRunning || !composerValue.trim()}
                      className="pq-button-primary h-11 shrink-0 px-5 text-sm disabled:opacity-50"
                    >
                      {activeSessionRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                      ) : (
                        <Send className="h-4 w-4" strokeWidth={2} />
                      )}
                      {l('发送', 'Send')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
