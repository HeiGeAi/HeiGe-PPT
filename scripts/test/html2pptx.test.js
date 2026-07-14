const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");

const ROOT = path.resolve(__dirname, "..");
const CONVERTER = path.join(ROOT, "html2pptx.js");
const { findBrowser } = require(CONVERTER);

async function readPptxEntry(pptxPath, entryPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const entry = zip.file(entryPath);
  assert.ok(entry, `${entryPath} is missing from ${pptxPath}`);
  return entry.async("string");
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process timed out\n${stdout}\n${stderr}`));
    }, options.timeout ?? 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

test("uses Playwright's executable path first and ignores it when missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-browser-"));
  try {
    const executable = path.join(tmp, "playwright-chromium");
    fs.writeFileSync(executable, "browser placeholder");
    const chromium = { executablePath: () => executable };

    assert.equal(findBrowser(chromium), executable);

    fs.rmSync(executable);
    assert.notEqual(findBrowser(chromium), executable);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("transparent slide inherits the rendered stage background", async () => {
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

    const slideXml = await readPptxEntry(output, "ppt/slides/slide1.xml");
    assert.match(
      slideXml,
      /<p:bg>[\s\S]*?<a:srgbClr val="0A0A0A"/,
      "exported slide did not preserve the stage background",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("preserves generic bar and hint classes inside a slide", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-content-"));
  try {
    const deck = path.join(tmp, "generic-classes.html");
    const output = path.join(tmp, "generic-classes.pptx");
    fs.writeFileSync(deck, `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%}
.stage{position:relative;width:1280px;height:720px;background:#fff}
.slide{position:absolute;inset:0;background:#fff;color:#111}
.bar{position:absolute;left:100px;top:100px;width:320px;height:80px;background:#12AB34}
.hint{position:absolute;left:100px;top:220px;font:32px Arial;color:#123456}
</style></head><body><main class="stage"><section class="slide">
<div class="bar"></div><p class="hint">SLIDE CONTENT HINT</p>
</section></main></body></html>`);

    const converted = spawnSync(process.execPath, [CONVERTER, deck, output], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(converted.status, 0, converted.stdout + converted.stderr);

    const slideXml = await readPptxEntry(output, "ppt/slides/slide1.xml");
    assert.match(slideXml, /12AB34/, "the slide's .bar shape was dropped");
    assert.match(slideXml, /SLIDE CONTENT HINT/, "the slide's .hint text was dropped");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("does not wait for a slow remote stylesheet before converting", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/css" });
    const timer = setTimeout(() => response.end("/* delayed stylesheet */"), 20_000);
    response.once("close", () => clearTimeout(timer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heige-ppt-network-"));
  try {
    const { port } = server.address();
    const deck = path.join(tmp, "slow-stylesheet.html");
    const output = path.join(tmp, "slow-stylesheet.pptx");
    fs.writeFileSync(deck, `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="http://127.0.0.1:${port}/slow.css">
<style>
html,body{margin:0;width:100%;height:100%}
.stage{position:relative;width:1280px;height:720px;background:#fff}
.slide{position:absolute;inset:0;background:#fff;color:#111}
h1{margin:100px;font:700 64px Arial}
</style></head><body><main class="stage"><section class="slide">
<h1>Slow stylesheet deck</h1>
</section></main></body></html>`);

    const started = Date.now();
    const converted = await runProcess(process.execPath, [CONVERTER, deck, output], {
      cwd: ROOT,
      env: process.env,
      timeout: 15_000,
    });
    const elapsed = Date.now() - started;

    assert.equal(converted.status, 0, converted.stdout + converted.stderr);
    assert.ok(fs.existsSync(output), "converter did not create a PPTX");
    assert.ok(elapsed < 12_000, `converter waited ${elapsed}ms for the remote stylesheet`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
