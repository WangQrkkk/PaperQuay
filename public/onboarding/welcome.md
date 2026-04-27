# PaperQuay: A Desktop-First Environment for Structured Academic Reading

## Abstract

PaperQuay is a lightweight desktop paper reader designed for researchers, students, and knowledge workers who spend significant time reading academic PDFs. Instead of treating a paper as a flat document, PaperQuay treats it as a structured reading workspace. A paper can be connected to a local library, opened as a PDF, parsed into document blocks, translated at the block level, summarized by AI, and revisited later with its reading state preserved.

The main idea behind PaperQuay is simple: academic reading is not only about displaying pages. A good reading environment should help the reader move between the original PDF layout, extracted semantic content, translation, notes, and AI-assisted understanding. PaperQuay therefore combines a traditional PDF viewer with structured block extraction, linked navigation, local workspace management, and optional AI features.

## 1. Introduction

Academic papers are usually distributed as PDF files. The PDF format preserves visual layout very well, but it is not always ideal for deep reading. When a reader wants to understand a complex section, compare a figure with its explanation, translate a paragraph, or ask questions about the paper, a plain PDF viewer provides limited support. The reader often has to switch between several tools: a PDF viewer, a translation service, a note-taking application, a reference manager, and a chat-based AI assistant.

PaperQuay is designed to reduce this fragmentation. It provides a single desktop workspace where the original PDF remains visible while additional structured information is placed around it. The reader can start from a local Zotero library, open a paper, run MinerU parsing, inspect extracted blocks, translate content, generate summaries, and ask questions about the current paper. The application is desktop-first, which means local file paths, local cache, and local paper workspaces are treated as core parts of the design rather than as afterthoughts.

The goal is not to replace Zotero, nor to replace a professional annotation system. Instead, PaperQuay focuses on the reading moment: the period when a user has selected a paper and wants to understand it efficiently, accurately, and repeatedly.

## 2. Design Philosophy

PaperQuay follows a structured reading philosophy. A paper is not only a sequence of pages, and it is not only a plain text document. It is a combination of layout, content, figures, tables, equations, references, and visual relationships. When reading a paper, users often depend on both the original layout and the extracted text. Removing either side makes the experience weaker.

For this reason, PaperQuay keeps the original PDF as the visual source of truth. At the same time, it builds a structured representation of the paper through parsing. The structured representation can contain paragraphs, titles, lists, tables, captions, equations, and other block types. These blocks are connected back to the PDF through page indices and bounding boxes.

A simplified representation of a document block can be written as:

<div class="formula">B<sub>i</sub> = (id<sub>i</sub>, p<sub>i</sub>, t<sub>i</sub>, c<sub>i</sub>, r<sub>i</sub>)</div>

where <span class="math">id<sub>i</sub></span> is the block identifier, <span class="math">p<sub>i</sub></span> is the page index, <span class="math">t<sub>i</sub></span> is the block type, <span class="math">c<sub>i</sub></span> is the block content, and <span class="math">r<sub>i</sub></span> is the bounding box region on the PDF page. The bounding box can be represented as:

<div class="formula">r<sub>i</sub> = (x<sub>1</sub>, y<sub>1</sub>, x<sub>2</sub>, y<sub>2</sub>)</div>

This small piece of geometry is important. It allows PaperQuay to link a block of extracted content to the exact region of the original PDF page. As a result, linked reading can be based on document geometry instead of fragile text matching.

## 3. Library and Workspace Model

PaperQuay begins with the library. A first-time user is encouraged to open Settings and connect a local Zotero data folder. After the folder is connected, PaperQuay can display local library items, recent papers, collections, and available PDF attachments. Users can also add standalone PDFs when a paper is not managed by Zotero.

Each paper is treated as a workspace. A workspace may contain the original PDF path, parsed MinerU output, translation cache, AI summary, reading history, and other local state. This model is useful because academic reading is rarely completed in one session. A user may open a paper today, parse it, translate several sections, ask questions, and return to it a week later. PaperQuay is designed to make that return natural.

The relationship can be summarized as follows:

| Layer | Purpose | Example |
|---|---|---|
| Library | Find and select papers | Zotero collection, recent papers, standalone PDFs |
| Workspace | Store paper-specific state | PDF path, parsed blocks, summary, translations |
| Reader | Perform active reading | PDF view, block view, assistant, translation |
| Cache | Reuse generated results | MinerU JSON, translated blocks, AI summaries |

This structure allows PaperQuay to behave like a desktop research tool rather than a temporary browser page.

## 4. Structured Reading with MinerU

MinerU parsing is one of the core workflows in PaperQuay. When a PDF is parsed, the paper is converted into a collection of structured blocks. These blocks preserve their position on the PDF page, which makes them useful for linked navigation, block-level translation, and structured summarization.

A document can be described as a sequence of pages:

<div class="formula">D = { P<sub>1</sub>, P<sub>2</sub>, ..., P<sub>n</sub> }</div>

Each page contains a sequence of blocks:

<div class="formula">P<sub>j</sub> = { B<sub>j,1</sub>, B<sub>j,2</sub>, ..., B<sub>j,m</sub> }</div>

The reader does not need to understand these formulas to use the application. However, this model explains why PaperQuay can connect the PDF and the extracted text reliably. The connection is not based primarily on searching for matching strings. It is based on the page index and bounding box of each block.

In practice, this means that when the user clicks a structured paragraph on the right side, PaperQuay can jump to the corresponding page and highlight the matching region in the PDF. When the user interacts with a PDF region, the application can locate the corresponding block. This makes the reading experience feel closer to a mapped document than a simple text extraction.

## 5. Linked PDF and Block Reading

