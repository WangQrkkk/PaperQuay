import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

async function loadReaderShared() {
  const outdir = await mkdtemp(join(tmpdir(), "paperquay-reader-settings-test-"));
  const outfile = join(outdir, "readerShared.mjs");

  await build({
    bundle: true,
    entryPoints: ["src/features/reader/readerShared.ts"],
    format: "esm",
    outfile,
    platform: "node",
    sourcemap: false,
    write: true,
  });

  const module = await import(pathToFileURL(outfile).href);
  await rm(outdir, { recursive: true, force: true });
  return module as typeof import("../src/features/reader/readerShared.ts");
}

test("normalizeReaderSettings defaults review writing model preset", async () => {
  const { DEFAULT_SETTINGS, normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings();

  assert.equal(settings.reviewModelPresetId, DEFAULT_SETTINGS.reviewModelPresetId);
  assert.equal(settings.autoTranslateEnglishLibrary, false);
});

test("English-library auto translation remains opt-in", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();

  assert.equal(
    normalizeReaderSettings({ autoTranslateEnglishLibrary: true })
      .autoTranslateEnglishLibrary,
    true,
  );
  assert.equal(
    normalizeReaderSettings({ autoTranslateEnglishLibrary: false })
      .autoTranslateEnglishLibrary,
    false,
  );
});

test("normalizeReaderSettings migrates review writing model preset from overview preset", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings({
    reviewModelPresetId: "",
    summaryModelPresetId: "summary-model",
    agentModelPresetId: "agent-model",
  });

  assert.equal(settings.reviewModelPresetId, "summary-model");
});

test("normalizeReaderSettings falls back to agent preset for older configs without overview preset", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings({
    reviewModelPresetId: "",
    summaryModelPresetId: "",
    agentModelPresetId: "agent-model",
  });

  assert.equal(settings.reviewModelPresetId, "agent-model");
});

test("review writing runtime config is normalized independently", async () => {
  const {
    getModelRuntimeConfig,
    normalizeModelRuntimeConfigs,
    normalizeReaderSettings,
  } = await loadReaderShared();
  const modelRuntimeConfigs = normalizeModelRuntimeConfigs({
    summary: { temperature: 0.2, reasoningEffort: "low" },
    review: { temperature: 0.6, reasoningEffort: "high" },
  });
  const settings = normalizeReaderSettings({ modelRuntimeConfigs });

  assert.deepEqual(getModelRuntimeConfig(settings, "review"), {
    temperature: 0.6,
    reasoningEffort: "high",
  });
});
