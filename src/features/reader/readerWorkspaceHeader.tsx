import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileJson,
  Languages,
  LayoutGrid,
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
  onStageChange: (stage: WorkspaceStage) => void;
  onReadingViewModeChange: (mode: ReaderViewMode) => void;
  onCurrentPdfPathChange: (path: string) => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onTranslateDocument: () => void;
  onOpenPreferences: () => void;
}

function HeaderStageTabs({
  workspaceStage,
  onStageChange,
}: Pick<ReaderWorkspaceHeaderProps, 'workspaceStage' | 'onStageChange'>) {
  const l = useLocaleText();

  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-chrome-800">
      {[
        {
          key: 'overview' as const,
          label: l('概览', 'Overview'),
          icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
        },
        {
          key: 'reading' as const,
          label: l('阅读', 'Reading'),
          icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />,
        },
      ].map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onStageChange(tab.key)}
          className={cn(
            'inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-medium transition-all duration-200',
            workspaceStage === tab.key
              ? 'bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.08)] dark:bg-chrome-700 dark:text-chrome-100 dark:shadow-[0_6px_18px_rgba(0,0,0,0.16)]'
              : 'text-slate-500 hover:text-slate-800 dark:text-chrome-400 dark:hover:text-chrome-100',
          )}
        >
          {tab.icon}
          {tab.label}
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
    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-chrome-800">
      {[
        { key: 'pdf-only' as const, label: l('PDF 阅读', 'PDF Only') },
        { key: 'dual-pane' as const, label: l('双栏对照', 'Dual Pane') },
      ].map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => onReadingViewModeChange(mode.key)}
          className={cn(
            'rounded-[14px] px-3 py-2 text-sm font-medium transition-all duration-200',
            readingViewMode === mode.key
              ? 'bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.08)]'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {mode.label}
        </button>
      ))}
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
      <label className="flex min-w-[240px] max-w-[420px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300">
        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-chrome-400">
          {l('PDF 版本', 'PDF Version')}
        </span>
        <div className="relative min-w-0 flex-1">
          <select
            value={currentPdfPath || availablePdfOptions[0]?.path || ''}
            onChange={(event) => onCurrentPdfPathChange(event.target.value)}
            title={selectedPdfOption?.label || ''}
            className="block w-full min-w-0 appearance-none truncate bg-transparent pr-8 text-sm leading-6 text-slate-700 outline-none dark:text-chrome-200"
          >
            {availablePdfOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-chrome-500"
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
    <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300">
      {currentPdfVariantLabel}
    </div>
  );
}

function HeaderToolsMenu({
  loading,
  translating,
  onOpenMineruJson,
  onCloudParse,
  onTranslateDocument,
  onOpenPreferences,
}: Pick<
  ReaderWorkspaceHeaderProps,
  | 'loading'
  | 'translating'
  | 'onOpenMineruJson'
  | 'onCloudParse'
  | 'onTranslateDocument'
  | 'onOpenPreferences'
>) {
  const l = useLocaleText();
  const [toolbarOpen, setToolbarOpen] = useState(false);

  return (
    <div data-tour="reader-tools" className={cn('relative', toolbarOpen && 'z-[80]')}>
      <button
        type="button"
        onClick={() => setToolbarOpen((current) => !current)}
        className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-white/15 dark:hover:bg-chrome-700"
      >
        <MoreHorizontal className="mr-2 h-4 w-4" strokeWidth={1.8} />
        {l('工具', 'Tools')}
        <ChevronDown className="ml-2 h-4 w-4" strokeWidth={1.8} />
      </button>

      {toolbarOpen ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[90] w-56 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_18px_42px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-chrome-800 dark:shadow-[0_18px_42px_rgba(0,0,0,0.24)]">
          {[
            {
              label: l('打开 JSON', 'Open JSON'),
              icon: <FileJson className="h-4 w-4" strokeWidth={1.8} />,
              onClick: onOpenMineruJson,
              disabled: loading,
            },
            {
              label: l('MinerU 解析', 'MinerU Parse'),
              icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
              onClick: onCloudParse,
              disabled: loading,
            },
            {
              label: translating
                ? l('翻译中...', 'Translating...')
                : l('翻译全文', 'Translate Document'),
              icon: <Languages className="h-4 w-4" strokeWidth={1.8} />,
              onClick: onTranslateDocument,
              disabled: loading || translating,
            },
            {
              label: l('偏好设置', 'Preferences'),
              icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
              onClick: onOpenPreferences,
              disabled: false,
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
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-chrome-300 dark:hover:bg-chrome-700"
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
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
  onStageChange,
  onReadingViewModeChange,
  onCurrentPdfPathChange,
  onOpenMineruJson,
  onCloudParse,
  onTranslateDocument,
  onOpenPreferences,
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
        'relative z-20 overflow-visible border-b border-slate-200/80 bg-white/70 backdrop-blur-xl transition-all duration-200 dark:border-white/10 dark:bg-chrome-950',
        headerCollapsed ? 'px-4 py-2' : 'px-6 py-4',
      )}
    >
      <div
        className={cn(
          'flex flex-wrap gap-4',
          headerCollapsed ? 'items-center' : 'items-start',
        )}
      >
        <div className="min-w-0 flex-1 basis-[360px]">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
            {sourceLabel}
          </div>
          <div
            className={cn(
              'truncate font-semibold tracking-tight text-slate-950 transition-all duration-200 dark:text-chrome-100',
              headerCollapsed ? 'mt-0.5 max-w-[720px] text-base' : 'mt-2 text-[24px]',
            )}
          >
            {documentTitle}
          </div>
          {!headerCollapsed ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-chrome-300">
              <span>{documentCreators || l('未知作者', 'Unknown Author')}</span>
              {documentYear ? <span>· {documentYear}</span> : null}
              {currentPdfName ? <span>· {currentPdfName}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="order-3 flex w-full justify-center md:order-none md:flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2">
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

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {workspaceStage === 'reading' ? (
            <HeaderPdfVersionControl
              currentPdfVariantLabel={currentPdfVariantLabel}
              currentPdfPath={currentPdfPath}
              availablePdfOptions={availablePdfOptions}
              onCurrentPdfPathChange={onCurrentPdfPathChange}
            />
          ) : null}

          <button
            type="button"
            onClick={() => setHeaderCollapsed((current) => !current)}
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-white/15 dark:hover:bg-chrome-700"
            title={headerCollapsed ? l('展开状态栏', 'Expand Header') : l('收起状态栏', 'Collapse Header')}
          >
            {headerCollapsed ? (
              <ChevronDown className="mr-2 h-4 w-4" strokeWidth={1.8} />
            ) : (
              <ChevronUp className="mr-2 h-4 w-4" strokeWidth={1.8} />
            )}
            {headerCollapsed ? l('展开状态栏', 'Expand Header') : l('收起状态栏', 'Collapse Header')}
          </button>

          <HeaderToolsMenu
            loading={loading}
            translating={translating}
            onOpenMineruJson={onOpenMineruJson}
            onCloudParse={onCloudParse}
            onTranslateDocument={onTranslateDocument}
            onOpenPreferences={onOpenPreferences}
          />
        </div>
      </div>
    </div>
  );
}
