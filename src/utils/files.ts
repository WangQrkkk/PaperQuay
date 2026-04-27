const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg',
]);

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'tex',
  'log',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'java',
  'go',
  'sql',
]);

function getExtension(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() ?? normalized;
  const dotIndex = fileName.lastIndexOf('.');

  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

export function guessMimeTypeFromPath(path: string): string {
  const extension = getExtension(path);

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
    case 'log':
      return 'text/plain';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'tsv':
      return 'text/tab-separated-values';
    case 'yaml':
    case 'yml':
      return 'application/yaml';
    case 'xml':
      return 'application/xml';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(path));
}

export function isTextLikePath(path: string): boolean {
  return TEXT_EXTENSIONS.has(getExtension(path));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
