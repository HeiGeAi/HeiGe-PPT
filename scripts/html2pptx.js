#!/usr/bin/env node
/**
 * html2pptx.js — HeiGe-PPT 双格式交付转换器
 *
 * 把一份 HeiGe-PPT 单文件 HTML deck 转成可编辑的 .pptx。
 * 同一份 HTML 设计源，浏览器里读真实渲染几何（位置/字号/颜色/对齐），
 * 等比映射到 PowerPoint 文本框、色块、线条。客户拿 PPT 就能改字改价。
 *
 * 设计原则：
 *   - 通用，不认版式 class。读的是渲染后的几何，对任意 HeiGe-PPT deck 都成立。
 *   - 文字一律转成原生可编辑文本框（不截图）。
 *   - 纯色块、边框、细线还原成 PPT 形状。
 *   - 复杂图形（SVG 框架图等）无法无损转 → 转成同位置的图片占位，并在控制台明确提示人工补。
 *     宁可诚实降级，不硬转出一个崩的图。
 *
 * 用法：
 *   node html2pptx.js <deck.html> [out.pptx]
 *
 * 依赖：pptxgenjs、playwright-core（用系统已装的 Chromium / Chrome）。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const pptxgen = require("pptxgenjs");

// ---------- 舞台逻辑尺寸（与 deck-production-spec 一致：1280×720）→ PPT 13.33×7.5 英寸 ----------
const STAGE_W = 1280, STAGE_H = 720;
const IN_W = 13.333, IN_H = 7.5;
const PX2IN = IN_W / STAGE_W;            // px → inch
const px = (v) => +(v * PX2IN).toFixed(3);
// CSS px 字号 → pt。PPT 一个逻辑像素 = IN_W/STAGE_W 英寸，1 英寸 = 72pt。
const PT = (cssPx) => +(cssPx * PX2IN * 72).toFixed(1);

// ---------- 浏览器自动探测：playwright 缓存优先，系统 Chrome / Edge 兜底（跨平台） ----------
function findBrowser() {
  const cands = [];
  const home = os.homedir();
  const plat = process.platform;
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (plat === "win32" ? path.join(home, "AppData/Local/ms-playwright")
     : plat === "linux" ? path.join(home, ".cache/ms-playwright")
     : path.join(home, "Library/Caches/ms-playwright"));
  try {
    for (const dir of fs.readdirSync(pwRoot)) {
      if (!dir.startsWith("chromium")) continue;
      for (const sub of ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
                          "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
                          "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
                          "chrome-linux/chrome", "chrome-win/chrome.exe"]) {
        cands.push(path.join(pwRoot, dir, sub));
      }
    }
  } catch (e) { /* no playwright cache */ }
  cands.push(
    // mac
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // linux
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    // windows
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(home, "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  );
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

// ---------- 颜色工具 ----------
function rgbToHex(c) {
  if (!c) return null;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map(s => parseFloat(s.trim()));
  const a = p[3] === undefined ? 1 : p[3];
  if (a === 0) return null;                            // 全透明 → 当作无色
  const hex = p.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
  return hex.toUpperCase();
}
const isLightish = (hex) => {
  if (!hex) return true;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
};

// ---------- 中文字体兜底：webfont 名 → PPT 安全字体 ----------
function mapFont(family) {
  const f = (family || "").toLowerCase();
  if (/serif|song|宋|playfair|georgia|times/.test(f)) {
    if (/playfair|georgia|times|serif(?!.*sc)/.test(f) && !/noto|song|宋/.test(f)) return "Georgia";
    return "宋体";
  }
  if (/mono|consolas|courier/.test(f)) return "Consolas";
  return "微软雅黑";
}

async function extract(htmlPath) {
  const { chromium } = require("playwright-core");
  const { pathToFileURL } = require("url");
  const exe = findBrowser();
  if (!exe) throw new Error("找不到可用的 Chromium / Chrome。请装 Chrome，或运行 npx playwright install chromium。");
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: STAGE_W, height: STAGE_H }, deviceScaleFactor: 2 });
  const resp = await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" }).catch((e) => { throw new Error("无法加载 HTML: " + e.message); });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});  // 等 webfont 就绪
  await page.waitForTimeout(250);                       // 字体替换后再稳一帧
  // 关掉切页动画。注意：不强制所有页叠在 inset:0 同时可见——那会让一页的元素几何/截图
  // 串进相邻页。改为逐页「只显示当前页」隔离量取。
  await page.addStyleTag({ content: `*{transition:none!important;animation:none!important}
    .slide{transform:none!important}
    .slide.he-solo{opacity:1!important;visibility:visible!important;position:absolute!important;inset:0!important;z-index:9999!important}
    .slide.he-hide{opacity:0!important;visibility:hidden!important}` });

  const slideCount = await page.evaluate(() => document.querySelectorAll(".slide").length);
  if (!slideCount) throw new Error("这份 HTML 里没有 .slide 页面，不是 HeiGe-PPT deck？");

  // 单页几何提取函数（在浏览器里对「当前隔离可见」的那一页跑）
  const extractOne = (idx) => page.evaluate((idx) => {
    const stage = document.querySelector(".stage") || document.body;
    const slides = [...document.querySelectorAll(".slide")];
    const slide = slides[idx];
    const sr = stage.getBoundingClientRect();
    const sx = 1280 / sr.width, sy = 720 / sr.height;

    const cs = (el) => getComputedStyle(el);
    const visible = (el, r) => {
      const s = cs(el);
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05;
    };
    const hasDirectText = (el) => {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim() !== "") return true;
      return false;
    };
    // 相对舞台的逻辑坐标
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - sr.left) * sx, y: (r.top - sr.top) * sy, w: r.width * sx, h: r.height * sy, raw: r };
    };

    const out = { texts: [], shapes: [], svgs: [], bg: null };
    out.bg = cs(slide).backgroundColor;

      // 背景色块 / 边框 / 细线：非文字、有可见背景或边框的块
      const blockSel = "div,section,span,header,aside,figure,hr";
      slide.querySelectorAll(blockSel).forEach((el) => {
        if (hasDirectText(el)) return;                  // 文字块走文字通道
        if (el.querySelector("svg")) return;            // 交给 svg 通道
        const r = rectOf(el);
        if (!visible(el, r.raw)) return;
        const s = cs(el);
        const bg = s.backgroundColor;
        const hasBg = bg && !/rgba?\(0, 0, 0, 0\)|transparent/.test(bg);
        const bw = parseFloat(s.borderTopWidth) || 0;
        const hasBorder = bw > 0 && !/rgba?\(0, 0, 0, 0\)/.test(s.borderTopColor);
        const thinLine = (r.h <= 3 && r.w > 6) || (r.w <= 3 && r.h > 6);  // 细分割线
        if (!hasBg && !hasBorder && !thinLine) return;
        out.shapes.push({
          x: r.x, y: r.y, w: r.w, h: r.h,
          fill: hasBg ? bg : null,
          border: hasBorder ? { color: s.borderTopColor, w: bw } : null,
          line: (!hasBg && !hasBorder && thinLine) ? (r.h <= 3 ? "h" : "v") : null,
          lineColor: bg && !/rgba?\(0, 0, 0, 0\)/.test(bg) ? bg : s.borderTopColor,
        });
      });

      // SVG：记录位置 → 转图占位。给入选 svg 打标记，保证后续截图与几何数组下标一一对应。
      slide.querySelectorAll("svg").forEach((el) => {
        const r = rectOf(el);
        if (r.w > 8 && r.h > 8) { el.setAttribute("data-he-svg", "1"); out.svgs.push({ x: r.x, y: r.y, w: r.w, h: r.h }); }
      });

      // 文字：取「自身带直接文字」的块。含 block 级子元素的容器不整段取，
      // 而是用 Range 精确量取「该块自身直接文字」的几何，各成一框，
      // 避免 line-height / display:block 子元素折行导致的几何错位与重叠，也不丢失直接文字。
      const textSel = "h1,h2,h3,h4,h5,h6,p,li,span,div,a,b,strong,em,i,blockquote,figcaption,cite,td,th";
      const seen = new Set();
      const hasBlockChild = (el) => {
        for (const c of el.children) {
          const d = cs(c).display;
          if (d === "block" || d === "flex" || d === "grid" || d === "list-item" || d === "table") return true;
        }
        return false;
      };
      // 量取一组「直接子节点」（文本节点 + 内联元素）的合并包围盒
      const directRect = (el) => {
        const rng = document.createRange();
        let lo = Infinity, to = Infinity, ro = -Infinity, bo = -Infinity, got = false;
        el.childNodes.forEach((n) => {
          const isInlineEl = n.nodeType === 1 && /^(inline|inline-block|inline-flex)$/.test(cs(n).display);
          if (n.nodeType === 3 ? n.textContent.trim() !== "" : isInlineEl) {
            try {
              rng.selectNodeContents(n.nodeType === 3 ? n : n);
              const rr = (n.nodeType === 3 ? rng.getBoundingClientRect() : n.getBoundingClientRect());
              if (rr.width || rr.height) { lo = Math.min(lo, rr.left); to = Math.min(to, rr.top); ro = Math.max(ro, rr.right); bo = Math.max(bo, rr.bottom); got = true; }
            } catch (e) {}
          }
        });
        if (!got) return null;
        return { x: (lo - sr.left) * sx, y: (to - sr.top) * sy, w: (ro - lo) * sx, h: (bo - to) * sy,
                 raw: { left: lo, top: to, width: ro - lo, height: bo - to } };
      };
      const pushText = (el, r) => {
        const s = cs(el);
        const runs = [];
        el.childNodes.forEach((n) => {
          if (n.nodeType === 3) {
            const t = n.textContent.replace(/\s+/g, " ");
            if (t.trim()) runs.push({ text: t, color: s.color, bold: +s.fontWeight >= 600, italic: s.fontStyle === "italic" });
          } else if (n.nodeType === 1 && n.tagName === "BR") {
            runs.push({ br: true });                    // 保留 <br> 强制换行结构
          } else if (n.nodeType === 1 && /^(inline|inline-block|inline-flex)$/.test(cs(n).display)) {
            const ss = getComputedStyle(n);
            const t = n.textContent.replace(/\s+/g, " ");
            if (t.trim()) { runs.push({ text: t, color: ss.color, bold: +ss.fontWeight >= 600, italic: ss.fontStyle === "italic" });
              n.setAttribute("data-he-consumed", "1"); }   // 标记：已并入父块，勿再单独成框
          }
        });
        if (!runs.some(x => x.text)) return;
        const key = Math.round(r.x) + ":" + Math.round(r.y) + ":" + runs.map(x => x.text || "↵").join("").trim().slice(0, 24);
        if (seen.has(key)) return; seen.add(key);
        const lines = runs.filter(x => x.br).length + 1;  // <br> 行数
        out.texts.push({
          x: r.x, y: r.y, w: r.w, h: r.h, runs, lines,
          font: s.fontFamily, size: parseFloat(s.fontSize),
          align: s.textAlign === "center" ? "center" : s.textAlign === "right" || s.textAlign === "end" ? "right" : "left",
          letter: parseFloat(s.letterSpacing) || 0,
          lh: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2,
        });
      };
      slide.querySelectorAll(textSel).forEach((el) => {
        if (el.hasAttribute("data-he-consumed")) return;  // 已被父块并入，勿重复成框
        if (!hasDirectText(el)) return;
        if (hasBlockChild(el)) {
          // 混合块：只把它自己的直接文字 + 内联段量成一框，block 子元素留给后续遍历各自成框
          const dr = directRect(el);
          if (dr && dr.w > 1 && dr.h > 1) pushText(el, dr);
          return;
        }
        const r = rectOf(el);
        if (!visible(el, r.raw)) return;
        pushText(el, r);
      });
    return out;
  }, idx);

  // 逐页隔离量取：只显示第 idx 页，量完几何 + 截该页 SVG，再切下一页。
  const slidesData = [];
  for (let i = 0; i < slideCount; i++) {
    await page.evaluate((i) => {
      const slides = [...document.querySelectorAll(".slide")];
      slides.forEach((s, k) => {
        s.classList.remove("he-solo", "he-hide");
        s.classList.add(k === i ? "he-solo" : "he-hide");
      });
    }, i);
    await page.waitForTimeout(60);
    const sd = await extractOne(i);
    // 截本页 SVG（此刻只有本页可见，截图不会串入相邻页背景）。
    // 用 data-he-svg 标记选取，与 out.svgs 的入选口径一致，避免小图标导致下标错位。
    if (sd.svgs.length) {
      const svgEls = await page.$$(".slide.he-solo svg[data-he-svg]");
      for (let j = 0; j < sd.svgs.length && j < svgEls.length; j++) {
        try {
          const buf = await svgEls[j].screenshot({ type: "png", omitBackground: true });
          sd.svgs[j].data = "data:image/png;base64," + buf.toString("base64");
        } catch (e) { sd.svgs[j].data = null; }
      }
    }
    slidesData.push(sd);
  }

  return slidesData;
  } finally {
    await browser.close().catch(() => {});               // 异常路径也关闭浏览器，杜绝进程泄漏
  }
}

