# Changelog

本项目所有重要变更记录于此。

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
