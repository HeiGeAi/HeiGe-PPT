# Changelog

本项目所有重要变更记录于此。

## [1.5.2] - 2026-11-06

验收驱动的一轮加固：把「文档承诺、但没人真验」的行为补成自动化测试。

### 新增
- `scripts/test/three-layer.mjs`：现场组装一份三层 deck（可编辑层 + 现场演示层 + 演讲者层），验证共存不打架。7 项：三层脚本都加载、现场演示层挂进可编辑层工具栏、编辑态点击不翻页、lightbox 打开时方向键只关图不翻页、演讲者视图里 F 是冻结不是全屏、视图内方向键只翻一页、退出后三层仍在。它顺带验证「`references/live-show-layer.md` 的代码块贴进 deck 就能用」这个前提。
- `scripts/test/presenter-edge.mjs`：6 项边界用例。小屏（820×620）下两个预览是否仍 16:9 且不超出容器；自动翻页是不是真的会翻、打开宫格时会不会暂停。
- CI 的 presenter job 现在跑三步：演讲者层 9 项、三层共存 7 项、边界 6 项。

### 修复
- 测试脚本派发键盘事件的目标从 `window` 改成 `body`。真实按键的事件路径是 window→document→body，派发到 window 时 document 上的捕获监听收不到，会漏掉另外两层的反应（现场演示层的 lightbox 关图就漏在这）。

### 验证
- 本地模拟 CI 全绿：单测 5/5、演讲者层 9/9、三层共存 7/7、边界 6/6，页面异常 0。
- 转换器首次本地真跑：6 份样例全部转出，页数一致（13/11/12/12/13/12），形状越界 0、空页 0。
- 装了演讲者层的 campus-talk 与装层前版本转出的 PPTX 完全一致（11 页、文本零差异、图片数相同、零覆盖物泄漏）。
- PPTX 与 deck 的文本覆盖率：5 份 99% 以上；consulting-proposal 93.8%，差额来自第 5 页 SVG 框架图按设计转成图片（转换器有明确提示）。

## [1.5.1] - 2026-11-06

1.5.0 发布后的加固：把演讲者层接进 CI，把样例里积压的两处文档与代码不一致抹平。

### 新增
- **CI 加 presenter job**：`scripts/test/e2e-presenter.mjs` 进流水线，用 playwright-core 装好的 chromium 跑，Node 22。这层 650 行运行时此前完全没有自动化保护，改了坏不坏只能靠人肉点。
- **e2e 补两条断言**：按一次方向键只能翻一页且主 deck 同步（锁住「本层 window 捕获先于 deck window 冒泡」这个隐式约定）；备注按 `data-slide-id` 落进 localStorage。
- **e2e 支持 `--no-sandbox`**，CI 容器里也能跑；`CI` 环境变量存在时自动带上。

### 修复
- **6 份样例的可编辑层与 `references/editable-layer.md` 对齐**：保存前先克隆剥掉 `contenteditable` / `spellcheck` 再写 localStorage。此前样例存的是裸 `innerHTML`，刷新后字段在放映态仍可编辑，还会吞掉方向键翻页。
- **6 份样例的「下载 HTML」清理选择器补齐**：从 `.he-toolbar,.he-style` 扩到含 `.lb`、`.he-showbar`、`#he-presenter`、`#he-presenter-btn`、`#he-presenter-style`。此前下载的独立文件会带着现场演示层和演讲者层的运行时覆盖物。

### 样例
- `examples/campus-talk.html` 装上演讲者层，附 11 页真实备注（计划 15.6 分钟）。至此两份样例（darktech-keynote 深色 keynote、campus-talk 张扬人文演讲）都装了层，跨版式通用性有实跑证据。

### 验证
- 6 份样例逐一浏览器实测：进编辑态改字 → 读 localStorage，`contenteditable` 与 `spellcheck` 均为 0 命中。
- 清理选择器实测命中数：装了层的 4 个（`.he-style` / `.he-toolbar` / `#he-presenter-style` / `#he-presenter-btn`），没装的 2 个。
- campus-talk 与 darktech-keynote 各跑一遍 e2e，9/9 通过，页面异常 0。
- `node --test scripts/test/presenter.test.js` 5/5。

## [1.5.0] - 2026-11-06

演讲者层。把「一个人对着投影仪讲」拆成两块屏：演讲者屏看备注和下一页，台下屏只显示当前页。纯本地、零依赖、不需要账号，贴上就生效。

