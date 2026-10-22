// Shared tools for the tests. Nothing here is part of the website itself.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// ---------- Colour maths (used to check accessibility and "no green") ----------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG contrast ratio between two #rrggbb colours (1 to 21).
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Hue in degrees (0-359), or null for greys (too little colour to have a hue).
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return null;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

const isGreen = (hex) => { const h = hue(hex); return h !== null && h >= 75 && h <= 170; };
const isRed = (hex) => { const h = hue(hex); return h !== null && (h <= 12 || h >= 348); };

// "rgb(31, 41, 51)" (what the browser reports) -> "#1f2933"
function rgbToHex(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ---------- Reading the colour "tokens" out of index.html's CSS ----------

function blockAfter(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("CSS block not found: " + marker);
  const open = text.indexOf("{", start);
  const close = text.indexOf("}", open);
  return text.slice(open + 1, close);
}

function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

// Returns { light: {...}, dark: {...} }. Dark mode only overrides some tokens,
// so dark = light with the dark overrides on top.
function parseTokens(html) {
  const light = tokensIn(blockAfter(html, ":root {"));
  const dark = { ...light, ...tokensIn(blockAfter(html, ':root:not([data-theme="light"])')) };
  return { light, dark };
}

// ---------- A tiny web server that imitates GitHub Pages ----------
//
//  /repo-name/   the real site, served from a SUBFOLDER (like github.io/repo-name/)
//  /broken/      the site, but data.json is missing (tests the error message)
//  /unsafe/      the site with hostile text in the data (tests it can't inject code)

function startServer() {
  const indexHtml = read("index.html");
  const dataText = read("data.json");
  const previewHtml = read("preview/index.html");
  const previewData = read("preview/data.json");

  const unsafe = JSON.parse(dataText);
  // Poison the cell that appears first in the grid (found by id, so row order doesn't matter).
  const victim = unsafe.cells.find((c) => c.id === "buprenorphine-appetite-effects");
  victim.summary = '<img src=x onerror="window.__pwned=1">';
  victim.sources = ["evil", "nolink"];
  unsafe.sources.push(
    { id: "evil", citation: "Evil link", url: "javascript:window.__pwned=1", publication_type: "peer-reviewed", note: "" },
    { id: "nolink", citation: "Source with no link", url: null, publication_type: "peer-reviewed", note: "" }
  );

  // A copy of the site where one grid cell is a "needs source" gap, so the gap styling stays tested
  // even when data.json has no gaps.
  const gap = JSON.parse(dataText);
  Object.assign(gap.cells.find((c) => c.id === "naltrexone-gi"), {
    summary: "Not yet sourced.", detail: "To fill in: check the FDA label.", strength: "needs_source",
    evidence_type: null, publication_type: null, population: null, duration: null, caveat: null, sources: [],
  });

  const routes = {
    "/repo-name/": [200, "text/html", indexHtml],
    "/repo-name/index.html": [200, "text/html", indexHtml],
    "/repo-name/data.json": [200, "application/json", dataText],
    "/repo-name/preview/": [200, "text/html", previewHtml],
    "/repo-name/preview/index.html": [200, "text/html", previewHtml],
    "/repo-name/preview/data.json": [200, "application/json", previewData],
    "/broken/index.html": [200, "text/html", indexHtml],
    "/gap/index.html": [200, "text/html", indexHtml],
    "/gap/data.json": [200, "application/json", JSON.stringify(gap)],
    "/unsafe/index.html": [200, "text/html", indexHtml],
    "/unsafe/data.json": [200, "application/json", JSON.stringify(unsafe)],
  };

  const server = http.createServer((req, res) => {
    const [status, type, body] = routes[req.url.split("?")[0]] || [404, "text/plain", "Not found"];
    res.writeHead(status, { "Content-Type": type + "; charset=utf-8" });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ---------- Playwright (the headless browser) ----------

function loadPlaywright() {
  try { return require("playwright"); } catch { /* not installed locally */ }
  try { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } catch { /* not global either */ }
  throw new Error("Playwright is not installed. Run:  npm install  and then  npx playwright install chromium");
}

async function launchBrowser() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch();
  } catch (err) {
    // Some machines have a Chromium at a fixed path instead of Playwright's own download.
    const fallback = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
    if (fs.existsSync(fallback)) return chromium.launch({ executablePath: fallback });
    throw err;
  }
}

module.exports = {
  ROOT, read, contrast, hue, isGreen, isRed, rgbToHex, parseTokens, startServer, launchBrowser,
};
