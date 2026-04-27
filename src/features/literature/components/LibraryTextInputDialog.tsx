import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface LibraryTextInputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export default function LibraryTextInputDialog({
  open,
  title,
  description,
  label,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  busy = false,
  onClose,
  onSubmit,
}: LibraryTextInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setValue(initialValue);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  const trimmedValue = value.trim();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px] dark:bg-black/45">
      <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#1e1e1e]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-[#e0e0e0]">
              {title}
            </h2>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60 dark:hover:bg-[#2b2b2b] dark:hover:text-[#e0e0e0]"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-[#8d8d8d]">
            {label}
          </span>
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose();
              }

              if (event.key === 'Enter' && trimmedValue) {
                onSubmit(trimmedValue);
              }
            }}
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-400/10 dark:border-white/10 dark:bg-[#242424] dark:text-[#e0e0e0] dark:placeholder:text-[#8d8d8d]"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
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
            onClick={() => onSubmit(trimmedValue)}
            disabled={busy || !trimmedValue}
            className="rounded-2xl bg-[#2f7f85] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(47,127,133,0.22)] transition hover:bg-[#286f75] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
