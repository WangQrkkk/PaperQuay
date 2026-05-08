import { Component, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { Bot, Languages, Quote, Sparkles } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperSummary, SelectedExcerpt } from '../../types/reader';
import { cn } from '../../utils/cn';
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
      <div className="flex flex-col gap-4 border-b border-slate-200/70 px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {icon ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-semibold leading-5 text-slate-900">{title}</div>
              {description ? (
                <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
              ) : null}
            </div>
          </div>
        </div>
        {actions ? <div className="min-w-0 shrink-0 xl:max-w-[58%]">{actions}</div> : null}
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

function formatMarkdownError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || 'Unknown markdown render error');
}

class MarkdownRenderBoundary extends Component<
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

function MarkdownFallback({
  content,
  error,
}: {
  content: string;
  error?: string;
}) {
  const l = useLocaleText();

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
          {l('Markdown 预览暂时无法渲染，已切换为纯文本预览。', 'Markdown preview failed and fell back to plain text.')}
          <div className="mt-1 break-all opacity-80">{error}</div>
        </div>
      ) : null}
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
        {content}
      </pre>
    </div>
  );
}

function MarkdownPreview({
  content,
  className,
  normalizeMath = true,
  components,
}: {
  content: string;
  className?: string;
  normalizeMath?: boolean;
  components?: Components;
}) {
  const normalized = useMemo(() => {
    try {
      return {
        content: normalizeMath ? normalizeMarkdownMath(content) : content,
        error: '',
      };
    } catch (error) {
      return {
        content,
        error: formatMarkdownError(error),
      };
    }
  }, [content, normalizeMath]);

  if (normalized.error) {
    return <MarkdownFallback content={content} error={normalized.error} />;
  }

  const fallback = <MarkdownFallback content={content} />;

  return (
    <MarkdownRenderBoundary resetKey={normalized.content} fallback={fallback}>
      <ReactMarkdown
        className={cn(
          'max-w-none space-y-3 text-sm leading-7 text-slate-700',
          '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:border-b [&_h1]:border-slate-200 [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-slate-950',
          '[&_h2]:mb-2.5 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-slate-900',
          '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900',
          '[&_h4]:mb-1.5 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-800',
          '[&_p]:my-2 [&_p]:leading-7 [&_strong]:font-semibold [&_strong]:text-slate-950 [&_em]:text-slate-700',
          '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1',
          '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-200 [&_blockquote]:bg-indigo-50/60 [&_blockquote]:py-2 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:text-slate-600',
          '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-indigo-700',
          '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-100',
          '[&_a]:font-medium [&_a]:text-indigo-600 [&_a]:underline [&_a]:underline-offset-2',
          '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-xl [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2',
          '[&_hr]:my-5 [&_hr]:border-slate-200 [&_.katex]:text-slate-900 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2',
          className,
        )}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: true }]]}
        components={components}
      >
        {normalized.content}
      </ReactMarkdown>
    </MarkdownRenderBoundary>
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
      title={compact ? l('论文概览', 'Paper Overview') : l('AI 概览', 'AI Overview')}
      description={l(
        '根据当前文档内容生成结构化概览。',
        'Generate a structured overview from the current document.',
      )}
      icon={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}
      actions={
        <button
          type="button"
          data-tour="generate-summary"
          onClick={onGenerateSummary}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading
            ? l('生成中...', 'Generating...')
            : paperSummary
              ? l('刷新整篇概览', 'Regenerate')
              : l('生成概览', 'Generate Overview')}
        </button>
      }
      contentClassName="space-y-4"
    >
      {!paperSummary && !hasBlocks ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '请先加载 PDF 和对应的 MinerU JSON，再生成概览。',
            'Load the PDF and its MinerU JSON before generating an overview.',
          )}
        </HintPanel>
      ) : null}

      {!paperSummary && hasBlocks && !aiConfigured ? (
        <HintPanel icon={<Bot className="h-4 w-4" strokeWidth={1.8} />}>
          {l(
            '请先配置可用的 chat/completions 模型，然后再生成概览。',
            'Configure an available chat/completions model before generating an overview.',
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
              <StatusBadge tone="accent">{l('概览已生成', 'Overview Ready')}</StatusBadge>
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

export { HintPanel, MarkdownPreview, SectionCard, SelectionPanel, StatusBadge, SummaryPanel };
