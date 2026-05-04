import type { FormEvent, Ref, WheelEventHandler } from 'react';
import {
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  Database,
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
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Tags,
  X,
} from 'lucide-react';
import type { LibraryAgentPlan } from '../../services/libraryAgent';
import type { LiteraturePaper } from '../../types/library';
import type { UiLanguage } from '../../types/reader';
import { toolFunctionName } from './AgentWorkspace.model';
import type {
  AgentCapability,
  AgentChatMessage,
  AgentHistorySession,
  AgentToolCallView,
} from './AgentWorkspace.types';
import { PlanDiffCard } from './AgentExecutionCards';
import { AssistantMessageCard, UserMessageCard } from './AgentWorkspaceMessages';

type ThemeMode = 'light' | 'dark' | 'system';

interface AgentWorkspaceViewProps {
  activeSessionId: string;
  activeSessionRunning: boolean;
  agentCapabilities: AgentCapability[];
  agentPresetName: string;
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
  handleAgentChoice: (instruction: string) => void;
  handleClearAgentHistory: () => void;
  handleConversationWheelCapture: WheelEventHandler<HTMLElement>;
  handleDeleteHistorySession: (sessionId: string) => void;
  handleHistoryWheelCapture: WheelEventHandler<HTMLElement>;
  handleModifyPreviousParameters: () => void;
  handleNewAgentSession: () => void;
  handleOpenHistorySession: (session: AgentHistorySession) => void;
  handleOpenPreferences: () => void;
  handleInspectorWheelCapture: WheelEventHandler<HTMLElement>;
  handlePaperWheelCapture: WheelEventHandler<HTMLElement>;
  handlePreviewOnly: () => void;
  handleRetryAgent: (instruction: string) => void;
  handleToggleThemeMode: () => void;
  handleWindowClose: () => void;
  handleWindowMinimize: () => void;
  handleWindowToggleMaximize: () => void;
  historySidebarCollapsed: boolean;
  historySidebarRef: Ref<HTMLElement>;
  inspectorSidebarRef: Ref<HTMLElement>;
  l: (zh: string, en: string) => string;
  lastInstruction: string;
  loading: boolean;
  locale: UiLanguage;
  localizedCapabilityTitles: Record<string, string>;
  localizedToolLabel: (tool: LibraryAgentPlan['tool']) => string;
  messages: AgentChatMessage[];
  onApplyPlan: () => void;
  onCancelPlan: () => void;
  onClearSelection: () => void;
  onComposerChange: (value: string) => void;
  onCopyToolParameters: (toolCall: AgentToolCallView) => void;
  onHistorySidebarCollapsedChange: (collapsed: boolean) => void;
  onInspectPlanItem: (itemId: string, paperTitle: string) => void;
  onPaperSearchQueryChange: (value: string) => void;
  onRefreshPapers: () => void;
  onSelectAllVisible: () => void;
  onSubmitPrompt: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePaper: (paperId: string) => void;
  onTogglePlanItem: (itemId: string) => void;
  onToggleStep: (stepKey: string) => void;
  onToggleTool: (toolCallId: string) => void;
  paperSearchQuery: string;
  paperSidebarRef: Ref<HTMLElement>;
  papers: LiteraturePaper[];
  plan: LibraryAgentPlan | null;
  promptSuggestions: string[];
  selectedInspectorItem: LibraryAgentPlan['items'][number] | null;
  selectedPaperIds: Set<string>;
  selectedPapers: LiteraturePaper[];
  selectedPlanItems: LibraryAgentPlan['items'];
  selectedTags: string[];
  setStatusMessage: (message: string) => void;
  sortedHistorySessions: AgentHistorySession[];
  statusMessage: string;
  submitPromptFromEnter: () => void;
  themeMode: ThemeMode;
}

