<a id="english"></a>

# paperquay

> Desktop-first AI workspace for reading research papers.
>
> A focused academic reader that connects PDF pages, MinerU blocks, Zotero library metadata, notes, annotations, translation, summaries, and document QA inside one native desktop workflow.

<div align="center">
  <img src="https://img.shields.io/badge/Desktop%20First-Tauri%20v2-111827?style=flat-square" alt="Desktop First">
  <img src="https://img.shields.io/badge/React-18-2563eb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-0f766e?style=flat-square" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Rust-Tauri%20Host-7c2d12?style=flat-square" alt="Rust">
  <img src="https://img.shields.io/badge/PDF-MinerU%20Geometry%20Linking-4f46e5?style=flat-square" alt="MinerU Geometry Linking">
  <img src="https://img.shields.io/badge/Zotero-Integrated-b91c1c?style=flat-square" alt="Zotero">
</div>

<div align="center">
  <p><strong>Desktop-first | Geometry-linked PDF reading | Zotero + MinerU + AI in one workspace</strong></p>
  <p>
    <a href="#english">English</a> |
    <a href="#simplified-chinese">绠€浣撲腑鏂?/a> |
    <a href="#quick-start">Quick Start</a> |
    <a href="#features">Features</a> |
    <a href="#architecture">Architecture</a> |
    <a href="#roadmap">Roadmap</a>
  </p>
</div>

---

## Overview

paperquay is not a browser-first PDF tool wrapped later as a desktop shell. It is designed from the start as a Tauri desktop application for serious reading and research workflows.

The core idea is simple:

- read the original PDF on the left
- read MinerU-structured content on the right
- sync both views through geometry, not fragile text matching
- keep AI summary, translation, QA, notes, annotations, and paper history inside the same workspace

## Why paperquay

- Geometry-first linking  
  PDF interactions are driven by `blockId + pageIndex + bbox`, so jumps between PDF and structured content are precise and stable.

- Desktop-native file flow  
  Local PDFs, local JSON files, cache paths, desktop dialogs, and Tauri commands are treated as first-class capabilities.

- Separate model configuration by task  
  Summary, translation, and QA models are configured independently. QA also supports multiple presets that can be switched in the chat UI.

- Research workflow integration  
  Zotero browsing, MinerU parsing, structured reading, notes, annotations, screenshots, and per-paper chat history are connected instead of scattered across tools.

<a id="features"></a>

## Features

### PDF + structured block dual view

- Multi-page PDF rendering with `react-pdf`
- Hover and click overlays generated from MinerU `bbox`
- Bidirectional navigation between PDF regions and structured blocks
- Active block highlighting and scroll synchronization

### MinerU-centered reading

- Load local `content_list_v2.json`
- Detect sibling JSON next to the PDF
- Run MinerU cloud parsing and cache results locally
- Sync parse state back into the library preview

### AI reading workflows

- Paper summary generation from structured blocks
- Block translation and selected-text translation
- Document QA with multiple model presets
- Attach images, files, and region screenshots to QA
- Per-paper chat history

### Notes and annotations

- Workspace markdown notes
- Block-level annotations
- PDF-native annotation mode with standard PDF annotation objects
- Export annotated PDFs as derived copies without overwriting the source PDF
- Jump from annotation back to the related paper block
- Read Zotero-related markdown and text notes

### Library and workspace

- Zotero-backed library browsing
- Local standalone PDF support
- Paper preview state in the library
- Split-pane reading workspace with a compact assistant activity bar

<a id="architecture"></a>

## Architecture

```text
Tauri v2 host layer
|- local file access
|- MinerU cloud parse bridge
|- OpenAI-compatible summary / translation / QA bridge
`- desktop shell integration

