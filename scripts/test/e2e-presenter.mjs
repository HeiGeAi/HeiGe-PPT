#!/usr/bin/env node
/**
 * 演讲者层的浏览器端实测。
 *
 * 静态校验器只能看 HTML 结构，翻页、观众屏同步、计时这些必须真跑一遍。
 * 用 Chrome 的无头模式 + CDP 跑核心链路，零依赖：
 * 进演讲者视图 → 开观众窗 → 双端翻页同步 → 宫格选页 → 计时 → 退出恢复。
 *
 * 用法：
 *   node test/e2e-presenter.mjs examples/darktech-keynote.html
 *   node test/e2e-presenter.mjs examples/darktech-keynote.html --chrome /path/to/chrome --no-sandbox
 *
 * 找浏览器：--chrome 指定 > 环境变量 CHROME_PATH > 系统常见路径。
 * CI 里用 `playwright-core` 装好的 chromium，路径由 workflow 传进来。
 *
 * 要求 Node 22+（脚本用全局 WebSocket 说 CDP）。仓库主 CI 用 Node 20，
 * 这条实测在独立 job 里跑 Node 22。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const argv = process.argv.slice(2);
const deckArg = argv.find((a) => !a.startsWith('--'));
const chromeFlag = argv.indexOf('--chrome');
const chromeArg = chromeFlag >= 0 ? argv[chromeFlag + 1] : null;
// CI 容器里 chromium 常需要关沙箱，且 /dev/shm 偏小
const noSandbox = argv.includes('--no-sandbox') || Boolean(process.env.CI);

if (!deckArg) {
  console.error('用法: node test/e2e-presenter.mjs <deck.html> [--chrome /path/to/chrome] [--no-sandbox]');
  process.exit(2);
}
const deckPath = resolve(deckArg);
if (!existsSync(deckPath)) {
  console.error(`找不到文件: ${deckPath}`);
  process.exit(2);
}
const chrome = chromeArg || CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome，用 --chrome 指定可执行文件路径。');
  process.exit(2);
}

/* ---------- 静态服务器 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const root = dirname(deckPath);
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '') || basename(deckPath);
  const file = resolve(root, name);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/${encodeURIComponent(basename(deckPath))}`;

/* ---------- 极简 CDP ---------- */
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
const record = (name, pass, note = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${note ? ' · ' + note : ''}`);
};
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
async function step(name, fn) {
  try { record(name, true, await fn() ?? ''); }
  catch (e) { record(name, false, e.message); }
}

/* ---------- 启动浏览器 ---------- */
const debugPort = 9400 + Math.floor(Math.random() * 300);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/heige-presenter-e2e-${debugPort}`,
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
await page.send('Page.navigate', { url: pageUrl });

const waitFor = async (expr, label, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await page.eval(`Boolean(${expr})`)) return; } catch {}
    await sleep(120);
  }
  throw new Error('等待超时: ' + label);
};
// 派发到 body 而不是 window：真实按键的事件路径是 window→document→body，
// 派发到 window 时 document 上的捕获监听收不到，会漏掉另外两层的反应。
const press = (key, extra = {}) => page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key, bubbles: true, cancelable: true, ...extra })}))`);
const st = () => page.eval('window.__hePresenter.debugState()');

console.log(`\n演讲者层实测：${basename(deckPath)}\n`);
await waitFor("window.__hePresenter && document.getElementById('he-presenter-btn')", '装载');

await step('入口按钮自动出现，运行时就位', async () => {
  const s = await page.eval(`({ slides: document.querySelectorAll('.slide').length, notes: (window.__HE_SPEAKER_NOTES__ || []).length, mode: window.__hePresenter.debugState().mode })`);
  need(s.mode === 'deck', '初始应在 deck 模式');
  need(s.slides > 0, '没有识别到 .slide');
  return `${s.slides} 页 / ${s.notes} 条备注`;
});

await step('Shift+P 进演讲者视图，两个预览都是 16:9', async () => {
  await press('P', { shiftKey: true });
  await waitFor("window.__hePresenter.debugState().mode === 'presenter'", '进入演讲者视图');
  const s = await page.eval(`(() => {
    const r = document.getElementById('he-p-current-frame').getBoundingClientRect();
    return { ratio: +(r.width / r.height).toFixed(3), frames: document.querySelectorAll('#he-presenter iframe').length };
  })()`);
  need(s.frames === 2, '预览帧不是两个');
  need(Math.abs(s.ratio - 16 / 9) < 0.01, `预览比例 ${s.ratio}`);
  return `16:9 = ${s.ratio}`;
});

await step('观众窗打开并报「已同步」', async () => {
  await sleep(900);
  const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const target = list.find((t) => t.type === 'page' && t.url.includes('he-mode=audience'));
  need(target, '观众窗没打开');
  globalThis.audience = await connectClient(target.webSocketDebuggerUrl);
  await globalThis.audience.send('Runtime.enable');
  await sleep(1200);
  const mode = await globalThis.audience.eval("window.__hePresenter?.debugState?.().mode");
  need(mode === 'audience', `观众窗模式是 ${mode}`);
  const sync = await page.eval("document.getElementById('he-p-sync').textContent");
  need(sync.includes('已同步'), `同步状态：${sync}`);
  return sync;
});

await step('翻两页，演讲者与观众屏页码一致', async () => {
  await press('ArrowRight');
  await press('ArrowRight');
  await sleep(800);
  const local = await st();
  const remote = await globalThis.audience.eval("window.__hePresenter.debugState().idx");
  need(local.idx === 2, `演讲者在第 ${local.idx} 页`);
  need(remote === 2, `观众屏在第 ${remote} 页`);
  return `双端都在第 ${local.idx + 1} 页`;
});

await step('一次按键只翻一页，主 deck 跟着同步', async () => {
  // 锁住「本层 window 捕获先于 deck window 冒泡」这个隐式约定：
  // 顺序一旦反过来，一次按键会翻两页，这条立刻红。
  await page.eval("document.getElementById('he-p-first').click()");
  await sleep(500);
  const before = (await st()).idx;
  await press('ArrowRight');
  await sleep(500);
  const after = (await st()).idx;
  need(after === before + 1, `一次按键翻了 ${after - before} 页`);
  const deckIdx = await page.eval("[...document.querySelectorAll('.slide')].findIndex(s => s.classList.contains('is-active'))");
  need(deckIdx === after, `主 deck 停在第 ${deckIdx + 1} 页，演讲者停在第 ${after + 1} 页`);
  return `第 ${before + 1} 页 → 第 ${after + 1} 页，主 deck 同页`;
});

await step('宫格选页后回到预览并跳页', async () => {
  await press('Escape');
  await sleep(400);
  const open = await page.eval("!document.getElementById('he-presenter-overview').hidden");
  need(open, '宫格没打开');
  await page.eval("document.querySelectorAll('.he-p-overview-page')[3].click()");
  await sleep(700);
  const s = await st();
  need(s.idx === 3, `跳到了第 ${s.idx} 页`);
  const closed = await page.eval("document.getElementById('he-presenter-overview').hidden");
  need(closed, '宫格没关');
  return '第 4 页';
});

await step('计时能走、能停', async () => {
  await page.eval("document.getElementById('he-p-timer-toggle').click()");
  await sleep(1300);
  const clock = await page.eval("document.getElementById('he-p-clock').textContent");
  need(clock !== '00:00', '计时没走');
  await page.eval("document.getElementById('he-p-timer-toggle').click()");
  const label = await page.eval("document.getElementById('he-p-timer-toggle').textContent");
  need(label.includes('继续计时'), `暂停后按钮是「${label}」`);
  return `${clock} → ${label}`;
});

await step('备注按 data-slide-id 存进 localStorage', async () => {
  await page.eval(`(() => {
    const ed = document.getElementById('he-p-note-editor');
    ed.value = 'e2e 备注';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700); // 备注保存有 300ms 防抖，等它落盘
  const key = await page.eval("Object.keys(localStorage).find((k) => k.startsWith('heige-ppt-note:')) || ''");
  need(key, 'localStorage 里没有备注键');
  // 备注按 data-slide-id 存。id 允许是 slide-01，也允许是文档推荐的语义 slug（proof / pricing），
  // 所以这里比对当前页的真实 id，不假定命名格式。
  const currentId = await page.eval("document.querySelector('.slide.is-active')?.dataset.slideId || ''");
  need(currentId, '当前页没有 data-slide-id');
  need(key.endsWith(currentId), `备注键 ${key} 没对上当前页 id ${currentId}`);
  return key.slice(-24);
});

await step('退出后观众屏收尾、主舞台恢复', async () => {
  await page.eval("document.getElementById('he-p-exit').click()");
  await sleep(1000);
  const s = await page.eval(`({
    mode: window.__hePresenter.debugState().mode,
    btn: !!document.getElementById('he-presenter-btn'),
    stage: getComputedStyle(document.querySelector('.stage')).visibility,
  })`);
  need(s.mode === 'deck', '没退回 deck');
  need(s.btn, '入口按钮没回来');
  need(s.stage === 'visible', '主舞台还被藏着');
  return '回到 deck';
});

const errors = page.events.filter((e) => e.method === 'Runtime.exceptionThrown');
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过，页面异常 ${errors.length}`);
if (errors.length) errors.forEach((e) => console.log('  ⚠️ ' + (e.params.exceptionDetails?.exception?.description || '').split('\n')[0]));

page.close();
try { await globalThis.audience?.close(); } catch {}
proc.kill();
server.close();
process.exit(failed.length ? 1 : 0);
