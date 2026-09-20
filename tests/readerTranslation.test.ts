import assert from "node:assert/strict";
import test from "node:test";

import {
  createTranslationRequestRateLimiter,
  getPendingTranslationBlocks,
  sanitizeTranslationErrorMessage,
  translateBlocksBestEffort,
} from "../src/features/reader/readerTranslation.ts";

const l = (zh: string, en: string) => zh || en;

test("getPendingTranslationBlocks skips blocks that already have saved translations", () => {
  const pendingBlocks = getPendingTranslationBlocks(
    [
      { blockId: "a", text: "Alpha" },
      { blockId: "b", text: "Beta" },
      { blockId: "c", text: "Gamma" },
    ],
    {
      a: "已翻译 Alpha",
      c: "已翻译 Gamma",
    },
  );

  assert.deepEqual(
    pendingBlocks.map((block) => block.blockId),
    ["b"],
  );
});

test("translateBlocksBestEffort keeps successful translations when later batches fail", async () => {
  const progressSnapshots: number[] = [];
  const result = await translateBlocksBestEffort({
    apiKey: "test-key",
    baseUrl: "https://example.com",
    batchSize: 1,
    blocks: [
      { blockId: "a", text: "Alpha" },
      { blockId: "b", text: "Beta" },
    ],
    concurrency: 1,
    model: "demo-model",
    onProgress: (progress) => {
      progressSnapshots.push(progress.translatedCount);
    },
    sourceLanguage: "English",
    targetLanguage: "Chinese",
    translateBatch: async (options) => {
      const [block] = options.blocks;

      if (block?.blockId === "a") {
        return [{ blockId: "a", translatedText: "阿尔法" }];
      }

      throw new Error("Translation output was not valid JSON: EOF");
    },
  });

  assert.deepEqual(result.translations, { a: "阿尔法" });
  assert.equal(result.failedBlocks.length, 1);
  assert.equal(result.failedBlocks[0]?.blockId, "b");
  assert.equal(result.translatedCount, 1);
  assert.deepEqual(progressSnapshots, [1, 1]);
});

test("translateBlocksBestEffort stops launching new batches after cancellation", async () => {
  const abortController = new AbortController();
  const translatedBlockIds: string[] = [];

  const result = await translateBlocksBestEffort({
    apiKey: "test-key",
    baseUrl: "https://example.com",
    batchSize: 1,
    blocks: [
      { blockId: "a", text: "Alpha" },
      { blockId: "b", text: "Beta" },
    ],
    concurrency: 1,
    model: "demo-model",
    onProgress: (progress) => {
      if (progress.translatedCount === 1) {
        abortController.abort();
      }
    },
    signal: abortController.signal,
    sourceLanguage: "English",
    targetLanguage: "Chinese",
    translateBatch: async (options) => {
      const [block] = options.blocks;

      if (!block) {
        return [];
      }

      translatedBlockIds.push(block.blockId);
      return [{ blockId: block.blockId, translatedText: `译文 ${block.text}` }];
    },
  });

  assert.equal(result.cancelled, true);
  assert.deepEqual(translatedBlockIds, ["a"]);
  assert.deepEqual(result.translations, { a: "译文 Alpha" });
  assert.deepEqual(
    result.failedBlocks.map((block) => block.blockId),
    ["b"],
  );
});

test('translation request limiter spaces every request across one shared run', async () => {
  let currentTime = 0;
  const waits: number[] = [];
  const waitForSlot = createTranslationRequestRateLimiter(60, {
    now: () => currentTime,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  await waitForSlot();
  await waitForSlot();
  await waitForSlot();

  assert.deepEqual(waits, [1_000, 1_000]);
});

test('zero RPM leaves requests unthrottled while the caller can still run them serially', async () => {
  const waits: number[] = [];
  const waitForSlot = createTranslationRequestRateLimiter(0, {
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  await Promise.all([waitForSlot(), waitForSlot(), waitForSlot()]);
  assert.deepEqual(waits, []);
});

test('translation request limiter releases an RPM wait promptly when cancelled', async () => {
  let releaseWait: (() => void) | null = null;
  const waiting = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  const waitForSlot = createTranslationRequestRateLimiter(1, {
    now: () => 0,
    wait: async () => waiting,
  });
  const controller = new AbortController();

  await waitForSlot(controller.signal);
  const secondSlot = waitForSlot(controller.signal);
  await Promise.resolve();
  controller.abort();

  await Promise.race([
    secondSlot,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('rate limiter did not observe cancellation')), 100);
    }),
  ]);
  releaseWait?.();
});