### 新增
- `references/presenter-mode.md`：演讲者层的契约文档。入口、快捷键、备注字段、两条安装路线、与现场演示层和可编辑层的共存规则、能力边界。
- `assets/presenter-layer.html`：drop-in 片段本体，一段 `<style id="he-presenter-style">` + 一段 `<script>`，贴 `</body>` 前就能用。
- `scripts/inject-presenter.mjs`：一条命令装层。补 `data-slide-id` / `data-title`、插 `SPEAKER_NOTES` 骨架、贴运行时、顺手把本层元素补进可编辑层的下载清理名单。幂等，反复跑只刷新片段。
- `scripts/test/presenter.test.js`：注入器回归测试，5 条，纯 Node 无浏览器。

### 能力
- **演讲者屏**：当前页 + 下一页两个 16:9 预览（只发 `postMessage` 不重载 iframe）、备注编辑器（按 `data-slide-id` 存 localStorage，300ms 防抖）、计时（总时长 / 本页 / 计划 / 剩余超时）、排练记录（本地留最近 5 次）、宫格选页、三档布局（均衡 / 页面优先 / 备注优先）。
- **观众屏**：`window.open` 打开同文件 `?he-mode=audience`，藏掉 deck 自己的 HUD 和提示，只显示页面。
- **现场工具**：激光笔（L）、圈选（C）、清除（X）、观众屏黑屏（B）/ 白屏（W）/ 冻结（F）。坐标归一化后传给观众屏，不受两端尺寸差异影响。
- **同步与恢复**：`postMessage` + `BroadcastChannel` + `storage` 三通道，心跳 2.6 秒。状态机走 未连接 / 连接中 / 已同步 / 未同步 / 已冻结 / 弹窗被拦截 六态，「重新打开观众屏」始终可用，退出时发 `bye` 让观众窗收尾。
- **翻页适配**：优先用 deck 暴露的 `window.__heDeck.go()`；没有就派发键盘事件让 deck 自己的翻页逻辑走（老 deck 不用改，代价是慢一拍）。当前页从 `.slide.is-active` 读，`MutationObserver` 兜住外部翻页。

### 兼容处理
- 入口用 `Shift+P` 而不是 `P`：`P` 已被现场演示层占用为打印。
- 键盘接管挂 `window` 捕获阶段，比 deck 的 window 冒泡和另外两层的 document 捕获都早，演讲者视图里方向键只翻一次，不会双翻。
- 演讲者视图内的点击 `stopPropagation()`，挡住 deck 的「点半屏翻页」，同时视图里的按钮照常能点。
- 演讲者层所有 DOM 挂 `body`，一个不往 `.slide` 里塞，免疫可编辑层 `restore()` 的整段 innerHTML 重写。
- 覆盖物自带 `@media print` 隐藏，不依赖 deck 的打印清单。

### 验证
- 浏览器实测（Chrome 157 headless + CDP，1440×813）：在两份 deck 上各跑 17 项，全通过，页面异常 0。覆盖进视图、观众窗弹开与同步、双端翻页一致、预览不重载、宫格选页、计时暂停重置、排练记录、自动翻页引导、激光圈选清除、黑屏白屏冻结恢复、观众窗关闭后再打开、备注落盘、快捷键面板、演前检查、退出恢复舞台。
- 两条翻页路径都测了：有 `window.__heDeck` 钩子的（`examples/darktech-keynote.html`）和没有钩子靠模拟键盘兜底的。
- `node --test scripts/test/presenter.test.js`：5/5。
- `examples/darktech-keynote.html` 作为参照实现装好整层，附 12 页真实演讲备注（总计划 12.1 分钟），并加了 `window.__heDeck` 钩子。

### 已知边界
- 观众窗的全屏要自己按 F11。浏览器要求全屏必须由用户手势触发，演讲者屏的「检查」里那个按钮只能全屏演讲者自己那屏，文案已写明。
- 同步只能证明软件页面状态，不能检测 HDMI / 转接器 / 投影仪线缆是否物理断开。
- 老 deck 没有 `window.__heDeck` 时，翻页靠模拟键盘事件，预览会比主屏慢一拍。
## [1.4.2] - 2026-09-13

第二轮公开审查后的转换器加固，每条修复都带最小 fixture 回归测试（scripts/test/render-fidelity.test.js）。

