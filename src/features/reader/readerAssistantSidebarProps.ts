import type { AssistantSidebarCoreProps } from './AssistantSidebar';
import type { AssistantPanelKey } from '../../types/reader';
import type { LocaleTextFn, ReaderWorkspaceDocument } from './readerWorkspaceShared';
import { formatReaderDocumentMeta } from './readerWorkspaceShared';

export interface BuildReaderAssistantSidebarInput {
  l: LocaleTextFn;
  activePanel: AssistantPanelKey;
  onActivePanelChange: (panel: AssistantPanelKey) => void;
  currentDocument: ReaderWorkspaceDocument;
  documentSource: string;
  currentPdfName: string;
  currentJsonName: string;
  blockCount: number;
  translatedCount: number;
  statusMessage: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  notes: AssistantSidebarCoreProps['notes'];
  activeNoteId: AssistantSidebarCoreProps['activeNoteId'];
  notesLoading: AssistantSidebarCoreProps['notesLoading'];
  notesSaving: AssistantSidebarCoreProps['notesSaving'];
  notesError: AssistantSidebarCoreProps['notesError'];
  pendingAnchorInsert: AssistantSidebarCoreProps['pendingAnchorInsert'];
  onPendingAnchorInsertHandled: AssistantSidebarCoreProps['onPendingAnchorInsertHandled'];
  noteEditorSourceId: AssistantSidebarCoreProps['noteEditorSourceId'];
  externalUpdateNote: AssistantSidebarCoreProps['externalUpdateNote'];
  onExternalUpdateApply: AssistantSidebarCoreProps['onExternalUpdateApply'];
  qaSessions: AssistantSidebarCoreProps['qaSessions'];
  selectedQaSessionId: AssistantSidebarCoreProps['selectedQaSessionId'];
  qaMessages: AssistantSidebarCoreProps['qaMessages'];
  qaInput: AssistantSidebarCoreProps['qaInput'];
  qaAttachments: AssistantSidebarCoreProps['qaAttachments'];
  qaModelPresets: AssistantSidebarCoreProps['qaModelPresets'];
  selectedQaPresetId: AssistantSidebarCoreProps['selectedQaPresetId'];
  qaRagEnabled: AssistantSidebarCoreProps['qaRagEnabled'];
  qaAnswerRenderMode: AssistantSidebarCoreProps['qaAnswerRenderMode'];
  qaReasoningEffort: AssistantSidebarCoreProps['qaReasoningEffort'];
  qaLoading: AssistantSidebarCoreProps['qaLoading'];
  qaError: AssistantSidebarCoreProps['qaError'];
  screenshotLoading: NonNullable<AssistantSidebarCoreProps['screenshotLoading']>;
  onQaInputChange: AssistantSidebarCoreProps['onQaInputChange'];
  onQaSubmit: AssistantSidebarCoreProps['onQaSubmit'];
  onQaPresetChange: AssistantSidebarCoreProps['onQaPresetChange'];
  onQaRagEnabledChange: AssistantSidebarCoreProps['onQaRagEnabledChange'];
  onQaAnswerRenderModeChange: AssistantSidebarCoreProps['onQaAnswerRenderModeChange'];
  onQaReasoningEffortChange: AssistantSidebarCoreProps['onQaReasoningEffortChange'];
  onQaSessionCreate: AssistantSidebarCoreProps['onQaSessionCreate'];
  onQaSessionSelect: AssistantSidebarCoreProps['onQaSessionSelect'];
  onQaSessionDelete: AssistantSidebarCoreProps['onQaSessionDelete'];
  onSelectImageAttachments: AssistantSidebarCoreProps['onSelectImageAttachments'];
  onSelectFileAttachments: AssistantSidebarCoreProps['onSelectFileAttachments'];
  onCaptureScreenshot: AssistantSidebarCoreProps['onCaptureScreenshot'];
  onRemoveAttachment: AssistantSidebarCoreProps['onRemoveAttachment'];
  onCitationClick: AssistantSidebarCoreProps['onCitationClick'];
  onCreateStandaloneNote: AssistantSidebarCoreProps['onCreateStandaloneNote'];
  onSelectNote: AssistantSidebarCoreProps['onSelectNote'];
  onUpdateNote: AssistantSidebarCoreProps['onUpdateNote'];
  onDeleteNote: AssistantSidebarCoreProps['onDeleteNote'];
  onJumpToNoteAnchor: AssistantSidebarCoreProps['onJumpToNoteAnchor'];
  onAddSelectionToNote: AssistantSidebarCoreProps['onAddSelectionToNote'];
  onSaveAssistantMessageAsNote: AssistantSidebarCoreProps['onSaveAssistantMessageAsNote'];
  selectedExcerpt: AssistantSidebarCoreProps['selectedExcerpt'];
  selectedExcerptTranslation: AssistantSidebarCoreProps['selectedExcerptTranslation'];
  selectedExcerptTranslating: AssistantSidebarCoreProps['selectedExcerptTranslating'];
  selectedExcerptError: AssistantSidebarCoreProps['selectedExcerptError'];
  onAppendSelectedExcerptToQa: AssistantSidebarCoreProps['onAppendSelectedExcerptToQa'];
  onTranslateSelectedExcerpt: AssistantSidebarCoreProps['onTranslateSelectedExcerpt'];
  onClearSelectedExcerpt: AssistantSidebarCoreProps['onClearSelectedExcerpt'];
  onOpenPreferences: NonNullable<AssistantSidebarCoreProps['onOpenPreferences']>;
}

