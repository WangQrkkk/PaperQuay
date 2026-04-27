import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Loader2,
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
import { useLocaleText } from '../../i18n/uiLanguage';
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
  const l = useLocaleText();
  const [activeTab, setActiveTab] = useState<SummaryTabKey>('overview');
  const sections = useMemo(
    () =>
      paperSummary
        ? [
            { key: 'overview' as const, label: l('概览', 'Overview'), content: paperSummary.overview },
            { key: 'background' as const, label: l('背景', 'Background'), content: paperSummary.background },
            { key: 'problem' as const, label: l('问题', 'Problem'), content: paperSummary.researchProblem },
            { key: 'approach' as const, label: l('方法', 'Approach'), content: paperSummary.approach },
            { key: 'experiment' as const, label: l('实验', 'Experiments'), content: paperSummary.experimentSetup },
            { key: 'findings' as const, label: l('发现', 'Findings'), content: paperSummary.keyFindings.join('\n') },
            { key: 'conclusion' as const, label: l('结论', 'Conclusion'), content: paperSummary.conclusions },
            { key: 'limitations' as const, label: l('局限性', 'Limitations'), content: paperSummary.limitations },
          ]
        : [],
    [paperSummary, l],
  );
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];

  return (
    <SectionCard
      title={compact ? l('论文摘要', 'Paper Summary') : l('AI 摘要', 'AI Summary')}
      description={l(
        '根据当前文档内容生成结构化摘要。',
        'Generate a structured summary from the current document.',
      )}
      icon={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}
      actions={
        <button
          type="button"
          onClick={onGenerateSummary}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading
            ? l('生成中...', 'Generating...')
            : paperSummary
              ? l('刷新整篇摘要', 'Regenerate')
              : l('生成摘要', 'Generate Summary')}
        </button>
      }
      contentClassName="space-y-4"
    >
      {!paperSummary && !hasBlocks ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '请先加载 PDF 和对应的 MinerU JSON，再生成摘要。',
            'Load the PDF and its MinerU JSON before generating a summary.',
          )}
        </HintPanel>
      ) : null}

      {!paperSummary && hasBlocks && !aiConfigured ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '请先配置可用的 chat/completions 模型，然后再生成摘要。',
            'Configure an available chat/completions model before generating a summary.',
          )}
        </HintPanel>
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
              <StatusBadge tone="accent">{l('摘要已生成', 'Summary Ready')}</StatusBadge>
              <StatusBadge>
                {l(`${paperSummary.keywords.length} 个关键词`, `${paperSummary.keywords.length} keywords`)}
              </StatusBadge>
              <StatusBadge>
                {l(
                  `${paperSummary.keyFindings.length} 条关键发现`,
                  `${paperSummary.keyFindings.length} key findings`,
                )}
              </StatusBadge>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-slate-950">{paperSummary.title}</h3>
            <MarkdownPreview content={paperSummary.abstract} className="mt-3 text-slate-600" />
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
              <MarkdownPreview
                content={activeSection.content || l('暂无内容', 'No content yet')}
                className="mt-3 text-slate-700"
              />
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
  const l = useLocaleText();

  return (
    <SectionCard
      title={l('划词翻译', 'Selection Translation')}
      description={l(
        '选中文本后可快速翻译，并加入问答上下文。',
        'Translate selected text quickly and append it to the QA context.',
      )}
      icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-4"
    >
      {!selectedExcerpt ? (
        <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '在 PDF 视图中选中文本后，这里会显示选中内容和译文。',
            'Once you select text in the PDF view, the selection and its translation will appear here.',
          )}
        </HintPanel>
      ) : (
        <>
          <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
            <MarkdownPreview content={selectedExcerpt.text} />
          </div>

          {selectedExcerptError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {selectedExcerptError}
            </div>
          ) : null}

          {selectedExcerptTranslating ? (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/70 px-4 py-4 text-sm text-indigo-600">
              {l('正在翻译选中文本...', 'Translating the selected text...')}
            </div>
          ) : selectedExcerptTranslation ? (
            <div className="rounded-[22px] border border-indigo-100 bg-indigo-50/70 px-4 py-4">
              <MarkdownPreview content={selectedExcerptTranslation} />
            </div>
          ) : aiConfigured ? (
            <HintPanel icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}>
              {l(
                '当前还没有翻译结果，可以点击“立即翻译”。',
                'There is no translation yet. Click "Translate Now" to generate one.',
              )}
            </HintPanel>
          ) : (
            <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
              {l('请先配置模型后再使用翻译能力。', 'Configure a model before using translation.')}
            </HintPanel>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToQa}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {l('加入问答', 'Add to QA')}
            </button>
            <button
              type="button"
              onClick={onTranslateSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {l('立即翻译', 'Translate Now')}
            </button>
            <button
              type="button"
              onClick={onClearSelectedExcerpt}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {l('清除', 'Clear')}
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

function groupChatSessions(
  sessions: DocumentChatSession[],
  labels: { today: string; last30Days: string; older: string },
) {
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
    { key: 'today', label: labels.today, sessions: buckets.today },
    { key: 'last30Days', label: labels.last30Days, sessions: buckets.last30Days },
    { key: 'older', label: labels.older, sessions: buckets.older },
  ].filter((group) => group.sessions.length > 0);
}

