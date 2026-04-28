import { Suspense, lazy, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileJson,
  FileText,
  Languages,
  LayoutGrid,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  ScanSearch,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import BlockViewer from '../blocks/BlockViewer';
import PdfViewer from '../pdf/PdfViewer';
import { useLocaleText } from '../../i18n/uiLanguage';
import { AssistantSidebar, ChatWorkspacePanel, SectionCard, SummaryPanel } from './AssistantSidebar';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperAnnotation,
  PaperSummary,
  PdfHighlightTarget,
  PdfSource,
  PositionedMineruBlock,
  QaModelPreset,
  ReaderViewMode,
  SelectedExcerpt,
  TextSelectionPayload,
  TextSelectionSource,
  TranslationDisplayMode,
  TranslationMap,
  WorkspaceStage,
  ZoteroRelatedNote,
} from '../../types/reader';
import { cn } from '../../utils/cn';

const PdfAnnotationWorkspace = lazy(() => import('../pdf/PdfAnnotationWorkspace'));

const WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY = 'paper-reader-workspace-header-collapsed-v1';
const ASSISTANT_PANEL_WIDTH_STORAGE_KEY = 'paper-reader-assistant-panel-width-v1';
const MIN_ASSISTANT_PANEL_WIDTH = 336;
const MAX_ASSISTANT_PANEL_WIDTH = 720;

function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
  } catch {
    return fallback;
  }
}

function loadStoredNumber(key: string, fallback: number): number {
  try {
    const rawValue = Number(localStorage.getItem(key));

    return Number.isFinite(rawValue) ? rawValue : fallback;
  } catch {
    return fallback;
  }
}

interface ReaderWorkspaceDocument {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  source: string;
}

interface ReaderWorkspaceProps {
  currentDocument: ReaderWorkspaceDocument;
  selectedSectionTitle: string;
  currentPdfName: string;
  currentJsonName: string;
  mineruPath: string;
  translatedCount: number;
  translationProgressCompleted: number;
  translationProgressTotal: number;
  workspaceStage: WorkspaceStage;
  onStageChange: (stage: WorkspaceStage) => void;
  readingViewMode: ReaderViewMode;
  onReadingViewModeChange: (mode: ReaderViewMode) => void;
  loading: boolean;
  translating: boolean;
  error: string;
  statusMessage: string;
  activeBlockSummary: string;
  currentPdfVariantLabel: string;
  canOpenOriginalPdf: boolean;
  onOpenOriginalPdf: () => void;
  currentPdfPath: string;
  availablePdfOptions: Array<{
    path: string;
    label: string;
  }>;
  onCurrentPdfPathChange: (path: string) => void;
  pdfAnnotationSaveDirectory: string;
  originalPdfPath: string;
  pdfSource: PdfSource;
  pdfData: Uint8Array | null;
  blocks: PositionedMineruBlock[];
  translations: TranslationMap;
  translationDisplayMode: TranslationDisplayMode;
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  activePdfHighlight: PdfHighlightTarget | null;
  blockScrollSignal: number;
  smoothScroll: boolean;
  softPageShadow: boolean;
  compactReading: boolean;
  showBlockMeta: boolean;
  hidePageDecorationsInBlockView: boolean;
  leftPaneWidthRatio: number;
  layoutRef: RefObject<HTMLDivElement>;
  onStartResize: () => void;
  onResetLayout: () => void;
  onPdfBlockHover: (block: PositionedMineruBlock | null) => void;
  onPdfBlockSelect: (block: PositionedMineruBlock) => void;
  onBlockClick: (block: PositionedMineruBlock) => void;
  onTextSelect: (selection: TextSelectionPayload, source: TextSelectionSource) => void;
  onOpenStandalonePdf: () => void;
  onOpenMineruJson: () => void;
  onCloudParse: () => void;
  onTranslateDocument: () => void;
  onOpenPreferences: () => void;
  workspaceNoteMarkdown: string;
  annotations: PaperAnnotation[];
  selectedAnnotationId: string | null;
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
  paperSummary: PaperSummary | null;
  paperSummaryLoading: boolean;
  paperSummaryError: string;
  onGenerateSummary: () => void;
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaMessages: DocumentChatMessage[];
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  screenshotLoading: boolean;
  onQaInputChange: (value: string) => void;
  onQaSubmit: () => void;
  onQaPresetChange: (presetId: string) => void;
  onQaSessionCreate: () => void;
  onQaSessionSelect: (sessionId: string) => void;
  onQaSessionDelete: (sessionId: string) => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  qaLoading: boolean;
  qaError: string;
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  autoTranslateSelection: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
  onPdfAnnotationSaveSuccess: (path: string) => void;
  aiConfigured: boolean;
  assistantDetached: boolean;
  assistantActivePanel: AssistantPanelKey;
  onAssistantActivePanelChange: (panel: AssistantPanelKey) => void;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  onDetachAssistant: () => void;
  onAttachAssistant: () => void;
  showLibraryToggle?: boolean;
}

function StatTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
          {label}
        </div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          {icon}
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{detail}</div>
    </div>
  );
}

function InlineProgressBar({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label?: string;
}) {
  if (total <= 0) {
    return null;
  }

  const ratio = Math.min(100, Math.max(0, (completed / total) * 100));

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/84 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="font-medium text-slate-900">
          {label || '处理进度'}
        </div>
        <div className="text-slate-500">
          {completed}/{total}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

function clampSelectionPopoverPosition(
  value: number,
  min: number,
  max: number,
) {
  return Math.min(max, Math.max(min, value));
}

function SelectionQuickActions({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  autoTranslateSelection,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  autoTranslateSelection: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
}) {
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
  const top = clampSelectionPopoverPosition(
    selectedExcerpt.anchorClientY,
    84,
    viewportHeight - 84,
  );
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

function clampFloatingPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitialFloatingAssistantPosition() {
  if (typeof window === 'undefined') {
    return { x: 960, y: 88 };
  }

  return {
    x: Math.max(16, window.innerWidth - Math.min(1040, window.innerWidth - 32)),
    y: 88,
  };
}

function FloatingAssistantPanel({
  props,
  documentSource,
}: {
  props: ReaderWorkspaceProps;
  documentSource: string;
}) {
  const l = useLocaleText();
  const {
    currentDocument,
    currentPdfName,
    currentJsonName,
    mineruPath,
    translatedCount,
    statusMessage,
    blocks,
    paperSummary,
    paperSummaryLoading,
    paperSummaryError,
    onGenerateSummary,
    qaSessions,
    selectedQaSessionId,
    qaMessages,
    qaInput,
    qaAttachments,
    qaModelPresets,
    selectedQaPresetId,
    qaLoading,
    qaError,
    screenshotLoading,
    selectedExcerpt,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
    selectedExcerptError,
    workspaceNoteMarkdown,
    annotations,
    zoteroRelatedNotes,
    zoteroRelatedNotesLoading,
    zoteroRelatedNotesError,
    onQaInputChange,
    onQaSubmit,
    onQaPresetChange,
    onQaSessionCreate,
    onQaSessionSelect,
    onQaSessionDelete,
    onSelectImageAttachments,
    onSelectFileAttachments,
    onCaptureScreenshot,
    onRemoveAttachment,
    onAppendSelectedExcerptToQa,
    onAppendSelectedExcerptToNote,
    onTranslateSelectedExcerpt,
    onClearSelectedExcerpt,
    onWorkspaceNoteChange,
    onCreateAnnotation,
    onDeleteAnnotation,
    onSelectAnnotation,
    aiConfigured,
    assistantActivePanel,
    onAssistantActivePanelChange,
    onOpenPreferences,
    onAttachAssistant,
  } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panelX: number;
    panelY: number;
  } | null>(null);
  const [panelPosition, setPanelPosition] = useState(getInitialFloatingAssistantPosition);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragRef.current;

      if (!dragState) {
        return;
      }

      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width ?? 960;
      const panelHeight = panelRect?.height ?? 720;
      const nextX = dragState.panelX + event.clientX - dragState.startX;
      const nextY = dragState.panelY + event.clientY - dragState.startY;

      setPanelPosition({
        x: clampFloatingPosition(nextX, 12, window.innerWidth - panelWidth - 12),
        y: clampFloatingPosition(nextY, 64, window.innerHeight - panelHeight - 12),
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging]);

  return (
    <div
      ref={panelRef}
      className="fixed z-40 flex h-[min(820px,calc(100vh-72px))] min-h-[560px] w-[min(1040px,calc(100vw-32px))] min-w-[640px] resize flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_30px_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
      }}
    >
      <div
        className="flex cursor-move items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/86 px-4 py-3"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) {
            return;
          }

          const panelRect = panelRef.current?.getBoundingClientRect();
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            panelX: panelRect?.left ?? panelPosition.x,
            panelY: panelRect?.top ?? panelPosition.y,
          };
          setDragging(true);
        }}
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {l('浮动 AI 面板', 'Floating AI Panel')}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">
            {currentDocument.title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onAttachAssistant}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50"
          >
            {l('停靠右侧', 'Dock Right')}
          </button>
          <button
            type="button"
            onClick={onAttachAssistant}
            aria-label={l('关闭浮动 AI 面板', 'Close Floating AI Panel')}
            className="rounded-xl p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <AssistantSidebar
        activePanel={assistantActivePanel}
        onActivePanelChange={onAssistantActivePanelChange}
        documentTitle={currentDocument.title}
        documentMeta={`${currentDocument.creators || l('未知作者', 'Unknown Author')}${currentDocument.year ? ` · ${currentDocument.year}` : ''}`}
        documentSource={documentSource}
        documentPdfName={currentPdfName}
        documentJsonName={currentJsonName}
        blockCount={blocks.length}
        translatedCount={translatedCount}
        statusMessage={statusMessage}
        hasBlocks={blocks.length > 0}
        aiConfigured={aiConfigured}
        paperSummary={paperSummary}
        paperSummaryLoading={paperSummaryLoading}
        paperSummaryError={paperSummaryError}
        onGenerateSummary={onGenerateSummary}
        qaSessions={qaSessions}
        selectedQaSessionId={selectedQaSessionId}
        qaMessages={qaMessages}
        qaInput={qaInput}
        qaAttachments={qaAttachments}
        qaModelPresets={qaModelPresets}
        selectedQaPresetId={selectedQaPresetId}
        qaLoading={qaLoading}
        qaError={qaError}
        screenshotLoading={screenshotLoading}
        chatLayoutMode="workspace"
        onQaInputChange={onQaInputChange}
        onQaSubmit={onQaSubmit}
        onQaPresetChange={onQaPresetChange}
        onQaSessionCreate={onQaSessionCreate}
        onQaSessionSelect={onQaSessionSelect}
        onQaSessionDelete={onQaSessionDelete}
        onSelectImageAttachments={onSelectImageAttachments}
        onSelectFileAttachments={onSelectFileAttachments}
        onCaptureScreenshot={onCaptureScreenshot}
        onRemoveAttachment={onRemoveAttachment}
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
        activeBlockSummary={props.activeBlockSummary}
        workspaceNoteMarkdown={workspaceNoteMarkdown}
        annotations={annotations}
        zoteroRelatedNotes={zoteroRelatedNotes}
        zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
        zoteroRelatedNotesError={zoteroRelatedNotesError}
        onWorkspaceNoteChange={onWorkspaceNoteChange}
        onAppendSelectedExcerptToNote={onAppendSelectedExcerptToNote}
        onCreateAnnotation={onCreateAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onSelectAnnotation={onSelectAnnotation}
        onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
        onClearSelectedExcerpt={onClearSelectedExcerpt}
        onAttachBack={onAttachAssistant}
        onOpenPreferences={onOpenPreferences}
      />
    </div>
  );
}

