import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Note, NoteAnchor } from '../../types/notes';
import { collectText, noteContentToTiptap } from './notesTiptap.ts';

export interface NoteTemplate {
  id: string;
  label: string;
  description: string;
  content: JSONContent[];
}

export interface NoteSlashCommandItem {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
}

export interface EditorSnapshot {
  contentJson: JSONContent;
  contentHtml: string;
  contentText: string;
  wordCount: number;
}

export interface NoteEditorDraft {
  noteId: string;
  baseUpdatedAt: number | null;
  savedSignature: string;
  draftSignature: string;
  title: string;
  tagText: string;
  color: string;
  snapshot: EditorSnapshot;
  pendingAnchors: NoteAnchor[];
  updatedAt: number;
}

const noteEditorDrafts = new Map<string, NoteEditorDraft>();

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    contentJson: cloneJsonValue(snapshot.contentJson),
    contentHtml: snapshot.contentHtml,
    contentText: snapshot.contentText,
    wordCount: snapshot.wordCount,
  };
}

function cloneNoteEditorDraft(draft: NoteEditorDraft): NoteEditorDraft {
  return {
    ...draft,
    snapshot: cloneEditorSnapshot(draft.snapshot),
    pendingAnchors: cloneJsonValue(draft.pendingAnchors),
  };
}

export function buildNoteEditorDraftKey(editorSourceId: string, noteId: string): string {
  return `${editorSourceId}::${noteId}`;
}

export function readNoteEditorDraft(
  editorSourceId: string,
  noteId: string,
  baseUpdatedAt: number | null,
): NoteEditorDraft | null {
  const key = buildNoteEditorDraftKey(editorSourceId, noteId);
  const draft = noteEditorDrafts.get(key);

  if (!draft) return null;

  if (draft.baseUpdatedAt !== baseUpdatedAt) {
    noteEditorDrafts.delete(key);
    return null;
  }

  return cloneNoteEditorDraft(draft);
}

export function writeNoteEditorDraft(
  editorSourceId: string,
  draft: NoteEditorDraft,
): void {
  noteEditorDrafts.set(buildNoteEditorDraftKey(editorSourceId, draft.noteId), cloneNoteEditorDraft(draft));
}

export function clearNoteEditorDraft(
  editorSourceId: string,
  noteId: string,
): void {
  noteEditorDrafts.delete(buildNoteEditorDraftKey(editorSourceId, noteId));
}

export function paragraphNode(text = ''): JSONContent {
  return text
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' };
}

export function headingNode(level: 1 | 2 | 3, text: string): JSONContent {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

export function bulletListNode(items: string[]): JSONContent {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraphNode(item)],
    })),
  };
}

export function taskListNode(items: string[]): JSONContent {
  return {
    type: 'taskList',
    content: items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: false },
      content: [paragraphNode(item)],
    })),
  };
}

export function componentBlockNode(title = 'Component'): JSONContent {
  return {
    type: 'noteComponentBlock',
    attrs: { title, variant: 'note' },
    content: [paragraphNode()],
  };
}

export function normalizeAnchorPageLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const pageMatch = normalized.match(/\bP\s*(\d+)\b/i);

  if (pageMatch) return `P${pageMatch[1]}`;
  return normalized || '定位';
}

