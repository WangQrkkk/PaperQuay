import { useEffect, useState } from 'react';
import { Bot, Library, PanelLeft, type LucideIcon } from 'lucide-react';
import Reader from '../features/reader/Reader';
import AgentWorkspace from '../features/agent/AgentWorkspace';
import { emitOpenPreferences } from './appEvents';
import { AppLocaleProvider } from '../i18n/uiLanguage';

type AppWorkspaceKey = 'library' | 'agent';
type UiLanguage = 'zh-CN' | 'en-US';

interface AppWorkspaceItem {
  key: AppWorkspaceKey;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ACTIVE_WORKSPACE_STORAGE_KEY = 'paperquay-active-workspace-v1';
const SETTINGS_STORAGE_KEY = 'paper-reader-settings-v3';

const workspaces: AppWorkspaceItem[] = [
  {
    key: 'library',
    label: '文库',
    description: '文献管理与阅读',
    icon: Library,
  },
  {
    key: 'agent',
    label: 'Agent',
    description: '研究任务代理',
    icon: Bot,
  },
];

function loadUiLanguage(): UiLanguage {
  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : null;

    return parsed?.uiLanguage === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

function loadInitialWorkspace(): AppWorkspaceKey {
  const stored = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);

  return stored === 'agent' ? 'agent' : 'library';
}

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspaceKey>(loadInitialWorkspace);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(loadUiLanguage);
  const workspaceLabels = uiLanguage === 'en-US'
    ? {
      library: { label: 'Library', description: 'Literature management and reading' },
      agent: { label: 'Agent', description: 'Research task agent' },
    }
    : {
      library: { label: '文库', description: '文献管理与阅读' },
      agent: { label: 'Agent', description: '研究任务代理' },
    };

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setUiLanguage(loadUiLanguage());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const handleOpenPreferencesFromAgent = () => {
    emitOpenPreferences('models');
  };

  return (
    <AppLocaleProvider value={uiLanguage}>
      <div className="flex h-screen w-screen overflow-hidden bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] text-slate-900 antialiased dark:bg-chrome-950 dark:text-chrome-100">
      <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-slate-200/80 bg-white/78 px-2 py-3 shadow-[10px_0_36px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-chrome-950/90 dark:shadow-none">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_10px_26px_rgba(15,23,42,0.14)] ring-1 ring-slate-200/80 dark:bg-chrome-800 dark:ring-white/10">
          <img
            src="/icon.png"
            alt="PaperQuay"
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>

        <div className="mt-5 flex w-full flex-1 flex-col items-center gap-2">
          {workspaces.map((workspace) => {
            const Icon = workspace.icon;
            const active = workspace.key === activeWorkspace;
            const label = workspaceLabels[workspace.key].label;
            const description = workspaceLabels[workspace.key].description;

            return (
              <button
                key={workspace.key}
                type="button"
                data-tour={`workspace-${workspace.key}`}
                onClick={() => setActiveWorkspace(workspace.key)}
                title={`${label} - ${description}`}
                aria-label={label}
                className={[
                  'group relative flex h-12 w-12 items-center justify-center rounded-2xl border text-slate-500 transition-all duration-200',
                  active
                    ? 'border-teal-200 bg-teal-50 text-teal-700 shadow-[0_14px_28px_rgba(20,184,166,0.16)] dark:border-teal-300/30 dark:bg-teal-300/12 dark:text-teal-200'
                    : 'border-transparent hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:hover:border-white/10 dark:hover:bg-chrome-800 dark:hover:text-chrome-100',
                ].join(' ')}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                <span
                  className={[
                    'absolute left-[58px] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-2xl border px-3 py-2 text-left shadow-[0_16px_40px_rgba(15,23,42,0.16)] group-hover:block',
                    'border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-100',
                  ].join(' ')}
                >
                  <span className="block text-xs font-bold">{label}</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-slate-500 dark:text-chrome-400">
                    {description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-chrome-900 dark:text-chrome-500">
          <PanelLeft className="h-4.5 w-4.5" strokeWidth={1.9} />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0">
          <Reader />
        </div>
        <div
          className={[
            'absolute inset-0 bg-[linear-gradient(180deg,#eef2f8,#e7edf5)] transition-opacity duration-150 dark:bg-chrome-950',
            activeWorkspace === 'agent'
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0',
          ].join(' ')}
          aria-hidden={activeWorkspace !== 'agent'}
        >
          <AgentWorkspace onOpenPreferences={handleOpenPreferencesFromAgent} />
        </div>
      </main>
      </div>
    </AppLocaleProvider>
  );
}

export default App;
