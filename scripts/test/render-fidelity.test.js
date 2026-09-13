// 渲染保真回归测试：每个用例对应一条已修复的转换器 bug，断言 PPTX 内部 XML。
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");

const SCRIPTS = path.resolve(__dirname, "..");
const CONVERTER = path.join(SCRIPTS, "html2pptx.js");

const DECK_HEAD = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%}
.stage{position:relative;width:1280px;height:720px;background:#fff}
.slide{position:absolute;inset:0;background:#fff;color:#111}
</style></head><body><main class="stage"><section class="slide">`;
const DECK_TAIL = `</section></main></body></html>`;

function convert(bodyHtml) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-fidelity-"));
  try {
    const deck = path.join(tmp, "deck.html");
    const output = path.join(tmp, "deck.pptx");
    fs.writeFileSync(deck, DECK_HEAD + bodyHtml + DECK_TAIL);
    const converted = spawnSync(process.execPath, [CONVERTER, deck, output], {
      cwd: SCRIPTS,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(converted.status, 0, converted.stdout + converted.stderr);
    assert.ok(fs.existsSync(output), "converter did not create a PPTX");
    return output;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

async function slideXml(pptxPath, n = 1) {
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const entry = zip.file(`ppt/slides/slide${n}.xml`);
  assert.ok(entry, `slide${n}.xml missing`);
  return entry.async("string");
}

test("content under an opacity:0 ancestor does not leak into the PPT", async () => {
  const output = convert(`
<div style="position:absolute;left:50px;top:50px;opacity:0">
  <p style="font:32px Arial">GHOSTTEXT-DIRECT</p>
  <div><span style="display:inline">GHOSTTEXT-MIXED</span><div style="display:block">block child</div></div>
</div>
<p style="position:absolute;left:50px;top:300px;font:32px Arial">VISIBLE-TEXT</p>`);
  try {
    const xml = await slideXml(output);
    assert.ok(!xml.includes("GHOSTTEXT-DIRECT"), "opacity:0 祖先下的直排文字泄漏进 PPT");
    assert.ok(!xml.includes("GHOSTTEXT-MIXED"), "opacity:0 祖先下的混合块文字泄漏进 PPT");
    assert.match(xml, /VISIBLE-TEXT/, "正常可见文字被误伤");
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});

test("border-bottom divider keeps its color and survives at 4px", async () => {
  const output = convert(`
<div style="position:absolute;left:50px;top:50px;width:300px;border-bottom:2px solid #00FF00"></div>
<div style="position:absolute;left:50px;top:120px;width:300px;height:4px;border-bottom:4px solid #0000FF"></div>`);
  try {
    const xml = await slideXml(output);
    assert.match(xml, /00FF00/, "2px border-bottom divider color lost");
    assert.match(xml, /0000FF/, "4px border-bottom divider vanished entirely");
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});

test("inline run keeps its own fontSize instead of being flattened to the parent size", async () => {
  const output = convert(`
<h1 style="position:absolute;left:50px;top:50px;font:40px Arial">BIG<span style="font-size:16px">SMALL-UNIT</span></h1>`);
  try {
    const xml = await slideXml(output);
    // 40px → 27.6pt → sz=2760；16px → 11.0pt → sz=1100。压平的旧行为只剩 2760 一个字号。
    assert.match(xml, /sz="2760"/, "parent 40px run missing");
    assert.match(xml, /sz="1100"/, "inline 16px run was flattened to the parent font size");
    assert.match(xml, /SMALL-UNIT/, "inline run text missing");
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});

test("rgba alpha is preserved as OOXML alpha instead of dropping to opaque", async () => {
  const output = convert(`
<div style="position:absolute;left:50px;top:50px;width:200px;height:100px;background:rgba(255,0,0,0.3)"></div>`);
  try {
    const xml = await slideXml(output);
    assert.match(xml, /srgbClr val="FF0000"[^>]*><a:alpha/, "alpha channel was dropped");
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});
