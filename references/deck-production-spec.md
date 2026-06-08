# 单文件 HTML 幻灯片 生产硬规格（Deck Production Spec）

照着这份规格做，做出来的 deck 能投屏、能键盘翻页、能导出 PDF、中文不崩、不卡。
这些是交付门槛，不是建议。

---

## 一、骨架与尺寸

- **单文件**：CSS 写在 `<style>`，JS 写在 `<script>`，零依赖（除 Google Fonts）。无外部图片，视觉用 CSS / SVG / 渐变做。
- **16:9**：每页一个 `<section class="slide">`，宽高比锁 16:9。
- **铺满视口且不变形**：用一个固定逻辑尺寸（如 1280×720）的舞台容器，按视口缩放居中（`transform: scale()` 适配，或用 `min(vw, vh)` 体系）。两侧/上下留黑边而不是拉伸。
- `lang="zh-CN"`、`<meta viewport>`、真实 `<title>`。

## 二、翻页与导航（必做）

- **键盘**：`→` / `空格` / `PageDown` 下一页，`←` / `PageUp` 上一页，`Home` 回首页，`End` 到末页。
- **页码 + 进度**：角落显示「当前 / 总数」，可加一条进度条或圆点指示。
- **可选**：点击右半屏下一页、左半屏上一页；触屏左右滑动。
- 翻页用 `transform: translateX()` 或透明度切换，**只动 transform / opacity**，别动 layout 属性。
- 切页动画控制在 300ms 内，给一种利落感，别拖。

## 三、中文字体（必做，别重蹈覆辙）

- 中文字体栈**必须**带系统兜底，Google Fonts 加载失败或被墙时也要正常显示：
  `"<中文 webfont>", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif`
- 中文**不要**用日文字体（如 Mochiy Pop One、Zen Maru Gothic、M PLUS）来渲染，会缺字 / 出异体字。中文展示字找简体中文字体（思源黑体 Noto Sans SC、思源宋体 Noto Serif SC、ZCOOL 系列、霞鹜文楷 LXGW WenKai 等）。
- 拉丁展示字体也带系统兜底（如 `"Anton", Impact, sans-serif`）。
- 投屏字号要大：正文最小别低于逻辑像素 22px，标题往 48px 以上走，金句 / 大数字敢上 120px+。

## 四、排版铁律（零孤字）

- 大标题折行**不许把单字或标点甩到独立一行**。手段：标题按最长一行收敛字号 + 整行锁不折断（`white-space:nowrap` 配 clamp 字号），或给容器留足宽度。
- **不要用 `ch` 给中文限宽**。`ch` 是拉丁数字宽，远窄于中文字宽，会算错导致溢出 / 折行。中文限宽用 `em` 或百分比 / 固定像素。
- 居中多行文字用 `text-wrap: balance` 让换行均衡。
- 一页内元素对齐到网格，别东一个西一个。

## 五、性能（不卡）

- 不要对 `text-shadow` / `box-shadow` 做动画（逐帧重绘）。要发光就用静态阴影。
- 不要用 `backdrop-filter`（投屏机器常常带不动）。
- 不要给带 `filter: blur()` 的元素做位移 / 缩放动画。
- 装饰性无限动画最多留一个，且只动 `transform` / `opacity`。
- 尊重 `prefers-reduced-motion: reduce`，关掉非必要动画。

## 六、导出 PDF / 打印（必做，横版）

deck 是 16:9 横版，导出 PDF 必须默认横版。这里有个坑：`@page{size:1280px 720px}` 这种自定义像素尺寸，浏览器（尤其 Edge）的打印对话框不认，会退回 A4 竖版，把横版幻灯片塞进竖纸里溢出。**只有 `landscape` 朝向关键词的命名纸张能让对话框默认横版**，所以走 `@page{size:A4 landscape}`，再把 1280 的舞台缩到 A4 横版宽度。

```css
@media print{
  @page{ size:A4 landscape; margin:0 }
  /* 彻底重置屏幕端的居中定位，否则 zoom 会算错位置、封面跑到页面外 */
  html,body{ height:auto!important; overflow:visible!important; background:<deck主色> }
  .stage{ position:static!important; top:auto!important; left:auto!important;
          transform:none!important; width:1280px; height:auto; overflow:visible; zoom:.876 }
  .slide{ position:relative!important; inset:auto!important; opacity:1!important;
          visibility:visible!important; transform:none!important; transition:none!important;
          width:1280px; height:720px; overflow:hidden;
          page-break-after:always; break-after:page; background:<该页底色>;
          -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .hud,.bar,.brandmark,.hint{ display:none!important }
}
```

- `zoom:.876` 把 1280px 舞台缩到 A4 横版可印宽度（297mm≈1122px），每页一张，文字仍是矢量真文字。
- **留白用底色填满，不留白边**：A4 横版不是 16:9，每页底部会空出约 162px。`html,body{background}` 设成 deck 主色，纯色 deck 直接无缝。混色 deck（有深色分隔页）给深色页补一句 `box-shadow:0 185px 0 0 <深色>`，把那页的留白用自己的底色刷满，照样无缝。
- 强制显示全部页（关掉「一次一页」的隐藏），首屏封面就是第 1 页。
- 这样用户 Cmd+P「另存为 PDF」或点编辑层「导出 PDF」，默认就是横版、每页一张的演示稿。

## 七、可用性细节

- 首屏（封面）默认就是第 1 页，打开即用，不依赖任何交互才显示内容。
- 任何滚动揭示 / 计数动画要有降级：静态可见，或 setTimeout 兜底，保证截图 / 打印不空白。
- 深色背景 deck 注意对比度，浅色文字别糊在亮背景上。

---

## 最小骨架参考（结构示意，不是成品）

```html
<div class="stage">            <!-- 16:9 舞台，按视口缩放居中 -->
  <section class="slide is-active">…封面…</section>
  <section class="slide">…一页一句话…</section>
  …
</div>
<div class="hud"><span id="pageNow">01</span> / <span id="pageAll">12</span></div>
<script>
  const slides=[...document.querySelectorAll('.slide')]; let i=0;
  const show=n=>{i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach((s,k)=>s.classList.toggle('is-active',k===i));
    pageNow.textContent=String(i+1).padStart(2,'0');};
  addEventListener('keydown',e=>{
    if(['ArrowRight',' ','PageDown'].includes(e.key)){e.preventDefault();show(i+1);}
    if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(i-1);}
    if(e.key==='Home')show(0); if(e.key==='End')show(slides.length-1);
  });
  pageAll.textContent=String(slides.length).padStart(2,'0'); show(0);
</script>
```
舞台缩放、切页动画、进度条、打印样式按各 deck 的气质在此之上发挥。
