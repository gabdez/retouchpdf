// Lists the checkboxes and text lines detected on page 1 of a PDF.
// Usage: node test/checkbox-test.mjs <file.pdf>
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyzePage, groupLines, findCheckboxes } from '../src/textedit.js';

const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const page = await (await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise).getPage(1);
const { items } = await page.getTextContent();
const doc = await PDFDocument.load(bytes);
const { glyphs } = analyzePage(doc, doc.getPage(0).node);
const { boxes, used } = findCheckboxes(items, glyphs);
for (const b of boxes) console.log(`box  ${b.state.padEnd(5)} ${b.boxed ? 'boxed' : 'bare '} at ${b.origin.map((v) => v.toFixed(1))}`);
for (const L of groupLines(items, used)) console.log(`line ${L.text}`);
