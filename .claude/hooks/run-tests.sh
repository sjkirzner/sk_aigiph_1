#!/usr/bin/env bash
# Claude Code "Stop" hook: runs the test suite after every reply.
#
#   - Tests pass  -> shows you a one-line summary. Nothing else happens.
#   - Tests fail  -> tells Claude (once) so it can fix the problem before finishing.
#                    If it already tried and they still fail, it just shows you the
#                    result, so the session can never get stuck in a loop.
#
# CLAUDE_HOOK_TEST_CMD lets the tests of this hook swap in a fake test command.

input=$(cat)                       # Claude Code sends JSON on stdin
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
[ -f package.json ] || exit 0      # not a project with tests: do nothing

output=$(bash -c "${CLAUDE_HOOK_TEST_CMD:-npm test}" 2>&1)
status=$?
summary=$(printf '%s\n' "$output" | grep -E '^ℹ (tests|pass|fail) ' | tr '\n' ' ')

if [ "$status" -eq 0 ]; then
  jq -n --arg m "✔ Tests passed. $summary" '{systemMessage: $m}'
  exit 0
fi

failed=$(printf '%s\n' "$output" | grep -E '^\s*✖' | sort -u | head -15)
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)

if [ "$active" = "true" ]; then
  # Claude already got one chance to fix this. Report, but don't block again.
  jq -n --arg m "✖ Tests are still failing. $summary" '{systemMessage: $m}'
  exit 0
fi

reason="The test suite failed after your last reply. $summary
Failing tests:
$failed

Fix the cause. If a test itself looks wrong, ask the user before changing or deleting it (project rule in CLAUDE.md). Do not push while tests fail."
jq -n --arg r "$reason" --arg m "✖ Tests failed. $summary" '{decision: "block", reason: $r, systemMessage: $m}'
exit 0
