import {
  createContext,
  useCallback,
  useContext,
  type PropsWithChildren,
} from 'react';
import type { UiLanguage } from '../types/reader';

const AppLocaleContext = createContext<UiLanguage>('zh-CN');

export function AppLocaleProvider({
  value,
  children,
}: PropsWithChildren<{ value: UiLanguage }>) {
  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale() {
  return useContext(AppLocaleContext);
}

export function useLocaleText() {
  const locale = useAppLocale();

  return useCallback(
    <T,>(zh: T, en: T) => (locale === 'en-US' ? en : zh),
    [locale],
  );
}
