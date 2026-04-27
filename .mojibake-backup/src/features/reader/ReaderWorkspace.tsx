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
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import BlockViewer from '../blocks/BlockViewer';
import PdfViewer from '../pdf/PdfViewer';
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

function loadStoredBoolean(key: string, fallback = false): boolean {
  try {
    const rawValue = localStorage.getItem(key);

    return rawValue === null ? fallback : rawValue === 'true';
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
  documentSearchQuery: string;
  documentSearchInputRef: RefObject<HTMLInputElement>;
  onDocumentSearchQueryChange: (value: string) => void;
  documentSearchCursor: number;
  documentSearchMatchCount: number;
  onDocumentSearchStep: (direction: 1 | -1) => void;
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
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
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
          {label || '澶勭悊涓?}
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
  const sourceLabel = selectedExcerpt.source === 'pdf' ? 'PDF 划词' : '正文划词';
  const translationLabel = selectedExcerptTranslating
    ? '濮濓絽婀紙鏄忕槯闁鑵戦弬鍥ㄦ拱閳?
    : selectedExcerptError
      ? selectedExcerptError
      : selectedExcerptTranslation.trim()
        ? selectedExcerptTranslation
        : aiConfigured
          ? autoTranslateSelection
            ? '瀹稿弶宕熼懢宄板灊鐠囧稄绱濈粙宥呮倵娴兼艾婀潻娆撳櫡閺勫墽銇氱拠鎴炴瀮閵?
            : '宸叉崟鑾峰垝璇嶏紝鐐瑰嚮鈥滅珛鍗崇炕璇戔€濆悗鏄剧ず璇戞枃銆?
          : '閰嶇疆妯″瀷鍚庯紝杩欓噷浼氱洿鎺ユ樉绀哄垝璇嶇炕璇戙€?;

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
            aria-label="关闭划词浮层"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            划词翻译
          </div>
          <div className="text-sm leading-6 text-slate-700">{translationLabel}</div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onAppendSelectedExcerptToQa}
            className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
          >
            加入问答
          </button>
          <button
            type="button"
            onClick={onTranslateSelectedExcerpt}
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
          >
            {selectedExcerptTranslation.trim() ? '重新翻译' : '立即翻译'}
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
            浮动 AI 面板
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
            停靠右侧
          </button>
          <button
            type="button"
            onClick={onAttachAssistant}
            aria-label="关闭 AI 浮动面板"
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
        documentMeta={`${currentDocument.creators || '鏈煡浣滆€?}${currentDocument.year ? ` 璺?${currentDocument.year}` : ''}`}
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
  const {
    currentDocument,
    selectedSectionTitle,
    currentPdfName,
    currentJsonName,
    translatedCount,
    loading,
    translating,
    blocks,
    paperSummary,
    paperSummaryLoading,
    paperSummaryError,
    onGenerateSummary,
    onStageChange,
    onOpenMineruJson,
    onCloudParse,
    onTranslateDocument,
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
    aiConfigured,
  } = props;

  const sourceLabel =
    currentDocument.source === 'standalone'
      ? '独立文稿'
      : `本地文库 / ${selectedSectionTitle}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(248,250,252,0.78))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                  论文概览
                </div>
                <h2 className="mt-4 text-[30px] font-semibold tracking-tight text-slate-950">
                  {currentDocument.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{currentDocument.creators || '鏈煡浣滆€?}</span>
                  {currentDocument.year ? <span>璺?{currentDocument.year}</span> : null}
                  <span>璺?{sourceLabel}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    PDF：{currentPdfName}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                    JSON：{currentJsonName}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onStageChange('reading')}
                  className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                >
                  立即进入阅读
                  <ArrowRight className="ml-2 h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onTranslateDocument}
                  disabled={loading || translating || blocks.length === 0}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Languages className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {translating ? '缈昏瘧涓€? : '全文翻译'}
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="缁撴瀯鍧?
              value={String(blocks.length)}
              detail="宸插缓绔?bbox 联动"
              icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.8} />}
            />
            <StatTile
              label="璇戞枃鍧?
              value={String(translatedCount)}
              detail="支持原文 / 译文 / 双语"
              icon={<Languages className="h-4 w-4" strokeWidth={1.8} />}
            />
            <StatTile
              label="PDF"
              value={currentPdfName === '未打开' ? '未打开' : '宸插姞杞?}
              detail={currentPdfName}
              icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
            />
            <StatTile
              label="MinerU JSON"
              value={currentJsonName === '鏈姞杞? ? '鏈姞杞? : '宸插姞杞?}
              detail={currentJsonName}
              icon={<FileJson className="h-4 w-4" strokeWidth={1.8} />}
            />
          </div>

          <SummaryPanel
            paperSummary={paperSummary}
            loading={paperSummaryLoading}
            error={paperSummaryError}
            hasBlocks={blocks.length > 0}
            aiConfigured={aiConfigured}
            onGenerateSummary={onGenerateSummary}
          />
        </div>

        <div className="space-y-5">
          <SectionCard
            title="阅读入口"
            description="鍏堣仛鍚堜俊鎭紝鍐嶈繘鍏ュ嚑浣曡仈鍔ㄩ槄璇汇€?
            icon={<ScanSearch className="h-4 w-4" strokeWidth={1.8} />}
            contentClassName="space-y-4"
          >
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600">
              单击文献先进入概览，双击可直接进入阅读。当前阶段适合先看摘要、做问题拆解，再进入 PDF 鍜岀粨鏋勫潡鐨勫弻鍚戣仈鍔ㄨ鍥俱€?
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenMineruJson}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <FileJson className="mr-2 h-4 w-4" strokeWidth={1.8} />
                加载 JSON
              </button>
              <button
                type="button"
                onClick={onCloudParse}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <Sparkles className="mr-2 h-4 w-4" strokeWidth={1.8} />
                云端解析
              </button>
            </div>
            <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-7 text-slate-500">
              {loading || translating
                ? '鏂囩浠嶅湪澶勭悊涓紝璇风◢鍊欍€?
                : blocks.length > 0
                  ? '缁撴瀯鍧楀凡缁忓噯澶囧ソ锛屽彲浠ョ洿鎺ヨ繘鍏ラ槄璇诲苟杩涜鍑犱綍鑱斿姩銆?
                  : '当前还没有结构化内容，建议先加载 JSON 鎴栬皟鐢?MinerU 浜戠瑙ｆ瀽銆?}
            </div>
          </SectionCard>

          <ChatWorkspacePanel
            sessions={qaSessions}
            selectedSessionId={selectedQaSessionId}
            messages={qaMessages}
            input={qaInput}
            loading={qaLoading}
            error={qaError}
            hasBlocks={blocks.length > 0}
            selectedExcerpt={selectedExcerpt}
            attachments={qaAttachments}
            qaModelPresets={qaModelPresets}
            selectedQaPresetId={selectedQaPresetId}
            screenshotLoading={screenshotLoading}
            layoutMode="workspace"
            onInputChange={onQaInputChange}
            onSubmit={onQaSubmit}
            onQaPresetChange={onQaPresetChange}
            onSessionCreate={onQaSessionCreate}
            onSessionSelect={onQaSessionSelect}
            onSessionDelete={onQaSessionDelete}
            onAppendSelectedExcerpt={onAppendSelectedExcerptToQa}
            onSelectImageAttachments={onSelectImageAttachments}
            onSelectFileAttachments={onSelectFileAttachments}
            onCaptureScreenshot={onCaptureScreenshot}
            onRemoveAttachment={onRemoveAttachment}
          />
        </div>
      </div>
    </div>
  );
}

function CompactOverviewStage(props: ReaderWorkspaceProps) {
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
      ? '独立文献'
      : `本地文库 / ${selectedSectionTitle}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-[30px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(248,250,252,0.78))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
                  论文概览
                </div>
                <h2 className="mt-4 text-[30px] font-semibold tracking-tight text-slate-950">
                  {currentDocument.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{currentDocument.creators || '鏈煡浣滆€?}</span>
                  {currentDocument.year ? <span>璺?{currentDocument.year}</span> : null}
                  <span>璺?{sourceLabel}</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onStageChange('reading')}
                  className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-slate-800"
                >
                  进入阅读
                  <ArrowRight className="ml-2 h-4 w-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onTranslateDocument}
                  disabled={loading || translating || blocks.length === 0}
                  className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Languages className="mr-2 h-4 w-4" strokeWidth={1.8} />
                  {translating ? '缈昏瘧涓? : '全文翻译'}
                </button>
              </div>
            </div>
          </section>

          {translating ? (
            <InlineProgressBar
              completed={translationProgressCompleted}
              total={translationProgressTotal}
              label="MinerU 閸ф鐐曠拠鎴ｇ箻鎼?
            />
          ) : null}

          <SummaryPanel
            paperSummary={paperSummary}
            loading={paperSummaryLoading}
            error={paperSummaryError}
            hasBlocks={blocks.length > 0}
            aiConfigured={aiConfigured}
            onGenerateSummary={onGenerateSummary}
          />
        </div>

        <div className="space-y-5">
          <SectionCard
            title="论文信息"
            description="姒傝椤靛彧淇濈暀鏍稿績鍏冩暟鎹笌闃呰鍏ュ彛銆?
            icon={<ScanSearch className="h-4 w-4" strokeWidth={1.8} />}
            contentClassName="space-y-4"
          >
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                标题
              </div>
              <div className="mt-2 text-base font-semibold leading-7 text-slate-950">
                {currentDocument.title}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                娴ｆ粏鈧?/ 年份
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700">
                {currentDocument.creators || '鏈煡浣滆€?}
                {currentDocument.year ? ` 璺?${currentDocument.year}` : ''}
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                来源
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{sourceLabel}</div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileText className="h-4 w-4" strokeWidth={1.8} />
                PDF
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">{currentPdfName}</div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <FileJson className="h-4 w-4" strokeWidth={1.8} />
                MinerU JSON
              </div>
              <div className="mt-2 break-words text-sm leading-6 text-slate-700">{currentJsonName}</div>
            </div>

            <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 text-sm leading-7 text-slate-600">
              {loading || translating
                ? '褰撳墠鏂囨。浠嶅湪澶勭悊涓€?
                : blocks.length > 0
                  ? `瑜版挸澧犲鎻掑鏉?${blocks.length} 个结构块，可直接进入联动阅读。`
                  : '当前还没有结构化内容，可以先加载 JSON 鎴栧彂璧?MinerU 瑙ｆ瀽銆?}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenMineruJson}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <FileJson className="mr-2 h-4 w-4" strokeWidth={1.8} />
                加载 JSON
              </button>
              <button
                type="button"
                onClick={onCloudParse}
                disabled={loading}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <Sparkles className="mr-2 h-4 w-4" strokeWidth={1.8} />
                MinerU 解析
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
  const {
    blocks,
    readingViewMode,
    translations,
    translationDisplayMode,
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
    documentSearchQuery,
    documentSearchInputRef,
    documentSearchCursor,
    documentSearchMatchCount,
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
    canOpenOriginalPdf,
    onOpenOriginalPdf,
    currentPdfPath,
    availablePdfOptions,
    onCurrentPdfPathChange,
    pdfAnnotationSaveDirectory,
    originalPdfPath,
    onDocumentSearchQueryChange,
    onDocumentSearchStep,
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
    onReadingViewModeChange,
    onPdfAnnotationSaveSuccess,
    onWorkspaceNoteChange,
    onCreateAnnotation,
    onDeleteAnnotation,
    onSelectAnnotation,
    aiConfigured,
    assistantDetached,
    assistantActivePanel,
    onAssistantActivePanelChange,
    onDetachAssistant,
    headerCollapsed,
  } = props;

  const documentSource =
    currentDocument.source === 'standalone'
      ? '独立文稿'
      : `本地文库 / ${selectedSectionTitle}`;
  const hasBlocks = blocks.length > 0;
  const showAssistantSidebar = !assistantDetached;
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

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div hidden
          className={cn(
            'border-b border-slate-200/80 bg-white/72 backdrop-blur-xl transition-all duration-200',
            headerCollapsed ? 'px-4 py-2.5' : 'px-5 py-3',
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={cn(
                'flex flex-1 items-center gap-3 rounded-xl border border-white/70 bg-white/78 shadow-[0_8px_18px_rgba(15,23,42,0.04)] backdrop-blur-xl',
                headerCollapsed ? 'min-w-[260px] px-3 py-2' : 'min-w-[320px] px-4 py-2.5',
              )}
            >
              <Search className="h-4 w-4 text-slate-400" strokeWidth={1.8} />
              <input
                ref={documentSearchInputRef}
                value={documentSearchQuery}
                onChange={(event) => onDocumentSearchQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onDocumentSearchStep(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="閹兼粎鍌ㄩ崢鐔告瀮閹存牞鐦ч弬鍥у敶鐎?
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              <span className="text-xs font-medium text-slate-400">
                {documentSearchMatchCount > 0
                  ? `${Math.max(documentSearchCursor + 1, 0)}/${documentSearchMatchCount}`
                  : '0/0'}
              </span>
              <button
                type="button"
                onClick={() => onDocumentSearchStep(-1)}
                className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 transition-all duration-200 hover:bg-slate-100"
              >
                涓婁竴澶?
              </button>
              <button
                type="button"
                onClick={() => onDocumentSearchStep(1)}
                className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 transition-all duration-200 hover:bg-slate-100"
              >
                涓嬩竴澶?
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                PDF：{currentPdfName}
              </span>
              {hasBlocks ? (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  JSON：{currentJsonName}
                </span>
              ) : null}
              {hasBlocks ? (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  译文：{translatedCount}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200/70 bg-white/72 px-4 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="hidden inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {[
                {
                  key: 'linked' as const,
                  label: '联动阅读',
                  icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />,
                },
                {
                  key: 'pdf-annotate' as const,
                  label: 'PDF 批注',
                  icon: <PenTool className="h-4 w-4" strokeWidth={1.8} />,
                },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => onReadingViewModeChange(mode.key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-medium transition-all duration-200',
                    readingViewMode === mode.key
                      ? 'bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.08)]'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {mode.icon}
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                PDF Version
              </div>
              <div className="min-w-[240px] max-w-[520px] flex-1">
                <select
                  value={currentPdfPath}
                  onChange={(event) => onCurrentPdfPathChange(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all duration-200 hover:border-slate-300 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {availablePdfOptions.map((option) => (
                    <option key={option.path} value={option.path}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {currentPdfVariantLabel ? (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  {currentPdfVariantLabel}
                </span>
              ) : null}
            </div>

            <div className="hidden text-xs text-slate-500">
              {true
                ? '鐩存帴鍦?PDF 涓婂垱寤烘爣鍑嗘壒娉紝骞跺彟瀛樹负鏂扮殑鎵规敞鐗?PDF 鏂囦欢銆?
                : '保持 MinerU 鍑犱綍鑱斿姩銆佸潡绾ц烦杞拰褰撳墠缁撴瀯鍖栭槄璇讳綋楠屻€?}
            </div>
          </div>
          {translating ? (
            <div className="mt-3">
              <InlineProgressBar
                completed={translationProgressCompleted}
                total={translationProgressTotal}
                label="MinerU 閸ф鐐曠拠鎴ｇ箻鎼?
              />
            </div>
          ) : null}
        </div>

        <div ref={layoutRef} className="flex min-h-0 flex-1">
          <section
            className="min-h-0 min-w-0 bg-[#eef3f9] transition-all duration-300"
            style={{
              width: hasBlocks ? `calc(${(leftPaneWidthRatio * 100).toFixed(2)}% - 4px)` : '100%',
            }}
          >
            {false ? (
              <Suspense
                fallback={
                  <div className="flex h-full min-h-0 items-center justify-center bg-[linear-gradient(180deg,#eff4fb,#e9f0f7)] px-6 py-8">
                    <div className="rounded-full border border-white/70 bg-white/92 px-4 py-2 text-sm text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                      正在加载 PDF 閹佃鏁炲Ο鈥虫健閳?                    </div>
                  </div>
                }
              >
                <PdfAnnotationWorkspace
                  source={pdfSource}
                  pdfData={pdfData}
                  currentPdfName={currentPdfName}
                  defaultSaveDirectory={pdfAnnotationSaveDirectory}
                  originalPdfPath={originalPdfPath}
                  onTextSelect={handlePdfTextSelect}
                  onClearSelectedExcerpt={onClearSelectedExcerpt}
                  onSaveSuccess={onPdfAnnotationSaveSuccess}
                />
              </Suspense>
            ) : (
              <PdfViewer
                source={pdfSource}
                pdfData={pdfData}
                currentPdfName={currentPdfName}
                defaultSaveDirectory={pdfAnnotationSaveDirectory}
                originalPdfPath={originalPdfPath}
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
            )}
          </section>

          {hasBlocks ? (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="调整阅读分栏"
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

              <section className="min-h-0 min-w-0 flex-1 bg-[#f7f9fc] transition-all duration-300">
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
        <aside className="ml-auto flex min-h-0 shrink-0 self-stretch transition-all duration-300">
          <AssistantSidebar
            activePanel={assistantActivePanel}
            onActivePanelChange={onAssistantActivePanelChange}
            documentTitle={currentDocument.title}
            documentMeta={`${currentDocument.creators || '鏈煡浣滆€?}${currentDocument.year ? ` 璺?${currentDocument.year}` : ''}`}
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
  const {
    currentDocument,
    selectedSectionTitle,
    currentPdfName,
    workspaceStage,
    onStageChange,
    loading,
    translating,
    error,
    statusMessage,
    activeBlockSummary,
    currentPdfVariantLabel,
    canOpenOriginalPdf,
    onOpenOriginalPdf,
    onOpenStandalonePdf,
    onOpenMineruJson,
    onCloudParse,
    onTranslateDocument,
    onOpenPreferences,
    leftSidebarCollapsed,
    onToggleLeftSidebar,
    assistantActivePanel,
    assistantDetached,
    showLibraryToggle = true,
  } = props;
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(() =>
    loadStoredBoolean(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, false),
  );
  const assistantSidebarCollapsed = assistantActivePanel === null;

  const sourceLabel =
    currentDocument.source === 'standalone'
      ? '独立文稿'
      : `本地文库 / ${selectedSectionTitle}`;

  useEffect(() => {
    localStorage.setItem(WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY, String(headerCollapsed));
  }, [headerCollapsed]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)]">
      <div
        className={cn(
          'border-b border-slate-200/80 bg-white/70 backdrop-blur-xl transition-all duration-200',
          headerCollapsed ? 'px-4 py-2' : 'px-6 py-4',
        )}
      >
        <div
          className={cn(
            'flex flex-wrap justify-between gap-4',
            headerCollapsed ? 'items-center' : 'items-start',
          )}
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {sourceLabel}
            </div>
            <div
              className={cn(
                'truncate font-semibold tracking-tight text-slate-950 transition-all duration-200',
                headerCollapsed ? 'mt-0.5 max-w-[720px] text-base' : 'mt-2 text-[24px]',
              )}
            >
              {currentDocument.title}
            </div>
            {!headerCollapsed ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>{currentDocument.creators || 'Unknown Author'}</span>
                {currentDocument.year ? <span>璺?{currentDocument.year}</span> : null}
                {currentPdfName ? <span>璺?{currentPdfName}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {[
                { key: 'overview' as const, label: '概览', icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} /> },
                { key: 'reading' as const, label: '阅读', icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.8} /> },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onStageChange(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[14px] px-3 py-2 text-sm font-medium transition-all duration-200',
                    workspaceStage === tab.key
                      ? 'bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.08)]'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {false ? (
              <button
                type="button"
                onClick={onToggleLeftSidebar}
                className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
              >
                {leftSidebarCollapsed ? (
                  <PanelLeftOpen className="mr-2 h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <PanelLeftClose className="mr-2 h-4 w-4" strokeWidth={1.8} />
                )}
                {leftSidebarCollapsed ? '展开导航' : '折叠导航'}
              </button>
            ) : null}

            {false ? (
              <button
                type="button"
                onClick={() => undefined}
                className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
              >
                {assistantActivePanel === null ? (
                  <PanelRightOpen className="mr-2 h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <PanelRightClose className="mr-2 h-4 w-4" strokeWidth={1.8} />
                )}
                {assistantSidebarCollapsed ? '展开 AI' : '折叠 AI'}
              </button>
            ) : null}

            {false ? (
              <button
                type="button"
                onClick={onOpenOriginalPdf}
                className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                title={
                  currentPdfVariantLabel
                    ? `打开原版 PDF（当前：${currentPdfVariantLabel}）`
                    : '打开原版 PDF'
                }
              >
                <FileText className="mr-2 h-4 w-4" strokeWidth={1.8} />
                原版 PDF
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setHeaderCollapsed((current) => !current)}
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
              title={headerCollapsed ? '展开状态栏' : '收起状态栏'}
            >
              {headerCollapsed ? (
                <ChevronDown className="mr-2 h-4 w-4" strokeWidth={1.8} />
              ) : (
                <ChevronUp className="mr-2 h-4 w-4" strokeWidth={1.8} />
              )}
              {headerCollapsed ? '展开状态栏' : '收起状态栏'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setToolbarOpen((current) => !current)}
                className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
              >
                <MoreHorizontal className="mr-2 h-4 w-4" strokeWidth={1.8} />
                工具
                <ChevronDown className="ml-2 h-4 w-4" strokeWidth={1.8} />
              </button>

              {toolbarOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_18px_42px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  {[
                    {
                      label: '打开 PDF',
                      icon: <FileText className="h-4 w-4" strokeWidth={1.8} />,
                      onClick: onOpenStandalonePdf,
                      disabled: false,
                    },
                    {
                      label: '加载 JSON',
                      icon: <FileJson className="h-4 w-4" strokeWidth={1.8} />,
                      onClick: onOpenMineruJson,
                      disabled: loading,
                    },
                    {
                      label: '云端解析',
                      icon: <Sparkles className="h-4 w-4" strokeWidth={1.8} />,
                      onClick: onCloudParse,
                      disabled: loading,
                    },
                    {
                      label: translating ? '缈昏瘧涓€? : '全文翻译',
                      icon: <Languages className="h-4 w-4" strokeWidth={1.8} />,
                      onClick: onTranslateDocument,
                      disabled: loading || translating,
                    },
                    {
                      label: '偏好设置',
                      icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
                      onClick: onOpenPreferences,
                      disabled: false,
                    },
                  ]
                    .filter((action) => action.onClick !== onOpenStandalonePdf)
                    .map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setToolbarOpen(false);
                        action.onClick();
                      }}
                      disabled={action.disabled}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-600">
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

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200/80 bg-white/70 px-6 py-2.5 text-xs text-slate-500 backdrop-blur-xl">
        <div className="min-w-0 truncate">
          {loading || translating ? '澶勭悊涓€? : statusMessage}
        </div>
        <div className="hidden items-center gap-4 xl:flex">
          <span>{activeBlockSummary}</span>
          <span>閸楁洖鍤鍌濐潔閿涘苯寮婚崙濠氭鐠?/span>
          <span>Ctrl + 滚轮缩放</span>
        </div>
      </footer>
    </div>
  );
}

export default ReaderWorkspace;
