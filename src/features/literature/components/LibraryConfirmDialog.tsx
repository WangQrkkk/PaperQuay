import { AlertTriangle, X } from 'lucide-react';

interface LibraryConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function LibraryConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  danger = false,
  onClose,
  onConfirm,
}: LibraryConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px] dark:bg-black/45">
      <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#1e1e1e]">
        <div className="flex items-start gap-4">
          <div
            className={
              danger
                ? 'mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-400/10 dark:text-rose-200'
                : 'mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-300/10 dark:text-amber-200'
            }
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-[#e0e0e0]">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60 dark:hover:bg-[#2b2b2b] dark:hover:text-[#e0e0e0]"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:hover:bg-[#2b2b2b]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? 'rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60'
                : 'rounded-2xl bg-[#2f7f85] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#286f75] disabled:opacity-60'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
