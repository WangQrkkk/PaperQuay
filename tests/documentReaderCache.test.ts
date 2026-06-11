import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMatchingSummaryCacheEnvelope,
  loadSavedMineruPages,
  loadSavedSummaryCache,
  resolveSavedPdfPath,
} from '../src/features/reader/documentReaderCache.ts';
import type { PaperSummary, PdfSource, WorkspaceItem } from '../src/types/reader.ts';

function item(overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    itemKey: overrides.itemKey ?? 'item-1',
    title: overrides.title ?? 'Paper Title',
    creators: overrides.creators ?? 'Author',
    year: overrides.year ?? '2026',
    itemType: overrides.itemType ?? 'journalArticle',
    source: overrides.source ?? 'native-library',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    groupKey: overrides.groupKey ?? 'group-1',
    ...overrides,
  };
}

function summary(overrides: Partial<PaperSummary> = {}): PaperSummary {
  return {
    title: overrides.title ?? 'Paper Title',
    abstract: overrides.abstract ?? 'Abstract',
    overview: overrides.overview ?? 'Overview',
    background: overrides.background ?? 'Background',
    researchProblem: overrides.researchProblem ?? 'Problem',
    approach: overrides.approach ?? 'Approach',
    experimentSetup: overrides.experimentSetup ?? 'Experiment',
    keyFindings: overrides.keyFindings ?? ['Finding'],
    conclusions: overrides.conclusions ?? 'Conclusion',
    limitations: overrides.limitations ?? 'Limitation',
    takeaways: overrides.takeaways ?? ['Takeaway'],
    keywords: overrides.keywords ?? ['keyword'],
  };
}

const zh = (value: string) => value;
const parsePages = (payload: string | unknown) => JSON.parse(String(payload));

test('isMatchingSummaryCacheEnvelope requires matching source keys and a summary', () => {
  assert.equal(
    isMatchingSummaryCacheEnvelope({ sourceKey: 'source-1', summary: summary() }, 'source-1'),
    true,
  );
  assert.equal(
    isMatchingSummaryCacheEnvelope({ sourceKey: 'source-2', summary: summary() }, 'source-1'),
    false,
  );
  assert.equal(isMatchingSummaryCacheEnvelope({ sourceKey: 'source-1' }, 'source-1'), false);
});

test('loadSavedSummaryCache skips stale or malformed cache candidates', async () => {
  const saved = summary({ title: 'Cached Summary' });
  const reads: string[] = [];
  const loaded = await loadSavedSummaryCache({
    item: item(),
    mineruCacheDir: 'D:/cache',
    sourceKey: 'source-1',
    readText: async (path) => {
      reads.push(path);
      if (reads.length === 1) return JSON.stringify({ sourceKey: 'other', summary: summary() });
      if (reads.length === 2) return JSON.stringify({ sourceKey: 'source-1', summary: saved });
      return null;
    },
  });

  assert.deepEqual(loaded, saved);
  assert.equal(reads.length, 2);
});

test('loadSavedMineruPages restores the first readable MinerU JSON cache', async () => {
  const reads: string[] = [];
  const loaded = await loadSavedMineruPages({
    item: item({ title: 'Cached Paper' }),
    mineruCacheDir: 'D:/cache',
    l: zh,
    parsePages,
    readText: async (path) => {
      reads.push(path);
      return reads.length === 1
        ? JSON.stringify([[{ type: 'paragraph', content: 'cached text' }]])
        : null;
    },
  });

  assert.equal(loaded?.pages.length, 1);
  assert.equal(loaded?.pages[0]?.[0]?.type, 'paragraph');
  assert.match(loaded?.message ?? '', /本地缓存/);
  assert.equal(reads.length, 1);
});

test('resolveSavedPdfPath returns the first manifest path that still loads as a PDF', async () => {
  const loadAttempts: string[] = [];
  const resolved = await resolveSavedPdfPath({
    item: item(),
    mineruCacheDir: 'D:/cache',
    readText: async () =>
      JSON.stringify({
        version: 1,
        documentKey: 'item-1',
        title: 'Paper Title',
        pdfPath: 'D:/papers/cached.pdf',
        savedAt: new Date(0).toISOString(),
        sourceKind: 'manual-json',
      }),
    loadPdf: async (source: PdfSource) => {
      if (source?.kind === 'local-path') {
        loadAttempts.push(source.path);
      }

      return new Uint8Array([1]);
    },
  });

  assert.equal(resolved, 'D:/papers/cached.pdf');
  assert.deepEqual(loadAttempts, ['D:/papers/cached.pdf']);
});

test('resolveSavedPdfPath ignores invalid manifests and unreadable PDFs', async () => {
  const resolved = await resolveSavedPdfPath({
    item: item(),
    mineruCacheDir: 'D:/cache',
    readText: async () =>
      JSON.stringify({
        version: 1,
        documentKey: 'item-1',
        title: 'Paper Title',
        pdfPath: 'D:/papers/missing.pdf',
        savedAt: new Date(0).toISOString(),
        sourceKind: 'manual-json',
      }),
    loadPdf: async () => {
      throw new Error('missing file');
    },
  });

  assert.equal(resolved, null);
});
