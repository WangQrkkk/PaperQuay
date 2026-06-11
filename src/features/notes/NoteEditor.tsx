import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { mergeAttributes, Node as TiptapNode, type Editor, type Range } from '@tiptap/core';
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Mathematics from '@tiptap/extension-mathematics';
import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { cellAround, cellNear, tableEditingKey } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { all, createLowlight } from 'lowlight';
import {
  Bold,
  Code2,
  ClipboardPaste,
  Copy,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Plus,
  Quote,
  RefreshCw,
  RemoveFormatting,
  Save,
  Scissors,
  Strikethrough,
  Table2,
  Tag,
  Trash2,
} from 'lucide-react';
import { NOTE_CHANGED_EVENT, type NoteChangedEventDetail } from '../../app/appEvents';
import type { LiteraturePaper } from '../../types/library';
import type { Note, NoteAnchor, NoteAnchorInsertRequest, NoteTagSummary, UpdateNoteRequest } from '../../types/notes';
import { cn } from '../../utils/cn';
import { HashTag } from './extensions/HashTag';
import { NoteAnchorLink } from './extensions/NoteAnchorLink';
import { PaperReference } from './extensions/PaperReference';
import { SlashCommand } from './extensions/SlashCommand';
import { WikiLink } from './extensions/WikiLink';
import type { NoteSuggestionItem } from './extensions/suggestionMenu';
import {
  copyTextToClipboard,
  NotesContextMenu,
  type NotesContextMenuEntry,
} from './NotesContextMenu';
import {
  collectText,
  extractNoteAnchorIds,
  extractPaperRefs,
  extractWikiTitles,
  noteContentToTiptap,
  titleFromNoteContent,
} from './notesTiptap';
import { NoteBlockControls } from './NoteBlockControls';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import {
  clampDocPosition,
  deleteNoteBlock,
  duplicateNoteBlock,
  focusNoteBlock,
  focusTextPosition,
  getBlockLabelFromNode,
  getEditorContextAtPoint,
  insertComponentBelowBlock,
  insertParagraphBelowBlock,
  type NoteEditorContextMenuState,
} from './noteEditorBlockUtils.ts';
import { normalizeTagInput, noteAnchorBlockFromAnchor } from './noteUtils';
import {
  componentBlockNode,
  clearNoteEditorDraft,
  getImageFilesFromDataTransfer,
  headingNode,
  insertImageFilesIntoView,
  isImageFile,
  isNoteRecord,
  mergeAnchors,
  normalizeAnchorPageLabel,
  normalizeAnchorSourceTitle,
  normalizeSuggestionQuery,
  NOTE_TEMPLATES,
  paragraphNode,
  signature,
  slashCommandItems,
  snapshotFromEditor,
  snapshotFromNote,
  readNoteEditorDraft,
  writeNoteEditorDraft,
  type EditorSnapshot,
  type NoteSlashCommandItem,
} from './noteEditorUtils';
import 'katex/dist/katex.min.css';

const lowlight = createLowlight(all);

const EditableTable = Table.extend({
  selectable: false,
});

type TableCellPointer = {
  cell: HTMLTableCellElement;
  clientX: number;
  clientY: number;
};

function isTableCellEditClick(event: MouseEvent) {
  if (event.button !== 0) return false;

  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest('.column-resize-handle')) return false;
  if (target.closest('button, input, textarea, select, a, .pq-tiptap-token, [contenteditable="false"]')) return false;

  return Boolean(target.closest('td, th'));
}

function getClickedTableCell(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const cell = target.closest('td, th');
  return cell instanceof HTMLTableCellElement ? cell : null;
}

function getTableCellStartFromResolvedPosition($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return $pos.before(depth);
  }

  return null;
}

function getTableCellStartNearPosition(view: EditorView, position: number) {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.content.size));
  const $pos = view.state.doc.resolve(safePosition);
  const directCellStart = getTableCellStartFromResolvedPosition($pos);
  if (directCellStart !== null) return directCellStart;

  const nearbyCell = cellAround($pos) ?? cellNear($pos);
  return nearbyCell?.pos ?? null;
}

function createTextSelectionInsideTableCell(view: EditorView, cellStart: number, preferredPosition?: number) {
  const { doc } = view.state;
  const cellNode = doc.nodeAt(cellStart);
  if (!cellNode) return null;

  const cellEnd = cellStart + cellNode.nodeSize;
  const positions: number[] = [];

  if (typeof preferredPosition === 'number') {
    positions.push(Math.max(cellStart + 1, Math.min(preferredPosition, cellEnd - 1)));
  }

  cellNode.descendants((node, offset) => {
    if (!node.isTextblock) return true;

    positions.push(cellStart + 1 + offset + 1);
    return false;
  });

  positions.push(cellStart + 1);

  for (const position of positions) {
    try {
      const safePosition = Math.max(cellStart + 1, Math.min(position, cellEnd - 1));
      const selection = TextSelection.near(doc.resolve(safePosition), 1);
      const selectionCellStart = getTableCellStartFromResolvedPosition(selection.$from);

      if (selectionCellStart === cellStart) {
        return selection;
      }
    } catch {
      // Ignore invalid cursor candidates and try the next table-cell textblock.
    }
  }

  return null;
}

function createTableCellTextSelection(view: EditorView, pointer: TableCellPointer) {
  const positions: number[] = [];
  const positionAtCoords = view.posAtCoords({ left: pointer.clientX, top: pointer.clientY });

  if (positionAtCoords?.inside !== undefined && positionAtCoords.inside >= 0) {
    positions.push(positionAtCoords.inside);
  }

  if (positionAtCoords) {
    positions.push(positionAtCoords.pos);
  }

  try {
    positions.push(view.posAtDOM(pointer.cell, 0));
    positions.push(view.posAtDOM(pointer.cell, 0) + 1);
  } catch {
    // Some browser/table DOM positions cannot be mapped directly.
  }

  for (const position of positions) {
    const cellStart = getTableCellStartNearPosition(view, position);
    if (cellStart === null) continue;

    const selection = createTextSelectionInsideTableCell(view, cellStart, positionAtCoords?.pos);
    if (selection) return selection;
  }

  return null;
}

