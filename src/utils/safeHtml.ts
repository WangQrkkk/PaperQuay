const ALLOWED_TABLE_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'p',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'sup',
  'sub',
  'br',
]);

const ALLOWED_ATTRIBUTES = new Set(['rowspan', 'colspan', 'scope']);

function sanitizeElement(element: Element) {
  const tagName = element.tagName.toLowerCase();

  if (!ALLOWED_TABLE_TAGS.has(tagName)) {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    return;
  }

  for (const attribute of [...element.attributes]) {
    const attributeName = attribute.name.toLowerCase();
    const attributeValue = attribute.value.trim().toLowerCase();

    if (attributeName.startsWith('on')) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (attributeValue.startsWith('javascript:')) {
      element.removeAttribute(attribute.name);
    }
  }

  for (const child of [...element.children]) {
    sanitizeElement(child);
  }
}

export function sanitizeMineruTableHtml(html: string): string {
  if (!html.trim() || typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return '';
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(html, 'text/html');

  for (const scriptNode of documentNode.querySelectorAll('script, style, iframe, object, embed, link, meta')) {
    scriptNode.remove();
  }

  for (const child of [...documentNode.body.children]) {
    sanitizeElement(child);
  }

  return documentNode.body.innerHTML;
}