export default function AgentWorkspaceView({
  activeSessionId,
  activeSessionRunning,
  agentCapabilities,
  agentPresetName,
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
  handleOpenPreferences,
  handleInspectorWheelCapture,
  handlePaperWheelCapture,
  handlePreviewOnly,
  handleRetryAgent,
  handleToggleThemeMode,
  handleWindowClose,
  handleWindowMinimize,
  handleWindowToggleMaximize,
  historySidebarCollapsed,
  historySidebarRef,
  inspectorSidebarRef,
  l,
  lastInstruction,
  loading,
  locale,
  localizedCapabilityTitles,
  localizedToolLabel,
  messages,
  onApplyPlan,
  onCancelPlan,
  onClearSelection,
  onComposerChange,
  onCopyToolParameters,
  onHistorySidebarCollapsedChange,
  onInspectPlanItem,
  onPaperSearchQueryChange,
  onRefreshPapers,
  onSelectAllVisible,
  onSubmitPrompt,
  onTogglePaper,
  onTogglePlanItem,
  onToggleStep,
  onToggleTool,
  paperSearchQuery,
  paperSidebarRef,
  papers,
  plan,
  promptSuggestions,
  selectedInspectorItem,
  selectedPaperIds,
  selectedPapers,
  selectedPlanItems,
  selectedTags,
  setStatusMessage,
  sortedHistorySessions,
  statusMessage,
  submitPromptFromEnter,
  themeMode,
}: AgentWorkspaceViewProps) {
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
              {agentPresetName
                ? `Agent · ${agentPresetName}`
                : l('Agent · 使用设置中的 Agent 模型', 'Agent · Using the model configured in Settings')}
            </div>
            <button
              type="button"
              onClick={onRefreshPapers}
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
            gridTemplateRows: 'minmax(0, 1fr)',
          }}
        >
          <aside
            ref={historySidebarRef}
            onWheelCapture={handleHistoryWheelCapture}
            className="min-h-0 border-r border-slate-200/80 bg-white/64 backdrop-blur-xl dark:border-white/10 dark:bg-[#101720]/86"
          >
            {historySidebarCollapsed ? (
              <div className="flex h-full min-h-0 flex-col items-center gap-3 px-2 py-4">
                <button
                  type="button"
                  onClick={() => onHistorySidebarCollapsedChange(false)}
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
                        {l(
                          `${sortedHistorySessions.length} 个 Agent 对话`,
                          `${sortedHistorySessions.length} Agent chats`,
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onHistorySidebarCollapsedChange(true)}
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

                <div
                  data-wheel-scroll-target
                  className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3"
                >
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

          <aside
            ref={paperSidebarRef}
            onWheelCapture={handlePaperWheelCapture}
            className="min-h-0 border-r border-slate-200/80 bg-white/70 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/74"
          >
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
                      onClick={onSelectAllVisible}
                      disabled={filteredPapers.length === 0}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300"
                    >
                      {l('选择结果', 'Select Results')}
                    </button>
                    <button
                      type="button"
                      onClick={onClearSelection}
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
                    onChange={(event) => onPaperSearchQueryChange(event.target.value)}
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

              <div
                data-wheel-scroll-target
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3"
              >
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
                    {l('正在加载文库...', 'Loading library...')}
                  </div>
                ) : papers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/70 dark:text-chrome-400">
                    {l(
                      '当前文库为空。先在文库工作区导入 PDF，再回到 Agent 页面批处理。',
                      'The library is empty. Import PDFs in the Library workspace first, then return to Agent for batch operations.',
                    )}
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
                          onClick={() => onTogglePaper(paper.id)}
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

          <section
            ref={conversationPanelRef}
            onWheelCapture={handleConversationWheelCapture}
            className="flex min-h-0 flex-col"
          >
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

            <div
              ref={chatScrollRef}
              data-wheel-scroll-target
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-5"
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
                      handleAgentChoice={handleAgentChoice}
                      handleModifyPreviousParameters={handleModifyPreviousParameters}
                      handlePreviewOnly={handlePreviewOnly}
                      handleRetryAgent={handleRetryAgent}
                      isActivePlan={Boolean(message.plan && plan?.id === message.plan.id)}
                      l={l}
                      lastInstruction={lastInstruction}
                      localizedToolLabel={localizedToolLabel}
                      message={message}
                      onApplyPlan={onApplyPlan}
                      onCancelPlan={onCancelPlan}
                      onCopyToolParameters={onCopyToolParameters}
                      onInspectPlanItem={onInspectPlanItem}
                      onTogglePlanItem={onTogglePlanItem}
                      onToggleStep={onToggleStep}
                      onToggleTool={onToggleTool}
                      setStatusMessage={setStatusMessage}
                    />
                  ),
                )}
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
                        onComposerChange(suggestion);
                        setStatusMessage(
                          l(
                            '已填入示例指令，可直接发送或继续编辑。',
                            'Example instruction inserted. Send it directly or keep editing.',
                          ),
                        );
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

                <form onSubmit={onSubmitPrompt} className="flex items-end gap-3">
                  <textarea
                    value={composerValue}
                    onChange={(event) => onComposerChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submitPromptFromEnter();
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
                    {activeSessionRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : (
                      <Send className="h-4 w-4" strokeWidth={2} />
                    )}
                    {l('发送', 'Send')}
                  </button>
                </form>
              </div>
            </div>
          </section>

          <aside
            ref={inspectorSidebarRef}
            onWheelCapture={handleInspectorWheelCapture}
            className="min-h-0 border-l border-slate-200/80 bg-white/72 backdrop-blur-xl dark:border-white/10 dark:bg-[#121922]/74"
          >
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
                        ? l(
                          `${approvedItemIds.size} / ${plan.items.length} 项待执行`,
                          `${approvedItemIds.size} / ${plan.items.length} items pending`,
                        )
                        : l('等待 Agent 计划', 'Waiting for Agent plan')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onApplyPlan}
                    disabled={!plan || approvedItemIds.size === 0 || applyingPlan || activeSessionRunning}
                    className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-teal-500 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                  >
                    {applyingPlan ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {l('执行', 'Run')}
                  </button>
                </div>
              </div>

              <div
                data-wheel-scroll-target
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4"
              >
                <div className="space-y-4">
                  <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-chrome-950/58">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                      <Database className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                      {l('当前上下文', 'Current Context')}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedPapers.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          {l('论文', 'Papers')}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">{selectedTags.length}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          {l('标签', 'Tags')}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-white/10 dark:bg-chrome-900">
                        <div className="text-lg font-black">
                          {new Set(selectedPapers.flatMap((paper) => paper.categoryIds)).size}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          {l('分类', 'Collections')}
                        </div>
                      </div>
                    </div>
                  </section>

                  {!plan ? (
                    <section className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-500 dark:border-white/10 dark:bg-chrome-900/60 dark:text-chrome-400">
                      {l(
                        '发送对话后，Agent 会在这里展示工具、参数、返回结果、diff 和审批按钮。',
                        'After you send a message, the Agent will show tools, parameters, results, diffs, and approval controls here.',
                      )}
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
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Tool
                          </div>
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
                          <span className="text-xs font-bold text-slate-400">
                            {selectedPlanItems.length} selected
                          </span>
                        </div>
                        {plan.items.map((item) => (
                          <PlanDiffCard
                            key={item.id}
                            item={item}
                            approved={approvedItemIds.has(item.id)}
                            onToggle={() => onTogglePlanItem(item.id)}
                            onInspect={() => onInspectPlanItem(item.id, item.paperTitle)}
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
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Paper
                          </div>
                          <div className="mt-1 text-xs font-bold leading-5 text-slate-700 dark:text-chrome-200">
                            {selectedInspectorItem.paperTitle}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Action
                          </div>
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
                    {l(
                      `将应用 ${selectedPlanItems.length} 个已勾选计划项。`,
                      `${selectedPlanItems.length} checked plan items will be applied.`,
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={onApplyPlan}
                      disabled={selectedPlanItems.length === 0 || applyingPlan || activeSessionRunning}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-teal-300 dark:text-slate-950 dark:hover:bg-teal-200"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {l('确认执行', 'Confirm Execution')}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelPlan}
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
