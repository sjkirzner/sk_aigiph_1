// Tests for the "run the tests after every reply" hook (.claude/settings.json + .claude/hooks/run-tests.sh).
// The hook is run with a FAKE test command, so these tests never call `npm test` (which would loop forever).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, read } = require("./helpers");

const SCRIPT = path.join(ROOT, ".claude", "hooks", "run-tests.sh");

function runHook(fakeTestCommand, stdin = "{}") {
  const result = spawnSync("bash", [SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, CLAUDE_HOOK_TEST_CMD: fakeTestCommand },
  });
  return { code: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

const PASSING = 'echo "ℹ tests 5"; echo "ℹ pass 5"; echo "ℹ fail 0"; exit 0';
const FAILING = 'echo "✖ the broken test (2ms)"; echo "ℹ tests 5"; echo "ℹ pass 4"; echo "ℹ fail 1"; exit 1';

test("settings.json registers a Stop hook that runs the test script", () => {
  const settings = JSON.parse(read(".claude/settings.json"));
  const hooks = settings.hooks.Stop.flatMap((group) => group.hooks);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].type, "command");
  assert.match(hooks[0].command, /\.claude\/hooks\/run-tests\.sh/);
  assert.ok(hooks[0].timeout >= 60, "timeout must leave room for the browser tests");
});

test("the hook script exists and is executable", () => {
  assert.ok(fs.existsSync(SCRIPT));
  fs.accessSync(SCRIPT, fs.constants.X_OK);
});

test("hook runs `npm test` by default", () => {
  assert.match(read(".claude/hooks/run-tests.sh"), /CLAUDE_HOOK_TEST_CMD:-npm test/);
});

test("passing tests: shows a summary and does not block Claude", () => {
  const r = runHook(PASSING);
  assert.equal(r.code, 0);
  assert.match(r.json.systemMessage, /Tests passed/);
  assert.match(r.json.systemMessage, /pass 5/);
  assert.equal(r.json.decision, undefined);
});

test("failing tests: blocks once and tells Claude what failed and the project rules", () => {
  const r = runHook(FAILING, '{"stop_hook_active": false}');
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, "block");
  assert.match(r.json.reason, /the broken test/);
  assert.match(r.json.reason, /ask the user before changing or deleting/i);
  assert.match(r.json.reason, /Do not push/);
  assert.match(r.json.systemMessage, /Tests failed/);
});

test("failing again after Claude already retried: reports but does NOT block (no infinite loop)", () => {
  const r = runHook(FAILING, '{"stop_hook_active": true}');
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, undefined);
  assert.match(r.json.systemMessage, /still failing/);
});
