#!/usr/bin/env node
/**
 * 三层共存的浏览器实测。
 *
 * 仓库里有三层 drop-in：可编辑层（editable-layer.md）、现场演示层（live-show-layer.md）、
 * 演讲者层（assets/presenter-layer.html）。文档都说「可以和另外两层共存」，
 * 但没有任何一份样例同时装了三层，所以这个说法此前只是文档承诺，没人验证过。
 *
 * 这个脚本现场组装一份三层 deck（可编辑层和演讲者层取 examples/darktech-keynote.html 里已有的，
 * 现场演示层直接从 references/live-show-layer.md 的代码块抓），然后验证：
 *   - 三层脚本共存不打架，现场演示层能挂进可编辑层的工具栏
 *   - 编辑态点击不翻页
 *   - lightbox 打开时方向键只关图不翻页
 *   - 演讲者视图里 F 是冻结观众屏，没被现场演示层的 F 全屏抢走
 *   - 演讲者视图里方向键只翻一页
 *   - 退出后三层仍在，舞台恢复
 *
 * 顺带验证「文档里的代码块贴进 deck 就能用」这个前提，代码块一旦被改坏，这里会先红。
 *
 * 用法：
 *   node test/three-layer.mjs
 *   node test/three-layer.mjs --chrome /path/to/chrome --no-sandbox
 *
 * 要求 Node 22+（脚本用全局 WebSocket 说 CDP）。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const argv = process.argv.slice(2);
const chromeFlag = argv.indexOf('--chrome');
const chromeArg = chromeFlag >= 0 ? argv[chromeFlag + 1] : null;
const noSandbox = argv.includes('--no-sandbox') || Boolean(process.env.CI);
const chrome = chromeArg || CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome，用 --chrome 指定可执行文件路径。');
  process.exit(2);
}

/* ---------- 1. 现场组装三层 deck ---------- */
function buildDeck() {
  const basePath = resolve(ROOT, 'examples/darktech-keynote.html');
  const docPath = resolve(ROOT, 'references/live-show-layer.md');
  const base = readFileSync(basePath, 'utf8');
  const doc = readFileSync(docPath, 'utf8');

  if (!base.includes('__heEditable')) throw new Error('样例里没有可编辑层，无法组装三层 deck');
  if (!base.includes('__hePresenter')) throw new Error('样例里没有演讲者层，无法组装三层 deck');
  if (base.includes('__heShow')) throw new Error('样例里已经装了现场演示层，用法变了');

  const block = doc.match(/```html\n([\s\S]*?)\n```/);
  if (!block) throw new Error('references/live-show-layer.md 里找不到 ```html 代码块');
  const live = block[1].trim();
  if (!live.includes('__heShow')) throw new Error('live-show-layer.md 的代码块里没有 __heShow，代码块可能贴错了');

  const anchor = '<!-- ===== HeiGe 演讲者层';
  if (!base.includes(anchor)) throw new Error('找不到演讲者层的插入锚点');
  // 现场演示层要排在可编辑层之后（它要把「全屏」挂进 .he-toolbar），演讲者层之前
  const html = base.replace(anchor, `${live}\n\n${anchor}`);

  const dir = mkdtempSync(join(tmpdir(), 'heige-three-layer-'));
  const file = join(dir, 'deck.html');
  writeFileSync(file, html, 'utf8');
  return { dir, file };
}

const { dir, file } = buildDeck();
console.log(`三层 deck 已组装: ${file}（${(readFileSync(file).length / 1024).toFixed(0)} KB）\n`);

/* ---------- 2. 静态服务 ---------- */
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '') || 'deck.html';
  const target = join(dir, name);
  if (!target.startsWith(dir) || !existsSync(target)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(target));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/deck.html`;

/* ---------- 3. 极简 CDP ---------- */
function connectClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', () => ok());
    ws.addEventListener('error', () => fail(new Error('CDP 连接失败')));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: r, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result);
    } else if (msg.method) events.push(msg);
  });
  return ready.then(() => ({
    events,
    async send(method, params = {}) {
      const id = ++seq;
      return new Promise((r, reject) => {
        pending.set(id, { resolve: r, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    async eval(expression) {
      const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      return res.result.value;
    },
    close() { try { ws.close(); } catch {} },
  }));
}

const results = [];
const ok = (n, x = '') => { results.push([n, true]); console.log(`  ✅ ${n}${x ? ' · ' + x : ''}`); };
const bad = (n, w) => { results.push([n, false]); console.log(`  ❌ ${n} — ${w}`); };
async function step(name, fn) {
  try { ok(name, (await fn()) ?? ''); } catch (e) { bad(name, e.message); }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---------- 4. 启动浏览器 ---------- */
const debugPort = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${join(dir, 'profile')}`,
  '--disable-popup-blocking', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900',
  ...(noSandbox ? ['--no-sandbox'] : []),
  'about:blank',
], { stdio: 'ignore' });

let browserReady = false;
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) { browserReady = true; break; } } catch {}
  await sleep(100);
}
if (!browserReady) { proc.kill(); server.close(); throw new Error('Chrome 没起来'); }

const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const page = await connectClient(created.webSocketDebuggerUrl);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Page.navigate', { url });

const st = () => page.eval('window.__hePresenter.debugState()');
// 注意派发到 body 而不是 window：真实按键的事件路径是 window→document→body，
// 派发到 window 时 document 上的捕获监听收不到，会漏掉现场演示层的反应。
const press = (key, extra = {}) => page.eval(
  `document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, cancelable: true, ...extra })}))`
);
const deckIdx = () => page.eval("[...document.querySelectorAll('.slide')].findIndex(s => s.classList.contains('is-active'))");

