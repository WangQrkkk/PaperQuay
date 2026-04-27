import type { LibrarySettings } from '../../types/library';

export const LIBRARY_SETTINGS_UPDATED_EVENT = 'paperquay:library-settings-updated';
export const ZOTERO_IMPORT_REQUEST_EVENT = 'paperquay:zotero-import-request';

export interface LibrarySettingsUpdatedEventDetail {
  settings: LibrarySettings;
  source?: string;
}

export interface ZoteroImportRequestEventDetail {
  dataDir?: string;
  source?: string;
}

export function emitLibrarySettingsUpdated(settings: LibrarySettings, source?: string) {
  window.dispatchEvent(
    new CustomEvent<LibrarySettingsUpdatedEventDetail>(LIBRARY_SETTINGS_UPDATED_EVENT, {
      detail: { settings, source },
    }),
  );
}

export function emitZoteroImportRequest(dataDir?: string, source?: string) {
  window.dispatchEvent(
    new CustomEvent<ZoteroImportRequestEventDetail>(ZOTERO_IMPORT_REQUEST_EVENT, {
      detail: { dataDir, source },
    }),
  );
}
