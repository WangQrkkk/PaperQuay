import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Expand,
  ImageIcon,
  Languages,
  SearchCode,
  Sparkles,
  Table2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import EmptyState from '../../components/EmptyState';
import { loadLocalAssetDataUrl } from '../../services/assets';
import { buildRenderableBlocks, renderListMarkdownContent } from '../../services/mineru';
import type {
  PositionedMineruBlock,
  RenderableMineruBlock,
  TextSelectionPayload,
  TranslationDisplayMode,
  TranslationMap,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { normalizeMarkdownMath, normalizeRawLatexExpression } from '../../utils/markdown';
import { sanitizeMineruTableHtml } from '../../utils/safeHtml';
import { normalizeSelectionText } from '../../utils/text';

interface BlockViewerProps {
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  translations: TranslationMap;
  translationDisplayMode: TranslationDisplayMode;
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  scrollSignal: number;
  compactMode: boolean;
  showBlockMeta: boolean;
  hidePageDecorations?: boolean;
  smoothScroll: boolean;
  onBlockClick: (block: PositionedMineruBlock) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
}

const CONTENT_MIN_SCALE = 0.85;
const CONTENT_MAX_SCALE = 1.45;
const CONTENT_SCALE_STEP = 0.05;

function clampContentScale(nextScale: number) {
  return Math.min(CONTENT_MAX_SCALE, Math.max(CONTENT_MIN_SCALE, Number(nextScale.toFixed(2))));
}

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function getScopedSelectionPayload(container: HTMLElement | null): TextSelectionPayload | null {
  const selection = window.getSelection();

  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = normalizeSelectionText(selection.toString());

  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const targetNode =
    commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentElement : commonAncestor;

  if (!targetNode || !container.contains(targetNode)) {
    return null;
  }

  const rangeRect = range.getBoundingClientRect();
  const anchorClientX = rangeRect.width > 0 ? rangeRect.left + rangeRect.width / 2 : rangeRect.left;
  const anchorClientY = rangeRect.bottom;

  return {
    text,
    anchorClientX,
    anchorClientY,
    placement: 'bottom',
  };
}

function selectionBelongsToContainer(container: HTMLElement | null) {
  const selection = window.getSelection();

  if (!container || !selection) {
    return false;
  }

  if (
    (selection.anchorNode && container.contains(selection.anchorNode)) ||
    (selection.focusNode && container.contains(selection.focusNode))
  ) {
    return true;
  }

  if (selection.rangeCount === 0) {
    return false;
  }

  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
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
        setError(nextError instanceof Error ? nextError.message : l('加载资源失败', 'Failed to load asset'));
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
  }, [assetPath]);

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
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]">Formula parse failed</div>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed">{normalizedLatex || latex}</pre>
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
          <ul className="my-0 list-disc space-y-2 pl-6 text-slate-700 dark:text-chrome-200" style={bodyStyle}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-0 list-decimal space-y-2 pl-6 text-slate-700 dark:text-chrome-200" style={bodyStyle}>
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
            className="my-0 border-l-2 border-slate-200 dark:border-chrome-700 pl-4 italic text-slate-600 dark:text-chrome-300"
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
  emptyIcon: React.ReactNode;
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
            style={{
              minHeight: `${180 * scale}px`,
            }}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
              {emptyIcon}
            </span>
            <div className="text-sm">{loading ? l('正在加载资源…', 'Loading asset...') : emptyText}</div>
            {error ? <div className="max-w-[320px] text-center text-xs text-rose-500">{error}</div> : null}
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

