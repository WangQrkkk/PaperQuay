import {
  HelpCircle,
  Library,
  Minus,
  Moon,
  Settings2,
  Square,
  Sun,
  X,
} from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

export interface ReaderShellHeaderProps {
  l: (zh: string, en: string) => string;
  themeMode: ThemeMode;
  onOpenStandalonePdf: () => void;
  onOpenOnboarding: () => void;
  onOpenPreferences: () => void;
  onCycleThemeMode: () => void;
  onWindowMinimize: () => void;
  onWindowToggleMaximize: () => void;
  onWindowClose: () => void;
}

export default function ReaderShellHeader({
  l,
  themeMode,
  onOpenStandalonePdf,
  onOpenOnboarding,
  onOpenPreferences,
  onCycleThemeMode,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
}: ReaderShellHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/72 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950">
      <div
        className="flex min-w-0 items-center gap-3"
        data-tauri-drag-region
        onDoubleClick={onWindowToggleMaximize}
      >
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_10px_28px_rgba(15,23,42,0.16)] ring-1 ring-slate-200/80 dark:bg-chrome-800 dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)] dark:ring-white/10">
          <img
            src="/icon.png"
            alt="PaperQuay"
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-chrome-100">
            PaperQuay
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-chrome-400">
            {l(
              '桌面优先的论文阅读与研究工作台',
              'A desktop-first workspace for paper reading and research analysis',
            )}
          </div>
        </div>
      </div>

      <div
        className="mx-4 min-w-8 flex-1 self-stretch"
        data-tauri-drag-region
        onDoubleClick={onWindowToggleMaximize}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenStandalonePdf}
          data-tour="open-pdf"
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
        >
          <Library className="mr-2 h-4 w-4" strokeWidth={1.8} />
          {l('打开 PDF', 'Open PDF')}
        </button>
        <button
          type="button"
          onClick={onOpenOnboarding}
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
        >
          <HelpCircle className="mr-2 h-4 w-4" strokeWidth={1.8} />
          {l('新手引导', 'Guide')}
        </button>
        <button
          type="button"
          onClick={onOpenPreferences}
          data-tour="settings"
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
        >
          <Settings2 className="mr-2 h-4 w-4" strokeWidth={1.8} />
          {l('设置', 'Settings')}
        </button>
        <button
          type="button"
          onClick={onCycleThemeMode}
          className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-chrome-700 dark:bg-chrome-800 dark:text-chrome-200 dark:hover:border-chrome-600 dark:hover:bg-chrome-700"
          title={
            themeMode === 'light'
              ? l('浅色模式', 'Light Mode')
              : themeMode === 'dark'
                ? l('深色模式', 'Dark Mode')
                : l('跟随系统', 'System Theme')
          }
        >
          {themeMode === 'light' ? (
            <Sun className="mr-2 h-4 w-4" strokeWidth={1.8} />
          ) : themeMode === 'dark' ? (
            <Moon className="mr-2 h-4 w-4" strokeWidth={1.8} />
          ) : (
            <Sun className="mr-2 h-4 w-4" strokeWidth={1.8} />
          )}
          {themeMode === 'light'
            ? l('浅色', 'Light')
            : themeMode === 'dark'
              ? l('深色', 'Dark')
              : l('自动', 'Auto')}
        </button>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-chrome-700 dark:bg-chrome-800">
          <button
            type="button"
            onClick={onWindowMinimize}
            className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
            aria-label={l('最小化窗口', 'Minimize Window')}
          >
            <Minus className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={onWindowToggleMaximize}
            className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 dark:text-chrome-400 dark:hover:bg-chrome-700 dark:hover:text-chrome-200"
            aria-label={l('切换窗口缩放', 'Toggle Window Maximize')}
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={onWindowClose}
            className="rounded-lg p-2 text-slate-500 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 dark:text-chrome-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-400"
            aria-label={l('关闭窗口', 'Close Window')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </header>
  );
}
