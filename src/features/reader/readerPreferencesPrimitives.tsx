import clsx from 'clsx';
import { useAppLocale } from '../../i18n/uiLanguage';
import {
  pickLocaleText,
  type BatchProgressState,
} from './readerShared';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all duration-200 hover:border-slate-300 hover:bg-white"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-indigo-500' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

function ProgressBar({
  value,
  total,
  tone = 'indigo',
}: {
  value: number;
  total: number;
  tone?: 'indigo' | 'emerald';
}) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className={clsx(
          'h-full rounded-full transition-all duration-300',
          tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500',
        )}
        style={{ width: `${ratio}%` }}
      />
    </div>
  );
}

export function BatchProgressCard({
  title,
  progress,
  tone = 'indigo',
}: {
  title: string;
  progress: BatchProgressState;
  tone?: 'indigo' | 'emerald';
}) {
  const locale = useAppLocale();

  if (!progress.running && progress.total === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-slate-500">
          {progress.completed}/{progress.total}
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={progress.completed} total={progress.total} tone={tone} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>{pickLocaleText(locale, `成功 ${progress.succeeded}`, `Succeeded ${progress.succeeded}`)}</span>
        <span>{pickLocaleText(locale, `跳过 ${progress.skipped}`, `Skipped ${progress.skipped}`)}</span>
        <span>{pickLocaleText(locale, `失败 ${progress.failed}`, `Failed ${progress.failed}`)}</span>
        {progress.paused ? (
          <span>{pickLocaleText(locale, '已暂停', 'Paused')}</span>
        ) : null}
        {progress.cancelRequested ? (
          <span>{pickLocaleText(locale, '取消中', 'Cancelling')}</span>
        ) : null}
      </div>
      {progress.currentLabel ? (
        <div className="mt-2 truncate text-xs text-slate-500">{progress.currentLabel}</div>
      ) : null}
    </div>
  );
}

export function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-chrome-800 dark:shadow-none">
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-chrome-100">{label}</div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-chrome-300">
            {description}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-100 dark:placeholder:text-chrome-400 dark:focus:border-accent-teal dark:focus:bg-chrome-700',
        props.className,
      )}
    />
  );
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:bg-white dark:border-white/10 dark:bg-chrome-700 dark:text-chrome-100 dark:focus:border-accent-teal dark:focus:bg-chrome-700',
        props.className,
      )}
    />
  );
}
