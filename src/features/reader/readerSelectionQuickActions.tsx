import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { ClientAnchorRect, SelectedExcerpt } from '../../types/reader';
import { MarkdownPreview } from './assistantSidebarPrimitives';

function clampSelectionPopoverPosition(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

const POPOVER_VIEWPORT_MARGIN = 16;
const POPOVER_ANCHOR_GAP = 12;
const FALLBACK_POPOVER_WIDTH = 360;
const FALLBACK_POPOVER_HEIGHT = 260;

function getRectOverlapArea(
  left: number,
  top: number,
  width: number,
  height: number,
  anchorRect: ClientAnchorRect,
) {
  const overlapWidth = Math.max(
    0,
    Math.min(left + width, anchorRect.left + anchorRect.width) - Math.max(left, anchorRect.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(top + height, anchorRect.top + anchorRect.height) - Math.max(top, anchorRect.top),
  );

  return overlapWidth * overlapHeight;
}

function resolveAnchorRectPopoverPosition({
  anchorRect,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
}: {
  anchorRect: ClientAnchorRect;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const viewportMinLeft = POPOVER_VIEWPORT_MARGIN;
  const viewportMinTop = POPOVER_VIEWPORT_MARGIN;
  const viewportMaxLeft = viewportWidth - POPOVER_VIEWPORT_MARGIN - panelWidth;
  const viewportMaxTop = viewportHeight - POPOVER_VIEWPORT_MARGIN - panelHeight;
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const candidates = [
    {
      priority: 0,
      left: anchorRect.left + anchorRect.width + POPOVER_ANCHOR_GAP,
      top: anchorCenterY - panelHeight / 2,
    },
    {
      priority: 1,
      left: anchorRect.left - panelWidth - POPOVER_ANCHOR_GAP,
      top: anchorCenterY - panelHeight / 2,
    },
    {
      priority: 2,
      left: anchorCenterX - panelWidth / 2,
      top: anchorRect.top + anchorRect.height + POPOVER_ANCHOR_GAP,
    },
    {
      priority: 3,
      left: anchorCenterX - panelWidth / 2,
      top: anchorRect.top - panelHeight - POPOVER_ANCHOR_GAP,
    },
  ].map((candidate) => {
    const left = clampSelectionPopoverPosition(candidate.left, viewportMinLeft, viewportMaxLeft);
    const top = clampSelectionPopoverPosition(candidate.top, viewportMinTop, viewportMaxTop);

    return {
      ...candidate,
      left,
      top,
      overlapArea: getRectOverlapArea(left, top, panelWidth, panelHeight, anchorRect),
      clampDistance: Math.abs(left - candidate.left) + Math.abs(top - candidate.top),
    };
  });

  candidates.sort((left, right) => {
    if (left.overlapArea !== right.overlapArea) {
      return left.overlapArea - right.overlapArea;
    }

    if (left.clampDistance !== right.clampDistance) {
      return left.clampDistance - right.clampDistance;
    }

    return left.priority - right.priority;
  });

  return {
    left: candidates[0]?.left ?? viewportMinLeft,
    top: candidates[0]?.top ?? viewportMinTop,
  };
}

export interface SelectionQuickActionsProps {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  autoTranslateSelection: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onAddSelectionToNote: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
}

export function SelectionQuickActions({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  autoTranslateSelection,
  onAppendSelectedExcerptToQa,
  onAddSelectionToNote,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: SelectionQuickActionsProps) {
  const l = useLocaleText();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverSize, setPopoverSize] = useState({
    width: FALLBACK_POPOVER_WIDTH,
    height: FALLBACK_POPOVER_HEIGHT,
  });

  useEffect(() => {
    if (!selectedExcerpt) {
      return undefined;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if ((event as MouseEvent & { paperQuayPdfBlockSelectClick?: boolean }).paperQuayPdfBlockSelectClick) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef.current?.contains(target)) {
        return;
      }

      if (
        selectedExcerpt.origin === 'pdf-block' &&
        target instanceof Element &&
        target.closest('.paperquay-pdf-linked')
      ) {
        return;
      }

      if (window.getSelection()?.toString().trim()) {
        return;
      }

      onClearSelectedExcerpt();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClearSelectedExcerpt();
      }
    };

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClearSelectedExcerpt, selectedExcerpt]);

  useLayoutEffect(() => {
    if (!selectedExcerpt || !popoverRef.current) {
      return undefined;
    }

    const updatePopoverSize = () => {
      const rect = popoverRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const nextWidth = Math.ceil(rect.width);
      const nextHeight = Math.ceil(rect.height);

      setPopoverSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : {
              width: nextWidth,
              height: nextHeight,
            },
      );
    };

    updatePopoverSize();

    const resizeObserver = new ResizeObserver(updatePopoverSize);
    resizeObserver.observe(popoverRef.current);
    window.addEventListener('resize', updatePopoverSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePopoverSize);
    };
  }, [
    selectedExcerpt,
    selectedExcerptError,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
  ]);

  if (
    !selectedExcerpt ||
    selectedExcerpt.anchorClientX === undefined ||
    selectedExcerpt.anchorClientY === undefined
  ) {
    return null;
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  const panelWidth = Math.min(popoverSize.width, viewportWidth - POPOVER_VIEWPORT_MARGIN * 2);
  const panelHeight = Math.min(popoverSize.height, viewportHeight - POPOVER_VIEWPORT_MARGIN * 2);
  const isPdfBlockExcerpt = selectedExcerpt.origin === 'pdf-block';
  const anchorRectPosition =
    selectedExcerpt.anchorClientRect
      ? resolveAnchorRectPopoverPosition({
          anchorRect: selectedExcerpt.anchorClientRect,
          panelWidth,
          panelHeight,
          viewportWidth,
          viewportHeight,
        })
      : null;
  const availableBelow = viewportHeight - selectedExcerpt.anchorClientY - POPOVER_VIEWPORT_MARGIN;
  const availableAbove = selectedExcerpt.anchorClientY - POPOVER_VIEWPORT_MARGIN;
  const placeAbove =
    availableBelow < panelHeight + POPOVER_ANCHOR_GAP &&
    availableAbove > availableBelow;
  const fallbackLeft = clampSelectionPopoverPosition(
    selectedExcerpt.anchorClientX - panelWidth / 2,
    POPOVER_VIEWPORT_MARGIN,
    viewportWidth - POPOVER_VIEWPORT_MARGIN - panelWidth,
  );
  const fallbackTop = clampSelectionPopoverPosition(
    placeAbove
      ? selectedExcerpt.anchorClientY - panelHeight - POPOVER_ANCHOR_GAP
      : selectedExcerpt.anchorClientY + POPOVER_ANCHOR_GAP,
    POPOVER_VIEWPORT_MARGIN,
    viewportHeight - POPOVER_VIEWPORT_MARGIN - panelHeight,
  );
  const left = anchorRectPosition?.left ?? fallbackLeft;
  const top = anchorRectPosition?.top ?? fallbackTop;
  const sourceLabel = isPdfBlockExcerpt
    ? l('PDF 段落', 'PDF Paragraph')
    : selectedExcerpt.source === 'pdf'
      ? l('PDF 划词', 'PDF Selection')
      : l('正文划词', 'Block Selection');
  const translationTitle = isPdfBlockExcerpt
    ? l('段落译文', 'Paragraph Translation')
    : l('划词翻译', 'Selection Translation');
  const translationLabel = selectedExcerptTranslating
    ? isPdfBlockExcerpt
      ? l('正在翻译当前段落...', 'Translating this paragraph...')
      : l('正在翻译选中文本...', 'Translating the selected text...')
    : selectedExcerptError
      ? selectedExcerptError
      : selectedExcerptTranslation.trim()
        ? selectedExcerptTranslation
        : isPdfBlockExcerpt
          ? aiConfigured
            ? l(
                '当前段落还没有缓存译文。可以先运行全文翻译，或点击“立即翻译”单独翻译这段。',
                'This paragraph has no cached translation yet. Run full translation first, or click “Translate Now” for this paragraph.',
              )
            : l(
                '当前段落还没有缓存译文。请先运行全文翻译，或在设置中配置模型后单独翻译。',
                'This paragraph has no cached translation yet. Run full translation first, or configure a model to translate it separately.',
              )
        : aiConfigured
          ? autoTranslateSelection
            ? l(
                '已捕获划词内容，稍后会在这里显示译文。',
                'The selected text has been captured. Its translation will appear here shortly.',
              )
            : l(
                '已捕获划词内容，点击“立即翻译”获取译文。',
                'The selected text has been captured. Click “Translate Now” to get the translation.',
              )
          : l(
              'AI 服务尚未配置，请先在设置中完成模型配置。',
              'AI service is not configured yet. Complete the model setup in Preferences first.',
            );

  const popover = (
    <div
      className="pointer-events-none fixed z-[10000]"
      style={{
        left,
        top,
      }}
    >
      <div
        ref={popoverRef}
        className="pointer-events-auto w-[min(360px,calc(100vw-32px))] rounded-[20px] border border-slate-200/80 bg-white/96 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
        style={{
          maxHeight: `calc(100vh - ${POPOVER_VIEWPORT_MARGIN * 2}px)`,
          overflowY: 'auto',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
              {sourceLabel}
            </div>
            <div className="mt-2 max-h-20 overflow-hidden text-sm font-medium leading-6 text-slate-700">
              <MarkdownPreview
                content={selectedExcerpt.text}
                className="text-sm font-medium leading-6 text-slate-700 [&_.katex-display]:my-1 [&_p]:my-0 [&_p]:leading-6"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSelectedExcerpt}
            className="rounded-lg p-1.5 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
            aria-label={l('关闭划词浮层', 'Close selection popover')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {translationTitle}
          </div>
          <div className="max-h-52 overflow-auto text-sm leading-6 text-slate-700">
            <MarkdownPreview
              content={translationLabel}
              className="text-sm leading-6 text-slate-700 [&_.katex-display]:my-1 [&_p]:my-0 [&_p]:leading-6"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onAppendSelectedExcerptToQa}
            className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
          >
            {l('加入问答', 'Add to QA')}
          </button>
          <button
            type="button"
            onClick={onAddSelectionToNote}
            className="inline-flex items-center rounded-xl border border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] px-3 py-2 text-sm font-medium text-[var(--pq-accent)] transition-all duration-200 hover:bg-[var(--pq-accent-bg-hover)]"
          >
            {l('加入笔记', 'Add to Note')}
          </button>
          <button
            type="button"
            onClick={onTranslateSelectedExcerpt}
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
          >
            {selectedExcerptTranslation.trim()
              ? l('重新翻译', 'Translate Again')
              : l('立即翻译', 'Translate Now')}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(popover, document.body);
}
