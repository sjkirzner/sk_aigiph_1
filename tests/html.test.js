// Tests that read index.html as text: does the source follow the rules we set
// (relative paths, no frameworks, accessible colours, no green in the evidence scale)?
const test = require("node:test");
const assert = require("node:assert/strict");
const { read, contrast, hue, isGreen, isRed, parseTokens } = require("./helpers");

const html = read("index.html");
const { light, dark } = parseTokens(html);
const themes = { light, dark };

test("data is loaded with a relative path, so it works from a /repo-name/ subfolder", () => {
  assert.match(html, /fetch\("data\.json"\)/);
  assert.doesNotMatch(html, /fetch\(\s*["'`]\//, 'fetch() must not start with "/"');
});

test("no root-absolute links or asset paths (they would break on GitHub Pages)", () => {
  assert.doesNotMatch(html, /\b(?:src|href)=["']\/(?!\/)/);
  assert.doesNotMatch(html, /url\(\s*["']?\/(?!\/)/);
});

test("no frameworks or external scripts/stylesheets: everything is inline", () => {
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.doesNotMatch(html, /@import/);
});

test("page text is inserted safely (no innerHTML, eval or document.write)", () => {
  assert.doesNotMatch(html, /\.innerHTML\b/);
  assert.doesNotMatch(html, /\beval\s*\(/);
  assert.doesNotMatch(html, /document\.write/);
});

test("phone and accessibility basics: lang, viewport, colour-scheme", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
});

test("the disclaimer sits above the grid in the page", () => {
  assert.ok(html.indexOf('class="disclaimer"') < html.indexOf('id="content"'));
  assert.ok(html.indexOf('id="footnote"') > html.indexOf('class="disclaimer"'));
});

test("dark mode and visible keyboard focus are defined", () => {
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /:focus-visible\s*\{[^}]*outline/);
});

test('"needs source" cells are styled with a dashed border', () => {
  assert.match(html, /details\.cell\.ev-needs-source\s*\{[^}]*dashed/);
});

test("the page reads the light background as warm beige", () => {
  assert.equal(light["--bg"], "#f3ede0");
});

// ---------- Evidence colours ----------

const STRENGTH = ["--strong-bg", "--strong-fg", "--mixed-bg", "--mixed-fg", "--thin-bg", "--thin-fg", "--none-bg", "--none-fg"];
const DECORATION = ["--blue", "--blue-tint", "--green", "--green-tint", "--teal", "--teal-tint", "--indigo", "--indigo-tint"];

for (const [name, t] of Object.entries(themes)) {
  test(`[${name}] no green anywhere in the evidence-strength colours`, () => {
    for (const key of STRENGTH) assert.ok(!isGreen(t[key]), `${key} (${t[key]}) is green`);
  });

  test(`[${name}] "Thin" is red`, () => {
    assert.ok(isRed(t["--thin-fg"]), `--thin-fg ${t["--thin-fg"]} should be red (hue ${hue(t["--thin-fg"])})`);
    assert.ok(isRed(t["--thin-bg"]), `--thin-bg ${t["--thin-bg"]} should be red-tinted (hue ${hue(t["--thin-bg"])})`);
  });

  test(`[${name}] the four evidence levels look different from each other`, () => {
    const pairs = [
      ["strong", `${t["--strong-bg"]}/${t["--strong-fg"]}`],
      ["mixed", `${t["--mixed-bg"]}/${t["--mixed-fg"]}`],
      ["thin", `${t["--thin-bg"]}/${t["--thin-fg"]}`],
      ["needs", `${t["--none-bg"]}/${t["--none-fg"]}`],
    ];
    assert.equal(new Set(pairs.map((p) => p[1])).size, 4);
    // Mixed (amber) and Thin (red) are the closest pair for colour-blind readers, so they must
    // also differ in lightness of their text, or rely on the symbol (checked in the browser tests).
    assert.notEqual(t["--mixed-fg"], t["--thin-fg"]);
  });

  test(`[${name}] decorative blue/green colours are never reused for evidence strength`, () => {
    const strengthColours = new Set(STRENGTH.map((k) => t[k]));
    for (const key of DECORATION) assert.ok(!strengthColours.has(t[key]), `${key} (${t[key]}) duplicates a strength colour`);
  });

  test(`[${name}] the four layer accent colours are all different`, () => {
    const accents = ["--blue", "--green", "--teal", "--indigo"].map((k) => t[k]);
    assert.equal(new Set(accents).size, 4);
  });

  // WCAG: 4.5:1 for normal text, 3:1 for borders/graphics.
  const textPairs = [
    ["body text on page", "--text", "--bg"],
    ["body text on cards", "--text", "--surface"],
    ["muted text on page", "--muted", "--bg"],
    ["muted text on cards", "--muted", "--surface"],
    ["disclaimer text", "--text", "--warn-bg"],
    ["caveat text", "--text", "--note-bg"],
    ["Strong badge", "--strong-fg", "--strong-bg"],
    ["Mixed badge", "--mixed-fg", "--mixed-bg"],
    ["Thin badge", "--thin-fg", "--thin-bg"],
    ["Needs-source badge on cards", "--none-fg", "--surface"],
    ["Needs-source badge on page", "--none-fg", "--bg"],
    ["blue on page", "--blue", "--bg"],
    ["blue on cards", "--blue", "--surface"],
    ["blue on its tint", "--blue", "--blue-tint"],
    ["green on page", "--green", "--bg"],
    ["green on cards", "--green", "--surface"],
    ["green on its tint", "--green", "--green-tint"],
    ["teal on page", "--teal", "--bg"],
    ["teal on cards", "--teal", "--surface"],
    ["teal on its tint", "--teal", "--teal-tint"],
    ["indigo on page", "--indigo", "--bg"],
    ["indigo on cards", "--indigo", "--surface"],
    ["indigo on its tint", "--indigo", "--indigo-tint"],
  ];
  for (const [label, fg, bg] of textPairs) {
    test(`[${name}] contrast >= 4.5: ${label}`, () => {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 4.5, `${fg} ${t[fg]} on ${bg} ${t[bg]} is only ${ratio.toFixed(2)}:1`);
    });
  }

  const borderPairs = [
    ["red Thin border on page", "--thin-fg", "--bg"],
    ["red Thin border on cards", "--thin-fg", "--surface"],
    ["Mixed border on page", "--mixed-fg", "--bg"],
    ["disclaimer border on page", "--warn-border", "--bg"],
  ];
  for (const [label, fg, bg] of borderPairs) {
    test(`[${name}] contrast >= 3: ${label}`, () => {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 3, `${fg} ${t[fg]} against ${bg} ${t[bg]} is only ${ratio.toFixed(2)}:1`);
    });
  }
}
