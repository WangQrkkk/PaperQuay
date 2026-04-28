export const OPEN_PREFERENCES_EVENT = 'paperquay:open-preferences';
export const UI_LANGUAGE_CHANGED_EVENT = 'paperquay:ui-language-changed';

export interface OpenPreferencesEventDetail {
  section?: 'general' | 'library' | 'reading' | 'mineru' | 'translation' | 'models' | 'summaryQa';
}

export function emitOpenPreferences(section?: OpenPreferencesEventDetail['section']) {
  window.dispatchEvent(
    new CustomEvent<OpenPreferencesEventDetail>(OPEN_PREFERENCES_EVENT, {
      detail: { section },
    }),
  );
}

export function emitUiLanguageChanged(language: 'zh-CN' | 'en-US') {
  window.dispatchEvent(
    new CustomEvent<{ language: 'zh-CN' | 'en-US' }>(UI_LANGUAGE_CHANGED_EVENT, {
      detail: { language },
    }),
  );
}
