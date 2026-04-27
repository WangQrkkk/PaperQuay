export const OPEN_PREFERENCES_EVENT = 'paperquay:open-preferences';

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
