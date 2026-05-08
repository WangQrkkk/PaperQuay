import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("sanitizeTranslationErrorMessage hides raw JSON parse details for selection translation", () => {
  const message = sanitizeTranslationErrorMessage(
    "Translation output was not valid JSON: EOF while parsing a value",
    l,
    "selection",
  );

  assert.equal(message.includes("EOF while parsing"), false);
  assert.equal(message.includes("可用"), true);
});
