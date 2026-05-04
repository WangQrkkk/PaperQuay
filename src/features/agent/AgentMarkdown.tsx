import { Component, type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { normalizeMarkdownMath } from '../../utils/markdown';

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

export default function AgentMarkdown({ content }: { content: string }) {
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
