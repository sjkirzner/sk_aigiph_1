# sk_aigiph_1
Experiment for my AI Governance in Public Health Class


I want to start making a very basic, vibe-coded tool building on what I discussed. I'm doing this as a practice.


## Running the tests

The website itself has no build step. The tests are a separate, optional extra.

```
npm install                      # once: installs Playwright (the headless browser tool)
npx playwright install chromium  # once: downloads the browser the tests use
npm test                         # runs every test
```

`npm test` runs three files in `tests/`:

- `data.test.js` checks `data.json` (every cell present, sources exist, evidence labels valid, row and column order).
- `html.test.js` checks `index.html`'s source (relative paths, no frameworks, colour contrast, no green in the evidence scale).
- `browser.test.js` opens the real page in a headless browser, served from a `/repo-name/` subfolder like GitHub Pages, and checks what a visitor sees and can do (grid, expanding cells, keyboard, phone layout, dark mode, error handling).

To see the site yourself, run `python3 -m http.server 8000` in this folder and open http://localhost:8000.
