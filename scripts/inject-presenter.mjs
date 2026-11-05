#!/usr/bin/env node
/**
 * 给一份 HeiGe deck 装上「演讲者模式」。
 *
 * 做四件事：
 *   1. 给每个 <section class="slide"> 补 data-slide-id / data-title
 *   2. 没有备注骨架就插一份 SPEAKER_NOTES（对齐页数与 id）
 *   3. 把 assets/presenter-layer.html 贴在 </body> 前（已装则整段替换）
 *   4. 装了可编辑层的 deck，把本层元素补进它的「下载 HTML」清理选择器
 *
 * 幂等：反复跑只会刷新运行时片段，不会堆叠。
 *
 * 用法：
 *   node scripts/inject-presenter.mjs deck.html
 *   node scripts/inject-presenter.mjs deck.html --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAGMENT_PATH = resolve(HERE, '../assets/presenter-layer.html');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('用法: node scripts/inject-presenter.mjs <deck.html> [--dry-run]');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`找不到文件: ${file}`);
  process.exit(2);
}
if (!existsSync(FRAGMENT_PATH)) {
  console.error(`运行时片段缺失: ${FRAGMENT_PATH}`);
  process.exit(2);
}

let html = readFileSync(file, 'utf8');
const fragment = readFileSync(FRAGMENT_PATH, 'utf8').trim();
const changes = [];
const notes = [];

const START = '<!-- ===== HeiGe 演讲者层';
const END = '<!-- ===== /HeiGe 演讲者层 ===== -->';

/* ---------- 1. 页面身份 ---------- */
const sections = [...html.matchAll(/<section\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*>/g)];
if (!sections.length) {
  console.error('这份 HTML 里没有 <section class="slide">，不是 HeiGe-PPT deck。');
  process.exit(1);
}

let addedId = 0;
let addedTitle = 0;
const usedIds = new Set(
  sections.map((m) => m[0].match(/\bdata-slide-id="([^"]+)"/)?.[1]).filter(Boolean)
);

