import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Camera,
  Database,
  ExternalLink,
  ImagePlus,
  Loader2,
  MessageSquare,
  MessageSquareText,
  Paperclip,
  PanelRightOpen,
  Plus,
  Quote,
  X,
} from 'lucide-react';
import { useWheelScrollDelegate } from '../../hooks/useWheelScrollDelegate';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  DocumentChatAttachment,
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatSession,
  QaModelPreset,
  SelectedExcerpt,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { formatFileSize } from '../../utils/files';
import { MarkdownPreview, SectionCard } from './assistantSidebarPrimitives';
import {
  formatQaContextBadge,
  formatQaContextHint,
  getQaContextBadgeTone,
} from './readerQaContext';

function formatChatSessionTime(timestamp: number, locale: 'zh-CN' | 'en-US') {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
}

function buildCitationHref(label: string): string {
  return `#cite-${label}`;
}

function injectCitationLinks(
  content: string,
  citations: DocumentChatCitation[] | undefined,
): string {
  if (!content.trim() || !citations || citations.length === 0) {
    return content;
  }

  const labels = new Set(citations.map((citation) => citation.label));
  const normalizedContent = content
    .replace(/\[(\d+(?:\s*[,，]\s*\d+)+)\]/g, (_match, group: string) =>
      group
        .split(/\s*[,，]\s*/)
        .map((label) => `[${label}]`)
        .join(' '),
    )
    .replace(/\](?=\[\d+\])/g, '] ');

  return normalizedContent.replace(/\[(\d+)\](?!\()/g, (match, label: string) => {
    if (!labels.has(label)) {
      return match;
    }

    return `[${label}](${buildCitationHref(label)})`;
  });
}