function formatChatSessionTime(timestamp: number, locale: 'zh-CN' | 'en-US') {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
}

const CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY = 'paperquay.chat-history-panel-width';
const MIN_CHAT_HISTORY_PANEL_WIDTH = 180;
const MAX_CHAT_HISTORY_PANEL_WIDTH = 320;
const MIN_CHAT_CONTENT_PANEL_WIDTH = 250;
const CHAT_COMPOSER_COMPACT_WIDTH = 540;
const CHAT_COMPOSER_WRAP_MODEL_WIDTH = 680;
const CHAT_COMPOSER_MAX_TEXTAREA_HEIGHT = 240;

function loadStoredPanelWidth(key: string, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const stored = window.localStorage.getItem(key);
  const parsed = stored ? Number(stored) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
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
  const l = useLocaleText();
  const locale = l('zh-CN', 'en-US') as 'zh-CN' | 'en-US';
  const panelRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const compactActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historyPanelWidth, setHistoryPanelWidth] = useState(() =>
    loadStoredPanelWidth(CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY, 228),
  );
  const [resizingHistoryPanel, setResizingHistoryPanel] = useState(false);
  const [composerWidth, setComposerWidth] = useState(0);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const activePreset =
    qaModelPresets.find((preset) => preset.id === selectedQaPresetId) ?? qaModelPresets[0] ?? null;
  const workspaceMode = layoutMode === 'workspace';
  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    [sessions],
  );
  const activeSession =
    orderedSessions.find((session) => session.id === selectedSessionId) ?? orderedSessions[0] ?? null;
  const suggestionPrompts = [
    l('请用三点总结这篇论文的核心贡献。', 'Summarize the core contributions of this paper in three points.'),
    l('这篇论文的方法相比基线模型有哪些优势？', 'What advantages does this method have over the baseline models?'),
    l('请解释实验设置与最关键的结果。', 'Explain the experimental setup and the most important results.'),
  ];
  const canSubmit = input.trim().length > 0 && !loading;
  const composerActions = [
    {
      key: 'image',
      icon: ImagePlus,
      label: l('添加图片', 'Add images'),
      onClick: onSelectImageAttachments,
      disabled: false,
    },
    {
      key: 'file',
      icon: Paperclip,
      label: l('添加文件', 'Add files'),
      onClick: onSelectFileAttachments,
      disabled: false,
    },
    {
      key: 'screenshot',
      icon: Camera,
      label: screenshotLoading
        ? l('截图中...', 'Capturing...')
        : l('截图', 'Screenshot'),
      onClick: onCaptureScreenshot,
      disabled: screenshotLoading,
    },
    {
      key: 'quote',
      icon: Quote,
      label: l('引用选中内容', 'Quote selection'),
      onClick: onAppendSelectedExcerpt,
      disabled: !selectedExcerpt,
    },
  ] as const;
  const compactComposer = composerWidth > 0 && composerWidth <= CHAT_COMPOSER_COMPACT_WIDTH;
  const wrapModelSelector = composerWidth > 0 && composerWidth <= CHAT_COMPOSER_WRAP_MODEL_WIDTH;
  const primaryComposerActions = compactComposer
    ? composerActions.filter((action) => action.key === 'image' || action.key === 'file')
    : composerActions;
  const secondaryComposerActions = compactComposer
    ? composerActions.filter((action) => action.key !== 'image' && action.key !== 'file')
    : [];

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, messages]);

  useEffect(() => {
    const composerElement = composerRef.current;

    if (!composerElement) {
      return undefined;
    }

    setComposerWidth(Math.round(composerElement.getBoundingClientRect().width));

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0);
      setComposerWidth(nextWidth);
    });

    observer.observe(composerElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!compactComposer) {
      setCompactActionsOpen(false);
    }
  }, [compactComposer]);

  useEffect(() => {
    if (!compactActionsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && compactActionsMenuRef.current?.contains(target)) {
        return;
      }

      setCompactActionsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [compactActionsOpen]);

  useEffect(() => {
    const textareaElement = textareaRef.current;

    if (!textareaElement) {
      return;
    }

    textareaElement.style.height = '0px';
    textareaElement.style.height = `${Math.min(
      textareaElement.scrollHeight,
      CHAT_COMPOSER_MAX_TEXTAREA_HEIGHT,
    )}px`;
  }, [composerWidth, input]);

  useEffect(() => {
    window.localStorage.setItem(
      CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(historyPanelWidth)),
    );
  }, [historyPanelWidth]);

  useEffect(() => {
    if (!resizingHistoryPanel) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const panelRect = panelRef.current?.getBoundingClientRect();

      if (!panelRect) {
        return;
      }

      const boundedMaxWidth = Math.min(
        MAX_CHAT_HISTORY_PANEL_WIDTH,
        Math.max(MIN_CHAT_HISTORY_PANEL_WIDTH, panelRect.width - MIN_CHAT_CONTENT_PANEL_WIDTH),
      );
      const nextWidth = Math.round(
        Math.min(
          boundedMaxWidth,
          Math.max(MIN_CHAT_HISTORY_PANEL_WIDTH, event.clientX - panelRect.left),
        ),
      );

      setHistoryPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setResizingHistoryPanel(false);
    };

    const previousUserSelect = globalThis.document.body.style.userSelect;
    const previousCursor = globalThis.document.body.style.cursor;

    globalThis.document.body.style.userSelect = 'none';
    globalThis.document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      globalThis.document.body.style.userSelect = previousUserSelect;
      globalThis.document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingHistoryPanel]);

  return (
    <div
      ref={panelRef}
      className={cn('flex h-full min-h-0 overflow-hidden bg-transparent', workspaceMode && 'min-h-[520px]')}
    >
      {!historyCollapsed ? (
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,247,251,0.92))]"
          style={{ width: historyPanelWidth }}
        >
          <div className="border-b border-slate-200/70 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {l('历史记录', 'History')}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {l(`${orderedSessions.length} 个会话`, `${orderedSessions.length} chats`)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryCollapsed(true)}
                className="inline-flex h-8 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              >
                {l('隐藏', 'Hide')}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {orderedSessions.length > 0 ? (
              <div className="space-y-2">
                {orderedSessions.map((session) => {
                  const active = session.id === selectedSessionId;

                  return (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex items-start gap-2 rounded-2xl border p-2 transition',
                        active
                          ? 'border-indigo-200 bg-indigo-50/80 shadow-[0_12px_28px_rgba(79,70,229,0.10)]'
                          : 'border-transparent bg-white/80 hover:border-slate-200 hover:bg-white',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSessionSelect(session.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className={cn('truncate text-sm font-medium', active ? 'text-indigo-700' : 'text-slate-700')}>
                          {session.title || l('未命名会话', 'Untitled Chat')}
                        </div>
                        <div className={cn('mt-1 text-[11px]', active ? 'text-indigo-500' : 'text-slate-400')}>
                          {formatChatSessionTime(session.updatedAt, locale)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSessionDelete(session.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label={l('删除会话', 'Delete chat')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm leading-6 text-slate-500">
                {l('还没有历史会话，先创建一个新的问答会话。', 'No chat history yet. Create a new chat to get started.')}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {!historyCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={l('调整历史侧栏宽度', 'Resize history sidebar')}
          onDoubleClick={() => setHistoryPanelWidth(228)}
          onPointerDown={(event) => {
            event.preventDefault();
            setResizingHistoryPanel(true);
          }}
          className="group relative z-10 w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/80 transition-all duration-200 group-hover:w-[3px] group-hover:bg-slate-400" />
          <div className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-all duration-200 group-hover:w-1.5 group-hover:bg-slate-500" />
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-slate-200/70 bg-white/84 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {l('会话', 'Chat')}
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                {activeSession?.title || l('文档问答', 'Document Chat')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {historyCollapsed ? (
                <button
                  type="button"
                  onClick={() => setHistoryCollapsed(false)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {l('历史记录', 'History')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSessionCreate}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                {l('新建会话', 'New Chat')}
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,#ffffff,#f8fafc_35%,#f3f6fb_100%)] px-4 py-5">
          {messages.length === 0 ? (
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full space-y-4 rounded-[28px] border border-white/80 bg-white/86 p-5 shadow-[0_20px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.14)]">
                    <MessageSquareText className="h-4.5 w-4.5" strokeWidth={1.8} />
                  </span>
                  <div className="space-y-1.5">
                    <div className="text-base font-semibold text-slate-900">
                      {l('开始文档问答', 'Start document chat')}
                    </div>
                    <div className="text-sm leading-6 text-slate-500">
                      {l(
                        '可以直接提问，也可以先附加选中文本、图片、文件或截图再继续追问。',
                        'Ask directly, or attach selected text, images, files, or screenshots first.',
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  {suggestionPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onInputChange(prompt)}
                      className="block w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left text-sm text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const assistantMessage = message.role === 'assistant';

                return (
                  <div
                    key={message.id}
                    className={cn(
                      'flex gap-3',
                      assistantMessage ? 'items-start' : 'justify-end',
                    )}
                  >
                    {assistantMessage ? (
                      <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]">
                        <Bot className="h-4 w-4" strokeWidth={1.9} />
                      </span>
                    ) : null}

                    <div
                      className={cn(
                        'max-w-[92%] rounded-[24px] px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.05)]',
                        assistantMessage
                          ? 'border border-white/80 bg-white text-slate-900'
                          : 'bg-slate-900 text-slate-50',
                      )}
                    >
                      <div
                        className={cn(
                          'mb-2 flex items-center gap-2 text-[11px]',
                          assistantMessage ? 'text-slate-400' : 'text-slate-300',
                        )}
                      >
                        <span className="font-semibold">
                          {assistantMessage ? l('助手', 'Assistant') : l('你', 'You')}
                        </span>
                        {assistantMessage && message.modelLabel ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {message.modelLabel}
                          </span>
                        ) : null}
                        <span>{formatChatSessionTime(message.createdAt, locale)}</span>
                      </div>

                      <MarkdownPreview
                        content={message.content}
                        className={cn(
                          'text-sm leading-7',
                          !assistantMessage &&
                            '!text-slate-50 prose-p:text-slate-50 prose-strong:text-white prose-li:text-slate-100 prose-headings:text-white prose-code:bg-white/10 prose-code:text-white [&_.katex]:text-white',
                        )}
                      />

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
                                className={cn(
                                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                                  assistantMessage
                                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                                    : 'border-white/10 bg-white/10 text-slate-100',
                                )}
                              >
                                <AttachmentIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                                <span className="max-w-[180px] truncate">{attachment.name}</span>
                                <span className={assistantMessage ? 'text-slate-400' : 'text-slate-300'}>
                                  {formatFileSize(attachment.size)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {loading ? (
                <div className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]">
                    <Bot className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <div className="max-w-[92%] rounded-[24px] border border-white/80 bg-white px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" strokeWidth={1.9} />
                      {l('模型回复中...', 'Model is replying...')}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {activePreset
                        ? l(`当前模型：${activePreset.label}`, `Current model: ${activePreset.label}`)
                        : l('正在基于当前文档内容生成回复。', 'Generating a response grounded in the current document.')}
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={messageEndRef} />
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/70 bg-white/88 px-4 py-4 backdrop-blur-xl">
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => {
                const AttachmentIcon =
                  attachment.kind === 'image'
                    ? ImagePlus
                    : attachment.kind === 'screenshot'
                      ? Camera
                      : Paperclip;

                return (
                  <div
                    key={attachment.id}
                    className="group inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
                  >
                    {attachment.dataUrl && (attachment.kind === 'image' || attachment.kind === 'screenshot') ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-10 w-10 rounded-xl border border-slate-200 object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <AttachmentIcon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[180px] truncate font-medium text-slate-700">
                        {attachment.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {formatFileSize(attachment.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label={l('移除附件', 'Remove attachment')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            ref={composerRef}
            className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_20px_44px_rgba(15,23,42,0.07)]"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (canSubmit) {
                    onSubmit();
                  }
                }
              }}
              placeholder={
                hasBlocks
                  ? l(
                      '输入你的问题，Enter 发送，Shift+Enter 换行。',
                      'Ask a question. Press Enter to send and Shift+Enter for a new line.',
                    )
                  : l(
                      '建议先加载论文结构块后再提问，回答会更准确。',
                      'Load document blocks before asking questions for more accurate answers.',
                    )
              }
              className="min-h-[96px] w-full resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-1 py-1 text-sm leading-7 text-slate-700 outline-none"
            />

            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {primaryComposerActions.map((action) => {
                  const Icon = action.icon;

                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={action.onClick}
                      disabled={action.disabled}
                      title={action.label}
                      aria-label={action.label}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {action.key === 'screenshot' && screenshotLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                      ) : (
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      )}
                    </button>
                  );
                })}

                {secondaryComposerActions.length > 0 ? (
                  <div ref={compactActionsMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setCompactActionsOpen((open) => !open)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                      aria-label={l('更多操作', 'More actions')}
                      aria-expanded={compactActionsOpen}
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.8} />
                    </button>

                    {compactActionsOpen ? (
                      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                        {secondaryComposerActions.map((action) => {
                          const Icon = action.icon;

                          return (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() => {
                                setCompactActionsOpen(false);
                                action.onClick();
                              }}
                              disabled={action.disabled}
                              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {action.key === 'screenshot' && screenshotLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                              ) : (
                                <Icon className="h-4 w-4" strokeWidth={1.8} />
                              )}
                              <span>{action.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <label
                  className={cn(
                    'flex h-10 w-[184px] shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600',
                    wrapModelSelector && 'basis-full',
                  )}
                >
                  <Bot className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.8} />
                  <select
                    value={selectedQaPresetId}
                    onChange={(event) => onQaPresetChange(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
                    title={l('选择问答模型', 'Choose QA model')}
                  >
                    {qaModelPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={1.9} />
                )}
                <span className="hidden sm:inline">
                  {loading ? l('回复中', 'Replying') : l('发送', 'Send')}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
            <span>
              {hasBlocks
                ? l('当前回复会优先参考文档结构块内容。', 'Responses prioritize the current document blocks.')
                : l('建议先加载结构块再提问，回答会更准确。', 'Load structured blocks first for better answers.')}
            </span>
            <span>
              {loading
                ? l('模型回复中...', 'Model is replying...')
                : l('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPanel(props: ChatWorkspacePanelProps) {
  const l = useLocaleText();

  return (
    <SectionCard
      title={l('文档问答', 'Document Chat')}
      description={l(
        '基于当前论文内容进行多轮问答。',
        'Run multi-turn QA grounded in the current paper.',
      )}
      icon={<MessageSquare className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="p-0"
    >
      <ChatWorkspacePanel {...props} />
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
  const l = useLocaleText();

  return (
    <SectionCard
      title={l('论文信息', 'Paper Info')}
      description={
        documentSource ||
        l(
          '当前论文的基础信息与处理状态。',
          'Basic paper information and processing status.',
        )
      }
      icon={<Info className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-3"
    >
      <div className="space-y-1">
        <div className="text-base font-semibold text-slate-900">
          {documentTitle || l('未命名论文', 'Untitled Paper')}
        </div>
        {documentMeta ? <div className="text-sm text-slate-500">{documentMeta}</div> : null}
      </div>
      <div className="grid gap-2 text-sm text-slate-600">
        <div>
          {l('PDF：', 'PDF: ')}
          {documentPdfName || l('未加载', 'Not loaded')}
        </div>
        <div>
          {l('JSON：', 'JSON: ')}
          {documentJsonName || l('未加载', 'Not loaded')}
        </div>
        <div>{l(`块数量：${blockCount ?? 0}`, `Blocks: ${blockCount ?? 0}`)}</div>
        <div>{l(`已翻译块：${translatedCount ?? 0}`, `Translated Blocks: ${translatedCount ?? 0}`)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={hasBlocks ? 'success' : 'neutral'}>
          {hasBlocks ? l('已加载块数据', 'Blocks Loaded') : l('未加载块数据', 'No Block Data')}
        </StatusBadge>
        <StatusBadge tone={aiConfigured ? 'success' : 'neutral'}>
          {aiConfigured ? l('AI 已配置', 'AI Ready') : l('AI 未配置', 'AI Not Configured')}
        </StatusBadge>
      </div>
      {statusMessage ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {statusMessage}
        </div>
      ) : null}
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
    <div className="h-full overflow-y-auto px-4 py-4">
      <SelectionPanel
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        aiConfigured={aiConfigured}
        onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
        onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
        onClearSelectedExcerpt={onClearSelectedExcerpt}
      />
    </div>
  );
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncatePreview(value: string, maxLength = 480): string {
  if (!value) {
    return '';
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function renderRelatedNoteContent(note: ZoteroRelatedNote): string {
  if (note.contentFormat === 'html') {
    return stripHtmlTags(note.content);
  }
  return note.content;
}

type InfoDrawerContentProps = {
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
};

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
}: InfoDrawerContentProps) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <MetadataPanel
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
      />
    </div>
  );
}

type NotesDrawerContentProps = {
  activeBlockSummary?: string;
  workspaceNoteMarkdown: string;
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  selectedExcerpt: SelectedExcerpt | null;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
};

function NotesDrawerContent({
  activeBlockSummary,
  workspaceNoteMarkdown,
  zoteroRelatedNotes,
  zoteroRelatedNotesLoading,
  zoteroRelatedNotesError,
  selectedExcerpt,
  onWorkspaceNoteChange,
  onAppendSelectedExcerptToNote,
}: NotesDrawerContentProps) {
  const l = useLocaleText();

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="space-y-4">
        {activeBlockSummary ? (
          <SectionCard
            title={l('当前块摘要', 'Active Block Summary')}
            description={l(
              '来自当前激活块的上下文信息，可直接用于整理笔记。',
              'Context from the active block that you can reuse in your notes.',
            )}
            icon={<BookOpenText className="h-4 w-4" strokeWidth={1.8} />}
          >
            <MarkdownPreview content={activeBlockSummary} />
          </SectionCard>
        ) : null}

        <SectionCard
          title={l('工作区笔记', 'Workspace Notes')}
          description={l(
            '记录阅读过程中的想法和待办。',
            'Capture ideas and follow-ups while reading.',
          )}
          icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
        >
          <textarea
            value={workspaceNoteMarkdown}
            onChange={(event) => onWorkspaceNoteChange(event.target.value)}
            placeholder={l('在这里输入 Markdown 笔记...', 'Write Markdown notes here...')}
            className="min-h-[180px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToNote}
              disabled={!selectedExcerpt}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {l('插入选中文本', 'Insert Selection')}
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title={l('关联笔记', 'Related Notes')}
          description={l(
            '显示从 Zotero 或本地 Markdown 文档提取的相关笔记。',
            'Show notes collected from Zotero or local Markdown documents.',
          )}
          icon={<FileJson className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
        >
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
                        {note.title || l('未命名笔记', 'Untitled Note')}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{note.sourceLabel}</div>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                      {note.kind}
                    </span>
                  </div>
                  <div className="mt-3">
                    {note.contentFormat === 'markdown' ? (
                      <MarkdownPreview content={previewContent} />
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {previewContent || l('无可显示内容', 'No preview available')}
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
            <HintPanel icon={<FileJson className="h-4 w-4" strokeWidth={1.8} />}>
              {l(
                '暂无关联 Zotero 笔记或 Markdown 文件。',
                'No related Zotero notes or Markdown files are available yet.',
              )}
            </HintPanel>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

type AnnotationsDrawerContentProps = {
  annotations: PaperAnnotation[];
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
};

function AnnotationsDrawerContent({
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onSelectAnnotation,
}: AnnotationsDrawerContentProps) {
  const l = useLocaleText();
  const [annotationDraft, setAnnotationDraft] = useState('');
  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => b.updatedAt - a.updatedAt),
    [annotations],
  );
  const canCreateAnnotation = annotationDraft.trim().length > 0;

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="space-y-3">
        <SectionCard
          title={l('批注草稿', 'Annotation Draft')}
          description={l(
            '将当前想法保存为结构化批注。',
            'Save the current idea as a structured annotation.',
          )}
          icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
        >
          <textarea
            value={annotationDraft}
            onChange={(event) => setAnnotationDraft(event.target.value)}
            placeholder={l('输入批注内容...', 'Write an annotation...')}
            className="min-h-[120px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!canCreateAnnotation) {
                  return;
                }
                onCreateAnnotation(annotationDraft.trim());
                setAnnotationDraft('');
              }}
              disabled={!canCreateAnnotation}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {l('添加批注', 'Add Annotation')}
            </button>
            <button
              type="button"
              onClick={() => setAnnotationDraft('')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {l('清空草稿', 'Clear Draft')}
            </button>
          </div>
        </SectionCard>

        {sortedAnnotations.length > 0 ? (
          sortedAnnotations.map((annotation) => (
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
                    {l(
                      `第 ${annotation.pageIndex + 1} 页 · ${annotation.blockType}`,
                      `Page ${annotation.pageIndex + 1} · ${annotation.blockType}`,
                    )}
                  </div>
                  <div className="mt-2 text-sm leading-7 text-slate-700">
                    {annotation.note || annotation.quote || l('无文本内容', 'No text content')}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteAnnotation(annotation.id)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={l('删除批注', 'Delete annotation')}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
            {l(
              '还没有批注。你可以先在左侧阅读区定位块，再记录批注。',
              'There are no annotations yet. Focus a block in the reader first, then add one here.',
            )}
          </HintPanel>
        )}
      </div>
    </div>
  );
}

function AssistantSidebar({
  activePanel,
  onActivePanelChange,
  panelWidth = 408,
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
  panelWidth?: number;
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
  const l = useLocaleText();
  const togglePanel = (panel: Exclude<AssistantPanelKey, null>) => {
    onActivePanelChange(activePanel === panel ? null : panel);
  };

  const activityItems = [
    {
      key: 'chat' as const,
      label: l('问答', 'Chat'),
      icon: MessageSquare,
      onClick: () => togglePanel('chat'),
    },
    {
      key: 'translate' as const,
      label: l('翻译', 'Translate'),
      icon: Languages,
      onClick: () => togglePanel('translate'),
    },
    {
      key: 'info' as const,
      label: l('信息', 'Info'),
      icon: Info,
      onClick: () => togglePanel('info'),
    },
    {
      key: 'notes' as const,
      label: l('笔记', 'Notes'),
      icon: FileText,
      onClick: () => togglePanel('notes'),
    },
    {
      key: 'annotations' as const,
      label: l('批注', 'Annotations'),
      icon: Quote,
      onClick: () => togglePanel('annotations'),
    },
  ];

  const panelTitle =
    activePanel === 'chat'
      ? l('文档问答', 'Document Chat')
      : activePanel === 'translate'
        ? l('划词翻译', 'Selection Translation')
        : activePanel === 'info'
          ? l('论文信息', 'Paper Info')
          : activePanel === 'notes'
            ? l('阅读笔记', 'Reading Notes')
            : activePanel === 'annotations'
              ? l('阅读批注', 'Reading Annotations')
          : '';
  const panelDescription =
    activePanel === 'chat'
      ? documentMeta || l('基于当前文档内容进行问答。', 'Ask questions grounded in the current document.')
      : activePanel === 'translate'
        ? l('在 PDF 中选中文本后翻译并复用。', 'Translate and reuse selected text from the PDF.')
        : activePanel === 'info'
          ? documentSource || l('查看论文元信息与处理状态。', 'Review paper metadata and processing status.')
          : activePanel === 'notes'
            ? l('记录工作区笔记并查看关联资料。', 'Capture workspace notes and review related materials.')
            : activePanel === 'annotations'
              ? l('管理绑定到文档块的阅读批注。', 'Manage reading annotations linked to document blocks.')
          : '';

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div
        className={cn(
          'overflow-hidden border-l border-slate-200 bg-slate-50/50 transition-[width] duration-300 ease-in-out',
          !activePanel && 'border-transparent',
        )}
        style={{ width: activePanel ? panelWidth : 0 }}
      >
        <div className="flex h-full flex-col" style={{ width: panelWidth, minWidth: panelWidth }}>
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{panelTitle}</div>
              <div className="mt-1 truncate text-xs text-slate-400">{panelDescription}</div>
            </div>
            <button
              type="button"
              onClick={() => onActivePanelChange(null)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
              aria-label={l('收起右侧面板', 'Collapse right sidebar')}
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
              />
            ) : null}

            {activePanel === 'notes' ? (
              <NotesDrawerContent
                activeBlockSummary={activeBlockSummary}
                workspaceNoteMarkdown={workspaceNoteMarkdown}
                zoteroRelatedNotes={zoteroRelatedNotes}
                zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
                zoteroRelatedNotesError={zoteroRelatedNotesError}
                selectedExcerpt={selectedExcerpt}
                onWorkspaceNoteChange={onWorkspaceNoteChange}
                onAppendSelectedExcerptToNote={onAppendSelectedExcerptToNote}
              />
            ) : null}

            {activePanel === 'annotations' ? (
              <AnnotationsDrawerContent
                annotations={annotations}
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
                title={item.label}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-xl transition',
                  active
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
                )}
              >
                {active ? (
                  <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-indigo-600" />
                ) : null}
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
              title={l('弹出独立窗口', 'Open Detached Window')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <ExternalLink className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onAttachBack ? (
            <button
              type="button"
              onClick={onAttachBack}
              title={l('停靠回侧边栏', 'Dock Back to Sidebar')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <PanelRightOpen className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onOpenPreferences ? (
            <button
              type="button"
              onClick={onOpenPreferences}
              title={l('设置', 'Settings')}
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

