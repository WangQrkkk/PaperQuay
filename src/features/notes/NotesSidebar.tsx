import { useMemo, useState, type MouseEvent } from 'react';
import {
  Copy,
  FilePlus2,
  FileText,
  ListTree,
  MapPin,
  PanelRightClose,
  Plus,
  Quote,
  Search,
  Trash2,
} from 'lucide-react';
import type { Note, NoteAnchor, NoteAnchorInsertRequest, UpdateNoteRequest } from '../../types/notes';
import type { SelectedExcerpt } from '../../types/reader';
import { cn } from '../../utils/cn';
import { NoteEditor } from './NoteEditor';
import {
  copyTextToClipboard,
  NotesContextMenu,
  shouldUseNativeTextContextMenu,
  type NotesContextMenuEntry,
} from './NotesContextMenu';
import { NotesList } from './NotesList';
import { buildQuoteMarkdown, noteMatchesFilter } from './noteUtils';

type NotesFilterKey = 'all' | 'highlight' | 'ai-chat' | 'standalone';
type DrawerTab = 'anchors' | 'notes';

type SidebarContextMenu =
  | { kind: 'surface'; x: number; y: number }
  | { kind: 'anchor'; x: number; y: number; note: Note; anchor: NoteAnchor }
  | { kind: 'note'; x: number; y: number; note: Note };

interface NotesSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  documentTitle?: string;
  loading: boolean;
  saving: boolean;
  error: string;
  selectedExcerpt: SelectedExcerpt | null;
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  externalUpdateNote?: Note | null;
  noteEditorSourceId?: string;
  onExternalUpdateApply?: (note: Note) => void;
  onAddSelectionToNote: () => void;
  onCreateStandaloneNote: () => void;
  onSelectNote: (note: Note) => void;
  onUpdateNote: (noteId: string, patch: UpdateNoteRequest, options?: { sourceId?: string }) => void;
  onDeleteNote: (noteId: string) => void;
  onJumpToNoteAnchor: (note: Note, anchor: NoteAnchor) => void;
  onCollapse?: () => void;
}

const FILTERS: Array<{ key: NotesFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'highlight', label: 'PDF' },
  { key: 'ai-chat', label: 'AI' },
  { key: 'standalone', label: '笔记' },
];

function anchorPageLabel(anchor: NoteAnchor) {
  if (anchor.pdfLocation?.pageNumber) return `P${anchor.pdfLocation.pageNumber}`;

  const normalized = anchor.label.replace(/\s+/g, ' ').trim();
  const pageMatch = normalized.match(/\bP\s*(\d+)\b/i);
  if (pageMatch) return `P${pageMatch[1]}`;

  return normalized || '定位';
}

function anchorSourceTitle(anchor: NoteAnchor, fallbackTitle?: string) {
  const explicitTitle = anchor.sourceTitle?.replace(/\s+/g, ' ').trim();
  if (explicitTitle && !/^PDF\b/i.test(explicitTitle) && !/^P\s*\d+\b/i.test(explicitTitle)) {
    return explicitTitle;
  }

  const fallback = fallbackTitle?.replace(/\s+/g, ' ').trim();
  if (fallback) return fallback;

  return '文献';
}

function excerptPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function notePlainText(note: Note) {
  return note.contentText || note.content || note.excerpt || '';
}

