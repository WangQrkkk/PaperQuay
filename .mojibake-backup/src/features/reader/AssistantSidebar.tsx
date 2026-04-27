import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Bot,
  BookOpenText,
  Camera,
  ExternalLink,
  FileJson,
  FileText,
  ImagePlus,
  Info,
  Languages,
  MessageSquare,
  MessageSquareText,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Quote,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperAnnotation,
  PaperSummary,
  QaModelPreset,
  SelectedExcerpt,
  ZoteroRelatedNote,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { formatFileSize } from '../../utils/files';
import { normalizeMarkdownMath } from '../../utils/markdown';

function SectionCard({
  title,
  description,
  icon,
  children,
  actions,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-[24px] border border-white/70 bg-white/82 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                {icon}
              </span>
            ) : null}
            <div>
              <div className="text-sm font-semibold text-slate-900">{title}</div>
              {description ? (
                <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
              ) : null}
            </div>
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={cn('px-5 py-4', contentClassName)}>{children}</div>
    </section>
  );
}

function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone === 'neutral' && 'border-slate-200 bg-slate-50 text-slate-600',
        tone === 'accent' && 'border-indigo-200 bg-indigo-50 text-indigo-600',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-600',
      )}
    >
      {children}
    </span>
  );
}

function HintPanel({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-4 text-sm leading-7 text-slate-500',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-slate-600">{icon}</div>
      {children}
    </div>
  );
}

function MarkdownPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <ReactMarkdown
      className={cn(
        'prose prose-sm max-w-none text-slate-700 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-indigo-700 prose-li:my-1 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2',
        className,
      )}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
    >
      {normalizeMarkdownMath(content)}
    </ReactMarkdown>
  );
}

type SummaryTabKey =
  | 'overview'
  | 'background'
  | 'problem'
  | 'approach'
  | 'experiment'
  | 'findings'
  | 'conclusion'
  | 'limitations';

