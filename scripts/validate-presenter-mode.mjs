#!/usr/bin/env node
/**
 * validate-presenter-mode.mjs：HeiGe-PPT 演讲者模式静态校验器
 *
 * 校验一份单文件 deck 有没有把「演讲者模式」drop-in 层装对、装全：
 *   A 组 页面契约：.slide 页数、data-slide-id 是否小写 slug 且唯一、data-title 是否齐全
 *   B 组 演讲备注：SPEAKER_NOTES 能否解析、条数、id 对齐、必填字段、时长预算
 *   C 组 运行时片段：主视图、双预览、宫格、计时、标注、同步、打印排除等结构是否齐
 *
 * 用法：
 *   node scripts/validate-presenter-mode.mjs <deck.html> [--target-minutes 30] [--strict]
 *
 * 退出码：有 error 1，只有 warning 0，参数或文件错误 2。
 * 依赖：只用 node: 内置模块，零外部依赖。
 *
 * 事实来源：assets/presenter-layer.html（成品片段）。检查项里的字符串全部先在成品里 grep 验证过，
 * 成品改了这里要跟着改，否则会出现「层没坏、校验器说坏」的假报。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const USAGE = `用法：node scripts/validate-presenter-mode.mjs <deck.html> [--target-minutes 30] [--strict]
  <deck.html>            要校验的单文件 HTML deck
  --target-minutes 30    目标讲演时长（分钟），用来核算总计划时长
  --strict               缺 data-slide-id 时从 warning 升级为 error`;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_NOTE_FIELDS = ["id", "title", "purpose", "transition"];
const OPTIONAL_NOTE_FIELDS = ["cue", "interaction", "delivery", "advance", "fallback", "pronunciation"];

// ---------- 参数 ----------
function usageError(message) {
  console.error(`参数错误：${message}`);
  console.error(USAGE);
  process.exit(2);
}

const argv = process.argv.slice(2);
let deckPath = "";
let strict = false;
let targetMinutes = Number.NaN;
let targetGiven = false;

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--strict") {
    strict = true;
    continue;
  }
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  if (arg === "--target-minutes" || arg.startsWith("--target-minutes=")) {
    if (targetGiven) usageError("--target-minutes 只能给一次");
    targetGiven = true;
    const raw = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
    targetMinutes = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(targetMinutes) || targetMinutes <= 0) {
      usageError(`--target-minutes 需要大于 0 的数字，收到 ${raw === undefined ? "空值" : JSON.stringify(raw)}`);
    }
    continue;
  }
  if (arg.startsWith("-")) usageError(`不认识的参数 ${arg}`);
  if (deckPath) usageError(`一次只校验一份 deck，多给了 ${arg}`);
  deckPath = arg;
}

if (!deckPath) usageError("缺少 deck HTML 路径");

let html = "";
try {
  html = readFileSync(deckPath, "utf8");
} catch (error) {
  console.error(`读不到文件：${deckPath}（${error && error.message ? error.message : String(error)}）`);
  process.exit(2);
}

// 注释里可能留着旧的 section / 备注示例，先剥掉再扫，避免把注释当结构。
const source = html.replace(/<!--[\s\S]*?-->/g, "");
const errors = [];
const warnings = [];
const error = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
const has = (needle) => source.includes(needle);
const describeType = (value) => {
  if (Array.isArray(value)) return "数组";
  if (value === null) return "null";
  return typeof value;
};

// ---------- 小工具 ----------
function readAttr(tag, name) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(tag);
  if (!match) return "";
  const value = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3];
  return (value || "").trim();
}

// 从 from 之后找第一个 {，按花括号配平取出整块内容（不含最外层花括号）。
function readBraceBlock(text, from) {
  const open = text.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1);
}

// 取一个具名函数体；成品里 fitPresenterFrames 只调 fitFrame，16/9 换算写在 fitFrame 里。
function functionBody(name) {
  const pattern = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, "g");
  const match = pattern.exec(source);
  if (!match) return "";
  return readBraceBlock(source, match.index + match[0].length - 1);
}

// ---------- A 组：页面契约 ----------
const slideTags = [];
const sectionPattern = /<section\b[^>]*>/gi;
let sectionMatch = sectionPattern.exec(source);
while (sectionMatch) {
  const tag = sectionMatch[0];
  const className = readAttr(tag, "class");
  if (className && className.split(/\s+/).includes("slide")) {
    // 注入器写坏引号时，属性文本会混进 class 值里，浏览器因此认不出 data-slide-id。
    if (className.includes("=")) {
      warn(`第 ${slideTags.length + 1} 页的 <section> 标签写法有问题：class 值里混进了属性文本（${className}），浏览器读不到 data-slide-id，建议重跑注入器。`);
    }
    slideTags.push(tag);
  }
  sectionMatch = sectionPattern.exec(source);
}

const slideIds = slideTags.map((tag) => readAttr(tag, "data-slide-id"));
const slideTitles = slideTags.map((tag) => readAttr(tag, "data-title"));

if (!slideTags.length) {
  error('这份 HTML 里没有 .slide 页面：演讲者层只认 <section class="slide">，先确认 deck 结构再校验。');
}

slideIds.forEach((id, index) => {
  const pageNo = index + 1;
  const fallbackId = `slide-${String(pageNo).padStart(2, "0")}`;
  if (!id) {
    const reason = `演讲时备注按 ${fallbackId} 兜底，页面一重排就会串页`;
    if (strict) error(`第 ${pageNo} 页缺 data-slide-id：${reason}，--strict 下必须补齐。`);
    else warn(`第 ${pageNo} 页缺 data-slide-id：${reason}（加 --strict 可升级为 error）。`);
    return;
  }
  if (!SLUG_PATTERN.test(id)) {
    error(`第 ${pageNo} 页 data-slide-id="${id}" 不是小写 slug：只允许 a-z、0-9 和单个中划线，例如 product-keynote。`);
  }
});

const seenIds = new Set();
const duplicateIds = new Set();
for (const id of slideIds) {
  if (!id) continue;
  if (seenIds.has(id)) duplicateIds.add(id);
  seenIds.add(id);
}
if (duplicateIds.size) {
  error(`data-slide-id 重复：${[...duplicateIds].join("、")}。演讲者备注按 id 取稿，重复会让后一页拿到前一页的稿子。`);
}

slideTitles.forEach((title, index) => {
  if (!title) {
    warn(`第 ${index + 1} 页缺 data-title：演讲者视图的页码标题会退回显示 ${slideIds[index] || `第 ${index + 1} 页`}。`);
  }
});

// ---------- B 组：演讲备注 ----------
const ARRAY_MARKERS = [
  /(?:const|let|var)\s+SPEAKER_NOTES\s*=/g,
  /(?:window\.|globalThis\.)?__HE_SPEAKER_NOTES__\s*=/g,
];

// 括号配平扫描：跳过字符串与注释，避免 talk 文案里的 [ ] 提前截断数组。
function scanArrayEnd(text, start) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractArraySource() {
  for (const marker of ARRAY_MARKERS) {
    marker.lastIndex = 0;
    let match = marker.exec(source);
    while (match) {
      const valueStart = match.index + match[0].length;
      const rest = source.slice(valueStart);
      const leading = rest.length - rest.replace(/^\s+/, "").length;
      if (rest[leading] === "[") {
        const start = valueStart + leading;
        const end = scanArrayEnd(source, start);
        if (end > start) return { text: source.slice(start, end + 1), start, end };
      }
      match = marker.exec(source);
    }
  }
  return null;
}

const foundNotes = extractArraySource();
let notes = [];
let notesParsed = false;

if (!foundNotes) {
  error('找不到 SPEAKER_NOTES：先跑 node scripts/inject-presenter.mjs <deck.html> 生成骨架，或手写 const SPEAKER_NOTES = [...]（也可以 window.__HE_SPEAKER_NOTES__ = [...]）。');
} else {
  try {
    const parsed = vm.runInNewContext(`(${foundNotes.text})`, Object.create(null), { timeout: 2000 });
    if (Array.isArray(parsed)) {
      notes = parsed;
      notesParsed = true;
    } else {
      error(`SPEAKER_NOTES 必须是数组，当前解析出 ${describeType(parsed)}。`);
    }
  } catch (parseError) {
    error(`SPEAKER_NOTES 解析失败：${parseError.message}。常见原因是字符串没闭合、对象少了逗号，或数组里写了模板变量。`);
  }
}

if (notesParsed) {
  if (notes.length !== slideTags.length) {
    error(`备注 ${notes.length} 条、页面 ${slideTags.length} 页，条数对不上：每页一条，顺序对齐。`);
  }

  notes.forEach((note, index) => {
    const pageNo = index + 1;
    if (!note || typeof note !== "object" || Array.isArray(note)) {
      error(`第 ${pageNo} 条备注必须是对象，当前是 ${describeType(note)}。`);
      return;
    }
    const noteId = typeof note.id === "string" ? note.id.trim() : "";
    const label = noteId ? `第 ${pageNo} 条备注（${noteId}）` : `第 ${pageNo} 条备注`;

    for (const field of REQUIRED_NOTE_FIELDS) {
      if (typeof note[field] !== "string" || !note[field].trim()) {
        error(`${label}的 ${field} 必须是非空字符串。`);
      }
    }

    if (slideIds[index] && noteId && noteId !== slideIds[index]) {
      error(`第 ${pageNo} 条备注 id "${noteId}" 与第 ${pageNo} 页 data-slide-id "${slideIds[index]}" 不一致：演讲者视图按 id 取稿，这条会取不到。`);
    }

    if (!Array.isArray(note.talk)) {
      error(`${label}的 talk 必须是字符串数组，当前是 ${describeType(note.talk)}。`);
    } else {
      if (!note.talk.length) {
        error(`${label}的 talk 是空数组：至少写一条讲述要点。`);
      } else {
        note.talk.forEach((item, itemIndex) => {
          if (typeof item !== "string" || !item.trim()) {
            error(`${label}的 talk[${itemIndex}] 必须是非空字符串。`);
          }
        });
        if (note.talk.length < 3 || note.talk.length > 5) {
          warn(`${label}的 talk 有 ${note.talk.length} 条，3 到 5 条更好讲。`);
        }
      }
    }

    for (const field of ["minutes", "autoAdvanceSeconds"]) {
      const value = note[field];
      if (value === undefined || value === null || value === "") continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        error(`${label}的 ${field} 必须是大于 0 的数字，当前是 ${JSON.stringify(value)}。`);
      } else if (typeof value !== "number") {
        warn(`${label}的 ${field} 写成了字符串，建议改成数字。`);
      }
    }

    if (note.section !== undefined && note.section !== null) {
      if (typeof note.section === "string") {
        if (!note.section.trim()) error(`${label}的 section 是空字符串：删掉这个字段，或填上章节名。`);
      } else {
        warn(`${label}的 section 建议用字符串，当前是 ${describeType(note.section)}。`);
      }
    }

    for (const field of OPTIONAL_NOTE_FIELDS) {
      const value = note[field];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "string") {
        if (!value.trim()) error(`${label}的 ${field} 是空白字符串：删掉这个字段，或写点内容。`);
        continue;
      }
      if (Array.isArray(value)) {
        if (!value.length) {
          error(`${label}的 ${field} 是空数组：删掉这个字段，或写点内容。`);
          continue;
        }
        const badItem = value.some((item) => typeof item !== "string" || !item.trim());
        if (badItem) error(`${label}的 ${field} 数组里必须全是非空字符串。`);
        continue;
      }
      error(`${label}的 ${field} 只能是字符串或字符串数组，当前是 ${describeType(value)}。`);
    }
  });

  // 成品运行时读的是 window.__HE_SPEAKER_NOTES__，顶层 const 不会挂到 window 上。
  const constOnly = /(?:const|let|var)\s+SPEAKER_NOTES\s*=\s*\[/.test(source);
  const windowAssignment = /(?:window\.|globalThis\.)?__HE_SPEAKER_NOTES__\s*=(?!=)/.test(source);
  if (constOnly && !windowAssignment) {
    warn("备注写成了 const SPEAKER_NOTES，但演讲者层读的是 window.__HE_SPEAKER_NOTES__，const 不会挂到 window 上，演讲时备注会是空的。补一行 window.__HE_SPEAKER_NOTES__ = SPEAKER_NOTES; 即可。");
  }
}

// 总时长核算：只有填齐 minutes 才算得准，部分填了就说清楚跳过。
const timedNotes = notesParsed
  ? notes.filter((note) => note && typeof note === "object" && Number.isFinite(Number(note.minutes)) && Number(note.minutes) > 0)
  : [];
const plannedMinutes = timedNotes.reduce((sum, note) => sum + Number(note.minutes), 0);
const completePlan = notesParsed && notes.length > 0 && notes.length === slideTags.length && timedNotes.length === notes.length;

if (targetMinutes > 0) {
  if (completePlan && plannedMinutes > targetMinutes * 0.9) {
    error(`计划 ${plannedMinutes.toFixed(1)} 分钟，超过 ${targetMinutes} 分钟目标的 90%（上限 ${(targetMinutes * 0.9).toFixed(1)} 分钟），现场讲不完。`);
  }
  if (completePlan && plannedMinutes < targetMinutes * 0.55) {
    warn(`计划 ${plannedMinutes.toFixed(1)} 分钟，不到 ${targetMinutes} 分钟目标的 55%（${(targetMinutes * 0.55).toFixed(1)} 分钟），确认稿子不是漏写。`);
  }
  if (notesParsed && notes.length > 0 && !completePlan) {
    warn(`${notes.length} 条备注里只有 ${timedNotes.length} 条填了 minutes，跳过总时长核算（目标 ${targetMinutes} 分钟）。`);
  }
}

// ---------- C 组：运行时片段 ----------
const INSTALL_MARKERS = [
  { needle: 'id="he-presenter-style"', label: '<style id="he-presenter-style"> 样式块' },
  { needle: "__hePresenter", label: "window.__hePresenter 运行时" },
  // 入口按钮是运行时用 trigger.id='he-presenter-btn' 造出来的，HTML 里没有静态标签。
  // 这里查赋值形式而不是纯 id 串：样例的「下载 HTML」清理选择器里也含 #he-presenter-btn，
  // 查子串会把「没装层」误判成「装了但不完整」。
  { needle: "id='he-presenter-btn'", label: "he-presenter-btn 入口按钮" },
];
const missingInstall = INSTALL_MARKERS.filter((item) => !has(item.needle));
const layerPresent = missingInstall.length < INSTALL_MARKERS.length;

if (missingInstall.length === INSTALL_MARKERS.length) {
  error("未安装演讲者模式层：找不到 he-presenter-style、window.__hePresenter、he-presenter-btn。把 assets/presenter-layer.html 贴在 </body> 前再校验。");
} else if (missingInstall.length) {
  for (const item of missingInstall) {
    error(`演讲者层片段不完整：缺 ${item.label}。`);
  }
}

function styleRules() {
  const cssChunks = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match = stylePattern.exec(source);
  while (match) {
    cssChunks.push(match[1]);
    match = stylePattern.exec(source);
  }
  const cssText = cssChunks.join("\n");
  const rules = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let ruleMatch = rulePattern.exec(cssText);
  while (ruleMatch) {
    rules.push({
      selectors: ruleMatch[1].split(",").map((selector) => selector.trim()).filter(Boolean),
      body: ruleMatch[2],
    });
    ruleMatch = rulePattern.exec(cssText);
  }
  return rules;
}

function printBlocks() {
  const blocks = [];
  const pattern = /@media\s+print\b/gi;
  let match = pattern.exec(source);
  while (match) {
    blocks.push(readBraceBlock(source, match.index + match[0].length));
    match = pattern.exec(source);
  }
  return blocks;
}

function isStackSelector(selector) {
  if (!selector.includes("preview-stack")) return false;
  // 只认直接写在堆叠容器上的规则，后代选择器里的列定义不算。
  return !/[\s>+~]/.test(selector.trim());
}

function previewFitterKeepsRatio() {
  const fitterBody = functionBody("fitPresenterFrames");
  if (!fitterBody) return false;
  if (/(?:16\s*\/\s*9|9\s*\/\s*16)/.test(fitterBody)) return true;
  return /(?:16\s*\/\s*9|9\s*\/\s*16)/.test(functionBody("fitFrame"));
}

const RUNTIME_CHECKS = [
  { label: "演讲者视图外壳", needles: ['id="he-presenter"'] },
  { label: "16:9 预览视口", needles: ["he-p-frame-viewport"] },
  { label: "当前页预览", needles: ['id="he-p-current-frame"'] },
  { label: "下一页预览", needles: ['id="he-p-next-frame"'] },
  {
    label: "等比缩放器",
    needles: ["fitPresenterFrames"],
    test: previewFitterKeepsRatio,
    hint: "fitPresenterFrames 里没有 16/9 或 9/16 的换算，预览会被拉变形",
  },
  { label: "宫格按钮", needles: ['id="he-p-grid"'] },
  {
    label: "宫格面板",
    needles: ['id="he-presenter-overview"'],
    test: () => has('id="he-presenter-overview"') || has('id="he-p-presenter-overview"'),
  },
  { label: "首页按钮", needles: ['id="he-p-first"'] },
  { label: "尾页按钮", needles: ['id="he-p-last"'] },
  { label: "上一页按钮", needles: ['id="he-p-prev"'] },
  { label: "下一页按钮", needles: ['id="he-p-next"'] },
  { label: "观众屏状态徽标", needles: ['id="he-p-sync"'] },
  {
    label: "观众屏状态机",
    needles: ["syncState", "popupBlocked", "disconnected", "connecting", "unsynced", "frozen", "synced"],
  },
  { label: "观众窗恢复", needles: ['id="he-p-reopen"', "showAudienceEnded"] },
  { label: "三通道同步", needles: ["postMessage(", "BroadcastChannel", "__heDeckSync"] },
  { label: "预览无重载跳页", needles: ["preview-goto"] },
  { label: "计时器", needles: ['id="he-p-clock"', 'id="he-p-slide-clock"'] },
  { label: "计时按钮文案", needles: ["开始计时", "继续计时", "重置计时"] },
  { label: "排练", needles: ['id="he-p-rehearsal"'] },
  { label: "自动翻页", needles: ['id="he-p-auto-toggle"', "autoBlockedReason"] },
  { label: "演讲者标注层", needles: ['id="he-presenter-ink"'] },
  { label: "观众屏标注层", needles: ['id="he-audience-ink"'] },
  { label: "屏幕模式", needles: ["setScreenMode"] },
  { label: "标注工具文案", needles: ["激光", "圈选"] },
  { label: "演前检查", needles: ['id="he-p-preflight"'] },
  { label: "布局三档", needles: ["data-layout-choice", "balanced", "notes"] },
  { label: "快捷键面板", needles: ["openShortcuts"] },
];

if (layerPresent) {
  for (const check of RUNTIME_CHECKS) {
    const missing = check.needles.filter((needle) => !has(needle));
    const passed = check.test ? check.test() : missing.length === 0;
    if (passed) continue;
    if (missing.length) {
      error(`演讲者层缺「${check.label}」：没找到 ${missing.map((needle) => `「${needle}」`).join("、")}。`);
    } else {
      error(`演讲者层缺「${check.label}」：${check.hint || "结构不完整"}。`);
    }
  }

  const printRuleBlocks = printBlocks();
  if (!printRuleBlocks.length) {
    error("没有 @media print 规则：演讲者入口按钮会跟 deck 一起被打印或导出成 PDF。");
  } else if (!printRuleBlocks.some((block) => block.includes("he-presenter-btn"))) {
    error("@media print 里没有排除 he-presenter-btn：打印稿会多一个演讲模式按钮。");
  }

  const rules = styleRules();
  const stackRules = rules.filter((rule) => rule.selectors.some(isStackSelector));
  if (!stackRules.length) {
    error("没找到 .he-preview-stack 的布局规则：当前页与下一页预览的上下堆叠无法确认。");
  } else if (stackRules.some((rule) => /grid-template-columns\s*:/.test(rule.body))) {
    error("预览必须上下堆叠：.he-preview-stack 的样式里出现了 grid-template-columns，当前页与下一页会并排。");
  }

  // 落点：片段要贴在 </body> 前、页面内容之后。贴到 head 里或 body 外都会静默失效。
  const layerStart = source.indexOf('id="he-presenter-style"');
  const lastSlideEnd = source.lastIndexOf("</section>");
  const bodyEnd = source.toLowerCase().lastIndexOf("</body>");
  if (layerStart >= 0 && lastSlideEnd >= 0 && layerStart < lastSlideEnd) {
    error("演讲者层排在 .slide 内容之前：它执行时抓不到页面列表，会静默退出，连入口按钮都不挂。整段挪到 </body> 前。");
  } else if (layerStart >= 0 && bodyEnd >= 0 && layerStart > bodyEnd) {
    error("演讲者层排在 </body> 之后：浏览器不会执行这段脚本。整段挪到 </body> 前面。");
  }

  const frameRules = rules.filter((rule) => rule.selectors.some((selector) => selector === ".he-p-frame" || selector.startsWith(".he-p-frame.")));
  if (!frameRules.some((rule) => /aspect-ratio\s*:\s*16\s*\/\s*9/.test(rule.body))) {
    error("预览画布 .he-p-frame 没声明 aspect-ratio:16/9，等比缩放会把画面拉变形。");
  }
}

// deck 有没有暴露翻页钩子，和层装没装是两件事，始终检查。
// 只看赋值，不看读取：成品层自己也会读 window.__heDeck，用 includes 判会永远通过。
if (!/(?:window\.)?__heDeck\s*=(?!=)/.test(source)) {
  warn("没找到 window.__heDeck = {...} 对接钩子：演讲者视图只能派发键盘事件翻页，预览和观众屏会慢一拍。");
}

// ---------- 输出 ----------
for (const message of errors) console.error(`ERROR  ${message}`);
for (const message of warnings) console.warn(`WARN   ${message}`);
if (!errors.length) {
  console.log(warnings.length ? "✅ 通过（有 warning）" : "✅ 结构与备注契约通过");
}

const notesCount = notesParsed ? notes.length : 0;
const planText = completePlan ? `${plannedMinutes.toFixed(1)} 分钟` : timedNotes.length ? "未填齐" : "—";
console.log(`演讲者模式校验：${slideTags.length} 页 / ${notesCount} 条备注 / 计划 ${planText} / ${errors.length} error / ${warnings.length} warning`);

process.exitCode = errors.length ? 1 : 0;
