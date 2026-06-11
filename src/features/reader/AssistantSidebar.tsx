import {
  ExternalLink,
  FileText,
  Info,
  Languages,
  MessageSquare,
  PanelRightOpen,
  Settings2,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  UpdateNoteRequest,
} from '../../types/notes';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatRenderMode,
  DocumentChatSession,
  ModelReasoningEffort,
  QaModelPreset,
  SelectedExcerpt,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { NotesSidebar } from '../notes/NotesSidebar';
import { ChatPanel, ChatWorkspacePanel } from './assistantSidebarChat';
import {
  InfoDrawerContent,
  TranslateDrawerContent,
} from './assistantSidebarDrawers';
import { SectionCard, SelectionPanel, SummaryPanel } from './assistantSidebarPrimitives';

export interface AssistantSidebarCoreProps {
  activePanel: AssistantPanelKey;
  onActivePanelChange: (panel: AssistantPanelKey) => void;
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  notes: Note[];
  activeNoteId: string | null;
  notesLoading: boolean;
  notesSaving: boolean;
  notesError: string;
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  noteEditorSourceId?: string;
  externalUpdateNote?: Note | null;
  onExternalUpdateApply?: (note: Note) => void;
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaMessages: DocumentChatMessage[];
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  qaRagEnabled: boolean;
  qaAnswerRenderMode: DocumentChatRenderMode;
  qaReasoningEffort: ModelReasoningEffort;
  qaLoading: boolean;
  qaError: string;
  screenshotLoading?: boolean;
  chatLayoutMode?: 'compact' | 'workspace';
  onQaInputChange: (value: string) => void;
  onQaSubmit: () => void;
  onQaPresetChange: (presetId: string) => void;
  onQaRagEnabledChange: (value: boolean) => void;
  onQaAnswerRenderModeChange: (mode: DocumentChatRenderMode) => void;
  onQaReasoningEffortChange: (reasoningEffort: ModelReasoningEffort) => void;
  onQaSessionCreate: () => void;
  onQaSessionSelect: (sessionId: string) => void;
  onQaSessionDelete: (sessionId: string) => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onCitationClick: (citation: DocumentChatCitation) => void;
  onCreateStandaloneNote: () => void;
  onSelectNote: (note: Note) => void;
  onUpdateNote: (noteId: string, patch: UpdateNoteRequest, options?: { sourceId?: string }) => void;
  onDeleteNote: (noteId: string) => void;
  onJumpToNoteAnchor: (note: Note, anchor: NoteAnchor) => void;
  onAddSelectionToNote: () => void;
  onSaveAssistantMessageAsNote: (message: DocumentChatMessage) => void;
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
  onOpenPreferences?: () => void;
}

export interface AssistantSidebarChromeProps {
  panelWidth?: number;
  chatLayoutMode?: 'compact' | 'workspace';
  onDetach?: () => void;
  onAttachBack?: () => void;
}

export type AssistantSidebarProps = AssistantSidebarCoreProps & AssistantSidebarChromeProps;