function setTableCellTextSelection(view: EditorView, pointer: TableCellPointer) {
  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;

    const selection = createTableCellTextSelection(view, pointer);
    if (!selection) return;

    view.dispatch(
      view.state.tr
        .setSelection(selection)
        .setMeta(tableEditingKey, -1)
        .scrollIntoView(),
    );
    view.focus();
  });
}

const TEXT = {
  editorLoading: 'Loading editor...',
  linkPrompt: '\u8f93\u5165\u94fe\u63a5\u5730\u5740',
  imagePrompt: '\u8f93\u5165\u56fe\u7247\u5730\u5740\u6216\u672c\u5730 data URL',
  mathPrompt: '\u8f93\u5165 LaTeX \u516c\u5f0f',
  headingPlaceholder: '\u8f93\u5165\u6807\u9898...',
  bodyPlaceholder: 'Start writing...',
  noNote: 'No note selected',
  untitled: '\u672a\u547d\u540d\u7b14\u8bb0',
  tagsPlaceholder: 'Tags',
  saving: 'Saving...',
  dirty: 'Unsaved',
  saved: 'Saved',
  save: 'Save',
  externalUpdate: '有外部更新',
  externalUpdateDescription: '这条笔记已在其他位置保存。刷新后会加载最新版本。',
  externalUpdateDirtyDescription: '这条笔记已在其他位置保存。当前编辑器还有未保存内容，刷新会用最新版本覆盖当前编辑器。',
  refresh: '刷新',
};

