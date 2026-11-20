#!/usr/bin/env node
/**
 * 演讲者层的边界用例。
 *
 * 文档承诺了两件容易只写在纸上、没人真验的事：
 *   1. 小屏下当前页/下一页预览等比缩小，不裁切、不压扁、不超出容器
 *   2. 自动翻页真的会翻，且打开宫格时会暂停
 *
 * 这个脚本就测这两件。
 *
 * 用法：
 *   node test/presenter-edge.mjs [deck.html]
 *   node test/presenter-edge.mjs examples/campus-talk.html --chrome /path/to/chrome --no-sandbox
 *
 * 要求 Node 22+（脚本用全局 WebSocket 说 CDP）。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, basename, join } from 'node:path';
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
const deckFlagIdx = argv.findIndex((a) => a.endsWith('.html'));
const deckArg = deckFlagIdx >= 0 ? argv[deckFlagIdx] : join(ROOT, 'examples/campus-talk.html');
const chromeFlag = argv.indexOf('--chrome');
const chromeArg = chromeFlag >= 0 ? argv[chromeFlag + 1] : null;
const noSandbox = argv.includes('--no-sandbox') || Boolean(process.env.CI);

const deckPath = resolve(deckArg);
if (!existsSync(deckPath)) {
  console.error(`找不到 deck: ${deckPath}`);
  process.exit(2);
}
const chrome = chromeArg || CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome，用 --chrome 指定可执行文件路径。');
  process.exit(2);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const root = dirname(deckPath);
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '') || basename(deckPath);
  const file = resolve(root, name);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(deckPath))}`;

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
async function step(name, fn) { try { ok(name, (await fn()) ?? ''); } catch (e) { bad(name, e.message); } }
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

const debugPort = 9600 + Math.floor(Math.random() * 300);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/heige-presenter-edge-${debugPort}`,
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

async function openDeck(viewport) {
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const c = await connectClient(created.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  if (viewport) await c.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url });
  await sleep(2400);
  return c;
}
const pressOn = (c) => (k, x = {}) => c.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key: k, bubbles: true, cancelable: true, ...x })}))`);

console.log(`\n边界用例：${basename(deckPath)}\n`);

console.log('=== 小屏（820×620）演讲者视图 ===');
const small = await openDeck([820, 620]);
const pressSmall = pressOn(small);

await step('小屏下能进演讲者视图', async () => {
  await pressSmall('P', { shiftKey: true });
  await sleep(1500);
  need((await small.eval('window.__hePresenter.debugState().mode')) === 'presenter', '没进视图');
  return '已进入';
});

await step('两个预览保持 16:9 且不超出容器', async () => {
  const frames = await small.eval(`(() => {
    const out = [];
    for (const id of ['he-p-current-frame','he-p-next-frame']) {
      const f = document.getElementById(id);
      const box = f.getBoundingClientRect();
      const host = f.closest('.he-p-frame-viewport').getBoundingClientRect();
      out.push({
        id,
        ratio: +(box.width / box.height).toFixed(3),
        overflow: box.right > host.right + 2 || box.bottom > host.bottom + 2,
        w: Math.round(box.width), h: Math.round(box.height),
      });
    }
    return out;
  })()`);
  for (const f of frames) {
    need(Math.abs(f.ratio - 16 / 9) < 0.02, `${f.id} 比例是 ${f.ratio}`);
    need(!f.overflow, `${f.id} 超出容器`);
  }
  return frames.map((f) => `${f.id.replace('he-p-', '')}: ${f.w}×${f.h}`).join(' / ');
});

await step('备注区仍然可用', async () => {
  const box = await small.eval(`(() => {
    const ed = document.getElementById('he-p-note-editor');
    const r = ed.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  need(box.w > 100 && box.h > 40, `备注区只有 ${box.w}×${box.h}`);
  return `${box.w}×${box.h}`;
});
await small.close();

console.log('\n=== 自动翻页 ===');
const auto = await openDeck(null);

await step('设 1 秒自动翻页后开启', async () => {
  await auto.eval(`window.__HE_SPEAKER_NOTES__.forEach((n) => { n.autoAdvanceSeconds = 1; })`);
  await pressOn(auto)('P', { shiftKey: true });
  await sleep(1400);
  need((await auto.eval('window.__hePresenter.debugState().mode')) === 'presenter', '没进视图');
  await auto.eval(`document.getElementById('he-p-first').click()`);
  await sleep(400);
  await auto.eval(`document.getElementById('he-p-auto-toggle').click()`);
  const label = await auto.eval(`document.getElementById('he-p-auto-toggle').textContent`);
  need(!label.includes('关闭'), `自动翻页没开：${label}`);
  return label.trim();
});

await step('等 2.5 秒后自己翻页', async () => {
  const before = (await auto.eval('window.__hePresenter.debugState()')).idx;
  await sleep(2500);
  const after = (await auto.eval('window.__hePresenter.debugState()')).idx;
  need(after > before, `没自动翻：${before} → ${after}`);
  return `第 ${before + 1} 页 → 第 ${after + 1} 页`;
});

await step('打开宫格时自动翻页暂停', async () => {
  await auto.eval(`document.getElementById('he-p-grid').click()`);
  await sleep(700);
  const label = await auto.eval(`document.getElementById('he-p-auto-toggle').textContent`);
  need(label.includes('宫格') || label.includes('暂停'), `宫格打开后按钮是「${label}」`);
  return label.trim();
});
await auto.close();

const failed = results.filter(([, p]) => !p);
console.log(`\n边界用例：${results.length - failed.length}/${results.length} 通过`);
proc.kill();
server.close();
process.exit(failed.length ? 1 : 0);
