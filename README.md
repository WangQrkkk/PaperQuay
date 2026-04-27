<p align="center">
  <a href="./README.zh-CN.md">Chinese README</a>
</p>

<h1 align="center">PaperQuay</h1>

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

## Overview

PaperQuay is a local desktop application for students, researchers, and paper writers who want one place to manage, read, annotate, translate, summarize, and question research papers.

The project started as a Zotero-oriented paper reader, but the current direction is broader: PaperQuay is becoming an independent literature management tool. Zotero remains supported as an optional import source, not as a required dependency. You can build a complete local library directly inside PaperQuay by importing PDFs, organizing them into categories, tagging them, reading them, and enriching their metadata.

## Current Features

- Local SQLite literature library with papers, authors, categories, tags, attachments, notes, annotations, and import records.
- PDF import by file picker or drag and drop, with import confirmation before files enter the library.
- Configurable local paper storage folder, copy / move / keep-path import modes, file naming rules, and original-path tracking.
- Zotero local import: select or auto-detect the Zotero data directory, read `zotero.sqlite`, import Zotero collections as PaperQuay categories, and copy Zotero PDF attachments into the PaperQuay library.
- Automatic metadata enrichment through Crossref by DOI or title during PDF import, with manual editing still available before confirmation.
- Category tree with system categories, custom categories, nested subcategories, drag-based hierarchy changes, right-click context menus, and collapsible branches.
- Paper detail editing for title, authors, year, venue, DOI, URL, abstract, keywords, tags, notes, citation, and favorite state.
- Split-pane PDF reader with MinerU block rendering and geometry-based linkage through `blockId + pageIndex + bbox`.
- AI-assisted reading workflows for summaries, translation, document QA, and paper overview generation through configurable OpenAI-compatible models.
- Dark and light UI modes optimized for desktop use.

## Architecture

PaperQuay is desktop-first, not a browser demo wrapped at the end.

- `src/` contains the React + TypeScript UI, feature modules, state, and frontend services.
- `src/features/literature/` contains the native literature library UI and import workflows.
- `src/features/reader/`, `src/features/pdf/`, and `src/features/blocks/` contain the PDF reader, PDF overlays, MinerU block views, and linked reading workspace.
- `src/services/` contains frontend bridges to Tauri commands.
- `src-tauri/src/commands/` contains Rust host commands for file access, SQLite library storage, Zotero import, MinerU, metadata lookup, translation, summaries, and QA.
- `src-tauri/` contains the Tauri v2 application configuration, icons, installer assets, and Rust crate.

## Requirements

- Node.js 18 or newer
- Rust stable toolchain
- Platform requirements for Tauri v2 on your OS
- Windows, macOS, or Linux

Optional external services:

- MinerU API key if you want cloud parsing.
- OpenAI-compatible API key if you want AI summary, translation, and QA.
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
7. Optionally connect a Zotero data directory and import existing Zotero collections and PDFs.

## Zotero Compatibility

PaperQuay can read a local Zotero data directory that contains `zotero.sqlite`. During import it copies the SQLite database to a temporary read-only working file, reads collections and PDF attachments, creates matching PaperQuay categories, and imports available local PDFs.

Zotero is treated as an import source. PaperQuay does not require Zotero to run, and it does not modify your Zotero database.

## Data and Privacy

PaperQuay is local-first. The literature database is stored in the application data directory as SQLite, and imported PDFs are stored in the paper storage folder you configure.

Do not commit local data, API keys, PDFs, parser outputs, or backups. The `.gitignore` excludes common local runtime folders, SQLite databases, API key files, build output, backup archives, and private PDFs by default.

## Project Status

This is the first public-ready version. The core local library, PDF import, category management, Zotero import, metadata enrichment, PDF reading, MinerU linkage, and AI reading workflows are usable, but some advanced literature-manager features are still planned.

Planned next steps:

- Better metadata extraction from PDF first pages.
- DOI / arXiv / Semantic Scholar enrichment options.
- More advanced PDF annotations and export.
- Citation style generation.
- Database backup and restore UI.
- Folder watching for automatic import queues.
- Optional cloud sync after the local-first model is stable.

## License

PaperQuay Community Edition is licensed under `AGPL-3.0-only`.

If you distribute modified versions or provide modified versions over a network, keep the license and copyright notices, mark your changes, and provide the corresponding source code under AGPL terms. For closed-source commercial licensing, commercial support, or brand-name permission, contact the maintainer separately. See [TRADEMARKS.md](./TRADEMARKS.md) for brand-use notes.
