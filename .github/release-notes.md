# PaperQuay v{{VERSION}}

PaperQuay is an open-source AI paper workspace for literature management, PDF reading, paper overview generation, full-text translation, inline notes, Zotero import, Agent workflows, and local RAG.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer or `.msi` package |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- Improved the PDF reading experience with lighter startup behavior, persistent reader tabs, and better handling for older PDFs and parsed paragraph interactions.
- Added Settings switches for selection-translation popovers and PDF paragraph translation popovers, so users can disable either interaction independently.
- Refined selection translation and PDF paragraph translation floating panels so they avoid covering the selected text or clicked paragraph.
- Improved Agent chat behavior, including more stable streaming scroll behavior, clearer plan-action buttons, and simpler paper-scope wording with “Select Papers” instead of internal feature names.
- Strengthened Agent paper-context handling so it can load paper text by ID and use MinerU parsed content or PDF text when a task requires full-paper context.
- Continued notes and reader workflow cleanup, including global sidebar note behavior and better interaction between note anchors, selection, and PDF translation actions.
- Updated macOS packaging to ad-hoc re-sign the app bundle after packaging, reducing broken-signature launch failures on unsigned builds.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- MinerU parsing requires a MinerU API key unless you are using already parsed local cache data.
- Release assets are generated automatically by GitHub Actions.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一款开源 AI 论文工作台，覆盖文献管理、PDF 阅读、论文概览生成、全文翻译、内联笔记、Zotero 导入、Agent 文献整理和本地 RAG 知识库能力。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的原生安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包或 `.msi` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | Electron 构建生成的 `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 版本亮点

- 优化 PDF 阅读体验，包括更轻的启动行为、论文阅读 tab 常驻，以及老旧 PDF 和解析段落交互的兼容处理。
- 在设置中新增划词翻译浮层和 PDF 段落译文浮层的独立开关，可以分别关闭。
- 优化划词翻译和 PDF 段落译文浮层位置，尽量避让当前选区或点击的段落。
- 优化 Agent 对话体验，包括流式回复滚动、计划操作按钮颜色，以及将文献范围入口改为更直观的“选择文献”。
- 强化 Agent 的论文上下文能力，可根据论文 ID 加载 MinerU 解析内容或 PDF 文本，用于全文分析、对比和总结。
- 继续整理笔记和阅读器工作流，包括全局侧栏笔记行为，以及笔记锚点、划词和 PDF 翻译之间的交互。
- 更新 macOS 打包流程，打包后自动进行 ad-hoc 重新签名，降低未签名构建出现损坏签名导致无法启动的问题。

## 备注

- AI 功能需要你在设置中自行配置兼容的大模型接口和 API Key。
- MinerU 解析需要有效的 MinerU API Key，除非你使用的是已经解析好的本地缓存数据。
- 发布资产由 GitHub Actions 自动生成。
