<h1 align="center">PaperQuay</h1>

<p align="center">
  English | <a href="./README.zh-CN.md">中文</a>
</p>

<p align="center">
  A desktop-first, AI-assisted literature manager and research paper reader.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-111827?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/SQLite-Local%20Library-0f766e?style=flat-square" alt="SQLite local library">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

## What PaperQuay Solves

PaperQuay is built around a simple idea: reading papers should not be constantly interrupted by translation latency, repeated PDF uploads, broken formatting, tool switching, or expensive model usage. It brings literature management, PDF reading, annotations, notes, full-text translation, paper overviews, and agent-assisted library operations into one local desktop application.

### Pain Points in Existing Research Tools

Traditional selection-based translation tools often interrupt the reading flow when API responses are slow. When reading a paper, the user may only want to understand one sentence or one paragraph, but waiting several seconds for each translation is enough to break concentration. For long English paper reading sessions, this friction accumulates quickly.

Side-by-side translation is not always ideal either. A left-English, right-Chinese layout looks intuitive, but it is difficult to keep the formatting perfectly aligned, especially for papers with formulas, tables, multi-column layouts, captions, and dense references. Repeatedly scanning between two columns can also reduce focus over time.

Reading only a fully translated Chinese document has another limitation. Paper reading is not just about understanding meaning; it is also about learning the author's original wording, terminology, formatting, and academic writing style. If the English source is completely removed from the reading process, that context is easily lost.

Fast screening across many papers is also cumbersome. A common workflow is to upload PDFs to GPT or another large language model and ask for summaries. This works for a few papers, but it becomes inefficient when the number of papers grows. The upload, copy, and organization steps are repetitive, and it is hard to build a stable workflow if the user only cares about specific sections such as experiments, methods, findings, or limitations.

Performance matters as well. Some PDF and literature tools consume significant memory after many PDFs are opened, causing fans to spin and making long reading sessions uncomfortable. PaperQuay aims to stay lightweight for desktop use.

Finally, many AI paper tools do not allow flexible model configuration. Users are often locked into built-in models or platform-specific token pricing. PaperQuay supports OpenAI-compatible endpoints, so users can connect their preferred API provider, community-compatible endpoints, self-hosted services, or local model gateways.

### AI and Agent Workflows

AI-assisted paper reading is becoming more than a chat box attached to a PDF. Users may want AI to help with batch renaming, metadata completion, smart tagging, tag cleanup, automatic classification, paper screening, comparison, and review writing. PaperQuay's agent direction is to understand the local literature library structure and interact with application tools after user confirmation.

## About PaperQuay

PaperQuay uses a translation workflow designed for paper reading. Instead of translating only after each click or selection, it can translate and cache MinerU-parsed structural blocks in advance. Later, when reading, clicking a source block can instantly jump to its translated counterpart. This keeps the original English paper available while making the translated explanation immediately accessible.

With MinerU, PaperQuay can parse PDFs into structured blocks such as paragraphs, headings, lists, formulas, tables, and page regions. The app links PDF regions and structured text through `blockId + pageIndex + bbox`, enabling navigation between the original PDF, parsed blocks, translations, and overview results.

PaperQuay also includes common reading and annotation capabilities: highlights, inserted text, handwriting annotations, annotation navigation, and exporting annotated PDFs. Selected text can be inserted into notes directly, reducing copy-paste and window switching.

For literature management, PaperQuay is no longer just a Zotero companion. It can build an independent local library with PDF import, a configurable storage folder, categories, tags, metadata editing, search, filtering, and SQLite-based local persistence. Zotero remains supported, but only as an optional import source.

## Why PaperQuay Is Useful

1. **Instant translation jump**: after parsing and translation are prepared, clicking original content can jump to its translated block immediately. Traditional selection translation is still available.
2. **Annotation and note navigation**: selected text can be added to notes, and annotations can jump back to the corresponding paper region.
3. **Fast paper screening**: the library detail pane can show background, research questions, methods, experiment setup, findings, conclusions, and limitations for quick triage.
4. **Custom AI models**: OpenAI-compatible API settings allow users to choose their own endpoint, model, temperature, and reasoning configuration. MinerU can be configured separately for PDF structure parsing.
5. **Agent capabilities**: the agent can assist with large-library operations such as batch renaming, metadata completion, smart tagging, tag cleanup, automatic classification, and paper summarization.
6. **Lightweight desktop experience**: the app is designed for long reading sessions and low overhead. Actual resource usage depends on device, document size, and workload.
7. **Zotero compatibility**: existing Zotero users can import collections, tags, and PDF attachments by selecting or auto-detecting the Zotero data directory.
8. **Future expansion**: planned directions include RAG-based knowledge-base QA, one-click survey generation, Word / LaTeX draft generation, citation generation, and more complete research writing workflows.

## Current Features