function AssistantSidebar({
  activePanel,
  onActivePanelChange,
  panelWidth = 408,
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
  notes,
  activeNoteId,
  notesLoading,
  notesSaving,
  notesError,
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  noteEditorSourceId,
  externalUpdateNote = null,
  onExternalUpdateApply,
  qaSessions,
  selectedQaSessionId,
  qaMessages,
  qaInput,
  qaAttachments,
  qaModelPresets,
  selectedQaPresetId,
  qaRagEnabled,
  qaAnswerRenderMode,
  qaReasoningEffort,
  qaLoading,
  qaError,
  screenshotLoading = false,
  chatLayoutMode = 'compact',
  onQaInputChange,
  onQaSubmit,
  onQaPresetChange,
  onQaRagEnabledChange,
  onQaAnswerRenderModeChange,
  onQaReasoningEffortChange,
  onQaSessionCreate,
  onQaSessionSelect,
  onQaSessionDelete,
  onSelectImageAttachments,
  onSelectFileAttachments,
  onCaptureScreenshot,
  onRemoveAttachment,
  onCitationClick,
  onCreateStandaloneNote,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onJumpToNoteAnchor,
  onAddSelectionToNote,
  onSaveAssistantMessageAsNote,
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
  onDetach,
  onAttachBack,
  onOpenPreferences,
}: AssistantSidebarProps) {
  const l = useLocaleText();

  const togglePanel = (panel: Exclude<AssistantPanelKey, null>) => {
    onActivePanelChange(activePanel === panel ? null : panel);
  };

  const activityItems = [
    {
      key: 'chat' as const,
      label: l('问答', 'Chat'),
      icon: MessageSquare,
      onClick: () => togglePanel('chat'),
    },
    {
      key: 'translate' as const,
      label: l('翻译', 'Translate'),
      icon: Languages,
      onClick: () => togglePanel('translate'),
    },
    {
      key: 'info' as const,
      label: l('信息', 'Info'),
      icon: Info,
      onClick: () => togglePanel('info'),
    },
    {
      key: 'notes' as const,
      label: l('摘录', 'Clips'),
      icon: FileText,
      onClick: () => togglePanel('notes'),
    },
  ];

  return (
    <div className="pq-saas-scope pq-reader-assistant paperquay-assistant flex h-full min-h-0 overflow-hidden">
      <div
        className={cn(
          'pq-reader-pane overflow-hidden border-l transition-[width] duration-300 ease-in-out',
          !activePanel && 'border-transparent',
        )}
        style={{ width: activePanel ? panelWidth : 0 }}
      >
        <div className="flex h-full flex-col" style={{ width: panelWidth, minWidth: panelWidth }}>
          <div className="min-h-0 flex-1">
            {activePanel === 'chat' ? (
              <ChatWorkspacePanel
                sessions={qaSessions}
                selectedSessionId={selectedQaSessionId}
                messages={qaMessages}
                input={qaInput}
                loading={qaLoading}
                error={qaError}
                hasBlocks={hasBlocks}
                selectedExcerpt={selectedExcerpt}
                attachments={qaAttachments}
                qaModelPresets={qaModelPresets}
                selectedQaPresetId={selectedQaPresetId}
                qaRagEnabled={qaRagEnabled}
                qaAnswerRenderMode={qaAnswerRenderMode}
                qaReasoningEffort={qaReasoningEffort}
                screenshotLoading={screenshotLoading}
                layoutMode={chatLayoutMode}
                onInputChange={onQaInputChange}
                onSubmit={onQaSubmit}
                onQaPresetChange={onQaPresetChange}
                onQaRagEnabledChange={onQaRagEnabledChange}
                onQaAnswerRenderModeChange={onQaAnswerRenderModeChange}
                onQaReasoningEffortChange={onQaReasoningEffortChange}
                onSessionCreate={onQaSessionCreate}
                onSessionSelect={onQaSessionSelect}
                onSessionDelete={onQaSessionDelete}
                onAppendSelectedExcerpt={onAppendSelectedExcerptToQa}
                onSelectImageAttachments={onSelectImageAttachments}
                onSelectFileAttachments={onSelectFileAttachments}
                onCaptureScreenshot={onCaptureScreenshot}
                onRemoveAttachment={onRemoveAttachment}
                onCitationClick={onCitationClick}
                onSaveAssistantMessageAsNote={onSaveAssistantMessageAsNote}
                onCollapseSidebar={() => onActivePanelChange(null)}
              />
            ) : null}

            {activePanel === 'translate' ? (
              <TranslateDrawerContent
                selectedExcerpt={selectedExcerpt}
                selectedExcerptTranslation={selectedExcerptTranslation}
                selectedExcerptTranslating={selectedExcerptTranslating}
                selectedExcerptError={selectedExcerptError}
                aiConfigured={aiConfigured}
                onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
                onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
                onClearSelectedExcerpt={onClearSelectedExcerpt}
                onCollapse={() => onActivePanelChange(null)}
              />
            ) : null}

            {activePanel === 'info' ? (
              <InfoDrawerContent
                documentTitle={documentTitle}
                documentMeta={documentMeta}
                documentSource={documentSource}
                documentPdfName={documentPdfName}
                documentJsonName={documentJsonName}
                blockCount={blockCount}
                translatedCount={translatedCount}
                statusMessage={statusMessage}
                hasBlocks={hasBlocks}
                aiConfigured={aiConfigured}
                onCollapse={() => onActivePanelChange(null)}
              />
            ) : null}

            <div className="h-full min-h-0" hidden={activePanel !== 'notes'}>
              <NotesSidebar
                notes={notes}
                activeNoteId={activeNoteId}
                documentTitle={documentTitle}
                loading={notesLoading}
                saving={notesSaving}
                error={notesError}
                selectedExcerpt={selectedExcerpt}
                pendingAnchorInsert={pendingAnchorInsert}
                onPendingAnchorInsertHandled={onPendingAnchorInsertHandled}
                noteEditorSourceId={noteEditorSourceId}
                externalUpdateNote={externalUpdateNote}
                onExternalUpdateApply={onExternalUpdateApply}
                onAddSelectionToNote={onAddSelectionToNote}
                onCreateStandaloneNote={onCreateStandaloneNote}
                onSelectNote={onSelectNote}
                onUpdateNote={onUpdateNote}
                onDeleteNote={onDeleteNote}
                onJumpToNoteAnchor={onJumpToNoteAnchor}
                onCollapse={() => onActivePanelChange(null)}
              />
            </div>

          </div>
        </div>
      </div>

      <div className="pq-reader-pane z-10 flex h-full w-12 flex-col items-center rounded-none border-l py-4 shadow-[-8px_0_26px_rgba(31,41,55,0.06)]">
        <div className="flex flex-col items-center gap-1.5">
          {activityItems.map((item) => {
            const active = activePanel === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                title={item.label}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-xl transition',
                  active
                    ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)] ring-1 ring-[var(--pq-accent-ring)]'
                    : 'text-[var(--pq-text-muted)] hover:bg-white/70 hover:text-[var(--pq-text)]',
                )}
              >
                {active ? (
                  <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--pq-accent)]" />
                ) : null}
                <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          {onDetach && activePanel === 'chat' ? (
            <button
              type="button"
              onClick={onDetach}
              title={l('弹出文档问答窗口', 'Open document chat window')}
              className="pq-icon-button h-10 w-10"
            >
              <ExternalLink className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onAttachBack ? (
            <button
              type="button"
              onClick={onAttachBack}
              title={l('停靠回侧边栏', 'Dock Back to Sidebar')}
              className="pq-icon-button h-10 w-10"
            >
              <PanelRightOpen className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onOpenPreferences ? (
            <button
              type="button"
              onClick={onOpenPreferences}
              title={l('设置', 'Settings')}
              className="pq-icon-button h-10 w-10"
            >
              <Settings2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { AssistantSidebar, ChatPanel, ChatWorkspacePanel, SectionCard, SelectionPanel, SummaryPanel };
