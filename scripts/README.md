# scripts/html2pptx.js

HeiGe-PPT 的双格式交付转换器：把一份 HeiGe-PPT 单文件 HTML deck 转成可编辑的 `.pptx`。

客户不一定会用浏览器编辑器。要一份能在 PowerPoint / WPS 里直接改字改价的 PPT 时，用它把同一份 HTML 设计源转过去，一份设计两种格式。

## 用法

```bash
npm install                          # 首次：装 pptxgenjs + playwright-core
node html2pptx.js <deck.html> [out.pptx]
```

不传第二个参数时，输出到与 HTML 同名的 `.pptx`。

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

没有任何浏览器时，跑一次 `npx playwright install chromium` 即可。
