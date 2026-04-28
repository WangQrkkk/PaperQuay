import { create } from 'zustand';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'paperquay-theme-mode';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

let mediaQueryListenerBound = false;
let mediaQueryList: MediaQueryList | null = null;
let mediaQueryChangeHandler: (() => void) | null = null;

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }
  } catch {
    // ignore
  }

  return 'system';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
  }

  return mode;
}

function applyHtmlClass(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function unbindSystemThemeListener() {
  if (mediaQueryList && mediaQueryChangeHandler) {
    mediaQueryList.removeEventListener('change', mediaQueryChangeHandler);
  }

  mediaQueryList = null;
  mediaQueryChangeHandler = null;
  mediaQueryListenerBound = false;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const initialMode = readStoredMode();
  const initialResolved = resolveTheme(initialMode);

  applyHtmlClass(initialResolved);

  if (typeof window !== 'undefined' && !mediaQueryListenerBound) {
    mediaQueryList = window.matchMedia(DARK_MEDIA_QUERY);
    mediaQueryChangeHandler = () => {
      const current = get();

      if (current.mode !== 'system') {
        return;
      }

      const next = resolveTheme('system');
      applyHtmlClass(next);
      set({ resolved: next });
    };
    mediaQueryList.addEventListener('change', mediaQueryChangeHandler);
    mediaQueryListenerBound = true;
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unbindSystemThemeListener();
  });
}
