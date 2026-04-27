import { create } from 'zustand';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'paperquay-theme-mode';

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function applyHtmlClass(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const initialMode = readStoredMode();
  const initialResolved = resolveTheme(initialMode);

  // Apply the class immediately on store creation
  applyHtmlClass(initialResolved);

  // Listen for system preference changes
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const current = get();
      if (current.mode === 'system') {
        const next = resolveTheme('system');
        applyHtmlClass(next);
        set({ resolved: next });
      }
    });
  }

  return {
    mode: initialMode,
    resolved: initialResolved,
    setMode: (mode) => {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // ignore
      }
      const resolved = resolveTheme(mode);
      applyHtmlClass(resolved);
      set({ mode, resolved });
    },
  };
});
