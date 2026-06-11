import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Columns2,
  FileJson,
  FileText,
  Languages,
  Maximize2,
  MoreHorizontal,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { ReaderViewMode, WorkspaceStage } from '../../types/reader';
import { cn } from '../../utils/cn';
import { WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, loadStoredBoolean } from './readerWorkspaceShared';

interface PdfOption {
  path: string;
  label: string;
}

export interface ReaderWorkspaceHeaderProps {
  sourceLabel: string;
  documentTitle: string;
  documentCreators: string;
  documentYear: string;
  currentPdfName: string;
  currentPdfVariantLabel: string;
  currentPdfPath: string;
  availablePdfOptions: PdfOption[];
  workspaceStage: WorkspaceStage;
  readingViewMode: ReaderViewMode;
  loading: boolean;
  translating: boolean;
  translationCancelling: boolean;
  onStageChange: (stage: WorkspaceStage) => void;
  onReadingViewModeChange: (mode: ReaderViewMode) => void;
  onCurrentPdfPathChange: (path: string) => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onTranslateDocument: () => void;
  onCancelTranslateDocument: () => void;
  onOpenPreferences: () => void;
  onEnterImmersive: () => void;
}

function HeaderStageTabs({
  workspaceStage,
  onStageChange,
}: Pick<ReaderWorkspaceHeaderProps, 'workspaceStage' | 'onStageChange'>) {
  const l = useLocaleText();

  return (
    <div className="inline-flex shrink-0 whitespace-nowrap rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
      {[
        {
          key: 'overview' as const,
          label: l('概览', 'Overview'),
          icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
        },
        {
          key: 'reading' as const,
          label: l('阅读', 'Reading'),
          icon: <BookOpen className="h-4 w-4" strokeWidth={1.8} />,
        },
      ].map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onStageChange(tab.key)}
          title={tab.label}
          className={cn(
            'inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-[14px] px-2 text-sm font-medium transition-all duration-200 xl:px-3',
            workspaceStage === tab.key
              ? 'bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.08)] dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text)] dark:shadow-[0_6px_18px_rgba(0,0,0,0.16)]'
              : 'text-slate-500 hover:text-slate-800 dark:text-[var(--pq-text-faint)] dark:hover:text-[var(--pq-text)]',
          )}
        >
          {tab.icon}
          <span className="hidden xl:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function HeaderReadingModeTabs({
  readingViewMode,
  onReadingViewModeChange,
}: Pick<ReaderWorkspaceHeaderProps, 'readingViewMode' | 'onReadingViewModeChange'>) {
  const l = useLocaleText();

  return (
    <div className="inline-flex shrink-0 whitespace-nowrap rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-[var(--pq-surface-1)]">
      {[
        { key: 'pdf-only' as const, label: l('PDF 阅读', 'PDF Only') },
        { key: 'dual-pane' as const, label: l('双栏对照', 'Dual Pane') },
      ].map((mode) => {
        const modeIcon =
          mode.key === 'pdf-only' ? (
            <FileText className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <Columns2 className="h-4 w-4" strokeWidth={1.8} />
          );
        const shortLabel = mode.key === 'pdf-only' ? 'PDF' : l('\u53cc\u680f', 'Dual');

        return (
          <button
            key={mode.key}
            type="button"
            onClick={() => onReadingViewModeChange(mode.key)}
            title={mode.label}
            className={cn(
              'inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-[14px] px-2 text-sm font-medium transition-all duration-200 2xl:px-3',
              readingViewMode === mode.key
                ? 'bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.08)]'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {modeIcon}
            <span className="hidden xl:inline 2xl:hidden">{shortLabel}</span>
            <span className="hidden 2xl:inline">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function HeaderPdfVersionControl({
  currentPdfVariantLabel,
  currentPdfPath,
  availablePdfOptions,
  onCurrentPdfPathChange,
}: Pick<
  ReaderWorkspaceHeaderProps,
  'currentPdfVariantLabel' | 'currentPdfPath' | 'availablePdfOptions' | 'onCurrentPdfPathChange'
>) {
  const l = useLocaleText();
  const selectedPdfOption =
    availablePdfOptions.find((option) => option.path === currentPdfPath) ??
    availablePdfOptions[0] ??
    null;

  if (availablePdfOptions.length > 1) {
    return (
      <label className="flex min-w-[180px] max-w-[260px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] 2xl:min-w-[240px] 2xl:max-w-[420px]">
        <span className="hidden shrink-0 text-xs font-medium text-slate-500 dark:text-[var(--pq-text-faint)] 2xl:inline">
          {l('PDF 版本', 'PDF Version')}
        </span>
        <div className="relative min-w-0 flex-1">
          <select
            value={currentPdfPath || availablePdfOptions[0]?.path || ''}
            onChange={(event) => onCurrentPdfPathChange(event.target.value)}
            title={selectedPdfOption?.label || ''}
            className="block w-full min-w-0 appearance-none truncate bg-transparent pr-8 text-sm leading-6 text-slate-700 outline-none dark:text-[var(--pq-text-muted)]"
          >
            {availablePdfOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[var(--pq-text-faint)]"
            strokeWidth={1.8}
          />
        </div>
      </label>
    );
  }

  if (!currentPdfVariantLabel) {
    return null;
  }

  return (
    <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)]">
      {currentPdfVariantLabel}
    </div>
  );
}

function HeaderToolsMenu({
  loading,
  translating,
  translationCancelling,
  onOpenMineruJson,
  onCloudParse,
  onTranslateDocument,
  onCancelTranslateDocument,
  onOpenPreferences,
}: Pick<
  ReaderWorkspaceHeaderProps,
  | 'loading'
  | 'translating'
  | 'translationCancelling'
  | 'onOpenMineruJson'
  | 'onCloudParse'
  | 'onTranslateDocument'
  | 'onCancelTranslateDocument'
  | 'onOpenPreferences'
>) {
  const l = useLocaleText();
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const menuWidth = 224;
    const estimatedMenuHeight = 196;
    const margin = 12;
    const gap = 8;
    const left = Math.min(
      Math.max(margin, rect.right - menuWidth),
      Math.max(margin, window.innerWidth - menuWidth - margin),
    );
    const belowTop = rect.bottom + gap;
    const top = belowTop + estimatedMenuHeight <= window.innerHeight - margin
      ? belowTop
      : Math.max(margin, rect.top - estimatedMenuHeight - gap);

    setMenuStyle({ left, top });
  }, []);

  useEffect(() => {
    if (!toolbarOpen) {
      return undefined;
    }

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (buttonRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setToolbarOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolbarOpen(false);
      }
    };

    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toolbarOpen, updateMenuPosition]);

  const menu = toolbarOpen ? (
    <div
      ref={menuRef}
      className="fixed z-[10000] w-56 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_18px_42px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.24)]"
      style={menuStyle}
    >
      {[
        {
          label: l('打开 JSON', 'Open JSON'),
          icon: <FileJson className="h-4 w-4" strokeWidth={1.8} />,
          onClick: onOpenMineruJson,
          disabled: loading,
          tone: 'default',
        },
        {
          label: l('MinerU 解析', 'MinerU Parse'),
          icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
          onClick: onCloudParse,
          disabled: loading,
          tone: 'default',
        },
        {
          label: translating
            ? translationCancelling
              ? l('取消中...', 'Cancelling...')
              : l('取消翻译', 'Cancel Translation')
            : l('翻译全文', 'Translate Document'),
          icon: translating
            ? <CircleStop className="h-4 w-4" strokeWidth={1.8} />
            : <Languages className="h-4 w-4" strokeWidth={1.8} />,
          onClick: translating ? onCancelTranslateDocument : onTranslateDocument,
          disabled: loading || translationCancelling,
          tone: translating ? 'danger' : 'default',
        },
        {
          label: l('偏好设置', 'Preferences'),
          icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
          onClick: onOpenPreferences,
          disabled: false,
          tone: 'default',
        },
      ].map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => {
            setToolbarOpen(false);
            action.onClick();
          }}
          disabled={action.disabled}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
            action.tone === 'danger'
              ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10'
              : 'text-slate-700 hover:bg-slate-50 dark:text-[var(--pq-text-muted)] dark:hover:bg-[var(--pq-surface-2)]',
          )}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div data-tour="reader-tools" className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setToolbarOpen((current) => !current)}
        className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 text-[0px] font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:hover:border-white/15 dark:hover:bg-[var(--pq-surface-2)] 2xl:px-3 2xl:text-sm"
        title={l('工具', 'Tools')}
      >
        <MoreHorizontal className="mr-0 h-4 w-4 2xl:mr-2" strokeWidth={1.8} />
        {l('工具', 'Tools')}
        <ChevronDown className="hidden h-4 w-4 2xl:ml-2 2xl:block" strokeWidth={1.8} />
      </button>

      {typeof document === 'undefined' || !menu ? null : createPortal(menu, document.body)}
    </div>
  );
}

export function ReaderWorkspaceHeader({
  sourceLabel,
  documentTitle,
  documentCreators,
  documentYear,
  currentPdfName,
  currentPdfVariantLabel,
  currentPdfPath,
  availablePdfOptions,
  workspaceStage,
  readingViewMode,
  loading,
  translating,
  translationCancelling,
  onStageChange,
  onReadingViewModeChange,
  onCurrentPdfPathChange,
  onOpenMineruJson,
  onCloudParse,
  onTranslateDocument,
  onCancelTranslateDocument,
  onOpenPreferences,
  onEnterImmersive,
}: ReaderWorkspaceHeaderProps) {
  const l = useLocaleText();
  const [headerCollapsed, setHeaderCollapsed] = useState(() =>
    loadStoredBoolean(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, false),
  );

  useEffect(() => {
    localStorage.setItem(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, String(headerCollapsed));
  }, [headerCollapsed]);

  return (
    <div
      className={cn(
        'relative z-20 overflow-visible border-b border-slate-200/80 bg-white/70 backdrop-blur-xl transition-all duration-200 dark:border-white/10 dark:bg-[var(--pq-bg-primary)]',
        headerCollapsed ? 'px-4 py-2' : 'px-4 py-3 2xl:px-6',
      )}
    >
      <div
        className={cn(
          'grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-3',
          headerCollapsed ? 'items-center' : 'items-start',
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-[var(--pq-text-faint)]">
            {sourceLabel}
          </div>
          <div
            className={cn(
              'truncate font-semibold tracking-tight text-slate-950 transition-all duration-200 dark:text-[var(--pq-text)]',
              headerCollapsed ? 'mt-0.5 max-w-[720px] text-base' : 'mt-1 text-lg 2xl:text-[22px]',
            )}
          >
            {documentTitle}
          </div>
          {!headerCollapsed ? (
            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-slate-500 dark:text-[var(--pq-text-muted)]">
              <span>{documentCreators || l('未知作者', 'Unknown Author')}</span>
              {documentYear ? <span>· {documentYear}</span> : null}
              {currentPdfName ? <span>· {currentPdfName}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-center">
          <div className="flex flex-nowrap items-center justify-center gap-2">
            <HeaderStageTabs
              workspaceStage={workspaceStage}
              onStageChange={onStageChange}
            />

            {workspaceStage === 'reading' ? (
              <HeaderReadingModeTabs
                readingViewMode={readingViewMode}
                onReadingViewModeChange={onReadingViewModeChange}
              />
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2">
          {workspaceStage === 'reading' ? (
            <HeaderPdfVersionControl
              currentPdfVariantLabel={currentPdfVariantLabel}
              currentPdfPath={currentPdfPath}
              availablePdfOptions={availablePdfOptions}
              onCurrentPdfPathChange={onCurrentPdfPathChange}
            />
          ) : null}

          {workspaceStage === 'reading' ? (
            <button
              type="button"
              onClick={onEnterImmersive}
              className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 text-[0px] font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:hover:border-white/15 dark:hover:bg-[var(--pq-surface-2)] 2xl:px-3 2xl:text-sm"
              title={l('沉浸阅读', 'Immersive Reading')}
              aria-label={l('沉浸阅读', 'Immersive Reading')}
            >
              <Maximize2 className="mr-0 h-4 w-4 2xl:mr-2" strokeWidth={1.8} />
              {l('沉浸', 'Immersive')}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setHeaderCollapsed((current) => !current)}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 text-[0px] font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)] dark:hover:border-white/15 dark:hover:bg-[var(--pq-surface-2)] 2xl:px-3 2xl:text-sm"
            title={headerCollapsed ? l('展开状态栏', 'Expand Header') : l('收起状态栏', 'Collapse Header')}
          >
            {headerCollapsed ? (
              <ChevronDown className="mr-0 h-4 w-4 2xl:mr-2" strokeWidth={1.8} />
            ) : (
              <ChevronUp className="mr-0 h-4 w-4 2xl:mr-2" strokeWidth={1.8} />
            )}
            {headerCollapsed ? l('展开状态栏', 'Expand Header') : l('收起状态栏', 'Collapse Header')}
          </button>

          <HeaderToolsMenu
            loading={loading}
            translating={translating}
            translationCancelling={translationCancelling}
            onOpenMineruJson={onOpenMineruJson}
            onCloudParse={onCloudParse}
            onTranslateDocument={onTranslateDocument}
            onCancelTranslateDocument={onCancelTranslateDocument}
            onOpenPreferences={onOpenPreferences}
          />
        </div>
      </div>
    </div>
  );
}
