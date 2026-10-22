// Tests for `npm run go-live` (tools/go-live.js) and `npm run sync-preview` (tools/sync-preview.js).
// Each test runs the real script on a throwaway copy of the files in a temp folder,
// so the real pages are never touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { ROOT, read } = require("./helpers");

const PREFIX = "PREVIEW - ";

const REAL_TITLE = JSON.parse(read("data.json")).meta.title;

// Starts from the public page and builds a matching preview with sync-preview, so these tests
// do not depend on whatever unreleased changes the real preview folder holds right now.
function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-test-"));
  fs.mkdirSync(path.join(dir, "tools"));
  for (const f of ["index.html", "data.json"]) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  for (const f of ["go-live.js", "sync-preview.js"]) fs.copyFileSync(path.join(ROOT, "tools", f), path.join(dir, "tools", f));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "sentinel: must never change\n");
  const r = spawnSync("node", [path.join(dir, "tools", "sync-preview.js")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}
const run = (dir, script) => spawnSync("node", [path.join(dir, "tools", script)], { encoding: "utf8" });
const get = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), "utf8");
const put = (dir, p, text) => fs.writeFileSync(path.join(dir, p), text);

function hashAll(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

// Gives the preview some unreleased changes: a new HTML comment, a new date, and a new topic-free text tweak.
function makePreviewAhead(dir) {
  put(dir, "preview/index.html", get(dir, "preview/index.html").replace("</body>", "<!-- preview-only change --></body>"));
  const d = JSON.parse(get(dir, "preview/data.json"));
  d.meta.last_updated = String(d.meta.last_updated) + " (changed in preview)"; // always differs from the public value
  put(dir, "preview/data.json", JSON.stringify(d, null, 2) + "\n");
}

test("package.json has the go-live and sync-preview commands", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["go-live"], "node tools/go-live.js");
  assert.equal(pkg.scripts["sync-preview"], "node tools/sync-preview.js");
});

test("go-live copies the preview over the public page and removes PREVIEW from the title", () => {
  const dir = makeTree();
  makePreviewAhead(dir);
  const before = hashAll(dir);
  const r = run(dir, "go-live.js");
  assert.equal(r.status, 0, r.stderr);

  assert.equal(get(dir, "index.html"), get(dir, "preview/index.html"), "public HTML should equal the preview HTML");
  const live = JSON.parse(get(dir, "data.json"));
  const preview = JSON.parse(get(dir, "preview/data.json"));
  assert.equal(live.meta.title, REAL_TITLE);
  assert.ok(live.meta.last_updated.endsWith("(changed in preview)"), "unreleased changes must now be public");
  const expected = JSON.parse(JSON.stringify(preview));
  expected.meta.title = preview.meta.title.slice(PREFIX.length);
  assert.deepEqual(live, expected, "public data should equal preview data except for the title");

  const after = hashAll(dir);
  assert.equal(after["preview/index.html"], before["preview/index.html"], "the preview itself must not change");
  assert.equal(after["preview/data.json"], before["preview/data.json"], "the preview itself must not change");
  assert.ok(get(dir, "preview/data.json").includes('"title": ' + JSON.stringify(PREFIX + REAL_TITLE)), "the preview keeps its PREVIEW title");
});

test("go-live changes only index.html and data.json, nothing else", () => {
  const dir = makeTree();
  makePreviewAhead(dir);
  const before = hashAll(dir);
  assert.equal(run(dir, "go-live.js").status, 0);
  const after = hashAll(dir);
  const changed = Object.keys(after).filter((f) => after[f] !== before[f]).sort();
  assert.deepEqual(changed, ["data.json", "index.html"]);
  assert.equal(get(dir, "CLAUDE.md"), "sentinel: must never change\n");
});

test("running go-live when the public page already matches says so and changes nothing", () => {
  const dir = makeTree();
  const before = hashAll(dir);
  const r = run(dir, "go-live.js");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Already live/);
  assert.deepEqual(hashAll(dir), before);
});

test("go-live stops and changes nothing if the preview title has no PREVIEW prefix", () => {
  const dir = makeTree();
  put(dir, "preview/data.json", get(dir, "preview/data.json").replace(JSON.stringify(PREFIX + REAL_TITLE), JSON.stringify(REAL_TITLE)));
  const before = hashAll(dir);
  const r = run(dir, "go-live.js");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP, nothing was changed/);
  assert.match(r.stderr, /must start with "PREVIEW - "/);
  assert.deepEqual(hashAll(dir), before);
});

test("go-live stops and changes nothing if the preview data is not valid JSON", () => {
  const dir = makeTree();
  put(dir, "preview/data.json", "{ this is not json");
  const before = hashAll(dir);
  const r = run(dir, "go-live.js");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.deepEqual(hashAll(dir), before);
});

test("go-live stops and changes nothing if the preview files are missing", () => {
  const dir = makeTree();
  fs.rmSync(path.join(dir, "preview", "index.html"));
  const before = hashAll(dir);
  const r = run(dir, "go-live.js");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOP/);
  assert.deepEqual(hashAll(dir), before);
});

test("sync-preview resets the preview to match the public page, with only the title different", () => {
  const dir = makeTree();
  makePreviewAhead(dir);
  assert.equal(run(dir, "sync-preview.js").status, 0);
  assert.equal(get(dir, "preview/index.html"), get(dir, "index.html"));
  const a = get(dir, "data.json").split("\n");
  const b = get(dir, "preview/data.json").split("\n");
  assert.equal(a.length, b.length);
  assert.equal(a.filter((line, i) => line !== b[i]).length, 1, "exactly one line (the title) should differ");
  assert.equal(JSON.parse(get(dir, "preview/data.json")).meta.title, PREFIX + REAL_TITLE);
});

test("go-live and then sync-preview leave everything exactly as it was (round trip)", () => {
  const dir = makeTree();
  makePreviewAhead(dir);
  assert.equal(run(dir, "go-live.js").status, 0);
  const afterLive = hashAll(dir);
  assert.equal(run(dir, "sync-preview.js").status, 0);
  assert.deepEqual(hashAll(dir), afterLive);
});
