// Tests for the preview copy of the page (preview/index.html + preview/data.json).
// The copy must be identical to the real page except that its title starts with "PREVIEW - ".
// If one of these fails after you change index.html or data.json, run:  npm run sync-preview
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read, startServer, launchBrowser } = require("./helpers");

const PREFIX = "PREVIEW - ";
const FIX = "Out of date: run  npm run sync-preview";

const realData = JSON.parse(read("data.json"));
const previewData = JSON.parse(read("preview/data.json"));

test("the preview files exist next to the real page", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "preview", "index.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "preview", "data.json")));
});

test("preview/index.html is a byte-for-byte copy of index.html", () => {
  assert.equal(read("preview/index.html"), read("index.html"), FIX);
});

test('the preview header is "PREVIEW - MOUD, Food, and Metabolism" and the real page has no prefix', () => {
  assert.equal(previewData.meta.title, "PREVIEW - MOUD, Food, and Metabolism");
  assert.equal(realData.meta.title, "MOUD, Food, and Metabolism");
});

test("preview/data.json is identical to data.json except for the title", () => {
  const expected = JSON.parse(JSON.stringify(realData));
  expected.meta.title = PREFIX + realData.meta.title;
  assert.deepEqual(previewData, expected, FIX);
});

test("the two data files differ on exactly one line of text", () => {
  const a = read("data.json").split("\n");
  const b = read("preview/data.json").split("\n");
  assert.equal(a.length, b.length, FIX);
  const differing = a.filter((line, i) => line !== b[i]);
  assert.equal(differing.length, 1, FIX);
});

// ---------- In a browser, from a /repo-name/ subfolder like a real host ----------

let server, browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); });

async function openPage(pathname) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(server.url + pathname);
  await page.waitForSelector("details.cell");
  return { page, context, problems };
}

test("the preview page shows the PREVIEW header at the top and in the browser tab", async () => {
  const { page, context, problems } = await openPage("/repo-name/preview/");
  try {
    assert.equal(await page.textContent("#title"), "PREVIEW - MOUD, Food, and Metabolism");
    assert.equal(await page.title(), "PREVIEW - MOUD, Food, and Metabolism");
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test("the real page is unchanged: no PREVIEW label anywhere", async () => {
  const { page, context } = await openPage("/repo-name/index.html");
  try {
    assert.equal(await page.textContent("#title"), "MOUD, Food, and Metabolism");
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes("PREVIEW"));
  } finally { await context.close(); }
});

test("everything else on the preview page matches the real page (same text, same 15 grid cells and 21 cards)", async () => {
  const real = await openPage("/repo-name/index.html");
  const prev = await openPage("/repo-name/preview/index.html");
  try {
    const realText = await real.page.evaluate(() => document.body.innerText);
    const prevText = await prev.page.evaluate(() => document.body.innerText);
    assert.equal(prevText.replace(PREFIX, ""), realText);
    for (const { page } of [real, prev]) {
      assert.equal(await page.locator("#rows details.cell").count(), 15);
      assert.equal(await page.locator(".layer-cell").count(), 21);
    }
  } finally { await real.context.close(); await prev.context.close(); }
});
