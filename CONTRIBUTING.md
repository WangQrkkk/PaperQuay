# Contributing to PaperQuay

Thank you for your interest in improving PaperQuay. This project is an early desktop application, so small, focused contributions are easier to review and safer for users.

## Good First Contributions

- Fix UI text, layout issues, dark mode contrast, or English/Chinese localization.
- Improve README, release notes, setup instructions, or troubleshooting notes.
- Add tests or small bug fixes around import, metadata parsing, Zotero compatibility, PDF reading, translation, or Agent workflows.
- Report reproducible bugs with clear steps, screenshots, logs, and platform information.

## Development Setup

Install dependencies:

```bash
npm install
```

Run the desktop app in development mode:

```bash
npm run tauri:dev
```

Run frontend checks:

```bash
npm run build
```

Run Rust checks:

```bash
cd src-tauri
cargo check
```

## Pull Request Guidelines

- Keep pull requests focused on one problem or feature.
- Prefer clear module boundaries and readable code over large mixed refactors.
- Do not commit local data, API keys, PDFs, database files, parser output, build artifacts, or backups.
- Update documentation when behavior, settings, release workflow, or user-facing text changes.
- For UI changes, include screenshots or short screen recordings when possible.
- For bug fixes, describe the root cause and how you verified the fix.

## Licensing

By contributing to PaperQuay, you agree that your contributions are provided under the same license as this repository: `AGPL-3.0-only`.

PaperQuay trademarks and branding are not automatically licensed for unrestricted reuse. See [TRADEMARKS.md](./TRADEMARKS.md).