export function normalizeAnchorSourceTitle(sourceTitle: string, sourceLabel: string): string {
  const explicitTitle = sourceTitle.replace(/\s+/g, ' ').trim();
  if (
    explicitTitle &&
    !/^PDF\b/i.test(explicitTitle) &&
    !/^P\s*\d+\b/i.test(explicitTitle) &&
    !/^(摘录|正文摘录|引用摘录)$/u.test(explicitTitle)
  ) {
    return explicitTitle;
  }

  const legacyLabel = sourceLabel.replace(/\s+/g, ' ').trim();
  if (!legacyLabel) return '文献';
  if (/^PDF\b/i.test(legacyLabel)) return '文献';
  if (/^P\s*\d+\b/i.test(legacyLabel)) return '文献';
  if (/^(摘录|正文摘录|引用摘录)$/u.test(legacyLabel)) return '文献';

  return legacyLabel;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'literature-review',
    label: '文献阅读',
    description: '问题、方法、实验、结论',
    content: [
      headingNode(2, '研究问题'),
      paragraphNode(),
      headingNode(2, '核心方法'),
      bulletListNode(['方法假设', '关键模块', '与已有工作的差异']),
      headingNode(2, '实验与结果'),
      paragraphNode(),
      headingNode(2, '我的判断'),
      taskListNode(['需要复查的公式或实验', '可以复用的思路']),
    ],
  },
  {
    id: 'method-analysis',
    label: '方法拆解',
    description: '输入、流程、输出、限制',
    content: [
      headingNode(2, '方法目标'),
      paragraphNode(),
      headingNode(2, '流程拆解'),
      bulletListNode(['输入', '中间表示', '优化目标', '输出']),
      headingNode(2, '适用边界'),
      paragraphNode(),
      headingNode(2, '可迁移点'),
      paragraphNode(),
    ],
  },
  {
    id: 'experiment-note',
    label: '实验记录',
    description: '设置、变量、观察、下一步',
    content: [
      headingNode(2, '实验设置'),
      bulletListNode(['数据集', '基线', '评价指标', '关键参数']),
      headingNode(2, '观察结果'),
      paragraphNode(),
      headingNode(2, '异常与解释'),
      paragraphNode(),
      headingNode(2, '下一步'),
      taskListNode(['补充对照实验', '检查失败样例', '整理图表']),
    ],
  },
  {
    id: 'qa-summary',
    label: '问答整理',
    description: '问题、回答、证据、结论',
    content: [
      headingNode(2, '问题'),
      paragraphNode(),
      headingNode(2, '回答摘要'),
      paragraphNode(),
      headingNode(2, '证据位置'),
      bulletListNode(['PDF 页码或摘录', '相关图表', '相关公式']),
      headingNode(2, '后续追问'),
      taskListNode(['确认原文表述', '补充相关论文']),
    ],
  },
];

export const BASE_SLASH_COMMANDS: NoteSlashCommandItem[] = [
  { id: 'paragraph', label: 'Paragraph', description: 'Plain text block', aliases: ['text', 'p'] },
  { id: 'heading-1', label: 'Heading 1', description: 'Large section title', aliases: ['h1', 'title'] },
  { id: 'heading-2', label: 'Heading 2', description: 'Medium section title', aliases: ['h2', 'subtitle'] },
  { id: 'heading-3', label: 'Heading 3', description: 'Small section title', aliases: ['h3'] },
  { id: 'bullet-list', label: 'Bullet list', description: 'Unordered list', aliases: ['ul', 'list'] },
  { id: 'ordered-list', label: 'Ordered list', description: 'Numbered list', aliases: ['ol', 'number'] },
  { id: 'task-list', label: 'Task list', description: 'Checklist with tasks', aliases: ['todo', 'check'] },
  { id: 'quote', label: 'Quote', description: 'Quoted or extracted text', aliases: ['blockquote', 'cite'] },
  { id: 'code-block', label: 'Code block', description: 'Preformatted code block', aliases: ['code', 'pre'] },
  { id: 'table', label: 'Table', description: 'Insert a 3 x 3 table', aliases: ['grid'] },
  { id: 'component', label: 'Component block', description: 'Structured editable card block', aliases: ['card', 'block'] },
  { id: 'math', label: 'Math', description: 'Inline LaTeX expression', aliases: ['formula', 'latex'] },
  ...NOTE_TEMPLATES.map((template): NoteSlashCommandItem => ({
    id: `template:${template.id}`,
    label: template.label,
    description: `Template - ${template.description}`,
    aliases: ['template', template.id],
  })),
];

