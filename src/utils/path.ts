const PATH_SEP: string =
  typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform ?? '') ? '\\' : '/';

export function getParentDirectory(path: string): string {
  const normalized = path.replace(/[/\\]/g, PATH_SEP);
  const idx = normalized.lastIndexOf(PATH_SEP);
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

export function buildPathInDirectory(directory: string, fileName: string): string {
  const trimmed = directory.trim().replace(/[/\\]+$/, '');
  return trimmed ? `${trimmed}${PATH_SEP}${fileName}` : fileName;
}

export function normalizePathForCompare(path: string): string {
  return path.replace(/[/\\]/g, PATH_SEP).trim().toLowerCase();
}