export function buildReaderAssistantSidebarProps(
  input: BuildReaderAssistantSidebarInput,
): AssistantSidebarCoreProps {
  return {
    activePanel: input.activePanel,
    onActivePanelChange: input.onActivePanelChange,
    documentTitle: input.currentDocument.title,
    documentMeta: formatReaderDocumentMeta(input.l, input.currentDocument),
    documentSource: input.documentSource,
    documentPdfName: input.currentPdfName,
    documentJsonName: input.currentJsonName,
    blockCount: input.blockCount,
    translatedCount: input.translatedCount,
    statusMessage: input.statusMessage,
    hasBlocks: input.hasBlocks,
    aiConfigured: input.aiConfigured,
    notes: input.notes,
    activeNoteId: input.activeNoteId,
    notesLoading: input.notesLoading,
    notesSaving: input.notesSaving,
    notesError: input.notesError,
    pendingAnchorInsert: input.pendingAnchorInsert,
    onPendingAnchorInsertHandled: input.onPendingAnchorInsertHandled,
    noteEditorSourceId: input.noteEditorSourceId,
    externalUpdateNote: input.externalUpdateNote,
    onExternalUpdateApply: input.onExternalUpdateApply,
    qaSessions: input.qaSessions,
    selectedQaSessionId: input.selectedQaSessionId,
    qaMessages: input.qaMessages,
    qaInput: input.qaInput,
    qaAttachments: input.qaAttachments,
    qaModelPresets: input.qaModelPresets,
    selectedQaPresetId: input.selectedQaPresetId,
    qaRagEnabled: input.qaRagEnabled,
    qaAnswerRenderMode: input.qaAnswerRenderMode,
    qaReasoningEffort: input.qaReasoningEffort,
    qaLoading: input.qaLoading,
    qaError: input.qaError,
    screenshotLoading: input.screenshotLoading,
    onQaInputChange: input.onQaInputChange,
    onQaSubmit: input.onQaSubmit,
    onQaPresetChange: input.onQaPresetChange,
    onQaRagEnabledChange: input.onQaRagEnabledChange,
    onQaAnswerRenderModeChange: input.onQaAnswerRenderModeChange,
    onQaReasoningEffortChange: input.onQaReasoningEffortChange,
    onQaSessionCreate: input.onQaSessionCreate,
    onQaSessionSelect: input.onQaSessionSelect,
    onQaSessionDelete: input.onQaSessionDelete,
    onSelectImageAttachments: input.onSelectImageAttachments,
    onSelectFileAttachments: input.onSelectFileAttachments,
    onCaptureScreenshot: input.onCaptureScreenshot,
    onRemoveAttachment: input.onRemoveAttachment,
    onCitationClick: input.onCitationClick,
    onCreateStandaloneNote: input.onCreateStandaloneNote,
    onSelectNote: input.onSelectNote,
    onUpdateNote: input.onUpdateNote,
    onDeleteNote: input.onDeleteNote,
    onJumpToNoteAnchor: input.onJumpToNoteAnchor,
    onAddSelectionToNote: input.onAddSelectionToNote,
    onSaveAssistantMessageAsNote: input.onSaveAssistantMessageAsNote,
    selectedExcerpt: input.selectedExcerpt,
    selectedExcerptTranslation: input.selectedExcerptTranslation,
    selectedExcerptTranslating: input.selectedExcerptTranslating,
    selectedExcerptError: input.selectedExcerptError,
    onAppendSelectedExcerptToQa: input.onAppendSelectedExcerptToQa,
    onTranslateSelectedExcerpt: input.onTranslateSelectedExcerpt,
    onClearSelectedExcerpt: input.onClearSelectedExcerpt,
    onOpenPreferences: input.onOpenPreferences,
  };
}