### 修复 · 转换器（scripts/html2pptx.js）
- **分割线边框检测改四边取 max**。此前只读 borderTop：border-bottom 分割线颜色回退成 currentColor 变色，4px 分割线整条消失。
- **rgba alpha 通道保留**。此前半透明色全部转成全不透明；现填充/线条/文字色接 pptxgenjs transparency，同时兼容 CSS Color 4 空格语法。
- **opacity:0 祖先链下的内容不再漏进 PPT**。opacity 不继承，旧检查只看元素自身；现沿父链累积判定，三条文字/形状提取路径统一复用。
- **内联 run 保留自身字号**。此前 40px 标题内嵌 16px <span> 被整框压平成父级字号，大数字+小单位的视觉锤变形。
- **文本框 x/y/w/h clamp 到页面边界内**。此前贴右缘的框加余量后超出页宽，内容挂到幻灯片外。
- **文本去重 key 改用完整文本 + 丢弃时 console.warn 计数**。此前「同位置 + 前 24 字相同」的两个不同元素会被静默误杀。

### 新增 · 转换器
- **--offline 离线模式**：page.route 拦截一切非 file:// 请求直接 abort。转换来源不明的第三方 deck 时开启，防页面内嵌脚本外联。

### 修复 · CI
- **npm audit 提到 --audit-level=critical**。pptxgenjs 依赖的 image-size 有 2 个 high DoS 漏洞且上游无修复版，旧配置使 CI 必红；风险边界已写进 scripts/README，上游修复后随依赖升级消化。

## [1.4.1] - 2026-07-09

一次全仓库审查后的加固。多 agent 审出、主控逐条对着真实文件核实、html2pptx 的修复用真实 deck 跑通验证（深色 + 浅色各一份）。

### 修复 · 可编辑层（references/editable-layer.md）
- **自动保存不再把 `contenteditable` 写进 localStorage**。此前刷新后字段在放映态仍可编辑、还会吞掉方向键翻页。改成序列化前先克隆剥属性。
- **下载 HTML 时一并剥掉现场演示层的运行时覆盖物**（`.lb` 遮罩 / `.he-showbar`）。此前放大图开着时下载，导出文件会带一个关不掉的全屏遮罩，并重复注入。
- **编辑态点击不再误翻页**。此前点空白/拖选时 deck 的「点半屏翻页」会翻走当前页。改成编辑态吞掉除工具栏外的一切点击。六个样例内嵌的旧副本一并修。

### 修复 · 现场演示层（references/live-show-layer.md）
- **lightbox 打开时拦住全部翻页键**（补 PageUp/PageDown/上下键/Home/End）。此前翻页笔发的 PageDown 会在放大图背后连翻数页。
- **F / P 热键加修饰键和表单守卫**。此前 Cmd+F 查找会触发全屏、输入框里打含 f/p 的字会误触全屏和打印。
- **copyPrompt 兜底检查 execCommand 返回值**，复制失败如实提示，不再谎报「已复制」。
- **lightbox 改事件委托**，免疫可编辑层 restore() 的 innerHTML 替换（此前直绑监听器会被抹掉，点图无反应）。
- **打印隐藏复制/跳转按钮**（`[data-he-live]` 自动标记），与自家铁律对齐。

### 修复 · 转换器（scripts/html2pptx.js）
- **背景色回退链 slide → stage → body**。此前深色 deck 把底色画在 `.stage`/`body` 上时只读 `.slide` 拿到透明，PPT 落白底、浅色正文整页看不见。已用 darktech-keynote 实测：每页背景正确落 `#0A0A0A`。
- **页面加载用 `load` 而非 `networkidle`** + 字体就绪有界超时。此前 Google Fonts 挂起会拖满 30s 超时报错，字体兜底形同虚设。
- **带小图标的容器不再整块丢底色**（svg 占比 <80% 时容器底色/边框照常出）。
- **自带底色的文字元素**（CTA 按钮、徽章、chip）现在先铺色块再叠文字，不再只剩悬空文字。
- **SVG 截图失败留红色虚线占位框 + 控制台计数提示**，不再无声丢图。
- 浏览器探测补 `/snap/bin/chromium`、`/opt/google/chrome/chrome`、`microsoft-edge`。

### 修复 · 文档与样例
- **SKILL.md / README 的 html2pptx 用法命令**：`cd scripts && npm install` 后又跑 `scripts/html2pptx.js` 会找成 `scripts/scripts/...` 必失败，改为 `npm --prefix scripts install`，从仓库根一把跑通。
- README 项目结构树补上遗漏的 `scripts/` 目录。
- 样例 `campus-talk.html`：中文强调词此前套无 CJK 字形的 Anton + weight 400，强调反而比周围细，改回中文字体 900 + 强调色。

## [1.4.0] - 2026-07-02

