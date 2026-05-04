import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Languages,
  SearchCode,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import EmptyState from '../../components/EmptyState';
import { useLocaleText } from '../../i18n/uiLanguage';
import { buildRenderableBlocks } from '../../services/mineru';
import type {
  PositionedMineruBlock,
  TextSelectionPayload,
  TranslationDisplayMode,
  TranslationMap,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { normalizeSelectionText } from '../../utils/text';
import { BlockItem } from './blockViewerContent';

interface BlockViewerProps {
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  translations: TranslationMap;
  translationDisplayMode: TranslationDisplayMode;
  translationLanguageLabel: string;
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  scrollSignal: number;
  compactMode: boolean;
  showBlockMeta: boolean;
  hidePageDecorations?: boolean;
  smoothScroll: boolean;
  onBlockClick: (block: PositionedMineruBlock) => void;
  onTranslationDisplayModeChange?: (mode: TranslationDisplayMode) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
}

const CONTENT_MIN_SCALE = 0.85;
const CONTENT_MAX_SCALE = 1.45;
const CONTENT_SCALE_STEP = 0.05;

function clampContentScale(nextScale: number) {
  return Math.min(CONTENT_MAX_SCALE, Math.max(CONTENT_MIN_SCALE, Number(nextScale.toFixed(2))));
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
  const anchorClientX =
    rangeRect.width > 0 ? rangeRect.left + rangeRect.width / 2 : rangeRect.left;
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

function BlockViewer({
  blocks,
  mineruPath,
  translations,
  translationDisplayMode,
  translationLanguageLabel,
  activeBlockId,
  hoveredBlockId,
  scrollSignal,
  compactMode,
  showBlockMeta,
  hidePageDecorations = false,
  smoothScroll,
  onBlockClick,
  onTranslationDisplayModeChange,
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
  const hasAnyTranslations = translatedCount > 0;
  const activeDisplayMode = hasAnyTranslations ? translationDisplayMode : 'original';
  const displayModeOptions: Array<{
    mode: TranslationDisplayMode;
    label: string;
    disabled?: boolean;
  }> = [
    {
      mode: 'original',
      label: l('原始 MinerU', 'Original MinerU'),
    },
    {
      mode: 'translated',
      label: l(
        `译文 · ${translationLanguageLabel}`,
        `Translation · ${translationLanguageLabel}`,
      ),
      disabled: !hasAnyTranslations,
    },
    {
      mode: 'bilingual',
      label: l('双语对照', 'Bilingual'),
      disabled: !hasAnyTranslations,
    },
  ];

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

          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-xs text-slate-600 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-300">
            {displayModeOptions.map((option) => {
              const selected = option.mode === activeDisplayMode;

              return (
                <button
                  key={option.mode}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => onTranslationDisplayModeChange?.(option.mode)}
                  className={cn(
                    'rounded-full px-3 py-1.5 font-medium transition-all duration-200',
                    selected
                      ? 'bg-slate-900 text-white dark:bg-chrome-100 dark:text-chrome-900'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-chrome-300 dark:hover:bg-chrome-600',
                    option.disabled &&
                      'cursor-not-allowed opacity-45 hover:bg-transparent dark:hover:bg-transparent',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

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
            {l(
              '点击块可反向定位到 PDF 几何区域',
              'Click a block to jump back to the PDF geometry region',
            )}
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
              {l(
                '左侧 PDF 与右侧结构块保持几何联动',
                'The PDF on the left stays geometrically linked with the structured blocks on the right',
              )}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

export default memo(BlockViewer);
