<p align="center">
  <a href="./README.md">English README</a>
</p>

<h1 align="center">PaperQuay</h1>

<p align="center">
  一个桌面优先、AI 辅助的文献管理与论文阅读软件。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-111827?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/SQLite-Local%20Library-0f766e?style=flat-square" alt="SQLite local library">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

## 项目简介

PaperQuay 面向学生、研究人员和论文写作者，目标是在一个本地桌面应用中完成文献管理、PDF 阅读、标注、翻译、摘要和问答。

项目最初围绕 Zotero 文献数据展开，现在已经调整为独立的文献管理软件。Zotero 仍然是可选导入来源，但不再是必要依赖。用户可以完全不使用 Zotero，直接在 PaperQuay 中导入 PDF、建立本地文献库、创建分类、添加标签并阅读论文。

## 当前功能

- 本地 SQLite 文献库，保存论文、作者、分类、标签、附件、笔记、标注和导入记录。
- 支持通过文件选择器或拖拽导入 PDF，并在导入前进入元数据确认页面。
- 可配置默认文献存储文件夹、复制 / 移动 / 保留原路径导入模式、文件命名规则和原始路径记录。
- 支持 Zotero 本地导入：选择或自动检测 Zotero 数据目录，读取 `zotero.sqlite`，将 Zotero collections 导入为 PaperQuay 分类，并复制 Zotero PDF 附件。
- 导入 PDF 时可通过 DOI 或标题调用 Crossref 自动补全标题、作者、年份、期刊和 DOI，同时保留手动编辑。
- 左侧分类树支持系统分类、自定义分类、子分类、拖拽调整层级、右键菜单和折叠展开。
- 文献详情支持编辑标题、作者、年份、期刊、DOI、URL、摘要、关键词、标签、笔记、引用信息和收藏状态。
- PDF 阅读器支持 MinerU 结构块视图，并通过 `blockId + pageIndex + bbox` 实现 PDF 区域与右侧结构块的几何联动。
- 支持通过 OpenAI 兼容模型进行摘要、全文翻译、划词翻译、论文概览和文档问答。
- 已适配浅色和深色主题，界面以桌面端使用为主。

## 技术架构

PaperQuay 是桌面应用优先，不是普通网页外面套一层壳。

- `src/`：React + TypeScript 前端界面、功能模块、状态和服务层。
- `src/features/literature/`：本地文献库、导入流程、分类树和文献详情。
- `src/features/reader/`、`src/features/pdf/`、`src/features/blocks/`：PDF 阅读、PDF 热区、MinerU 块视图和阅读工作区。
- `src/services/`：前端到 Tauri commands 的调用封装。
- `src-tauri/src/commands/`：Rust 宿主命令，包括文件访问、SQLite 文献库、Zotero 导入、MinerU、元数据补全、翻译、摘要和问答。
- `src-tauri/`：Tauri v2 配置、图标、安装包资源和 Rust crate。

## 环境要求

- Node.js 18 或更高版本
- Rust stable 工具链
- 当前操作系统对应的 Tauri v2 依赖
- Windows、macOS 或 Linux

可选外部服务：

- MinerU API key：用于云端解析。
- OpenAI 兼容 API key：用于摘要、翻译和问答。
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
7. 如果已有 Zotero 文库，可以在设置中选择 Zotero 数据目录并导入分类和 PDF。

## Zotero 兼容

PaperQuay 可以读取包含 `zotero.sqlite` 的 Zotero 本地数据目录。导入时会将 Zotero 数据库复制到临时只读文件中读取，不会修改 Zotero 原数据库。

导入结果会进入 PaperQuay 自己的本地文献库。Zotero collections 会变成本地分类，分类下的本地 PDF 会复制到 PaperQuay 的文献存储文件夹。

## 数据与隐私

PaperQuay 是本地优先。文献数据库保存为 SQLite，导入的 PDF 保存到你配置的文献存储文件夹。

不要提交本地数据、API key、PDF、解析结果或备份文件。当前 `.gitignore` 已默认排除运行时目录、SQLite 数据库、API key 文件、构建产物、备份包和私人 PDF。

## 当前状态

这是第一版可发布版本。核心本地文献库、PDF 导入、分类管理、Zotero 导入、元数据补全、PDF 阅读、MinerU 联动和 AI 阅读流程已经可用。

后续计划：

- 从 PDF 首页提取更稳定的元数据。
- 增加 DOI / arXiv / Semantic Scholar 补全来源。
- 完善 PDF 高级标注和导出。
- 增加引用格式生成。
- 增加数据库备份和恢复界面。
- 增加文件夹监听和自动导入队列。
- 本地优先模型稳定后，再考虑可选云同步。

## 许可证

PaperQuay Community Edition 使用 `AGPL-3.0-only` 许可证。

如果你分发修改后的版本，或把修改后的版本作为网络服务提供给用户，需要保留许可证和版权声明，说明修改内容，并按 AGPL 要求提供对应源代码。闭源商业授权、商业支持或品牌名称使用许可需要与维护者另行协商。品牌使用说明见 [TRADEMARKS.md](./TRADEMARKS.md)。