function BlockItem({
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
        active && 'bg-white shadow-[0_18px_40px_rgba(79,70,229,0.09)] dark:bg-chrome-800 dark:shadow-[0_18px_40px_rgba(79,70,229,0.12)]',
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
            markdown={effectiveMarkdown || `## ${effectivePlainText || l('未命名标题', 'Untitled Heading')}`}
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

function BlockViewer({
  blocks,
  mineruPath,
  translations,
  translationDisplayMode,
  activeBlockId,
  hoveredBlockId,
  scrollSignal,
  compactMode,
  showBlockMeta,
  hidePageDecorations = false,
  smoothScroll,
  onBlockClick,
  onTextSelect,
}: BlockViewerProps) {
  const l = useLocaleText();
  const visibleBlocks = useMemo(
    () =>
      hidePageDecorations
        ? blocks.filter(
            (block) =>
              !['page_header', 'page_footer', 'page_number', 'page_footnote'].includes(
                block.type,
              ),
          )
        : blocks,
    [blocks, hidePageDecorations],
  );
  const renderableBlocks = useMemo(
    () => buildRenderableBlocks(visibleBlocks, mineruPath),
    [mineruPath, visibleBlocks],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const [contentScale, setContentScale] = useState(1);

  const translatedCount = useMemo(
    () => Object.values(translations).filter((value) => value.trim()).length,
    [translations],
  );

  const updateContentScale = (delta: number) => {
    setContentScale((current) => clampContentScale(current + delta));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    updateContentScale(event.deltaY < 0 ? CONTENT_SCALE_STEP : -CONTENT_SCALE_STEP);
  };

  const emitSelectedText = () => {
    if (!onTextSelect) {
      return;
    }

    window.requestAnimationFrame(() => {
      const selection = getScopedSelectionPayload(containerRef.current);

      if (!selection) {
        lastSelectionRef.current = null;
        return;
      }

      const now = Date.now();

      if (
        lastSelectionRef.current &&
        lastSelectionRef.current.text === selection.text &&
        now - lastSelectionRef.current.emittedAt < 250
      ) {
        return;
      }

      lastSelectionRef.current = {
        text: selection.text,
        emittedAt: now,
      };
      onTextSelect(selection);
    });
  };

  const clearSelectionCommitTimer = () => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
      selectionCommitTimerRef.current = null;
    }
  };

  const scheduleSelectionCommit = (delay = 48) => {
    if (!onTextSelect) {
      return;
    }

    clearSelectionCommitTimer();
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      emitSelectedText();
    }, delay);
  };

  useEffect(() => {
    if (!activeBlockId) {
      return undefined;
    }

    blockRefs.current[activeBlockId]?.scrollIntoView({
      behavior: smoothScroll ? 'smooth' : 'auto',
      block: 'center',
    });

    setFlashBlockId(activeBlockId);

    const timer = window.setTimeout(() => {
      setFlashBlockId((current) => (current === activeBlockId ? null : current));
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [activeBlockId, scrollSignal, smoothScroll]);

  useEffect(() => {
    if (!onTextSelect) {
      return undefined;
    }

    const isEventInsideContainer = (event: Event) => {
      const container = containerRef.current;
      const target = event.target;

      return Boolean(container && target instanceof Node && container.contains(target));
    };

    const handleSelectionStart = (event: MouseEvent | PointerEvent) => {
      selectionStartedInsideRef.current = isEventInsideContainer(event);
    };

    const handleMouseSelectionCommit = (event: MouseEvent) => {
      const shouldReadSelection =
        selectionStartedInsideRef.current || isEventInsideContainer(event);

      selectionStartedInsideRef.current = false;

      if (!shouldReadSelection) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleKeyboardSelectionCommit = (event: KeyboardEvent) => {
      if (!isEventInsideContainer(event)) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleSelectionChange = () => {
      const selectionInside = selectionBelongsToContainer(containerRef.current);

      if (!selectionStartedInsideRef.current && !selectionInside) {
        return;
      }
    };

    document.addEventListener('pointerdown', handleSelectionStart);
    document.addEventListener('mousedown', handleSelectionStart);
    document.addEventListener('mouseup', handleMouseSelectionCommit);
    document.addEventListener('keyup', handleKeyboardSelectionCommit);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      clearSelectionCommitTimer();
      document.removeEventListener('pointerdown', handleSelectionStart);
      document.removeEventListener('mousedown', handleSelectionStart);
      document.removeEventListener('mouseup', handleMouseSelectionCommit);
      document.removeEventListener('keyup', handleKeyboardSelectionCommit);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [onTextSelect]);

  if (renderableBlocks.length === 0) {
    return (
      <EmptyState
        title={l('等待结构化内容', 'Waiting for Structured Content')}
        description={l(
          '打开或加载 MinerU JSON 后，这里会按块展示论文内容，并保持与左侧 PDF 的几何联动。',
          'After opening or loading a MinerU JSON file, this panel will show the paper block by block and stay geometrically linked to the PDF on the left.',
        )}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,#ffffff,#f8fafc_34%,#f4f7fb_100%)] text-slate-900 dark:bg-chrome-950 dark:text-chrome-100"
      onWheel={handleWheel}
      onMouseUp={() => scheduleSelectionCommit()}
      onKeyUp={() => scheduleSelectionCommit()}
    >
      <div className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-white/80 bg-white/72 px-3 py-2 shadow-[0_10px_22px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-chrome-800 dark:shadow-none">
          <div className="flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 text-sm text-slate-600 dark:bg-chrome-700 dark:text-chrome-300">
            <SearchCode className="h-4 w-4 text-slate-400 dark:text-chrome-400" strokeWidth={1.8} />
            <span className="hidden sm:inline">{l('结构化阅读', 'Structured Reading')}</span>
          </div>

          <span className="pq-badge-neutral rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
            {l(`${renderableBlocks.length} 个块`, `${renderableBlocks.length} blocks`)}
          </span>
          <span className="pq-badge-state rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
            {l(`${translatedCount} 个译文块`, `${translatedCount} translated blocks`)}
          </span>

          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1 text-sm text-slate-600 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-300">
            <button
              type="button"
              onClick={() => updateContentScale(-CONTENT_SCALE_STEP)}
              className="rounded-full p-1.5 transition-all duration-200 hover:bg-slate-100 dark:hover:bg-chrome-600"
              aria-label={l('缩小正文', 'Zoom out content')}
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <span className="min-w-[54px] text-center text-sm font-medium text-slate-700 dark:text-chrome-100">
              {Math.round(contentScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => updateContentScale(CONTENT_SCALE_STEP)}
              className="rounded-full p-1.5 transition-all duration-200 hover:bg-slate-100 dark:hover:bg-chrome-600"
              aria-label={l('放大正文', 'Zoom in content')}
            >
              <ZoomIn className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <span className="hidden rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-400 lg:inline dark:bg-chrome-700 dark:text-chrome-400">
            {l('点击块可反向定位到 PDF 几何区域', 'Click a block to jump back to the PDF geometry region')}
          </span>
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', compactMode ? 'px-6 py-6' : 'px-8 py-8')}>
        <article className={cn('mx-auto max-w-[960px]', compactMode ? 'pb-12' : 'pb-16')}>
          <div className="space-y-1">
            {renderableBlocks.map((renderable) => (
              <BlockItem
                key={renderable.block.blockId}
                renderable={renderable}
                active={renderable.block.blockId === activeBlockId}
                hovered={renderable.block.blockId === hoveredBlockId}
                flashing={renderable.block.blockId === flashBlockId}
                scale={contentScale}
                showBlockMeta={showBlockMeta}
                compactMode={compactMode}
                translatedText={translations[renderable.block.blockId]}
                translationDisplayMode={translationDisplayMode}
                onClick={onBlockClick}
                registerRef={(element) => {
                  blockRefs.current[renderable.block.blockId] = element;
                }}
              />
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-400 shadow-sm dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-400 dark:shadow-none">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {l('左侧 PDF 与右侧结构块保持几何联动', 'The PDF on the left stays geometrically linked with the structured blocks on the right')}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

export default memo(BlockViewer);