test("translateBlocksBestEffort stops the run after a 429 when requested", async () => {
  const requestedBlockIds: string[] = [];
  const result = await translateBlocksBestEffort({
    apiKey: "test-key",
    baseUrl: "https://example.com",
    batchSize: 1,
    blocks: [
      { blockId: "a", text: "Alpha" },
      { blockId: "b", text: "Beta" },
      { blockId: "c", text: "Gamma" },
    ],
    concurrency: 1,
    model: "demo-model",
    sourceLanguage: "English",
    stopOnRateLimit: true,
    targetLanguage: "Chinese",
    translateBatch: async (options) => {
      const [block] = options.blocks;

      if (!block) {
        return [];
      }

      requestedBlockIds.push(block.blockId);
      throw new Error("HTTP 429 Too Many Requests");
    },
  });

  assert.equal(result.rateLimited, true);
  assert.deepEqual(requestedBlockIds, ["a"]);
  assert.deepEqual(
    result.failedBlocks.map((block) => block.blockId),
    ["a", "b", "c"],
  );
});

test('translateBlocksBestEffort keeps prior single-block results when a later request is rate limited', async () => {
  const requestedBlockIds: string[] = [];
  const progressSnapshots: Array<Record<string, string>> = [];
  const result = await translateBlocksBestEffort({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    batchSize: 1,
    blocks: [
      { blockId: 'a', text: 'Alpha' },
      { blockId: 'b', text: 'Beta' },
      { blockId: 'c', text: 'Gamma' },
    ],
    concurrency: 1,
    model: 'demo-model',
    onProgress: (progress) => {
      progressSnapshots.push({ ...progress.translations });
    },
    sourceLanguage: 'English',
    stopOnRateLimit: true,
    targetLanguage: 'Chinese',
    translateBatch: async (options) => {
      const [block] = options.blocks;
      if (!block) return [];
      requestedBlockIds.push(block.blockId);

      if (block.blockId === 'b') {
        throw Object.assign(new Error('Too Many Requests'), { status: 429 });
      }

      return [{ blockId: block.blockId, translatedText: `译文 ${block.text}` }];
    },
  });

  assert.equal(result.rateLimited, true);
  assert.deepEqual(requestedBlockIds, ['a', 'b']);
  assert.deepEqual(result.translations, { a: '译文 Alpha' });
  assert.deepEqual(progressSnapshots.at(-1), { a: '译文 Alpha' });
});

test('cooperative cancellation saves the in-flight response before stopping the next request', async () => {
  let cancelRequested = false;
  let resolveFirstRequest: (() => void) | null = null;
  const firstRequestStarted = new Promise<void>((resolve) => {
    resolveFirstRequest = resolve;
  });
  let finishFirstRequest: (() => void) | null = null;
  const allowFirstRequestToFinish = new Promise<void>((resolve) => {
    finishFirstRequest = resolve;
  });
  const requestedBlockIds: string[] = [];

  const resultPromise = translateBlocksBestEffort({
    apiKey: 'test-key',
    baseUrl: 'https://example.com',
    batchSize: 1,
    beforeBatch: () => !cancelRequested,
    blocks: [
      { blockId: 'a', text: 'Alpha' },
      { blockId: 'b', text: 'Beta' },
    ],
    concurrency: 1,
    model: 'demo-model',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translateBatch: async (options) => {
      const [block] = options.blocks;
      if (!block) return [];
      requestedBlockIds.push(block.blockId);
      resolveFirstRequest?.();
      await allowFirstRequestToFinish;
      return [{ blockId: block.blockId, translatedText: `译文 ${block.text}` }];
    },
  });

  await firstRequestStarted;
  cancelRequested = true;
  finishFirstRequest?.();
  const result = await resultPromise;

  assert.equal(result.cancelled, true);
  assert.deepEqual(requestedBlockIds, ['a']);
  assert.deepEqual(result.translations, { a: '译文 Alpha' });
});

test("translateBlocksBestEffort waits for the batch control before each request", async () => {
  let controlChecks = 0;
  const translatedBlockIds: string[] = [];
  const result = await translateBlocksBestEffort({
    apiKey: "test-key",
    baseUrl: "https://example.com",
    batchSize: 1,
    beforeBatch: async () => {
      controlChecks += 1;
      return false;
    },
    blocks: [
      { blockId: "a", text: "Alpha" },
      { blockId: "b", text: "Beta" },
    ],
    concurrency: 1,
    model: "demo-model",
    sourceLanguage: "English",
    targetLanguage: "Chinese",
    translateBatch: async (options) => {
      const [block] = options.blocks;
      if (block) translatedBlockIds.push(block.blockId);
      return block ? [{ blockId: block.blockId, translatedText: `译文 ${block.text}` }] : [];
    },
  });

  assert.equal(controlChecks, 1);
  assert.equal(result.cancelled, true);
  assert.deepEqual(translatedBlockIds, []);
});

test("sanitizeTranslationErrorMessage hides raw JSON parse details for selection translation", () => {
  const message = sanitizeTranslationErrorMessage(
    "Translation output was not valid JSON: EOF while parsing a value",
    l,
    "selection",
  );

  assert.equal(message.includes("EOF while parsing"), false);
  assert.equal(message.includes("可用"), true);
});
