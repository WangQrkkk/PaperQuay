import type { WorkspaceItem } from '../types/reader';

export interface MineruCachePaths {
  directory: string;
  manifestPath: string;
  contentJsonPath: string;
  middleJsonPath: string;
  markdownPath: string;
  translationsDir: string;
  summariesDir: string;
}

export function guessSiblingJsonPath(pdfPath: string): string {
  const separator = pdfPath.includes('\\') ? '\\' : '/';
  const lastSeparatorIndex = Math.max(pdfPath.lastIndexOf('/'), pdfPath.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? pdfPath.slice(0, lastSeparatorIndex) : '.';

  return `${directory}${separator}content_list_v2.json`;
}

export function guessSiblingMarkdownPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? path.slice(0, lastSeparatorIndex) : '.';

  return `${directory}${separator}full.md`;
}

function getPathSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

function joinPath(basePath: string, ...segments: string[]): string {
  const separator = getPathSeparator(basePath);
  const normalizedBase = basePath.replace(/[\\/]+$/, '');

  return [normalizedBase, ...segments.filter(Boolean)].join(separator);
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return 'document';
  }

  return trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'document';
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildMineruCachePaths(rootDir: string, item: WorkspaceItem): MineruCachePaths {
  const directoryName = `${sanitizePathSegment(item.title)}-${hashString(item.workspaceId)}`;
  const directory = joinPath(rootDir, directoryName);
  const translationsDir = joinPath(directory, 'translations');
  const summariesDir = joinPath(directory, 'summaries');

  return {
    directory,
    manifestPath: joinPath(directory, 'paper_reader_manifest.json'),
    contentJsonPath: joinPath(directory, 'content_list_v2.json'),
    middleJsonPath: joinPath(directory, 'middle.json'),
    markdownPath: joinPath(directory, 'full.md'),
    translationsDir,
    summariesDir,
  };
}

export function buildLegacyMineruCachePaths(rootDir: string, item: WorkspaceItem): MineruCachePaths {
  const directoryName = `${sanitizePathSegment(item.title)}-${hashString(item.itemKey)}`;
  const directory = joinPath(rootDir, directoryName);
  const translationsDir = joinPath(directory, 'translations');
  const summariesDir = joinPath(directory, 'summaries');

  return {
    directory,
    manifestPath: joinPath(directory, 'paper_reader_manifest.json'),
    contentJsonPath: joinPath(directory, 'content_list_v2.json'),
    middleJsonPath: joinPath(directory, 'middle.json'),
    markdownPath: joinPath(directory, 'full.md'),
    translationsDir,
    summariesDir,
  };
}

export function buildMineruTranslationCachePath(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
): string {
  const cachePaths = buildMineruCachePaths(rootDir, item);
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  return joinPath(cachePaths.translationsDir, `${languageSegment}.json`);
}

export function buildLegacyMineruTranslationCachePath(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
): string {
  const cachePaths = buildLegacyMineruCachePaths(rootDir, item);
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  return joinPath(cachePaths.translationsDir, `${languageSegment}.json`);
}

export function buildMineruSummaryCachePath(
  rootDir: string,
  item: WorkspaceItem,
  sourceKey: string,
): string {
  const cachePaths = buildMineruCachePaths(rootDir, item);
  const fileName = `${hashString(sourceKey || 'summary')}.json`;

  return joinPath(cachePaths.summariesDir, fileName);
}

export function buildLegacyMineruSummaryCachePath(
  rootDir: string,
  item: WorkspaceItem,
  sourceKey: string,
): string {
  const cachePaths = buildLegacyMineruCachePaths(rootDir, item);
  const fileName = `${hashString(sourceKey || 'summary')}.json`;

  return joinPath(cachePaths.summariesDir, fileName);
}

export function buildSiblingPath(path: string, fileName: string): string {
  const separator = getPathSeparator(path);
  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? path.slice(0, lastSeparatorIndex) : '';

  return directory ? `${directory}${separator}${fileName}` : fileName;
}
