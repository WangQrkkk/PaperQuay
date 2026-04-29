import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeLocalPdfMetadataIntoDraft,
  mergeRemoteMetadataIntoDraft,
  titleFromPdfPath,
} from '../src/features/literature/importMetadata.ts';
import type { ImportDraftItem } from '../src/features/literature/importTypes.ts';
import type {
  LocalPdfMetadataPreview,
  MetadataLookupResult,
} from '../src/types/metadata.ts';

function createDraft(overrides: Partial<ImportDraftItem> = {}): ImportDraftItem {
  return {
    path: 'D:/papers/uav-review.pdf',
    title: titleFromPdfPath('D:/papers/uav-review.pdf'),
    authors: '',
    year: '',
    publication: '',
    doi: '',
    categoryId: '',
    ...overrides,
  };
}

test('mergeLocalPdfMetadataIntoDraft replaces filename title and fills empty fields', () => {
  const draft = createDraft();
  const preview: LocalPdfMetadataPreview = {
    title: 'A Review of Task Allocation Methods for UAVs',
    authors: ['George Marios Skaltsis', 'Hyo-Sang Shin'],
    year: '2023',
    publication: 'Journal of Intelligent & Robotic Systems',
    doi: '10.1007/s10846-023-01898-8',
    firstPageText: null,
  };

  const merged = mergeLocalPdfMetadataIntoDraft(draft, preview);

  assert.equal(merged.title, preview.title);
  assert.equal(merged.authors, 'George Marios Skaltsis, Hyo-Sang Shin');
  assert.equal(merged.year, '2023');
  assert.equal(merged.publication, 'Journal of Intelligent & Robotic Systems');
  assert.equal(merged.doi, '10.1007/s10846-023-01898-8');
});

test('mergeRemoteMetadataIntoDraft keeps a locally extracted title and only fills missing fields', () => {
  const draft = createDraft({
    title: 'ChatGLM驱动的医学知识问答研究',
  });
  const remote: MetadataLookupResult = {
    source: 'crossref',
    title: 'A Fast Learning Algorithm for Deep Belief Nets',
    authors: ['Geoffrey Hinton'],
    year: '2006',
    publication: 'Neural Computation',
    doi: '10.1162/neco.2006.18.7.1527',
    url: 'https://doi.org/10.1162/neco.2006.18.7.1527',
    abstractText: null,
  };

  const merged = mergeRemoteMetadataIntoDraft(draft, remote);

  assert.equal(merged.title, 'ChatGLM驱动的医学知识问答研究');
  assert.equal(merged.authors, 'Geoffrey Hinton');
  assert.equal(merged.year, '2006');
  assert.equal(merged.publication, 'Neural Computation');
  assert.equal(merged.doi, '10.1162/neco.2006.18.7.1527');
});

test('mergeRemoteMetadataIntoDraft can replace a filename-derived title', () => {
  const draft = createDraft();
  const remote: MetadataLookupResult = {
    source: 'crossref',
    title: 'A Review of Task Allocation Methods for UAVs',
    authors: [],
    year: null,
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
  };

  const merged = mergeRemoteMetadataIntoDraft(draft, remote);

  assert.equal(merged.title, 'A Review of Task Allocation Methods for UAVs');
});
