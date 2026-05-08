import {
  Bot,
  Camera,
  Clipboard,
  FileText,
  ImagePlus,
  Paperclip,
  PlayCircle,
  RotateCcw,
  User,
  X,
} from 'lucide-react';
import type { LibraryAgentPlan } from '../../services/libraryAgent';
import type { AgentChatMessage, AgentToolCallView } from './AgentWorkspace.types';
import AgentMarkdown from './AgentMarkdown';
import { PlanDiffCard, ToolCallCard, TraceTimeline } from './AgentExecutionCards';
import { formatFileSize } from '../../utils/files';

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
  handleAgentChoice,
  handleModifyPreviousParameters,
  handlePreviewOnly,
  handleRetryAgent,
  isActivePlan,
  l,
  lastInstruction,
  localizedToolLabel,
  message,
  onApplyPlan,
  onCancelPlan,
  onCopyToolParameters,
  onInspectPlanItem,
  onTogglePlanItem,
  onToggleStep,
  onToggleTool,
  setStatusMessage,
}: {
  activeSessionRunning: boolean;
  approvedItemIds: Set<string>;
  applyingPlan: boolean;
  composerValue: string;
  expandedStepKeys: Set<string>;
  expandedToolIds: Set<string>;
  handleAgentChoice: (instruction: string) => void;
  handleModifyPreviousParameters: () => void;
  handlePreviewOnly: () => void;
  handleRetryAgent: (instruction: string) => void;
  isActivePlan: boolean;
  l: (zh: string, en: string) => string;
  lastInstruction: string;
  localizedToolLabel: (tool: LibraryAgentPlan['tool']) => string;
  message: AgentChatMessage;
  onApplyPlan: () => void;
  onCancelPlan: () => void;
  onCopyToolParameters: (toolCall: AgentToolCallView) => void;
  onInspectPlanItem: (itemId: string, paperTitle: string) => void;
  onTogglePlanItem: (itemId: string) => void;
  onToggleStep: (stepKey: string) => void;
  onToggleTool: (toolCallId: string) => void;
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
                {messagePlan.tool}
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
              onClick={onCancelPlan}
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
}
