// Tests that open the real page in a headless browser (Chromium) and check what a
// visitor would see and be able to do. The site is served from a /repo-name/ subfolder,
// the same way GitHub Pages serves it.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { read, hue, isGreen, rgbToHex, startServer, launchBrowser } = require("./helpers");

const data = JSON.parse(read("data.json"));
const SITE = "/repo-name/index.html";

let server, browser;
before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// Open a page, run `fn(page)`, then always close it. `page.problems` collects JS/console errors.
async function withPage(pathname, options, fn) {
  const { width = 1400, height = 1000, scheme = "light" } = options;
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultTimeout(4000); // if the site is broken, fail fast instead of waiting 30 seconds per test
  page.problems = [];
  page.on("pageerror", (e) => page.problems.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") page.problems.push("console: " + m.text()); });
  try {
    await page.goto(server.url + pathname);
    return await fn(page);
  } finally {
    await context.close();
  }
}
const ready = (page) => page.waitForSelector("details.cell");
const cssName = (id) => id.replace(/_/g, "-");

// ---------- Loading ----------

test("loads from a subfolder with no JavaScript or console errors", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    assert.deepEqual(page.problems, []);
  });
});

test("shows the page title in the heading and the browser tab", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    assert.equal(await page.title(), "MOUD, Food, and Metabolism");
    assert.equal(await page.textContent("#title"), "MOUD, Food, and Metabolism");
    assert.equal(await page.textContent("#updated"), `Last updated ${data.meta.last_updated}`);
  });
});

test("disclaimer is visible, comes before the grid, and the MOUD footnote follows it", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const d = document.querySelector(".disclaimer");
      const f = document.getElementById("footnote");
      const grid = document.getElementById("rows");
      const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        text: d.textContent,
        visible: d.getBoundingClientRect().height > 0,
        disclaimerBeforeGrid: before(d, grid),
        footnoteAfterDisclaimer: before(d, f),
        footnoteVisible: !f.hidden && f.getBoundingClientRect().height > 0,
        footnote: f.textContent,
      };
    });
    assert.ok(r.visible);
    assert.match(r.text, /not medical advice/i);
    assert.ok(r.disclaimerBeforeGrid);
    assert.ok(r.footnoteAfterDisclaimer);
    assert.ok(r.footnoteVisible);
    assert.match(r.footnote, /MOUD stands for medications for opioid use disorder/);
  });
});

// ---------- The grid ----------

test("rows appear in order: buprenorphine, methadone, naltrexone, with the Suboxone note", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const rows = await page.$$eval("#rows .drug", (els) =>
      els.map((e) => ({ name: e.querySelector("h2").textContent, note: e.querySelector(".drug-note").textContent }))
    );
    assert.deepEqual(rows.map((r) => r.name), ["Buprenorphine (Suboxone)", "Methadone", "Naltrexone (Vivitrol)"]);
    assert.match(rows[0].note, /Suboxone is a brand-name combination of buprenorphine and naloxone\./);
  });
});

test("five topic columns appear, including both weight columns", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const heads = await page.$$eval("#col-heads span", (els) => els.map((e) => e.textContent));
    assert.deepEqual(heads, [
      "Medication",
      "Appetite Effects",
      "Calorie-dense Food Cravings",
      "Weight: does it go up?",
      "Weight: how much?",
      "Stomach and gut effects",
    ]);
  });
});

test("every medication row has five cells in topic order, 15 grid cells in all", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const rows = await page.$$eval("#rows .drug", (els) =>
      els.map((row) => [...row.querySelectorAll("details.cell .cell-title")].map((t) => t.textContent))
    );
    assert.equal(rows.length, 3);
    for (const labels of rows) assert.deepEqual(labels, data.topics.map((t) => t.name));
    assert.equal(await page.locator("#rows details.cell").count(), 15);
  });
});

test("on a wide screen the grid has a name column plus five topic columns", async () => {
  await withPage(SITE, { width: 1400 }, async (page) => {
    await ready(page);
    const cols = await page.evaluate(
      () => getComputedStyle(document.querySelector(".layout-row")).gridTemplateColumns.split(" ").length
    );
    assert.equal(cols, 6);
  });
});

test("each cell shows the summary from data.json and the right evidence label", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const labelFor = Object.fromEntries(data.meta.strength_levels.map((l) => [l.id, l.label]));
    const meds = data.medications.map((m) => m.id);
    const topics = data.topics.map((t) => t.id);
    const cells = await page.$$eval("#rows details.cell", (els) =>
      els.map((e) => ({ summary: e.querySelector(".summary-text").textContent, badge: e.querySelector("summary .badge").textContent }))
    );
    meds.forEach((m, mi) => topics.forEach((t, ti) => {
      const expected = data.cells.find((c) => c.medication === m && c.topic === t);
      const actual = cells[mi * topics.length + ti];
      assert.equal(actual.summary, expected.summary, `${m}/${t} summary`);
      assert.ok(actual.badge.endsWith(labelFor[expected.strength]), `${m}/${t} badge "${actual.badge}"`);
    }));
  });
});