现场演示层。来自一次真实线下培训交付（14 课 AI 课程、105 页分享 deck）的功能沉淀，全部实跑验证。

### 新增
- `references/live-show-layer.md`：现场演示层 drop-in。全屏按钮 + F 键、示例截图点击放大 lightbox（打开时接管键盘不翻页）、观众一键复制提示词（`data-prompt` + 「已复制」反馈 + execCommand 兜底）、现场跳转大按钮、P 键呼出打印。可与可编辑层共存，自动把「全屏」挂进同一条工具栏。
- 铁律沉淀：lightbox 打开时方向键只关图不翻页；点击翻页必须排除 `button,a`（否则观众点复制按钮时 deck 翻页）；演示层覆盖物全部不进打印。

### 生产规格更新（`references/deck-production-spec.md`）
- **vh/vw 打印崩版的根治法**：页内布局给 `.slide` 设 `container-type:size`，vh→cqh、vw→cqw 容器查询单位，屏幕端表现不变，打印端跟随 slide 实际尺寸。生成器一句正则收口，body 级覆盖层自动回退视口不用管。已在 105 页混排 deck 验证。
- 单文件带真实截图的做法：长边压到 ≤1600px 再 base64 内嵌，deck 拖到任何机器任何目录都能开。

## [1.3.0] - 2026-06-25

强化「科技 / 未来」气质方向，补一套当代 AI SaaS 配方。

### 新增
- 「科技 / 未来」方向在赛博霓虹之外补一套**当代 AI SaaS 配方**：碳黑电绿 / 深空电青 / 冰蓝，单色克制 + 网格辉光，对标 Linear / Vercel / Runway；写进 `references/aesthetic-directions.md`，并讲清和赛博霓虹（品红青 + 网格地平线）的区别。
- 新增样例 `examples/darktech-keynote.html`：虚构 Agent 编排控制台 HELM 发布会，12 页碳黑电绿单色 deck，签名时刻是巨数字 `8×` 与流程链。全脱敏（HELM 虚构、CTA 占位、末页标注「示例作品 · 非真实产品」）。

### 守规
- 辉光只用 box-shadow / radial-gradient，不碰 backdrop-filter；编辑层零宽字符用转义写法；中文字体系统兜底；复用通用可编辑层（点编辑改字 / 导出 PDF / 下载 HTML）。

## [1.2.0] - 2026-06-20

双格式交付。客户不一定会用浏览器编辑器，要一份能在 PowerPoint / WPS 里直接改的 .pptx。加了一个转换器，把同一份 HTML 设计源转成可编辑 PPTX，一份设计两种格式，不用做两遍。

### 新功能
- `scripts/html2pptx.js`：把一份 HeiGe-PPT 单文件 HTML deck 转成可编辑 .pptx。每个文字都是原生文本框，客户打开就能改字改价。
- 通用，不认版式 class。在无头 Chromium 里读 deck 的真实渲染几何（位置 / 字号 / 颜色 / 对齐），映射成 PPT 文本框、色块、线条，对任意 HeiGe-PPT deck 都成立。
- 自动探测系统已装的 Chrome / Chromium，跨 mac / Linux / Windows，零配置。
- 复杂图形（SVG 框架图、CSS 渐变）PPT 原生画不出来，转成同位置的图片嵌进 PPT，并在控制台明确提示哪几处不可在 PPT 里编辑。诚实降级，不硬转出崩的图。
- 用法：`node scripts/html2pptx.js deck.html deck.pptx`，详见 SKILL.md「第六步」。

### 健壮性
- 逐页隔离量取（一次只显示一页），杜绝相邻页元素几何和截图互相串入。
- 处理 `<br>` 强制换行、内联混排（黑字 + 红字高亮同行）、自动换行的多行段落，避免文字重叠、溢出窄卡、串到隔壁卡。
- 异常路径也关闭浏览器，不泄漏进程；文件加载失败、空 deck 明确报错，不静默产出退化文件。
- 文本框宽高按真实几何算，多行段落顶部对齐、单行居中对齐，治住 PPT 默认内边距导致的字下沉咬合。

## [1.1.2] - 2026-06-10

实体风险清理 + 工具栏位置修复。

