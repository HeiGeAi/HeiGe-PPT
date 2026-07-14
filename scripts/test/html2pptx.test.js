const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CONVERTER = path.join(ROOT, "html2pptx.js");

test("transparent slide inherits the rendered stage background", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-test-"));
  try {
    const deck = path.join(tmp, "dark-deck.html");
    const output = path.join(tmp, "dark-deck.pptx");
    fs.writeFileSync(deck, `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:#111}
.stage{position:relative;width:1280px;height:720px;background:#0A0A0A}
.slide{position:absolute;inset:0;background:transparent;color:#F4EFE6}
h1{margin:100px;font:700 64px Arial}
</style></head><body><main class="stage"><section class="slide"><h1>Dark deck</h1></section></main></body></html>`);

    const converted = spawnSync(process.execPath, [CONVERTER, deck, output], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(converted.status, 0, converted.stdout + converted.stderr);
    assert.ok(fs.existsSync(output), "converter did not create a PPTX");

    const slideXml = execFileSync("unzip", ["-p", output, "ppt/slides/slide1.xml"], {
      encoding: "utf8",
    });
    assert.match(
      slideXml,
      /<p:bg>[\s\S]*?<a:srgbClr val="0A0A0A"/,
      "exported slide did not preserve the stage background",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
