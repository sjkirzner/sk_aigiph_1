// Tests for data.json: is the content complete, consistent, and shaped the way the page expects?
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read } = require("./helpers");

const data = JSON.parse(read("data.json"));
const layerCells = data.layers.flatMap((l) => l.cells);
const allCells = [...data.cells, ...layerCells];
const strengthIds = data.meta.strength_levels.map((l) => l.id);

test("index.html and data.json sit at the root of the repo (needed for GitHub Pages)", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "index.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "data.json")));
});

test("data.json has every top-level section the page reads", () => {
  for (const key of ["meta", "medications", "topics", "cells", "layers", "open_questions", "to_read_next", "sources"]) {
    assert.ok(key in data, `missing "${key}"`);
  }
});

test("page title, disclaimer and MOUD footnote are present", () => {
  assert.equal(data.meta.title, "MOUD, Food, and Metabolism");
  assert.match(data.meta.disclaimer, /not medical advice/i);
  assert.match(data.meta.disclaimer, /change a medication or a diet/i);
  assert.match(data.meta.footnote, /MOUD stands for medications for opioid use disorder/);
  assert.match(data.meta.last_updated, /^\d{4}-\d{2}-\d{2}$/);
});

test("the four evidence levels exist, each with a label and meaning", () => {
  assert.deepEqual(strengthIds, ["strong", "mixed", "thin", "needs_source"]);
  for (const level of data.meta.strength_levels) {
    assert.ok(level.label && level.meaning, `level ${level.id} needs a label and meaning`);
  }
});

test("rows are ordered buprenorphine, methadone, naltrexone", () => {
  assert.deepEqual(data.medications.map((m) => m.id), ["buprenorphine", "methadone", "naltrexone"]);
});

test("buprenorphine's note explains that Suboxone combines buprenorphine and naloxone", () => {
  const bup = data.medications.find((m) => m.id === "buprenorphine");
  assert.match(bup.note, /Suboxone is a brand-name combination of buprenorphine and naloxone\./);
});

test("there are five topic columns, including both weight questions", () => {
  assert.deepEqual(data.topics.map((t) => t.id), ["appetite_effects", "calorie_dense_cravings", "weight_direction", "weight_amount", "gi"]);
  assert.equal(data.topics[0].name, "Appetite Effects");
  assert.equal(data.topics[1].name, "Calorie-dense Food Cravings");
  assert.ok(!JSON.stringify(data).includes("food desire"), 'old wording "food desire" is still in the data');
});

test("every medication x topic pair has exactly one cell (3 x 5 = 15)", () => {
  assert.equal(data.cells.length, 15);
  for (const m of data.medications) {
    for (const t of data.topics) {
      const matches = data.cells.filter((c) => c.medication === m.id && c.topic === t.id);
      assert.equal(matches.length, 1, `${m.id} / ${t.id} should have exactly one cell`);
    }
  }
});

test("no cell points at a medication or topic that does not exist", () => {
  const meds = new Set(data.medications.map((m) => m.id));
  const topics = new Set(data.topics.map((t) => t.id));
  for (const c of data.cells) {
    assert.ok(meds.has(c.medication), `${c.id}: unknown medication ${c.medication}`);
    assert.ok(topics.has(c.topic), `${c.id}: unknown topic ${c.topic}`);
  }
});

test("the five layer sections exist and have cells (21 in total)", () => {
  assert.deepEqual(
    data.layers.map((l) => l.id),
    ["recovery_phase", "setting", "food_access", "who_gains_more", "metabolic_health"]
  );
  for (const l of data.layers) assert.ok(l.title && l.description && l.cells.length > 0, `layer ${l.id} incomplete`);
  assert.equal(layerCells.length, 21);
});

test("all cell ids are unique", () => {
  const ids = allCells.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every cell has a summary, detail and a valid evidence level", () => {
  for (const c of allCells) {
    assert.ok(c.summary && c.summary.trim(), `${c.id}: empty summary`);
    assert.ok(c.detail && c.detail.trim(), `${c.id}: empty detail`);
    assert.ok(strengthIds.includes(c.strength), `${c.id}: unknown strength "${c.strength}"`);
  }
});

test('"needs_source" cells have no evidence fields and no sources', () => {
  const gaps = allCells.filter((c) => c.strength === "needs_source");
  // The known gaps right now. When you fill one in, update this list.
  assert.deepEqual(
    gaps.map((c) => c.id).sort(),
    [] // none right now: every grid cell has content
  );
  for (const c of gaps) {
    assert.deepEqual(c.sources, [], `${c.id}: a needs_source cell must not cite sources`);
    for (const f of ["evidence_type", "publication_type", "population", "duration", "caveat"]) {
      assert.equal(c[f], null, `${c.id}: ${f} should be null`);
    }
  }
});

test("every finding (not a gap) has evidence fields, a caveat and at least one source", () => {
  const findings = allCells.filter((c) => c.strength !== "needs_source");
  for (const c of findings) {
    assert.ok(data.meta.evidence_types.includes(c.evidence_type), `${c.id}: bad evidence_type "${c.evidence_type}"`);
    assert.ok(data.meta.publication_types.includes(c.publication_type), `${c.id}: bad publication_type "${c.publication_type}"`);
    for (const f of ["population", "duration", "caveat"]) assert.ok(c[f] && c[f].trim(), `${c.id}: missing ${f}`);
    assert.ok(c.sources.length >= 1, `${c.id}: a finding needs a source`);
  }
});

test("every cited source id exists, and every source is cited somewhere", () => {
  const known = new Set(data.sources.map((s) => s.id));
  const cited = new Set();
  for (const c of allCells) for (const id of c.sources) {
    assert.ok(known.has(id), `${c.id} cites unknown source "${id}"`);
    cited.add(id);
  }
  for (const id of known) assert.ok(cited.has(id), `source "${id}" is never cited`);
});

test("source ids are unique and each source has a citation", () => {
  const ids = data.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of data.sources) assert.ok(s.citation && s.citation.trim(), `${s.id}: empty citation`);
});

test("source links are either null or https", () => {
  for (const s of data.sources) {
    assert.ok(s.url === null || /^https:\/\//.test(s.url), `${s.id}: url must be null or https, got ${s.url}`);
  }
});

test("the Nolan & Scagnelli source links to the Taylor & Francis article", () => {
  const nolan = data.sources.find((s) => s.id === "nolan2007");
  assert.equal(nolan.url, "https://www.tandfonline.com/doi/full/10.1080/10826080701517727");
});

test("open questions and reading list are non-empty lists of text", () => {
  for (const list of [data.open_questions, data.to_read_next]) {
    assert.ok(list.length > 0);
    for (const item of list) assert.equal(typeof item, "string");
  }
});
