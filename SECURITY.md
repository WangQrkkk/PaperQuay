# Security Policy

## Supported Versions

PaperQuay is in an early release stage. Security fixes are currently handled on the latest `main` branch and the latest published release.

## Reporting a Vulnerability

Please do not open a public issue for security-sensitive reports.

If you find a vulnerability, contact the maintainer privately through GitHub or the contact channel listed on the maintainer profile. Include:

- A clear description of the issue.
- Steps to reproduce the problem.
- Affected platform and PaperQuay version.
- Whether local files, API keys, PDF contents, model requests, or database records can be exposed or modified.
- Any suggested mitigation if you already investigated the root cause.

## Security Scope

The most important areas for PaperQuay are:

- Local file access and PDF import handling.
- API key storage and model endpoint configuration.
- Zotero database import and local SQLite data handling.
- Release artifacts and installer integrity.
- Agent tool calls that can modify paper metadata, tags, collections, or files.

## Local Data Notice

PaperQuay is local-first. Users should still avoid sharing API keys, local databases, private PDFs, MinerU output, backups, and application data directories in issues or pull requests.
