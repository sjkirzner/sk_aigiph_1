// Tests for the GitHub Actions workflow (.github/workflows/tests.yml).
// GitHub itself runs the workflow; these tests check that it is set up the way we agreed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { read } = require("./helpers");

const yml = read(".github/workflows/tests.yml");
const pkg = JSON.parse(read("package.json"));
const lines = yml.split("\n").filter((l) => !l.trim().startsWith("#"));
const code = lines.join("\n");

test("the workflow is named Tests", () => {
  assert.match(code, /^name: Tests$/m);
});

test("it runs on every push and every pull request", () => {
  assert.match(code, /^on:\n {2}push:\n {2}pull_request:/m);
  assert.doesNotMatch(code, /branches:/, "no branch filter: it should run for every branch");
});

test("it runs the project's own test command, `npm test`", () => {
  assert.equal(pkg.scripts.test, "node --test --test-reporter=spec");
  assert.match(code, /- run: npm test$/m);
});

test("it installs dependencies and the Chromium browser before running the tests", () => {
  const install = code.indexOf("- run: npm install");
  const browser = code.indexOf("npx playwright install --with-deps chromium");
  const tests = code.indexOf("- run: npm test");
  assert.ok(install > -1 && browser > install && tests > browser, "order must be: install, browser, test");
});

test("it checks out the code and sets up Node 20 or newer", () => {
  assert.match(code, /uses: actions\/checkout@v\d+/);
  assert.match(code, /uses: actions\/setup-node@v\d+/);
  const major = Number(code.match(/node-version: (\d+)/)[1]);
  assert.ok(major >= 20, `Node ${major} is too old for the test runner options we use`);
});

test("it has least-privilege permissions and a timeout", () => {
  assert.match(code, /permissions:\n {2}contents: read/);
  assert.match(code, /timeout-minutes: \d+/);
});