The linked reading view is the central reading experience in PaperQuay. The left side displays the original PDF. The right side displays structured blocks extracted from the same paper. The two sides are connected by block identifiers and geometric positions.

This design is especially useful for academic papers because readers often need to move between layout and text. A figure may be visually near its caption. A method section may refer to a table. An equation may depend on the paragraph immediately before it. A plain text extraction can lose these relationships, while a PDF-only view can make translation and AI workflows harder. PaperQuay keeps both views available.

A simple coordinate conversion is used when drawing PDF highlights. If a bounding box is defined in the original PDF coordinate system, and the page is rendered at a different size, PaperQuay maps the box into screen coordinates:

<div class="formula">left = x<sub>1</sub> ? scale<sub>x</sub></div>

<div class="formula">top = y<sub>1</sub> ? scale<sub>y</sub></div>

<div class="formula">width = (x<sub>2</sub> - x<sub>1</sub>) ? scale<sub>x</sub></div>

<div class="formula">height = (y<sub>2</sub> - y<sub>1</sub>) ? scale<sub>y</sub></div>

This conversion allows highlights to stay aligned with the rendered PDF page even when the page is scaled on screen.

## 6. Translation Workflows

PaperQuay supports two common translation workflows. The first is selection translation. When a user selects a small piece of text, the assistant can translate that selection without changing the rest of the reading context. This is useful when the reader only needs help with one sentence, one definition, or one difficult paragraph.

The second workflow is full-paper translation. After MinerU parsing is available, PaperQuay can translate the paper block by block. This approach is more structured than sending the whole paper as one long text. Each block keeps its relationship to the original document, and translated content can be displayed next to the corresponding source block.

A simplified translation mapping can be described as:

<div class="formula">T(B<sub>i</sub>) = B<sub>i</sub>?</div>

where <span class="math">B<sub>i</sub></span> is the original block and <span class="math">B<sub>i</sub>?</span> is the translated block. Because both blocks share the same logical identity, PaperQuay can keep the translation aligned with the original paper structure.

## 7. AI Summary and Question Answering

AI assistance in PaperQuay is designed to support reading rather than replace reading. A summary can help the user form an initial mental model of the paper. A question assistant can help clarify a concept, explain a paragraph, compare sections, or identify the role of a method or result.

The best use of AI in PaperQuay is interactive. A reader may first inspect the abstract and introduction, then generate a summary, then read the method section, then ask a targeted question about a formula or experimental setup. The assistant works best when the user treats it as a reading companion rather than an automatic judge of the paper.

For example, a user might ask:

> What problem is this paper trying to solve, and how is its method different from previous work?

Or, after selecting a paragraph:

> Explain this paragraph in simpler language and list the key assumptions.

These questions are most useful when connected to the current paper workspace.

## 8. Recommended Workflow for New Users

A new user should begin with the library rather than the reader. First, open Settings and connect the local Zotero folder. If Zotero is not available, add a standalone PDF. Then return to the Library and select one paper. It is better to start with one paper because the main features of PaperQuay are easiest to understand in a concrete reading session.

After opening a paper, check whether structured blocks are already available. If not, run MinerU Parse. Once blocks are available, switch to linked reading mode. Click a block on the right side and observe how the PDF moves to the corresponding location. Then click a PDF region and observe how the block view reacts. This interaction is the foundation of PaperQuay's reading model.

After linked reading is understood, try selection translation on a difficult sentence. Then try generating an AI summary. Finally, if the paper needs deeper multilingual reading, run full-paper translation and review the translated blocks alongside the original structure.

The recommended first session can be summarized as:

1. Connect a library.
2. Select one paper.
3. Open the reader.
4. Run MinerU Parse.
5. Read with linked PDF and blocks.
6. Translate selected text when needed.
7. Generate an AI summary.
8. Use Q&A for difficult sections.
9. Return later and continue from the same workspace.

## 9. Example Reading Scenario

Imagine a reader opening a machine learning paper. The abstract is understandable, but the method section contains a dense equation and several references to a figure. In a normal PDF viewer, the reader may scroll back and forth between the equation, the explanation, and the figure. If translation is needed, the reader may copy text into another tool. If a summary is needed, the reader may open a separate AI chat window.

In PaperQuay, the reader can keep the PDF visible while inspecting extracted blocks. The equation, surrounding paragraph, and figure caption can remain connected to their page locations. The reader can translate only the difficult paragraph, ask the assistant to explain the equation, and later generate a summary of the entire paper. The workflow stays inside one paper workspace.

This does not remove the need for careful reading. Instead, it reduces the mechanical cost of moving between tools. The reader can spend more attention on understanding the paper itself.

## 10. Limitations and Expectations

PaperQuay is a reading tool, not a guarantee that every paper will be parsed perfectly. PDF files vary widely in layout quality, embedded fonts, scanned images, mathematical notation, and table structure. MinerU parsing may work very well for some papers and less perfectly for others. AI summaries and translations may also contain mistakes, especially for highly technical or ambiguous content.

For serious academic work, the original PDF should remain the final reference. PaperQuay is designed to help the reader navigate, understand, translate, and organize the reading process. It should be used as an assistant to human judgment, not as a replacement for it.

## 11. Conclusion

PaperQuay combines a desktop paper library, a PDF reader, structured document parsing, linked navigation, translation, and AI-assisted reading into one environment. Its central idea is that academic reading benefits from structure. When a paper is represented as linked pages and blocks, the reader can move more easily between layout, text, translation, and explanation.

The best way to learn PaperQuay is to start with one paper. Connect a library, open the paper, parse it, and try the linked reading view. From there, translation, summaries, and Q&A become natural extensions of the same workspace.

PaperQuay is built for readers who return to papers, compare details, ask questions, and build understanding over time.
