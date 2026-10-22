## Testing rules
- Write tests for every new feature.
- Run all tests before finishing any change. Don't push if any fail.
- Never change or delete a test to make it pass without asking me. The one exception is a test that fails only because the change itself makes it obsolete (see the next rule): update those, and tell me what you changed.
- Whenever submitting new code, review all existing tests and modify or delete tests that would automatically fail because of what's being changed.

## Publishing rules
- Always work on a separate branch, so every change gets a Preview.
- Never merge into main unless I say "push to production."
- Unless I say "push to production," make all changes to the preview site first (the copy of the page in the preview/ folder), and leave the public page (index.html and data.json in the root) alone.