- Local SQLite literature library with papers, authors, categories, tags, attachments, notes, annotations, and import records.
- PDF import by file picker or drag and drop, with an import confirmation dialog before files enter the library.
- Configurable local paper storage folder, copy / move / keep-path import modes, file naming rules, and original-path tracking.
- Zotero local import: auto-detect or select the Zotero data directory, read `zotero.sqlite`, import Zotero collections as PaperQuay categories, and copy available Zotero PDF attachments into the PaperQuay library.
- Automatic metadata enrichment through Crossref by DOI or title during PDF import, with manual editing still available before confirmation.
- Category tree with system categories, custom categories, nested subcategories, collapsible branches, right-click context menus, drag-based sorting, and hierarchy changes.
- Paper detail editing for title, authors, year, venue, DOI, URL, abstract, keywords, tags, notes, citation, and favorite state.
- PDF reader with MinerU structured block views and region-based linkage between PDF areas and structured text.
- AI-assisted reading workflows for paper overviews, full-text translation, selection translation, document QA, and agent tasks through configurable OpenAI-compatible models.
- Light and dark UI modes optimized for long desktop reading sessions.

## Architecture

PaperQuay is desktop-first, not a browser demo wrapped at the end.

- `src/` contains the React + TypeScript UI, feature modules, state, and frontend services.
- `src/features/literature/` contains the local literature library UI, import workflow, category tree, and paper details.
- `src/features/reader/`, `src/features/pdf/`, and `src/features/blocks/` contain the PDF reader, PDF overlays, MinerU block views, and linked reading workspace.
- `src/features/agent/` contains the agent chat UI, execution traces, tool call visualization, and literature-library operation entry points.
- `src/services/` contains frontend bridges to Tauri commands.
- `src-tauri/src/commands/` contains Rust host commands for file access, SQLite library storage, Zotero import, MinerU, metadata lookup, translation, paper overview generation, and QA.
- `src-tauri/` contains the Tauri v2 application configuration, icons, installer assets, and Rust crate.

## Requirements

- Node.js 18 or newer
- Rust stable toolchain
- Platform requirements for Tauri v2 on your OS
- Windows, macOS, or Linux

Optional external services:

- MinerU API key for cloud PDF structure parsing.
- OpenAI-compatible API key for paper overviews, translation, QA, and agent tasks.
- Internet access for Crossref metadata enrichment.

## Development

Install dependencies:

```bash
npm install
```

Start the desktop app in development mode:

```bash
npm run tauri:dev
```

Build the frontend only:

```bash
npm run build
```

Check the Rust host:

```bash
cd src-tauri
cargo check
```

Build the desktop installer:

```bash
npm run tauri:build
```

## First-Run Workflow

1. Open Settings and choose a default paper storage folder.
2. Import PDFs by drag and drop or by clicking the import button.
3. Confirm or edit metadata in the import confirmation dialog.
4. Let PaperQuay copy PDFs into its storage folder and save records in the local SQLite library.
5. Create categories and subcategories from the left sidebar.
6. Drag papers into categories, add tags, mark favorites, and open papers in the reader.
7. Configure an OpenAI-compatible endpoint and model if you want AI features.
8. Configure a MinerU API key if you want MinerU parsing.
9. Optionally connect a Zotero data directory and import existing Zotero collections and PDFs.

## Zotero Compatibility

PaperQuay can read a local Zotero data directory that contains `zotero.sqlite`. During import it copies the Zotero database to a temporary read-only working file and does not modify your original Zotero database.

Imported data enters PaperQuay's own local literature library. Zotero collections become local categories, and available local PDFs inside those collections are copied into the PaperQuay paper storage folder.

Zotero is an optional compatibility source, not a required dependency. You can build a complete library directly inside PaperQuay without using Zotero.

## Data and Privacy

PaperQuay is local-first. The literature database is stored as SQLite, and imported PDFs are stored in the paper storage folder you configure.

Do not commit local data, API keys, PDFs, parser outputs, or backups. The `.gitignore` excludes common local runtime folders, SQLite databases, API key files, build output, backup archives, and private PDFs by default.

## Project Status

This is the first public-ready version. The core local library, PDF import, category management, Zotero import, metadata enrichment, PDF reading, MinerU linkage, paper overviews, full-text translation, and agent-assisted library management are usable.

Planned next steps:

- Better metadata extraction from PDF first pages.
- DOI / arXiv / Semantic Scholar enrichment options.
- More advanced PDF annotations and export.
- Citation style generation.
- Database backup and restore UI.
- Folder watching for automatic import queues.
- RAG-based knowledge-base QA.
- One-click survey generation and Word / LaTeX research draft generation.
- Optional cloud sync after the local-first model is stable.

## License

PaperQuay Community Edition is licensed under `AGPL-3.0-only`.

If you distribute modified versions or provide modified versions over a network, keep the license and copyright notices, mark your changes, and provide the corresponding source code under AGPL terms. For closed-source commercial licensing, commercial support, or brand-name permission, contact the maintainer separately. See [TRADEMARKS.md](./TRADEMARKS.md) for brand-use notes.
