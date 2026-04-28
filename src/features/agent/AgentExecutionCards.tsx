import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import type { LibraryAgentPlanItem } from '../../services/libraryAgent';
import { capabilityForTool, durationLabel, toolLabel } from './AgentWorkspace.model';
import type { AgentStepStatus, AgentToolCallView, AgentTraceStep } from './AgentWorkspace.types';
import { useAppLocale, useLocaleText } from '../../i18n/uiLanguage';

function statusTone(status: AgentStepStatus): string {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-200';
    case 'running':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-200';
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400';
  }
}

function statusLabel(status: AgentStepStatus): string {
  switch (status) {
    case 'success':
      return 'success';
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    default:
      return 'waiting';
  }
}

function StepStatusIcon({ status }: { status: AgentStepStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />;
  }

  if (status === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />;
  }

  if (status === 'error') {
    return <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />;
  }

  return <Circle className="h-3.5 w-3.5" strokeWidth={2.2} />;
}

export function PlanDiffCard({
  item,
  approved,
  onToggle,
  onInspect,
}: {
  item: LibraryAgentPlanItem;
  approved: boolean;
  onToggle: () => void;
  onInspect: () => void;
}) {
  const l = useLocaleText();

  return (
    <article
      className={[
        'group rounded-[22px] border p-3.5 transition',
        approved
          ? 'border-teal-200 bg-teal-50/70 shadow-[0_14px_35px_rgba(20,184,166,0.10)] dark:border-teal-300/20 dark:bg-teal-300/10'
          : 'border-slate-200 bg-white/74 opacity-75 dark:border-white/10 dark:bg-chrome-900/62',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={[
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
            approved
              ? 'border-teal-500 bg-teal-500 text-white'
              : 'border-slate-300 bg-white text-transparent dark:border-white/20 dark:bg-chrome-950',
          ].join(' ')}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-bold text-slate-950 dark:text-white">
            {item.paperTitle}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-400">
            {item.description}
          </div>

          {item.before || item.after ? (
            <div className="mt-3 grid gap-2 text-xs leading-5">
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-chrome-950">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Before
                </div>
                <div className="line-clamp-3 text-slate-600 dark:text-chrome-300">
                  {item.before || l('空', 'Empty')}
                </div>
              </div>
              <div className="flex justify-center text-teal-600 dark:text-teal-300">
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="rounded-2xl border border-teal-200 bg-white px-3 py-2 dark:border-teal-300/20 dark:bg-chrome-950">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-300">
                  After
                </div>
                <div className="line-clamp-3 text-slate-900 dark:text-chrome-100">
                  {item.after || l('空', 'Empty')}
                </div>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onInspect}
            className="mt-3 text-xs font-bold text-teal-700 opacity-80 transition hover:opacity-100 dark:text-teal-200"
          >
            {l('查看详情', 'View Details')}
          </button>
        </div>
      </div>
    </article>
  );
}

export function TraceTimeline({
  steps,
  traceKey,
  expandedStepKeys,
  onToggleStep,
}: {
  steps: AgentTraceStep[];
  traceKey: string;
  expandedStepKeys: Set<string>;
  onToggleStep: (stepKey: string) => void;
}) {
  const l = useLocaleText();
  const locale = useAppLocale();

  return (
    <div className="rounded-[26px] border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-chrome-950/54">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950 dark:text-white">{l('执行轨迹', 'Execution Trace')}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-chrome-400">
            {l('意图 · 计划 · 工具调用 · 结果 · 最终回答', 'Intent · Plan · Tool call · Result · Final')}
          </div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-400">
          {steps.filter((step) => step.status === 'success').length}/{steps.length} {l('已完成', 'completed')}
        </div>
      </div>

      <div className="space-y-0">
        {steps.map((step, index) => {
          const stepKey = `${traceKey}:${step.id}`;
          const expanded = expandedStepKeys.has(stepKey);
          const isLast = index === steps.length - 1;

          return (
            <div key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {!isLast ? (
                <div className="absolute left-[15px] top-8 h-[calc(100%-18px)] w-px bg-slate-200 dark:bg-white/10" />
              ) : null}
              <div className={['relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', statusTone(step.status)].join(' ')}>
                <StepStatusIcon status={step.status} />
              </div>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onToggleStep(stepKey)}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl px-1 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-950 dark:text-white">
                        {step.title}
                      </span>
                      <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]', statusTone(step.status)].join(' ')}>
                        {statusLabel(step.status)}
                      </span>
                      {step.durationMs ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-chrome-500">
                          <Clock3 className="h-3 w-3" />
                          {durationLabel(step.durationMs, locale)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-chrome-400">
                      {step.summary}
                    </span>
                  </span>
                  <span className="mt-1 text-slate-400 dark:text-chrome-500">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>

                {expanded && step.detail ? (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-300">
                    {step.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToolCallCard({
  toolCall,
  expanded,
  onToggle,
  onCopyParameters,
  onRetry,
}: {
  toolCall: AgentToolCallView;
  expanded: boolean;
  onToggle: () => void;
  onCopyParameters: () => void;
  onRetry: () => void;
}) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const capability = capabilityForTool(toolCall.tool);
  const Icon = capability.icon;

  return (
    <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-chrome-900/78 dark:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-teal-300 dark:text-slate-950">
            <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-black text-slate-950 dark:text-white">
                {l('工具调用', 'Tool Call')} · {toolLabel(toolCall.tool, locale)}
              </div>
              <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]', statusTone(toolCall.status)].join(' ')}>
                {statusLabel(toolCall.status)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-400 dark:text-chrome-500">
              {toolCall.functionName}
            </div>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400">
          {durationLabel(toolCall.durationMs, locale)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-chrome-950/70">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {l('参数摘要', 'Parameter Summary')}
          </div>
          <div className="text-xs leading-5 text-slate-600 dark:text-chrome-300">
            {toolCall.parameterSummary}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-chrome-950/70">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {l('返回摘要', 'Result Summary')}
          </div>
          <div className="text-xs leading-5 text-slate-600 dark:text-chrome-300">
            {toolCall.resultSummary}
          </div>
        </div>
      </div>

      {expanded ? (
        <pre className="mt-3 max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100 dark:border-white/10">
          {JSON.stringify(toolCall.rawParameters, null, 2)}
        </pre>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-300"
        >
          <Braces className="h-3.5 w-3.5" />
          {expanded ? l('收起详情', 'Collapse Details') : l('查看详情', 'View Details')}
        </button>
        <button
          type="button"
          onClick={onCopyParameters}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-300"
        >
          <Copy className="h-3.5 w-3.5" />
          {l('复制参数', 'Copy Parameters')}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-300"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {l('重试工具', 'Retry Tool')}
        </button>
      </div>
    </section>
  );
}
