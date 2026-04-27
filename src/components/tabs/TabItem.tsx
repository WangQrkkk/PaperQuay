import { FileText, Library, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type { AppTab } from '../../stores/useTabsStore';
import { cn } from '../../utils/cn';

interface TabItemProps {
  tab: AppTab;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

function TabItem({ tab, active, onSelect, onClose }: TabItemProps) {
  const l = useLocaleText();
  const Icon = tab.type === 'library' ? Library : FileText;
  const closable = tab.type !== 'library';
  const isHomeTab = tab.type === 'library';

  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose(tab.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(tab.id);
        }
      }}
      className={cn(
        'group relative flex h-full min-w-0 items-center gap-2.5 border-b px-3 text-sm transition-all duration-200 ease-in-out',
        isHomeTab ? 'w-[176px] flex-none' : 'min-w-[124px] max-w-[220px] flex-1 basis-0',
        active
          ? 'border-b-white bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.05)] dark:border-b-accent-teal dark:bg-chrome-800 dark:text-chrome-100 dark:shadow-none'
          : 'border-b-transparent bg-transparent text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-chrome-300 dark:hover:bg-chrome-800 dark:hover:text-chrome-100',
      )}
    >
      <span
        className={cn(
          'absolute inset-x-3 top-0 h-0.5 rounded-full transition-all duration-200',
          active ? 'bg-indigo-500 dark:bg-accent-teal' : 'bg-transparent',
        )}
      />
      <span
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center',
          active ? 'text-indigo-500 dark:text-chrome-100' : 'text-slate-400 group-hover:text-slate-600 dark:text-chrome-400 dark:group-hover:text-chrome-300',
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
      {closable ? (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-all duration-200',
              active
                ? 'opacity-100 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-chrome-700 dark:hover:text-chrome-200'
                : 'opacity-0 group-hover:opacity-100 hover:bg-slate-300/70 hover:text-slate-700 dark:hover:bg-chrome-700/70 dark:hover:text-chrome-200',
            )}
            aria-label={l(`关闭 ${tab.title}`, `Close ${tab.title}`)}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </span>
      ) : null}
    </div>
  );
}

export default TabItem;
