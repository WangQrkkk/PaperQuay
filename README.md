<h1 align="center">PaperQuay</h1>

<p align="center">
  English | <a href="./README.zh-CN.md">Chinese</a>
</p>

<p align="center">
  <strong>A desktop-first literature manager for PDF reading, translation, paper overviews, rich notes, and AI agent workflows.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.8-2563eb?style=flat-square" alt="Version v0.1.8">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4b5563?style=flat-square" alt="Windows macOS Linux">
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-0f766e?style=flat-square" alt="React TypeScript">
  <img src="https://img.shields.io/badge/storage-local%20SQLite-111827?style=flat-square" alt="Local SQLite storage">
  <img src="https://img.shields.io/badge/editor-Tiptap-0d9488?style=flat-square" alt="Tiptap editor">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

<p align="center">
  <a href="#quick-navigation">Quick Navigation</a> |
  <a href="#paperquay---ai-assisted-literature-management-that-keeps-reading-flow-intact">Why PaperQuay</a> |
  <a href="#current-features">Features</a> |
  <a href="#first-run-workflow">Quick Start</a> |
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## Quick Navigation

<p>
  <a href="#paperquay---ai-assisted-literature-management-that-keeps-reading-flow-intact">Problem & Positioning</a> |
  <a href="#what-makes-paperquay-different">What Makes It Different</a> |
  <a href="#core-workflow">Core Workflow</a> |
  <a href="#current-features">Current Features</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#zotero-compatibility">Zotero Compatibility</a> |
  <a href="#roadmap">Roadmap</a>
</p>

---

## PaperQuay - AI-Assisted Literature Management That Keeps Reading Flow Intact

**PaperQuay is more than a PDF reader or a Zotero add-on.** It is a local-first desktop literature manager designed for students, researchers, and paper writers who want to manage papers, read PDFs, annotate, translate, take notes, screen papers quickly, and use AI agents without leaving the same workspace.

Many paper tools force the user to choose between fragmented workflows: one app for PDF reading, another tool for translation, another chat window for paper summaries, another note app, and another library manager for metadata. PaperQuay combines these into a single desktop workflow while keeping Zotero compatibility optional rather than mandatory.

| Research workflow problem                 | Traditional tools                                                  | PaperQuay                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Translation latency interrupts reading    | Translate only after selecting text, often with visible API delay  | Pre-translate MinerU structural blocks and jump instantly to cached translations           |
| Side-by-side translation hurts focus      | Two columns require constant eye movement and can break formatting | Keep the original PDF visible while navigating to precise translated blocks on demand      |
| Pure translated files lose source context | Original wording, terminology, and academic expression are hidden  | Keep source text, parsed blocks, translation, notes, and overview linked together          |
| Paper notes become detached               | Notes live in a separate app and lose PDF position context         | Store rich notes, tags, links, paper references, and backlinks in the local library        |
| Fast paper screening is repetitive        | Upload PDFs to an LLM one by one and manually organize outputs     | Generate and store structured paper overviews inside the local library                     |
| AI model choices are locked down          | Built-in models or platform-specific token pricing                 | Bring your own OpenAI-compatible endpoint, model, and runtime parameters                   |
| Large libraries are hard to clean         | Manual renaming, tagging, metadata fixes, and classification       | Agent tools can assist with batch rename, metadata completion, tagging, and classification |
| Zotero migration is inconvenient          | Either stay locked in Zotero or rebuild everything manually        | Import Zotero collections, tags, and PDF attachments as an optional source                 |

---

## What Makes PaperQuay Different

<p align="center">
  <img src="./docs/assets/show.gif" alt="PaperQuay workflow demo" width="1200">
</p>

<p align="center">
  <em>Live workflow demo: browse the library, open papers, inspect structured reading, and move into the Agent workspace without leaving the same desktop flow.</em>
</p>

### Instant Block-Level Translation

PaperQuay uses a translation workflow designed for long paper reading sessions. It can translate and cache MinerU-parsed structural blocks in advance. Later, when reading, clicking a source block can instantly jump to its translated counterpart. Translation no longer needs to happen only after each click or selection.

### Tiptap-Based Notes Workspace

PaperQuay includes a dedicated Notes workspace built on Tiptap. Notes are stored locally with Tiptap JSON, rendered HTML, plain text for search, tags, wiki-style `[[note]]` links, `@paper` references, and backlinks. The editor is designed to keep research notes connected with papers instead of becoming a separate note silo.

### Fast Paper Screening from the Overview Panel

PaperQuay is designed not only for deep reading, but also for screening large numbers of papers quickly. In the overview panel, each paper can directly surface AI-generated fields such as background, research question, method, experiment setup, key findings, conclusions, and limitations.

