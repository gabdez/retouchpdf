// Embeds Windows fonts into a PDF the same way the editor does, then reads the
// result back with pdf.js to check text and font names survive.
// Usage: node test/font-test.mjs
import fs from 'fs';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontkit, readFontFile, findLocalMatch } from '../src/fonts.js';

const FONTS = 'C:/Windows/Fonts/';
const files = { 'calibri.ttf': 'Calibri', 'calibrib.ttf': 'Calibri-Bold', 'cambria.ttc': 'Cambria', 'times.ttf': 'TimesNewRomanPSMT', 'arialbd.ttf': 'Arial-BoldMT' };

// A fake installed-font list, shaped like window.queryLocalFonts() results.
const local = [];
for (const [file, ps] of Object.entries(files)) {
  const f = readFontFile(new Uint8Array(fs.readFileSync(FONTS + file)), ps);
  local.push({ postscriptName: f.postscriptName, fullName: f.name, family: f.family, style: f.name.replace(f.family, '').trim() || 'Regular', file, font: f });
}
console.log('Matching PDF font names to installed fonts:');
for (const [baseFont, flags] of [['BCDEEE+Calibri', 0], ['BCDFEE+Calibri-Bold', 0], ['Calibri,Bold', 0], ['ABCDEF+Cambria', 0], ['TimesNewRomanPSMT', 0], ['Arial-BoldMT', 0], ['Arial', 0x40000], ['Garamond', 0]]) {
  const m = findLocalMatch(local, { baseFont, flags });
  console.log(`  ${baseFont.padEnd(22)} -> ${m ? `${m.fullName} (${m.file})` : 'no match'}`);
}

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const page = doc.addPage([500, 300]);
let y = 260;
for (const l of local) {
  const font = await doc.embedFont(l.font.bytes, { subset: l.font.subset });
  page.drawText(`${l.font.name}: Factura Nº 2024 — José, ñandú, €1.250 ✓`, { x: 20, y, size: 14, font, color: rgb(0, 0, 0) });
  y -= 30;
}
const bytes = await doc.save();
console.log(`\nPDF with embedded subsets: ${(bytes.length / 1024).toFixed(0)} KB`);

const pdf = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
const p = await pdf.getPage(1);
const tc = await p.getTextContent();
await p.getOperatorList();
for (const it of tc.items.filter((i) => i.str.trim())) {
  const f = p.commonObjs.has(it.fontName) ? p.commonObjs.get(it.fontName) : null;
  console.log(`  read back: ${it.str}   [${f?.name}]`);
}
