import { FileSearch } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
}

function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-8">
      <div className="max-w-md rounded-[28px] border border-white/70 bg-white/82 px-8 py-10 text-center shadow-[0_22px_52px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-chrome-800 dark:shadow-[0_22px_52px_rgba(0,0,0,0.24)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-accent-blue dark:text-chrome-50">
          <FileSearch className="h-5 w-5" strokeWidth={1.9} />
        </div>
        <h3 className="text-lg font-semibold text-slate-950 dark:text-chrome-100">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-chrome-300">{description}</p>
      </div>
    </div>
  );
}

export default EmptyState;
