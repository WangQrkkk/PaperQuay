import { useMemo, useState } from 'react';
import {
  Bot,
  Camera,
  BookOpen,
  ChevronDown,
  Check,
  Clipboard,
  ImagePlus,
  Loader2,
  Paperclip,
  PlayCircle,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import type { LibraryAgentPlan } from '../../services/libraryAgent';
import type { LiteraturePaper } from '../../types/library';
import type { UiLanguage } from '../../types/reader';
import type { AgentChatMessage, AgentToolCallView } from './AgentWorkspace.types';
import AgentMarkdown from './AgentMarkdown';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import { formatFileSize } from '../../utils/files';

const agentPlanPrimaryActionClass =
  'inline-flex items-center gap-2 rounded-2xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:border-emerald-700 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700 disabled:shadow-none dark:border-emerald-400 dark:bg-emerald-400 dark:text-slate-950 dark:hover:border-emerald-300 dark:hover:bg-emerald-300 dark:disabled:border-emerald-400/20 dark:disabled:bg-emerald-400/10 dark:disabled:text-emerald-200/70';
const agentPlanSecondaryActionClass =
  'inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none dark:border-white/14 dark:bg-chrome-900 dark:text-chrome-100 dark:hover:border-white/24 dark:hover:bg-chrome-800 dark:disabled:border-white/10 dark:disabled:bg-white/8 dark:disabled:text-chrome-500';

function PaperSelectionRequestCard({
  activeSessionRunning,
  formatPaperMeta,
  l,
  loading,
  locale,
  message,
  onContinueWithSelectedPapers,
  papers,
}: {
  activeSessionRunning: boolean;
  formatPaperMeta: (paper: LiteraturePaper, locale: UiLanguage) => string;
  l: (zh: string, en: string) => string;
  loading: boolean;
  locale: UiLanguage;
  message: AgentChatMessage;
  onContinueWithSelectedPapers: (instruction: string, paperIds: string[]) => void;
  papers: LiteraturePaper[];
}) {
  const request = message.paperSelectionRequest;
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [localSelectedPaperIds, setLocalSelectedPaperIds] = useState<Set<string>>(() => new Set());
  const visiblePapers = useMemo(() => {
    const normalizedQuery = localSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return papers;
    }

    return papers.filter((paper) =>
      [
        paper.title,
        paper.year,
        paper.publication,
        paper.doi,
        paper.url,
        paper.abstractText,
        paper.authors.map((author) => author.name).join(' '),
        paper.keywords.join(' '),
        paper.tags.map((tag) => tag.name).join(' '),
      ]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [localSearchQuery, papers]);

  if (!request) {
    return null;
  }

  const toggleLocalPaper = (paperId: string) => {
    setLocalSelectedPaperIds((current) => {
      const next = new Set(current);

      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }

      return next;
    });
  };

  return (
    <div className="mt-4 overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--pq-border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pq-text)]">
            <BookOpen className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />
            {l('选择要提供给模型的论文', 'Choose papers for the model')}
            <span className="rounded-full bg-[var(--pq-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--pq-accent)]">
              {request.mode === 'pdf-text' ? 'PDF text' : 'Summary'}
            </span>
          </div>
          <div className="mt-1 max-w-2xl text-xs leading-5 text-[var(--pq-text-muted)]">
            {request.reason}
          </div>
        </div>
        <div className="text-xs font-semibold text-[var(--pq-text-faint)]">
          {localSelectedPaperIds.size}/{papers.length}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="pq-input flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2 text-sm text-[var(--pq-text-muted)]">
            <Search className="h-4 w-4 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={2} />
            <input
              value={localSearchQuery}
              onChange={(event) => setLocalSearchQuery(event.target.value)}
              placeholder={l('搜索标题、作者、年份、标签...', 'Search title, author, year, tags...')}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
            />
          </label>
          <button
            type="button"
            onClick={() => setLocalSelectedPaperIds(new Set(visiblePapers.map((paper) => paper.id)))}
            disabled={activeSessionRunning || visiblePapers.length === 0}
            className="pq-button px-3 py-2 text-xs disabled:opacity-50"
          >
            {l('选择当前结果', 'Select Results')}
          </button>
          <button
            type="button"
            onClick={() => setLocalSelectedPaperIds(new Set())}
            disabled={activeSessionRunning || localSelectedPaperIds.size === 0}
            className="pq-button px-3 py-2 text-xs disabled:opacity-50"
          >
            {l('清空', 'Clear')}
          </button>
        </div>

        <div
          data-wheel-scroll-target
          className="max-h-72 overflow-y-auto overscroll-y-contain rounded-[var(--pq-radius-md)] border border-[var(--pq-border-subtle)] bg-[var(--pq-surface)]"
        >
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--pq-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
              {l('正在加载文库...', 'Loading library...')}
            </div>
          ) : papers.length === 0 ? (
            <div className="p-4 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l('当前文库为空。先导入 PDF 后，再把论文提供给 Agent。', 'The library is empty. Import PDFs before providing papers to the Agent.')}
            </div>
          ) : visiblePapers.length === 0 ? (
            <div className="p-4 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l('没有匹配的论文。换一个关键词再试。', 'No matching papers. Try another keyword.')}
            </div>
          ) : (
            <div className="divide-y divide-[var(--pq-border-subtle)]">
              {visiblePapers.map((paper) => {
                const selected = localSelectedPaperIds.has(paper.id);

                return (
                  <button
                    key={paper.id}
                    type="button"
                    onClick={() => toggleLocalPaper(paper.id)}
                    disabled={activeSessionRunning}
                    className={[
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition disabled:opacity-60',
                      selected ? 'bg-[var(--pq-accent-soft)]' : 'hover:bg-[var(--pq-surface-2)]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                        selected
                          ? 'border-[var(--pq-accent)] bg-[var(--pq-accent)] text-white'
                          : 'border-[var(--pq-border-strong)] bg-[var(--pq-surface)] text-transparent',
                      ].join(' ')}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--pq-text)]">
                        {paper.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--pq-text-muted)]">
                        {formatPaperMeta(paper, locale) || l('暂无元数据', 'No metadata')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--pq-text-faint)]">
            {l('选中后会继续同一条任务，不会立即修改本地文库。', 'After selection, the same task continues. Local library writes still require approval.')}
          </div>
          <button
            type="button"
            onClick={() => onContinueWithSelectedPapers(request.instruction, [...localSelectedPaperIds])}
            disabled={activeSessionRunning || localSelectedPaperIds.size === 0}
            className="pq-button-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            <PlayCircle className="h-4 w-4" />
            {l('继续', 'Continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantThinkingBlock({
  l,
  thinking,
}: {
  l: (zh: string, en: string) => string;
  thinking: string;
}) {
  if (!thinking.trim()) {
    return null;
  }

  return (
    <details open className="group mt-3 rounded-2xl border border-[var(--pq-border-subtle)] bg-[var(--pq-surface-1)] px-3 py-2">
      <summary className="flex select-none items-center gap-1.5 text-xs font-medium text-[var(--pq-text-muted)] outline-none">
        <span>{l('思考过程', 'Reasoning')}</span>
        <ChevronDown
          className="h-3.5 w-3.5 text-[var(--pq-text-faint)] transition-transform group-open:rotate-180"
          strokeWidth={2}
        />
      </summary>
      <div className="mt-2 border-l border-[var(--pq-border)] pl-3 text-[13px] leading-6 text-[var(--pq-text-muted)]">
        <div className="whitespace-pre-wrap">{thinking}</div>
      </div>
    </details>
  );
}

export function UserMessageCard({ message }: { message: AgentChatMessage }) {
  return (
    <article className="flex items-start justify-end gap-3">
      <div className="max-w-[72%] rounded-[24px] border border-teal-300 bg-teal-600 px-4 py-3 text-sm leading-7 text-white shadow-[0_18px_40px_rgba(20,184,166,0.18)] dark:border-teal-300/30 dark:bg-teal-300 dark:text-slate-950">
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => {
              const AttachmentIcon =
                attachment.kind === 'image'
                  ? ImagePlus
                  : attachment.kind === 'screenshot'
                    ? Camera
                    : Paperclip;

              return (
                <span
                  key={attachment.id}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-teal-50 dark:border-slate-900/10 dark:bg-slate-950/10 dark:text-slate-800"
                >
                  <AttachmentIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span className="max-w-[180px] truncate">{attachment.name}</span>
                  <span className="text-teal-50/80 dark:text-slate-700">{formatFileSize(attachment.size)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
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

export function AssistantMessageCard({
  activeSessionRunning,
  approvedItemIds,
  applyingPlan,
  composerValue,
  expandedStepKeys,
  expandedToolIds,
  formatPaperMeta,
  handleAgentChoice,
  handleModifyPreviousParameters,
  handleRetryAgent,
  isActivePlan,
  l,
  lastInstruction,
  loading,
  locale,
  localizedToolLabel,
  message,
  onApplyPlan,
  onCancelPlan,
  onCopyToolParameters,
  onContinueWithSelectedPapers,
  onInspectPlanItem,
  onTogglePlanItem,
  onToggleStep,
  onToggleTool,
  papers,
  setStatusMessage,
}: {
  activeSessionRunning: boolean;
  approvedItemIds: Set<string>;
  applyingPlan: boolean;
  composerValue: string;
  expandedStepKeys: Set<string>;
  expandedToolIds: Set<string>;
  formatPaperMeta: (paper: LiteraturePaper, locale: UiLanguage) => string;
  handleAgentChoice: (instruction: string, paperScopeIds?: string[]) => void;
  handleModifyPreviousParameters: () => void;
  handleRetryAgent: (instruction: string) => void;
  isActivePlan: boolean;
  l: (zh: string, en: string) => string;
  lastInstruction: string;
  loading: boolean;
  locale: UiLanguage;
  localizedToolLabel: (tool: LibraryAgentPlan['tool']) => string;
  message: AgentChatMessage;
  onApplyPlan: () => void;
  onCancelPlan: () => void;
  onCopyToolParameters: (toolCall: AgentToolCallView) => void;
  onContinueWithSelectedPapers: (instruction: string, paperIds: string[]) => void;
  onInspectPlanItem: (itemId: string, paperTitle: string) => void;
  onTogglePlanItem: (itemId: string) => void;
  onToggleStep: (stepKey: string) => void;
  onToggleTool: (toolCallId: string) => void;
  papers: LiteraturePaper[];
  setStatusMessage: (message: string) => void;
}) {
  const messagePlan = message.plan;
  const toolCall = message.toolCall;

  return (
    <article className="flex items-start gap-3">
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
            {message.thinking ? (
              <AssistantThinkingBlock l={l} thinking={message.thinking} />
            ) : null}
            <div className="mt-3">
              <AgentMarkdown content={message.content} />
            </div>
            {message.choices && message.choices.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {message.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => handleAgentChoice(choice.instruction, message.paperScopeIds)}
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
                {messagePlan.tool}
              </div>
            </div>
          ) : null}
        </div>

        {message.paperSelectionRequest ? (
          <PaperSelectionRequestCard
            activeSessionRunning={activeSessionRunning}
            formatPaperMeta={formatPaperMeta}
            l={l}
            loading={loading}
            locale={locale}
            message={message}
            onContinueWithSelectedPapers={onContinueWithSelectedPapers}
            papers={papers}
          />
        ) : null}

        {message.trace ? (
          <div className="mt-5">
            <TraceTimeline
              steps={message.trace}
              traceKey={message.id}
              expandedStepKeys={expandedStepKeys}
              onToggleStep={onToggleStep}
            />
          </div>
        ) : null}

        {toolCall ? (
          <div className="mt-4">
            <ToolCallCard
              toolCall={toolCall}
              expanded={expandedToolIds.has(toolCall.id)}
              onToggle={() => onToggleTool(toolCall.id)}
              onCopyParameters={() => onCopyToolParameters(toolCall)}
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
                      onTogglePlanItem(item.id);
                    } else {
                      setStatusMessage(
                        l(
                          '这是历史计划，只能查看，不能修改审批状态。',
                          'This is a historical plan. You can view it, but cannot change its approval state.',
                        ),
                      );
                    }
                  }}
                  onInspect={() => onInspectPlanItem(item.id, item.paperTitle)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {messagePlan ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApplyPlan}
              disabled={applyingPlan || activeSessionRunning || !isActivePlan || approvedItemIds.size === 0}
              className={agentPlanPrimaryActionClass}
            >
              <PlayCircle className="h-4 w-4" />
              {isActivePlan ? l('确认执行', 'Confirm Execution') : l('历史计划', 'Historical Plan')}
            </button>
            <button
              type="button"
              onClick={handleModifyPreviousParameters}
              className={agentPlanSecondaryActionClass}
            >
              <Clipboard className="h-4 w-4" />
              {l('修改参数', 'Modify Parameters')}
            </button>
            <button
              type="button"
              onClick={onCancelPlan}
              disabled={applyingPlan || activeSessionRunning || !isActivePlan}
              className={agentPlanSecondaryActionClass}
            >
              <X className="h-4 w-4" />
              {l('取消', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={() => handleRetryAgent(lastInstruction)}
              disabled={!lastInstruction || applyingPlan || activeSessionRunning}
              className={agentPlanSecondaryActionClass}
            >
              <RotateCcw className="h-4 w-4" />
              {l('重新生成', 'Regenerate')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
