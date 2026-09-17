import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatEmbeddingInput } = require('../electron/backend/embeddingInput.cjs');
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');

test('plain embedding input leaves query and document text unchanged', () => {
  const text = '  Original paper text  ';
  assert.equal(formatEmbeddingInput(text, 'plain', 'query'), text);
  assert.equal(formatEmbeddingInput(text, 'plain', 'passage'), text);
  assert.equal(formatEmbeddingInput(text, undefined, 'query'), text);
});

test('query-passage embedding input applies the correct role prefix', () => {
  assert.equal(formatEmbeddingInput('tourist resident conflict', 'query-passage', 'query'), 'query: tourist resident conflict');
  assert.equal(formatEmbeddingInput('tourist resident conflict', 'query-passage', 'passage'), 'passage: tourist resident conflict');
});

test('query-passage prefix is idempotent and does not mutate source text', () => {
  const text = 'A cited passage';
  const formatted = formatEmbeddingInput(text, 'query-passage', 'passage');
  assert.equal(formatted, 'passage: A cited passage');
  assert.equal(formatEmbeddingInput(formatted, 'query-passage', 'passage'), formatted);
  assert.equal(formatEmbeddingInput('  QUERY: Existing question', 'query-passage', 'query'), '  QUERY: Existing question');
  assert.equal(text, 'A cited passage');
});

test('unsupported embedding strategies and roles fail explicitly', () => {
  assert.throws(() => formatEmbeddingInput('text', 'unknown', 'query'), /Unsupported embedding input format/);
  assert.throws(() => formatEmbeddingInput('text', 'query-passage', 'unknown'), /Unsupported embedding input role/);
});

test('RAG handlers prefix model input but retain the original indexed chunk text', async () => {
  const previousFetch = globalThis.fetch;
  const sentInputs: string[][] = [];

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body ?? ''));
    const inputs = body.input as string[];
    sentInputs.push(inputs);
    return new Response(JSON.stringify({
      data: inputs.map((_, index) => ({ index, embedding: [index + 1] })),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const commands = createAiCommands({ ragStore: {} });
    const embedding = {
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'test-key',
      model: 'test-model',
      inputFormat: 'query-passage',
    };
    const chunk = { chunkId: 'chunk-1', text: 'Original cited passage' };

    const queryVector = await commands.rag_embed_text({
      request: { text: 'Resident-tourist conflict', embedding },
    });
    const candidateVector = await commands.rag_embed_text({
      request: { text: 'Tourism participation paper', role: 'passage', embedding },
    });
    const indexedChunks = await commands.rag_embed_chunks({
      request: { chunks: [chunk], embedding },
    });

    assert.deepEqual(sentInputs, [
      ['query: Resident-tourist conflict'],
      ['passage: Tourism participation paper'],
      ['passage: Original cited passage'],
    ]);
    assert.deepEqual(queryVector, [1]);
    assert.deepEqual(candidateVector, [1]);
    assert.equal(chunk.text, 'Original cited passage');
    assert.equal(indexedChunks[0].text, 'Original cited passage');
    assert.deepEqual(indexedChunks[0].embedding, [1]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