// ---------- Evidence labels ----------

test("legend shows all four labels, each with its own symbol as well as colour", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const badges = await page.$$eval("#legend .badge", (els) => els.map((e) => e.textContent.trim()));
    assert.equal(badges.length, 4);
    for (const word of ["Strong", "Mixed", "Thin", "Needs source"]) {
      assert.ok(badges.some((b) => b.endsWith(word)), `legend is missing "${word}"`);
    }
    const symbols = badges.map((b) => b.split(" ")[0]);
    assert.equal(new Set(symbols).size, 4, `symbols should all differ, got ${symbols.join(" ")}`);
  });
});

test("cell labels in the grid match how many cells have each strength in data.json", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const onPage = await page.$$eval("#rows details.cell", (els) =>
      els.reduce((acc, e) => {
        const k = [...e.classList].find((c) => c.startsWith("ev-"));
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    );
    const expected = {};
    for (const c of data.cells) expected["ev-" + cssName(c.strength)] = (expected["ev-" + cssName(c.strength)] || 0) + 1;
    assert.deepEqual(onPage, expected);
  });
});

for (const scheme of ["light", "dark"]) {
  test(`[${scheme}] no evidence label is green, and "Thin" is red`, async () => {
    await withPage(SITE, { scheme }, async (page) => {
      await ready(page);
      const colours = await page.evaluate(() => {
        const out = {};
        for (const k of ["strong", "mixed", "thin", "needs-source"]) {
          const s = getComputedStyle(document.querySelector("#legend .badge-" + k));
          out[k] = { fg: s.color, bg: s.backgroundColor, border: s.borderTopColor };
        }
        return out;
      });
      for (const [level, c] of Object.entries(colours)) {
        for (const part of ["fg", "bg", "border"]) {
          assert.ok(!isGreen(rgbToHex(c[part])), `${level} ${part} ${c[part]} is green`);
        }
      }
      const thinHue = hue(rgbToHex(colours.thin.fg));
      assert.ok(thinHue <= 12 || thinHue >= 348, `Thin text hue ${thinHue} is not red`);
    });
  });
}

test('"needs source" cells look visibly different (dashed border, hatched background, italic)', async () => {
  await withPage("/gap/index.html", {}, async (page) => {
    await ready(page);
    const styles = await page.$$eval("#rows details.cell", (els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return {
          gap: e.classList.contains("ev-needs-source"),
          border: s.borderTopStyle,
          hatched: s.backgroundImage.includes("repeating-linear-gradient"),
          italic: getComputedStyle(e.querySelector(".summary-text")).fontStyle,
        };
      })
    );
    const gaps = styles.filter((s) => s.gap);
    assert.equal(gaps.length, 1);
    for (const g of gaps) { assert.equal(g.border, "dashed"); assert.ok(g.hatched); assert.equal(g.italic, "italic"); }
    for (const s of styles.filter((x) => !x.gap)) { assert.equal(s.border, "solid"); assert.ok(!s.hatched); }
  });
});

// ---------- Opening cells ----------

test("cells start closed, and clicking one reveals detail, facts, caveat and sources", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    assert.equal(await page.locator("details.cell[open]").count(), 0);
    const first = page.locator("#rows details.cell").first(); // buprenorphine / appetite
    assert.equal(await first.locator(".more").isVisible(), false);
    await first.locator("summary").click();
    assert.equal(await first.evaluate((e) => e.open), true);
    const cell = data.cells.find((c) => c.id === "buprenorphine-appetite-effects");
    assert.equal(await first.locator(".more").isVisible(), true);
    assert.equal(await first.locator(".more > p").first().textContent(), cell.detail);
    const facts = await first.locator(".facts").textContent();
    assert.ok(facts.includes(cell.population) && facts.includes(cell.duration));
    assert.ok((await first.locator(".caveat").textContent()).includes(cell.caveat));
    // Every cited source is listed, with a link for each one that has a URL in data.json.
    assert.equal(await first.locator(".more ul li").count(), cell.sources.length);
    const withUrl = cell.sources.filter((id) => data.sources.find((s) => s.id === id).url).length;
    assert.equal(await first.locator(".more ul a").count(), withUrl);
    await first.locator("summary").click();
    assert.equal(await first.evaluate((e) => e.open), false);
  });
});

test('opening a "needs source" cell says there is no source yet', async () => {
  await withPage("/gap/index.html", {}, async (page) => {
    await ready(page);
    const gap = page.locator("#rows details.cell.ev-needs-source").first();
    await gap.locator("summary").click();
    assert.match(await gap.locator(".more").textContent(), /No source yet/);
    assert.equal(await gap.locator(".more a").count(), 0);
  });
});

test("keyboard: Tab reaches a cell, Enter opens it, Space closes it", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "SUMMARY");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("details.cell[open]").count(), 1);
    await page.keyboard.press("Space");
    assert.equal(await page.locator("details.cell[open]").count(), 0);
  });
});

test("a focused cell has a visible focus outline", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    assert.notEqual(outline.style, "none");
    assert.ok(outline.width >= 2);
  });
});

