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