function SummaryPanel({
  paperSummary,
  loading,
  error,
  hasBlocks,
  aiConfigured,
  compact = false,
  onGenerateSummary,
}: {
  paperSummary: PaperSummary | null;
  loading: boolean;
  error: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  compact?: boolean;
  onGenerateSummary: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SummaryTabKey>('overview');

  const sections = useMemo(
    () =>
      paperSummary
        ? [
            { key: 'overview' as const, label: '总览', content: paperSummary.overview },
            { key: 'background' as const, label: '背景', content: paperSummary.background },
            { key: 'problem' as const, label: '问题', content: paperSummary.researchProblem },
            { key: 'approach' as const, label: '方法', content: paperSummary.approach },
            { key: 'experiment' as const, label: '实验', content: paperSummary.experimentSetup },
            {
              key: 'findings' as const,
              label: '发现',
              content: paperSummary.keyFindings.join('\n'),
            },
            { key: 'conclusion' as const, label: '结论', content: paperSummary.conclusions },
            { key: 'limitations' as const, label: '鐏炩偓闂?, content: paperSummary.limitations },
          ]
        : [],
    [paperSummary],
  );
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];

  return (
    <SectionCard
      title={compact ? '论文概览' : 'AI ??'}
      description="鍩轰簬缁撴瀯鍖栧潡鐢熸垚鐨勫鏈憳瑕?
      icon={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}
      actions={
        <button
          type="button"
          onClick={onGenerateSummary}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? '鐢熸垚涓? : paperSummary ? '重新生成' : '生成摘要'}
        </button>
      }
      contentClassName="space-y-4"
    >
      {!paperSummary && !hasBlocks ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          鍏堝姞杞?MinerU JSON 閹存牕鐣幋鎰掗弸鎰剁礉鏉╂瑩鍣烽幍宥勭窗閻㈢喐鍨氱紒鎾寸€崠鏍ㄦ喅鐟曚降鈧?        </HintPanel>
      ) : null}

      {!paperSummary && hasBlocks && !aiConfigured ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          闁板秶鐤嗘總钘夊悑鐎?`v1/chat/completions` 閻ㄥ嫭膩閸ㄥ鎮楅敍宀冪箹闁插奔绱伴悽鐔稿灇鐠佺儤鏋冨鍌濐潔閵?        </HintPanel>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : null}

      {!loading && paperSummary ? (
        <div className="space-y-4">
          <div className="rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.86))] px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="accent">摘要就绪</StatusBadge>
              <StatusBadge>{paperSummary.keywords.length} 个关键词</StatusBadge>
              <StatusBadge>{paperSummary.keyFindings.length} 閺夆剝鐗宠箛鍐ㄥ絺閻?/StatusBadge>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-slate-950">{paperSummary.title}</h3>
            <ReactMarkdown
              className="prose prose-sm mt-3 max-w-none text-slate-600 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
            >
              {normalizeMarkdownMath(paperSummary.abstract)}
            </ReactMarkdown>
          </div>

          <div className="flex flex-wrap gap-2">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveTab(section.key)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition',
                  activeTab === section.key
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                {section.label}
              </button>
            ))}
          </div>

          {activeSection ? (
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-5 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {activeSection.label}
              </div>
              <ReactMarkdown
                className="prose prose-sm mt-3 max-w-none text-slate-700 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
              >
                {normalizeMarkdownMath(activeSection.content || '暂无内容')}
              </ReactMarkdown>
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

function SelectionPanel({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
}) {
  return (
    <SectionCard
      title="划词翻译"
      description="澶勭悊褰撳墠閫変腑鐨?PDF 閹存牗顒滈弬鍥╁濞?
      icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-4"
    >
      {!selectedExcerpt ? (
        <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
          閸?PDF 鎴栨鏂囬噷閫変腑涓€娈靛唴瀹癸紝杩欓噷浼氭樉绀哄師鏂囥€佽瘧鏂囦互鍙婇棶绛斿揩鎹锋搷浣溿€?        </HintPanel>
      ) : (
        <>
          <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
            <ReactMarkdown
              className="prose prose-sm max-w-none text-slate-700 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
            >
              {normalizeMarkdownMath(selectedExcerpt.text)}
            </ReactMarkdown>
          </div>

          {selectedExcerptError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {selectedExcerptError}
            </div>
          ) : null}

          {selectedExcerptTranslating ? (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/70 px-4 py-4 text-sm text-indigo-600">
              姝ｅ湪鐢熸垚璇戞枃鈥?            </div>
          ) : selectedExcerptTranslation ? (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/70 px-4 py-4">
              <ReactMarkdown
                className="prose prose-sm max-w-none text-slate-700 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
              >
                {normalizeMarkdownMath(selectedExcerptTranslation)}
              </ReactMarkdown>
            </div>
          ) : aiConfigured ? (
            <HintPanel icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}>
              瑜版挸澧犳潻妯荤梾閺堝鐦ч弬鍥风礉閸欘垯浜掗幍瀣З鐟欙箑褰傜紙鏄忕槯閵?            </HintPanel>
          ) : (
            <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
              閰嶇疆濂芥ā鍨嬪悗锛岃繖閲屼細鏄剧ず閫夊尯缈昏瘧銆?            </HintPanel>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToQa}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              加入问答
            </button>
            <button
              type="button"
              onClick={onTranslateSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              立即翻译
            </button>
            <button
              type="button"
              onClick={onClearSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              清除
            </button>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function groupChatSessions(sessions: DocumentChatSession[]) {
  const now = new Date();
  const todayStart = startOfToday(now);
  const last30DaysStart = todayStart - 29 * 24 * 60 * 60 * 1000;
  const buckets = {
    today: [] as DocumentChatSession[],
    last30Days: [] as DocumentChatSession[],
    older: [] as DocumentChatSession[],
  };

  for (const session of [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (session.updatedAt >= todayStart) {
      buckets.today.push(session);
      continue;
    }

    if (session.updatedAt >= last30DaysStart) {
      buckets.last30Days.push(session);
      continue;
    }

    buckets.older.push(session);
  }

  return [
    { key: 'today', label: 'TODAY', sessions: buckets.today },
    { key: 'last30Days', label: 'LAST 30 DAYS', sessions: buckets.last30Days },
    { key: 'older', label: 'OLDER', sessions: buckets.older },
  ].filter((group) => group.sessions.length > 0);
}

function formatChatSessionTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

interface ChatWorkspacePanelProps {
  sessions: DocumentChatSession[];
  selectedSessionId: string;
  messages: DocumentChatMessage[];
  input: string;
  loading: boolean;
  error: string;
  hasBlocks: boolean;
  selectedExcerpt: SelectedExcerpt | null;
  attachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  screenshotLoading: boolean;
  layoutMode?: 'compact' | 'workspace';
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onQaPresetChange: (presetId: string) => void;
  onSessionCreate: () => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onAppendSelectedExcerpt: () => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

function ChatWorkspacePanel({
  sessions,
  selectedSessionId,
  messages,
  input,
  loading,
  error,
  hasBlocks,
  selectedExcerpt,
  attachments,
  qaModelPresets,
  selectedQaPresetId,
  screenshotLoading,
  layoutMode = 'compact',
  onInputChange,
  onSubmit,
  onQaPresetChange,
  onSessionCreate,
  onSessionSelect,
  onSessionDelete,
  onAppendSelectedExcerpt,
  onSelectImageAttachments,
  onSelectFileAttachments,
  onCaptureScreenshot,
  onRemoveAttachment,
}: ChatWorkspacePanelProps) {
  const activePreset =
    qaModelPresets.find((preset) => preset.id === selectedQaPresetId) ?? qaModelPresets[0] ?? null;
  const sessionGroups = useMemo(() => groupChatSessions(sessions), [sessions]);
  const workspaceMode = layoutMode === 'workspace';
  const suggestionPrompts = [
    '鐠囬鏁ゆ稉澶屽仯濮掑倹瀚潻娆戠槖鐠佺儤鏋冮惃鍕壋韫囧啳纭€閻?,
    '鏉╂瑧鐦掔拋鐑樻瀮閻ㄥ嫭鏌熷▔鏇炴嫲閸╄櫣鍤庨惄鍛婄槷娴兼ê濞嶉弰顖欑矆娑?,
    '鐢喗鍨滅憴锝夊櫞鐎圭偤鐛欑拋鍓х枂娑撳簼瀵岀憰浣虹波鐠?,
  ];

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-transparent', workspaceMode && 'min-h-[520px]')}>
      <div className="border-b border-slate-200/70 px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={onSessionCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            鏂板璇?          </button>
          {sessionGroups.flatMap((group) =>
            group.sessions.map((session) => {
              const active = session.id === selectedSessionId;

              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSessionSelect(session.id)}
                  className={cn(
                    'group inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs transition',
                    active
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'
                      : 'bg-white/70 text-slate-500 ring-1 ring-slate-200 hover:text-slate-900',
                  )}
                >
                  <span className="max-w-[120px] truncate">{session.title || '鏂板璇?}</span>
                  <span className="text-[10px] text-slate-400">
                    {formatChatSessionTime(session.updatedAt)}
                  </span>
                  {sessions.length > 1 ? (
                    <span
                      role="button"
                      aria-label={`删除会话 ${session.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSessionDelete(session.id);
                      }}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-200/70 hover:text-slate-600"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded-full bg-white/70 px-2 py-1 ring-1 ring-slate-200">
            {hasBlocks ? '结构上下文已就绪' : '缁涘绶熺紒鎾寸€稉濠佺瑓閺?}
          </span>
          <span className="rounded-full bg-white/70 px-2 py-1 ring-1 ring-slate-200">
            {selectedExcerpt ? '已挂载划词上下文' : '可插入划词上下文'}
          </span>
          {activePreset ? (
            <span className="rounded-full bg-white/70 px-2 py-1 ring-1 ring-slate-200">
              {activePreset.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 text-indigo-500 ring-1 ring-slate-200">
              <Sparkles className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="mt-4 text-sm text-slate-400">閸氭垶鍨滈幓鎰版６閸忓厖绨張顒佹瀮閻ㄥ嫪鎹㈡担鏇㈡６妫?/div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {suggestionPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onInputChange(prompt)}
                  className="rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message, index) => (
              <div
                key={message.id || `qa-message-${index + 1}`}
                className={cn('flex w-full', message.role === 'assistant' ? 'justify-start' : 'justify-end')}
              >
                {message.role === 'assistant' ? (
                  <div className="mr-6 flex max-w-full gap-3">
                    <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/80 text-indigo-500 ring-1 ring-slate-200">
                      <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>Assistant</span>
                        {message.modelLabel ? (
                          <span className="rounded-full bg-white/70 px-2 py-0.5 ring-1 ring-slate-200">
                            {message.modelLabel}
                          </span>
                        ) : null}
                      </div>
                      <ReactMarkdown
                        className="prose prose-sm max-w-none text-slate-700 prose-headings:text-slate-900 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-indigo-700 prose-li:my-1 prose-a:text-indigo-600 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
                      >
                        {normalizeMarkdownMath(message.content)}
                      </ReactMarkdown>
                      {message.attachments?.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {message.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-3"
                            >
                              {attachment.kind === 'image' || attachment.kind === 'screenshot' ? (
                                attachment.dataUrl ? (
                                  <img
                                    src={attachment.dataUrl}
                                    alt={attachment.name}
                                    className="mb-2 max-h-32 w-full rounded-xl object-cover"
                                  />
                                ) : null
                              ) : null}
                              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                                {attachment.kind}
                              </div>
                              <div className="mt-1 break-words text-sm font-medium text-slate-700">
                                {attachment.name}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="ml-10 max-w-[88%] rounded-2xl rounded-tr-sm bg-slate-100 px-4 py-3 text-sm leading-7 text-slate-900">
                    <div className="mb-2 flex items-center justify-end gap-2 text-[11px] text-slate-400">
                      {message.modelLabel ? (
                        <span className="rounded-full bg-white/70 px-2 py-0.5 ring-1 ring-slate-200">
                          {message.modelLabel}
                        </span>
                      ) : null}
                      <span>You</span>
                    </div>
                    <ReactMarkdown
                      className="prose prose-sm max-w-none text-slate-800 prose-p:my-0 prose-strong:text-slate-900 prose-code:rounded prose-code:bg-white prose-code:px-1 prose-code:py-0.5 prose-code:text-indigo-700 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
                    >
                      {normalizeMarkdownMath(message.content)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}

            {loading ? (
              <div className="flex w-full justify-start">
                <div className="mr-6 flex max-w-full gap-3">
                  <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/80 text-indigo-500 ring-1 ring-slate-200">
                    <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Assistant</span>
                      {activePreset ? (
                        <span className="rounded-full bg-white/70 px-2 py-0.5 ring-1 ring-slate-200">
                          {activePreset.label}
                        </span>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-500">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">模型思考中</span>
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.2s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.1s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-6 text-slate-400">
                        濮濓絽婀紒鎾虫値瑜版挸澧犵拋鐑樻瀮閸愬懎顔愰妴浣风瑐娑撳鏋冮崪宀勬娴犲墎鏁撻幋鎰礀缁涙柣鈧?                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200/70 bg-white/70 px-4 pb-4 pt-3 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
        {error ? (
          <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50/90 px-3 py-2 text-sm text-rose-600">
            {error}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2"
              >
                {attachment.kind === 'image' || attachment.kind === 'screenshot' ? (
                  attachment.dataUrl ? (
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="h-9 w-9 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <ImagePlus className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                  )
                ) : (
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Paperclip className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">{attachment.name}</div>
                  <div className="text-xs text-slate-400">
                    {attachment.kind} 璺?{formatFileSize(attachment.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`移除附件 ${attachment.name}`}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-2xl bg-slate-100/80 px-3 py-3 ring-1 ring-transparent transition focus-within:ring-indigo-200">
          <textarea
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={workspaceMode ? 4 : 3}
            placeholder="閸氭垶鍨滈幓鎰版６閸忓厖绨張顒佹瀮閻ㄥ嫪鎹㈡担鏇㈡６妫版ǚ鈧?
            className="max-h-[30vh] min-h-[40px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-400"
          />

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onAppendSelectedExcerpt}
                disabled={!selectedExcerpt}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="插入划词"
              >
                <Quote className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={onSelectImageAttachments}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
                title="添加图片"
              >
                <ImagePlus className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={onSelectFileAttachments}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
                title="添加文件"
              >
                <Paperclip className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={onCaptureScreenshot}
                disabled={screenshotLoading}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="妗嗛€夋埅鍥?
              >
                <Camera className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <select
                value={selectedQaPresetId}
                onChange={(event) => onQaPresetChange(event.target.value)}
                className="h-9 max-w-full rounded-xl bg-white/70 px-3 text-xs text-slate-500 outline-none ring-1 ring-slate-200 transition focus:ring-indigo-200"
              >
                {qaModelPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || !input.trim()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              title="閸欐垿鈧?
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPanel(props: ChatWorkspacePanelProps) {
  return (
    <SectionCard
      title="文档问答"
      description="按论文维度保留会话与附件"
      icon={<MessageSquareText className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="p-0"
    >
      <div className="h-[560px]">
        <ChatWorkspacePanel {...props} />
      </div>
    </SectionCard>
  );
}

function MetadataPanel({
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
}: {
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
}) {
  const fields = [
    { label: '标题', value: documentTitle || '未打开文档' },
    { label: '娴ｆ粏鈧?/ 年份', value: documentMeta || '閳? },
    { label: '来源', value: documentSource || '閳? },
    { label: 'PDF', value: documentPdfName || '未打开' },
    { label: 'MinerU JSON', value: documentJsonName || '鏈姞杞? },
    { label: '缁撴瀯鍧?, value: typeof blockCount === 'number' ? String(blockCount) : '閳? },
    { label: '璇戞枃鍧?, value: typeof translatedCount === 'number' ? String(translatedCount) : '閳? },
    { label: '閻樿埖鈧?, value: statusMessage || '就绪' },
  ];

  return (
    <SectionCard
      title="论文信息"
      description="鏌ョ湅褰撳墠鏂囨。涓庝笂涓嬫枃鐘舵€?
      icon={<BookOpenText className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={hasBlocks ? 'success' : 'neutral'}>
          {hasBlocks ? '结构块已加载' : '结构块未加载'}
        </StatusBadge>
        <StatusBadge tone={aiConfigured ? 'accent' : 'neutral'}>
          {aiConfigured ? 'AI 宸查厤缃? : 'AI 鏈厤缃?}
        </StatusBadge>
      </div>

      <div className="divide-y divide-slate-200/80 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 px-4 py-3 text-sm"
          >
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              {field.label}
            </div>
            <div className="break-words text-slate-700">{field.value}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function TranslateDrawerContent({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent px-4 py-4">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selectedExcerpt ? (
          <div className="flex h-full min-h-[260px] items-center">
            <HintPanel
              icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}
              className="w-full border-slate-200 bg-white/60"
            >
              閸?PDF 閹存牜绮ㄩ弸鍕健濮濓絾鏋冩稉顓⑩偓澶夎厬娑撯偓濞堝灚鏋冪€涙绱濇潻娆撳櫡娴兼碍妯夌粈鍝勫斧閺傚洢鈧浇鐦ч弬鍥︿簰閸欏﹤鎻╅幑閿嬫惙娴ｆ嚎鈧?            </HintPanel>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4">
              <MarkdownPreview content={selectedExcerpt.text} className="prose-p:my-0" />
            </div>

            {selectedExcerptError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {selectedExcerptError}
              </div>
            ) : null}

            {selectedExcerptTranslating ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-4 text-sm text-indigo-600">
                姝ｅ湪鐢熸垚璇戞枃鈥?              </div>
            ) : selectedExcerptTranslation ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-4">
                <MarkdownPreview content={selectedExcerptTranslation} className="prose-p:my-0" />
              </div>
            ) : aiConfigured ? (
              <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
                瑜版挸澧犻柅澶婂隘鏉╂ɑ鐥呴張澶庣槯閺傚浄绱濋崣顖欎簰閹靛濮╃憴锕€褰傜紙鏄忕槯閵?              </HintPanel>
            ) : (
              <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
                閰嶇疆濂芥ā鍨嬪悗锛岃繖閲屼細鏄剧ず閫夊尯缈昏瘧銆?              </HintPanel>
            )}
          </div>
        )}
      </div>

      {selectedExcerpt ? (
        <div className="border-t border-slate-200/70 px-1 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToQa}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              加入问答
            </button>
            <button
              type="button"
              onClick={onTranslateSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              立即翻译
            </button>
            <button
              type="button"
              onClick={onClearSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              清除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LegacyInfoDrawerContent({
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
}: {
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
}) {
  const fields = [
    { label: '标题', value: documentTitle || '未打开文档' },
    { label: '娴ｆ粏鈧?/ 年份', value: documentMeta || '閳? },
    { label: '来源', value: documentSource || '閳? },
    { label: 'PDF', value: documentPdfName || '未打开' },
    { label: 'MinerU JSON', value: documentJsonName || '鏈姞杞? },
    { label: '缁撴瀯鍧?, value: typeof blockCount === 'number' ? String(blockCount) : '閳? },
    { label: '璇戞枃鍧?, value: typeof translatedCount === 'number' ? String(translatedCount) : '閳? },
    { label: '閻樿埖鈧?, value: statusMessage || '就绪' },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge tone={hasBlocks ? 'success' : 'neutral'}>
          {hasBlocks ? '结构块已加载' : '结构块未加载'}
        </StatusBadge>
        <StatusBadge tone={aiConfigured ? 'accent' : 'neutral'}>
          {aiConfigured ? 'AI 宸查厤缃? : 'AI 鏈厤缃?}
        </StatusBadge>
      </div>
      <div className="divide-y divide-slate-200/80 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/72">
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 px-4 py-3 text-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {field.label}
            </div>
            <div className="break-words text-slate-700">{field.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type InfoDrawerTabKey = 'meta' | 'notes' | 'annotations' | 'zotero';

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncatePreview(value: string, maxLength = 480): string {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function renderRelatedNoteContent(note: ZoteroRelatedNote): string {
  if (note.contentFormat === 'html') {
    return stripHtmlTags(note.content);
  }

  return note.content.trim();
}

function InfoDrawerContent({
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
  activeBlockSummary,
  workspaceNoteMarkdown,
  annotations,
  zoteroRelatedNotes,
  zoteroRelatedNotesLoading,
  zoteroRelatedNotesError,
  selectedExcerpt,
  onWorkspaceNoteChange,
  onAppendSelectedExcerptToNote,
  onCreateAnnotation,
  onDeleteAnnotation,
  onSelectAnnotation,
}: {
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  activeBlockSummary?: string;
  workspaceNoteMarkdown: string;
  annotations: PaperAnnotation[];
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  selectedExcerpt: SelectedExcerpt | null;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<InfoDrawerTabKey>('meta');
  const [annotationDraft, setAnnotationDraft] = useState('');

  const fields = [
    { label: '标题', value: documentTitle || '未打开文档' },
    { label: '娴ｆ粏鈧?/ 年份', value: documentMeta || '閳? },
    { label: '来源', value: documentSource || '閳? },
    { label: 'PDF', value: documentPdfName || '未打开' },
    { label: 'MinerU JSON', value: documentJsonName || '鏈姞杞? },
    { label: '缁撴瀯鍧?, value: typeof blockCount === 'number' ? String(blockCount) : '閳? },
    { label: '璇戞枃鍧?, value: typeof translatedCount === 'number' ? String(translatedCount) : '閳? },
    { label: '閻樿埖鈧?, value: statusMessage || '就绪' },
  ];

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((left, right) => right.updatedAt - left.updatedAt),
    [annotations],
  );
  const activeBlockLabel = activeBlockSummary?.trim() || '灏氭湭閫変腑鍙壒娉ㄧ殑缁撴瀯鍧?;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-slate-200/80 px-4 py-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusBadge tone={hasBlocks ? 'success' : 'neutral'}>
            {hasBlocks ? '结构块已加载' : '结构块未加载'}
          </StatusBadge>
          <StatusBadge tone={aiConfigured ? 'accent' : 'neutral'}>
            {aiConfigured ? 'AI 宸查厤缃? : 'AI 鏈厤缃?}
          </StatusBadge>
          <StatusBadge tone="neutral">{annotations.length} 鏉℃壒娉?/StatusBadge>
          <StatusBadge tone="neutral">{zoteroRelatedNotes.length} 鏉″叧鑱旂瑪璁?/StatusBadge>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'notes' as const, label: '笔记' },
            { key: 'annotations' as const, label: '批注' },
            { key: 'zotero' as const, label: 'Zotero' },
            { key: 'meta' as const, label: '信息' },
          ].filter((tab) => tab.key !== 'notes').map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                activeTab === tab.key
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                  : 'border-slate-200 bg-white/80 text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'meta' ? (
          <div className="divide-y divide-slate-200/80 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/72">
            {fields.map((field) => (
              <div
                key={field.label}
                className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 px-4 py-3 text-sm"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {field.label}
                </div>
                <div className="break-words text-slate-700">{field.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === 'notes' ? (
          <div className="space-y-4">
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="text-sm font-semibold text-slate-900">閹簼绠為崑姘辩應鐠?/div>
              <div className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
                <div>1. 鍦ㄥ乏渚?PDF 閹存牕褰告笟褎顒滈弬鍥櫡閸掓帟鐦濋敍宀€鍔ч崥搴ｅ仯閳ユ粏鎷烽崝鐘插灊鐠囧秮鈧縿鈧?/div>
                <div>2. 鐩存帴鍦ㄤ笅鏂瑰伐浣滃尯绗旇涓褰曚綘鐨勭悊瑙ｃ€侀棶棰樺拰寰呭姙銆?/div>
                <div>3. 杩欓噷鐨勭瑪璁颁細璺熼殢褰撳墠璁烘枃鍘嗗彶鑷姩淇濆瓨銆?/div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">瀹搞儰缍旈崠铏圭應鐠?/div>
                  <div className="mt-1 text-xs text-slate-400">閼奉亜濮╅梾蹇氼啈閺傚洤宸婚崣韫鐠ц渹绻氱€?/div>
                </div>
                <button
                  type="button"
                  onClick={onAppendSelectedExcerptToNote}
                  disabled={!selectedExcerpt?.text.trim()}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  追加划词
                </button>
              </div>
              <textarea
                value={workspaceNoteMarkdown}
                onChange={(event) => onWorkspaceNoteChange(event.target.value)}
                placeholder="鐠佹澘缍嶉梼鍛邦嚢鐟曚胶鍋ｉ妴浣哥窡妤犲矁鐦夐梻顕€顣介妴浣规煙濞夋洘濯剁憴锝嗗灗鐎圭偤鐛欓幀婵婄熅閵?
                className="min-h-[180px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white"
              />
            </div>

            {selectedExcerpt?.text.trim() ? (
              <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/60 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  当前划词
                </div>
                <div className="mt-2">
                  <MarkdownPreview content={selectedExcerpt.text} className="prose-p:my-0" />
                </div>
              </div>
            ) : null}

            <div className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">Markdown 预览</div>
              {workspaceNoteMarkdown.trim() ? (
                <ReactMarkdown
                  className="prose prose-sm max-w-none text-slate-700 prose-headings:text-slate-900 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-indigo-700 prose-li:my-1 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
                >
                  {normalizeMarkdownMath(workspaceNoteMarkdown)}
                </ReactMarkdown>
              ) : (
                <div className="text-sm text-slate-400">杩欓噷浼氭樉绀虹瑪璁伴瑙堛€?/div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'annotations' ? (
          <div className="space-y-4">
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="text-sm font-semibold text-slate-900">怎么批注</div>
              <div className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
                <div>1. 閸忓牏鍋ｉ崙璇蹭箯娓?PDF 鐑尯鎴栧彸渚х粨鏋勫潡锛岄€変腑涓€涓潡銆?/div>
                <div>2. 閸︺劋绗呴棃銏ｇ翻閸忋儲澹掑▔銊ュ敶鐎圭櫢绱濋悙鐟板毊閳ユ粍鍧婇崝鐘冲濞夈劉鈧縿鈧?/div>
                <div>3. 宸蹭繚瀛樼殑鎵规敞鐐逛竴涓嬪氨浼氶噸鏂板畾浣嶅埌瀵瑰簲鍧椼€?/div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4">
              <div className="text-sm font-semibold text-slate-900">创建批注</div>
              <div className="mt-1 text-xs text-slate-400">当前目标：{activeBlockLabel}</div>
              <textarea
                value={annotationDraft}
                onChange={(event) => setAnnotationDraft(event.target.value)}
                placeholder="娑撳搫缍嬮崜宥嗙负濞茶崵娈戠紒鎾寸€崸妤€鍟撴稉鈧弶鈩冨濞夈劊鈧?
                className="mt-3 min-h-[120px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onCreateAnnotation(annotationDraft)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  添加批注
                </button>
                <button
                  type="button"
                  onClick={() => onCreateAnnotation('')}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  浠呴珮浜?
                </button>
                <button
                  type="button"
                  onClick={() => setAnnotationDraft('')}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  清空草稿
                </button>
              </div>
            </div>

            {sortedAnnotations.length > 0 ? (
              <div className="space-y-3">
                {sortedAnnotations.map((annotation) => (
                  <div
                    key={annotation.id}
                    className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onSelectAnnotation(annotation.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Page {annotation.pageIndex + 1} 璺?{annotation.blockType}
                        </div>
                        <div className="mt-2 text-sm leading-7 text-slate-700">
                          {annotation.note || annotation.quote || '閺冪姵鏋冮張顒€鍞寸€?}
                        </div>
                        {annotation.quote ? (
                          <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
                            {truncatePreview(annotation.quote, 180)}
                          </div>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAnnotation(annotation.id)}
                        className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label="删除批注"
                      >
                        <X className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
                杩樻病鏈夋壒娉ㄣ€傚厛鍦ㄥ乏渚ф垨姝ｆ枃鍖洪€変腑涓€涓粨鏋勫潡锛屽啀涓哄畠璁板綍鎵规敞銆?              </HintPanel>
            )}
          </div>
        ) : null}

        {activeTab === 'zotero' ? (
          <div className="space-y-3">
            {zoteroRelatedNotesLoading ? (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
                <div className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
              </div>
            ) : zoteroRelatedNotesError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {zoteroRelatedNotesError}
              </div>
            ) : zoteroRelatedNotes.length > 0 ? (
              zoteroRelatedNotes.map((note) => {
                const previewContent = truncatePreview(renderRelatedNoteContent(note), 560);

                return (
                  <div
                    key={note.id}
                    className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {note.title || '閺堫亜鎳￠崥宥囩應鐠?}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{note.sourceLabel}</div>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                        {note.kind}
                      </span>
                    </div>
                    <div className="mt-3">
                      {note.contentFormat === 'markdown' ? (
                        <ReactMarkdown
                          className="prose prose-sm max-w-none text-slate-700 prose-p:my-2 prose-p:leading-relaxed prose-strong:text-slate-900 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-indigo-700 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
                        >
                          {normalizeMarkdownMath(previewContent)}
                        </ReactMarkdown>
                      ) : (
                        <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                          {previewContent || '无可显示内容'}
                        </div>
                      )}
                    </div>
                    {note.filePath ? (
                      <div className="mt-3 break-all text-[11px] text-slate-400">{note.filePath}</div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <HintPanel icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}>
                瑜版挸澧犵拋鐑樻瀮娑撳鐥呴張澶嬪閸?Zotero 鍏宠仈绗旇鎴栨湰鍦?Markdown 绗旇銆?              </HintPanel>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}


function AssistantSidebar({
  activePanel,
  onActivePanelChange,
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
  paperSummary,
  paperSummaryLoading,
  paperSummaryError,
  onGenerateSummary,
  qaSessions,
  selectedQaSessionId,
  qaMessages,
  qaInput,
  qaAttachments,
  qaModelPresets,
  selectedQaPresetId,
  qaLoading,
  qaError,
  screenshotLoading = false,
  chatLayoutMode = 'compact',
  onQaInputChange,
  onQaSubmit,
  onQaPresetChange,
  onQaSessionCreate,
  onQaSessionSelect,
  onQaSessionDelete,
  onSelectImageAttachments,
  onSelectFileAttachments,
  onCaptureScreenshot,
  onRemoveAttachment,
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  onAppendSelectedExcerptToQa,
  activeBlockSummary,
  workspaceNoteMarkdown,
  annotations,
  zoteroRelatedNotes,
  zoteroRelatedNotesLoading,
  zoteroRelatedNotesError,
  onWorkspaceNoteChange,
  onAppendSelectedExcerptToNote,
  onCreateAnnotation,
  onDeleteAnnotation,
  onSelectAnnotation,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
  onDetach,
  onAttachBack,
  onOpenPreferences,
}: {
  activePanel: AssistantPanelKey;
  onActivePanelChange: (panel: AssistantPanelKey) => void;
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  paperSummary: PaperSummary | null;
  paperSummaryLoading: boolean;
  paperSummaryError: string;
  onGenerateSummary: () => void;
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaMessages: DocumentChatMessage[];
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  qaLoading: boolean;
  qaError: string;
  screenshotLoading?: boolean;
  chatLayoutMode?: 'compact' | 'workspace';
  onQaInputChange: (value: string) => void;
  onQaSubmit: () => void;
  onQaPresetChange: (presetId: string) => void;
  onQaSessionCreate: () => void;
  onQaSessionSelect: (sessionId: string) => void;
  onQaSessionDelete: (sessionId: string) => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  onAppendSelectedExcerptToQa: () => void;
  activeBlockSummary?: string;
  workspaceNoteMarkdown: string;
  annotations: PaperAnnotation[];
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
  onDetach?: () => void;
  onAttachBack?: () => void;
  onOpenPreferences?: () => void;
}) {
  const currentPanelMeta = {
    chat: { title: '文档问答', description: documentMeta || '鎸夎鏂囩淮搴︿繚鐣欏杞棶绛? },
    translate: { title: '划词翻译', description: '鑱氱劍褰撳墠閫変腑鐨?PDF 閹存牗顒滈弬鍥╁濞? },
    info: { title: '论文信息', description: documentSource || '閺屻儳婀呴崗鍐╂殶閹诡喕绗岄崝鐘烘祰閻樿埖鈧? },
  } as const;

  const togglePanel = (panel: Exclude<AssistantPanelKey, null>) => {
    onActivePanelChange(activePanel === panel ? null : panel);
  };

  const activityItems = [
    {
      key: 'chat' as const,
      label: '问答',
      icon: MessageSquare,
      onClick: () => togglePanel('chat'),
    },
    {
      key: 'translate' as const,
      label: '翻译',
      icon: Languages,
      onClick: () => togglePanel('translate'),
    },
    {
      key: 'info' as const,
      label: '信息',
      icon: Info,
      onClick: () => togglePanel('info'),
    },
  ];

  const panelTitle =
    activePanel === 'chat'
      ? '文档问答'
      : activePanel === 'translate'
        ? '划词翻译'
        : activePanel === 'info'
          ? '论文信息'
          : '';
  const panelDescription =
    activePanel === 'chat'
      ? documentMeta || '鎸夎鏂囩淮搴︿繚鐣欏杞璇?
      : activePanel === 'translate'
        ? '鑱氱劍褰撳墠閫変腑鐨?PDF 閹存牗顒滈弬鍥╁濞?
        : activePanel === 'info'
          ? documentSource || '查看元数据、笔记与批注'
          : '';

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div
        className={cn(
          'overflow-hidden border-l border-slate-200 bg-slate-50/50 transition-[width] duration-300 ease-in-out',
          activePanel ? 'w-80' : 'w-0 border-transparent',
        )}
      >
        <div className="flex h-full w-80 min-w-80 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{panelTitle}</div>
              <div className="mt-1 truncate text-xs text-slate-400">
                {activePanel === 'info'
                  ? documentSource || '查看元数据、Zotero 娣団剝浼呮稉搴㈠濞?
                  : panelDescription}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onActivePanelChange(null)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
              aria-label="收起右侧面板"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {activePanel === 'chat' ? (
              <ChatWorkspacePanel
                sessions={qaSessions}
                selectedSessionId={selectedQaSessionId}
                messages={qaMessages}
                input={qaInput}
                loading={qaLoading}
                error={qaError}
                hasBlocks={hasBlocks}
                selectedExcerpt={selectedExcerpt}
                attachments={qaAttachments}
                qaModelPresets={qaModelPresets}
                selectedQaPresetId={selectedQaPresetId}
                screenshotLoading={screenshotLoading}
                layoutMode={chatLayoutMode}
                onInputChange={onQaInputChange}
                onSubmit={onQaSubmit}
                onQaPresetChange={onQaPresetChange}
                onSessionCreate={onQaSessionCreate}
                onSessionSelect={onQaSessionSelect}
                onSessionDelete={onQaSessionDelete}
                onAppendSelectedExcerpt={onAppendSelectedExcerptToQa}
                onSelectImageAttachments={onSelectImageAttachments}
                onSelectFileAttachments={onSelectFileAttachments}
                onCaptureScreenshot={onCaptureScreenshot}
                onRemoveAttachment={onRemoveAttachment}
              />
            ) : null}

            {activePanel === 'translate' ? (
              <TranslateDrawerContent
                selectedExcerpt={selectedExcerpt}
                selectedExcerptTranslation={selectedExcerptTranslation}
                selectedExcerptTranslating={selectedExcerptTranslating}
                selectedExcerptError={selectedExcerptError}
                aiConfigured={aiConfigured}
                onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
                onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
                onClearSelectedExcerpt={onClearSelectedExcerpt}
              />
            ) : null}

            {activePanel === 'info' ? (
              <InfoDrawerContent
                documentTitle={documentTitle}
                documentMeta={documentMeta}
                documentSource={documentSource}
                documentPdfName={documentPdfName}
                documentJsonName={documentJsonName}
                blockCount={blockCount}
                translatedCount={translatedCount}
                statusMessage={statusMessage}
                hasBlocks={hasBlocks}
                aiConfigured={aiConfigured}
                activeBlockSummary={activeBlockSummary}
                workspaceNoteMarkdown={workspaceNoteMarkdown}
                annotations={annotations}
                zoteroRelatedNotes={zoteroRelatedNotes}
                zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
                zoteroRelatedNotesError={zoteroRelatedNotesError}
                selectedExcerpt={selectedExcerpt}
                onWorkspaceNoteChange={onWorkspaceNoteChange}
                onAppendSelectedExcerptToNote={onAppendSelectedExcerptToNote}
                onCreateAnnotation={onCreateAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onSelectAnnotation={onSelectAnnotation}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="z-10 flex h-full w-12 flex-col items-center border-l border-slate-200 bg-white py-4 shadow-[-2px_0_10px_rgba(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-1.5">
          {activityItems.map((item) => {
            const active = activePanel === item.key;
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                title={
                  item.key === 'chat'
                    ? '问答'
                    : item.key === 'translate'
                      ? '翻译'
                      : '信息'
                }
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-xl transition',
                  active
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
                )}
              >
                {active ? <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-indigo-600" /> : null}
                <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          {onDetach ? (
            <button
              type="button"
              onClick={onDetach}
              title="弹出独立窗口"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <ExternalLink className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onAttachBack ? (
            <button
              type="button"
              onClick={onAttachBack}
              title="停靠回侧边栏"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <PanelRightOpen className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onOpenPreferences ? (
            <button
              type="button"
              onClick={onOpenPreferences}
              title="设置"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <Settings2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { AssistantSidebar, ChatPanel, ChatWorkspacePanel, SectionCard, SelectionPanel, SummaryPanel };
