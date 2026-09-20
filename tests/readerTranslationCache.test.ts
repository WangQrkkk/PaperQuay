import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTranslationSourceMetadata,
  selectReusableCachedTranslations,
} from '../src/features/reader/readerTranslationSource.ts';

const sourceBlocks = [
  { blockId: 'section-1', text: 'Visitors and residents share a rural square.' },
  { blockId: 'section-2', text: 'The model evaluates several governance scenarios.' },
];

test('source-bound translation cache is reusable only for the exact structured source', () => {
  const sourceMetadata = buildTranslationSourceMetadata(sourceBlocks);
  const cached = {
    ...sourceMetadata,
    translations: {
      'section-1': '游客与居民共享一个乡村广场。',
      'section-2': '该模型评估若干治理情景。',
    },
  };

  assert.deepEqual(selectReusableCachedTranslations(cached, sourceBlocks), cached.translations);
  assert.deepEqual(
    selectReusableCachedTranslations(cached, [
      sourceBlocks[0],
      { ...sourceBlocks[1], text: 'The model now evaluates a changed source.' },
    ]),
    {},
  );
});

test('source fingerprints normalize harmless whitespace but bind block IDs and text', () => {
  const normalized = buildTranslationSourceMetadata(sourceBlocks);
  const whitespaceVariant = buildTranslationSourceMetadata([
    { blockId: 'section-1', text: '  Visitors  and residents share a rural square.\r\n' },
    { blockId: 'section-2', text: 'The model evaluates several governance scenarios.  ' },
  ]);
  const changedBlockId = buildTranslationSourceMetadata([
    { ...sourceBlocks[0], blockId: 'section-renamed' },
    sourceBlocks[1],
  ]);

  assert.equal(whitespaceVariant.sourceFingerprint, normalized.sourceFingerprint);
  assert.notEqual(changedBlockId.sourceFingerprint, normalized.sourceFingerprint);
});

test('legacy cache remains readable data but is never trusted as a complete source-bound cache', () => {
  const reusable = selectReusableCachedTranslations(
    {
      legacySourceBinding: true,
      translations: {
        'section-1': '旧译文',
        'section-2': '旧译文',
      },
    },
    sourceBlocks,
  );

  assert.deepEqual(reusable, {});
});
