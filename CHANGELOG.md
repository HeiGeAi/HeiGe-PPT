# Changelog

本项目所有重要变更记录于此。

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
