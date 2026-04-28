<h1 align="center">PaperQuay</h1>

<p align="center">
  <a href="./README.md">English</a> | 中文
</p>

<p align="center">
  一款桌面端优先、AI 辅助的文献管理与论文阅读软件。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-111827?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/SQLite-Local%20Library-0f766e?style=flat-square" alt="SQLite local library">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

## PaperQuay 主要解决的问题

PaperQuay 的出发点很简单：论文阅读不应该被翻译延迟、文献上传、格式错乱、工具切换和高额模型费用不断打断。它希望把文献管理、PDF 阅读、批注笔记、全文翻译、论文概览和 Agent 辅助管理放在一个本地桌面软件里，让用户可以更连续地阅读、理解和整理论文。

### 现有科研工具中的痛点

很多传统划词翻译工具在 API 响应较慢时会明显打断阅读心流。读论文时经常只是想快速理解一个句子或一段内容，但等待翻译返回的几秒钟足以让思路中断。对于需要长时间阅读英文论文的人来说，这种延迟会不断累积。

左右对照翻译也并不总是理想方案。左侧英文、右侧中文的形式看起来直观，但实际使用中很难做到版式完全稳定，尤其是公式、表格、分栏和图注较多的论文。同时，视线在左右两栏之间频繁来回移动，时间久了容易降低专注度。

纯中文翻译文件同样有局限。论文阅读不仅是理解意思，也是在学习作者的原文表达、术语使用、排版方式和论证结构。如果完全脱离英文原文，只读翻译后的中文内容，很容易丢失论文原本的写作习惯和学术表达。

大量论文的速读和初筛也很繁琐。现在常见做法是把 PDF 上传给 GPT 或其他大模型，让模型生成概述。但当文献数量变多时，反复上传、复制、整理结果会非常低效，也不方便集中管理。如果用户只关心论文中的实验部分、方法部分或结论部分，传统上传问答方式很难形成稳定的速读流程。

性能也是桌面论文工具中常见的问题。一些软件在打开大量 PDF 后内存占用很高，风扇持续转动，影响长时间阅读。PaperQuay 希望保持轻量化，在桌面端尽量降低资源占用。

此外，很多软件无法灵活配置大模型 API，只能使用内置模型或按平台规则消耗高价 token。PaperQuay 支持 OpenAI 兼容接口，用户可以接入自己常用的 API 服务、社区提供的兼容站点、自建服务或本地模型网关，降低长期使用成本。

### AI 与 Agent 需求

随着 Agent 工作流的发展，论文阅读已经不只是“打开 PDF 并做笔记”。用户可能希望 AI 帮助完成批量重命名、元数据补全、智能打标签、分类整理、论文速读、对比总结和后续综述写作。PaperQuay 的目标不是只做一个聊天框，而是让 Agent 能够理解文献库结构，并在用户确认后直接与软件功能交互。

## 关于 PaperQuay

PaperQuay 应用了一种更适合论文阅读的翻译范式：先对 MinerU 解析出的论文结构块进行全文翻译并缓存，之后阅读时点击原文块即可瞬间跳转到对应译文。翻译不再发生在用户每次点击或划词之后，而是可以提前完成，例如在空闲时间、挂机时或批量处理时完成。这样阅读时既能保留英文原文，又能快速查看对应中文解释。

借助 MinerU，PaperQuay 可以将 PDF 解析为段落、标题、列表、公式、表格等结构化内容，并尽量保留页面区域信息。软件通过 `blockId + pageIndex + bbox` 建立 PDF 页面区域和右侧结构化文本之间的关联，从而支持原文区域、结构块、翻译内容和概览结果之间的跳转。

PaperQuay 同时提供常见 PDF 阅读软件需要的批注和笔记能力，包括高亮、插入文字、手写标注、批注跳转和导出批注后的 PDF。用户也可以将划词内容直接加入笔记，减少复制粘贴和窗口切换。

在文献管理方面，PaperQuay 不再只是 Zotero 的附属工具。它可以独立建立本地文献库，支持导入 PDF、设置本地文献存储文件夹、创建分类与标签、编辑元数据、搜索筛选文献，并通过 SQLite 保存本地数据。Zotero 仍然兼容，但只是可选导入来源之一。

## PaperQuay 吸引人的点

1. **瞬间跳转翻译**：只要提前完成解析和翻译，阅读时点击原文内容即可快速跳转到对应译文，同时仍保留主流划词翻译能力。
2. **批注管理跳转**：支持将划词内容加入笔记，也支持点击批注后跳转到对应论文区域，方便回到上下文继续阅读。
3. **论文速读**：可以在文献库右侧快速查看背景、研究问题、方法、实验设置、主要发现、结论和局限等内容，适合文献初筛。
4. **自定义大模型**：支持配置 OpenAI 兼容 API，自行选择模型、接口地址、温度和思考程度等参数。MinerU API 可在 MinerU 官网申请，适合用于论文结构解析。
5. **Agent 能力**：Agent 可以辅助分析和管理大量论文，包括批量重命名、元数据补全、智能标签、标签清洗、自动分类和论文总结等任务，并逐步与软件内部工具联动。
6. **轻量化桌面体验**：在个人测试中，同时打开多篇论文和 Agent 界面时仍能保持较低资源占用。不同设备和数据规模下实际占用会有所差异。
7. **兼容 Zotero**：如果已有大量文献在 Zotero 中管理，可以在设置中自动检测或手动选择 Zotero 数据目录，并导入原有 collection 结构、标签和 PDF 附件。
8. **后续扩展空间**：计划加入 RAG 知识库问答、一键生成综述、Word / LaTeX 草稿生成、引用生成和更完整的研究写作工作流。

## 当前功能

