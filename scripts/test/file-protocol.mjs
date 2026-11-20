#!/usr/bin/env node
/**
 * file:// 协议下的演讲者层可用性。
 *
 * 最常见的打开方式就是双击 HTML。这个场景和 http 有几个实质差别，值得单独测：
 *   - origin 是 null，localStorage 可能被浏览器限制
 *   - iframe 加载的是 file:// URL，可能受同源策略影响
 *   - BroadcastChannel 在 null origin 下的行为不确定，只能靠 postMessage 直连兜底
 *
 * 用法：
 *   node test/file-protocol.mjs [deck.html]
 *   node test/file-protocol.mjs examples/darktech-keynote.html --chrome /path/to/chrome --no-sandbox
 *
 * 要求 Node 22+（脚本用全局 WebSocket 说 CDP）。
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const argv = process.argv.slice(2);
const deckIdx = argv.findIndex((a) => a.endsWith('.html'));
const deckArg = deckIdx >= 0 ? argv[deckIdx] : join(ROOT, 'examples/darktech-keynote.html');
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

const debugPort = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/heige-presenter-file-${debugPort}`,
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
if (!browserReady) { proc.kill(); throw new Error('Chrome 没起来'); }

const target = pathToFileURL(deckPath).href;
const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const page = await connectClient(created.webSocketDebuggerUrl);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Page.navigate', { url: target });
await sleep(2600);

const press = (k, x = {}) => page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key: k, bubbles: true, cancelable: true, ...x })}))`);
const st = () => page.eval('window.__hePresenter.debugState()');

console.log(`\nfile:// 场景：${basename(deckPath)}\n`);

await step('运行时正常装载', async () => {
  const s = await page.eval(`({ proto: location.protocol, presenter: typeof window.__hePresenter, slides: document.querySelectorAll('.slide').length })`);
  need(s.proto === 'file:', `协议是 ${s.proto}`);
  need(s.presenter === 'object', `运行时是 ${s.presenter}`);
  return `${s.slides} 页`;
});

await step('localStorage 可读写（origin 是 null）', async () => {
  const r = await page.eval(`(() => { try { localStorage.setItem('__he_t','1'); const v = localStorage.getItem('__he_t'); localStorage.removeItem('__he_t'); return { ok: v === '1' }; } catch (e) { return { ok: false, err: e.message }; } })()`);
  need(r.ok, r.err || '不可用');
  return '可读写';
});

await step('Shift+P 进演讲者视图', async () => {
  await press('P', { shiftKey: true });
  await sleep(1600);
  need((await st()).mode === 'presenter', '没进视图');
  need((await page.eval(`getComputedStyle(document.getElementById('he-presenter')).display`)) === 'grid', 'shell 不可见');
  return 'shell 可见';
});

await step('预览 iframe 能在 file:// 下加载并跟随翻页', async () => {
  await sleep(1500);
  const src = await page.eval(`(document.getElementById('he-p-current-frame').getAttribute('src') || '').slice(0, 12)`);
  need(src.startsWith('file:'), `iframe src = ${src}`);
  await press('ArrowRight');
  await sleep(900);
  const slide = await page.eval(`document.getElementById('he-p-current-frame').dataset.slide`);
  need(slide === '1', `预览停在第 ${Number(slide) + 1} 页`);
  return '跟到第 2 页';
});

await step('观众窗能开出来并进 audience 模式', async () => {
  await sleep(800);
  const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const aud = list.filter((t) => t.type === 'page' && t.url.includes('he-mode=audience'));
  need(aud.length === 1, `观众窗 ${aud.length} 个`);
  globalThis.audience = await connectClient(aud[0].webSocketDebuggerUrl);
  await globalThis.audience.send('Runtime.enable');
  await sleep(1600);
  const mode = await globalThis.audience.eval("window.__hePresenter?.debugState?.().mode");
  need(mode === 'audience', `观众窗模式是 ${mode}`);
  return '已进入';
});

await step('双端翻页同步', async () => {
  const before = (await st()).idx;
  await press('ArrowRight');
  await sleep(1000);
  const local = (await st()).idx;
  const remote = await globalThis.audience.eval("window.__hePresenter.debugState().idx");
  need(local === before + 1, `演讲者 ${before} → ${local}`);
  need(remote === local, `观众屏停在第 ${remote + 1} 页，演讲者第 ${local + 1} 页`);
  return `双端都在第 ${local + 1} 页`;
});

await step('备注按 data-slide-id 落盘', async () => {
  await page.eval(`(() => { const ed = document.getElementById('he-p-note-editor'); ed.value = 'file 协议测试'; ed.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(800);
  const key = await page.eval("Object.keys(localStorage).find((k) => k.startsWith('heige-ppt-note:')) || ''");
  need(key, 'localStorage 里没有备注键');
  const currentId = await page.eval("document.querySelector('.slide.is-active')?.dataset.slideId || ''");
  need(currentId && key.endsWith(currentId), `备注键 ${key} 没对上页面 id ${currentId}`);
  return key.slice(-24);
});

const errors = page.events.filter((e) => e.method === 'Runtime.exceptionThrown');
const failed = results.filter(([, p]) => !p);
console.log(`\nfile:// 场景：${results.length - failed.length}/${results.length} 通过，页面异常 ${errors.length}`);
if (errors.length) errors.slice(0, 3).forEach((e) => console.log('  ⚠️ ' + (e.params.exceptionDetails?.exception?.description || '').split('\n')[0]));

page.close();
try { await globalThis.audience?.close(); } catch {}
proc.kill();
process.exit(failed.length ? 1 : 0);
