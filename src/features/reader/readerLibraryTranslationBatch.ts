import type { WorkspaceItem } from '../../types/reader';

export type StructuredDocumentLanguage = 'english' | 'non-english' | 'unknown';

export interface StructuredDocumentLanguageEvidence {
  language: StructuredDocumentLanguage;
  englishLexicalHits: number;
  hanCount: number;
  latinCount: number;
  nonEnglishLexicalHits: number;
  titleHanCount: number;
  titleLatinCount: number;
  wordCount: number;
}

export type LibraryTranslationRunStatus =
  | 'success'
  | 'partial'
  | 'skipped'
  | 'cancelled'
  | 'rate-limited'
  | 'failed';

export interface LibraryTranslationRunResult {
  status: LibraryTranslationRunStatus;
  translatedCount: number;
  totalBlocks: number;
  message: string;
}

export interface LibraryTranslationRunOptions {
  batchSize?: number;
  beforeRequest?: () => Promise<void> | void;
  concurrency?: number;
  englishOnly?: boolean;
  quiet?: boolean;
  signal?: AbortSignal;
  sourceLanguage?: string;
  stopOnRateLimit?: boolean;
  targetLanguage?: string;
  waitForResumeOrCancel?: () => Promise<boolean>;
}

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/gu;
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/gu;
const LATIN_WORD_PATTERN = /\p{Script=Latin}+(?:['’\-]\p{Script=Latin}+)*/gu;
const ENGLISH_LEXICAL_MARKERS = new Set([
  'the', 'and', 'of', 'to', 'for', 'with', 'that', 'this', 'from', 'by', 'as',
  'are', 'was', 'were', 'which', 'these', 'those', 'between', 'through',
  'into', 'during', 'within', 'among', 'while', 'where', 'when', 'their', 'they',
  'them', 'our', 'we', 'its', 'has', 'have', 'been', 'can', 'may', 'using',
  'based', 'results', 'study', 'research', 'findings', 'approach',
]);
const FRENCH_LEXICAL_MARKERS = new Set([
  'le', 'la', 'les', 'des', 'une', 'et', 'dans', 'pour', 'sur', 'avec', 'qui',
  'est', 'sont', 'cette', 'nous', 'aux', 'du', 'au', 'entre', 'leurs', 'ces',
  'être', 'comme', 'notre', 'étude', 'résultats', 'recherche',
]);
const GERMAN_LEXICAL_MARKERS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ein', 'eine', 'einer', 'im',
  'mit', 'für', 'auf', 'zu', 'von', 'ist', 'sind', 'diese', 'wir', 'nicht',
  'zwischen', 'durch', 'als', 'werden', 'wurde', 'studie', 'ergebnisse',
]);
const SPANISH_LEXICAL_MARKERS = new Set([
  'el', 'la', 'los', 'las', 'del', 'una', 'uno', 'en', 'para', 'con', 'que', 'por',
  'es', 'son', 'esta', 'este', 'se', 'al', 'como', 'entre', 'desde', 'sus',
  'nuestro', 'estudio', 'resultados', 'investigación',
]);
const OTHER_LATIN_LANGUAGE_MARKERS = new Set([
  'gli', 'della', 'delle', 'nella', 'sono', 'questo', 'questa', 'ricerca',
  'os', 'uma', 'com', 'não', 'são', 'este', 'esta', 'pesquisa', 'resultados',
]);

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

/**
 * Fail-closed language gate for the library-wide translation action.
 *
 * A paper is eligible only when its structured body provides strong Latin-script
 * evidence and contains little Han-script text. Ambiguous and bilingual material
 * is intentionally skipped so a Chinese paper with an English abstract or
 * references is never sent through the English-to-Chinese batch.
 */
export function classifyStructuredDocumentLanguage({
  title,
  texts,
}: {
  title: string;
  texts: Iterable<string>;
}): StructuredDocumentLanguageEvidence {
  const titleHanCount = countMatches(title, HAN_CHARACTER_PATTERN);
  const titleLatinCount = countMatches(title, LATIN_CHARACTER_PATTERN);
  let hanCount = 0;
  let latinCount = 0;
  let wordCount = 0;
  let englishLexicalOccurrences = 0;
  const englishMarkers = new Set<string>();
  const nonEnglishOccurrences = [0, 0, 0, 0];
  const nonEnglishMarkers = [
    new Set<string>(),
    new Set<string>(),
    new Set<string>(),
    new Set<string>(),
  ];

  for (const text of texts) {
    hanCount += countMatches(text, HAN_CHARACTER_PATTERN);
    latinCount += countMatches(text, LATIN_CHARACTER_PATTERN);
    const words = text.toLocaleLowerCase('en-US').match(LATIN_WORD_PATTERN) ?? [];

    for (const word of words) {
      wordCount += 1;
      if (ENGLISH_LEXICAL_MARKERS.has(word)) {
        englishLexicalOccurrences += 1;
        englishMarkers.add(word);
      }

      for (const [index, markers] of [
        FRENCH_LEXICAL_MARKERS,
        GERMAN_LEXICAL_MARKERS,
        SPANISH_LEXICAL_MARKERS,
        OTHER_LATIN_LANGUAGE_MARKERS,
      ].entries()) {
        if (markers.has(word)) {
          nonEnglishOccurrences[index] += 1;
          nonEnglishMarkers[index].add(word);
        }
      }
    }
  }

  const scriptCount = hanCount + latinCount;
  const hanRatio = scriptCount > 0 ? hanCount / scriptCount : 0;
  const titleLooksChinese = titleHanCount > 0;
  const bodyHasMeaningfulChinese = hanCount >= 20 && hanRatio >= 0.02;
  const englishLexicalHits = englishMarkers.size;
  const nonEnglishLexicalHits = Math.max(...nonEnglishMarkers.map((hits) => hits.size));
  const strongestNonEnglishOccurrences = Math.max(...nonEnglishOccurrences);
  const minimumEnglishOccurrences = Math.max(12, Math.ceil(wordCount * 0.04));
  const hasStrongEnglishLexicalEvidence =
    wordCount >= 80 &&
    englishLexicalHits >= 6 &&
    englishLexicalHits >= nonEnglishLexicalHits + 3 &&
    englishLexicalOccurrences >= minimumEnglishOccurrences &&
    englishLexicalOccurrences >= strongestNonEnglishOccurrences * 2 + 6;
  const bodyIsStronglyEnglish =
    latinCount >= 200 &&
    (hanCount === 0 || hanRatio < 0.02) &&
    hasStrongEnglishLexicalEvidence;

  return {
    englishLexicalHits,
    language:
      titleLooksChinese || bodyHasMeaningfulChinese
        ? 'non-english'
        : bodyIsStronglyEnglish
          ? 'english'
          : 'unknown',
    hanCount,
    latinCount,
    nonEnglishLexicalHits,
    titleHanCount,
    titleLatinCount,
    wordCount,
  };
}

export function getAutoEnglishTranslationAttemptKey(
  item: WorkspaceItem,
  sourceFingerprint = '',
): string {
  return [
    item.workspaceId,
    item.localPdfPath?.trim() ?? '',
    item.title.trim(),
    item.year ?? '',
    sourceFingerprint,
  ].join('::');
}