React + TypeScript frontend
|- library workspace
|- PDF viewer
|- MinerU block viewer
|- assistant sidebar / floating panel
|- notes / annotations / Zotero notes
`- reader state orchestration

Linking model
`- blockId + pageIndex + bbox
```

## Tech Stack

- Tauri v2
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Rust
- react-pdf / pdf.js
- react-markdown
- remark-gfm
- remark-math
- rehype-katex
- Zustand

<a id="quick-start"></a>

## Quick Start

### Prerequisites

- Node.js 18+
- Rust stable toolchain
- Tauri v2 platform prerequisites

### Install

```bash
npm install
```

### Run in development

```bash
npm run tauri:dev
```

### Build

```bash
npm run build
npm run tauri:build
```

## Project Structure

```text
paperquay/
|- src/
|  |- components/
|  |- features/
|  |  |- library/
|  |  |- reader/
|  |  |- pdf/
|  |  `- blocks/
|  |- services/
|  |- stores/
|  |- types/
|  `- utils/
|- src-tauri/
|  |- src/
|  |  |- commands/
|  |  |- lib.rs
|  |  `- main.rs
|  `- tauri.conf.json
|- package.json
`- README.md
```

<a id="roadmap"></a>

## Roadmap

- Better page-level annotation UX directly on rendered PDF pages
- Richer table and figure rendering
- Cleaner export for notes, annotations, and chat results
- More polished onboarding and demo assets
- Desktop performance tuning and chunk splitting

## Annotation Plan

- Keep the original source PDF untouched so MinerU parsing always works from the canonical file.
- Use block-level local annotations for MinerU-linked reading mode.
- Use a separate PDF-native annotation mode when standard PDF annotations are needed.
- Export annotated PDFs as derived copies, for example `*.annotated.pdf`, instead of replacing the source file.

## References

