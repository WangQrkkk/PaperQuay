你是一个资深桌面应用工程师兼前端架构师，请为我生成一个“轻量级论文阅读器”桌面应用项目。这个项目不是浏览器优先，而是**桌面应用优先**，宿主框架固定为 **Tauri v2**，前端固定为 **Vite + React + TypeScript**閵?

璇蜂綘涓ユ牸鎸夌収鈥滄闈㈠簲鐢ㄤ紭鍏堚€濈殑鎬濊矾璁捐锛屼笉瑕佹妸瀹冨綋鎴愪竴涓櫘閫?Web 妞ょ敻娼伴崥搴ｇ敾閸愬秹銆庨幍瀣悑鐎?Tauri閵?
閹存垼顩﹂惃鍕Ц娑撯偓娑擃亞婀″锝囨畱濡楀矂娼扮粩顖濐啈閺傚洭妲勭拠璇叉珤閿涘奔瀵岀憰浣界箥鐞涘瞼骞嗘晶鍐╂Ц閿?

* macOS
* Windows
* Linux

前端技术栈固定为：

* Tauri v2
* Vite
* React
* TypeScript
* TailwindCSS
* react-pdf閿涘牆鐔€娴?pdf.js閿?
* react-markdown
* remark-gfm
* remark-math
* rehype-katex

后端/宿主能力层：

* Rust（Tauri commands閿?
* Tauri 插件按需使用
* 本地文件读取优先考虑 Tauri 鎻愪緵鐨勬闈㈣兘鍔?

妞ゅ湱娲伴惄顔界垼閿?
閺嬪嫬缂撴稉鈧稉顏咁攽闂堛垻顏拋鐑樻瀮闂冨懓顕伴崳顭掔礉閺嶇绺鹃懗钘夊閺?**PDF 原文视图** 娑?**MinerU 鐟欙絾鐎界紒鎾寸€崸妤勵潒閸?* 閻?*双向几何联动**閵?

---

## 涓€銆侀」鐩畾浣嶏紙蹇呴』涓ユ牸閬靛畧锛?

杩欐槸涓€涓闈㈠簲鐢紝涓嶆槸鏅€氱綉椤点€?

璇蜂弗鏍兼寜浠ヤ笅鍘熷垯璁捐锛?

1. Tauri v2 鏄涓诲眰锛屼笉鍙€?
2. 前端 UI 使用 React + Vite + TypeScript
3. 閺傚洣娆㈤幍鎾崇磻濞翠胶鈻兼导妯哄帥娴ｈ法鏁ゅ宀勬桨鎼存梻鏁ら懗钘夊閿?

   * 閺傚洣娆㈤柅澶嬪閸?
   * 本地路径
   * 本地缓存
4. 涓嶈鎶婃牳蹇冧氦浜掑缓绔嬪湪娴忚鍣ㄤ笂浼?input file 临时对象之上
5. 项目结构要体现：

   * 前端 UI 鐏?
   * Tauri/Rust 鐎瑰じ瀵岄懗钘夊鐏?
   * MinerU 閺佺増宓佹潪顒佸床鐏?
   * PDF 閸戠姳缍嶉懕鏂垮З鐏?

---

## 娴滃被鈧焦鐗宠箛鍐付濮?

我要实现一个左右分栏的桌面论文阅读器：

宸︿晶锛?

* PDF 视图
* 使用 react-pdf 渲染
* 支持多页
* 每一页有 bbox 热区 overlay
* 鼠标移动到块上时高亮
* 点击块时激活并联动右侧

鍙充晶锛?

* MinerU 鍧楄鍥?/ 缁撴瀯鍖栭槄璇昏鍥?
* 鎸夊潡娓叉煋锛岃€屼笉鏄彧娓叉煋涓€鏁寸瘒瀛楃涓?
* 每个块有 data-block-id
* 点击块时左侧 PDF 跳到对应页并高亮对应 bbox

联动主逻辑必须是：

* blockId
* pageIndex
* bbox

娑撳秷顩﹂幎濠冩瀮閺堫剚膩缁﹤灏柊宥勭稊娑撹桨瀵岄弬瑙勵攳閵?

