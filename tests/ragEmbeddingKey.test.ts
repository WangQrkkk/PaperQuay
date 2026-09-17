import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';

async function loadRagService() {
  const outdir = await mkdtemp(join(tmpdir(), 'paperquay-rag-key-test-'));
  const outfile = join(outdir, 'rag.mjs');

  try {
    await build({
      bundle: true,
      entryPoints: ['src/services/rag.ts'],
      format: 'esm',
      outfile,
      platform: 'node',
      write: true,
    });
    return await import(pathToFileURL(outfile).href) as typeof import('../src/services/rag.ts');
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

test('RAG embedding key preserves legacy plain mode and versions prefixed mode', async () => {
  const { buildRagEmbeddingModelKey } = await loadRagService();
  const options = {
    baseUrl: 'http://127.0.0.1:3344/v1/',
    apiKey: 'unused',
    model: 'text-embedding-nemotron-3-embed-8b',
    dimensions: null,
  };
  const plainKey = buildRagEmbeddingModelKey(options);
  const prefixedKey = buildRagEmbeddingModelKey({ ...options, inputFormat: 'query-passage' });

  assert.equal(
    plainKey,
    'http://127.0.0.1:3344/v1::text-embedding-nemotron-3-embed-8b::default',
  );
  assert.equal(prefixedKey, `${plainKey}::input=qp-v1`);
});
