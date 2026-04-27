export function getFileNameFromPath(path: string | null | undefined): string {
  if (!path) {
    return '';
  }

  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');

  return segments[segments.length - 1] ?? path;
}

export function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sideLength = Math.floor((maxLength - 1) / 2);

  return `${value.slice(0, sideLength)}閳?{value.slice(-sideLength)}`;
}

export function joinReadableText(parts: string[]): string {
  return parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function normalizeSelectionText(value: string): string {
  let text = value
    .replace(/[\u0000\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)}\]])/g, '$1')
    .replace(/([({[\u2018\u201C])\s+/g, '$1')
    .trim();

  const cjkChar = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF]';
  const cjkClosePunctuation =
    '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF，。！？；：、）》】」』％,.;:!?%\\]\\)]';
  const cjkOpenPunctuation = '[（《【「『]';

  text = text
    .replace(new RegExp(`(${cjkChar})\\s+(${cjkClosePunctuation})`, 'g'), '$1$2')
    .replace(new RegExp(`(${cjkOpenPunctuation})\\s+(${cjkChar})`, 'g'), '$1$2')
    .replace(new RegExp(`(${cjkChar})\\s+(${cjkChar})`, 'g'), '$1$2')
    .replace(/\b(?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9]\b/g, (match) => match.replace(/\s+/g, ''));

  return text.trim();
}