### Reading Time Visibility

PaperQuay records time spent across PDF positions and surfaces it as reading heat previews in the library and a dedicated reading-time chart in the paper detail panel. This makes it easier to see which parts of a paper have actually received attention.

### Literature Library, Not Just Import

PaperQuay can build an independent local library with PDF import, a configurable storage folder, categories, tags, metadata editing, search, filtering, notes, and local SQLite persistence. Zotero remains supported as an optional import source, not a required dependency.

### Agent Operations for Paper Management

The agent workspace is designed for library operations, not just conversation. It can assist with batch renaming, metadata completion, smart tagging, tag cleanup, automatic classification, and paper summarization while exposing tool calls and results for user review.

---

## Core Workflow

| Step                   | What happens                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 1. Import PDFs         | Drag PDFs into the app or choose files from the import dialog.                        |
| 2. Confirm metadata    | Review title, authors, year, venue, DOI, abstract, keywords, and duplicate warnings.  |
| 3. Organize library    | Create categories, drag papers into collections, add tags, and mark favorites.        |
| 4. Parse with MinerU   | Convert PDFs into structured blocks with page-region linkage.                         |
| 5. Generate overviews  | Produce reusable paper overviews for fast screening and later review.                 |
| 6. Translate full text | Cache translated blocks so reading can jump instantly between source and translation. |
| 7. Read and annotate   | Highlight, write, add notes, jump to annotations, and export annotated PDFs.          |
| 8. Review reading time | Inspect reading-time charts and heat previews to see which parts of the PDF were read. |
| 9. Write notes         | Create rich Tiptap notes, link notes with `[[title]]`, add `#tags`, and reference papers. |
| 10. Use the agent      | Ask the agent to rename, classify, tag, clean metadata, or summarize selected papers. |

---

## PaperQuay Screenshots

<p align="center">
  <img src="./docs/assets/main.png" alt="PaperQuay literature library workspace" width="1200">
</p>

<p align="center">
  <em>Main library workspace: manage papers, categories, metadata, reading progress, notes, and AI-generated overviews in one desktop view.</em>
</p>

<p align="center">
  <img src="./docs/assets/agent.png" alt="PaperQuay agent workspace" width="1200">
</p>

<p align="center">
  <em>Agent workspace: chat with the paper assistant, inspect execution traces, review tool calls, and run batch library operations with human confirmation.</em>
</p>

---

## Current Features

| Area            | Available now                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Local library   | Local SQLite storage for papers, authors, categories, tags, attachments, notes, annotations, import records, and RAG indexes          |
| PDF import      | File picker and drag-and-drop import with confirmation before files enter the library                                                |
| File management | Configurable storage folder, copy / move / keep-path import modes, naming rules, and original-path tracking                          |
| Metadata        | OpenAlex enrichment by DOI or title, optional OpenAlex API key / mailto settings, Crossref fallback, and manual editing before import |
| Categories      | System categories, custom categories, nested subcategories, collapsible branches, context menus, drag sorting, and hierarchy changes |
| Paper details   | Title, authors, year, venue, DOI, URL, abstract, keywords, tags, notes, citation, favorite state, and a reading-time chart           |
| Notes workspace | Tiptap rich-text editor, local autosave, full-text search, tags, wiki links, paper references, outline, and backlinks                |
| Reader          | PDF reader with MinerU structured block views, region-based linkage, reading heat progress, and reading-time recording              |
| Translation     | Full-text translation, cached block translations, and selection translation through OpenAI-compatible models                         |
| Paper overview  | AI-generated screening fields for background, research questions, methods, experiment setup, findings, conclusions, and limitations  |
| Agent workspace | Conversation UI with execution traces, tool call cards, paper selection, metadata tools, rename tools, tagging, and classification   |
| Zotero import   | Import local Zotero collections, tags, and available PDF attachments from `zotero.sqlite`                                            |
| Themes          | Light and dark UI modes optimized for long desktop reading sessions                                                                  |

---

## First-Run Workflow

1. Open Settings and choose a default paper storage folder.
2. Import PDFs by drag and drop or by clicking the import button.
3. Confirm or edit metadata in the import confirmation dialog.
4. Let PaperQuay copy PDFs into its storage folder and save records in the local library.
5. Create categories and subcategories from the left sidebar.
6. Drag papers into categories, add tags, mark favorites, and open papers in the reader.
7. Open Notes to create rich-text notes, link related ideas, and connect notes to papers.
8. Configure an OpenAI-compatible endpoint and model if you want AI features.
9. Configure a MinerU API key if you want MinerU parsing.
10. Optionally connect a Zotero data directory and import existing Zotero collections and PDFs.

---

## Architecture