function OverviewStage(props: ReaderWorkspaceProps) {
  return <CompactOverviewStage {...props} />;
}

function CompactOverviewStage(props: ReaderWorkspaceProps) {
  const l = useLocaleText();
  const {
    currentDocument,
    selectedSectionTitle,
    currentPdfName,
    currentJsonName,
    loading,
    translating,
    blocks,
    translationProgressCompleted,
    translationProgressTotal,
    paperSummary,
    paperSummaryLoading,
    paperSummaryError,
    onGenerateSummary,
    onStageChange,
    onOpenMineruJson,
    onCloudParse,
    onTranslateDocument,
    aiConfigured,
  } = props;

  const sourceLabel =
    currentDocument.source === 'standalone'
      ? l('独立文献', 'Standalone Document')
      : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
        <div className="space-y-5">
          <section data-tour="overview-actions" className="rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(248,250,252,0.78))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                  {l('论文概览', 'Paper Overview')}
                </div>
                <h2 className="mt-4 text-[30px] font-semibold tracking-tight text-slate-950">
                  {currentDocument.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{currentDocument.creators || l('未知作者', 'Unknown Author')}</span>
                  {currentDocument.year ? <span>· {currentDocument.year}</span> : null}
                  <span>· {sourceLabel}</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onStageChange('reading')}
                  className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                >
                  {l('进入阅读', 'Start Reading')}
                  <ArrowRight className="ml-2 h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  data-tour="overview-mineru-parse"
                  onClick={onCloudParse}
                  disabled={loading}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Sparkles className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {l('MinerU 解析', 'MinerU Parse')}
                </button>
                <button
                  type="button"
                  data-tour="overview-translate-document"
                  onClick={onTranslateDocument}
                  disabled={loading || translating || blocks.length === 0}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Languages className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {translating ? l('翻译中...', 'Translating...') : l('翻译全文', 'Translate Document')}
                </button>
              </div>
            </div>
          </section>

          {translating ? (
            <InlineProgressBar
              completed={translationProgressCompleted}
              total={translationProgressTotal}
              label={l('MinerU 结构块翻译进度', 'MinerU Block Translation Progress')}
            />
          ) : null}

          <div data-tour="ai-summary">
          <SummaryPanel
            paperSummary={paperSummary}
            loading={paperSummaryLoading}
            error={paperSummaryError}
            hasBlocks={blocks.length > 0}
            aiConfigured={aiConfigured}
            onGenerateSummary={onGenerateSummary}
          />
          </div>
        </div>

        <div className="space-y-5">
          <SectionCard
            title={l('论文信息', 'Document Info')}
            description={l(
              '显示当前文档的文件状态、结构化结果和后续入口。',
              'Show the file status, structured parsing result, and next actions for the current document.',
            )}
            icon={<ScanSearch className="h-4 w-4" strokeWidth={1.8} />}
            contentClassName="space-y-4"
          >
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-chrome-400">
                {l('来源', 'Source')}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{sourceLabel}</div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileText className="h-4 w-4" strokeWidth={1.8} />
                PDF
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                {currentPdfName || l('未加载 PDF', 'No PDF Loaded')}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileJson className="h-4 w-4" strokeWidth={1.8} />
                MinerU JSON
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">
                {currentJsonName || l('未加载 JSON', 'No JSON Loaded')}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600">
              {loading || translating
                ? l('正在处理中，请稍候...', 'Processing, please wait...')
                : blocks.length > 0
                  ? l(
                      `已检测到 ${blocks.length} 个结构块，可以直接切换到双栏对照阅读。`,
                      `Detected ${blocks.length} structured blocks. You can switch to Dual Pane reading immediately.`,
                    )
                  : l(
                      '当前还没有结构块，请先加载 JSON 或执行 MinerU 解析。',
                      'No structured blocks are available yet. Load a JSON file or run MinerU parsing first.',
                    )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenMineruJson}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <FileJson className="mr-2 h-4 w-4" strokeWidth={1.8} />
                {l('打开 JSON', 'Open JSON')}
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function ReadingStage(
  props: ReaderWorkspaceProps & {
    headerCollapsed: boolean;
  },
) {
  const l = useLocaleText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const {
    blocks,
    translations,
    translationDisplayMode,
    readingViewMode,
    activeBlockId,
    hoveredBlockId,
    activePdfHighlight,
    blockScrollSignal,
    smoothScroll,
    softPageShadow,
    compactReading,
    showBlockMeta,
    hidePageDecorationsInBlockView,
    leftPaneWidthRatio,
    layoutRef,
    pdfSource,
    pdfData,
    currentPdfName,
    currentJsonName,
    mineruPath,
    translatedCount,
    translationProgressCompleted,
    translationProgressTotal,
    translating,
    currentDocument,
    selectedSectionTitle,
    statusMessage,
    currentPdfVariantLabel,
    currentPdfPath,
    availablePdfOptions,
    onCurrentPdfPathChange,
    pdfAnnotationSaveDirectory,
    originalPdfPath,
    onStartResize,
    onResetLayout,
    onPdfBlockHover,
    onPdfBlockSelect,
    onBlockClick,
    onTextSelect,
    paperSummary,
    paperSummaryLoading,
    paperSummaryError,
    onGenerateSummary,
    qaSessions,
    selectedQaSessionId,
    qaMessages,
    qaInput,
    qaAttachments,
    qaModelPresets,
    selectedQaPresetId,
    qaLoading,
    qaError,
    screenshotLoading,
    selectedExcerpt,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
    selectedExcerptError,
    workspaceNoteMarkdown,
    annotations,
    selectedAnnotationId,
    zoteroRelatedNotes,
    zoteroRelatedNotesLoading,
    zoteroRelatedNotesError,
    onQaInputChange,
    onQaSubmit,
    onQaPresetChange,
    onQaSessionCreate,
    onQaSessionSelect,
    onQaSessionDelete,
    onSelectImageAttachments,
    onSelectFileAttachments,
    onCaptureScreenshot,
    onRemoveAttachment,
    onAppendSelectedExcerptToQa,
    onAppendSelectedExcerptToNote,
    onTranslateSelectedExcerpt,
    onClearSelectedExcerpt,
    onPdfAnnotationSaveSuccess,
    onWorkspaceNoteChange,
    onCreateAnnotation,
    onDeleteAnnotation,
    onSelectAnnotation,
    aiConfigured,
    assistantDetached,
    assistantActivePanel,
    onReadingViewModeChange,
    onAssistantActivePanelChange,
    onDetachAssistant,
  } = props;
  const documentSource =
    currentDocument.source === 'standalone'
      ? l('独立文献', 'Standalone Document')
      : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;
  const hasBlocks = blocks.length > 0;
  const showDualPane = hasBlocks && readingViewMode === 'dual-pane';
  const showAssistantSidebar = !assistantDetached;
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(() =>
    loadStoredNumber(ASSISTANT_PANEL_WIDTH_STORAGE_KEY, 408),
  );
  const [resizingAssistantPanel, setResizingAssistantPanel] = useState(false);
  const handlePdfTextSelect = useCallback(
    (selection: TextSelectionPayload) => {
      onTextSelect(selection, 'pdf');
    },
    [onTextSelect],
  );
  const handleBlockTextSelect = useCallback(
    (selection: TextSelectionPayload) => {
      onTextSelect(selection, 'blocks');
    },
    [onTextSelect],
  );

  useEffect(() => {
    localStorage.setItem(
      ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(assistantPanelWidth)),
    );
  }, [assistantPanelWidth]);

  useEffect(() => {
    if (!resizingAssistantPanel) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const stageRect = stageRef.current?.getBoundingClientRect();

      if (!stageRect) {
        return;
      }

      const boundedMaxWidth = Math.min(
        MAX_ASSISTANT_PANEL_WIDTH,
        Math.max(MIN_ASSISTANT_PANEL_WIDTH, stageRect.width - 320),
      );
      const nextWidth = Math.round(
        Math.min(
          boundedMaxWidth,
          Math.max(MIN_ASSISTANT_PANEL_WIDTH, stageRect.right - event.clientX),
        ),
      );

      setAssistantPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setResizingAssistantPanel(false);
    };

    const previousUserSelect = globalThis.document.body.style.userSelect;
    const previousCursor = globalThis.document.body.style.cursor;

    globalThis.document.body.style.userSelect = 'none';
    globalThis.document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      globalThis.document.body.style.userSelect = previousUserSelect;
      globalThis.document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingAssistantPanel]);

  return (
    <div ref={stageRef} data-tour="linked-reading" className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={layoutRef} className="flex min-h-0 flex-1">
          <section
            className="min-h-0 min-w-0 bg-[#eef3f9] transition-all duration-300"
            style={{
              width: showDualPane ? `calc(${(leftPaneWidthRatio * 100).toFixed(2)}% - 4px)` : '100%',
            }}
          >
            <PdfViewer
              source={pdfSource}
              pdfData={pdfData}
              currentPdfName={currentPdfName}
              defaultSaveDirectory={pdfAnnotationSaveDirectory}
              originalPdfPath={originalPdfPath}
              translating={translating}
              translationProgressCompleted={translationProgressCompleted}
              translationProgressTotal={translationProgressTotal}
              blocks={blocks}
              activeBlockId={activeBlockId}
              hoveredBlockId={hoveredBlockId}
              activeHighlight={activePdfHighlight}
              smoothScroll={smoothScroll}
              softPageShadow={softPageShadow}
              annotations={annotations}
              selectedAnnotationId={selectedAnnotationId}
              onBlockHover={onPdfBlockHover}
              onBlockSelect={onPdfBlockSelect}
              onAnnotationSelect={onSelectAnnotation}
              onAnnotationCreate={onCreateAnnotation}
              onTextSelect={handlePdfTextSelect}
              onSaveSuccess={onPdfAnnotationSaveSuccess}
            />
          </section>

          {showDualPane ? (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={l('调整阅读分栏', 'Resize reading split')}
                onDoubleClick={onResetLayout}
                onPointerDown={(event) => {
                  event.preventDefault();
                  onStartResize();
                }}
                className="group relative z-20 w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/80 transition-all duration-200 group-hover:w-[3px] group-hover:bg-indigo-300" />
                <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-all duration-200 group-hover:w-1.5 group-hover:bg-indigo-400" />
              </div>

              <section data-tour="block-translation" className="min-h-0 min-w-0 flex-1 bg-[#f7f9fc] transition-all duration-300">
                <BlockViewer
                  blocks={blocks}
                  mineruPath={mineruPath}
                  translations={translations}
                  translationDisplayMode={translationDisplayMode}
                  activeBlockId={activeBlockId}
                  hoveredBlockId={hoveredBlockId}
                  scrollSignal={blockScrollSignal}
                  compactMode={compactReading}
                  showBlockMeta={showBlockMeta}
                  hidePageDecorations={hidePageDecorationsInBlockView}
                  smoothScroll={smoothScroll}
                  onBlockClick={onBlockClick}
                  onTextSelect={handleBlockTextSelect}
                />
              </section>
            </>
          ) : (
            <section className="w-0 overflow-hidden opacity-0 transition-all duration-300" />
          )}
        </div>
      </div>

      {showAssistantSidebar ? (
        <>
          {assistantActivePanel ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={l('调整问答侧栏宽度', 'Resize assistant sidebar')}
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingAssistantPanel(true);
              }}
              className="group relative z-20 ml-auto w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/90 transition-all duration-200 group-hover:w-[3px] group-hover:bg-slate-400" />
              <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-all duration-200 group-hover:w-1.5 group-hover:bg-slate-500" />
            </div>
          ) : null}

          <aside className="flex min-h-0 shrink-0 self-stretch transition-all duration-300">
          <AssistantSidebar
            activePanel={assistantActivePanel}
            onActivePanelChange={onAssistantActivePanelChange}
            panelWidth={assistantPanelWidth}
            documentTitle={currentDocument.title}
            documentMeta={`${currentDocument.creators || l('未知作者', 'Unknown Author')}${
              currentDocument.year ? ` · ${currentDocument.year}` : ''
            }`}
            documentSource={documentSource}
            documentPdfName={currentPdfName}
            documentJsonName={currentJsonName}
            blockCount={blocks.length}
            translatedCount={translatedCount}
            statusMessage={statusMessage}
            hasBlocks={blocks.length > 0}
            aiConfigured={aiConfigured}
            paperSummary={paperSummary}
            paperSummaryLoading={paperSummaryLoading}
            paperSummaryError={paperSummaryError}
            onGenerateSummary={onGenerateSummary}
            qaSessions={qaSessions}
            selectedQaSessionId={selectedQaSessionId}
            qaMessages={qaMessages}
            qaInput={qaInput}
            qaAttachments={qaAttachments}
            qaModelPresets={qaModelPresets}
            selectedQaPresetId={selectedQaPresetId}
            qaLoading={qaLoading}
            qaError={qaError}
            screenshotLoading={screenshotLoading}
            chatLayoutMode="compact"
            onQaInputChange={onQaInputChange}
            onQaSubmit={onQaSubmit}
            onQaPresetChange={onQaPresetChange}
            onQaSessionCreate={onQaSessionCreate}
            onQaSessionSelect={onQaSessionSelect}
            onQaSessionDelete={onQaSessionDelete}
            onSelectImageAttachments={onSelectImageAttachments}
            onSelectFileAttachments={onSelectFileAttachments}
            onCaptureScreenshot={onCaptureScreenshot}
            onRemoveAttachment={onRemoveAttachment}
            selectedExcerpt={selectedExcerpt}
            selectedExcerptTranslation={selectedExcerptTranslation}
            selectedExcerptTranslating={selectedExcerptTranslating}
            selectedExcerptError={selectedExcerptError}
            onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
            activeBlockSummary={props.activeBlockSummary}
            workspaceNoteMarkdown={workspaceNoteMarkdown}
            annotations={annotations}
            zoteroRelatedNotes={zoteroRelatedNotes}
            zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
            zoteroRelatedNotesError={zoteroRelatedNotesError}
            onWorkspaceNoteChange={onWorkspaceNoteChange}
            onAppendSelectedExcerptToNote={onAppendSelectedExcerptToNote}
            onCreateAnnotation={onCreateAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onSelectAnnotation={onSelectAnnotation}
            onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
            onClearSelectedExcerpt={onClearSelectedExcerpt}
            onDetach={onDetachAssistant}
            onOpenPreferences={props.onOpenPreferences}
          />
          </aside>
        </>
      ) : null}

      <SelectionQuickActions
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        aiConfigured={aiConfigured}
        autoTranslateSelection={props.autoTranslateSelection}
        onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
        onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
        onClearSelectedExcerpt={onClearSelectedExcerpt}
      />
    </div>
  );
}

