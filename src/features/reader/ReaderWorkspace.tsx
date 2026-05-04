import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import BlockViewer from '../blocks/BlockViewer';
import PdfViewer from '../pdf/PdfViewer';
import { useLocaleText } from '../../i18n/uiLanguage';
import { AssistantSidebar } from './AssistantSidebar';
import { ReaderWorkspaceOverview } from './readerWorkspaceOverview';
import { buildReaderAssistantSidebarProps } from './readerAssistantSidebarProps';
import { ReaderWorkspaceHeader } from './readerWorkspaceHeader';
import { FloatingAssistantPanel, SelectionQuickActions } from './readerWorkspaceOverlays';
import {
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  formatReaderDocumentSource,
  loadStoredNumber,
  type ReaderWorkspaceDocument,
} from './readerWorkspaceShared';
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
  translationLanguageLabel: string;
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
  onTranslationDisplayModeChange: (mode: TranslationDisplayMode) => void;
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

function ReadingStage(props: ReaderWorkspaceProps) {
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
    pdfAnnotationSaveDirectory,
    originalPdfPath,
    onStartResize,
    onResetLayout,
    onPdfBlockHover,
    onPdfBlockSelect,
    onBlockClick,
    onTextSelect,
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
  const documentSource = formatReaderDocumentSource(l, currentDocument, selectedSectionTitle);
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

  const sharedAssistantSidebarProps = buildReaderAssistantSidebarProps({
    l,
    activePanel: assistantActivePanel,
    onActivePanelChange: onAssistantActivePanelChange,
    currentDocument,
    documentSource,
    currentPdfName,
    currentJsonName,
    blockCount: blocks.length,
    translatedCount,
    statusMessage,
    hasBlocks,
    aiConfigured,
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
    selectedExcerpt,
    selectedExcerptTranslation,
    selectedExcerptTranslating,
    selectedExcerptError,
    onAppendSelectedExcerptToQa,
    activeBlockSummary: props.activeBlockSummary,
    workspaceNoteMarkdown,
    annotations,
    zoteroRelatedNotes,
    zoteroRelatedNotesLoading,
    zoteroRelatedNotesError,
    onWorkspaceNoteChange,
    onAppendSelectedExcerptToNote,
    onCreateAnnotation,
    onDeleteAnnotation,
    onSelectAnnotation,
    onTranslateSelectedExcerpt,
    onClearSelectedExcerpt,
    onOpenPreferences: props.onOpenPreferences,
  });

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
                  translationLanguageLabel={props.translationLanguageLabel}
                  activeBlockId={activeBlockId}
                  hoveredBlockId={hoveredBlockId}
                  scrollSignal={blockScrollSignal}
                  compactMode={compactReading}
                  showBlockMeta={showBlockMeta}
                  hidePageDecorations={hidePageDecorationsInBlockView}
                  smoothScroll={smoothScroll}
                  onBlockClick={onBlockClick}
                  onTranslationDisplayModeChange={props.onTranslationDisplayModeChange}
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
              {...sharedAssistantSidebarProps}
              panelWidth={assistantPanelWidth}
              chatLayoutMode="compact"
              onDetach={onDetachAssistant}
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
  const sourceLabel =
    formatReaderDocumentSource(l, currentDocument, selectedSectionTitle);
  const floatingAssistantSidebarProps = buildReaderAssistantSidebarProps({
    l,
    activePanel: props.assistantActivePanel,
    onActivePanelChange: props.onAssistantActivePanelChange,
    currentDocument: props.currentDocument,
    documentSource: sourceLabel,
    currentPdfName: props.currentPdfName,
    currentJsonName: props.currentJsonName,
    blockCount: props.blocks.length,
    translatedCount: props.translatedCount,
    statusMessage: props.statusMessage,
    hasBlocks: props.blocks.length > 0,
    aiConfigured: props.aiConfigured,
    qaSessions: props.qaSessions,
    selectedQaSessionId: props.selectedQaSessionId,
    qaMessages: props.qaMessages,
    qaInput: props.qaInput,
    qaAttachments: props.qaAttachments,
    qaModelPresets: props.qaModelPresets,
    selectedQaPresetId: props.selectedQaPresetId,
    qaLoading: props.qaLoading,
    qaError: props.qaError,
    screenshotLoading: props.screenshotLoading,
    onQaInputChange: props.onQaInputChange,
    onQaSubmit: props.onQaSubmit,
    onQaPresetChange: props.onQaPresetChange,
    onQaSessionCreate: props.onQaSessionCreate,
    onQaSessionSelect: props.onQaSessionSelect,
    onQaSessionDelete: props.onQaSessionDelete,
    onSelectImageAttachments: props.onSelectImageAttachments,
    onSelectFileAttachments: props.onSelectFileAttachments,
    onCaptureScreenshot: props.onCaptureScreenshot,
    onRemoveAttachment: props.onRemoveAttachment,
    selectedExcerpt: props.selectedExcerpt,
    selectedExcerptTranslation: props.selectedExcerptTranslation,
    selectedExcerptTranslating: props.selectedExcerptTranslating,
    selectedExcerptError: props.selectedExcerptError,
    onAppendSelectedExcerptToQa: props.onAppendSelectedExcerptToQa,
    activeBlockSummary: props.activeBlockSummary,
    workspaceNoteMarkdown: props.workspaceNoteMarkdown,
    annotations: props.annotations,
    zoteroRelatedNotes: props.zoteroRelatedNotes,
    zoteroRelatedNotesLoading: props.zoteroRelatedNotesLoading,
    zoteroRelatedNotesError: props.zoteroRelatedNotesError,
    onWorkspaceNoteChange: props.onWorkspaceNoteChange,
    onAppendSelectedExcerptToNote: props.onAppendSelectedExcerptToNote,
    onCreateAnnotation: props.onCreateAnnotation,
    onDeleteAnnotation: props.onDeleteAnnotation,
    onSelectAnnotation: props.onSelectAnnotation,
    onTranslateSelectedExcerpt: props.onTranslateSelectedExcerpt,
    onClearSelectedExcerpt: props.onClearSelectedExcerpt,
    onOpenPreferences: props.onOpenPreferences,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)] dark:bg-[linear-gradient(180deg,#0f1a2e,#0c1525)]">
      <ReaderWorkspaceHeader
        sourceLabel={sourceLabel}
        documentTitle={currentDocument.title}
        documentCreators={currentDocument.creators}
        documentYear={currentDocument.year}
        currentPdfName={currentPdfName}
        currentPdfVariantLabel={currentPdfVariantLabel}
        currentPdfPath={currentPdfPath}
        availablePdfOptions={availablePdfOptions}
        workspaceStage={workspaceStage}
        readingViewMode={readingViewMode}
        loading={loading}
        translating={translating}
        onStageChange={onStageChange}
        onReadingViewModeChange={onReadingViewModeChange}
        onCurrentPdfPathChange={onCurrentPdfPathChange}
        onOpenMineruJson={onOpenMineruJson}
        onCloudParse={onCloudParse}
        onTranslateDocument={onTranslateDocument}
        onOpenPreferences={onOpenPreferences}
      />

      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-600 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-400">
          {error}
        </div>
      ) : null}

      {workspaceStage === 'overview' ? (
        <ReaderWorkspaceOverview
          currentDocument={props.currentDocument}
          selectedSectionTitle={props.selectedSectionTitle}
          currentPdfName={props.currentPdfName}
          currentJsonName={props.currentJsonName}
          loading={props.loading}
          translating={props.translating}
          blocks={props.blocks}
          translationProgressCompleted={props.translationProgressCompleted}
          translationProgressTotal={props.translationProgressTotal}
          paperSummary={props.paperSummary}
          paperSummaryLoading={props.paperSummaryLoading}
          paperSummaryError={props.paperSummaryError}
          onGenerateSummary={props.onGenerateSummary}
          onEnterReading={() => props.onStageChange('reading')}
          onOpenMineruJson={props.onOpenMineruJson}
          onCloudParse={props.onCloudParse}
          onTranslateDocument={props.onTranslateDocument}
          aiConfigured={props.aiConfigured}
        />
      ) : (
        <ReadingStage {...props} />
      )}

      {assistantDetached ? (
        <FloatingAssistantPanel
          title={currentDocument.title}
          onAttachAssistant={props.onAttachAssistant}
          sidebarProps={floatingAssistantSidebarProps}
        />
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

