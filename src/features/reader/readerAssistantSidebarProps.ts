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
  qaSessions: AssistantSidebarCoreProps['qaSessions'];
  selectedQaSessionId: AssistantSidebarCoreProps['selectedQaSessionId'];
  qaMessages: AssistantSidebarCoreProps['qaMessages'];
  qaInput: AssistantSidebarCoreProps['qaInput'];
  qaAttachments: AssistantSidebarCoreProps['qaAttachments'];
  qaModelPresets: AssistantSidebarCoreProps['qaModelPresets'];
  selectedQaPresetId: AssistantSidebarCoreProps['selectedQaPresetId'];
  qaLoading: AssistantSidebarCoreProps['qaLoading'];
  qaError: AssistantSidebarCoreProps['qaError'];
  screenshotLoading: NonNullable<AssistantSidebarCoreProps['screenshotLoading']>;
  onQaInputChange: AssistantSidebarCoreProps['onQaInputChange'];
  onQaSubmit: AssistantSidebarCoreProps['onQaSubmit'];
  onQaPresetChange: AssistantSidebarCoreProps['onQaPresetChange'];
  onQaSessionCreate: AssistantSidebarCoreProps['onQaSessionCreate'];
  onQaSessionSelect: AssistantSidebarCoreProps['onQaSessionSelect'];
  onQaSessionDelete: AssistantSidebarCoreProps['onQaSessionDelete'];
  onSelectImageAttachments: AssistantSidebarCoreProps['onSelectImageAttachments'];
  onSelectFileAttachments: AssistantSidebarCoreProps['onSelectFileAttachments'];
  onCaptureScreenshot: AssistantSidebarCoreProps['onCaptureScreenshot'];
  onRemoveAttachment: AssistantSidebarCoreProps['onRemoveAttachment'];
  selectedExcerpt: AssistantSidebarCoreProps['selectedExcerpt'];
  selectedExcerptTranslation: AssistantSidebarCoreProps['selectedExcerptTranslation'];
  selectedExcerptTranslating: AssistantSidebarCoreProps['selectedExcerptTranslating'];
  selectedExcerptError: AssistantSidebarCoreProps['selectedExcerptError'];
  onAppendSelectedExcerptToQa: AssistantSidebarCoreProps['onAppendSelectedExcerptToQa'];
  activeBlockSummary: NonNullable<AssistantSidebarCoreProps['activeBlockSummary']>;
  workspaceNoteMarkdown: AssistantSidebarCoreProps['workspaceNoteMarkdown'];
  annotations: AssistantSidebarCoreProps['annotations'];
  zoteroRelatedNotes: AssistantSidebarCoreProps['zoteroRelatedNotes'];
  zoteroRelatedNotesLoading: AssistantSidebarCoreProps['zoteroRelatedNotesLoading'];
  zoteroRelatedNotesError: AssistantSidebarCoreProps['zoteroRelatedNotesError'];
  onWorkspaceNoteChange: AssistantSidebarCoreProps['onWorkspaceNoteChange'];
  onAppendSelectedExcerptToNote: AssistantSidebarCoreProps['onAppendSelectedExcerptToNote'];
  onCreateAnnotation: AssistantSidebarCoreProps['onCreateAnnotation'];
  onDeleteAnnotation: AssistantSidebarCoreProps['onDeleteAnnotation'];
  onSelectAnnotation: AssistantSidebarCoreProps['onSelectAnnotation'];
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
    qaSessions: input.qaSessions,
    selectedQaSessionId: input.selectedQaSessionId,
    qaMessages: input.qaMessages,
    qaInput: input.qaInput,
    qaAttachments: input.qaAttachments,
    qaModelPresets: input.qaModelPresets,
    selectedQaPresetId: input.selectedQaPresetId,
    qaLoading: input.qaLoading,
    qaError: input.qaError,
    screenshotLoading: input.screenshotLoading,
    onQaInputChange: input.onQaInputChange,
    onQaSubmit: input.onQaSubmit,
    onQaPresetChange: input.onQaPresetChange,
    onQaSessionCreate: input.onQaSessionCreate,
    onQaSessionSelect: input.onQaSessionSelect,
    onQaSessionDelete: input.onQaSessionDelete,
    onSelectImageAttachments: input.onSelectImageAttachments,
    onSelectFileAttachments: input.onSelectFileAttachments,
    onCaptureScreenshot: input.onCaptureScreenshot,
    onRemoveAttachment: input.onRemoveAttachment,
    selectedExcerpt: input.selectedExcerpt,
    selectedExcerptTranslation: input.selectedExcerptTranslation,
    selectedExcerptTranslating: input.selectedExcerptTranslating,
    selectedExcerptError: input.selectedExcerptError,
    onAppendSelectedExcerptToQa: input.onAppendSelectedExcerptToQa,
    activeBlockSummary: input.activeBlockSummary,
    workspaceNoteMarkdown: input.workspaceNoteMarkdown,
    annotations: input.annotations,
    zoteroRelatedNotes: input.zoteroRelatedNotes,
    zoteroRelatedNotesLoading: input.zoteroRelatedNotesLoading,
    zoteroRelatedNotesError: input.zoteroRelatedNotesError,
    onWorkspaceNoteChange: input.onWorkspaceNoteChange,
    onAppendSelectedExcerptToNote: input.onAppendSelectedExcerptToNote,
    onCreateAnnotation: input.onCreateAnnotation,
    onDeleteAnnotation: input.onDeleteAnnotation,
    onSelectAnnotation: input.onSelectAnnotation,
    onTranslateSelectedExcerpt: input.onTranslateSelectedExcerpt,
    onClearSelectedExcerpt: input.onClearSelectedExcerpt,
    onOpenPreferences: input.onOpenPreferences,
  };
}