function normalizeCitationHref(href: string): string {
  const trimmed = href.trim();

  if (trimmed.startsWith('#cite-')) {
    return trimmed;
  }

  if (trimmed.startsWith('cite:')) {
    return `#cite-${trimmed.slice('cite:'.length)}`;
  }

  if (trimmed.startsWith('%23cite-')) {
    return decodeURIComponent(trimmed);
  }

  if (trimmed.startsWith('cite%3A')) {
    return `#cite-${decodeURIComponent(trimmed).slice('cite:'.length)}`;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function findCitationByHref(
  href: string,
  citations: DocumentChatCitation[] | undefined,
): DocumentChatCitation | null {
  if (!citations || citations.length === 0) {
    return null;
  }

  const normalizedHref = normalizeCitationHref(href);
  const labelMatch = normalizedHref.match(/^#cite-(\d+)$/);

  if (!labelMatch) {
    return null;
  }

  const label = labelMatch[1];

  return (
    citations.find((citation) => citation.label === label) ??
    citations.find((citation) => citation.id === `cite:${label}`) ??
    null
  );
}

function hasInlineCitationLinks(content: string): boolean {
  return /\[\d+\]\(#cite-\d+\)/.test(content);
}

const CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY = 'paperquay.chat-history-panel-width';
const MIN_CHAT_HISTORY_PANEL_WIDTH = 180;
const MAX_CHAT_HISTORY_PANEL_WIDTH = 320;
const MIN_CHAT_CONTENT_PANEL_WIDTH = 250;
const CHAT_COMPOSER_COMPACT_WIDTH = 540;
const CHAT_COMPOSER_WRAP_MODEL_WIDTH = 680;
const CHAT_COMPOSER_MAX_TEXTAREA_HEIGHT = 240;

function loadStoredPanelWidth(key: string, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const stored = window.localStorage.getItem(key);
  const parsed = stored ? Number(stored) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ChatWorkspacePanelProps {
  sessions: DocumentChatSession[];
  selectedSessionId: string;
  messages: DocumentChatMessage[];
  input: string;
  loading: boolean;
  error: string;
  hasBlocks: boolean;
  selectedExcerpt: SelectedExcerpt | null;
  attachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  qaRagEnabled: boolean;
  screenshotLoading: boolean;
  assistantDetached?: boolean;
  layoutMode?: 'compact' | 'workspace';
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onQaPresetChange: (presetId: string) => void;
  onQaRagEnabledChange: (value: boolean) => void;
  onSessionCreate: () => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onAppendSelectedExcerpt: () => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onDetachAssistant?: () => void;
  onAttachAssistant?: () => void;
  onCitationClick?: (citation: DocumentChatCitation) => void;
}

export function ChatWorkspacePanel({
  sessions,
  selectedSessionId,
  messages,
  input,
  loading,
  error,
  hasBlocks,
  selectedExcerpt,
  attachments,
  qaModelPresets,
  selectedQaPresetId,
  qaRagEnabled,
  screenshotLoading,
  assistantDetached = false,
  layoutMode = 'compact',
  onInputChange,
  onSubmit,
  onQaPresetChange,
  onQaRagEnabledChange,
  onSessionCreate,
  onSessionSelect,
  onSessionDelete,
  onAppendSelectedExcerpt,
  onSelectImageAttachments,
  onSelectFileAttachments,
  onCaptureScreenshot,
  onRemoveAttachment,
  onDetachAssistant,
  onAttachAssistant,
  onCitationClick,
}: ChatWorkspacePanelProps) {
  const l = useLocaleText();
  const locale = l('zh-CN', 'en-US') as 'zh-CN' | 'en-US';
  const panelRef = useRef<HTMLDivElement | null>(null);
  const historyRootRef = useRef<HTMLElement | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const compactActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const handleHistoryWheelCapture = useWheelScrollDelegate({ rootRef: historyRootRef });
  const handleChatWheelCapture = useWheelScrollDelegate({ rootRef: chatRootRef });
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historyPanelWidth, setHistoryPanelWidth] = useState(() =>
    loadStoredPanelWidth(CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY, 228),
  );
  const [resizingHistoryPanel, setResizingHistoryPanel] = useState(false);
  const [composerWidth, setComposerWidth] = useState(0);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const activePreset =
    qaModelPresets.find((preset) => preset.id === selectedQaPresetId) ?? qaModelPresets[0] ?? null;
  const streamingAssistantMessage = loading && messages[messages.length - 1]?.role === 'assistant';
  const workspaceMode = layoutMode === 'workspace';
  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    [sessions],
  );
  const activeSession =
    orderedSessions.find((session) => session.id === selectedSessionId) ?? orderedSessions[0] ?? null;
  const suggestionPrompts = [
    l('请用三点总结这篇论文的核心贡献。', 'Summarize the core contributions of this paper in three points.'),
    l('这篇论文的方法相比基线模型有哪些优势？', 'What advantages does this method have over the baseline models?'),
    l('请解释实验设置与最关键的结果。', 'Explain the experimental setup and the most important results.'),
  ];
  const canSubmit = input.trim().length > 0 && !loading;
  const composerActions = [
    {
      key: 'image',
      icon: ImagePlus,
      label: l('添加图片', 'Add images'),
      onClick: onSelectImageAttachments,
      disabled: false,
    },
    {
      key: 'file',
      icon: Paperclip,
      label: l('添加文件', 'Add files'),
      onClick: onSelectFileAttachments,
      disabled: false,
    },
    {
      key: 'screenshot',
      icon: Camera,
      label: screenshotLoading ? l('截图中...', 'Capturing...') : l('截图', 'Screenshot'),
      onClick: onCaptureScreenshot,
      disabled: screenshotLoading,
    },
    {
      key: 'quote',
      icon: Quote,
      label: l('引用选中内容', 'Quote selection'),
      onClick: onAppendSelectedExcerpt,
      disabled: !selectedExcerpt,
    },
  ] as const;
  const compactComposer = composerWidth > 0 && composerWidth <= CHAT_COMPOSER_COMPACT_WIDTH;
  const wrapModelSelector = composerWidth > 0 && composerWidth <= CHAT_COMPOSER_WRAP_MODEL_WIDTH;
  const primaryComposerActions = compactComposer
    ? composerActions.filter((action) => action.key === 'image' || action.key === 'file')
    : composerActions;
  const secondaryComposerActions = compactComposer
    ? composerActions.filter((action) => action.key !== 'image' && action.key !== 'file')
    : [];

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, messages]);

  useEffect(() => {
    const composerElement = composerRef.current;

    if (!composerElement) {
      return undefined;
    }

    setComposerWidth(Math.round(composerElement.getBoundingClientRect().width));

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0);
      setComposerWidth(nextWidth);
    });

    observer.observe(composerElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!compactComposer) {
      setCompactActionsOpen(false);
    }
  }, [compactComposer]);

  useEffect(() => {
    if (!compactActionsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && compactActionsMenuRef.current?.contains(target)) {
        return;
      }

      setCompactActionsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [compactActionsOpen]);

  useEffect(() => {
    const textareaElement = textareaRef.current;

    if (!textareaElement) {
      return;
    }

    textareaElement.style.height = '0px';
    textareaElement.style.height = `${Math.min(
      textareaElement.scrollHeight,
      CHAT_COMPOSER_MAX_TEXTAREA_HEIGHT,
    )}px`;
  }, [composerWidth, input]);

  useEffect(() => {
    window.localStorage.setItem(
      CHAT_HISTORY_PANEL_WIDTH_STORAGE_KEY,
      String(Math.round(historyPanelWidth)),
    );
  }, [historyPanelWidth]);

  useEffect(() => {
    if (!resizingHistoryPanel) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const panelRect = panelRef.current?.getBoundingClientRect();

      if (!panelRect) {
        return;
      }

      const boundedMaxWidth = Math.min(
        MAX_CHAT_HISTORY_PANEL_WIDTH,
        Math.max(MIN_CHAT_HISTORY_PANEL_WIDTH, panelRect.width - MIN_CHAT_CONTENT_PANEL_WIDTH),
      );
      const nextWidth = Math.round(
        Math.min(
          boundedMaxWidth,
          Math.max(MIN_CHAT_HISTORY_PANEL_WIDTH, event.clientX - panelRect.left),
        ),
      );

      setHistoryPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setResizingHistoryPanel(false);
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
  }, [resizingHistoryPanel]);

  return (
    <div
      ref={panelRef}
      className={cn(
        'paperquay-assistant flex h-full min-h-0 overflow-hidden bg-transparent',
        workspaceMode && 'min-h-[520px]',
      )}
    >
      {!historyCollapsed ? (
        <aside
          ref={historyRootRef}
          onWheelCapture={handleHistoryWheelCapture}
          className="flex min-h-0 shrink-0 flex-col border-r border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,247,251,0.92))]"
          style={{ width: historyPanelWidth }}
        >
          <div className="border-b border-slate-200/70 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {l('历史记录', 'History')}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {l(`${orderedSessions.length} 个会话`, `${orderedSessions.length} chats`)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryCollapsed(true)}
                className="inline-flex h-8 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              >
                {l('隐藏', 'Hide')}
              </button>
            </div>
          </div>

          <div
            data-wheel-scroll-target
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2"
          >
            {orderedSessions.length > 0 ? (
              <div className="space-y-2">
                {orderedSessions.map((session) => {
                  const active = session.id === selectedSessionId;

                  return (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex items-start gap-2 rounded-2xl border p-2 transition',
                        active
                          ? 'border-indigo-200 bg-indigo-50/80 shadow-[0_12px_28px_rgba(79,70,229,0.10)]'
                          : 'border-transparent bg-white/80 hover:border-slate-200 hover:bg-white',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSessionSelect(session.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div
                          className={cn(
                            'truncate text-sm font-medium',
                            active ? 'text-indigo-700' : 'text-slate-700',
                          )}
                        >
                          {session.title || l('未命名会话', 'Untitled Chat')}
                        </div>
                        <div
                          className={cn(
                            'mt-1 text-[11px]',
                            active ? 'text-indigo-500' : 'text-slate-400',
                          )}
                        >
                          {formatChatSessionTime(session.updatedAt, locale)}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSessionDelete(session.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label={l('删除会话', 'Delete chat')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm leading-6 text-slate-500">
                {l(
                  '还没有历史会话，先创建一个新的问答会话。',
                  'No chat history yet. Create a new chat to get started.',
                )}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {!historyCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={l('调整历史侧栏宽度', 'Resize history sidebar')}
          onDoubleClick={() => setHistoryPanelWidth(228)}
          onPointerDown={(event) => {
            event.preventDefault();
            setResizingHistoryPanel(true);
          }}
          className="group relative z-10 w-2 shrink-0 cursor-col-resize bg-transparent transition-all duration-200"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/80 transition-all duration-200 group-hover:w-[3px] group-hover:bg-slate-400" />
          <div className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-all duration-200 group-hover:w-1.5 group-hover:bg-slate-500" />
        </div>
      ) : null}

      <div
        ref={chatRootRef}
        onWheelCapture={handleChatWheelCapture}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="border-b border-slate-200/70 bg-white/84 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {l('会话', 'Chat')}
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                {activeSession?.title || l('文档问答', 'Document Chat')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onQaRagEnabledChange(!qaRagEnabled)}
                title={
                  qaRagEnabled
                    ? l('关闭本次问答 RAG', 'Turn off RAG for this chat')
                    : l('开启本次问答 RAG', 'Turn on RAG for this chat')
                }
                aria-label={
                  qaRagEnabled
                    ? l('关闭本次问答 RAG', 'Turn off RAG for this chat')
                    : l('开启本次问答 RAG', 'Turn on RAG for this chat')
                }
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
                  qaRagEnabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900',
                )}
              >
                <Database className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              {assistantDetached && onAttachAssistant ? (
                <button
                  type="button"
                  onClick={onAttachAssistant}
                  title={l('停靠回侧边栏', 'Dock back to sidebar')}
                  aria-label={l('停靠回侧边栏', 'Dock back to sidebar')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              ) : null}
              {!assistantDetached && onDetachAssistant ? (
                <button
                  type="button"
                  onClick={onDetachAssistant}
                  title={l('弹出为窗口', 'Open as floating window')}
                  aria-label={l('弹出为窗口', 'Open as floating window')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              ) : null}
              {historyCollapsed ? (
                <button
                  type="button"
                  onClick={() => setHistoryCollapsed(false)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {l('历史记录', 'History')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSessionCreate}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                {l('新建会话', 'New Chat')}
              </button>
            </div>
          </div>
        </div>

        <div
          data-wheel-scroll-target
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[radial-gradient(circle_at_top,#ffffff,#f8fafc_35%,#f3f6fb_100%)] px-4 py-5 dark:bg-chrome-950"
        >
          {messages.length === 0 ? (
            <div className="flex min-h-full items-center justify-center">
              <div className="w-full space-y-4 rounded-[28px] border border-white/80 bg-white/86 p-5 shadow-[0_20px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-chrome-800 dark:shadow-none">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.14)]">
                    <MessageSquareText className="h-4.5 w-4.5" strokeWidth={1.8} />
                  </span>
                  <div className="space-y-1.5">
                    <div className="text-base font-semibold text-slate-900">
                      {l('开始文档问答', 'Start document chat')}
                    </div>
                    <div className="text-sm leading-6 text-slate-500">
                      {l(
                        '可以直接提问，也可以先附加选中文本、图片、文件或截图再继续追问。',
                        'Ask directly, or attach selected text, images, files, or screenshots first.',
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  {suggestionPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onInputChange(prompt)}
                      className="block w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left text-sm text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-300 dark:hover:bg-chrome-600 dark:hover:text-chrome-100"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const assistantMessage = message.role === 'assistant';
                const qaContextBadge = assistantMessage ? formatQaContextBadge(message.qaContext, l) : null;
                const qaContextHint = assistantMessage ? formatQaContextHint(message.qaContext, l) : null;
                const qaContextBadgeTone = assistantMessage
                  ? getQaContextBadgeTone(message.qaContext)
                  : 'neutral';
                const renderedMessageContent = assistantMessage
                  ? injectCitationLinks(message.content.trim(), message.citations)
                  : message.content.trim();

                return (
                  <div
                    key={message.id}
                    className={cn('flex gap-3', assistantMessage ? 'items-start' : 'justify-end')}
                  >
                    {assistantMessage ? (
                      <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]">
                        <Bot className="h-4 w-4" strokeWidth={1.9} />
                      </span>
                    ) : null}

                    <div
                      className={cn(
                        'max-w-[92%] rounded-[24px] px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.05)]',
                        assistantMessage
                          ? 'border border-white/80 bg-white text-slate-900'
                          : 'bg-slate-900 text-slate-50',
                      )}
                    >
                      <div
                        className={cn(
                          'mb-2 flex items-center gap-2 text-[11px]',
                          assistantMessage ? 'text-slate-400' : 'text-slate-300',
                        )}
                      >
                        <span className="font-semibold">
                          {assistantMessage ? l('助手', 'Assistant') : l('你', 'You')}
                        </span>
                        {assistantMessage && message.modelLabel ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {message.modelLabel}
                          </span>
                        ) : null}
                        {assistantMessage && qaContextBadge ? (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px]',
                              qaContextBadgeTone === 'success' &&
                                'border border-emerald-200 bg-emerald-50 text-emerald-700',
                              qaContextBadgeTone === 'warning' &&
                                'border border-amber-200 bg-amber-50 text-amber-700',
                              qaContextBadgeTone === 'neutral' &&
                                'border border-slate-200 bg-slate-50 text-slate-500',
                            )}
                          >
                            {qaContextBadge}
                          </span>
                        ) : null}
                        <span>{formatChatSessionTime(message.createdAt, locale)}</span>
                      </div>

                      <MarkdownPreview
                        content={
                          renderedMessageContent ||
                          (assistantMessage && loading ? l('正在思考...', 'Thinking...') : '')
                        }
                        components={{
                          a: ({ href, children, ...props }) => {
                            const citation =
                              href && onCitationClick
                                ? findCitationByHref(href, message.citations)
                                : null;

                            if (citation && onCitationClick) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => onCitationClick(citation)}
                                  className="font-medium text-indigo-600 underline underline-offset-2 transition hover:text-indigo-800"
                                >
                                  [{children}]
                                </button>
                              );
                            }

                            if (href && message.citations && findCitationByHref(href, message.citations)) {
                              return <span className="text-slate-400">[{children}]</span>;
                            }

                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                {...props}
                              >
                                {children}
                              </a>
                            );
                          },
                        }}
                        className={cn(
                          'text-sm leading-7',
                          assistantMessage && !message.content.trim() && loading && 'text-slate-400',
                          !assistantMessage &&
                            '!text-slate-50 prose-p:text-slate-50 prose-strong:text-white prose-li:text-slate-100 prose-headings:text-white prose-code:bg-white/10 prose-code:text-white [&_.katex]:text-white',
                        )}
                      />

                      {assistantMessage && qaContextHint ? (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                          {qaContextHint}
                        </div>
                      ) : null}

                      {assistantMessage &&
                      message.citations &&
                      message.citations.length > 0 &&
                      !hasInlineCitationLinks(renderedMessageContent) ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.citations.map((citation) => (
                            <button
                              key={citation.id}
                              type="button"
                              onClick={() => onCitationClick?.(citation)}
                              className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
                              title={
                                citation.previewText
                                  ? `${
                                      citation.pageIndex !== null && citation.pageIndex !== undefined
                                        ? l(`第 ${citation.pageIndex + 1} 页`, `Page ${citation.pageIndex + 1}`)
                                        : citation.sourceType
                                    }\n${citation.previewText}`
                                  : undefined
                              }
                            >
                              <span>[{citation.label}]</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {message.attachments && message.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.attachments.map((attachment) => {
                            const AttachmentIcon =
                              attachment.kind === 'image'
                                ? ImagePlus
                                : attachment.kind === 'screenshot'
                                  ? Camera
                                  : Paperclip;

                            return (
                              <span
                                key={attachment.id}
                                className={cn(
                                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                                  assistantMessage
                                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                                    : 'border-white/10 bg-white/10 text-slate-100',
                                )}
                              >
                                <AttachmentIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                                <span className="max-w-[180px] truncate">{attachment.name}</span>
                                <span className={assistantMessage ? 'text-slate-400' : 'text-slate-300'}>
                                  {formatFileSize(attachment.size)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {loading && !streamingAssistantMessage ? (
                <div className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]">
                    <Bot className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <div className="max-w-[92%] rounded-[24px] border border-white/80 bg-white px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" strokeWidth={1.9} />
                      {l('模型回复中...', 'Model is replying...')}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {activePreset
                        ? l(`当前模型：${activePreset.label}`, `Current model: ${activePreset.label}`)
                        : l(
                            '正在基于当前文档内容生成回复。',
                            'Generating a response grounded in the current document.',
                          )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={messageEndRef} />
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/70 bg-white/88 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-900">
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => {
                const AttachmentIcon =
                  attachment.kind === 'image'
                    ? ImagePlus
                    : attachment.kind === 'screenshot'
                      ? Camera
                      : Paperclip;

                return (
                  <div
                    key={attachment.id}
                    className="group inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
                  >
                    {attachment.dataUrl &&
                    (attachment.kind === 'image' || attachment.kind === 'screenshot') ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-10 w-10 rounded-xl border border-slate-200 object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <AttachmentIcon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[180px] truncate font-medium text-slate-700">
                        {attachment.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {formatFileSize(attachment.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label={l('移除附件', 'Remove attachment')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            ref={composerRef}
            className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_20px_44px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-chrome-800 dark:shadow-none"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (canSubmit) {
                    onSubmit();
                  }
                }
              }}
              placeholder={
                hasBlocks
                  ? l(
                      '输入你的问题，Enter 发送，Shift+Enter 换行。',
                      'Ask a question. Press Enter to send and Shift+Enter for a new line.',
                    )
                  : l(
                      '建议先加载论文结构块后再提问，回答会更准确。',
                      'Load document blocks before asking questions for more accurate answers.',
                    )
              }
              className="min-h-[96px] w-full resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-1 py-1 text-sm leading-7 text-slate-700 outline-none dark:text-chrome-100 dark:placeholder:text-chrome-400"
            />

            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {primaryComposerActions.map((action) => {
                  const Icon = action.icon;

                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={action.onClick}
                      disabled={action.disabled}
                      title={action.label}
                      aria-label={action.label}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {action.key === 'screenshot' && screenshotLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                      ) : (
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      )}
                    </button>
                  );
                })}

                {secondaryComposerActions.length > 0 ? (
                  <div ref={compactActionsMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setCompactActionsOpen((open) => !open)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                      aria-label={l('更多操作', 'More actions')}
                      aria-expanded={compactActionsOpen}
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.8} />
                    </button>

                    {compactActionsOpen ? (
                      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                        {secondaryComposerActions.map((action) => {
                          const Icon = action.icon;

                          return (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() => {
                                setCompactActionsOpen(false);
                                action.onClick();
                              }}
                              disabled={action.disabled}
                              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {action.key === 'screenshot' && screenshotLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                              ) : (
                                <Icon className="h-4 w-4" strokeWidth={1.8} />
                              )}
                              <span>{action.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <label
                  className={cn(
                    'flex h-10 w-[184px] shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600',
                    wrapModelSelector && 'basis-full',
                  )}
                >
                  <Bot className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.8} />
                  <select
                    value={selectedQaPresetId}
                    onChange={(event) => onQaPresetChange(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
                    title={l('选择问答模型', 'Choose QA model')}
                  >
                    {qaModelPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={1.9} />
                )}
                <span className="hidden sm:inline">
                  {loading ? l('回复中', 'Replying') : l('发送', 'Send')}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
            <span>
              {hasBlocks
                ? l(
                    qaRagEnabled
                      ? '当前回复会先尝试本地 RAG，再回退到文档内容。'
                      : '当前回复会直接参考文档内容。',
                    qaRagEnabled
                      ? 'Responses try local RAG first, then fall back to document content.'
                      : 'Responses use the document content directly.',
                  )
                : l(
                    '建议先加载结构块再提问，回答会更准确。',
                    'Load structured blocks first for better answers.',
                  )}
            </span>
            <span>
              {loading
                ? l('模型回复中...', 'Model is replying...')
                : l('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel(props: ChatWorkspacePanelProps) {
  const l = useLocaleText();

  return (
    <SectionCard
      title={l('文档问答', 'Document Chat')}
      description={l(
        '基于当前论文内容进行多轮问答。',
        'Run multi-turn QA grounded in the current paper.',
      )}
      icon={<MessageSquare className="h-4 w-4" strokeWidth={1.8} />}
      contentClassName="p-0"
    >
      <ChatWorkspacePanel {...props} />
    </SectionCard>
  );
}
