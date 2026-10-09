// Checks the existing-text engine against a PDF without the browser.
// Usage: node test/engine-test.mjs <file.pdf> "<text of the line to remove>"
// Prints every detected line with its matched style, removes the chosen line,
// writes <file>-removed.pdf and reports any other line that moved or changed.
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyzePage, removeGlyphs, groupLines, glyphInLine, styleOf, matchStandardFont } from '../src/textedit.js';

const file = process.argv[2];
const target = process.argv[3];
const bytes = new Uint8Array(fs.readFileSync(file));

async function lines(b) {
  const d = await pdfjs.getDocument({ data: b.slice(), verbosity: 0 }).promise;
  const p = await d.getPage(1);
  return groupLines((await p.getTextContent()).items);
}
const before = await lines(bytes);
const src = await PDFDocument.load(bytes);
const an = analyzePage(src, src.getPage(0).node);
console.log('glyphs:', an.glyphs.length, 'streams:', an.streams.length, 'fonts:', [...new Set(an.glyphs.map(g => g.font.baseFont + (g.font.composite ? '(CID)' : '')))].join(', '));
for (const L of before) {
  const s = styleOf(an.glyphs, [L]);
  const count = an.glyphs.filter(g => glyphInLine(g, L)).length;
  console.log(`${count.toString().padStart(3)} glyphs | ${s.size.toFixed(1)}pt ${matchStandardFont(s).padEnd(16)} ${s.color} | ${L.text.length} chars | ${L.text}`);
}
const L = before.find(l => l.text.includes(target));
const doc = await PDFDocument.create();
const [copy] = await doc.copyPages(src, [0]); doc.addPage(copy);
const an2 = analyzePage(doc, copy.node);
removeGlyphs(doc, copy.node, an2, an2.glyphs.filter(g => glyphInLine(g, L)));
const out = await doc.save();
fs.writeFileSync(file.replace('.pdf', '-removed.pdf'), out);
const after = await lines(out);
console.log('\nAFTER removing:', L.text);
const key = l => l.text + '@' + l.origin.map(v => v.toFixed(2)).join(',');
const afterKeys = new Set(after.map(key));
for (const l of before) if (!afterKeys.has(key(l))) console.log('  changed/removed:', JSON.stringify(l.text));
for (const l of after) if (!before.map(key).includes(key(l))) console.log('  new:', JSON.stringify(l.text), l.origin.map(v=>v.toFixed(2)));