test("an open cell is highlighted (accent edge bar)", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    await page.locator("#rows details.cell").first().locator("summary").click();
    const shadow = await page.evaluate(() => getComputedStyle(document.querySelector("details.cell[open]")).boxShadow);
    assert.notEqual(shadow, "none");
  });
});

// ---------- Sources and links ----------

test("every source link opens in a new tab safely; the Nolan & Scagnelli link is correct", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const links = await page.$$eval("#sources a", (els) => els.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
    assert.equal(links.length, data.sources.filter((s) => s.url).length);
    for (const l of links) {
      assert.equal(l.target, "_blank");
      assert.ok(l.rel.includes("noopener") && l.rel.includes("noreferrer"));
      assert.match(l.href, /^https:\/\//);
    }
    assert.ok(links.some((l) => l.href === "https://www.tandfonline.com/doi/full/10.1080/10826080701517727"));
  });
});

test("the full source list, open questions and reading list are all shown", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    assert.equal(await page.locator("#sources li").count(), data.sources.length);
    assert.equal(await page.locator("#open li").count(), data.open_questions.length);
    assert.equal(await page.locator("#next li").count(), data.to_read_next.length);
  });
});

// ---------- Layer sections ----------

test("every layer section shows its cells; the four original sections each have their own accent colour", async () => {
  await withPage(SITE, {}, async (page) => {
    await ready(page);
    const sections = await page.$$eval(".layer[data-layer]", (els) =>
      els.map((e) => ({
        id: e.dataset.layer,
        cells: e.querySelectorAll("details.cell").length,
        bar: getComputedStyle(e).borderLeftColor,
        heading: getComputedStyle(e.querySelector("h2")).color,
      }))
    );
    assert.deepEqual(sections.map((s) => s.id), data.layers.map((l) => l.id));
    assert.deepEqual(sections.map((s) => s.cells), data.layers.map((l) => l.cells.length));
    // metabolic_health has no accent of its own yet (it falls back to the default blue), so only the four original sections are checked.
    const original = sections.filter((s) => ["recovery_phase", "setting", "food_access", "who_gains_more"].includes(s.id));
    assert.equal(new Set(original.map((s) => s.bar)).size, 4, "each original layer needs its own accent colour");
    for (const s of sections) assert.equal(s.heading, s.bar, `${s.id}: heading should match its accent`);
  });
});

// ---------- Look and layout ----------

test("light mode has a beige background; dark mode switches to a dark one", async () => {
  const bg = async (scheme) =>
    withPage(SITE, { scheme }, async (page) => { await ready(page); return page.evaluate(() => getComputedStyle(document.body).backgroundColor); });
  assert.equal(await bg("light"), "rgb(243, 237, 224)");
  assert.equal(await bg("dark"), "rgb(20, 23, 26)");
});

for (const [width, scheme] of [[1400, "light"], [1100, "light"], [768, "light"], [390, "light"], [390, "dark"]]) {
  test(`no sideways scrolling at ${width}px wide (${scheme})`, async () => {
    await withPage(SITE, { width, height: 900, scheme }, async (page) => {
      await ready(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    });
  });
}

test("on a phone each row stacks into one column and every cell shows its own label", async () => {
  await withPage(SITE, { width: 390, height: 900 }, async (page) => {
    await ready(page);
    const cells = await page.$$eval("#rows .drug:first-child details.cell", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const t = e.querySelector(".cell-title").getBoundingClientRect();
        return { left: Math.round(r.left), top: r.top, titleVisible: t.width > 10 && t.height > 10 };
      })
    );
    assert.equal(cells.length, 5);
    assert.equal(new Set(cells.map((c) => c.left)).size, 1, "cells should line up in one column");
    for (let i = 1; i < cells.length; i++) assert.ok(cells[i].top > cells[i - 1].top, "cells should stack downwards");
    assert.ok(cells.every((c) => c.titleVisible), "column labels must be visible on a phone");
  });
});

// ---------- When things go wrong ----------

test("if data.json is missing, a friendly message explains how to run a local server", async () => {
  await withPage("/broken/index.html", {}, async (page) => {
    await page.waitForSelector("#status.error");
    const text = await page.textContent("#status");
    assert.match(text, /Could not load or read data\.json/);
    assert.match(text, /python3 -m http\.server/);
    assert.equal(await page.locator("#content").isHidden(), true);
  });
});

test("hostile text in data.json is shown as plain text and cannot run code or create unsafe links", async () => {
  await withPage("/unsafe/index.html", {}, async (page) => {
    await ready(page);
    const first = page.locator("#rows details.cell").nth(0);
    assert.equal(await first.locator(".summary-text").textContent(), '<img src=x onerror="window.__pwned=1">');
    assert.equal(await page.locator("#rows img").count(), 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await page.locator('a[href^="javascript:" i]').count(), 0);
    // The source with a javascript: URL is still listed, but as plain text; a source with no link too.
    const sourcesText = await first.locator(".more").textContent();
    assert.ok(sourcesText.includes("Evil link"));
    assert.ok(sourcesText.includes("Source with no link"));
  });
});
