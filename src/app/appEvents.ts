import type { NotePdfLocation } from '../types/notes';

export const OPEN_PREFERENCES_EVENT = 'paperquay:open-preferences';
export const UI_LANGUAGE_CHANGED_EVENT = 'paperquay:ui-language-changed';
export const OPEN_STANDALONE_PDF_EVENT = 'paperquay:open-standalone-pdf';
export const JUMP_TO_NOTE_ANCHOR_EVENT = 'paperquay:jump-to-note-anchor';
export const NOTE_CHANGED_EVENT = 'paperquay:note-changed';

export interface OpenPreferencesEventDetail {
  section?:
    | 'general'
    | 'library'
    | 'reading'
    | 'mineru'
    | 'backup'
    | 'translation'
    | 'models'
    | 'embedding'
    | 'summaryQa';
}

export function emitOpenPreferences(section?: OpenPreferencesEventDetail['section']) {
  window.dispatchEvent(
    new CustomEvent<OpenPreferencesEventDetail>(OPEN_PREFERENCES_EVENT, {
      detail: { section },
    }),
  );
}

export interface JumpToNoteAnchorEventDetail {
  requestId?: string;
  targetPaperId?: string;
  noteId: string;
  noteTitle?: string;
  notePaperId?: string;
  anchorId: string;
  anchorPaperId?: string;
  anchorLabel?: string;
  pdfLocation?: NotePdfLocation | null;
}

export interface NoteChangedEventDetail {
  action: 'created' | 'updated' | 'deleted';
  noteId: string;
  note?: unknown;
  updatedAt?: number;
  sourceId?: string;
}

export function emitOpenStandalonePdf() {
  window.dispatchEvent(new CustomEvent(OPEN_STANDALONE_PDF_EVENT));
}

export function emitJumpToNoteAnchor(detail: JumpToNoteAnchorEventDetail) {
  window.dispatchEvent(
    new CustomEvent<JumpToNoteAnchorEventDetail>(JUMP_TO_NOTE_ANCHOR_EVENT, {
      detail,
    }),
  );
}

export function emitNoteChanged(detail: NoteChangedEventDetail) {
  window.dispatchEvent(
    new CustomEvent<NoteChangedEventDetail>(NOTE_CHANGED_EVENT, {
      detail,
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