function createNoteEditorSourceId() {
  return `note-editor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function NoteComponentBlockView({ node, selected, updateAttributes }: NodeViewProps) {
  const title = typeof node.attrs.title === 'string' && node.attrs.title.trim()
    ? node.attrs.title
    : 'Component';

  return (
    <NodeViewWrapper
      as="section"
      className={cn('pq-note-component-block', selected ? 'is-selected' : '')}
    >
      <div className="pq-note-component-header" contentEditable={false}>
        <div className="pq-note-component-kicker">Component</div>
        <input
          value={title}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="pq-note-component-title-input"
          aria-label="Component title"
        />
      </div>
      <NodeViewContent className="pq-note-component-content" />
    </NodeViewWrapper>
  );
}

const NoteComponentBlock = TiptapNode.create({
  name: 'noteComponentBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      title: {
        default: 'Component',
      },
      variant: {
        default: 'note',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-type="note-component-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'note-component-block' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteComponentBlockView);
  },
});

interface NoteAnchorBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  onClick: ((anchorId: string) => void) | null;
}

function NoteAnchorBlockView({ node, selected, extension }: NodeViewProps) {
  const anchorId = String(node.attrs.anchorId || '');
  const label = normalizeAnchorPageLabel(String(node.attrs.label || '定位'));
  const sourceLabel = String(node.attrs.sourceLabel || '摘录');
  const sourceTitle = normalizeAnchorSourceTitle(String(node.attrs.sourceTitle || ''), sourceLabel);
  const excerpt = String(node.attrs.excerpt || '');
  const onClick = (extension.options as NoteAnchorBlockOptions).onClick;

  return (
    <NodeViewWrapper
      as="figure"
      className={cn('pq-note-anchor-card', selected ? 'is-selected' : '')}
      data-type="note-anchor-block"
      spellCheck={false}
    >
      <blockquote className="pq-note-anchor-card-quote" contentEditable={false}>
        <span aria-hidden="true">“</span>
        {excerpt || '无摘录文本'}
        <span aria-hidden="true">”</span>
      </blockquote>
      <figcaption className="pq-note-anchor-card-meta" contentEditable={false}>
        <span className="pq-note-anchor-card-source" title={sourceTitle}>{sourceTitle}</span>
        <button
          type="button"
          className="pq-note-anchor-card-page"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (anchorId) onClick?.(anchorId);
          }}
          title="点击定位到原文"
          aria-label={`点击定位到原文 ${label}`}
        >
          {label}
        </button>
      </figcaption>
    </NodeViewWrapper>
  );
}

const NoteAnchorBlock = TiptapNode.create<NoteAnchorBlockOptions>({
  name: 'noteAnchorBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onClick: null,
    };
  },

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-anchor-id'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-note-anchor-id': attributes.anchorId } : {},
      },
      label: {
        default: '定位',
        parseHTML: (element) => element.getAttribute('data-note-anchor-label') || '定位',
        renderHTML: (attributes) =>
          attributes.label ? { 'data-note-anchor-label': attributes.label } : {},
      },
      sourceLabel: {
        default: '摘录',
        parseHTML: (element) => element.getAttribute('data-note-anchor-source') || '摘录',
        renderHTML: (attributes) =>
          attributes.sourceLabel ? { 'data-note-anchor-source': attributes.sourceLabel } : {},
      },
      sourceTitle: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-note-anchor-source-title') ||
          element.querySelector('[data-note-anchor-source-title]')?.textContent ||
          '',
        renderHTML: (attributes) =>
          attributes.sourceTitle ? { 'data-note-anchor-source-title': attributes.sourceTitle } : {},
      },
      excerpt: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-note-anchor-excerpt') ||
          element.querySelector('[data-note-anchor-excerpt]')?.textContent ||
          '',
        renderHTML: (attributes) =>
          attributes.excerpt ? { 'data-note-anchor-excerpt': attributes.excerpt } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="note-anchor-block"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = normalizeAnchorPageLabel(String(node.attrs.label || '定位'));
    const sourceLabel = String(node.attrs.sourceLabel || '摘录');
    const sourceTitle = normalizeAnchorSourceTitle(String(node.attrs.sourceTitle || ''), sourceLabel);
    const excerpt = String(node.attrs.excerpt || '');

    return [
      'figure',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        { 'data-type': 'note-anchor-block', class: 'pq-note-anchor-card' },
      ),
      ['blockquote', { 'data-note-anchor-excerpt': 'true', class: 'pq-note-anchor-card-quote' }, [
        'span',
        { 'aria-hidden': 'true' },
        '“',
      ], excerpt || '无摘录文本', [
        'span',
        { 'aria-hidden': 'true' },
        '”',
      ]],
      [
        'figcaption',
        { 'data-note-anchor-meta': 'true', class: 'pq-note-anchor-card-meta' },
        ['span', {
          'data-note-anchor-source-title': 'true',
          class: 'pq-note-anchor-card-source',
          title: sourceTitle,
        }, sourceTitle],
        [
          'span',
          {
            'data-type': 'noteAnchorLink',
            'data-note-anchor-id': node.attrs.anchorId,
            'data-note-anchor-label': label,
            class: 'pq-note-anchor-card-page pq-tiptap-note-anchor',
            title: '点击定位到原文',
          },
          label,
        ],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteAnchorBlockView);
  },
});

function runSlashCommand(editor: Editor, range: Range, item: NoteSlashCommandItem) {
  const chain = editor.chain().focus().deleteRange(range);

  if (item.id === 'paragraph') {
    chain.setParagraph().run();
    return;
  }

  if (item.id === 'heading-1') {
    chain.setNode('heading', { level: 1 }).run();
    return;
  }

  if (item.id === 'heading-2') {
    chain.setNode('heading', { level: 2 }).run();
    return;
  }

  if (item.id === 'heading-3') {
    chain.setNode('heading', { level: 3 }).run();
    return;
  }

  if (item.id === 'bullet-list') {
    chain.toggleBulletList().run();
    return;
  }

  if (item.id === 'ordered-list') {
    chain.toggleOrderedList().run();
    return;
  }

  if (item.id === 'task-list') {
    chain.toggleTaskList().run();
    return;
  }

  if (item.id === 'quote') {
    chain.toggleBlockquote().run();
    return;
  }

  if (item.id === 'code-block') {
    chain.toggleCodeBlock().run();
    return;
  }

  if (item.id === 'table') {
    chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    return;
  }

  if (item.id === 'component') {
    const insertAt = range.from;
    chain.insertContent(componentBlockNode('Component'), { updateSelection: false }).run();
    focusTextPosition(editor, insertAt + 2);
    return;
  }

  if (item.id === 'math') {
    chain.insertInlineMath({ latex: 'E = mc^2' }).insertContent(' ').run();
    return;
  }

  if (item.id.startsWith('template:')) {
    const templateId = item.id.slice('template:'.length);
    const template = NOTE_TEMPLATES.find((entry) => entry.id === templateId);
    if (template) {
      chain.insertContent([...template.content, paragraphNode()]).run();
    }
  }
}

interface NoteEditorProps {
  note: Note | null;
  saving: boolean;
  onUpdate: (
    noteId: string,
    patch: UpdateNoteRequest,
    options?: { sourceId?: string },
  ) => void | Promise<void>;
  notes?: Note[];
  tags?: NoteTagSummary[];
  papers?: LiteraturePaper[];
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  compact?: boolean;
  editorSourceId?: string;
  externalUpdateNote?: Note | null;
  onExternalUpdateChange?: (noteId: string, externalUpdate: boolean) => void;
  onExternalUpdateApply?: (note: Note) => void;
  onOpenNote?: (noteId: string) => void;
  onTagClick?: (tag: string) => void;
  onPaperClick?: (paperId: string) => void;
  onJumpToNoteAnchor?: (note: Note, anchor: NoteAnchor) => void;
}

function iconNode(node: ReactNode) {
  return node;
}

async function readTextFromClipboard() {
  const bridgeText = window.paperquay?.clipboard?.readText?.();
  const normalizedBridgeText = bridgeText?.trim() ?? '';
  if (normalizedBridgeText) return normalizedBridgeText;

  try {
    return (await navigator.clipboard?.readText?.())?.trim() ?? '';
  } catch {
    return '';
  }
}

export function NoteEditor({
  note,
  saving,
  onUpdate,
  notes = [],
  tags = [],
  papers = [],
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  compact = false,
  editorSourceId,
  externalUpdateNote = null,
  onExternalUpdateChange,
  onExternalUpdateApply,
  onOpenNote,
  onTagClick,
  onPaperClick,
  onJumpToNoteAnchor,
}: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [tagText, setTagText] = useState('');
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [color, setColor] = useState('#fef3c7');
  const [revision, setRevision] = useState(0);
  const [externalUpdateAvailable, setExternalUpdateAvailable] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<NoteEditorContextMenuState | null>(null);
  const snapshotRef = useRef<EditorSnapshot>({
    contentJson: noteContentToTiptap(null),
    contentHtml: '',
    contentText: '',
    wordCount: 0,
  });
  const editorSourceIdRef = useRef(editorSourceId ?? createNoteEditorSourceId());
  const lastSavedSignatureRef = useRef('');
  const latestCandidatesRef = useRef({ notes, tags, papers });
  const latestNoteRef = useRef<Note | null>(note);
  const externalNoteRef = useRef<Note | null>(null);
  const tagEditorRef = useRef<HTMLDivElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  const loadedNoteIdRef = useRef<string | null>(null);
  const appliedUpdatedAtRef = useRef<number | null>(note?.updatedAt ?? null);
  const dirtyRef = useRef(false);
  const externalUpdateAvailableRef = useRef(false);
  const forceApplyIncomingRef = useRef(false);
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const handledAnchorInsertRequestRef = useRef('');
  const pendingAnchorsRef = useRef(new Map<string, NoteAnchor>());

  useEffect(() => {
    latestCandidatesRef.current = { notes, tags, papers };
  }, [notes, papers, tags]);

  useEffect(() => {
    if (!tagEditorOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!tagEditorRef.current?.contains(event.target as Node)) {
        setTagEditorOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [tagEditorOpen]);

  useEffect(() => {
    latestNoteRef.current = note;
    if (note) {
      for (const anchor of note.anchors) {
        pendingAnchorsRef.current.delete(anchor.id);
      }
    }
  }, [note]);

  const extensions = useMemo(() => [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      dropcursor: {
        color: 'rgba(13, 148, 136, 0.72)',
        width: 2,
      },
    }),
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Image.configure({ allowBase64: true }),
    EditableTable.configure({ resizable: true, allowTableNodeSelection: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading' ? TEXT.headingPlaceholder : TEXT.bodyPlaceholder,
    }),
    CharacterCount,
    CodeBlockLowlight.configure({ lowlight }),
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    NoteComponentBlock,
    NoteAnchorBlock.configure({
      onClick: (anchorId) => {
        const currentNote = latestNoteRef.current;
        const anchor = currentNote?.anchors.find((item) => item.id === anchorId);

        if (currentNote && anchor) {
          onJumpToNoteAnchor?.(currentNote, anchor);
        }
      },
    }),
    SlashCommand.configure({
      items: slashCommandItems,
      command: ({ editor, range, item }) => runSlashCommand(editor, range, item),
    }),
    NoteAnchorLink.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-note-anchor' },
      onClick: (anchorId) => {
        const currentNote = latestNoteRef.current;
        const anchor = currentNote?.anchors.find((item) => item.id === anchorId);

        if (currentNote && anchor) {
          onJumpToNoteAnchor?.(currentNote, anchor);
        }
      },
    }),
    WikiLink.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-wiki-link' },
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['[[']);
        return latestCandidatesRef.current.notes
          .filter((item) => item.id !== note?.id)
          .filter((item) => !normalized || item.title.toLocaleLowerCase().includes(normalized))
          .slice(0, 8)
          .map((item): NoteSuggestionItem => ({
            id: item.id,
            label: item.title || TEXT.untitled,
            description: item.contentText || item.excerpt || item.content || '',
          }));
      },
      onClick: (noteId) => onOpenNote?.(noteId),
    }),
    HashTag.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-hash-tag' },
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['#']);
        const values = new Map<string, number>();
        for (const item of latestCandidatesRef.current.tags) values.set(item.tag, item.count);
        for (const item of latestCandidatesRef.current.notes) {
          for (const tag of item.tags) values.set(tag, values.get(tag) ?? 0);
        }
        return Array.from(values.entries())
          .filter(([tag]) => !normalized || tag.toLocaleLowerCase().includes(normalized))
          .slice(0, 8)
          .map(([tag, count]) => ({
            id: tag,
            label: tag,
            description: `${count || 0} notes`,
          }));
      },
      onClick: (tag) => onTagClick?.(tag),
    }),
    PaperReference.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-paper-ref' },
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['@']);
        return latestCandidatesRef.current.papers
          .filter((paper) =>
            !normalized ||
            paper.id.toLocaleLowerCase().includes(normalized) ||
            paper.title.toLocaleLowerCase().includes(normalized),
          )
          .slice(0, 8)
          .map((paper) => ({
            id: paper.id,
            label: paper.title || paper.id,
            description: paper.authors.map((author) => author.name).join(', ') || paper.year || paper.id,
          }));
      },
      onClick: (paperId) => onPaperClick?.(paperId),
    }),
  ], [note?.id, onJumpToNoteAnchor, onOpenNote, onPaperClick, onTagClick]);

  const editor = useEditor({
    extensions,
    content: noteContentToTiptap(note),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (!(event instanceof MouseEvent) || !isTableCellEditClick(event)) return false;

          const cell = getClickedTableCell(event);
          if (!cell) return false;

          setTableCellTextSelection(view, {
            cell,
            clientX: event.clientX,
            clientY: event.clientY,
          });

          return true;
        },
      },
      handleClick: (view, _position, event) => {
        if (!isTableCellEditClick(event)) return false;

        const cell = getClickedTableCell(event);
        if (!cell) return false;

        setTableCellTextSelection(view, {
          cell,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        return false;
      },
      handlePaste: (view, event) => {
        const files = getImageFilesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;

        event.preventDefault();
        return insertImageFilesIntoView(view, files);
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;

        const files = getImageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return false;

        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return insertImageFilesIntoView(view, files, position?.pos ?? null);
      },
    },
    onUpdate: ({ editor }) => {
      snapshotRef.current = snapshotFromEditor(editor);
      setRevision((value) => value + 1);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      lastSelectionRef.current = { from, to };
    },
  }, [note?.id]);

  const runContextCommand = useCallback((
    context: NoteEditorContextMenuState,
    command: () => void,
    options: { preserveSelection?: boolean } = {},
  ) => {
    if (!editor || editor.isDestroyed) return;

    if (!options.preserveSelection) {
      focusNoteBlock(editor, context.block, context.position);
    } else {
      editor.commands.focus();
    }

    command();
  }, [editor]);

  const editorContextMenuEntries = useMemo<NotesContextMenuEntry[]>(() => {
    if (!editor || editor.isDestroyed || !editorContextMenu) return [];

    const context = editorContextMenu;
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to && context.position >= from && context.position <= to;
    const blockTitle = getBlockLabelFromNode(context.block.node);
    const run = (command: () => void, preserveSelection = false) => () =>
      runContextCommand(context, command, { preserveSelection });
    const getSelectedText = () => editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      '\n',
    );
    const copySelectionOrBlock = async () => {
      const selectedText = hasSelection ? getSelectedText() : '';
      await copyTextToClipboard(selectedText || context.block.node.textContent);
    };
    const cutSelection = async () => {
      const selectedText = getSelectedText();

      if (!selectedText.trim()) return;

      await copyTextToClipboard(selectedText);
      editor.chain().focus().deleteSelection().run();
    };
    const pasteClipboardText = async () => {
      const text = await readTextFromClipboard();

      if (!text || editor.isDestroyed) return;

      if (hasSelection) {
        editor.chain().focus().insertContent(text).run();
        return;
      }

      focusNoteBlock(editor, context.block, context.position);
      editor.commands.insertContent(text);
    };

    const tableEntries: NotesContextMenuEntry[] = context.inTable
      ? [
          {
            id: 'table-add-row-before',
            label: '在上方插入行',
            icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().addRowBefore().run()),
          },
          {
            id: 'table-add-row-after',
            label: '在下方插入行',
            icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().addRowAfter().run()),
          },
          {
            id: 'table-add-column-before',
            label: '在左侧插入列',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().addColumnBefore().run()),
          },
          {
            id: 'table-add-column-after',
            label: '在右侧插入列',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().addColumnAfter().run()),
          },
          { type: 'separator', id: 'table-separator-structure' },
          {
            id: 'table-toggle-header-row',
            label: '切换表头行',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().toggleHeaderRow().run()),
          },
          {
            id: 'table-toggle-header-column',
            label: '切换表头列',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            onSelect: run(() => editor.chain().focus().toggleHeaderColumn().run()),
          },
          {
            id: 'table-merge-cells',
            label: '合并单元格',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            disabled: !editor.can().mergeCells(),
            onSelect: run(() => editor.chain().focus().mergeCells().run()),
          },
          {
            id: 'table-split-cell',
            label: '拆分单元格',
            icon: iconNode(<Table2 className="h-4 w-4" strokeWidth={1.8} />),
            disabled: !editor.can().splitCell(),
            onSelect: run(() => editor.chain().focus().splitCell().run()),
          },
          { type: 'separator', id: 'table-separator-delete' },
          {
            id: 'table-delete-row',
            label: '删除当前行',
            icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
            tone: 'danger',
            onSelect: run(() => editor.chain().focus().deleteRow().run()),
          },
          {
            id: 'table-delete-column',
            label: '删除当前列',
            icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
            tone: 'danger',
            onSelect: run(() => editor.chain().focus().deleteColumn().run()),
          },
          {
            id: 'table-delete-table',
            label: '删除表格',
            icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
            tone: 'danger',
            onSelect: run(() => editor.chain().focus().deleteTable().run()),
          },
          { type: 'separator', id: 'table-separator-block' },
        ]
      : [];

    return [
      ...tableEntries,
      {
        id: 'context-title',
        label: hasSelection ? '复制选中文本' : `复制${blockTitle}`,
        icon: iconNode(<Copy className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: copySelectionOrBlock,
      },
      {
        id: 'cut',
        label: '剪切',
        icon: iconNode(<Scissors className="h-4 w-4" strokeWidth={1.8} />),
        disabled: !hasSelection,
        onSelect: cutSelection,
      },
      {
        id: 'paste',
        label: '粘贴',
        icon: iconNode(<ClipboardPaste className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: pasteClipboardText,
      },
      { type: 'separator', id: 'context-separator-inline' },
      {
        id: 'bold',
        label: '加粗',
        icon: iconNode(<Bold className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleBold().run(), hasSelection),
      },
      {
        id: 'italic',
        label: '斜体',
        icon: iconNode(<Italic className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleItalic().run(), hasSelection),
      },
      {
        id: 'strike',
        label: '删除线',
        icon: iconNode(<Strikethrough className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleStrike().run(), hasSelection),
      },
      {
        id: 'highlight',
        label: '高亮',
        icon: iconNode(<Highlighter className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleHighlight({ color: '#fef3c7' }).run(), hasSelection),
      },
      {
        id: 'clear-marks',
        label: '清除文字样式',
        icon: iconNode(<RemoveFormatting className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().unsetAllMarks().run(), hasSelection),
      },
      { type: 'separator', id: 'context-separator-block-style' },
      {
        id: 'paragraph',
        label: '设为正文',
        icon: iconNode(<Pilcrow className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().setParagraph().run()),
      },
      {
        id: 'heading-1',
        label: '设为一级标题',
        icon: iconNode(<Heading1 className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()),
      },
      {
        id: 'heading-2',
        label: '设为二级标题',
        icon: iconNode(<Heading2 className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()),
      },
      {
        id: 'heading-3',
        label: '设为三级标题',
        icon: iconNode(<Heading3 className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()),
      },
      {
        id: 'bullet-list',
        label: '转换为无序列表',
        icon: iconNode(<List className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleBulletList().run()),
      },
      {
        id: 'ordered-list',
        label: '转换为有序列表',
        icon: iconNode(<ListOrdered className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleOrderedList().run()),
      },
      {
        id: 'task-list',
        label: '转换为任务列表',
        icon: iconNode(<ListChecks className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleTaskList().run()),
      },
      {
        id: 'quote',
        label: '转换为引用',
        icon: iconNode(<Quote className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleBlockquote().run()),
      },
      {
        id: 'code-block',
        label: '转换为代码块',
        icon: iconNode(<Code2 className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => editor.chain().focus().toggleCodeBlock().run()),
      },
      { type: 'separator', id: 'context-separator-block-actions' },
      {
        id: 'insert-below',
        label: '在下方插入一行',
        icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => insertParagraphBelowBlock(editor, context.block)),
      },
      {
        id: 'insert-component',
        label: '在下方插入组件块',
        icon: iconNode(<FileText className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => insertComponentBelowBlock(editor, context.block)),
      },
      {
        id: 'duplicate-block',
        label: '复制并插入当前块',
        icon: iconNode(<FileText className="h-4 w-4" strokeWidth={1.8} />),
        onSelect: run(() => duplicateNoteBlock(editor, context.block)),
      },
      {
        id: 'delete-block',
        label: '删除当前块',
        icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
        tone: 'danger',
        onSelect: run(() => deleteNoteBlock(editor, context.block)),
      },
    ];
  }, [editor, editorContextMenu, runContextCommand]);

  const currentSignature = useMemo(
    () => signature({ title, tagText, color, snapshot: snapshotRef.current }),
    [color, revision, tagText, title],
  );
  const dirty = Boolean(note && currentSignature !== lastSavedSignatureRef.current);
  const currentTags = useMemo(() => normalizeTagInput(tagText), [tagText]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    externalUpdateAvailableRef.current = externalUpdateAvailable;
  }, [externalUpdateAvailable]);

  const setExternalUpdateState = useCallback((value: boolean, noteId = note?.id) => {
    externalUpdateAvailableRef.current = value;
    setExternalUpdateAvailable(value);
    if (noteId) {
      onExternalUpdateChange?.(noteId, value);
    }
  }, [note?.id, onExternalUpdateChange]);

  useEffect(() => {
    if (!note) {
      setExternalUpdateState(false, loadedNoteIdRef.current ?? undefined);
      appliedUpdatedAtRef.current = null;
      return;
    }

    const handleNoteChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteChangedEventDetail>).detail;
      if (!detail || detail.noteId !== note.id) return;
      if (detail.sourceId && detail.sourceId === editorSourceIdRef.current) return;
      if (detail.action === 'deleted') return;

      const nextUpdatedAt = detail.updatedAt ?? (detail.note as Note | undefined)?.updatedAt ?? 0;
      const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;

      if (isNoteRecord(detail.note, note.id)) {
        const incomingNote = detail.note;
        const incomingSnapshot = snapshotFromNote(incomingNote);
        const incomingSignature = signature({
          title: incomingNote.title ?? '',
          tagText: incomingNote.tags.join(', '),
          color: incomingNote.color ?? '#fef3c7',
          snapshot: incomingSnapshot,
        });
        const localSignature = signature({
          title,
          tagText,
          color,
          snapshot: snapshotRef.current,
        });

        if (incomingSignature === localSignature) {
          if (nextUpdatedAt > appliedUpdatedAt) {
            appliedUpdatedAtRef.current = nextUpdatedAt;
          }
          return;
        }

        externalNoteRef.current = incomingNote;
        setExternalUpdateState(true, note.id);
        return;
      }

      if (nextUpdatedAt && nextUpdatedAt <= appliedUpdatedAt) return;
      setExternalUpdateState(true, note.id);
    };

    window.addEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
    return () => window.removeEventListener(NOTE_CHANGED_EVENT, handleNoteChanged);
  }, [color, note, setExternalUpdateState, tagText, title]);

  useEffect(() => {
    if (!note || !isNoteRecord(externalUpdateNote, note.id)) return;

    const incomingSnapshot = snapshotFromNote(externalUpdateNote);
    const incomingSignature = signature({
      title: externalUpdateNote.title ?? '',
      tagText: externalUpdateNote.tags.join(', '),
      color: externalUpdateNote.color ?? '#fef3c7',
      snapshot: incomingSnapshot,
    });
    const localSignature = signature({
      title,
      tagText,
      color,
      snapshot: snapshotRef.current,
    });
    const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;

    if (incomingSignature !== localSignature && (!externalUpdateNote.updatedAt || externalUpdateNote.updatedAt >= appliedUpdatedAt)) {
      externalNoteRef.current = externalUpdateNote;
      setExternalUpdateState(true, note.id);
    }
  }, [color, externalUpdateNote, note, setExternalUpdateState, tagText, title]);

  useEffect(() => {
    const incomingSnapshot = snapshotFromNote(note);
    const nextTitle = note?.title ?? '';
    const nextTagText = note?.tags.join(', ') ?? '';
    const nextColor = note?.color ?? '#fef3c7';
    const incomingSignature = signature({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
      snapshot: incomingSnapshot,
    });
    const noteId = note?.id ?? null;
    const sameNote = loadedNoteIdRef.current === noteId;
    const forceApplyIncoming = forceApplyIncomingRef.current;
    forceApplyIncomingRef.current = false;
    const incomingUpdatedAt = note?.updatedAt ?? 0;
    const appliedUpdatedAt = appliedUpdatedAtRef.current ?? 0;
    const localSignature = signature({
      title,
      tagText,
      color,
      snapshot: snapshotRef.current,
    });
    const draft = !forceApplyIncoming && noteId
      ? readNoteEditorDraft(editorSourceIdRef.current, noteId, note?.updatedAt ?? null)
      : null;
    const canRestoreDraft =
      draft &&
      draft.savedSignature === incomingSignature &&
      draft.draftSignature !== incomingSignature &&
      (!sameNote || !dirtyRef.current || localSignature === incomingSignature);

    if (canRestoreDraft) {
      setTitle(draft.title);
      setTagText(draft.tagText);
      setColor(draft.color);

      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(draft.snapshot.contentJson, { emitUpdate: false });
      }

      snapshotRef.current = draft.snapshot;
      pendingAnchorsRef.current = new Map(draft.pendingAnchors.map((anchor) => [anchor.id, anchor]));
      loadedNoteIdRef.current = noteId;
      appliedUpdatedAtRef.current = note?.updatedAt ?? null;
      lastSavedSignatureRef.current = incomingSignature;
      externalNoteRef.current = null;
      setExternalUpdateState(false, noteId ?? undefined);
      setRevision((value) => value + 1);
      return;
    }

    if (draft && noteId && draft.draftSignature === incomingSignature) {
      clearNoteEditorDraft(editorSourceIdRef.current, noteId);
    }

    const incomingHasUnappliedChanges =
      sameNote &&
      !forceApplyIncoming &&
      incomingUpdatedAt > appliedUpdatedAt &&
      localSignature !== incomingSignature;

    if (incomingHasUnappliedChanges) {
      if (isNoteRecord(note, noteId)) {
        externalNoteRef.current = note;
      }
      setExternalUpdateState(true, noteId ?? undefined);
      return;
    }

    if (sameNote && externalUpdateAvailableRef.current && !forceApplyIncoming) {
      if (!isNoteRecord(externalNoteRef.current, noteId) && isNoteRecord(note, noteId)) {
        externalNoteRef.current = note;
      }
      return;
    }

    if (!sameNote || !dirtyRef.current || forceApplyIncoming) {
      setTitle(nextTitle);
      setTagText(nextTagText);
      setColor(nextColor);
    }

    if (editor && !editor.isDestroyed) {
      const editorContentChanged =
        JSON.stringify(editor.getJSON()) !== JSON.stringify(incomingSnapshot.contentJson);
      const shouldApplyContent =
        !sameNote ||
        forceApplyIncoming ||
        (!editor.isFocused && !dirtyRef.current && editorContentChanged);

      if (shouldApplyContent) {
        editor.commands.setContent(incomingSnapshot.contentJson, { emitUpdate: false });
        snapshotRef.current = incomingSnapshot;
      }
    } else {
      snapshotRef.current = incomingSnapshot;
    }

    loadedNoteIdRef.current = noteId;
    appliedUpdatedAtRef.current = note?.updatedAt ?? null;
    lastSavedSignatureRef.current = incomingSignature;
    if (forceApplyIncoming || !sameNote) {
      externalNoteRef.current = null;
      setExternalUpdateState(false, noteId ?? undefined);
    }
    setRevision((value) => value + 1);
  }, [color, editor, note, note?.id, note?.updatedAt, setExternalUpdateState, tagText, title]);

  useEffect(() => {
    if (!note || loadedNoteIdRef.current !== note.id || !lastSavedSignatureRef.current) {
      return;
    }

    if (!dirty) {
      clearNoteEditorDraft(editorSourceIdRef.current, note.id);
      return;
    }

    writeNoteEditorDraft(editorSourceIdRef.current, {
      noteId: note.id,
      baseUpdatedAt: appliedUpdatedAtRef.current ?? note.updatedAt ?? null,
      savedSignature: lastSavedSignatureRef.current,
      draftSignature: currentSignature,
      title,
      tagText,
      color,
      snapshot: snapshotRef.current,
      pendingAnchors: Array.from(pendingAnchorsRef.current.values()),
      updatedAt: Date.now(),
    });
  }, [color, currentSignature, dirty, note, note?.id, note?.updatedAt, revision, tagText, title]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !note || !pendingAnchorInsert) return;
    if (pendingAnchorInsert.noteId && pendingAnchorInsert.noteId !== note.id) return;
    if (handledAnchorInsertRequestRef.current === pendingAnchorInsert.requestId) return;

    handledAnchorInsertRequestRef.current = pendingAnchorInsert.requestId;
    pendingAnchorsRef.current.set(pendingAnchorInsert.anchor.id, pendingAnchorInsert.anchor);

    const currentSelection = lastSelectionRef.current ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    const insertAt = clampDocPosition(editor, currentSelection.to);

    editor
      .chain()
      .focus(insertAt)
      .insertContentAt(insertAt, [noteAnchorBlockFromAnchor(pendingAnchorInsert.anchor), paragraphNode()], {
        updateSelection: true,
      })
      .run();

    window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const endPosition = editor.state.selection.to;
      lastSelectionRef.current = { from: endPosition, to: endPosition };
      snapshotRef.current = snapshotFromEditor(editor);
      setRevision((value) => value + 1);
      onPendingAnchorInsertHandled?.(pendingAnchorInsert.requestId);
    });
  }, [editor, note, onPendingAnchorInsertHandled, pendingAnchorInsert]);

  const save = useCallback(async () => {
    if (!note || saving) return;

    const snapshot = editor ? snapshotFromEditor(editor) : snapshotRef.current;
    snapshotRef.current = snapshot;
    const contentText = snapshot.contentText || collectText(snapshot.contentJson);
    const nextTitle = title.trim() || titleFromNoteContent(contentText);
    const tags = normalizeTagInput(tagText);
    const contentAnchorIds = extractNoteAnchorIds(snapshot.contentJson);
    const pendingAnchors = Array.from(pendingAnchorsRef.current.values()).filter((anchor) =>
      contentAnchorIds.has(anchor.id),
    );
    const nextAnchors = mergeAnchors(note.anchors, pendingAnchors).filter((anchor) =>
      contentAnchorIds.has(anchor.id),
    );

    await onUpdate(
      note.id,
      {
        title: nextTitle,
        color,
        tags,
        content: contentText,
        contentJson: snapshot.contentJson,
        contentHtml: snapshot.contentHtml,
        contentText,
        wordCount: snapshot.wordCount,
        anchors: nextAnchors,
        pdfLocation: nextAnchors[0]?.pdfLocation ?? null,
        linkedNoteTitles: extractWikiTitles(contentText),
        linkedPaperIds: extractPaperRefs(contentText),
      },
      { sourceId: editorSourceIdRef.current },
    );

    for (const anchorId of Array.from(pendingAnchorsRef.current.keys())) {
      if (!contentAnchorIds.has(anchorId)) pendingAnchorsRef.current.delete(anchorId);
    }
    appliedUpdatedAtRef.current = Date.now();
    setExternalUpdateState(false, note.id);
    lastSavedSignatureRef.current = signature({ title: nextTitle, tagText, color, snapshot });
    clearNoteEditorDraft(editorSourceIdRef.current, note.id);
    setTitle(nextTitle);
    setRevision((value) => value + 1);
  }, [color, editor, note, onUpdate, saving, setExternalUpdateState, tagText, title]);

  const refreshFromExternalUpdate = useCallback(() => {
    const incomingNote =
      note && isNoteRecord(externalUpdateNote, note.id)
        ? externalUpdateNote
        : externalNoteRef.current ?? note;
    if (!incomingNote) return;

    const incomingSnapshot = snapshotFromNote(incomingNote);
    const nextTitle = incomingNote.title ?? '';
    const nextTagText = incomingNote.tags.join(', ');
    const nextColor = incomingNote.color ?? '#fef3c7';

    setTitle(nextTitle);
    setTagText(nextTagText);
    setColor(nextColor);
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(incomingSnapshot.contentJson, { emitUpdate: false });
    }
    snapshotRef.current = incomingSnapshot;
    loadedNoteIdRef.current = incomingNote.id;
    appliedUpdatedAtRef.current = incomingNote.updatedAt ?? null;
    lastSavedSignatureRef.current = signature({
      title: nextTitle,
      tagText: nextTagText,
      color: nextColor,
      snapshot: incomingSnapshot,
    });
    pendingAnchorsRef.current.clear();
    externalNoteRef.current = null;
    clearNoteEditorDraft(editorSourceIdRef.current, incomingNote.id);
    setExternalUpdateState(false, incomingNote.id);
    onExternalUpdateApply?.(incomingNote);
    setRevision((value) => value + 1);
  }, [editor, externalUpdateNote, note, onExternalUpdateApply, setExternalUpdateState]);

  const handleEditorKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      if (!dirty || saving) return;
      void save();
    }
  }, [dirty, save, saving]);

  const openEditorContextMenu = useCallback((clientX: number, clientY: number) => {
    if (!editor || editor.isDestroyed) return false;

    const context = getEditorContextAtPoint(editor, clientX, clientY);
    if (!context) return false;

    setEditorContextMenu({
      x: clientX,
      y: clientY,
      ...context,
    });
    return true;
  }, [editor]);

  const handleEditorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editorBody = event.currentTarget;
    if (!editorBody.contains(target)) return;
    if (target.closest('input, textarea, select')) {
      setEditorContextMenu(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openEditorContextMenu(event.clientX, event.clientY);
  }, [editor, openEditorContextMenu]);

  useEffect(() => {
    const editorBody = editorBodyRef.current;
    if (!editorBody || !editor || editor.isDestroyed) return undefined;

    const handleNativeContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!editorBody.contains(target)) return;
      if (target.closest('input, textarea, select')) {
        setEditorContextMenu(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openEditorContextMenu(event.clientX, event.clientY);
    };

    editorBody.addEventListener('contextmenu', handleNativeContextMenu, true);

    return () => {
      editorBody.removeEventListener('contextmenu', handleNativeContextMenu, true);
    };
  }, [editor, openEditorContextMenu]);

  if (!note) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center rounded-[var(--pq-radius-md)] border border-dashed border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-4 text-center text-sm leading-6 text-[var(--pq-text-muted)]">
        {TEXT.noNote}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)]',
        compact ? 'pq-note-editor-compact' : '',
      )}
      onKeyDown={handleEditorKeyDown}
    >
      <div className={cn('border-b border-[var(--pq-border)]', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
        <div className="flex min-w-0 items-start gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={TEXT.untitled}
            className={cn(
              'min-w-0 flex-1 bg-transparent font-semibold leading-tight text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]',
              compact ? 'text-base' : 'text-xl',
            )}
          />

          <div className="flex shrink-0 items-center gap-2 pt-1 text-xs text-[var(--pq-text-faint)]">
            {externalUpdateAvailable ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--pq-accent)]">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {TEXT.externalUpdate}
              </span>
            ) : null}
            <span>{saving ? TEXT.saving : dirty ? TEXT.dirty : TEXT.saved}</span>

            <div ref={tagEditorRef} className="relative">
              <button
                type="button"
                onClick={() => setTagEditorOpen((value) => !value)}
                className={cn(
                  'pq-icon-button relative h-8 w-8 border',
                  currentTags.length > 0
                    ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]'
                    : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:text-[var(--pq-text)]',
                )}
                aria-expanded={tagEditorOpen}
                aria-label={TEXT.tagsPlaceholder}
                title={currentTags.length > 0 ? currentTags.map((item) => `#${item}`).join(' ') : TEXT.tagsPlaceholder}
              >
                <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                {currentTags.length > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pq-accent)] px-1 text-[10px] font-semibold leading-none text-white">
                    {currentTags.length > 9 ? '9+' : currentTags.length}
                  </span>
                ) : null}
              </button>

              {tagEditorOpen ? (
                <div className="pq-card absolute right-0 top-full z-40 mt-1.5 w-[min(320px,calc(100vw-48px))] p-3 shadow-[var(--pq-shadow-dialog)]">
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
                      Tags
                    </span>
                    <input
                      value={tagText}
                      onChange={(event) => setTagText(event.target.value)}
                      placeholder="tag1, tag2"
                      autoFocus
                      className="pq-input h-8 w-full px-3 text-xs"
                    />
                  </label>

                  {currentTags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {currentTags.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setTagText(currentTags.filter((tag) => tag !== item).join(', '))}
                          className="rounded-full bg-[var(--pq-accent-bg)] px-2 py-1 text-[11px] font-medium text-[var(--pq-accent)] transition hover:bg-[var(--pq-active)]"
                          title="移除此标签"
                        >
                          #{item}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {tags.length > 0 ? (
                    <div className="mt-3 border-t border-[var(--pq-border-subtle)] pt-2">
                      <div className="mb-1.5 text-[11px] text-[var(--pq-text-faint)]">常用标签</div>
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                        {tags.slice(0, 12).map((item) => {
                          const active = currentTags.includes(item.tag);

                          return (
                            <button
                              key={item.tag}
                              type="button"
                              onClick={() => {
                                if (active) return;
                                setTagText([...currentTags, item.tag].join(', '));
                              }}
                              disabled={active}
                              className={cn(
                                'rounded-full border px-2 py-1 text-[11px] transition disabled:opacity-60',
                                active
                                  ? 'border-[var(--pq-accent-bg)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]'
                                  : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:text-[var(--pq-text)]',
                              )}
                            >
                              #{item.tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {externalUpdateAvailable ? (
        <div className="flex items-start gap-3 border-b border-[var(--pq-border)] bg-[var(--pq-accent-bg)] px-4 py-2.5 text-xs text-[var(--pq-text)]">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pq-accent)]" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[var(--pq-text)]">{TEXT.externalUpdate}</div>
            <div className="mt-0.5 leading-5 text-[var(--pq-text-muted)]">
              {dirty ? TEXT.externalUpdateDirtyDescription : TEXT.externalUpdateDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={refreshFromExternalUpdate}
            className="pq-button h-7 shrink-0 px-2.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            {TEXT.refresh}
          </button>
        </div>
      ) : null}

      <NoteEditorToolbar editor={editor} />

      <div
        ref={editorBodyRef}
        className="pq-note-editor-body min-h-0 flex-1 overflow-y-auto"
        onContextMenu={handleEditorContextMenu}
        onScroll={() => setEditorContextMenu(null)}
      >
        <EditorContent editor={editor} className={cn('pq-tiptap-editor', compact ? 'is-compact' : '')} />
        <NoteBlockControls editor={editor} compact={compact} />
      </div>

      {editorContextMenu ? (
        <NotesContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          title={getBlockLabelFromNode(editorContextMenu.block.node)}
          entries={editorContextMenuEntries}
          onClose={() => setEditorContextMenu(null)}
          width={244}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-[var(--pq-border)] px-3 py-2 text-xs text-[var(--pq-text-faint)]">
        <span>{snapshotRef.current.wordCount || 0} words</span>
        <div className="flex items-center gap-2">
          {externalUpdateAvailable ? (
            <button
              type="button"
              onClick={refreshFromExternalUpdate}
              className="pq-button h-8 px-3 text-sm"
              title={TEXT.refresh}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              {TEXT.refresh}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="pq-button-primary h-8 px-3 text-sm disabled:opacity-50"
            title="Ctrl / Cmd + S"
          >
            <Save className="h-4 w-4" strokeWidth={1.8} />
            {saving ? TEXT.saving : TEXT.save}
          </button>
        </div>
      </div>
    </div>
  );
}
