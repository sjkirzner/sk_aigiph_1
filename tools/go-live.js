// Publishes the preview page as the public page. Run from the repo root:
//   npm run go-live
//
// Copies preview/index.html over index.html, and preview/data.json over data.json with the
// "PREVIEW - " prefix removed from meta.title. It ONLY copies those two files.
// It does not commit, push, or merge anything.
//
// If the preview is not in the expected shape, it stops BEFORE changing anything.
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'PREVIEW - ';
const root = path.resolve(__dirname, '..');
const file = (...parts) => path.join(root, ...parts);
const read = (...parts) => fs.readFileSync(file(...parts), 'utf8');
const stop = (msg) => { console.error('STOP, nothing was changed: ' + msg); process.exit(1); };

// ---- Check the preview before touching anything ----------------------------
let previewHtml, previewText, previewData;
try {
  previewHtml = read('preview', 'index.html');
  previewText = read('preview', 'data.json');
} catch (e) {
  stop('could not read the preview files (' + e.message + ').');
}
try {
  previewData = JSON.parse(previewText);
} catch (e) {
  stop('preview/data.json is not valid JSON (' + e.message + ').');
}
const previewTitle = previewData.meta && previewData.meta.title;
if (typeof previewTitle !== 'string' || !previewTitle.startsWith(PREFIX)) {
  stop('preview/data.json meta.title must start with "' + PREFIX + '" (found ' + JSON.stringify(previewTitle) + ').');
}
const liveTitle = previewTitle.slice(PREFIX.length);
if (!liveTitle.trim()) stop('the title would be empty once "' + PREFIX + '" is removed.');

// Change only the title, as plain text, so every other byte of data.json is exactly the preview's.
const previewLine = '"title": ' + JSON.stringify(previewTitle);
if (previewText.split(previewLine).length !== 2) stop('expected exactly one ' + previewLine + ' in preview/data.json.');
const liveText = previewText.replace(previewLine, () => '"title": ' + JSON.stringify(liveTitle));
try { JSON.parse(liveText); } catch (e) { stop('the public data.json would not be valid JSON (' + e.message + ').'); }

// ---- Copy ------------------------------------------------------------------
const changed = [];
const publish = (name, text) => {
  const target = file(name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current !== text) { fs.writeFileSync(target, text); changed.push(name); }
};
publish('index.html', previewHtml);
publish('data.json', liveText);

if (changed.length === 0) {
  console.log('Already live: the public page already matches the preview. Nothing copied.');
} else {
  console.log('Published the preview as the public page. Updated: ' + changed.join(', ') + '.');
  console.log('Public title is now: "' + liveTitle + '"');
  console.log('Next: run the tests, then commit. Nothing has been committed or merged.');
}
