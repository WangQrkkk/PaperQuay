import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';

export interface NotesContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
  onSelect: () => void | Promise<void>;
}

export type NotesContextMenuEntry = NotesContextMenuItem | { type: 'separator'; id: string };

interface NotesContextMenuProps {
  x: number;
  y: number;
  title?: string;
  entries: NotesContextMenuEntry[];
  onClose: () => void;
  width?: number;
}

function isSeparator(entry: NotesContextMenuEntry): entry is { type: 'separator'; id: string } {
  return 'type' in entry && entry.type === 'separator';
}

function estimateMenuHeight(entries: NotesContextMenuEntry[], hasTitle: boolean) {
  const itemCount = entries.filter((entry) => !isSeparator(entry)).length;
  const separatorCount = entries.length - itemCount;
  return (hasTitle ? 42 : 8) + itemCount * 34 + separatorCount * 9 + 10;
}

function clampPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === 'undefined') return { left: x, top: y };

  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function isEditableContextTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest('input, textarea, [contenteditable="true"], .ProseMirror'));
}

export function hasActiveTextSelection(target: EventTarget | null) {
  if (typeof window === 'undefined' || !(target instanceof Node)) return false;

  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;

  const targetElement =
    target instanceof HTMLElement ? target : target.parentElement;

  if (!targetElement) return true;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const commonNode = range.commonAncestorContainer;
    const commonElement =
      commonNode instanceof HTMLElement ? commonNode : commonNode.parentElement;

    if (commonElement && (targetElement.contains(commonElement) || commonElement.contains(targetElement))) {
      return true;
    }

    try {
      if (range.intersectsNode(targetElement)) return true;
    } catch {
      return true;
    }
  }

  return false;
}

export function shouldUseNativeTextContextMenu(target: EventTarget | null) {
  return isEditableContextTarget(target) || hasActiveTextSelection(target);
}

export async function copyTextToClipboard(value: string) {
  const text = value.trim();
  if (!text) return;

  if (window.paperquay?.clipboard?.writeText) {
    window.paperquay.clipboard.writeText(text);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function NotesContextMenu({
  x,
  y,
  title,
  entries,
  onClose,
  width = 224,
}: NotesContextMenuProps) {
  const position = clampPosition(x, y, width, estimateMenuHeight(entries, Boolean(title)));

  const menu = (
    <div
      className="fixed inset-0 z-[10000]"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="pq-card fixed overflow-hidden p-1 shadow-[var(--pq-shadow-dialog)]"
        style={{ left: position.left, top: position.top, width }}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? (
          <div className="border-b border-[var(--pq-border-subtle)] px-2.5 py-2 text-xs font-medium text-[var(--pq-text-muted)]">
            <div className="truncate">{title}</div>
          </div>
        ) : null}

        <div className="max-h-[min(420px,calc(100vh-32px))] overflow-y-auto py-1">
          {entries.map((entry) => {
            if (isSeparator(entry)) {
              return <div key={entry.id} className="my-1 border-t border-[var(--pq-border-subtle)]" />;
            }

            return (
              <button
                key={entry.id}
                type="button"
                disabled={entry.disabled}
                onClick={() => {
                  if (entry.disabled) return;
                  onClose();
                  void entry.onSelect();
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-[var(--pq-radius-sm)] px-2.5 text-left text-xs font-medium transition disabled:opacity-45',
                  entry.tone === 'danger'
                    ? 'text-[var(--pq-error)] hover:bg-[var(--pq-error-bg)]'
                    : entry.tone === 'accent'
                      ? 'text-[var(--pq-accent)] hover:bg-[var(--pq-accent-bg)]'
                      : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                )}
              >
                {entry.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{entry.icon}</span> : null}
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
}