---

## 三、MinerU 数据前提（必须理解）

MinerU 返回的不是纯 markdown閿涘矁鈧本妲搁幐澶愩€夐崚鍡欑矋閻ㄥ嫪绨╃紒瀛樻殶缂佸嫸绱濇笟瀣洤閿?

```json id="9cuh4j"
[
  [
    {
      "type": "paragraph",
      "content": {
        "paragraph_content": [
          {
            "type": "text",
            "content": "There are also other civilian applications..."
          }
        ]
      },
      "bbox": [78, 102, 485, 259]
    }
  ]
]
```

请正确理解：

* 最外层数组：页数组
* 每一页：block 数组
* 每个 block閿?

  * type
  * content
  * bbox
* bbox = [x1, y1, x2, y2]
* bbox 琛ㄧず璇ュ潡鍦ㄥ綋鍓?PDF 椤甸潰鍧愭爣绯讳腑鐨勭煩褰㈠尯鍩?

因此，PDF 閼辨柨濮╄箛鍛淬€忓铏圭彌閸︺劏绻栨稉顏勫殤娴ｆ洘鏆熼幑顔荤娑撳鈧?

---

## 閸ユ稏鈧浇浠堥崝銊ュ斧閸掓瑱绱欓張鈧柌宥堫洣閿?

### 1. 左侧 PDF -> 右侧

涓嶅厑璁告妸涓婚€昏緫璁捐鎴愭枃鏈尮閰嶃€?

蹇呴』杩欐牱瀹炵幇锛?

* 鏍规嵁褰撳墠椤垫墍鏈夋鏂囧潡鐨?bbox，在 PDF 页面上方建立一层透明热区 overlay
* 姣忎釜鐑尯缁戝畾涓€涓?blockId
* 鼠标 hover 到哪个热区，就高亮哪个块
* 点击哪个热区，就直接得到 blockId
* 鍙充晶婊氬姩鍒板搴?data-block-id 的块，并短暂高亮

### 2. 右侧 -> 左侧

* 鐐瑰嚮鍙充晶浠绘剰鍧?
* 直接拿该 block 的：

  * pageIndex
  * bbox
  * blockId
* 左侧 PDF 滚动到对应页
* 鍦ㄥ搴?bbox 鍖哄煙缁樺埗楂樹寒妗?

### 3. 文本匹配只能作为极端兜底

瑜版挸澧犻悧鍫熸拱閻ㄥ嫪瀵岄柅鏄忕帆韫囧懘銆忛弰顖氬殤娴ｆ洖娼￠懕鏂垮З閿涘奔绗夐弰顖氱摟缁楋缚瑕嗛幖婊呭偍閵?

---

## 浜斻€侀」鐩粨鏋勮姹?

请输出一个清晰的 Tauri v2 项目目录，至少包括：

```text id="6vd0kx"
paper-reader/
├─ src/
閳? ├─ app/
閳? 閳? ├─ App.tsx
閳? 閳? └─ index.css
閳? ├─ components/
閳? ├─ features/
閳? 閳? ├─ reader/
閳? 閳? 閳? └─ Reader.tsx
閳? 閳? ├─ pdf/
閳? 閳? 閳? └─ PdfViewer.tsx
閳? 閳? └─ blocks/
閳? 閳?    └─ BlockViewer.tsx
閳? ├─ services/
閳? 閳? ├─ mineru.ts
閳? 閳? └─ desktop.ts
閳? ├─ types/
閳? 閳? └─ reader.ts
閳? ├─ utils/
閳? 閳? ├─ bbox.ts
閳? 閳? └─ text.ts
閳? ├─ main.tsx
閳? └─ vite-env.d.ts
├─ src-tauri/
閳? ├─ src/
閳? 閳? ├─ main.rs
閳? 閳? ├─ lib.rs
閳? 閳? └─ commands/
閳? 閳?    ├─ mod.rs
閳? 閳?    ├─ file.rs
閳? 閳?    └─ mineru.rs
閳? ├─ tauri.conf.json
閳? └─ Cargo.toml
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ README.md
```

瑕佹眰锛?

