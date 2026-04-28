import { Database, Folder, FolderOpen, Star } from 'lucide-react';
import type {
  LiteratureCategory,
  LiteraturePaper,
} from '../../types/library';
import type { UiLanguage } from '../../types/reader';

export interface FlatLiteratureCategory extends LiteratureCategory {
  depth: number;
}

export function flattenCategories(categories: LiteratureCategory[]): FlatLiteratureCategory[] {
  const systemCategories = categories
    .filter((category) => category.isSystem)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const userCategories = categories
    .filter((category) => !category.isSystem)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const childrenMap = new Map<string | null, LiteratureCategory[]>();

  for (const category of userCategories) {
    const parentId = category.parentId ?? null;
    childrenMap.set(parentId, [...(childrenMap.get(parentId) ?? []), category]);
  }

  const output: FlatLiteratureCategory[] = systemCategories.map((category) => ({
    ...category,
    depth: 0,
  }));
  const visited = new Set<string>();

  const visit = (parentId: string | null, depth: number) => {
    for (const category of childrenMap.get(parentId) ?? []) {
      if (visited.has(category.id)) {
        continue;
      }

      visited.add(category.id);
      output.push({
        ...category,
        depth,
      });
      visit(category.id, depth + 1);
    }
  };

  visit(null, 0);

  return output;
}

export function categoryIcon(category: LiteratureCategory) {
  if (category.systemKey === 'favorites') {
    return <Star className="h-4 w-4" strokeWidth={1.8} />;
  }

  if (category.isSystem) {
    return <Database className="h-4 w-4" strokeWidth={1.8} />;
  }

  return category.parentId ? (
    <Folder className="h-4 w-4" strokeWidth={1.8} />
  ) : (
    <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
  );
}

export function categoryDisplayName(category: LiteratureCategory, locale: UiLanguage): string {
  if (locale !== 'en-US') {
    return category.name;
  }

  switch (category.systemKey) {
    case 'all':
      return 'All Papers';
    case 'recent':
      return 'Recently Imported';
    case 'uncategorized':
      return 'Uncategorized';
    case 'favorites':
      return 'Favorites';
    default:
      return category.name;
  }
}

export function paperAuthors(paper: LiteraturePaper): string {
  if (paper.authors.length === 0) {
    return 'Unknown Authors';
  }

  return paper.authors.map((author) => author.name).join(', ');
}

export function paperPdfPath(paper: LiteraturePaper): string | null {
  return paper.attachments.find((attachment) => attachment.kind === 'pdf')?.storedPath ?? null;
}
