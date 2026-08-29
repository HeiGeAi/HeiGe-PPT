const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { chromium } = require('playwright-core');

const REPOSITORY = path.resolve(__dirname, '..', '..');
const DECKS = fs.readdirSync(path.join(REPOSITORY, 'examples'))
  .filter((name) => name.endsWith('.html'))
  .sort();

function findChromium() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

test('every deck sanitizes persisted markup and flushes pending saves', () => {
  assert.equal(DECKS.length, 6, 'unexpected deck fixture count');
  for (const name of DECKS) {
    const source = fs.readFileSync(path.join(REPOSITORY, 'examples', name), 'utf8');
    assert.match(source, /stripEditingAttributes/, `${name} persists editor-only attributes`);
    assert.match(source, /pagehide['"], flushSave/, `${name} can lose a pending save on navigation`);
  }
});

test('deck editor sanitizes state and flushes before an immediate reload', async () => {
  const executablePath = findChromium();
  assert.ok(executablePath, 'Chromium is required for the editor persistence gate');
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(path.join(REPOSITORY, 'examples', 'darktech-keynote.html')).href);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('[data-act="edit"]');
    await page.evaluate(() => {
      const field = document.querySelector('[data-he-field]');
      field.textContent = '立即保存验收';
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const state = await page.evaluate(() => {
      const field = document.querySelector('[data-he-field]');
      return {
        text: field.textContent,
        contenteditable: field.getAttribute('contenteditable'),
        spellcheck: field.getAttribute('spellcheck'),
      };
    });
    assert.equal(state.text, '立即保存验收');
    assert.equal(state.contenteditable, null);
    assert.equal(state.spellcheck, null);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
});
