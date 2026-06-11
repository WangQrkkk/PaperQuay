import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Languages,
  RefreshCw,
  SearchCode,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import EmptyState from '../../components/EmptyState';
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu';
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
  active?: boolean;
  translationBusy?: boolean;
  onBlockClick: (block: PositionedMineruBlock) => void;
  onRetranslateBlock?: (block: PositionedMineruBlock) => void;
  onTranslationDisplayModeChange?: (mode: TranslationDisplayMode) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
}

const CONTENT_MIN_SCALE = 0.85;
const CONTENT_MAX_SCALE = 1.45;
const CONTENT_SCALE_STEP = 0.05;
const INITIAL_RENDER_BLOCK_COUNT = 80;
const RENDER_BLOCK_BATCH_SIZE = 120;
const ACTIVE_BLOCK_RENDER_MARGIN = 24;

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

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
  const anchorClientRect =
    rangeRect.width > 0 && rangeRect.height > 0
      ? {
          left: rangeRect.left,
          top: rangeRect.top,
          width: rangeRect.width,
          height: rangeRect.height,
        }
      : undefined;

  return {
    text,
    anchorClientX,
    anchorClientY,
    anchorClientRect,
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

function requestDeferredRender(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 160 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 32);
  return () => window.clearTimeout(handle);
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
  active = true,
  translationBusy = false,
  onBlockClick,
  onRetranslateBlock,
  onTranslationDisplayModeChange,
  onTextSelect,
}: BlockViewerProps) {
  const l = useLocaleText();
  const visibleBlocks = useMemo(
    () => {
      const pageContentBlocks = blocks.filter((block) => !block.contentSourceBlockId);

      return hidePageDecorations
        ? pageContentBlocks.filter(
            (block) =>
              !['page_header', 'page_footer', 'page_number', 'page_footnote'].includes(
                block.type,
              ),
          )
        : pageContentBlocks;
    },
    [blocks, hidePageDecorations],
  );
  const [renderedBlockCount, setRenderedBlockCount] = useState(() =>
    Math.min(INITIAL_RENDER_BLOCK_COUNT, visibleBlocks.length),
  );
  const renderedVisibleBlocks = useMemo(
    () => visibleBlocks.slice(0, Math.min(renderedBlockCount, visibleBlocks.length)),
    [renderedBlockCount, visibleBlocks],
  );
  const renderableBlocks = useMemo(
    () => buildRenderableBlocks(renderedVisibleBlocks, mineruPath),
    [mineruPath, renderedVisibleBlocks],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    block: PositionedMineruBlock;
    x: number;
    y: number;
  } | null>(null);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const [contentScale, setContentScale] = useState(1);

  useEffect(() => {
    blockRefs.current = {};
    setRenderedBlockCount(Math.min(INITIAL_RENDER_BLOCK_COUNT, visibleBlocks.length));
  }, [visibleBlocks]);

  useEffect(() => {
    if (!active || renderedBlockCount >= visibleBlocks.length) {
      return undefined;
    }

    let cancelled = false;
    const cancelDeferredRender = requestDeferredRender(() => {
      if (cancelled) {
        return;
      }

      setRenderedBlockCount((current) =>
        Math.min(visibleBlocks.length, Math.max(current, current + RENDER_BLOCK_BATCH_SIZE)),
      );
    });

    return () => {
      cancelled = true;
      cancelDeferredRender();
    };
  }, [active, renderedBlockCount, visibleBlocks.length]);

  useEffect(() => {
    if (!activeBlockId) {
      return;
    }

    const activeBlockIndex = visibleBlocks.findIndex((block) => block.blockId === activeBlockId);

    if (activeBlockIndex < 0) {
      return;
    }

    const requiredCount = Math.min(
      visibleBlocks.length,
      activeBlockIndex + 1 + ACTIVE_BLOCK_RENDER_MARGIN,
    );

    setRenderedBlockCount((current) => (current >= requiredCount ? current : requiredCount));
  }, [activeBlockId, visibleBlocks]);

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
      label: l('原文 MinerU', 'Original MinerU'),
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
      label: l('双栏对照', 'Bilingual'),
      disabled: !hasAnyTranslations,
    },
  ];

  const updateContentScale = useCallback((delta: number) => {
    setContentScale((current) => clampContentScale(current + delta));
  }, []);

  const registerBlockRef = useCallback((blockId: string, element: HTMLDivElement | null) => {
    if (element) {
      blockRefs.current[blockId] = element;
      return;
    }

    delete blockRefs.current[blockId];
  }, []);

  const handleBlockContextMenu = useCallback(
    (block: PositionedMineruBlock, event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onRetranslateBlock || hasActiveTextSelection()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        block,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [onRetranslateBlock],
  );

  const contextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!contextMenu || !onRetranslateBlock) {
      return [];
    }

    return [
      {
        id: 'retranslate-block',
        label: translationBusy
          ? l('翻译进行中', 'Translation in progress')
          : l('重新翻译此块', 'Retranslate This Block'),
        icon: <RefreshCw className="h-4 w-4" strokeWidth={1.9} />,
        disabled: translationBusy,
        tone: 'accent',
        onSelect: () => onRetranslateBlock(contextMenu.block),
      },
    ];
  }, [contextMenu, l, onRetranslateBlock, translationBusy]);

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
    if (!active || !onTextSelect) {
      return;
    }

    clearSelectionCommitTimer();
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      emitSelectedText();
    }, delay);
  };

  useEffect(() => {
    if (!active || !activeBlockId) {
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
  }, [active, activeBlockId, renderedBlockCount, scrollSignal, smoothScroll]);

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      updateContentScale(event.deltaY < 0 ? CONTENT_SCALE_STEP : -CONTENT_SCALE_STEP);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active, updateContentScale]);

  useEffect(() => {
    if (!active || !onTextSelect) {
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
  }, [active, onTextSelect]);

  if (renderableBlocks.length === 0) {
    return (
      <EmptyState
        title={l('Waiting for Structured Content', 'Waiting for Structured Content')}
        description={l('After opening or loading a MinerU JSON file, this panel will show the paper block by block and stay geometrically linked to the PDF on the left.', 'After opening or loading a MinerU JSON file, this panel will show the paper block by block and stay geometrically linked to the PDF on the left.',
        )}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,#ffffff,#f8fafc_34%,#f5f5f4_100%)] text-slate-900 dark:bg-[var(--pq-bg-primary)] dark:text-[var(--pq-text)]"
      onMouseUp={active ? () => scheduleSelectionCommit() : undefined}
      onKeyUp={active ? () => scheduleSelectionCommit() : undefined}
    >
      <div className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-white/80 bg-white/72 px-3 py-2 shadow-[0_10px_22px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:shadow-none">
          <div className="flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 text-sm text-slate-600 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]">
            <SearchCode className="h-4 w-4 text-slate-400 dark:text-[var(--pq-text-faint)]" strokeWidth={1.8} />
            <span className="hidden sm:inline">{l('Structured Reading', 'Structured Reading')}</span>
          </div>

          <span className="pq-badge-neutral rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
            {l(`${visibleBlocks.length} 个块`, `${visibleBlocks.length} blocks`)}
          </span>
          <span className="pq-badge-state rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
            {l(`${translatedCount} 个译文块`, `${translatedCount} translated blocks`)}
          </span>

          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-xs text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]">
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
                      ? 'bg-slate-900 text-white dark:bg-[var(--pq-accent)] dark:text-[var(--pq-accent-text)]'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-3)]',
                    option.disabled &&
                      'cursor-not-allowed opacity-45 hover:bg-transparent dark:hover:bg-transparent',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1 text-sm text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]">
            <button
              type="button"
              onClick={() => updateContentScale(-CONTENT_SCALE_STEP)}
              className="rounded-full p-1.5 transition-all duration-200 hover:bg-slate-100 dark:hover:bg-[var(--pq-surface-3)]"
              aria-label={l('缩小正文', 'Zoom out content')}
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <span className="min-w-[54px] text-center text-sm font-medium text-slate-700 dark:text-[var(--pq-text)]">
              {Math.round(contentScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => updateContentScale(CONTENT_SCALE_STEP)}
              className="rounded-full p-1.5 transition-all duration-200 hover:bg-slate-100 dark:hover:bg-[var(--pq-surface-3)]"
              aria-label={l('放大正文', 'Zoom in content')}
            >
              <ZoomIn className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <span className="hidden rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-400 lg:inline dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-faint)]">
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
                onContextMenu={handleBlockContextMenu}
                registerRef={registerBlockRef}
              />
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-400 shadow-sm dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-faint)] dark:shadow-none">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {l(
                '左侧 PDF 与右侧结构块保持几何联动',
                'The PDF on the left stays geometrically linked with the structured blocks on the right',
              )}
            </div>
          </div>
        </article>
      </div>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={l(
            `第 ${contextMenu.block.pageIndex + 1} 页 · 块 ${contextMenu.block.blockIndex + 1}`,
            `Page ${contextMenu.block.pageIndex + 1} · Block ${contextMenu.block.blockIndex + 1}`,
          )}
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default memo(BlockViewer);