function titleOf(endIndex) {
  // 只在当前 section 的范围内找标题，避免抓到下一页的标题
  const rest = html.slice(endIndex);
  const stop = rest.search(/<section\b|<\/body>/i);
  const body = stop >= 0 ? rest.slice(0, stop) : rest;
  const m = body.match(/<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return '';
  return m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// 从后往前改，避免位移
for (let i = sections.length - 1; i >= 0; i--) {
  const tag = sections[i][0];
  const at = sections[i].index;
  let next = tag;
  let dirty = false;

  if (!/\bdata-slide-id="/.test(tag)) {
    let id = `slide-${String(i + 1).padStart(2, '0')}`;
    while (usedIds.has(id)) id += 'x';
    usedIds.add(id);
    next = next.replace(/>$/, ` data-slide-id="${id}">`);
    dirty = true;
    addedId++;
  }
  if (!/\bdata-title="/.test(tag)) {
    const title = titleOf(at + tag.length);
    if (title) {
      next = next.replace(/>$/, ` data-title="${title.replace(/"/g, '&quot;')}">`);
      dirty = true;
      addedTitle++;
    }
  }
  if (dirty) html = html.slice(0, at) + next + html.slice(at + tag.length);
}

if (addedId) changes.push(`补 data-slide-id ${addedId} 页`);
if (addedTitle) changes.push(`补 data-title ${addedTitle} 页`);

/* ---------- 2. 备注骨架 ---------- */
const slides = [...html.matchAll(/<section\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*>/g)];
const meta = slides.map((m, i) => ({
  id: m[0].match(/\bdata-slide-id="([^"]+)"/)?.[1] || `slide-${String(i + 1).padStart(2, '0')}`,
  title: (m[0].match(/\bdata-title="([^"]*)"/)?.[1] || `第 ${i + 1} 页`).replace(/&quot;/g, '"'),
}));

if (/const\s+SPEAKER_NOTES\s*=|window\.__HE_SPEAKER_NOTES__\s*=/.test(html)) {
  notes.push('已存在 SPEAKER_NOTES，保持原样');
} else {
  const rows = meta.map((m) => `  {
    id: '${m.id}',
    title: ${JSON.stringify(m.title)},
    purpose: '',            // 这一页想让观众记住什么，一句话
    talk: [],               // 提词卡 3-5 条，每条一个意思
    transition: ''          // 为什么下一页紧接着出现
  }`).join(',\n');
  const block = `
<!-- 演讲备注：每页一条，id 必须与 section[data-slide-id] 一致。字段说明见 references/presenter-mode.md -->
<script>
  const SPEAKER_NOTES = [
${rows}
  ];
  window.__HE_SPEAKER_NOTES__ = SPEAKER_NOTES;
</script>
`;
  const anchor = html.search(/<!-- ===== HeiGe 演讲者层/);
  if (anchor >= 0) html = html.slice(0, anchor) + block + html.slice(anchor);
  else html = html.replace(/<\/body>/i, `${block}\n</body>`);
  changes.push(`插入 SPEAKER_NOTES 骨架 ${meta.length} 条（需人工补 purpose/talk/transition）`);
}

/* ---------- 3. 运行时片段 ---------- */
const startAt = html.indexOf(START);
const endAt = html.indexOf(END, startAt >= 0 ? startAt : 0);
if (startAt >= 0 && endAt > startAt) {
  html = html.slice(0, startAt) + fragment + html.slice(endAt + END.length);
  changes.push('刷新演讲者层运行时（已存在，整段替换）');
} else {
  if (!/<\/body>/i.test(html)) {
    console.error('找不到 </body>，无法定位插入点。');
    process.exit(1);
  }
  html = html.replace(/<\/body>/i, `${fragment}\n</body>`);
  changes.push('插入演讲者层运行时');
}

/* ---------- 4. 可编辑层的下载清理名单 ---------- */
// 可编辑层「下载 HTML」的清理选择器：写法有几种，统一按「以 .he-toolbar 开头的选择器字符串」认
const cleanupRe = /(['"`])(\.he-toolbar(?:\s*,\s*[.#][\w-]+)+)\1/g;
const cleanupHits = [...html.matchAll(cleanupRe)];
if (cleanupHits.length) {
  const patched = cleanupHits.some((m) => !m[2].includes('#he-presenter-btn'));
  if (patched) {
    html = html.replace(cleanupRe, (m0, q, list) => {
      const parts = list.split(',').map((x) => x.trim());
      for (const extra of ['#he-presenter', '#he-presenter-btn', '#he-presenter-style']) {
        if (!parts.includes(extra)) parts.push(extra);
      }
      return `${q}${parts.join(',')}${q}`;
    });
    changes.push('可编辑层：下载 HTML 的清理选择器已补上本层元素');
  } else {
    notes.push('可编辑层的清理选择器已经包含本层元素，跳过');
  }
}

/* ---------- 5. 钩子提示 ---------- */
if (!/window\.__heDeck\s*=/.test(html)) {
  notes.push(
    '页面没有 window.__heDeck 钩子：演讲者层会靠模拟键盘翻页兜底，预览会慢一拍。建议在 deck 的翻页脚本里加：\n' +
      '    window.__heDeck = { get index(){ return i; }, go: show, slides };'
  );
}

/* ---------- 落盘 ---------- */
if (!dryRun) writeFileSync(file, html, 'utf8');

console.log(`\n${dryRun ? '（dry-run，未写盘）' : ''}HeiGe 演讲者层 → ${relative(process.cwd(), resolve(file))}`);
console.log(`  页数：${slides.length}`);
for (const c of changes) console.log(`  · ${c}`);
for (const n of notes) console.log(`  ! ${n}`);
console.log('\n下一步：');
console.log('  1. 打开 deck，右下角「演讲模式」或 Shift+P 试一遍');
console.log('  2. 补完 SPEAKER_NOTES 的 purpose / talk / transition');
console.log(`  3. node scripts/validate-presenter-mode.mjs ${file}`);