PaperQuay uses Electron as its desktop host. The React renderer talks to a local Electron backend through IPC for filesystem access, persistence, Zotero import, PDF handling, and packaging.

| Path                       | Responsibility                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/`                     | React + TypeScript UI, feature modules, state, and frontend services                                              |
| `src/features/literature/` | Local literature library UI, import workflow, category tree, and paper details                                    |
| `src/features/reader/`     | Reader shell, linked reading workspace, settings, onboarding, and AI reading actions                              |
| `src/features/pdf/`        | PDF rendering, overlays, annotation surface, and PDF-specific interactions                                        |
| `src/features/blocks/`     | MinerU block rendering and structured content views                                                               |
| `src/features/agent/`      | Agent chat UI, execution traces, tool cards, and library operation entry points                                   |
| `src/features/notes/`      | Tiptap-based notes workspace, editor toolbar, custom autocomplete extensions, outline, and backlinks              |
| `src/stores/useNotesStore.ts` | Zustand state for notes, tags, active note selection, autosave, and workspace errors                           |
| `src/services/`            | Frontend bridges to Electron IPC commands                                                                         |
| `src/platform/electron/`   | Renderer-side bridge wrappers for commands, events, window controls, and file-drop events                         |
| `electron/`                | Electron main process, preload bridge, command backend, packaging helpers, and local persistence                   |

The Notes editor uses the official Tiptap packages and was implemented against the upstream source at [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap). The local `WikiLink`, `HashTag`, and `PaperReference` extensions follow the same architecture as Tiptap's official `Mention` node and `@tiptap/suggestion` plugin: a Tiptap inline node stores structured attributes, and the Suggestion plugin handles matching, rendering, keyboard navigation, and insertion. The editor also follows Tiptap's React NodeView examples for component blocks: custom blocks are real Tiptap nodes rendered through `ReactNodeViewRenderer`, with `NodeViewWrapper` and `NodeViewContent` separating non-editable controls from editable content.

---

## Requirements

- Node.js 18 or newer
- Windows, macOS, or Linux

Optional external services:

- MinerU API key for cloud PDF structure parsing.
- OpenAI-compatible API key for paper overviews, translation, QA, and agent tasks.
- Internet access for OpenAlex and Crossref metadata enrichment.
- Optional OpenAlex premium API key and `mailto` polite-pool email for steadier batch metadata lookup.

---

## Development

Install dependencies:

```bash
npm install
```

Start the desktop app in development mode:

```bash
npm run dev
```

Build the frontend only:

```bash
npm run build
```

Preview the built web assets:

```bash
npm run preview
```

Build the desktop installer:

```bash
npm run electron:build
```

---

## Zotero Compatibility

PaperQuay can read a local Zotero data directory that contains `zotero.sqlite`. During import it copies the Zotero database to a temporary read-only working file and does not modify your original Zotero database.

Imported data enters PaperQuay's own local literature library. Zotero collections become local categories, and available local PDFs inside those collections are copied into the PaperQuay paper storage folder.

Zotero is an optional compatibility source, not a required dependency. You can build a complete library directly inside PaperQuay without using Zotero.

---

## Data and Privacy

PaperQuay is local-first. The literature library, notes, and local RAG indexes are stored in SQLite databases, and imported PDFs are stored in the paper storage folder you configure.

Do not commit local data, API keys, PDFs, parser outputs, notes databases, or backups. The `.gitignore` excludes common local runtime folders, SQLite databases, legacy JSON library data, API key files, build output, backup archives, and private PDFs by default.

---

## Roadmap

- Better metadata extraction from PDF first pages.
- DOI / arXiv / Semantic Scholar enrichment options.
- Deeper PDF annotation and note binding.
- Citation style generation.
- Database backup and restore UI.
- Folder watching for automatic import queues.
- RAG-based knowledge-base QA.
- One-click survey generation and Word / LaTeX research draft generation.
- Optional cloud sync after the local-first model is stable.

---

## Acknowledgements

PaperQuay is also shaped by discussions, feedback, and shared ideas from the [LinuxDo community](https://linux.do/).

The Notes workspace builds on [Tiptap](https://github.com/ueberdosis/tiptap). Thanks to the Tiptap maintainers for the extensible editor framework and examples that help power PaperQuay's note-taking experience.

---

## License

PaperQuay Community Edition is licensed under `AGPL-3.0-only`.

If you distribute modified versions or provide modified versions over a network, keep the license and copyright notices, mark your changes, and provide the corresponding source code under AGPL terms. For closed-source commercial licensing, commercial support, or brand-name permission, contact the maintainer separately. See [TRADEMARKS.md](./TRADEMARKS.md) for brand-use notes.