- [`mozilla/pdf.js`](https://github.com/mozilla/pdf.js): the primary reference for paperquay's PDF-native annotation mode, annotation editor integration, and annotated PDF export via `saveDocument()`.
- [`Laomai-codefee/pdfjs-annotation-extension`](https://github.com/Laomai-codefee/pdfjs-annotation-extension): a useful reference for extending the official PDF.js viewer toward a more Zotero-like annotation workflow.
- [`agentcooper/react-pdf-highlighter`](https://github.com/agentcooper/react-pdf-highlighter): still relevant as a reference for external highlight/comment overlays when the workflow should not mutate the PDF itself.

## Status

paperquay is under active development. The current version already works as a solid desktop research-reading workspace foundation, and the product surface is still being refined.

---

<a id="simplified-chinese"></a>

# paperquay

> 闈㈠悜绉戠爺闃呰鐨勬闈紭鍏?AI 宸ヤ綔鍙般€?>
> 它把 PDF 原文、MinerU 结构块、Zotero 閺傚洤绨遍妴浣规喅鐟曚降鈧胶鐐曠拠鎴欌偓渚€妫剁粵鏂烩偓浣虹應鐠佽埇鈧焦澹掑▔銊ユ嫲鐠佺儤鏋冮崢鍡楀蕉閺佹潙鎮庨崚鏉挎倱娑撯偓娑擃亜甯悽鐔割攽闂堛垹浼愭担婊勭ウ娑擃厹鈧?
<div align="center">
  <p><strong>桌面优先 | 几何联动阅读 | Zotero + MinerU + AI 娑撯偓娴ｆ挸瀵插銉ょ稊閸?/strong></p>
  <p>
    <a href="#english">English</a> |
    <a href="#simplified-chinese">绠€浣撲腑鏂?/a> |
    <a href="#quick-start-zh">蹇€熷紑濮?/a> |
    <a href="#features-zh">鏍稿績鐗规€?/a> |
    <a href="#architecture-zh">架构</a> |
    <a href="#roadmap-zh">璺嚎鍥?/a>
  </p>
</div>

---

## 椤圭洰绠€浠?
paperquay 不是“先做网页，再顺手套一个桌面外壳”的工具。它从一开始就是按桌面应用来设计的，核心目标是让论文阅读、结构化解析、AI 鍒嗘瀽鍜岀爺绌剁瑪璁板湪涓€涓粺涓€绌洪棿閲屽崗鍚屽伐浣溿€?
杩欎釜椤圭洰鏈€鏍稿績鐨勪綋楠屾槸锛?
- 宸︿晶鐪?PDF 原文
- 鍙充晶鐪?MinerU 缁撴瀯鍧?- 用几何数据驱动双向联动，而不是依赖脆弱的文本匹配
- 在同一个界面里完成摘要、翻译、问答、笔记、批注和历史追踪

## 为什么叫 paperquay

- 几何联动优先  
  左右联动主链路是 `blockId + pageIndex + bbox`，定位更稳定，也更适合学术 PDF 杩欑澶嶆潅鐗堝紡銆?
- 真正的桌面应用思路  
  本地 PDF、JSON、缓存目录、系统文件选择器、宿主命令都通过 Tauri 閸?Rust 鏉ユ壙鎺ワ紝涓嶄緷璧栨祻瑙堝櫒涓存椂瀵硅薄銆?
- 大模型按任务拆分配置  
  閹芥顩﹀Ο鈥崇€烽妴浣虹倳鐠囨垶膩閸ㄥ鈧線妫剁粵鏃€膩閸ㄥ鍨庨崚顐﹀帳缂冾喓鈧倿妫剁粵鏃囩箷閺€顖涘瘮婢舵矮閲滃Ο鈥崇€锋０鍕啎閿涘苯婀懕濠傘亯閸栬櫣娲块幒銉ュ瀼閹诡潿鈧?
- 闂堛垹鎮滈惍鏃傗敀濞翠胶鈻奸惃鍕娴ｆ挸瀵插銉ょ稊閸? 
  Zotero 文库、MinerU 瑙ｆ瀽銆佺粨鏋勫潡闃呰銆佹埅鍥鹃棶绛斻€佺瑪璁般€佹壒娉ㄣ€佸叧鑱旂瑪璁板拰璁烘枃鍘嗗彶閮借繛鍦ㄤ竴璧枫€?
<a id="features-zh"></a>

## 鏍稿績鐗规€?
### PDF + 结构块双视图

- 使用 `react-pdf` 渲染多页 PDF
- 根据 MinerU `bbox` 鐢熸垚鍙?hover / click 鐨勭儹鍖?overlay
- 点击 PDF 区块时，右侧跳转到对应结构块
- 点击右侧结构块时，左侧跳转并高亮对应 PDF 区域

### 面向 MinerU 閻ㄥ嫰妲勭拠濠氭懠鐠?
- 支持加载本地 `content_list_v2.json`
- 鏀寔鑷姩妫€娴?PDF 鍚岀洰褰?JSON
- 支持调用 MinerU 云端解析，并把结果缓存到本地
- 鐟欙絾鐎界€瑰本鍨氶崥搴℃倱濮濄儲娲块弬鐗堟瀮鎼存捇顣╃憴鍫㈠Ц閹?
### AI 闂冨懓顕板銉ょ稊濞?
- 閸╄桨绨紒鎾寸€崸妤冩晸閹存劘顔戦弬鍥ㄦ喅鐟?- 鏂囨。鏁翠綋缈昏瘧涓庡垝璇嶇炕璇?- 多模型预设的文档问答
- 闂傤喚鐡熼弨顖涘瘮閸ュ墽澧栭妴浣规瀮娴犺泛鎷板鍡涒偓澶嬪焻閸?- 每篇论文独立保存对话历史

### 缁楁棁顔囨稉搴㈠濞?
- 宸ヤ綔鍖?Markdown 笔记
- 面向结构块的批注
- 娴犲孩澹掑▔銊ユ彥闁喕鐑﹂崶鐐差嚠鎼存柨鍞寸€?- 读取 Zotero 鍏宠仈鐨?Markdown / 文本文档笔记

### 文库与工作区体验

- Zotero 文库浏览
- 独立本地 PDF 打开
- 鏂囧簱鍐呰鏂囬瑙堢姸鎬佸悓姝?- 閸欏厖鏅剁槐褍鍣惧ú璇插З閺?+ 鎶藉眽寮忓姪鎵嬮潰鏉?
<a id="architecture-zh"></a>

## 架构

```text
Tauri v2 瀹夸富灞?|- 本地文件访问
|- MinerU 云端解析桥接
|- OpenAI 兼容摘要 / 翻译 / 问答桥接
`- 妗岄潰绐楀彛涓庡涓昏兘鍔?
React + TypeScript 鍓嶇灞?|- 閺傚洤绨卞銉ょ稊閸?|- PDF 闃呰鍣?|- MinerU 缂佹挻鐎崸妤勵潒閸?|- 侧栏助手 / 浮动面板
|- 笔记 / 批注 / Zotero 笔记
`- 阅读状态与同步编排

联动核心
`- blockId + pageIndex + bbox
```

## 技术栈

- Tauri v2
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Rust
- react-pdf / pdf.js
- react-markdown
- remark-gfm
- remark-math
- rehype-katex
- Zustand

<a id="quick-start-zh"></a>

## 蹇€熷紑濮?
### 环境要求

- Node.js 18 閹存牗娲挎妯煎閺?- Rust stable 宸ュ叿閾?- Tauri v2 对应平台依赖

### 安装依赖

```bash
npm install
```

### 寮€鍙戣繍琛?
```bash
npm run tauri:dev
```

### 构建

```bash
npm run build
npm run tauri:build
```

## 目录结构

```text
paperquay/
|- src/
|  |- components/
|  |- features/
|  |  |- library/
|  |  |- reader/
|  |  |- pdf/
|  |  `- blocks/
|  |- services/
|  |- stores/
|  |- types/
|  `- utils/
|- src-tauri/
|  |- src/
|  |  |- commands/
|  |  |- lib.rs
|  |  `- main.rs
|  `- tauri.conf.json
|- package.json
`- README.md
```

<a id="roadmap-zh"></a>

## 璺嚎鍥?
- 更完整的 PDF 页内批注交互
- 閺囨潙銈介惃鍕€冮弽闂寸瑢閸ュ墽澧栭崸妤佽閺?- 更清晰的笔记、批注和问答结果导出
- 閺囧瓨鍨氶悢鐔烘畱妫ｆ牗顐奸崥顖氬З瀵洖顕遍崪灞剧川缁€楦跨カ娴?- 閺囧绮忛懛瀵告畱濡楀矂娼伴幀褑鍏樻导妯哄娑撳骸鍨庨崠鍛摜閻?
## 褰撳墠鐘舵€?
paperquay 姝ｅ湪鎸佺画杩唬涓€傚綋鍓嶇増鏈凡缁忓彲浠ヤ綔涓轰竴涓彲鐢ㄧ殑妗岄潰绉戠爺闃呰宸ヤ綔鍙板熀纭€锛屾帴涓嬫潵浼氱户缁墦纾ㄤ骇鍝佸畬鎴愬害鍜屼氦浜掔粏鑺傘€?## 批注方案

- PDF 上的笔记和高亮默认不直接改写原始 PDF閵?- MinerU 鐟欙絾鐎借箛鍛淬€忕紒褏鐢婚崺杞扮艾閺堫亣顫﹂弨鐟板З閻ㄥ嫭绨弬鍥︽閹笛嗩攽閵?- 批注数据优先保存为本地侧车文件，例如 JSON 閹?manifest閵?- 濡傛灉鍚庣画闇€瑕佸鍑哄甫鎵规敞鐨?PDF閿涘苯绨查悽鐔稿灇閺傛壆娈戝ú鍓ф晸閺傚洣娆㈤敍宀冣偓灞肩瑝閺勵垵顩惄鏍у斧娴犺翰鈧?
## 鍙傝€冮」鐩?
- [`agentcooper/react-pdf-highlighter`](https://github.com/agentcooper/react-pdf-highlighter)：更适合作为 paperquay 閻ㄥ嫭澹掑▔銊ョ唨绾偓閿涘苯娲滄稉鍝勭秼閸撳秹銆嶉惄顔煎嚒缂佸繐鐔€娴?React 閸?PDF.js 濞撳弶鐓嬮敍灞炬纯闁倸鎮庨幒銉ュ弳婢舵牠鍎存妯瑰瘨閸滃矁鐦庣拋鐑樻殶閹诡喓鈧?- [`Laomai-codefee/pdfjs-annotation-extension-for-react`](https://github.com/Laomai-codefee/pdfjs-annotation-extension-for-react)閿涙艾褰叉禒銉ょ稊娑?PDF.js 濞夈劑鍣寸仦鍌涘⒖鐏炴洜娈戦崣鍌濃偓鍐跨礉娴ｅ棗鐣犻弴鏉戜焊閸氭垹娲块幒銉﹀⒖鐏?PDF.js viewer，与当前 `react-pdf` 闂冨懓顕伴棃銏″复閸氬牆瀹虫潏鍐х秵閵?