const waitFor = async (expr, label, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await page.eval(`Boolean(${expr})`)) return; } catch {}
    await sleep(120);
  }
  throw new Error('等待超时: ' + label);
};

console.log('=== 三层共存 ===\n');
await waitFor("window.__hePresenter && document.querySelector('.he-toolbar')", '三层装载');

await step('三层脚本都加载，工具栏出现', async () => {
  const s = await page.eval(`({
    editable: typeof window.__heEditable,
    show: typeof window.__heShow,
    presenter: typeof window.__hePresenter,
    toolbar: document.querySelectorAll('.he-toolbar').length,
  })`);
  need(s.presenter === 'object', `演讲者层是 ${s.presenter}`);
  need(s.show !== 'undefined', `现场演示层是 ${s.show}`);
  need(s.toolbar === 1, `工具栏数量 ${s.toolbar}`);
  return `editable=${s.editable} show=${s.show} presenter=${s.presenter}`;
});

await step('现场演示层挂进可编辑层的工具栏', async () => {
  const labels = await page.eval(`[...document.querySelectorAll('.he-toolbar button, .he-showbar button')].map(b => b.textContent.trim())`);
  need(labels.some((t) => t.includes('全屏')), `按钮：${labels.join(' / ')}`);
  return labels.join(' / ');
});

await step('编辑态：点击不翻页', async () => {
  await page.eval(`[...document.querySelectorAll('.he-toolbar button')].find(b => b.textContent.trim() === '编辑').click()`);
  await sleep(300);
  need(await page.eval(`document.body.classList.contains('he-editing')`), '没进编辑态');
  const before = await deckIdx();
  await page.eval(`document.body.dispatchEvent(new MouseEvent('click',{clientX:1200,clientY:400,bubbles:true}))`);
  await sleep(500);
  const after = await deckIdx();
  need(before === after, `编辑态点击翻页了：${before} → ${after}`);
  await page.eval(`[...document.querySelectorAll('.he-toolbar button')].find(b => b.textContent.trim() === '完成').click()`);
  await sleep(300);
  return `停在第 ${after + 1} 页`;
});

await step('lightbox：点图放大，方向键只关图不翻页', async () => {
  // 样例里没有 data-zoom 的图，现场塞一张（用 data URI，不依赖网络）
  await page.eval(`(() => {
    const img = document.createElement('img');
    img.setAttribute('data-zoom', '');
    img.src = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#0a1400"/></svg>');
    img.style.cssText = 'position:absolute;right:40px;bottom:40px;width:100px;height:50px';
    document.querySelector('.slide.is-active').appendChild(img);
  })()`);
  const before = await deckIdx();
  await page.eval(`document.querySelector('img[data-zoom]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
  await sleep(500);
  need(await page.eval(`document.querySelector('.lb')?.classList.contains('on')`), 'lightbox 没打开');
  await press('ArrowRight');
  await sleep(400);
  need(!(await page.eval(`document.querySelector('.lb')?.classList.contains('on')`)), '方向键没关掉 lightbox');
  const after = await deckIdx();
  need(before === after, `lightbox 期间翻页了：${before} → ${after}`);
  return `关图后仍在第 ${after + 1} 页`;
});

await step('演讲者视图里 F 是冻结观众屏，没被现场演示层抢成全屏', async () => {
  await press('P', { shiftKey: true });
  await sleep(1400);
  need((await st()).mode === 'presenter', '没进演讲者视图');
  await press('f');
  await sleep(600);
  const sync = await page.eval("document.getElementById('he-p-sync').textContent");
  need(sync.includes('已冻结'), `F 之后观众屏状态：${sync}`);
  need(!(await page.eval('Boolean(document.fullscreenElement)')), 'F 把浏览器搞进全屏了，说明被现场演示层抢走');
  await press('f');
  await sleep(400);
  return sync;
});

await step('演讲者视图里方向键只翻一页', async () => {
  await page.eval("document.getElementById('he-p-first').click()");
  await sleep(500);
  const before = (await st()).idx;
  await press('ArrowRight');
  await sleep(500);
  const after = (await st()).idx;
  need(after === before + 1, `一次按键翻了 ${after - before} 页`);
  return `第 ${before + 1} 页 → 第 ${after + 1} 页`;
});

await step('退出演讲者视图后三层仍在，舞台恢复', async () => {
  await page.eval("document.getElementById('he-p-exit').click()");
  await sleep(900);
  const s = await page.eval(`({
    mode: window.__hePresenter.debugState().mode,
    toolbar: document.querySelectorAll('.he-toolbar').length,
    stage: getComputedStyle(document.querySelector('.stage')).visibility,
  })`);
  need(s.mode === 'deck', '没退回 deck');
  need(s.toolbar === 1, `工具栏数量变成 ${s.toolbar}`);
  need(s.stage === 'visible', '舞台还没恢复');
  return `工具栏 ${s.toolbar} 个`;
});

const errors = page.events.filter((e) => e.method === 'Runtime.exceptionThrown');
const failed = results.filter(([, p]) => !p);
console.log(`\n三层共存：${results.length - failed.length}/${results.length} 通过，页面异常 ${errors.length}`);
if (errors.length) errors.slice(0, 3).forEach((e) => console.log('  ⚠️ ' + (e.params.exceptionDetails?.exception?.description || '').split('\n')[0]));

page.close();
proc.kill();
server.close();
process.exit(failed.length ? 1 : 0);
