/**
 * 演讲者层注入器的回归测试。
 * 只测注入器与产物的结构，不启动浏览器（浏览器实测看 references/presenter-mode.md 的清单）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INJECT = resolve(ROOT, 'inject-presenter.mjs');
const FIXTURE = resolve(ROOT, '../examples/darktech-keynote.html');

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'heige-presenter-'));
  const target = join(dir, 'deck.html');
  copyFileSync(FIXTURE, target);
  return target;
}

function runInject(file, extra = []) {
  return execFileSync('node', [INJECT, file, ...extra], { encoding: 'utf8' });
}

function count(html, needle) {
  return html.split(needle).length - 1;
}

test('样品 deck 已经装好演讲者层，且页面身份齐全', () => {
  const html = readFileSync(FIXTURE, 'utf8');
  const slides = count(html, '<section class="slide');
  assert.ok(slides > 0, '样例里应该有 slide');
  assert.equal(count(html, 'data-slide-id="'), slides, '每页都该有 data-slide-id');
  assert.equal(count(html, 'id="he-presenter-style"'), 1, '运行时片段只该有一份');
  assert.ok(html.includes('window.__HE_SPEAKER_NOTES__'), '备注应该挂到 window');
  assert.ok(html.includes('window.__heDeck'), '样例应该暴露 __heDeck 钩子');
});

test('注入器幂等：跑两次不叠加片段、不重复编号', () => {
  const file = freshCopy();
  runInject(file);
  const once = readFileSync(file, 'utf8');
  runInject(file);
  const twice = readFileSync(file, 'utf8');

  assert.equal(count(twice, 'id="he-presenter-style"'), 1, '重复注入后片段仍只有一份');
  assert.equal(count(twice, '<!-- ===== HeiGe 演讲者层'), 1, '片段起始注释不该叠加');
  assert.equal(count(once, 'data-slide-id="'), count(twice, 'data-slide-id="'), '页面身份数量不该变');
  assert.equal(count(twice, 'const SPEAKER_NOTES'), 1, '备注块不该叠加');
});

test('注入后：页面身份与备注一一对齐，且 id 不重复', () => {
  const file = freshCopy();
  // 先把已有的 data-slide-id 去掉，模拟一份裸 deck
  const stripped = readFileSync(file, 'utf8')
    .replace(/ data-slide-id="[^"]*"/g, '')
    .replace(/ data-title="[^"]*"/g, '')
    .replace(/const SPEAKER_NOTES = \[[\s\S]*?\n  \];\n  window\.__HE_SPEAKER_NOTES__ = SPEAKER_NOTES;\n?/, '')
    .replace(/window\.__HE_SPEAKER_NOTES__ = SPEAKER_NOTES;/, '');
  writeFileSync(file, stripped, 'utf8');

  runInject(file);
  const html = readFileSync(file, 'utf8');

  const ids = [...html.matchAll(/data-slide-id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, '应该补出页面身份');
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');

  const notesBlock = html.match(/const SPEAKER_NOTES = (\[[\s\S]*?\n  \]);/);
  assert.ok(notesBlock, '应该插入备注骨架');
  const notes = vm.runInNewContext(`(${notesBlock[1]})`, Object.create(null), { timeout: 1000 });
  assert.equal(notes.length, ids.length, '备注条数应与页数一致');
  notes.forEach((n, i) => assert.equal(n.id, ids[i], `第 ${i + 1} 条备注 id 应与页面一致`));
});

test('没装演讲者层的 deck 也能被注入器救回来', () => {
  const file = freshCopy();
  const bare = readFileSync(file, 'utf8')
    .replace(/<!-- ===== HeiGe 演讲者层[\s\S]*?<!-- ===== \/HeiGe 演讲者层 ===== -->\n?/, '');
  writeFileSync(file, bare, 'utf8');
  assert.ok(!readFileSync(file, 'utf8').includes('__hePresenter'), '前置条件：片段已经拿掉');

  runInject(file);
  const html = readFileSync(file, 'utf8');
  assert.ok(html.includes('__hePresenter'), '片段应该被贴回去');
  assert.ok(/<\/body>\s*$/.test(html) || html.trimEnd().endsWith('</html>'), '文档结尾结构不该被破坏');
});

test('非 deck 的 HTML 会被拒绝，退出码 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heige-presenter-bad-'));
  const file = join(dir, 'not-a-deck.html');
  writeFileSync(file, '<html><body><p>hello</p></body></html>', 'utf8');
  let code = 0;
  try {
    execFileSync('node', [INJECT, file], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    code = error.status;
  }
  assert.equal(code, 1, '应该以退出码 1 拒绝');
});