* 鍓嶇鍜?Rust 宿主边界清晰
* 桌面能力通过 Tauri command 暴露
* 涓嶈鎶婃墍鏈夐€昏緫閮藉爢鍦ㄥ墠绔?

---

## 鍏€佺被鍨嬪畾涔夎姹?

鐠囧嘲鐣炬稊澶婄暚閺?TypeScript 类型，至少包括：

```ts id="xz5ael"
export type BBox = [number, number, number, number];

export type PdfSource =
  | { kind: 'local-path'; path: string }
  | { kind: 'remote-url'; url: string }
  | null;

export interface MineruBlockBase {
  type: string;
  content: unknown;
  bbox?: BBox;
}

export type MineruPage = MineruBlockBase[];

export interface PositionedMineruBlock extends MineruBlockBase {
  blockId: string;
  pageIndex: number;
  blockIndex: number;
}

export interface PdfHighlightTarget {
  blockId: string;
  pageIndex: number;
  bbox: BBox;
}
```

并保留扩展能力，block.type 閸欘垵鍏橀崠鍛閿?

* paragraph
* title
* list
* image
* table
* caption
* equation
* page_header
* page_footer
* page_number
* page_footnote

---

## 七、桌面能力要求（Tauri / Rust閿?

鐠囪渹绗夌憰浣瑰Ω閺傚洣娆㈤幍鎾崇磻閸欘亜鍟撻幋鎰珮闁?`<input type="file">`閵?

閹存垼顩﹀宀勬桨鎼存梻鏁ゆ担鎾荤崣閿涘苯娲滃銈堫嚞閸?Rust/Tauri 灞傛彁渚涙闈㈣兘鍔涖€?

### 1. 打开本地 PDF

鐠囩柉顔曠拋鈥茬娑?Tauri command 閹存牕鐔€娴?Tauri 鎻掍欢鑳藉姏鐨勬帴鍙ｏ紝鐢ㄤ簬锛?

* 选择本地 PDF
* 返回本地路径
* 閸撳秶顏穱婵嗙摠娑?PdfSource = { kind: 'local-path', path }

### 2. 读取 MinerU JSON

璇锋敮鎸佽鍙栨湰鍦?`content_list_v2.json`

* Rust 读取 JSON 文件内容
* 鏉╂柨娲栫紒娆忓缁旑垵袙閺?
* 或前端通过 path 请求 Rust 读取

### 3. 閸氬海鐢婚崣顖涘⒖鐏?

请在结构上预留：

* 调用本地 Python / 本地后端 / 远程 MinerU API
* 閹?PDF 发给 MinerU，返回块结构 JSON

娉ㄦ剰锛?
閻滄澘婀崣顖欎簰閸?mock 或先读取现有 JSON閿涘奔绲鹃弸鑸电€稉濠傜箑妞よ鍎氶惇鐔风杽濡楀矂娼版惔鏃傛暏閵?

---

## 八、服务层要求

请实现以下前端服务模块：

### services/desktop.ts

璐熻矗涓?Tauri 通信，例如：

* 打开本地 PDF
* 读取本地 JSON
* 调用 Rust command

### services/mineru.ts

璐熻矗锛?

1. flattenMineruPages(pages: MineruPage[]): PositionedMineruBlock[]
2. extractTextFromMineruBlock(block: PositionedMineruBlock): string
3. buildRenderableBlocks(blocks: PositionedMineruBlock[])
4. 閸欘垶鈧?convert block -> markdown fragment

请注意：
右侧渲染不是必须整篇 markdown閿涘奔绔寸€规俺顩︽穱婵堟殌閸ф楠囨穱鈩冧紖閵?

---

## 涔濄€佸乏渚?PDF 组件要求（PdfViewer.tsx閿?

必须使用 react-pdf锛屽苟婊¤冻锛?

1. 瀵偓閸?TextLayer
2. 关闭 AnnotationLayer
3. 必须引入 TextLayer.css
4. 韫囧懘銆忓锝団€橀崚婵嗩潗閸?pdfjs worker
5. 支持多页渲染
6. 濮ｅ繋绔存い鐢稿厴韫囧懘銆忛弰顖椻偓婊呮祲鐎电懓鐣炬担宥咁啇閸ｃ劉鈧?

