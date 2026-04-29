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

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一款 AI 辅助的桌面端文献管理软件，支持文献库管理、PDF 阅读、论文概览生成、全文翻译以及科研工作流自动化。

## 下载说明

请在下方 Assets 区域选择与你操作系统对应的安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows x64 | `.msi` 安装包 |
| macOS Apple Silicon | `aarch64.dmg` 或 Apple Silicon 对应安装包 |
| macOS Intel | `x64.dmg` 或 Intel 对应安装包 |
| Linux x64 | `.deb`、`.rpm` 或可用的 AppImage 安装包 |

## 版本亮点

- 独立本地文献库，支持 PDF 导入、存储目录配置、自定义分类、标签、搜索、排序、收藏和阅读进度记录。
- 可选兼容 Zotero，可将已有的分类、标签、元数据和本地 PDF 附件导入到 PaperQuay 自己的文献库中。
- 内置 PDF 阅读工作流，支持 MinerU 结构化解析、块级联动定位、全文翻译、笔记以及 AI 生成论文概览。
- 独立 Agent 工作区，支持对话历史、执行轨迹、工具调用卡片，以及元数据补全、打标签、分类、重命名等批量文献操作。
- 可配置 OpenAI 兼容模型，用于翻译、概览生成、问答和 Agent 任务，并提供 Windows、macOS、Linux 三端桌面安装包。

## 本次版本包含

- README 中新增并完善了桌面文库界面与 Agent 工作区截图展示。
- 强化了 Tauri 安全策略，并改进了 MinerU HTML 渲染链路的安全处理。
- 改进 Agent 多会话上下文绑定，后台回复会继续归属到正确的对话。
- 完善结构化阅读面板在中英文界面下的本地化显示。
- 发布流程支持在同一个 tag 下汇总多个平台产物，只生成一个草稿 Release。

## 备注

- 当前仍属于较早期的桌面版本，执行大批量操作前建议先备份重要论文和本地数据。
- AI 功能需要你在设置中自行配置兼容的大模型接口和 API key。
- MinerU 解析需要有效的 MinerU API key，除非你使用的是已经解析好的本地缓存数据。