export function NotesSidebar({
  notes,
  activeNoteId,
  documentTitle,
  loading,
  saving,
  error,
  selectedExcerpt,
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  externalUpdateNote = null,
  noteEditorSourceId,
  onExternalUpdateApply,
  onAddSelectionToNote,
  onCreateStandaloneNote,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onJumpToNoteAnchor,
  onCollapse,
}: NotesSidebarProps) {
  const [filter, setFilter] = useState<NotesFilterKey>('all');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('anchors');
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? notes[0] ?? null,
    [activeNoteId, notes],
  );
  const activeAnchors = activeNote?.anchors ?? [];
  const canAddSelection = Boolean(selectedExcerpt?.text.trim());

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return notes.filter((note) => {
      if (!noteMatchesFilter(note, filter)) return false;
      if (!query) return true;

      const haystack = [
        note.title,
        note.contentText,
        note.content,
        note.excerpt,
        note.tags.join(' '),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [filter, notes, search]);

  const openSurfaceContextMenu = (event: MouseEvent) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    setContextMenu({ kind: 'surface', x: event.clientX, y: event.clientY });
  };

  const openAnchorContextMenu = (
    event: MouseEvent,
    note: Note,
    anchor: NoteAnchor,
  ) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'anchor', x: event.clientX, y: event.clientY, note, anchor });
  };

  const openNoteContextMenu = (event: MouseEvent, note: Note) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'note', x: event.clientX, y: event.clientY, note });
  };

  const contextMenuEntries = useMemo<NotesContextMenuEntry[]>(() => {
    if (!contextMenu) return [];

    if (contextMenu.kind === 'anchor') {
      const { note, anchor } = contextMenu;
      const hasLocation = Boolean(anchor.pdfLocation?.bbox && anchor.pdfLocation.pageNumber);

      return [
        {
          id: 'jump',
          label: '定位到 PDF',
          disabled: !hasLocation,
          tone: 'accent',
          icon: <MapPin className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => onJumpToNoteAnchor(note, anchor),
        },
        {
          id: 'copy-excerpt',
          label: '复制摘录',
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(anchor.excerpt),
        },
        {
          id: 'copy-quote',
          label: '复制 Markdown 引用',
          icon: <Quote className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(buildQuoteMarkdown(anchor.excerpt)),
        },
        { type: 'separator', id: 'anchor-danger-separator' },
        {
          id: 'remove-anchor',
          label: '从定位列表移除',
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            onUpdateNote(note.id, {
              anchors: note.anchors.filter((item) => item.id !== anchor.id),
            });
          },
        },
      ];
    }

    if (contextMenu.kind === 'note') {
      const { note } = contextMenu;

      return [
        {
          id: 'open-note',
          label: '打开笔记',
          tone: 'accent',
          icon: <FileText className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            onSelectNote(note);
            setDrawerOpen(false);
          },
        },
        {
          id: 'copy-title',
          label: '复制标题',
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(note.title || '未命名笔记'),
        },
        {
          id: 'copy-content',
          label: '复制正文',
          disabled: !notePlainText(note).trim(),
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(notePlainText(note)),
        },
        { type: 'separator', id: 'note-danger-separator' },
        {
          id: 'delete-note',
          label: '删除笔记',
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => onDeleteNote(note.id),
        },
      ];
    }

    return [
      {
        id: 'new-note',
        label: '新建笔记',
        tone: 'accent',
        icon: <Plus className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: onCreateStandaloneNote,
      },
      {
        id: 'add-selection',
        label: '加入当前笔记',
        disabled: !canAddSelection,
        icon: <FilePlus2 className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: onAddSelectionToNote,
      },
    ];
  }, [
    canAddSelection,
    contextMenu,
    onAddSelectionToNote,
    onCreateStandaloneNote,
    onDeleteNote,
    onJumpToNoteAnchor,
    onSelectNote,
    onUpdateNote,
  ]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-[var(--pq-surface-1)]"
      onContextMenu={openSurfaceContextMenu}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--pq-border-subtle)] px-2 py-2">
        <button
          type="button"
          onClick={() => {
            setDrawerTab('anchors');
            setDrawerOpen((open) => !open);
          }}
          className={cn(
            'inline-flex min-w-0 items-center gap-2 rounded-[var(--pq-radius-sm)] px-2.5 py-1.5 text-sm font-medium transition',
            drawerOpen
              ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
              : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
          )}
          aria-expanded={drawerOpen}
        >
          <ListTree className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="shrink-0">摘录</span>
          <span className="rounded-md bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--pq-text-faint)]">
            {activeAnchors.length}
          </span>
          {error ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pq-error)]" title={error} /> : null}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAddSelectionToNote}
            disabled={!canAddSelection}
            className="pq-icon-button h-8 w-8 disabled:opacity-40"
            title="加入当前笔记"
            aria-label="加入当前笔记"
          >
            <FilePlus2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onCreateStandaloneNote}
            className="pq-icon-button h-8 w-8 bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]"
            title="新建笔记"
            aria-label="新建笔记"
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="pq-icon-button h-8 w-8"
              title="收起侧边栏"
              aria-label="收起侧边栏"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>

      {drawerOpen ? (
        <div className="pq-card absolute left-2 right-2 top-12 z-30 flex max-h-[min(480px,62%)] min-h-[180px] flex-col overflow-hidden p-2 shadow-[var(--pq-shadow-dialog)]">
          <div className="flex shrink-0 items-center gap-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] p-1">
            {([
              ['anchors', `定位 ${activeAnchors.length}`],
              ['notes', `笔记 ${notes.length}`],
            ] as Array<[DrawerTab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDrawerTab(tab)}
                className={cn(
                  'h-7 flex-1 rounded-md px-2 text-xs font-medium transition',
                  drawerTab === tab
                    ? 'bg-[var(--pq-surface)] text-[var(--pq-text)] shadow-[var(--pq-shadow-sm)]'
                    : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="mt-2 shrink-0 rounded-[var(--pq-radius-sm)] border border-[var(--pq-error-bg)] bg-[var(--pq-error-bg)] px-2.5 py-1.5 text-xs text-[var(--pq-error)]">
              {error}
            </div>
          ) : null}

          {drawerTab === 'anchors' ? (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {activeNote && activeAnchors.length > 0 ? (
                <div className="space-y-1.5">
                  {activeAnchors.map((anchor) => {
                    const hasLocation = Boolean(anchor.pdfLocation?.bbox && anchor.pdfLocation.pageNumber);
                    const sourceTitle = anchorSourceTitle(anchor, documentTitle);
                    const pageLabel = anchorPageLabel(anchor);

                    return (
                      <div
                        key={anchor.id}
                        onContextMenu={(event) => openAnchorContextMenu(event, activeNote, anchor)}
                        className={cn(
                          'group w-full rounded-[var(--pq-radius-sm)] border bg-[var(--pq-surface)] px-2.5 py-2.5 text-left shadow-[var(--pq-shadow-sm)] transition',
                          hasLocation
                            ? 'border-[var(--pq-border-subtle)] hover:border-[var(--pq-border)]'
                            : 'border-transparent opacity-55',
                        )}
                      >
                        <span className="block border-l-2 border-[var(--pq-border-strong)] pl-2 text-xs leading-5 text-[var(--pq-text-secondary)]">
                          <span className="line-clamp-3 break-words">
                            “{excerptPreview(anchor.excerpt) || '无摘录文本'}”
                          </span>
                        </span>
                        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-2">
                          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--pq-text-faint)]" title={sourceTitle}>
                            {sourceTitle}
                          </span>
                          {hasLocation ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onJumpToNoteAnchor(activeNote, anchor);
                              }}
                              className="rounded-md px-1 text-[11px] font-semibold text-[var(--pq-accent)] transition hover:bg-[var(--pq-accent-bg)] hover:text-[var(--pq-accent-hover)]"
                              title="点击定位到原文"
                              aria-label={`点击定位到原文 ${pageLabel}`}
                            >
                              {pageLabel}
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-[var(--pq-text-faint)]">
                              {pageLabel}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-28 items-center justify-center rounded-[var(--pq-radius-sm)] border border-dashed border-[var(--pq-border-subtle)] text-xs text-[var(--pq-text-faint)]">
                  暂无摘录
                </div>
              )}
            </div>
          ) : null}

          {drawerTab === 'notes' ? (
            <div className="mt-2 flex min-h-0 flex-1 flex-col">
              <label className="pq-input flex h-8 shrink-0 items-center gap-2 px-2.5">
                <Search className="h-3.5 w-3.5 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索笔记"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--pq-text-faint)]"
                />
              </label>

              <div className="mt-2 flex shrink-0 items-center gap-1 overflow-x-auto">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={cn(
                      'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      filter === item.key
                        ? 'bg-[var(--pq-bg-tertiary)] text-[var(--pq-text)]'
                        : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="space-y-1.5">
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                  </div>
                ) : (
                  <NotesList
                    notes={filteredNotes}
                    activeNoteId={activeNoteId}
                    onSelect={(note) => {
                      onSelectNote(note);
                      setDrawerOpen(false);
                    }}
                    onDelete={(note) => onDeleteNote(note.id)}
                    onContextMenu={openNoteContextMenu}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 p-2">
        <NoteEditor
          note={activeNote}
          saving={saving}
          onUpdate={onUpdateNote}
          pendingAnchorInsert={pendingAnchorInsert}
          onPendingAnchorInsertHandled={onPendingAnchorInsertHandled}
          editorSourceId={noteEditorSourceId}
          externalUpdateNote={externalUpdateNote}
          onExternalUpdateApply={onExternalUpdateApply}
          onJumpToNoteAnchor={onJumpToNoteAnchor}
          compact
        />
      </div>

      {contextMenu ? (
        <NotesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={
            contextMenu.kind === 'anchor'
              ? contextMenu.anchor.label || '摘录'
              : contextMenu.kind === 'note'
                ? contextMenu.note.title || '未命名笔记'
                : '笔记'
          }
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
