// Rebuilds the preview copy of the page from the real one. Run from the repo root:
//   npm run sync-preview
//
// preview/index.html  = an exact copy of index.html
// preview/data.json   = an exact copy of data.json, except meta.title gets the prefix "PREVIEW - "
//
// Run this again after ANY change to index.html or data.json. The tests fail if the copy is out of date.
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'PREVIEW - ';
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const data = read('data.json');
const title = JSON.parse(data).meta.title;
if (title.startsWith(PREFIX)) throw new Error('data.json meta.title already starts with "' + PREFIX + '". The real page must not carry the prefix.');

// Change the title with a plain text replacement so every other byte of data.json stays exactly as it is.
const realLine = '"title": ' + JSON.stringify(title);
if (data.split(realLine).length !== 2) throw new Error('Expected exactly one ' + realLine + ' in data.json.');
const previewData = data.replace(realLine, '"title": ' + JSON.stringify(PREFIX + title));

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(path.join(root, 'preview', 'index.html'), html);
fs.writeFileSync(path.join(root, 'preview', 'data.json'), previewData);
console.log('Wrote preview/index.html and preview/data.json (title: "' + PREFIX + title + '")');