function build(slidesData, outPath) {
  const pres = new pptxgen();
  pres.defineLayout({ name: "HE16x9", width: IN_W, height: IN_H });
  pres.layout = "HE16x9";
  pres.author = "HeiGe-PPT";
  pres.title = path.basename(outPath, ".pptx");

  let svgWarnings = 0;
  slidesData.forEach((sd) => {
    const s = pres.addSlide();
    const bgHex = rgbToHex(sd.bg);
    if (bgHex) s.background = { color: bgHex };

    // 1) 背景块 / 边框 / 线 先铺底
    sd.shapes.forEach((sp) => {
      if (sp.line) {
        const col = rgbToHex(sp.lineColor) || "B6AB95";
        if (sp.line === "h") s.addShape(pres.shapes.LINE, { x: px(sp.x), y: px(sp.y + sp.h / 2), w: px(sp.w), h: 0, line: { color: col, width: Math.max(0.5, sp.h * 0.75) } });
        else s.addShape(pres.shapes.LINE, { x: px(sp.x + sp.w / 2), y: px(sp.y), w: 0, h: px(sp.h), line: { color: col, width: Math.max(0.5, sp.w * 0.75) } });
        return;
      }
      const fill = rgbToHex(sp.fill);
      const opt = { x: px(sp.x), y: px(sp.y), w: px(sp.w), h: px(sp.h) };
      opt.fill = fill ? { color: fill } : { type: "none" };
      opt.line = sp.border ? { color: rgbToHex(sp.border.color) || "999999", width: Math.max(0.5, sp.border.w * 0.75) } : { type: "none" };
      s.addShape(pres.shapes.RECTANGLE, opt);
    });

    // 2) SVG 占位图（同位置）
    sd.svgs.forEach((sv) => {
      if (sv.data) {
        s.addImage({ data: sv.data, x: px(sv.x), y: px(sv.y), w: px(sv.w), h: px(sv.h) });
        svgWarnings++;
      }
    });

    // 3) 文字（最上层，原生可编辑）
    sd.texts.forEach((t) => {
      // run 序列：把 <br> 标记转成「在前一段挂 breakLine」。
      const runs = [];
      t.runs.forEach((r) => {
        if (r.br) { if (runs.length) runs[runs.length - 1].options.breakLine = true; return; }
        runs.push({
          text: r.text,
          options: {
            color: rgbToHex(r.color) || (isLightish(bgHex) ? "222B28" : "F4EFE6"),
            bold: r.bold, italic: r.italic, breakLine: false,
          },
        });
      });
      if (!runs.length) return;
      const lines = t.lines || 1;
      // 字号：HTML px → pt，PPT 中文字面略大，乘 0.92 收一档，避免行间咬合。
      const sizePt = Math.max(7, +(PT(t.size) * 0.92).toFixed(1));
      // 文本框高度：区分三种情况。
      const lineIn = PT(t.size) / 72 * 1.18;             // 单行高度（英寸）
      const realH = px(t.h);                             // HTML 实测块高
      const autoMulti = lines === 1 && realH > lineIn * 1.6;  // 自动换行的多行段落（无 <br>，但实测占多行）
      let boxH, valign, ytop;
      if (autoMulti) {
        // 多行段落：用实测高，从顶部往下排（居中会让首行上飘、末行骑到卡片下边）。
        boxH = realH + lineIn * 0.35;
        valign = "top";
        ytop = px(t.y) - 0.02;
      } else {
        // 单行 / <br> 控制的多行：按行数算高，居中对齐到原始几何中线，避免 PPT 默认上内边距让字下沉。
        boxH = lines > 1 ? lineIn * lines : Math.max(realH, lineIn);
        valign = "middle";
        ytop = px(t.y) + realH / 2 - boxH / 2;
      }
      // 宽度：用 HTML 真实宽 + 小余量，让 PPT 在原始宽度内换行，不强行拉宽（拉宽会溢出窄卡、串到隔壁）。
      const boxW = px(t.w) + (lines > 1 ? 0.08 : 0.22);
      const boxX = t.align === "right" ? px(t.x) - 0.06 : px(t.x) - 0.04;
      s.addText(runs, {
        x: boxX, y: ytop, w: boxW, h: boxH,
        fontFace: mapFont(t.font),
        fontSize: sizePt,
        align: t.align,
        valign,
        margin: 0,
        charSpacing: t.letter ? +(t.letter * PX2IN * 72).toFixed(1) : 0,
        lineSpacingMultiple: 1.0,
      });
    });
  });

  return pres.writeFile({ fileName: outPath }).then(() => svgWarnings);
}

(async () => {
  const [, , inArg, outArg] = process.argv;
  if (!inArg) { console.error("用法: node html2pptx.js <deck.html> [out.pptx]"); process.exit(1); }
  const htmlPath = path.resolve(inArg);
  if (!fs.existsSync(htmlPath)) { console.error("找不到文件:", htmlPath); process.exit(1); }
  const outPath = path.resolve(outArg || htmlPath.replace(/\.html?$/i, "") + ".pptx");

  console.log("→ 读取 deck 渲染几何 …");
  const data = await extract(htmlPath);
  console.log(`→ 解析到 ${data.length} 页，开始生成可编辑 PPTX …`);
  const svgN = await build(data, outPath);
  console.log("✓ 已生成:", outPath);
  if (svgN > 0) {
    console.log(`\n⚠ 提示：本 deck 有 ${svgN} 处复杂图形（SVG 框架图等）以图片形式嵌入 PPT，无法在 PPT 里编辑。`);
    console.log("  如需在 PPT 中编辑这些图，请用 PowerPoint 的形状重画，或保留 HTML 版作为该图的可编辑源。");
  }
})().catch((e) => { console.error("转换失败:", e.message); process.exit(1); });
