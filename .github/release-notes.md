# PaperQuay v{{VERSION}}

PaperQuay is an AI-assisted desktop application for literature management, PDF reading, paper overview generation, full-text translation, and research workflow automation.

## Downloads

Download the installer for your operating system from the Assets section below.

| Platform            | Recommended asset                                  |
| ------------------- | -------------------------------------------------- |
| Windows x64         | `.msi` installer                                   |
| macOS Apple Silicon | `aarch64.dmg` or Apple Silicon package             |
| macOS Intel         | `x64.dmg` or Intel package                         |
| Linux x64           | `.deb`, `.rpm`, or AppImage package when available |

## Highlights

- Independent local literature library with PDF import, configurable storage folders, custom collections, tags, search, sorting, favorites, and reading progress.
- Optional Zotero compatibility for importing existing collections, tags, metadata, and local PDF attachments into PaperQuay's own library.
- Built-in PDF reading workflow with MinerU structured parsing, block-linked navigation, full-text translation, notes, and AI-generated paper overviews.
- Dedicated Agent workspace with chat history, execution traces, tool-call cards, and batch library operations such as metadata completion, tagging, classification, and renaming.
- Configurable OpenAI-compatible models for translation, overview generation, Q&A, and agent tasks, plus packaged desktop builds for Windows, macOS, and Linux.

## Included In This Release

- Redesigned desktop library and Agent workspace screenshots in the README.
- Safer Tauri security policy and sanitized MinerU HTML rendering path.
- Session-aware Agent chat flow so background replies stay attached to the correct conversation.
- Structured reading panel localization improvements for English and Chinese UI modes.
- Release pipeline support for a single draft release with multi-platform assets attached under one tag.

## Notes

- This is an early desktop release. Keep a backup of important papers and local data before large batch operations.
- AI features require your own compatible model endpoint and API key in Settings.
- MinerU parsing requires a MinerU API key unless you are using already parsed local cache data.