export function normalizeSuggestionQuery(query: string, triggers: string[]): string {
  let value = query.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const sortedTriggers = [...triggers].sort((a, b) => b.length - a.length);

  let changed = true;
  while (changed) {
    changed = false;
    for (const trigger of sortedTriggers) {
      if (value.startsWith(trigger)) {
        value = value.slice(trigger.length).trimStart();
        changed = true;
      }
    }
  }

  return value.toLocaleLowerCase();
}

export function slashCommandItems(query: string): NoteSlashCommandItem[] {
  const normalized = normalizeSuggestionQuery(query, ['/']);
  if (!normalized) return BASE_SLASH_COMMANDS;

  return BASE_SLASH_COMMANDS.filter((item) => {
    const haystack = [
      item.id,
      item.label,
      item.description ?? '',
      ...(item.aliases ?? []),
    ].join(' ').toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

export function signature(value: {
  title: string;
  tagText: string;
  color: string;
  snapshot: EditorSnapshot;
}): string {
  return JSON.stringify({
    title: value.title.trim(),
    tagText: value.tagText.trim(),
    color: value.color,
    contentJson: value.snapshot.contentJson,
    contentText: value.snapshot.contentText,
  });
}

export function snapshotFromEditor(editor: Editor): EditorSnapshot {
  const json = editor.getJSON();
  const text = collectText(json) || editor.getText({ blockSeparator: '\n\n' });

  return {
    contentJson: json,
    contentHtml: editor.getHTML(),
    contentText: text,
    wordCount: editor.storage.characterCount?.words?.() ?? 0,
  };
}

export function snapshotFromNote(note: Note | null): EditorSnapshot {
  return {
    contentJson: noteContentToTiptap(note),
    contentHtml: note?.contentHtml ?? '',
    contentText: note?.contentText ?? note?.content ?? '',
    wordCount: note?.wordCount ?? 0,
  };
}

export function isNoteRecord(value: unknown, noteId?: string | null): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  if (typeof note.id !== 'string') return false;
  if (noteId && note.id !== noteId) return false;
  return typeof note.updatedAt === 'number';
}

export function mergeAnchors(baseAnchors: NoteAnchor[], extraAnchors: Iterable<NoteAnchor>): NoteAnchor[] {
  const byId = new Map<string, NoteAnchor>();

  for (const anchor of baseAnchors) byId.set(anchor.id, anchor);
  for (const anchor of extraAnchors) byId.set(anchor.id, anchor);

  return Array.from(byId.values());
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

export function getImageFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const file of Array.from(data.files ?? [])) addFile(file);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') addFile(item.getAsFile());
  }

  return files;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image'));
      }
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read image')));
    reader.readAsDataURL(file);
  });
}

export function insertImageFilesIntoView(
  view: EditorView,
  files: File[],
  position?: number | null,
): boolean {
  const imageFiles = files.filter(isImageFile);
  const imageType = view.state.schema.nodes.image;
  if (!imageType || imageFiles.length === 0) return false;

  void (async () => {
    view.focus();
    let insertPos = typeof position === 'number' ? position : null;

    for (const file of imageFiles) {
      const src = await readFileAsDataUrl(file);
      const imageNode = imageType.create({
        src,
        alt: file.name || 'pasted image',
        title: file.name || 'pasted image',
      });
      const state = view.state;
      const tr = typeof insertPos === 'number'
        ? state.tr.insert(Math.max(0, Math.min(insertPos, state.doc.content.size)), imageNode)
        : state.tr.replaceSelectionWith(imageNode);

      view.dispatch(tr.scrollIntoView());
      if (typeof insertPos === 'number') {
        insertPos = Math.min(insertPos + imageNode.nodeSize, view.state.doc.content.size);
      }
    }
  })().catch((error) => {
    console.error('Failed to insert image into note editor.', error);
  });

  return true;
}
