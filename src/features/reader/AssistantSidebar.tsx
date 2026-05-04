import {
  ExternalLink,
  FileText,
  Info,
  Languages,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Quote,
  Settings2,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperAnnotation,
  QaModelPreset,
  SelectedExcerpt,
  ZoteroRelatedNote,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { ChatPanel, ChatWorkspacePanel } from './assistantSidebarChat';
import {
  AnnotationsDrawerContent,
  InfoDrawerContent,
  NotesDrawerContent,
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
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaMessages: DocumentChatMessage[];
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  qaLoading: boolean;
  qaError: string;
  screenshotLoading?: boolean;
  chatLayoutMode?: 'compact' | 'workspace';
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
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  onAppendSelectedExcerptToQa: () => void;
  activeBlockSummary?: string;
  workspaceNoteMarkdown: string;
  annotations: PaperAnnotation[];
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
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
  qaSessions,
  selectedQaSessionId,
  qaMessages,
  qaInput,
  qaAttachments,
  qaModelPresets,
  selectedQaPresetId,
  qaLoading,
  qaError,
  screenshotLoading = false,
  chatLayoutMode = 'compact',
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
  activeBlockSummary,
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
      label: l('笔记', 'Notes'),
      icon: FileText,
      onClick: () => togglePanel('notes'),
    },
    {
      key: 'annotations' as const,
      label: l('批注', 'Annotations'),
      icon: Quote,
      onClick: () => togglePanel('annotations'),
    },
  ];

  const panelTitle =
    activePanel === 'chat'
      ? l('文档问答', 'Document Chat')
      : activePanel === 'translate'
        ? l('划词翻译', 'Selection Translation')
        : activePanel === 'info'
          ? l('论文信息', 'Paper Info')
          : activePanel === 'notes'
            ? l('阅读笔记', 'Reading Notes')
            : activePanel === 'annotations'
              ? l('阅读批注', 'Reading Annotations')
              : '';

  const panelDescription =
    activePanel === 'chat'
      ? documentMeta || l('基于当前文档内容进行问答。', 'Ask questions grounded in the current document.')
      : activePanel === 'translate'
        ? l('在 PDF 中选中文本后翻译并复用。', 'Translate and reuse selected text from the PDF.')
        : activePanel === 'info'
          ? documentSource || l('查看论文元信息与处理状态。', 'Review paper metadata and processing status.')
          : activePanel === 'notes'
            ? l('记录工作区笔记并查看关联资料。', 'Capture workspace notes and review related materials.')
            : activePanel === 'annotations'
              ? l('管理绑定到文档块的阅读批注。', 'Manage reading annotations linked to document blocks.')
              : '';

  return (
    <div className="paperquay-assistant flex h-full min-h-0 overflow-hidden">
      <div
        className={cn(
          'overflow-hidden border-l border-slate-200 bg-slate-50/50 transition-[width] duration-300 ease-in-out',
          !activePanel && 'border-transparent',
        )}
        style={{ width: activePanel ? panelWidth : 0 }}
      >
        <div className="flex h-full flex-col" style={{ width: panelWidth, minWidth: panelWidth }}>
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{panelTitle}</div>
              <div className="mt-1 truncate text-xs text-slate-400">{panelDescription}</div>
            </div>
            <button
              type="button"
              onClick={() => onActivePanelChange(null)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
              aria-label={l('收起右侧面板', 'Collapse right sidebar')}
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

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
                screenshotLoading={screenshotLoading}
                layoutMode={chatLayoutMode}
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
              />
            ) : null}

            {activePanel === 'notes' ? (
              <NotesDrawerContent
                activeBlockSummary={activeBlockSummary}
                workspaceNoteMarkdown={workspaceNoteMarkdown}
                zoteroRelatedNotes={zoteroRelatedNotes}
                zoteroRelatedNotesLoading={zoteroRelatedNotesLoading}
                zoteroRelatedNotesError={zoteroRelatedNotesError}
                selectedExcerpt={selectedExcerpt}
                onWorkspaceNoteChange={onWorkspaceNoteChange}
                onAppendSelectedExcerptToNote={onAppendSelectedExcerptToNote}
              />
            ) : null}

            {activePanel === 'annotations' ? (
              <AnnotationsDrawerContent
                annotations={annotations}
                onCreateAnnotation={onCreateAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onSelectAnnotation={onSelectAnnotation}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="z-10 flex h-full w-12 flex-col items-center border-l border-slate-200 bg-white py-4 shadow-[-2px_0_10px_rgba(0,0,0,0.02)]">
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
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
                )}
              >
                {active ? (
                  <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-indigo-600" />
                ) : null}
                <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          {onDetach ? (
            <button
              type="button"
              onClick={onDetach}
              title={l('弹出独立窗口', 'Open Detached Window')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <ExternalLink className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onAttachBack ? (
            <button
              type="button"
              onClick={onAttachBack}
              title={l('停靠回侧边栏', 'Dock Back to Sidebar')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            >
              <PanelRightOpen className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onOpenPreferences ? (
            <button
              type="button"
              onClick={onOpenPreferences}
              title={l('设置', 'Settings')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
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
