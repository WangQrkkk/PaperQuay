import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  NOTE_CHANGED_EVENT,
  emitJumpToNoteAnchor,
  type NoteChangedEventDetail,
} from '../../app/appEvents';
import { listLibraryPapers } from '../../services/library';
import { useNotesStore } from '../../stores/useNotesStore';
import { useTabsStore, type NoteTab } from '../../stores/useTabsStore';
import type { LiteraturePaper } from '../../types/library';
import type { Note, NoteAnchor } from '../../types/notes';
import { cn } from '../../utils/cn';
import { NoteEditor } from './NoteEditor';
import {
  copyTextToClipboard,
  NotesContextMenu,
  shouldUseNativeTextContextMenu,
  type NotesContextMenuEntry,
} from './NotesContextMenu';
import { extractOutline, noteContentToTiptap } from './notesTiptap';

const NOTE_FOLDERS_STORAGE_KEY = 'paperquay:note-folders:v1';
const UNCATEGORIZED_FOLDER_ID = '__uncategorized__';
const NOTE_DRAG_MIME = 'application/x-paperquay-note-id';

interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
}

type FolderEditDraft =
  | { kind: 'create'; parentId: string | null; value: string }
  | { kind: 'rename'; folderId: string; value: string };

function createNoteFolderId() {
  return `note-folder-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function cleanFolderName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 48);
}

function normalizeNoteFolders(value: unknown): NoteFolder[] {
  if (!Array.isArray(value)) return [];

  const folders = value
    .map((item): NoteFolder | null => {
      if (!item || typeof item !== 'object') return null;
      const draft = item as Partial<NoteFolder>;
      const id = typeof draft.id === 'string' ? draft.id.trim() : '';
      const name = typeof draft.name === 'string' ? cleanFolderName(draft.name) : '';

      if (!id || !name) return null;

      return {
        id,
        name,
        parentId: typeof draft.parentId === 'string' && draft.parentId.trim() ? draft.parentId.trim() : null,
      };
    })
    .filter((item): item is NoteFolder => Boolean(item));

  const ids = new Set(folders.map((folder) => folder.id));
  return folders.map((folder) => ({
    ...folder,
    parentId: folder.parentId && folder.parentId !== folder.id && ids.has(folder.parentId)
      ? folder.parentId
      : null,
  }));
}

function loadNoteFolders() {
  if (typeof window === 'undefined') return [];

  try {
    return normalizeNoteFolders(JSON.parse(window.localStorage.getItem(NOTE_FOLDERS_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function getFolderDescendantIds(folderId: string, folders: NoteFolder[]) {
  const result: string[] = [];
  const stack = folders.filter((folder) => folder.parentId === folderId).map((folder) => folder.id);

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || result.includes(id)) continue;
    result.push(id);
    stack.push(...folders.filter((folder) => folder.parentId === id).map((folder) => folder.id));
  }

  return result;
}

function getFolderPath(folder: NoteFolder, folders: NoteFolder[]) {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const names = [folder.name];
  let parentId = folder.parentId;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return names.join(' / ');
}

function noteMatchesFolder(note: Note, folders: NoteFolder[], activeFolderId: string | null) {
  if (!activeFolderId) return true;

  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const noteFolderId = note.folderId && knownFolderIds.has(note.folderId) ? note.folderId : null;

  if (activeFolderId === UNCATEGORIZED_FOLDER_ID) {
    return !noteFolderId;
  }

  const scopeIds = new Set([activeFolderId, ...getFolderDescendantIds(activeFolderId, folders)]);
  return Boolean(noteFolderId && scopeIds.has(noteFolderId));
}

function filterNotesByFolder(notes: Note[], folders: NoteFolder[], activeFolderId: string | null) {
  return notes.filter((note) => noteMatchesFolder(note, folders, activeFolderId));
}

function compareTreeNotes(left: Note, right: Note) {
  if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
    return left.isPinned ? -1 : 1;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  return (left.title || '未命名笔记').localeCompare(right.title || '未命名笔记', 'zh-Hans-CN');
}

function groupNotesByDirectFolder(notes: Note[], folders: NoteFolder[]) {
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const result = new Map<string | null, Note[]>();

  result.set(null, []);
  for (const folder of folders) {
    result.set(folder.id, []);
  }

  for (const note of notes) {
    const folderId = note.folderId && knownFolderIds.has(note.folderId) ? note.folderId : null;
    const folderNotes = result.get(folderId) ?? [];
    folderNotes.push(note);
    result.set(folderId, folderNotes);
  }

  for (const folderNotes of result.values()) {
    folderNotes.sort(compareTreeNotes);
  }

  return result;
}

function isNoteEventRecord(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  return typeof note.id === 'string' && typeof note.updatedAt === 'number';
}

function buildFolderChildren(folders: NoteFolder[]) {
  const children = new Map<string | null, NoteFolder[]>();

  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  }

  return children;
}

interface FolderInlineEditorProps {
  depth: number;
  value: string;
  placeholder: string;
  mode: 'create' | 'rename';
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function FolderInlineEditor({
  depth,
  value,
  placeholder,
  mode,
  onChange,
  onCommit,
  onCancel,
}: FolderInlineEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="flex items-center gap-1 py-0.5"
      style={{ paddingLeft: `${Math.min(depth * 12, 36)}px` }}
    >
      <span className="h-6 w-5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-bg)] px-1.5 py-1 shadow-[0_0_0_3px_var(--pq-accent-bg)]">
        {mode === 'create' ? (
          <FolderPlus className="h-3.5 w-3.5 shrink-0 text-[var(--pq-accent)]" strokeWidth={1.8} />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--pq-accent)]" strokeWidth={1.8} />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]"
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCommit}
          className="pq-icon-button h-5 w-5 rounded"
          title="确认"
          aria-label="确认"
        >
          <Check className="h-3 w-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCancel}
          className="pq-icon-button h-5 w-5 rounded"
          title="取消"
          aria-label="取消"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

interface FolderNoteTreeItemProps {
  note: Note;
  depth: number;
  active: boolean;
  dragging: boolean;
  onSelect: (noteId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, note: Note) => void;
  onDragEnd: () => void;
  onContextMenu: (event: MouseEvent, note: Note) => void;
}

function FolderNoteTreeItem({
  note,
  depth,
  active,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: FolderNoteTreeItemProps) {
  return (
    <article
      draggable
      aria-grabbed={dragging}
      className={cn('group relative py-0.5 transition-opacity', dragging ? 'opacity-45' : '')}
      style={{ paddingLeft: `${Math.min(depth * 12 + 25, 72)}px` }}
      onDragStart={(event) => onDragStart(event, note)}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => onContextMenu(event, note)}
    >
      <button
        type="button"
        onClick={() => onSelect(note.id)}
        className={cn(
          'relative flex w-full min-w-0 items-center gap-2 rounded-[var(--pq-radius-sm)] px-2 py-1.5 text-left text-xs transition',
          active
            ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
            : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
        )}
      >
        {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--pq-accent)]" /> : null}
        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
        <span className="truncate font-medium">
          {note.title || '未命名笔记'}
        </span>
      </button>
    </article>
  );
}

interface FolderTreeItemProps {
  folder: NoteFolder;
  depth: number;
  childrenByParent: Map<string | null, NoteFolder[]>;
  notesByFolder: Map<string | null, Note[]>;
  activeFolderId: string | null;
  activeNoteId: string | null;
  expandedFolderIds: Set<string>;
  noteCounts: Map<string, number>;
  draggingNoteId: string | null;
  dragOverFolderId: string | null;
  folderEditDraft: FolderEditDraft | null;
  onSelect: (folderId: string) => void;
  onToggle: (folderId: string) => void;
  onNoteSelect: (noteId: string) => void;
  onNoteDragStart: (event: DragEvent<HTMLElement>, note: Note) => void;
  onNoteDragEnd: () => void;
  onNoteContextMenu: (event: MouseEvent, note: Note) => void;
  onFolderDragOver: (event: DragEvent<HTMLElement>, folder: NoteFolder) => void;
  onFolderDragLeave: (event: DragEvent<HTMLElement>, folder: NoteFolder) => void;
  onFolderDrop: (event: DragEvent<HTMLElement>, folder: NoteFolder) => void;
  onFolderEditChange: (value: string) => void;
  onFolderEditCommit: () => void;
  onFolderEditCancel: () => void;
  onContextMenu: (event: MouseEvent, folder: NoteFolder) => void;
}

function FolderTreeItem({
  folder,
  depth,
  childrenByParent,
  notesByFolder,
  activeFolderId,
  activeNoteId,
  expandedFolderIds,
  noteCounts,
  draggingNoteId,
  dragOverFolderId,
  folderEditDraft,
  onSelect,
  onToggle,
  onNoteSelect,
  onNoteDragStart,
  onNoteDragEnd,
  onNoteContextMenu,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onFolderEditChange,
  onFolderEditCommit,
  onFolderEditCancel,
  onContextMenu,
}: FolderTreeItemProps) {
  const children = childrenByParent.get(folder.id) ?? [];
  const directNotes = notesByFolder.get(folder.id) ?? [];
  const expanded = expandedFolderIds.has(folder.id);
  const active = activeFolderId === folder.id;
  const dragTarget = dragOverFolderId === folder.id;
  const renaming = folderEditDraft?.kind === 'rename' && folderEditDraft.folderId === folder.id;
  const creatingChild = folderEditDraft?.kind === 'create' && folderEditDraft.parentId === folder.id;
  const expandable = children.length > 0 || directNotes.length > 0 || creatingChild;

  return (
    <div>
      {renaming ? (
        <FolderInlineEditor
          depth={depth}
          value={folderEditDraft.value}
          placeholder="分类名称"
          mode="rename"
          onChange={onFolderEditChange}
          onCommit={onFolderEditCommit}
          onCancel={onFolderEditCancel}
        />
      ) : (
        <div
          className="group flex items-center gap-1"
          style={{ paddingLeft: `${Math.min(depth * 12, 36)}px` }}
          onContextMenu={(event) => onContextMenu(event, folder)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (expandable) onToggle(folder.id);
            }}
            className={cn(
              'flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-[var(--pq-text-faint)] transition',
              expandable ? 'hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]' : 'opacity-0',
            )}
            aria-label={expanded ? '折叠分类' : '展开分类'}
            disabled={!expandable}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            onDragOver={(event) => onFolderDragOver(event, folder)}
            onDragLeave={(event) => onFolderDragLeave(event, folder)}
            onDrop={(event) => onFolderDrop(event, folder)}
            onDoubleClick={() => {
              if (expandable) onToggle(folder.id);
            }}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--pq-radius-sm)] border border-transparent px-2 py-1.5 text-xs transition',
              dragTarget
                ? 'border-[var(--pq-accent)] bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
                : '',
              active
                ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
                : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {expanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              )}
              <span className="truncate">{folder.name}</span>
            </span>
            <span className="shrink-0 text-[11px] text-[var(--pq-text-faint)]">
              {noteCounts.get(folder.id) ?? 0}
            </span>
          </button>
        </div>
      )}

      {(expanded || creatingChild) && (directNotes.length > 0 || children.length > 0 || creatingChild) ? (
        <div className="mt-0.5 space-y-0.5">
          {creatingChild ? (
            <FolderInlineEditor
              depth={depth + 1}
              value={folderEditDraft.value}
              placeholder="子分类名称"
              mode="create"
              onChange={onFolderEditChange}
              onCommit={onFolderEditCommit}
              onCancel={onFolderEditCancel}
            />
          ) : null}
          {directNotes.map((note) => (
            <FolderNoteTreeItem
              key={note.id}
              note={note}
              depth={depth + 1}
              active={note.id === activeNoteId}
              dragging={draggingNoteId === note.id}
              onSelect={onNoteSelect}
              onDragStart={onNoteDragStart}
              onDragEnd={onNoteDragEnd}
              onContextMenu={onNoteContextMenu}
            />
          ))}
          {children.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              notesByFolder={notesByFolder}
              activeFolderId={activeFolderId}
              activeNoteId={activeNoteId}
              expandedFolderIds={expandedFolderIds}
              noteCounts={noteCounts}
              draggingNoteId={draggingNoteId}
              dragOverFolderId={dragOverFolderId}
              folderEditDraft={folderEditDraft}
              onSelect={onSelect}
              onToggle={onToggle}
              onNoteSelect={onNoteSelect}
              onNoteDragStart={onNoteDragStart}
              onNoteDragEnd={onNoteDragEnd}
              onNoteContextMenu={onNoteContextMenu}
              onFolderDragOver={onFolderDragOver}
              onFolderDragLeave={onFolderDragLeave}
              onFolderDrop={onFolderDrop}
              onFolderEditChange={onFolderEditChange}
              onFolderEditCommit={onFolderEditCommit}
              onFolderEditCancel={onFolderEditCancel}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type WorkspaceContextMenu =
  | { kind: 'surface'; x: number; y: number }
  | { kind: 'note'; x: number; y: number; note: Note }
  | { kind: 'folder'; x: number; y: number; folder: NoteFolder };

function notePlainText(note: Note) {
  return note.contentText || note.content || note.excerpt || '';
}

function createNoteAnchorJumpRequestId() {
  return `note-anchor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function resolveNoteAnchorTargetPaperId(note: Note, anchor: NoteAnchor) {
  const rawTarget = (anchor.paperId || note.paperId || '').trim();

  if (!rawTarget) {
    return '';
  }

  if (
    rawTarget.startsWith('native-library:') ||
    rawTarget.startsWith('standalone:') ||
    rawTarget.startsWith('onboarding:')
  ) {
    return rawTarget;
  }

  return `native-library:${rawTarget}`;
}

function NotesRightPanel({
  note,
  onOpenNote,
  onClose,
}: {
  note: Note | null;
  onOpenNote: (noteId: string) => void;
  onClose: () => void;
}) {
  const outline = useMemo(() => extractOutline(noteContentToTiptap(note)), [note]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--pq-border)] bg-[var(--pq-surface-1)]">
      <section className="border-b border-[var(--pq-border)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
            Outline
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pq-icon-button h-7 w-7"
            title="Hide outline"
            aria-label="Hide outline"
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {outline.length > 0 ? outline.map((item) => (
            <div
              key={item.id}
              className="truncate rounded-md px-2 py-1 text-xs text-[var(--pq-text-muted)]"
              style={{ paddingLeft: `${Math.min(22, 8 + (item.level - 1) * 10)}px` }}
            >
              {item.text}
            </div>
          )) : (
            <div className="px-2 py-1 text-xs text-[var(--pq-text-faint)]">
              No outline
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
          Backlinks
        </div>
        <div className="mt-3 space-y-2">
          {note?.backlinks?.length ? note.backlinks.map((backlink) => (
            <button
              key={`${backlink.sourceNoteId}-${backlink.targetNoteId}`}
              type="button"
              onClick={() => onOpenNote(backlink.sourceNoteId)}
              className="block w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2 text-left transition hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-bg-secondary)]"
            >
              <div className="truncate text-xs font-semibold text-[var(--pq-text)]">
                {backlink.sourceTitle}
              </div>
              {backlink.sourceExcerpt ? (
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--pq-text-muted)]">
                  {backlink.sourceExcerpt}
                </div>
              ) : null}
            </button>
          )) : (
            <div className="px-2 py-1 text-xs text-[var(--pq-text-faint)]">
              No backlinks
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

export function NotesWorkspace() {
  const {
    notes,
    tags,
    activeNoteId,
    search,
    tag,
    loading,
    saving,
    error,
    setActiveNoteId,
    setSearch,
    setTag,
    loadNotes,
    refreshTags,
    createWorkspaceNote,
    updateWorkspaceNote,
    deleteWorkspaceNote,
  } = useNotesStore();
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(null);
  const [folders, setFolders] = useState<NoteFolder[]>(() => loadNoteFolders());
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [folderEditDraft, setFolderEditDraft] = useState<FolderEditDraft | null>(null);
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openNoteTab = useTabsStore((state) => state.openNoteTab);
  const updateNoteTabTitle = useTabsStore((state) => state.updateNoteTabTitle);
  const setNoteTabExternalUpdate = useTabsStore((state) => state.setNoteTabExternalUpdate);

  const activeNoteTab = useMemo(
    () =>
      tabs.find((tab): tab is NoteTab => tab.id === activeTabId && tab.type === 'note') ??
      null,
    [activeTabId, tabs],
  );

  const activeNote = useMemo(
    () => {
      const targetNoteId = activeNoteTab?.noteId ?? activeNoteId;

      return notes.find((note) => note.id === targetNoteId) ?? notes[0] ?? null;
    },
    [activeNoteId, activeNoteTab?.noteId, notes],
  );

  const childrenByParent = useMemo(() => buildFolderChildren(folders), [folders]);
  const notesByFolder = useMemo(() => groupNotesByDirectFolder(notes, folders), [folders, notes]);
  const uncategorizedCount = useMemo(
    () => filterNotesByFolder(notes, folders, UNCATEGORIZED_FOLDER_ID).length,
    [folders, notes],
  );
  const folderNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const folder of folders) {
      counts.set(folder.id, filterNotesByFolder(notes, folders, folder.id).length);
    }

    return counts;
  }, [folders, notes]);
  const creatingRootFolder = folderEditDraft?.kind === 'create' && folderEditDraft.parentId === null;
  const uncategorizedExpanded = expandedFolderIds.has(UNCATEGORIZED_FOLDER_ID);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTE_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (!activeFolderId || activeFolderId === UNCATEGORIZED_FOLDER_ID) return;
    if (!folders.some((folder) => folder.id === activeFolderId)) {
      setActiveFolderId(null);
    }
  }, [activeFolderId, folders]);

  const openNote = useCallback(
    (noteId: string) => {
      const note = notes.find((item) => item.id === noteId);

      setActiveNoteId(noteId);
      if (note) {
        openNoteTab(note.id, note.title || '未命名笔记');
      }
    },
    [notes, openNoteTab, setActiveNoteId],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const selectFolder = useCallback((folderId: string | null) => {
    setActiveFolderId(folderId);
    setTag(null);
  }, [setTag]);

  const startCreateFolder = useCallback((parentId: string | null = null) => {
    setFolderEditDraft({ kind: 'create', parentId, value: '' });
    if (parentId) {
      setExpandedFolderIds((current) => new Set(current).add(parentId));
    }
  }, []);

  const startRenameFolder = useCallback((folder: NoteFolder) => {
    setFolderEditDraft({ kind: 'rename', folderId: folder.id, value: folder.name });
  }, []);

  const updateFolderEditValue = useCallback((value: string) => {
    setFolderEditDraft((current) => current ? { ...current, value } : current);
  }, []);

  const cancelFolderEdit = useCallback(() => {
    setFolderEditDraft(null);
  }, []);

  const commitFolderEdit = useCallback(() => {
    if (!folderEditDraft) return;

    const name = cleanFolderName(folderEditDraft.value);
    if (!name) {
      setFolderEditDraft(null);
      return;
    }

    if (folderEditDraft.kind === 'create') {
      const id = createNoteFolderId();
      const parentId = folderEditDraft.parentId;
      setFolders((current) => [...current, { id, name, parentId }]);
      setActiveFolderId(id);
      setTag(null);
      if (parentId) {
        setExpandedFolderIds((current) => new Set(current).add(parentId));
      }
    } else {
      setFolders((current) =>
        current.map((item) => (item.id === folderEditDraft.folderId ? { ...item, name } : item)),
      );
    }

    setFolderEditDraft(null);
  }, [folderEditDraft, setTag]);

  const deleteFolder = useCallback((folder: NoteFolder) => {
    const removedIds = new Set([folder.id, ...getFolderDescendantIds(folder.id, folders)]);
    const hasNotes = notes.some((note) => note.folderId && removedIds.has(note.folderId));
    const message = hasNotes
      ? `删除“${folder.name}”及其子分类？其中的笔记会移动到未分类。`
      : `删除“${folder.name}”及其子分类？`;

    if (!window.confirm(message)) return;

    const previousActiveNoteId = activeNoteId;
    setFolders((current) => current.filter((item) => !removedIds.has(item.id)));
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      for (const id of removedIds) next.delete(id);
      return next;
    });
    if (activeFolderId && removedIds.has(activeFolderId)) {
      setActiveFolderId(null);
    }
    setFolderEditDraft((current) => {
      if (!current) return current;
      if (current.kind === 'rename' && removedIds.has(current.folderId)) return null;
      if (current.kind === 'create' && current.parentId && removedIds.has(current.parentId)) return null;
      return current;
    });

    const affectedNotes = notes.filter((note) => note.folderId && removedIds.has(note.folderId));
    if (affectedNotes.length > 0) {
      void Promise.all(affectedNotes.map((note) => updateWorkspaceNote(note.id, { folderId: null })))
        .finally(() => {
          if (previousActiveNoteId) setActiveNoteId(previousActiveNoteId);
        });
    }
  }, [activeFolderId, activeNoteId, folders, notes, setActiveNoteId, updateWorkspaceNote]);

  useEffect(() => {
    if (!activeNoteTab) {
      return;
    }

    if (activeNoteTab.noteId !== activeNoteId) {
      setActiveNoteId(activeNoteTab.noteId);
    }
  }, [activeNoteId, activeNoteTab, setActiveNoteId]);

  useEffect(() => {
    if (activeNote) {
      updateNoteTabTitle(activeNote.id, activeNote.title || '未命名笔记');
    }
  }, [activeNote, updateNoteTabTitle]);

  useEffect(() => {
    void loadNotes();
    void refreshTags();
    void listLibraryPapers({ limit: 1000, sortBy: 'updatedAt', sortDirection: 'desc' })
      .then(setPapers)
      .catch(() => setPapers([]));
  }, [loadNotes, refreshTags]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNotes();
    }, 220);

    return () => window.clearTimeout(timer);
  }, [loadNotes, search, tag]);

  useEffect(() => {
    const handleNoteChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteChangedEventDetail>).detail;
      if (!detail?.noteId) return;

      if (detail.action === 'updated') {
        if (isNoteEventRecord(detail.note)) {
          updateNoteTabTitle(detail.note.id, detail.note.title || '未命名笔记');
        }
        setNoteTabExternalUpdate(detail.noteId, true);
      }

      if (detail.action === 'deleted') {
        setNoteTabExternalUpdate(detail.noteId, false);
      }

      window.setTimeout(() => {
        void loadNotes();
        void refreshTags();
      }, 0);
    };

    window.addEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
    return () => window.removeEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
  }, [loadNotes, refreshTags, setNoteTabExternalUpdate, updateNoteTabTitle]);

  const handleCreateNote = useCallback((targetFolderId: string | null = activeFolderId) => {
    const folderId =
      targetFolderId && targetFolderId !== UNCATEGORIZED_FOLDER_ID
        ? targetFolderId
        : null;

    void createWorkspaceNote({
      title: '未命名笔记',
      contentText: '',
      tags: tag ? [tag] : [],
      folderId,
    }).then((note) => {
      openNoteTab(note.id, note.title || '未命名笔记');
    });
  }, [activeFolderId, createWorkspaceNote, openNoteTab, tag]);

  const handleCreateNoteInCurrentFolder = useCallback(() => {
    handleCreateNote(activeFolderId);
  }, [activeFolderId, handleCreateNote]);

  const moveNoteToFolder = useCallback((noteId: string, folderId: string | null) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || (note.folderId ?? null) === folderId) return;

    void updateWorkspaceNote(noteId, { folderId });
  }, [notes, updateWorkspaceNote]);

  const handleNoteDragStart = useCallback((event: DragEvent<HTMLElement>, note: Note) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(NOTE_DRAG_MIME, note.id);
    event.dataTransfer.setData('text/plain', note.title || '未命名笔记');
    setDraggingNoteId(note.id);
  }, []);

  const handleNoteDragEnd = useCallback(() => {
    setDraggingNoteId(null);
    setDragOverFolderId(null);
  }, []);

  const handleFolderDragOver = useCallback((event: DragEvent<HTMLElement>, folder: NoteFolder) => {
    if (!draggingNoteId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(folder.id);
    if ((childrenByParent.get(folder.id) ?? []).length > 0) {
      setExpandedFolderIds((current) => new Set(current).add(folder.id));
    }
  }, [childrenByParent, draggingNoteId]);

  const handleFolderDragLeave = useCallback((event: DragEvent<HTMLElement>, folder: NoteFolder) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOverFolderId((current) => (current === folder.id ? null : current));
    }
  }, []);

  const handleFolderDrop = useCallback((event: DragEvent<HTMLElement>, folder: NoteFolder) => {
    event.preventDefault();
    const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
    setDraggingNoteId(null);
    setDragOverFolderId(null);
    if (!noteId) return;
    moveNoteToFolder(noteId, folder.id);
  }, [moveNoteToFolder]);

  const handleUncategorizedDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!draggingNoteId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(UNCATEGORIZED_FOLDER_ID);
  }, [draggingNoteId]);

  const handleUncategorizedDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOverFolderId((current) => (current === UNCATEGORIZED_FOLDER_ID ? null : current));
    }
  }, []);

  const handleUncategorizedDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
    setDraggingNoteId(null);
    setDragOverFolderId(null);
    if (!noteId) return;
    moveNoteToFolder(noteId, null);
  }, [moveNoteToFolder]);

  const handleOpenPaper = useCallback((paperId: string) => {
    const paper = papers.find((item) => item.id === paperId);
    setSearch(paper?.title || paperId);
  }, [papers, setSearch]);

  const handleJumpToNoteAnchor = useCallback((note: Note, anchor: NoteAnchor) => {
    emitJumpToNoteAnchor({
      requestId: createNoteAnchorJumpRequestId(),
      targetPaperId: resolveNoteAnchorTargetPaperId(note, anchor),
      noteId: note.id,
      noteTitle: note.title,
      notePaperId: note.paperId,
      anchorId: anchor.id,
      anchorPaperId: anchor.paperId,
      anchorLabel: anchor.label,
      pdfLocation: anchor.pdfLocation ?? null,
    });
  }, []);

  const openSurfaceContextMenu = (event: MouseEvent) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    setContextMenu({ kind: 'surface', x: event.clientX, y: event.clientY });
  };

  const openNoteContextMenu = (event: MouseEvent, note: Note) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'note', x: event.clientX, y: event.clientY, note });
  };

  const openFolderContextMenu = (event: MouseEvent, folder: NoteFolder) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'folder', x: event.clientX, y: event.clientY, folder });
  };

  const contextMenuEntries = useMemo<NotesContextMenuEntry[]>(() => {
    if (!contextMenu) return [];

    if (contextMenu.kind === 'note') {
      const { note } = contextMenu;
      const contentText = notePlainText(note);
      const folderMoveEntries: NotesContextMenuEntry[] = [
        {
          id: 'move-note-uncategorized',
          label: '移动到未分类',
          disabled: !note.folderId,
          icon: <Folder className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            void updateWorkspaceNote(note.id, { folderId: null });
          },
        },
        ...folders.map((folder): NotesContextMenuEntry => ({
          id: `move-note-${folder.id}`,
          label: `移动到 ${getFolderPath(folder, folders)}`,
          disabled: note.folderId === folder.id,
          icon: <Folder className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            void updateWorkspaceNote(note.id, { folderId: folder.id });
          },
        })),
      ];

      return [
        {
          id: 'open-note',
          label: '打开笔记',
          tone: 'accent',
          icon: <FileText className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => openNote(note.id),
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
          disabled: !contentText.trim(),
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(contentText),
        },
        { type: 'separator', id: 'note-folder-separator' },
        ...folderMoveEntries,
        { type: 'separator', id: 'note-state-separator' },
        {
          id: 'toggle-pin',
          label: note.isPinned ? '取消置顶' : '置顶笔记',
          icon: <Pin className="h-4 w-4" fill={note.isPinned ? 'currentColor' : 'none'} strokeWidth={1.8} />,
          onSelect: () => {
            void updateWorkspaceNote(note.id, { isPinned: !note.isPinned });
          },
        },
        {
          id: 'toggle-favorite',
          label: note.isFavorite ? '取消收藏' : '收藏笔记',
          icon: <Star className="h-4 w-4" fill={note.isFavorite ? 'currentColor' : 'none'} strokeWidth={1.8} />,
          onSelect: () => {
            void updateWorkspaceNote(note.id, { isFavorite: !note.isFavorite });
          },
        },
        { type: 'separator', id: 'note-danger-separator' },
        {
          id: 'delete-note',
          label: '删除笔记',
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => deleteWorkspaceNote(note.id),
        },
      ];
    }

    if (contextMenu.kind === 'folder') {
      const { folder } = contextMenu;

      return [
        {
          id: 'new-note-in-folder',
          label: '在此分类新建笔记',
          tone: 'accent',
          icon: <Plus className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => handleCreateNote(folder.id),
        },
        {
          id: 'new-child-folder',
          label: '新建子分类',
          icon: <FolderPlus className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => startCreateFolder(folder.id),
        },
        {
          id: 'rename-folder',
          label: '重命名分类',
          icon: <Pencil className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => startRenameFolder(folder),
        },
        { type: 'separator', id: 'folder-danger-separator' },
        {
          id: 'delete-folder',
          label: '删除分类',
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => deleteFolder(folder),
        },
      ];
    }

    return [
      {
        id: 'new-note',
        label: '新建笔记',
        tone: 'accent',
        icon: <Plus className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: handleCreateNoteInCurrentFolder,
      },
      {
        id: 'new-folder',
        label: '新建一级分类',
        tone: 'accent',
        icon: <FolderPlus className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: () => startCreateFolder(null),
      },
      {
        id: 'clear-filter',
        label: '清除筛选',
        disabled: !search && !tag && !activeFolderId,
        icon: <Search className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: () => {
          setSearch('');
          setTag(null);
          setActiveFolderId(null);
        },
      },
    ];
  }, [
    activeFolderId,
    contextMenu,
    deleteFolder,
    deleteWorkspaceNote,
    folders,
    handleCreateNote,
    handleCreateNoteInCurrentFolder,
    openNote,
    search,
    setSearch,
    setTag,
    startCreateFolder,
    startRenameFolder,
    tag,
    updateWorkspaceNote,
  ]);

  return (
    <div
      className="pq-notes-workspace pq-workspace-surface grid h-full min-h-0 overflow-hidden text-[var(--pq-text)]"
      style={{
        gridTemplateColumns: rightPanelOpen
          ? '300px minmax(420px, 1fr) 320px'
          : '300px minmax(420px, 1fr)',
      }}
    >
      <aside
        className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[var(--pq-border-subtle)] bg-[var(--pq-surface-1)]"
        onContextMenu={openSurfaceContextMenu}
      >
        <div className="border-b border-[var(--pq-border-subtle)] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)]">
                <NotebookText className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--pq-text)]">Notes</div>
                <div className="mt-0.5 text-xs text-[var(--pq-text-faint)]">
                  {notes.length} notes
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCreateNoteInCurrentFolder}
              className="pq-icon-button h-8 w-8 rounded-lg bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]"
              title="New note"
              aria-label="New note"
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <label className="pq-input mt-3 flex h-8 items-center gap-2 rounded-lg px-2.5">
            <Search className="h-3.5 w-3.5 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--pq-text-faint)]"
            />
          </label>

          {error ? (
            <div className="mt-3 rounded-[var(--pq-radius-sm)] border border-[var(--pq-error-bg)] bg-[var(--pq-error-bg)] px-2.5 py-1.5 text-xs text-[var(--pq-error)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          {loading ? (
            <div className="space-y-1">
              <div className="h-7 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
              <div className="h-7 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
              <div className="h-7 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
            </div>
          ) : (
            <div className="space-y-4">
              <section className="space-y-1">
                <div className="px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
                  Workspace
                </div>

                <button
                  type="button"
                  onClick={() => selectFolder(null)}
                  className={cn(
                    'flex h-8 w-full items-center justify-between rounded-lg px-2 text-xs transition',
                    !tag && !activeFolderId
                      ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
                      : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                  )}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">全部笔记</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--pq-text-faint)]">{notes.length}</span>
                </button>

                <div>
                  <div className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (uncategorizedCount > 0) toggleFolder(UNCATEGORIZED_FOLDER_ID);
                      }}
                      className={cn(
                        'flex h-7 w-5 shrink-0 items-center justify-center rounded-md text-[var(--pq-text-faint)] transition',
                        uncategorizedCount > 0 ? 'hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]' : 'opacity-0',
                      )}
                      aria-label={uncategorizedExpanded ? '折叠未分类' : '展开未分类'}
                      disabled={uncategorizedCount === 0}
                    >
                      {uncategorizedExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectFolder(UNCATEGORIZED_FOLDER_ID)}
                      onDoubleClick={() => {
                        if (uncategorizedCount > 0) toggleFolder(UNCATEGORIZED_FOLDER_ID);
                      }}
                      onDragOver={handleUncategorizedDragOver}
                      onDragLeave={handleUncategorizedDragLeave}
                      onDrop={handleUncategorizedDrop}
                      className={cn(
                        'flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-transparent px-2 text-xs transition',
                        dragOverFolderId === UNCATEGORIZED_FOLDER_ID
                          ? 'border-[var(--pq-accent)] bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
                          : '',
                        activeFolderId === UNCATEGORIZED_FOLDER_ID
                          ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
                          : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                      )}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        {uncategorizedExpanded ? (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                        )}
                        <span className="truncate">未分类</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--pq-text-faint)]">{uncategorizedCount}</span>
                    </button>
                  </div>

                  {uncategorizedExpanded ? (
                    <div className="mt-0.5 space-y-0.5">
                      {(notesByFolder.get(null) ?? []).map((note) => (
                        <FolderNoteTreeItem
                          key={note.id}
                          note={note}
                          depth={1}
                          active={note.id === activeNote?.id}
                          dragging={draggingNoteId === note.id}
                          onSelect={openNote}
                          onDragStart={handleNoteDragStart}
                          onDragEnd={handleNoteDragEnd}
                          onContextMenu={openNoteContextMenu}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-1">
                <div className="flex h-7 items-center justify-between px-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
                    Folders
                  </span>
                  <button
                    type="button"
                    onClick={() => startCreateFolder(null)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--pq-text-faint)] transition hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]"
                    title="新建一级分类"
                    aria-label="新建一级分类"
                  >
                    <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                </div>

                {creatingRootFolder ? (
                  <FolderInlineEditor
                    depth={0}
                    value={folderEditDraft.value}
                    placeholder="分类名称"
                    mode="create"
                    onChange={updateFolderEditValue}
                    onCommit={commitFolderEdit}
                    onCancel={cancelFolderEdit}
                  />
                ) : null}

                {(childrenByParent.get(null) ?? []).map((folder) => (
                  <FolderTreeItem
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    childrenByParent={childrenByParent}
                    notesByFolder={notesByFolder}
                    activeFolderId={activeFolderId}
                    activeNoteId={activeNote?.id ?? null}
                    expandedFolderIds={expandedFolderIds}
                    noteCounts={folderNoteCounts}
                    draggingNoteId={draggingNoteId}
                    dragOverFolderId={dragOverFolderId}
                    folderEditDraft={folderEditDraft}
                    onSelect={selectFolder}
                    onToggle={toggleFolder}
                    onNoteSelect={openNote}
                    onNoteDragStart={handleNoteDragStart}
                    onNoteDragEnd={handleNoteDragEnd}
                    onNoteContextMenu={openNoteContextMenu}
                    onFolderDragOver={handleFolderDragOver}
                    onFolderDragLeave={handleFolderDragLeave}
                    onFolderDrop={handleFolderDrop}
                    onFolderEditChange={updateFolderEditValue}
                    onFolderEditCommit={commitFolderEdit}
                    onFolderEditCancel={cancelFolderEdit}
                    onContextMenu={openFolderContextMenu}
                  />
                ))}

                {!creatingRootFolder && (childrenByParent.get(null) ?? []).length === 0 ? (
                  <button
                    type="button"
                    onClick={() => startCreateFolder(null)}
                    className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed border-[var(--pq-border)] px-2 text-left text-xs text-[var(--pq-text-faint)] transition hover:border-[var(--pq-border-strong)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text-muted)]"
                  >
                    <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                    <span className="truncate">新建分类</span>
                  </button>
                ) : null}
              </section>
            </div>
          )}
        </div>
      </aside>

      <main className="relative flex h-full min-w-0 flex-col overflow-hidden bg-[var(--pq-bg-primary)] p-3">
        {!rightPanelOpen ? (
          <button
            type="button"
            onClick={() => setRightPanelOpen(true)}
            className="pq-icon-button absolute right-3 top-1/2 z-20 h-9 w-7 -translate-y-1/2 rounded-r-none border border-r-0 border-[var(--pq-border)] bg-[var(--pq-surface-1)] shadow-[var(--pq-shadow-soft)]"
            title="Show outline"
            aria-label="Show outline"
          >
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}

        <NoteEditor
          note={activeNote}
          saving={saving}
          notes={notes}
          tags={tags}
          papers={papers}
          onUpdate={async (noteId, patch, options) => {
            const updated = await updateWorkspaceNote(noteId, patch, options);
            updateNoteTabTitle(updated.id, updated.title || '未命名笔记');
            setNoteTabExternalUpdate(updated.id, false);
          }}
          onExternalUpdateChange={setNoteTabExternalUpdate}
          onOpenNote={openNote}
          onTagClick={setTag}
          onPaperClick={handleOpenPaper}
          onJumpToNoteAnchor={handleJumpToNoteAnchor}
        />
      </main>

      {rightPanelOpen ? (
        <NotesRightPanel note={activeNote} onOpenNote={openNote} onClose={() => setRightPanelOpen(false)} />
      ) : null}

      {contextMenu ? (
        <NotesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.kind === 'note' ? contextMenu.note.title || '未命名笔记' : '笔记'}
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default NotesWorkspace;
