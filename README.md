<p align="center">
  <a href="./README.zh-CN.md">Chinese README</a>
</p>

<h1 align="center">PaperQuay</h1>

<p align="center">
  A desktop-first workspace for reading, translating, annotating, and questioning research papers.
</p>

<p align="center">
  PaperQuay keeps the original PDF, MinerU structure, notes, annotations, and AI workflows in one native Tauri window instead of scattering them across browser tabs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-111827?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Rust-Host%20Bridge-7c2d12?style=flat-square" alt="Rust host bridge">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

## Why PaperQuay

PaperQuay is built around a simple rule: geometry beats guesswork.

The left side renders the real PDF. The right side renders MinerU blocks. Hover a region on the page and the corresponding structure block wakes up immediately. Click a block on the right and the reader jumps back to the exact PDF bbox. Summaries, translation, notes, screenshots, QA, and annotation history all sit around that loop instead of living in separate tools.

This is not a browser-first demo wrapped in a desktop shell later. File dialogs, cache paths, local PDF access, MinerU parse results, screenshot capture, and desktop window behavior are part of the design from the start.

## What It Does Today

- Reads local PDFs and Zotero-backed papers inside a split-pane desktop reader.
- Links PDF overlays to MinerU blocks through `blockId + pageIndex + bbox`.
- Generates paper overviews, translates full documents and selected excerpts, and runs document QA with configurable OpenAI-compatible models.
- Stores per-paper chat history, notes, annotations, and parse caches so a reading session can be resumed instead of restarted.
- Provides PDF annotation workflows without forcing edits onto the original source file.

## Stack

PaperQuay uses Tauri v2 for the desktop shell, React + TypeScript + Vite for the UI, Rust commands for host integration, `react-pdf` and `pdf.js` for rendering, and `react-markdown` with math support for structured paper content.

The repository is intentionally split between a desktop host layer and a research-reader frontend:

- `src/` contains the application UI, reader workflows, services, and state.
- `src-tauri/` contains the Rust bridge, file access commands, and Tauri configuration.
- MinerU parse output, summaries, translation caches, and workspace history are treated as first-class desktop data rather than temporary browser state.

## Run Locally

```bash
npm install
npm run tauri:dev
```

To verify the frontend bundle and Rust host separately:

```bash
npm run build
cargo check
```

## Design References

PaperQuay is its own product, but several open-source projects informed the current direction:

- [`zotero/zotero`](https://github.com/zotero/zotero) for research-library workflow expectations.
- [`mozilla/pdf.js`](https://github.com/mozilla/pdf.js) for PDF-native rendering and annotation behavior.
- [`agentcooper/react-pdf-highlighter`](https://github.com/agentcooper/react-pdf-highlighter) for external highlight and comment overlay ideas.
- [`Laomai-codefee/pdfjs-annotation-extension`](https://github.com/Laomai-codefee/pdfjs-annotation-extension-for-react) for annotation ergonomics around the PDF.js ecosystem.

## License

PaperQuay Community Edition is released under `AGPL-3.0-only`.

That means modified versions that are redistributed, or offered to users over a network, need to keep the license and copyright notices, mark that changes were made, and provide the corresponding source code under AGPL terms. AGPL does not ban commercial activity by itself, but it does prevent taking the community edition private while continuing to use or ship modified versions.

If you want a closed-source commercial license, permission to use the `PaperQuay` name or branding, or commercial support, contact the maintainer for a separate agreement. See [TRADEMARKS.md](./TRADEMARKS.md) for the brand-use note.

## Status

PaperQuay is already usable as a serious desktop paper-reading workspace, and it is still being refined. The current focus is making the reading loop sharper: cleaner bilingual UI, tighter PDF-to-block linkage, better annotation flow, and more deliberate research-grade prompting.
