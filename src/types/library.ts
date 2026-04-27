export type LibraryImportMode = 'copy' | 'move' | 'keep';

export interface LibrarySettings {
  storageDir: string;
  zoteroLocalDataDir: string;
  importMode: LibraryImportMode;
  autoRenameFiles: boolean;
  fileNamingRule: string;
  createCategoryFolders: boolean;
  folderWatchEnabled: boolean;
  backupEnabled: boolean;
  preserveOriginalPath: boolean;
}

export interface LiteratureAuthor {
  id: string;
  name: string;
  givenName: string | null;
  familyName: string | null;
  sortOrder: number;
}

export interface LiteratureTag {
  id: string;
  name: string;
  color: string | null;
}

export interface LiteratureCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isSystem: boolean;
  systemKey: 'all' | 'recent' | 'uncategorized' | 'favorites' | string | null;
  createdAt: number;
  updatedAt: number;
  paperCount: number;
}

export interface LiteratureAttachment {
  id: string;
  paperId: string;
  kind: 'pdf' | string;
  originalPath: string | null;
  storedPath: string;
  relativePath: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentHash: string | null;
  createdAt: number;
  missing: boolean;
}

export interface LiteraturePaper {
  id: string;
  title: string;
  year: string | null;
  publication: string | null;
  doi: string | null;
  url: string | null;
  abstractText: string | null;
  keywords: string[];
  importedAt: number;
  updatedAt: number;
  lastReadAt: number | null;
  readingProgress: number;
  isFavorite: boolean;
  userNote: string | null;
  aiSummary: string | null;
  citation: string | null;
  source: 'local' | 'zotero' | string;
  sortOrder: number;
  authors: LiteratureAuthor[];
  tags: LiteratureTag[];
  categoryIds: string[];
  attachments: LiteratureAttachment[];
}

export interface LibrarySnapshot {
  settings: LibrarySettings;
  categories: LiteratureCategory[];
  papers: LiteraturePaper[];
}

export interface ListPapersRequest {
  categoryId?: string | null;
  tagId?: string | null;
  search?: string | null;
  sortBy?: 'manual' | 'title' | 'year' | 'author' | 'importedAt' | 'updatedAt' | 'lastReadAt';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
}

export interface CreateCategoryRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateCategoryRequest {
  id: string;
  name?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface MoveCategoryRequest {
  categoryId: string;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface ImportPdfMetadata {
  title?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  keywords?: string[] | null;
  authors?: string[] | null;
}

export interface ImportPdfRequest {
  paths: string[];
  targetCategoryId?: string | null;
  importMode?: LibraryImportMode | null;
  metadata?: Record<string, ImportPdfMetadata> | null;
}

export interface ImportedPdfResult {
  sourcePath: string;
  paper: LiteraturePaper | null;
  duplicated: boolean;
  existingPaperId: string | null;
  status: 'imported' | 'duplicate' | 'failed' | string;
  message: string;
}

export interface RelocateAttachmentRequest {
  attachmentId: string;
  newPath: string;
}

export interface AssignPaperCategoryRequest {
  paperId: string;
  categoryId: string;
}

export interface UpdatePaperRequest {
  paperId: string;
  title?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  keywords?: string[] | null;
  tags?: string[] | null;
  authors?: string[] | null;
  userNote?: string | null;
  aiSummary?: string | null;
  citation?: string | null;
  isFavorite?: boolean | null;
}

export interface DeletePaperRequest {
  paperId: string;
  deleteFiles?: boolean;
}

export type LiteraturePaperTaskKind = 'mineru' | 'translation' | 'overview';

export type LiteraturePaperTaskStatus = 'running' | 'success' | 'error';

export interface LiteraturePaperTaskState {
  kind: LiteraturePaperTaskKind;
  status: LiteraturePaperTaskStatus;
  label: string;
  message: string;
  completed?: number | null;
  total?: number | null;
  updatedAt: number;
}

export interface ReorderPapersRequest {
  paperIds: string[];
}
