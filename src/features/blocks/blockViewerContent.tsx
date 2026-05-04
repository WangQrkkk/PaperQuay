import {
  Expand,
  ImageIcon,
  Languages,
  Table2,
} from 'lucide-react';
import katex from 'katex';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import { useLocaleText } from '../../i18n/uiLanguage';
import { loadLocalAssetDataUrl } from '../../services/assets';
import { renderListMarkdownContent } from '../../services/mineru';
import type {
  PositionedMineruBlock,
  RenderableMineruBlock,
  TranslationDisplayMode,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import {
  normalizeMarkdownMath,
  normalizeRawLatexExpression,
} from '../../utils/markdown';
import { sanitizeMineruTableHtml } from '../../utils/safeHtml';

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function useMineruAssetDataUrl(assetPath?: string) {
  const l = useLocaleText();
  const [dataUrl, setDataUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assetPath) {
      setDataUrl('');
      setLoading(false);
      setError('');
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError('');

    void loadLocalAssetDataUrl(assetPath)
      .then((nextDataUrl) => {
        if (cancelled) {
          return;
        }

        setDataUrl(nextDataUrl);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setDataUrl('');
        setError(
          nextError instanceof Error
            ? nextError.message
            : l('加载资源失败', 'Failed to load asset'),
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assetPath, l]);

  return {
    dataUrl,
    loading,
    error,
  };
}

function EquationContent({
  latex,
  scale,
}: {
  latex: string;
  scale: number;
}) {
  const normalizedLatex = useMemo(() => {
    const mathFenceMatch = latex.trim().match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
    const rawLatex = mathFenceMatch?.[1] ?? latex;

    return normalizeRawLatexExpression(rawLatex);
  }, [latex]);

  const renderedEquation = useMemo(() => {
    try {
      return {
        html: katex.renderToString(normalizedLatex, {
          displayMode: true,
          throwOnError: true,
          strict: 'ignore',
          trust: false,
        }),
        error: '',
      };
    } catch (error) {
      return {
        html: '',
        error: error instanceof Error ? error.message : 'KaTeX render failed',
      };
    }
  }, [normalizedLatex]);

  if (!renderedEquation.html) {
    return (
      <div className="my-1 overflow-x-auto rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-400/30 dark:bg-rose-950/20 dark:text-rose-200">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
          Formula parse failed
        </div>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed">
          {normalizedLatex || latex}
        </pre>
        <div className="mt-2 text-xs opacity-80">{renderedEquation.error}</div>
      </div>
    );
  }

  return (
    <div
      className="my-1 overflow-x-auto overflow-y-hidden rounded-xl bg-white/70 px-3 py-2 text-slate-900 dark:bg-chrome-900/40 dark:text-chrome-100 [&_.katex-display]:my-0 [&_.katex]:text-slate-900 dark:[&_.katex]:text-chrome-100"
      style={{ fontSize: `${15 * scale}px` }}
      dangerouslySetInnerHTML={{ __html: renderedEquation.html }}
    />
  );
}

function MarkdownContent({
  markdown,
  scale,
}: {
  markdown: string;
  scale: number;
}) {
  const normalizedMarkdown = useMemo(() => normalizeMarkdownMath(markdown), [markdown]);
  const bodyStyle = {
    fontSize: `${15 * scale}px`,
    lineHeight: `${31 * scale}px`,
  };

  return (
    <ReactMarkdown
      className="prose prose-slate max-w-none prose-headings:tracking-tight prose-a:text-indigo-600 prose-strong:text-slate-900 dark:prose-invert dark:prose-strong:text-chrome-100 [&_.katex]:text-slate-900 dark:[&_.katex]:text-chrome-100 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false }]]}
      components={{
        p: ({ children }) => (
          <p
            className="my-0 text-slate-700 dark:text-chrome-200 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden"
            style={bodyStyle}
          >
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul
            className="my-0 list-disc space-y-2 pl-6 text-slate-700 dark:text-chrome-200"
            style={bodyStyle}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            className="my-0 list-decimal space-y-2 pl-6 text-slate-700 dark:text-chrome-200"
            style={bodyStyle}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-slate-700" style={bodyStyle}>
            {children}
          </li>
        ),
        h1: ({ children }) => (
          <h1
            className="my-0 font-semibold text-slate-950 dark:text-chrome-100"
            style={{
              fontSize: `${30 * scale}px`,
              lineHeight: `${40 * scale}px`,
            }}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            className="my-0 font-semibold text-slate-950 dark:text-chrome-100"
            style={{
              fontSize: `${25 * scale}px`,
              lineHeight: `${36 * scale}px`,
            }}
          >
            {children}
          </h2>
        ),
        blockquote: ({ children }) => (
          <blockquote
            className="my-0 border-l-2 border-slate-200 pl-4 italic text-slate-600 dark:border-chrome-700 dark:text-chrome-300"
            style={bodyStyle}
          >
            {children}
          </blockquote>
        ),
      }}
    >
      {normalizedMarkdown}
    </ReactMarkdown>
  );
}

function AssetFigure({
  assetPath,
  label,
  emptyText,
  emptyIcon,
  scale,
}: {
  assetPath?: string;
  label: string;
  emptyText: string;
  emptyIcon: ReactNode;
  scale: number;
}) {
  const l = useLocaleText();
  const { dataUrl, loading, error } = useMineruAssetDataUrl(assetPath);
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        {dataUrl ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className="group relative block w-full overflow-hidden bg-slate-50"
          >
            <img src={dataUrl} alt={label} className="max-h-[420px] w-full object-contain" />
            <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center rounded-full bg-slate-950/70 px-2.5 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Expand className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.9} />
              {l('放大', 'Zoom')}
            </span>
          </button>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-slate-500"
            style={{ minHeight: `${180 * scale}px` }}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
              {emptyIcon}
            </span>
            <div className="text-sm">
              {loading ? l('正在加载资源…', 'Loading asset...') : emptyText}
            </div>
            {error ? (
              <div className="max-w-[320px] text-center text-xs text-rose-500">{error}</div>
            ) : null}
          </div>
        )}
      </div>

      {previewOpen && dataUrl ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/76 p-6 backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation();
            setPreviewOpen(false);
          }}
        >
          <div
            className="max-h-full max-w-[min(1200px,100vw-48px)] overflow-hidden rounded-[28px] border border-white/15 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3">
              <div className="truncate text-sm font-medium text-slate-700">{label}</div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                {l('关闭', 'Close')}
              </button>
            </div>
            <div className="max-h-[calc(100vh-140px)] overflow-auto bg-slate-50 p-4">
              <img src={dataUrl} alt={label} className="mx-auto h-auto max-w-full object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TableContent({
  assetPath,
  captionText,
  tableHtml,
  fallbackMarkdown,
  translatedText,
  showTranslatedOnly,
  showBilingual,
  scale,
}: {
  assetPath?: string;
  captionText?: string;
  tableHtml?: string;
  fallbackMarkdown: string;
  translatedText?: string;
  showTranslatedOnly: boolean;
  showBilingual: boolean;
  scale: number;
}) {
  const l = useLocaleText();
  const sanitizedTableHtml = useMemo(
    () => (tableHtml ? sanitizeMineruTableHtml(tableHtml) : ''),
    [tableHtml],
  );

  return (
    <div className="space-y-4">
      <AssetFigure
        assetPath={assetPath}
        label={captionText || l('表格截图', 'Table Snapshot')}
        emptyText={l('没有找到对应的表格截图', 'No matching table snapshot was found')}
        emptyIcon={<Table2 className="h-7 w-7" strokeWidth={1.8} />}
        scale={scale}
      />

      {showTranslatedOnly ? (
        <MarkdownContent markdown={translatedText || fallbackMarkdown} scale={scale} />
      ) : (
        <>
          {captionText ? (
            <div
              className="font-medium leading-6 text-slate-600"
              style={{
                fontSize: `${14 * scale}px`,
                lineHeight: `${24 * scale}px`,
              }}
            >
              {captionText}
            </div>
          ) : null}

          {sanitizedTableHtml ? (
            <div className="overflow-auto rounded-[20px] border border-slate-200/80 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-chrome-700/80 dark:bg-chrome-800 dark:shadow-[0_10px_24px_rgba(0,0,0,0.18)]">
              <div
                className="mineru-table min-w-max p-4"
                style={{ fontSize: `${14 * scale}px` }}
                dangerouslySetInnerHTML={{ __html: sanitizedTableHtml }}
              />
            </div>
          ) : (
            <MarkdownContent markdown={fallbackMarkdown} scale={scale} />
          )}

          {showBilingual && translatedText ? (
            <div className="rounded-[18px] border border-indigo-100 bg-indigo-50/70 px-4 py-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
                <Languages className="h-3.5 w-3.5" strokeWidth={1.9} />
                {l('译文', 'Translation')}
              </div>
              <MarkdownContent markdown={translatedText} scale={scale} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ImageContent({
  assetPath,
  captionText,
  fallbackMarkdown,
  translatedText,
  showTranslatedOnly,
  showBilingual,
  scale,
}: {
  assetPath?: string;
  captionText?: string;
  fallbackMarkdown: string;
  translatedText?: string;
  showTranslatedOnly: boolean;
  showBilingual: boolean;
  scale: number;
}) {
  const l = useLocaleText();

  return (
    <div className="space-y-4">
      <AssetFigure
        assetPath={assetPath}
        label={captionText || l('图片截图', 'Image Snapshot')}
        emptyText={l('没有找到对应的图片资源', 'No matching image asset was found')}
        emptyIcon={<ImageIcon className="h-7 w-7" strokeWidth={1.8} />}
        scale={scale}
      />

      <MarkdownContent
        markdown={showTranslatedOnly ? translatedText || fallbackMarkdown : fallbackMarkdown}
        scale={scale}
      />

      {showBilingual && translatedText ? (
        <div className="rounded-[18px] border border-indigo-100 bg-indigo-50/70 px-4 py-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">
            <Languages className="h-3.5 w-3.5" strokeWidth={1.9} />
            {l('译文', 'Translation')}
          </div>
          <MarkdownContent markdown={translatedText} scale={scale} />
        </div>
      ) : null}
    </div>
  );
}

export function BlockItem({
  renderable,
  active,
  hovered,
  flashing,
  scale,
  showBlockMeta,
  compactMode,
  translatedText,
  translationDisplayMode,
  onClick,
  registerRef,
}: {
  renderable: RenderableMineruBlock;
  active: boolean;
  hovered: boolean;
  flashing: boolean;
  scale: number;
  showBlockMeta: boolean;
  compactMode: boolean;
  translatedText?: string;
  translationDisplayMode: TranslationDisplayMode;
  onClick: (block: PositionedMineruBlock) => void;
  registerRef: (element: HTMLDivElement | null) => void;
}) {
  const l = useLocaleText();
  const { block, markdown, mathText, plainText, tableHtml, captionText, assetPath } = renderable;
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const hasTranslation = Boolean(translatedText?.trim());
  const showTranslatedOnly = hasTranslation && translationDisplayMode === 'translated';
  const showBilingual = hasTranslation && translationDisplayMode === 'bilingual';
  const effectiveMarkdown = showTranslatedOnly ? translatedText || markdown : markdown;
  const effectivePlainText = showTranslatedOnly ? translatedText || plainText : plainText;
  const displayMarkdown =
    block.type === 'list'
      ? renderListMarkdownContent(effectiveMarkdown || effectivePlainText || markdown)
      : effectiveMarkdown;
  const displayTranslatedMarkdown =
    block.type === 'list' && translatedText
      ? renderListMarkdownContent(translatedText)
      : translatedText;

  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
    },
    [],
  );

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const pointerStart = pointerStartRef.current;
    pointerStartRef.current = null;

    if (pointerStart) {
      const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);

      if (movement > 4) {
        return;
      }
    }

    if (hasActiveTextSelection()) {
      return;
    }

    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }

    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;

      if (hasActiveTextSelection()) {
        return;
      }

      onClick(block);
    }, 48);
  };

  const metaScale = Math.min(scale, 1.1);

  return (
    <div
      ref={registerRef}
      data-block-id={block.blockId}
      onPointerDown={(event) => {
        pointerStartRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onClick={handleClick}
      className={cn(
        'group relative cursor-text select-text rounded-[18px] border border-transparent transition-all duration-200',
        compactMode ? 'px-3 py-2' : 'px-5 py-3',
        active &&
          'bg-white shadow-[0_18px_40px_rgba(79,70,229,0.09)] dark:bg-chrome-800 dark:shadow-[0_18px_40px_rgba(79,70,229,0.12)]',
        hovered && !active && 'bg-slate-100/70 dark:bg-chrome-700/60',
        flashing && 'ring-2 ring-indigo-200/80',
      )}
    >
      <div
        className={cn(
          'absolute bottom-2 left-0 top-2 w-1 rounded-full bg-transparent transition-all duration-200',
          active && 'bg-indigo-500',
          hovered && !active && 'bg-slate-300',
        )}
      />

      {active && showBlockMeta ? (
        <div
          className="mb-3 flex items-center justify-between text-indigo-500"
          style={{
            fontSize: `${11 * metaScale}px`,
            lineHeight: `${16 * metaScale}px`,
          }}
        >
          <span className="font-semibold uppercase tracking-[0.18em]">{block.type}</span>
          <span>
            {l(
              `第 ${block.pageIndex + 1} 页 · 块 ${block.blockIndex + 1}`,
              `Page ${block.pageIndex + 1} · Block ${block.blockIndex + 1}`,
            )}
          </span>
        </div>
      ) : null}

      {block.type === 'title' ? (
        <div className={cn('first:mt-0', compactMode ? 'mt-2' : 'mt-4')}>
          <MarkdownContent
            markdown={
              effectiveMarkdown ||
              `## ${effectivePlainText || l('未命名标题', 'Untitled Heading')}`
            }
            scale={scale}
          />
        </div>
      ) : null}

      {block.type === 'image' ? (
        <ImageContent
          assetPath={assetPath}
          captionText={captionText}
          fallbackMarkdown={markdown}
          translatedText={translatedText}
          showTranslatedOnly={showTranslatedOnly}
          showBilingual={showBilingual}
          scale={scale}
        />
      ) : null}

      {block.type === 'table' ? (
        <TableContent
          assetPath={assetPath}
          captionText={captionText}
          tableHtml={tableHtml}
          fallbackMarkdown={markdown}
          translatedText={translatedText}
          showTranslatedOnly={showTranslatedOnly}
          showBilingual={showBilingual}
          scale={scale}
        />
      ) : null}

      {!['title', 'image', 'table'].includes(block.type) ? (
        <>
          {block.type === 'equation' ? (
            <EquationContent latex={mathText || markdown} scale={scale} />
          ) : (
            <MarkdownContent markdown={displayMarkdown} scale={scale} />
          )}

          {showBilingual && translatedText && block.type !== 'equation' ? (
            <div className="mt-4 rounded-[18px] border border-indigo-100 bg-indigo-50/70 px-4 py-3 dark:border-white/10 dark:bg-chrome-800">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-[#b8c2d9]">
                <Languages className="h-3.5 w-3.5" strokeWidth={1.9} />
                {l('译文', 'Translation')}
              </div>
              <MarkdownContent markdown={displayTranslatedMarkdown || ''} scale={scale} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
