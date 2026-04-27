<p align="center">
  <a href="./README.md">English</a>
</p>

<h1 align="center">PaperQuay</h1>

<p align="center">
  一个桌面优先的论文阅读、翻译、批注与问答工作台。
</p>

<p align="center">
  PaperQuay 把原始 PDF、MinerU 结构块、笔记、批注、截图和 AI 分析放进同一个原生桌面窗口里，不再让研究流程散落在浏览器标签页与零碎脚本之间。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-111827?style=flat-square" alt="Tauri v2">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Rust-Host%20Bridge-7c2d12?style=flat-square" alt="Rust host bridge">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

## 为什么是 PaperQuay

PaperQuay 的核心原则很直接：论文阅读的联动应该建立在几何结构上，而不是脆弱的文本猜测上。

左侧是原始 PDF，右侧是 MinerU 结构块。鼠标划过 PDF 热区，右侧块立刻高亮；点击右侧块，视图就回到对应页和对应 bbox。摘要、翻译、问答、笔记、批注、截图与历史记录，都围绕这条阅读主线展开，而不是互相割裂。

它也不是“先做网页，再顺手套一个桌面壳”的项目。文件选择、本地路径、缓存目录、系统截图、窗口行为、Tauri 宿主能力，这些都从第一天起就是产品设计的一部分。

## 现在已经能做什么

- 在桌面端阅读本地 PDF 和 Zotero 文献。
- 通过 `blockId + pageIndex + bbox` 把 PDF 区域与 MinerU 结构块稳定联动起来。
- 生成论文概览，翻译整篇文档或划词内容，并用可配置的 OpenAI 兼容模型做文档问答。
- 为每篇论文保存聊天历史、笔记、批注和解析缓存，让一次阅读工作可以被真正续上。
- 在不覆盖原始 PDF 的前提下，完成面向研究场景的批注流程。

## 技术栈

PaperQuay 使用 Tauri v2 作为桌面宿主，React + TypeScript + Vite 负责界面，Rust commands 负责宿主桥接，`react-pdf` 与 `pdf.js` 负责 PDF 渲染，`react-markdown` 与数学公式插件负责结构化内容阅读。

仓库结构也刻意体现了“桌面应用优先”的边界：

- `src/` 放前端界面、阅读工作流、状态与服务层。
- `src-tauri/` 放 Rust 桥接、文件访问命令和 Tauri 配置。
- MinerU 结果、摘要、翻译缓存和历史记录都按桌面应用的数据资产来处理，而不是浏览器临时状态。

## 本地运行

```bash
npm install
npm run tauri:dev
```

如果你想分别确认前端构建和 Rust 宿主状态：

```bash
npm run build
cargo check
```

## 参考与借鉴

PaperQuay 不是这些项目的简单拼接，但当前方向确实受到了几类优秀开源项目的启发：

- [`zotero/zotero`](https://github.com/zotero/zotero) 提供了研究型文献工作流的基准体验。
- [`mozilla/pdf.js`](https://github.com/mozilla/pdf.js) 提供了 PDF 原生渲染与批注行为的重要参考。
- [`agentcooper/react-pdf-highlighter`](https://github.com/agentcooper/react-pdf-highlighter) 提供了外置高亮与评论覆盖层的思路。
- [`Laomai-codefee/pdfjs-annotation-extension`](https://github.com/Laomai-codefee/pdfjs-annotation-extension-for-react) 提供了围绕 PDF.js 扩展批注交互的参考。

## 许可证

PaperQuay Community Edition 采用 `AGPL-3.0-only`。

这意味着：如果你分发修改后的版本，或者把修改后的版本作为网络服务提供给用户，就需要保留原有版权和许可证声明，明确说明你做过修改，并按 AGPL 要求提供对应源代码。AGPL 本身并不禁止商业活动，但它不允许你把社区版改完之后继续闭源使用或闭源分发。

如果你需要闭源商业授权、`PaperQuay` 名称与品牌使用许可，或者商业支持，请联系维护者另行协商。品牌使用说明见 [TRADEMARKS.md](./TRADEMARKS.md)。

## 当前状态

PaperQuay 已经可以作为一个认真可用的桌面论文阅读工作台继续演进。当前重点不是“多堆几个功能点”，而是把阅读闭环打磨得更锋利：更干净的中英文界面、更稳定的 PDF 与结构块联动、更自然的批注流，以及更像研究助手而不是聊天玩具的分析能力。