### 核心要求：PDF 热区 overlay

濮ｅ繋绔存い鍏哥瑐韫囧懘銆忛崣鐘插娑撯偓娑?overlay 层，overlay 涓牴鎹綋鍓嶉〉鐨?blocks 閻㈢喐鍨氭径姘嚋缂佹繂顕€规矮缍呴悜顓炲隘閵?

#### 热区生成规则

* 姣忎釜鐑尯瀵瑰簲涓€涓?PositionedMineruBlock
* 热区坐标来自 bbox
* 鐑尯鍙负姝ｆ枃鐩稿叧鍧楀缓绔?
* 姒涙顓婚幒鎺楁珟閿?

  * page_header
  * page_footer
  * page_number
  * page_footnote

#### 交互

* hover閿?

  * 更新 hoveredBlockId
  * 当前热区浅黄色半透明高亮
* click閿?

  * 更新 activeBlockId
  * 调用 onBlockSelect(block)

### active 楂樹寒妗?

PdfViewer 鏉╂顩﹂弨顖涘瘮閿?

* activeHighlight: PdfHighlightTarget | null
  当右侧点击块时，如果当前页是 activeHighlight.pageIndex閿涘苯鍨崷銊ヮ嚠鎼?bbox 鍖哄煙缁樺埗鏇存槑鏄剧殑楂樹寒妗嗐€?

### bbox 坐标换算

蹇呴』瀹炵幇锛?

* ?? PDF 妞ら潧鏄傜€?
* 瑜版挸澧犲〒鍙夌厠妞ら潧鏄傜€?
* scaleX / scaleY
* bbox -> CSS absolute style

需要明确写出公式：

```ts id="2v9v2h"
left = x1 * scaleX
top = y1 * scaleY
width = (x2 - x1) * scaleX
height = (y2 - y1) * scaleY
```

---

## 十、右侧块视图要求（BlockViewer.tsx閿?

娑撳秷顩﹂幎濠傚礁娓氀呯暆閸楁洖浠涢幋鎰ㄢ偓婊勬殻缁?markdown 娑撯偓濞嗏剝鈧勮閺屾挴鈧縿鈧?

请采用“块级渲染”方式：

* 每个 PositionedMineruBlock 单独渲染
* 濮ｅ繋閲滈崸妤佹付婢舵牕鐪伴柈鑺ユ箒閿?

  * data-block-id={block.blockId}

鏀寔鐨勫潡绫诲瀷鑷冲皯鍖呮嫭锛?

* title
* paragraph
* list
* image（先渲染 caption 或占位）
* table（先渲染 caption 閹?html 鍗犱綅锛?

鍐呴儴鍙互灞€閮ㄤ娇鐢?react-markdown 濞撳弶鐓嬮崸妤佹瀮閺堫剨绱濊箛鍛淬€忛弨顖涘瘮閿?

* remark-gfm
* remark-math
* rehype-katex
* katex.min.css

### 右侧交互

* 閻愮懓鍤崸妤佹閿?

  * onBlockClick(block)
* 瑜?activeBlockId 变化时：

  * 自动 scrollIntoView({ behavior: 'smooth', block: 'center' })
  * 高亮 1.5 缁?
* 瑜?hoveredBlockId 变化时：

  * 閸欘垶鈧妯夌粈楦跨窛鏉?hover 样式

---

## 十一、父组件要求（Reader.tsx閿?

Reader.tsx 缂佺喍绔寸粻锛勬倞閿?

* pdfSource: PdfSource
* mineruPages: MineruPage[]
* flatBlocks: PositionedMineruBlock[]
* activeBlockId: string | null
* hoveredBlockId: string | null
* activePdfHighlight: PdfHighlightTarget | null
* loading: boolean
* error: string

并负责以下交互：

### A. 左侧点击 PDF 閸?

* 接收 onBlockSelect(block)
* 设置 activeBlockId = block.blockId
* 鍙充晶婊氬姩瀹氫綅鍒?block.blockId

### B. 左侧 hover PDF 閸?