function ReaderWorkspace(props: ReaderWorkspaceProps) {
  const l = useLocaleText();
  const {
    currentDocument,
    selectedSectionTitle,
    currentPdfName,
    currentPdfVariantLabel,
    currentPdfPath,
    availablePdfOptions,
    workspaceStage,
    onStageChange,
    readingViewMode,
    onReadingViewModeChange,
    loading,
    translating,
    error,
    statusMessage,
    activeBlockSummary,
    onOpenMineruJson,
    onCloudParse,
    onTranslateDocument,
    onOpenPreferences,
    onCurrentPdfPathChange,
    assistantDetached,
  } = props;
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(() =>
    loadStoredBoolean(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, false),
  );

  const sourceLabel =
    currentDocument.source === 'standalone'
      ? l('独立文献', 'Standalone Document')
      : `${l('本地文库', 'Local Library')} / ${selectedSectionTitle}`;
  const selectedPdfOption =
    availablePdfOptions.find((option) => option.path === currentPdfPath) ??
    availablePdfOptions[0] ??
    null;

  useEffect(() => {
    localStorage.setItem(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, String(headerCollapsed));
  }, [headerCollapsed]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)] dark:bg-[linear-gradient(180deg,#0f1a2e,#0c1525)]">
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
              {currentDocument.title}
            </div>
            {!headerCollapsed ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-chrome-300">
                <span>{currentDocument.creators || l('未知作者', 'Unknown Author')}</span>
                {currentDocument.year ? <span>· {currentDocument.year}</span> : null}
                {currentPdfName ? <span>· {currentPdfName}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="order-3 flex w-full justify-center md:order-none md:flex-1">
            <div className="flex flex-wrap items-center justify-center gap-2">
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

              {workspaceStage === 'reading' ? (
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
              ) : null}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {workspaceStage === 'reading' ? (
              availablePdfOptions.length > 1 ? (
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
              ) : currentPdfVariantLabel ? (
                <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 dark:border-white/10 dark:bg-chrome-800 dark:text-chrome-300">
                  {currentPdfVariantLabel}
                </div>
              ) : null
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
          </div>
        </div>
      </div>

      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-600 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-400">
          {error}
        </div>
      ) : null}

      {workspaceStage === 'overview' ? (
        <CompactOverviewStage {...props} />
      ) : (
        <ReadingStage {...props} headerCollapsed={headerCollapsed} />
      )}

      {assistantDetached ? (
        <FloatingAssistantPanel props={props} documentSource={sourceLabel} />
      ) : null}

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200/80 bg-white/70 px-6 py-2.5 text-xs text-slate-500 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950 dark:text-chrome-400">
        <div className="min-w-0 truncate">
          {loading || translating ? l('正在处理中...', 'Processing...') : statusMessage}
        </div>
        <div className="hidden items-center gap-4 lg:flex">
          <span>{activeBlockSummary}</span>
          <span>{l('单击预览，双击进入阅读', 'Single-click to preview, double-click to read')}</span>
          <span>Ctrl + {l('滚轮缩放', 'Scroll to zoom')}</span>
        </div>
      </footer>
    </div>
  );
}

export default ReaderWorkspace;

