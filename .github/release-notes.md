# PaperQuay v{{VERSION}}

PaperQuay is an AI-assisted desktop application for literature management, PDF reading, paper overview generation, full-text translation, notes, and research workflow automation.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- Major codebase refactor: PaperQuay has been reorganized around the new Electron desktop runtime, shared platform services, and cleaner feature modules.
- New Notes workspace with folder organization, note metadata, tags, backlinks, outline, context menus, and richer editor controls.
- Notes now support inline knowledge links, including wiki-style note links, paper references, hashtags, and note anchor links that can jump across related content.
- Added note-to-reader integration for PDF anchors, so notes can retain source context and jump back into linked reading locations.
- Improved the editor experience with slash commands, templates, component blocks, image paste/drop, math, tables, task lists, and a Notion-like block control surface.
- Refreshed Agent, Reader, Library, PDF, and shared UI flows as part of the refactor, with improved desktop integration and cleaner state handling.

## Included In This Release

- Migrated the desktop app from the old Tauri backend layout to an Electron-based runtime and build pipeline.
- Added the full notes feature set, including note storage services, the notes store, the notes workspace, rich Tiptap editor extensions, and note utility tests.
- Added inline navigation primitives for notes: note links, PDF anchor cards, paper references, hashtags, and backlink discovery.
- Added table insertion controls and fixed table cell editing so clicking a cell enters text editing instead of selecting multiple cells.
- Moved toolbar table selection into a fixed floating menu so it is not clipped or covered by the right sidebar.
- Expanded PDF reading UI with thumbnail navigation, page overlays, reading heatmaps, and viewer toolbar modules.
- Added desktop file, library, WebDAV, Zotero, note, and RAG backend command modules for the Electron runtime.
- Updated GitHub Actions for automated build checks and multi-platform release packaging.
- Improved ignore rules for local build output, runtime databases, package artifacts, credentials, and temporary files.

## Notes

- This release includes a broad internal refactor. If you maintain custom integrations, review paths and desktop backend assumptions before upgrading.
- AI features require your own compatible model endpoint and API key in Settings.
- MinerU parsing requires a MinerU API key unless you are using already parsed local cache data.
- Release assets are generated automatically by GitHub Actions after the `app-v{{VERSION}}` tag workflow finishes.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一款 AI 辅助的桌面端文献管理、PDF 阅读、论文概览生成、全文翻译、笔记和科研工作流自动化应用。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的原生安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | Electron 构建生成的 `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 版本亮点

- 进行了大规模代码重构：项目已围绕新的 Electron 桌面运行时、共享平台服务和更清晰的功能模块重新组织。
- 新增笔记工作区，支持文件夹组织、笔记元信息、标签、反向链接、大纲、右键菜单和更完整的编辑器控制。
- 笔记支持内联知识链接，包括 wiki 风格笔记链接、论文引用、标签和笔记定位链接，可以在相关内容之间快速跳转。
- 增加笔记与阅读器联动能力，笔记可以保留 PDF 来源定位，并跳回对应阅读位置。
- 改进编辑体验，支持斜杠菜单、模板、组件块、图片粘贴/拖放、数学公式、表格、任务列表和类似 Notion 的块控制。
- 在本次重构中同步刷新了 Agent、Reader、Library、PDF 和共享 UI 流程，改进桌面集成和状态管理。

## 本次版本包含

- 将桌面端从旧的 Tauri 后端布局迁移到 Electron 运行时和构建流水线。
- 新增完整笔记功能，包括笔记存储服务、笔记状态管理、笔记工作区、富文本编辑器扩展和相关工具测试。
- 新增笔记内联跳转能力：笔记链接、PDF 定位卡片、论文引用、标签和反向链接发现。
- 新增表格插入控件，并修复表格单元格编辑问题：点击单元格会进入文本编辑，而不是选中多个格子。
- 将工具栏表格选择器改为固定浮层，避免被右侧侧边栏遮挡或被编辑器容器裁剪。
- 扩展 PDF 阅读 UI，包括缩略图导航、页面覆盖层、阅读热力图和阅读器工具栏模块。
- 为 Electron 运行时新增桌面文件、文献库、WebDAV、Zotero、笔记和 RAG 后端命令模块。
- 更新 GitHub Actions，支持自动构建检查和多平台发布打包。
- 完善忽略规则，覆盖本地构建产物、运行时数据库、打包产物、凭据和临时文件。

## 备注

- 这个版本包含较大的内部重构。如果你维护自定义集成，请在升级前检查路径和桌面后端相关假设。
- AI 功能需要你在设置中自行配置兼容的大模型接口和 API Key。
- MinerU 解析需要有效的 MinerU API Key，除非你使用的是已经解析好的本地缓存数据。
- 推送 `app-v{{VERSION}}` 标签后，GitHub Actions 会自动生成本版本发布资产。
