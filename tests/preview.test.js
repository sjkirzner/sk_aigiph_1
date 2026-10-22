// Tests for the preview page (preview/index.html + preview/data.json), the page at /preview/.
// Unreleased changes are made here first, so it may be AHEAD of the public page.
// What must always be true: it works, and its header starts with "PREVIEW - ".
// Publishing it is covered by go-live.test.js.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read, contrast, isRed, rgbToHex, startServer, launchBrowser } = require("./helpers");

const PREFIX = "PREVIEW - ";

const realData = JSON.parse(read("data.json"));
const previewData = JSON.parse(read("preview/data.json"));

test("the preview files exist next to the public page", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "preview", "index.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "preview", "data.json")));
});

test('the preview header starts with "PREVIEW - " and the public page header does not', () => {
  assert.ok(previewData.meta.title.startsWith(PREFIX), "preview title: " + previewData.meta.title);
  assert.ok(previewData.meta.title.length > PREFIX.length, "the preview title needs a name after the prefix");
  assert.ok(!realData.meta.title.startsWith(PREFIX), "public title: " + realData.meta.title);
});

test("the preview data has the same top-level sections as the public data", () => {
  assert.deepEqual(Object.keys(previewData).sort(), Object.keys(realData).sort());
});

// ---------- In a browser, from a /repo-name/ subfolder like a real host ----------

let server, browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); });

async function openPage(pathname, { scheme = "light", width = 1400 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(server.url + pathname);
  await page.waitForSelector("details.cell");
  return { page, context, problems };
}

test("the preview page loads, and its header and browser tab show the preview title", async () => {
  const { page, context, problems } = await openPage("/repo-name/preview/");
  try {
    assert.equal(await page.textContent("#title"), previewData.meta.title);
    assert.equal(await page.title(), previewData.meta.title);
    assert.ok((await page.textContent("#title")).startsWith(PREFIX));
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

test("the preview page shows all of the preview data (every grid cell and card)", async () => {
  const { page, context } = await openPage("/repo-name/preview/index.html");
  try {
    const cells = previewData.medications.length * previewData.topics.length;
    const cards = previewData.layers.reduce((n, l) => n + l.cells.length, 0);
    assert.equal(await page.locator("#rows details.cell").count(), cells);
    assert.equal(await page.locator(".layer-cell").count(), cards);
  } finally { await context.close(); }
});

test("the public page has no PREVIEW label anywhere", async () => {
  const { page, context } = await openPage("/repo-name/index.html");
  try {
    assert.equal(await page.textContent("#title"), realData.meta.title);
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes("PREVIEW"));
  } finally { await context.close(); }
});

// ---------- The "not medical advice" box on the preview page: twice as large, in red ----------

for (const scheme of ["light", "dark"]) {
  test(`[${scheme}] preview: the disclaimer text is twice the normal size, red, and readable`, async () => {
    const { page, context } = await openPage("/repo-name/preview/", { scheme });
    try {
      const s = await page.evaluate(() => {
        const cs = (el) => getComputedStyle(el);
        const heading = document.getElementById("disc-head");
        const text = document.getElementById("disclaimer");
        return {
          normalPx: parseFloat(cs(document.body).fontSize),
          headingPx: parseFloat(cs(heading).fontSize),
          textPx: parseFloat(cs(text).fontSize),
          headingColor: cs(heading).color,
          textColor: cs(text).color,
          boxBackground: cs(document.querySelector(".disclaimer")).backgroundColor,
        };
      });
      assert.equal(s.headingPx, s.normalPx * 2, "heading should be 2x the normal size");
      assert.equal(s.textPx, s.normalPx * 2, "body text should be 2x the normal size");
      for (const color of [s.headingColor, s.textColor]) {
        assert.ok(isRed(rgbToHex(color)), `${color} should be red`);
        const ratio = contrast(rgbToHex(color), rgbToHex(s.boxBackground));
        assert.ok(ratio >= 4.5, `red on the box is only ${ratio.toFixed(2)}:1`);
      }
    } finally { await context.close(); }
  });
}

test("preview: the larger disclaimer still fits a phone screen (no sideways scrolling)", async () => {
  const { page, context } = await openPage("/repo-name/preview/", { width: 390 });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  } finally { await context.close(); }
});

test("preview: the disclaimer wording is unchanged and is still the first thing under the title", async () => {
  const { page, context } = await openPage("/repo-name/preview/");
  try {
    assert.equal(await page.textContent("#disclaimer"), previewData.meta.disclaimer);
    assert.match(await page.textContent("#disc-head"), /Please read first: not medical advice/);
  } finally { await context.close(); }
});