* 更新 hoveredBlockId

### C. 閸欏厖鏅堕悙鐟板毊閸?

* 设置 activeBlockId = block.blockId
* 设置 activePdfHighlight = {
  blockId,
  pageIndex,
  bbox
  }

### D. 打开本地文件

* 调用 Tauri 桌面能力打开 PDF
* 读取对应 MinerU JSON
* 鍒濆鍖?blocks

---

## 鍗佷簩銆佹闈㈠簲鐢?UI 要求

杩欐槸妗岄潰搴旂敤锛屼笉鏄綉椤?demo锛岃淇濇寔妗岄潰搴旂敤椋庢牸锛?

* 窗口 100vh / 100vw
* 左右等宽双栏
* 妞ゅ爼鍎村銉ュ徔閺?
* 左侧 PDF 独立滚动
* 閸欏厖鏅堕崸妤勵潒閸ュ墽瀚粩瀣泊閸?
* 风格简洁、专业、偏学术工具
* TailwindCSS 实现
* 鏀寔绌虹姸鎬?/ 鍔犺浇涓?/ 閿欒鐘舵€?

建议工具栏包含：

* 打开本地 PDF
* 打开 MinerU JSON
* 瑜版挸澧犻弬鍥︽閸?
* 当前激活块信息
* 鐘舵€佹彁绀?

---

## 十三、Rust 代码要求

请生成最小可用的 Tauri Rust 代码，包括：

* main.rs / lib.rs
* command 注册
* 一个读取本地文件文本的 command
* 涓€涓€夋嫨鏂囦欢璺緞鐨?command 或可替代实现
* 错误处理
* 鍓嶅悗绔皟鐢ㄧず渚?

瑕佹眰锛?

* Rust 娴狅絿鐖滅亸浠嬪櫤缁犫偓閸?
* 只做桌面能力桥接
* 业务核心仍放前端
* 娴狅絿鐖滈懗鎴掔稊娑?Tauri v2 项目起点

---

## 閸椾礁娲撻妴浣风瑝鐟曚浇绻栭弽宄扮杽閻?

请不要把项目设计成：

1. 一个普通浏览器页面后面再“顺便加 Tauri閳?
2. 瀹革缚鏅堕崣顏嗘磧閸?TextLayer 文本内容
3. 主联动靠 normalizeText / includes / 全文搜索
4. 鍙充晶鍙覆鏌撴暣绡?markdown閿涘矁鈧本鐥呴張澶婃健缁?DOM 锚点
5. 鎵€鏈夋枃浠惰闂兘鍙潬娴忚鍣?File API

---

## 鍗佷簲銆佽緭鍑洪『搴?

请按以下顺序输出完整代码和说明：

1. 完整目录结构
2. package.json 依赖建议
3. src-tauri/Cargo.toml 依赖建议
4. TypeScript 类型定义
5. src/services/desktop.ts
6. src/services/mineru.ts
7. src/features/reader/Reader.tsx
8. src/features/pdf/PdfViewer.tsx
9. src/features/blocks/BlockViewer.tsx
10. src-tauri/src/main.rs
11. src-tauri/src/lib.rs
12. src-tauri/src/commands/file.rs
13. src-tauri/src/commands/mod.rs
14. bbox 坐标换算逻辑说明
15. PDF 热区 overlay 设计说明
16. hover / active / click 双向联动说明
17. 当前 MVP 鐨勯檺鍒朵笌鍚庣画鍙墿灞曟柟鍚?

瑕佹眰锛?

* 娴狅絿鐖滆箛鍛淬€忛崣顖濈箥鐞?
* 閹碘偓閺堝鍞惍浣峰▏閻?TypeScript 閸?Rust
* 注释全部使用中文
* 桌面应用优先
* 鑱斿姩蹇呴』浠ュ嚑浣曞潡涓轰富锛屼笉鏄枃鏈尮閰?
* 左侧 PDF 必须通过 bbox 建立热区 overlay
* 鼠标滑动到哪个块就高亮哪个块
* 鐐瑰嚮鍝釜鍧楀氨鐩存帴瀹氫綅鍙充晶瀵瑰簲鍧?
