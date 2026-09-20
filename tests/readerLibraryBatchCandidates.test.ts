import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import type {
  LiteratureAttachment,
  LiteraturePaper,
} from '../src/types/library.ts';
import type { WorkspaceItem } from '../src/types/reader.ts';

async function loadReaderShared() {
  const outdir = await mkdtemp(join(tmpdir(), 'paperquay-reader-batch-test-'));
  const outfile = join(outdir, 'readerShared.mjs');

  await build({
    bundle: true,
    entryPoints: ['src/features/reader/readerShared.ts'],
    format: 'esm',
    outfile,
    platform: 'node',
    sourcemap: false,
    write: true,
  });

  const module = await import(pathToFileURL(outfile).href);
  await rm(outdir, { recursive: true, force: true });
  return module as typeof import('../src/features/reader/readerShared.ts');
}

function attachment(
  paperId: string,
  overrides: Partial<LiteratureAttachment> = {},
): LiteratureAttachment {
  return {
    id: overrides.id ?? `attachment-${paperId}`,
    paperId,
    kind: overrides.kind ?? 'pdf',
    originalPath: overrides.originalPath ?? null,
    storedPath: overrides.storedPath ?? `D:/PaperQuay/Library/PDF/${paperId}.pdf`,
    relativePath: overrides.relativePath ?? `${paperId}.pdf`,
    fileName: overrides.fileName ?? `${paperId}.pdf`,
    mimeType: overrides.mimeType ?? 'application/pdf',
    fileSize: overrides.fileSize ?? 100,
    contentHash: overrides.contentHash ?? null,
    createdAt: overrides.createdAt ?? 1,
    missing: overrides.missing ?? false,
  };
}

function paper(
  id: string,
  overrides: Partial<LiteraturePaper> = {},
): LiteraturePaper {
  return {
    id,
    title: overrides.title ?? `Paper ${id}`,
    year: overrides.year ?? '2026',
    publication: overrides.publication ?? null,
    doi: overrides.doi ?? null,
    url: overrides.url ?? null,
    abstractText: overrides.abstractText ?? null,
    keywords: overrides.keywords ?? [],
    importedAt: overrides.importedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    lastReadAt: overrides.lastReadAt ?? null,
    readingProgress: overrides.readingProgress ?? 0,
    isFavorite: overrides.isFavorite ?? false,
    userNote: overrides.userNote ?? null,
    aiSummary: overrides.aiSummary ?? null,
    citation: overrides.citation ?? null,
    source: overrides.source ?? 'local',
    sortOrder: overrides.sortOrder ?? 0,
    authors: overrides.authors ?? [],
    tags: overrides.tags ?? [],
    categoryIds: overrides.categoryIds ?? [],
    attachments: overrides.attachments ?? [attachment(id)],
  };
}

test('full-library hydration exposes every paper with an available PDF', async () => {
  const { createNativeLibraryWorkspaceItems } = await loadReaderShared();
  const items = createNativeLibraryWorkspaceItems([
    paper('p1'),
    paper('p2'),
    paper('missing', { attachments: [] }),
  ], 'D:/PaperQuay/Library/PDF');

  assert.deepEqual(items.map((item) => item.workspaceId), [
    'native-library:p1',
    'native-library:p2',
  ]);
  assert.equal(items[0]?.localPdfPath, 'D:/PaperQuay/Library/PDF/p1.pdf');
  assert.equal(items[1]?.localPdfPath, 'D:/PaperQuay/Library/PDF/p2.pdf');
});

test('workspace collection merge de-duplicates and keeps the latest resolved item', async () => {
  const { mergeWorkspaceItemCollections } = await loadReaderShared();
  const hydrated: WorkspaceItem = {
    itemKey: 'p1',
    title: 'Hydrated title',
    creators: 'Unknown Authors',
    year: '2026',
    itemType: 'pdf',
    localPdfPath: 'D:/library/p1.pdf',
    source: 'native-library',
    workspaceId: 'native-library:p1',
    groupKey: 'native-library:p1',
  };
  const opened: WorkspaceItem = {
    ...hydrated,
    title: 'User-visible title',
    localPdfPath: 'D:/resolved/p1.pdf',
  };

  const merged = mergeWorkspaceItemCollections([hydrated], [opened]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.title, 'User-visible title');
  assert.equal(merged[0]?.localPdfPath, 'D:/resolved/p1.pdf');
});

test('authoritative library batch items drop stale native entries and keep standalone PDFs', async () => {
  const { buildAuthoritativeLibraryBatchItems } = await loadReaderShared();
  const staleNative: WorkspaceItem = {
    itemKey: 'deleted',
    title: 'Deleted paper',
    creators: 'Unknown Authors',
    year: '2026',
    itemType: 'pdf',
    localPdfPath: 'D:/old/deleted.pdf',
    source: 'native-library',
    workspaceId: 'native-library:deleted',
    groupKey: 'native-library:deleted',
  };
  const oldNative: WorkspaceItem = {
    ...staleNative,
    itemKey: 'p1',
    title: 'Old title',
    localPdfPath: 'D:/old/p1.pdf',
    workspaceId: 'native-library:p1',
    groupKey: 'native-library:p1',
  };
  const standalone: WorkspaceItem = {
    ...staleNative,
    itemKey: 'standalone',
    title: 'Standalone PDF',
    localPdfPath: 'D:/standalone.pdf',
    source: 'standalone',
    workspaceId: 'standalone:pdf',
    groupKey: 'standalone:pdf',
  };
  const freshNative: WorkspaceItem = {
    ...oldNative,
    title: 'Fresh title',
    localPdfPath: 'D:/fresh/p1.pdf',
  };

  const items = buildAuthoritativeLibraryBatchItems(
    [staleNative, oldNative, standalone],
    [freshNative],
  );

  assert.deepEqual(items.map((item) => item.workspaceId), [
    'standalone:pdf',
    'native-library:p1',
  ]);
  assert.equal(items[1]?.title, 'Fresh title');
  assert.equal(items[1]?.localPdfPath, 'D:/fresh/p1.pdf');
});

test('MinerU rate-limit errors are recognized without matching content failures', async () => {
  const { clampMineruBatchConcurrency, isMineruRateLimitError } = await loadReaderShared();

  assert.equal(isMineruRateLimitError(new Error('HTTP 429 Too Many Requests')), true);
  assert.equal(isMineruRateLimitError('rate limit exceeded'), true);
  assert.equal(isMineruRateLimitError(new Error('MinerU returned an empty structured result.')), false);
  assert.equal(clampMineruBatchConcurrency(8), 2);
  assert.equal(clampMineruBatchConcurrency(1), 1);
});
