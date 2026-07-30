const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");

const SCRIPTS = path.resolve(__dirname, "..");
const REPOSITORY = path.resolve(SCRIPTS, "..");
const CONVERTER = path.join(SCRIPTS, "html2pptx.js");
const FIXTURES = [
  ["product-keynote.html", 12],
  ["campus-talk.html", 11],
];

async function pptxSlideCount(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .length;
}

test("tracked release decks convert to nonempty PPTX files with stable page counts", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-release-"));
  try {
    for (const [name, expectedSlides] of FIXTURES) {
      const input = path.join(REPOSITORY, "examples", name);
      const output = path.join(tmp, name.replace(/\.html$/, ".pptx"));
      assert.ok(fs.statSync(input).size > 0, `${name} is not a tracked nonempty fixture`);

      const converted = spawnSync(process.execPath, [CONVERTER, input, output], {
        cwd: SCRIPTS,
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(converted.status, 0, converted.stdout + converted.stderr);
      assert.ok(fs.existsSync(output), `${name} did not create a PPTX`);
      assert.ok(fs.statSync(output).size > 10_000, `${name} created an empty PPTX`);
      assert.equal(await pptxSlideCount(output), expectedSlides, `${name} page count changed`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
