import { useMemo, useState } from 'react';
import { BookOpenText, FileJson, FileText, Info, Quote, X } from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { PaperAnnotation, SelectedExcerpt, ZoteroRelatedNote } from '../../types/reader';
import { cn } from '../../utils/cn';
import {
  HintPanel,
  MarkdownPreview,
  SectionCard,
  SelectionPanel,
  StatusBadge,
} from './assistantSidebarPrimitives';

export interface MetadataPanelProps {
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
}

function MetadataPanel({
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
}: MetadataPanelProps) {
  const l = useLocaleText();

  return (
    <SectionCard
      title={l('论文信息', 'Paper Info')}
      description={
        documentSource ||
        l(
          '当前论文的基础信息与处理状态。',
          'Basic paper information and processing status.',
        )
      }
      icon={<Info className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="space-y-3"
    >
      <div className="space-y-1">
        <div className="text-base font-semibold text-slate-900">
          {documentTitle || l('未命名论文', 'Untitled Paper')}
        </div>
        {documentMeta ? <div className="text-sm text-slate-500">{documentMeta}</div> : null}
      </div>
      <div className="grid gap-2 text-sm text-slate-600">
        <div>
          {l('PDF：', 'PDF: ')}
          {documentPdfName || l('未加载', 'Not loaded')}
        </div>
        <div>
          {l('JSON：', 'JSON: ')}
          {documentJsonName || l('未加载', 'Not loaded')}
        </div>
        <div>{l(`块数量：${blockCount ?? 0}`, `Blocks: ${blockCount ?? 0}`)}</div>
        <div>{l(`已翻译块：${translatedCount ?? 0}`, `Translated Blocks: ${translatedCount ?? 0}`)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={hasBlocks ? 'success' : 'neutral'}>
          {hasBlocks ? l('已加载块数据', 'Blocks Loaded') : l('未加载块数据', 'No Block Data')}
        </StatusBadge>
        <StatusBadge tone={aiConfigured ? 'success' : 'neutral'}>
          {aiConfigured ? l('AI 已配置', 'AI Ready') : l('AI 未配置', 'AI Not Configured')}
        </StatusBadge>
      </div>
      {statusMessage ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {statusMessage}
        </div>
      ) : null}
    </SectionCard>
  );
}

export interface TranslateDrawerContentProps {
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  aiConfigured: boolean;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
}

function TranslateDrawerContent({
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  aiConfigured,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
}: TranslateDrawerContentProps) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <SelectionPanel
        selectedExcerpt={selectedExcerpt}
        selectedExcerptTranslation={selectedExcerptTranslation}
        selectedExcerptTranslating={selectedExcerptTranslating}
        selectedExcerptError={selectedExcerptError}
        aiConfigured={aiConfigured}
        onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
        onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
        onClearSelectedExcerpt={onClearSelectedExcerpt}
      />
    </div>
  );
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncatePreview(value: string, maxLength = 480): string {
  if (!value) {
    return '';
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function renderRelatedNoteContent(note: ZoteroRelatedNote): string {
  if (note.contentFormat === 'html') {
    return stripHtmlTags(note.content);
  }
  return note.content;
}

function InfoDrawerContent(props: MetadataPanelProps) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <MetadataPanel {...props} />
    </div>
  );
}

export interface NotesDrawerContentProps {
  activeBlockSummary?: string;
  workspaceNoteMarkdown: string;
  zoteroRelatedNotes: ZoteroRelatedNote[];
  zoteroRelatedNotesLoading: boolean;
  zoteroRelatedNotesError: string;
  selectedExcerpt: SelectedExcerpt | null;
  onWorkspaceNoteChange: (value: string) => void;
  onAppendSelectedExcerptToNote: () => void;
}

type WorkspaceNoteViewMode = 'split' | 'edit' | 'preview';