- 本地 SQLite 文献库，保存论文、作者、分类、标签、附件、笔记、批注和导入记录。
- 支持拖拽 PDF 或通过文件选择器导入 PDF，并在入库前进入导入确认页面。
- 支持配置默认文献存储文件夹、复制 / 移动 / 保留原路径导入模式、文件命名规则和原始路径记录。
- 支持 Zotero 本地导入：自动检测或手动选择 Zotero 数据目录，读取 `zotero.sqlite`，将 Zotero collections 导入为 PaperQuay 分类，并复制可用 PDF 附件。
- 支持通过 DOI 或标题调用 Crossref 自动补全文献标题、作者、年份、期刊和 DOI，导入前仍可手动编辑。
- 左侧分类树支持系统分类、自定义分类、子分类、折叠展开、右键菜单、拖拽排序和层级调整。
- 文献详情支持编辑标题、作者、年份、期刊 / 会议、DOI、URL、摘要、关键词、标签、笔记、引用信息和收藏状态。
- PDF 阅读器支持 MinerU 结构块视图，并通过页面区域信息实现 PDF 区域与结构化文本联动。
- 支持通过 OpenAI 兼容模型进行论文概览、全文翻译、划词翻译、文档问答和 Agent 任务处理。
- 支持浅色和深色主题，面向桌面端长时间阅读场景优化。

## 技术架构

PaperQuay 是桌面应用优先，不是普通网页外面套一层壳。

- `src/`：React + TypeScript 前端界面、功能模块、状态和服务层。
- `src/features/literature/`：本地文献库、导入流程、分类树和文献详情。
- `src/features/reader/`、`src/features/pdf/`、`src/features/blocks/`：PDF 阅读、PDF 热区、MinerU 块视图和阅读工作区。
- `src/features/agent/`：Agent 对话界面、执行轨迹、工具调用展示和文献库操作入口。
- `src/services/`：前端到 Tauri commands 的调用封装。
- `src-tauri/src/commands/`：Rust 宿主命令，包括文件访问、SQLite 文献库、Zotero 导入、MinerU、元数据补全、翻译、概览和问答。
- `src-tauri/`：Tauri v2 配置、图标、安装包资源和 Rust crate。

## 环境要求

- Node.js 18 或更高版本
- Rust stable 工具链
- 当前操作系统对应的 Tauri v2 依赖
- Windows、macOS 或 Linux

可选外部服务：

- MinerU API key：用于云端 PDF 结构解析。
- OpenAI 兼容 API key：用于论文概览、翻译、问答和 Agent。
- 网络连接：用于 Crossref 元数据补全。

## 本地运行

安装依赖：

```bash
npm install
```

启动桌面开发模式：

```bash
npm run tauri:dev
```

只构建前端：

```bash
npm run build
```

检查 Rust 宿主：

```bash
cd src-tauri
cargo check
```

构建桌面安装包：

```bash
npm run tauri:build
```

## 第一次使用流程

1. 打开设置，选择默认文献存储文件夹。
2. 通过拖拽或导入按钮添加 PDF。
3. 在导入确认窗口中检查或修改元数据。
4. PaperQuay 会复制 PDF 到文献库存储文件夹，并写入本地 SQLite 数据库。
5. 在左侧创建分类和子分类。
6. 将文献拖入分类，添加标签，标记收藏，然后打开阅读。
7. 如需 AI 功能，在设置中配置 OpenAI 兼容接口和模型。
8. 如需 MinerU 解析，在设置中配置 MinerU API key。
9. 如果已有 Zotero 文库，可以在设置中选择 Zotero 数据目录并导入分类和 PDF。

## Zotero 兼容

PaperQuay 可以读取包含 `zotero.sqlite` 的 Zotero 本地数据目录。导入时会将 Zotero 数据库复制到临时只读文件中读取，不会修改 Zotero 原始数据库。

导入结果会进入 PaperQuay 自己的本地文献库。Zotero collections 会变成本地分类，分类下可访问的本地 PDF 会复制到 PaperQuay 的文献存储文件夹中。

Zotero 是 PaperQuay 的兼容来源之一，不是必要依赖。你可以完全不使用 Zotero，直接在 PaperQuay 中建立自己的文献库。

## 数据与隐私

PaperQuay 是本地优先。文献数据库保存为 SQLite，导入的 PDF 保存到你配置的文献存储文件夹中。

不要提交本地数据、API key、PDF、解析结果或备份文件。当前 `.gitignore` 已默认排除运行时目录、SQLite 数据库、API key 文件、构建产物、备份包和私人 PDF。

## 当前状态

这是第一版可发布版本。核心本地文献库、PDF 导入、分类管理、Zotero 导入、元数据补全、PDF 阅读、MinerU 联动、论文概览、全文翻译和 Agent 辅助管理已经可用。

后续计划：

- 从 PDF 首页提取更稳定的元数据。
- 增加 DOI / arXiv / Semantic Scholar 补全来源。
- 完善 PDF 高级标注和导出。
- 增加引用格式生成。
- 增加数据库备份和恢复界面。
- 增加文件夹监听和自动导入队列。
- 增加 RAG 知识库问答。
- 支持一键生成综述、Word / LaTeX 草稿等研究写作能力。
- 本地优先模型稳定后，再考虑可选云同步。

## 许可证

PaperQuay Community Edition 使用 `AGPL-3.0-only` 许可证。

如果你分发修改后的版本，或把修改后的版本作为网络服务提供给用户，需要保留许可证和版权声明，说明修改内容，并按 AGPL 要求提供对应源代码。闭源商业授权、商业支持或品牌名称使用许可需要与维护者另行协商。品牌使用说明见 [TRADEMARKS.md](./TRADEMARKS.md)。
