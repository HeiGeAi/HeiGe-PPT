# scripts/html2pptx.js

HeiGe-PPT 的双格式交付转换器：把一份 HeiGe-PPT 单文件 HTML deck 转成可编辑的 `.pptx`。

客户不一定会用浏览器编辑器。要一份能在 PowerPoint / WPS 里直接改字改价的 PPT 时，用它把同一份 HTML 设计源转过去，一份设计两种格式。

## 用法

```bash
npm install                          # 首次：装 pptxgenjs + playwright-core
node html2pptx.js <deck.html> [out.pptx] [--offline]
```

不传第二个参数时，输出到与 HTML 同名的 `.pptx`。

`--offline` 离线模式：拦截并 abort 一切非 `file://` 网络请求（远程样式表、webfont、页面脚本外联全部断掉）。**转换来源不明的第三方 deck 时务必开启**：转换在本机 Chromium 里以 `file://` 加载 HTML，页面内嵌脚本会在转换窗口期运行，离线模式断了它的外网通道。自己产出的 deck 不需要开。

## 它怎么工作

在无头 Chromium 里打开 deck，逐页隔离量取每个文字块、色块、线条、SVG 的真实渲染几何（位置 / 字号 / 颜色 / 对齐），等比映射到 PowerPoint 的原生文本框、形状、图片。

- **通用**：读的是渲染后的几何，不认版式 class，对任意 HeiGe-PPT deck 都成立。
- **文字全可编辑**：一律转成原生文本框，不截图。
- **自动找浏览器**：优先用 playwright 缓存的 Chromium，没有就用系统装的 Chrome / Edge，跨 mac / Linux / Windows。

## 一条边界

SVG 框架图、CSS 渐变 / 纹理这类复杂图形，PPT 原生画不出来。转换器会把它们转成**同位置的图片**嵌进 PPT（不可在 PPT 里编辑），并在控制台明确提示哪几处。需要在 PPT 里编辑这些图，就用 PowerPoint 形状重画，或保留 HTML 版作为该图的可编辑源。

宁可诚实降级，不硬转出一个崩的图。

## 依赖

- [pptxgenjs](https://github.com/gitbrent/PptxGenJS) — 生成 .pptx
- [playwright-core](https://playwright.dev/) — 驱动系统已装的 Chromium / Chrome（不自带浏览器，复用你机器上已有的）

### 已知风险边界

pptxgenjs 依赖链里的 image-size 有 2 个 high severity DoS 漏洞（ICNS / JXL / HEIF 解析死循环，GHSA-w3rx-r6r6-pgpr、GHSA-5p2g-fcmc-qvqq），上游暂无修复版。本工具嵌入的图来自 playwright 对自家 deck 的截图，不解析外部不可信图片，实际可利用性低；CI 的 npm audit 已调到 `--audit-level=critical`，上游出修复版后随依赖升级消化。**勿用本工具转换内嵌不可信图片的来源不明 deck。**

没有任何浏览器时，跑一次 `npx playwright install chromium` 即可。

---

# scripts/inject-presenter.mjs

给一份 deck 装上演讲者层（演讲者屏看备注 + 观众屏同步）。契约见 `references/presenter-mode.md`。

## 用法

```bash
node inject-presenter.mjs <deck.html>            # 装上 / 刷新
node inject-presenter.mjs <deck.html> --dry-run  # 只看会改什么，不写盘
```

跑完要做一件事：打开 deck，补 `SPEAKER_NOTES` 里的 `purpose` / `talk` / `transition`。骨架会把 id 和标题对好，内容得人来写。

## 它改什么

1. 给每个 `<section class="slide">` 补 `data-slide-id` 和 `data-title`
2. 没有备注就插一份 `SPEAKER_NOTES` 骨架，条数与 id 跟页面一一对齐
3. 把 `assets/presenter-layer.html` 贴到 `</body>` 前（已装则整段替换）
4. deck 装了可编辑层时，把它「下载 HTML」的清理选择器补上本层三个 id

幂等：反复跑只刷新运行时片段，不会叠出第二份。

## scripts/validate-presenter-mode.mjs

静态校验：页面身份齐不齐、备注字段全不全、运行时片段装没装对、总时长有没有超标。

```bash
node validate-presenter-mode.mjs <deck.html> [--target-minutes 30] [--strict]
```

## 测试

```bash
node --test test/presenter.test.js                    # 注入器回归，5 条，不需要浏览器
node test/e2e-presenter.mjs examples/darktech-keynote.html   # 浏览器端实测，要本机 Chrome
```

`e2e-presenter.mjs` 手动跑，不进 CI（它要开窗口、要弹窗权限）。它跑七项核心链路：入口就位、进演讲者视图、观众窗同步、双端翻页一致、宫格选页、计时、退出恢复。
