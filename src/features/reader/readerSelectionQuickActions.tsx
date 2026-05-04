import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { SelectedExcerpt } from '../../types/reader';

function clampSelectionPopoverPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export interface SelectionQuickActionsProps {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  autoTranslateSelection: boolean;
  onAppendSelectedExcerptToQa: () => void;
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
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: SelectionQuickActionsProps) {
  const l = useLocaleText();
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedExcerpt) {
      return undefined;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef.current?.contains(target)) {
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

  if (
    !selectedExcerpt ||
    selectedExcerpt.anchorClientX === undefined ||
    selectedExcerpt.anchorClientY === undefined
  ) {
    return null;
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  const panelHalfWidth = Math.min(180, Math.max((viewportWidth - 32) / 2, 120));
  const left = clampSelectionPopoverPosition(
    selectedExcerpt.anchorClientX,
    16 + panelHalfWidth,
    viewportWidth - 16 - panelHalfWidth,
  );
  const top = clampSelectionPopoverPosition(selectedExcerpt.anchorClientY, 84, viewportHeight - 84);
  const sourceLabel =
    selectedExcerpt.source === 'pdf'
      ? l('PDF 划词', 'PDF Selection')
      : l('正文划词', 'Block Selection');
  const translationLabel = selectedExcerptTranslating
    ? l('正在翻译选中文本...', 'Translating the selected text...')
    : selectedExcerptError
      ? selectedExcerptError
      : selectedExcerptTranslation.trim()
        ? selectedExcerptTranslation
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

  return (
    <div
      className="pointer-events-none fixed z-[90]"
      style={{
        left,
        top,
        transform: 'translate(-50%, 14px)',
      }}
    >
      <div
        ref={popoverRef}
        className="pointer-events-auto w-[min(360px,calc(100vw-32px))] rounded-[20px] border border-slate-200/80 bg-white/96 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
              {sourceLabel}
            </div>
            <div
              className="mt-2 text-sm font-medium leading-6 text-slate-700"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {selectedExcerpt.text}
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
            {l('划词翻译', 'Selection Translation')}
          </div>
          <div className="text-sm leading-6 text-slate-700">{translationLabel}</div>
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
}