### 修复
- 工具栏从左下角挪到右下角页码上方：原先 `left:16px;bottom:16px` 正好压住每套 deck 左下角的品牌标，5 套样例和 `references/editable-layer.md` 的 drop-in 代码同步改为 `right:16px;bottom:56px`，与页码、品牌标互不重叠。
- 编辑层正则里内嵌的裸零宽字符（U+200B）改为 `​` 转义写法，行为不变，源码不再藏不可见字符（5 套样例 + drop-in 代码共 6 处）。
- 示例提案 `consulting-proposal.html` 去真实实体关联：联系邮箱域名改用保留域 `.example`；虚构客户改名「雾屿优选」（经搜索验证无在营商家同名），并在文件头注释和末页页脚加「本案例纯属虚构」声明；预览图同步重做。
- 示例 deck 的 CTA 外链全部改为占位链接，不再指向真实站点。

### 文档
- README 安装命令改为 `git clone` 直接落到 `~/.claude/skills/heige-ppt`：目录名与 SKILL.md 的 `name: heige-ppt` 一致，也避免 `cp -r` 把 `.git` 一起拷进 skills 目录。
- SKILL.md frontmatter 规范化：`author` / `version` / `compatible_platforms` 挪进 `metadata`，顶层只留合法键。

## [1.1.1] - 2026-06-08

修导出 PDF 默认竖版的问题。

### 修复
- deck 是 16:9 横版，但浏览器打印对话框（尤其 Edge）不认 `@page` 的自定义像素尺寸，会退回 A4 竖版，把横版幻灯片塞进竖纸里溢出。改用 `@page{size:A4 landscape}` 命名纸张 + `landscape` 朝向关键词，打印对话框默认就是横版。
- 把 1280px 舞台用 `zoom` 缩到 A4 横版宽度，每页一张，文字仍是矢量真文字。彻底重置屏幕端的居中定位，避免缩放算错位置。
- 打印底部留白用底色填满不留白边：纯色 deck 直接用 `html,body` 底色；混色 deck（有深色分隔页）给深色页补 `box-shadow` 刷满那页留白。
- 五套样例全部更新，方法论写进 `references/deck-production-spec.md`。

## [1.1.0] - 2026-06-08

加可编辑功能。研究了一圈 HTML 幻灯片工具的做法，给成品加了一个在浏览器里直接改幻灯片文字的编辑层。

### 新功能
- 每套 deck 打开左下角有工具栏：点「编辑」进入编辑模式，标题、正文、数字、金句都能直接点进去改；「导出 PDF」「下载 HTML」「复位」。
- 放映模式下点进某一页的字段就能改，方向键这时交给光标移动、不翻页；点回空白处方向键恢复翻页（照搬 reveal.js 的焦点判断）。
- 改动自动存浏览器本地，刷新不丢。五套样例全部带上编辑层。

### 设计
- 字段级 contenteditable，不是整页可编辑，外层结构锁死。
- 导出 PDF 只走浏览器原生打印，每页一张，不用 html2pdf 那套截图方案（文字不可选、发虚）。所有编辑痕迹包在 `@media screen`，工具栏不进打印。粘贴只保留纯文本。
- 做成一段拖进 `</body>` 前就生效的 drop-in 代码，见 `references/editable-layer.md`，deck 和 HeiGe-Resume 共用。

## [1.0.0] - 2026-05-31

首个版本。

### 核心
- 原创方法论「导一场演出」，五道锻造工序：一页一句话 / 黄金三秒 / 节奏编排 / 视觉锤 / 反 AI 体检。
- 五步使用流程：定调 → 搭主线 → 编排节奏定视觉锤 → 写生产级代码 → 反 AI 体检。

### 设计资产
- `references/aesthetic-directions.md`：6 种气质方向库，每种给出色彩 / 字体 / 封面 / 视觉锤打法。
- `references/deck-pacing-templates.md`：路演 / 产品发布 / 复盘 / 提案 / 分享 五类 deck 的页面节奏模板。
- `references/deck-production-spec.md`：单文件 HTML 幻灯片硬规格（16:9 缩放 / 键盘翻页 / 中文字体兜底 / PDF 导出 / 性能），生产铁律从第一天内置。
- `references/anti-slop-checklist.md`：反 AI 体检清单，出货前逐条过。

### 样例画廊（同一套方法论 × 五种场景气质）
- `examples/heige-pitch.html`：HeiGe-PPT 自己的产品路演。凶悍 / 工业。
- `examples/product-keynote.html`：AI 产品发布会 keynote。科技 / 未来。
- `examples/annual-review.html`：团队年度复盘。克制 / 数据。
- `examples/consulting-proposal.html`：给客户的方案提案。优雅 / 高定。
- `examples/campus-talk.html`：一场技术分享演讲。张扬 / 人文。

全部为零依赖单文件，16:9 键盘翻页，中文带系统字体兜底，可 Cmd+P 导出 PDF，尊重 prefers-reduced-motion。