function NotesDrawerContent({
  activeBlockSummary,
  workspaceNoteMarkdown,
  zoteroRelatedNotes,
  zoteroRelatedNotesLoading,
  zoteroRelatedNotesError,
  selectedExcerpt,
  onWorkspaceNoteChange,
  onAppendSelectedExcerptToNote,
}: NotesDrawerContentProps) {
  const l = useLocaleText();
  const [viewMode, setViewMode] = useState<WorkspaceNoteViewMode>('split');
  const noteText = workspaceNoteMarkdown.trim();
  const noteStats = {
    characters: workspaceNoteMarkdown.length,
    lines: workspaceNoteMarkdown ? workspaceNoteMarkdown.split(/\r?\n/).length : 0,
  };
  const viewModeOptions: Array<{ key: WorkspaceNoteViewMode; label: string }> = [
    { key: 'split', label: l('对照', 'Split') },
    { key: 'edit', label: l('编辑', 'Edit') },
    { key: 'preview', label: l('预览', 'Preview') },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="space-y-4">
        {activeBlockSummary ? (
          <SectionCard
            title={l('当前块概览', 'Active Block Overview')}
            description={l(
              '来自当前激活块的上下文信息，可直接用于整理笔记。',
              'Context from the active block that you can reuse in your notes.',
            )}
            icon={<BookOpenText className="h-4 w-4" strokeWidth={1.8} />}
          >
            <MarkdownPreview content={activeBlockSummary} />
          </SectionCard>
        ) : null}

        <SectionCard
          title={l('工作区笔记', 'Workspace Notes')}
          description={l(
            '支持 Markdown，输入时会实时渲染预览，并自动保存到当前文档的阅读记录。',
            'Supports Markdown with live preview and auto-save into the current document history.',
          )}
          icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
          actions={
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {viewModeOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setViewMode(option.key)}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                    viewMode === option.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        >
          {viewMode !== 'preview' ? (
            <div>
              <textarea
                value={workspaceNoteMarkdown}
                onChange={(event) => onWorkspaceNoteChange(event.target.value)}
                placeholder={l(
                  '在这里输入 Markdown 笔记，例如：\n\n## 核心观点\n- 方法\n- 实验\n\n$$E = mc^2$$',
                  'Write Markdown notes here, for example:\n\n## Key Ideas\n- Method\n- Experiments\n\n$$E = mc^2$$',
                )}
                className={cn(
                  'w-full resize-y rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 font-mono text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white',
                  viewMode === 'split' ? 'min-h-[180px]' : 'min-h-[360px]',
                )}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  {l(
                    `${noteStats.characters} 字符 · ${noteStats.lines} 行`,
                    `${noteStats.characters} chars · ${noteStats.lines} lines`,
                  )}
                </span>
                <span>{l('实时保存', 'Auto-saved')}</span>
              </div>
            </div>
          ) : null}

          {viewMode !== 'edit' ? (
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {l('实时预览', 'Live Preview')}
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-600">
                  Markdown
                </span>
              </div>
              {noteText ? (
                <MarkdownPreview content={workspaceNoteMarkdown} normalizeMath={false} />
              ) : (
                <HintPanel icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}>
                  {l(
                    '开始输入后，这里会同步渲染标题、列表、表格、公式和代码块。',
                    'Start typing to render headings, lists, tables, math, and code blocks here.',
                  )}
                </HintPanel>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAppendSelectedExcerptToNote}
              disabled={!selectedExcerpt}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {l('插入选中文本', 'Insert Selection')}
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title={l('关联笔记', 'Related Notes')}
          description={l(
            '显示从 Zotero 或本地 Markdown 文档提取的相关笔记。',
            'Show notes collected from Zotero or local Markdown documents.',
          )}
          icon={<FileJson className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
        >
          {zoteroRelatedNotesLoading ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
              <div className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
            </div>
          ) : zoteroRelatedNotesError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {zoteroRelatedNotesError}
            </div>
          ) : zoteroRelatedNotes.length > 0 ? (
            zoteroRelatedNotes.map((note) => {
              const previewContent = truncatePreview(renderRelatedNoteContent(note), 560);
              return (
                <div
                  key={note.id}
                  className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {note.title || l('未命名笔记', 'Untitled Note')}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{note.sourceLabel}</div>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                      {note.kind}
                    </span>
                  </div>
                  <div className="mt-3">
                    {note.contentFormat === 'markdown' ? (
                      <MarkdownPreview content={previewContent} />
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {previewContent || l('无可显示内容', 'No preview available')}
                      </div>
                    )}
                  </div>
                  {note.filePath ? (
                    <div className="mt-3 break-all text-[11px] text-slate-400">{note.filePath}</div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <HintPanel icon={<FileJson className="h-4 w-4" strokeWidth={1.8} />}>
              {l(
                '暂无关联 Zotero 笔记或 Markdown 文件。',
                'No related Zotero notes or Markdown files are available yet.',
              )}
            </HintPanel>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export interface AnnotationsDrawerContentProps {
  annotations: PaperAnnotation[];
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
}

function AnnotationsDrawerContent({
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onSelectAnnotation,
}: AnnotationsDrawerContentProps) {
  const l = useLocaleText();
  const [annotationDraft, setAnnotationDraft] = useState('');
  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => b.updatedAt - a.updatedAt),
    [annotations],
  );
  const canCreateAnnotation = annotationDraft.trim().length > 0;

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="space-y-3">
        <SectionCard
          title={l('批注草稿', 'Annotation Draft')}
          description={l(
            '将当前想法保存为结构化批注。',
            'Save the current idea as a structured annotation.',
          )}
          icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}
          contentClassName="space-y-3"
        >
          <textarea
            value={annotationDraft}
            onChange={(event) => setAnnotationDraft(event.target.value)}
            placeholder={l('输入批注内容...', 'Write an annotation...')}
            className="min-h-[120px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-indigo-200 focus:bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!canCreateAnnotation) {
                  return;
                }
                onCreateAnnotation(annotationDraft.trim());
                setAnnotationDraft('');
              }}
              disabled={!canCreateAnnotation}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {l('添加批注', 'Add Annotation')}
            </button>
            <button
              type="button"
              onClick={() => setAnnotationDraft('')}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {l('清空草稿', 'Clear Draft')}
            </button>
          </div>
        </SectionCard>

        {sortedAnnotations.length > 0 ? (
          sortedAnnotations.map((annotation) => (
            <div
              key={annotation.id}
              className="rounded-[22px] border border-slate-200/80 bg-white/78 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onSelectAnnotation(annotation.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {l(
                      `第 ${annotation.pageIndex + 1} 页 · ${annotation.blockType}`,
                      `Page ${annotation.pageIndex + 1} · ${annotation.blockType}`,
                    )}
                  </div>
                  <div className="mt-2 text-sm leading-7 text-slate-700">
                    {annotation.note || annotation.quote || l('无文本内容', 'No text content')}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteAnnotation(annotation.id)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={l('删除批注', 'Delete annotation')}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <HintPanel icon={<Quote className="h-4 w-4" strokeWidth={1.8} />}>
            {l(
              '还没有批注。你可以先在左侧阅读区定位块，再记录批注。',
              'There are no annotations yet. Focus a block in the reader first, then add one here.',
            )}
          </HintPanel>
        )}
      </div>
    </div>
  );
}

export { AnnotationsDrawerContent, InfoDrawerContent, NotesDrawerContent, TranslateDrawerContent };
