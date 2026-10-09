// Checks copy/search text of embedded fonts with different OpenType features.
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fontkit, readFontFile } from '../src/fonts.js';
const text = 'ñandú José office fiel';
for (const [file, ps] of [['cambria.ttc', 'Cambria'], ['calibri.ttf', 'Calibri']]) {
  const f = readFontFile(new Uint8Array(fs.readFileSync('C:/Windows/Fonts/' + file)), ps);
  for (const features of [undefined, { ccmp: false }, { ccmp: false, liga: false }]) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(f.bytes, { subset: f.subset, features });
    doc.addPage([400, 100]).drawText(text, { x: 10, y: 50, size: 14, font });
    const pdf = await pdfjs.getDocument({ data: await doc.save(), verbosity: 0 }).promise;
    const got = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join('');
    console.log(`${ps.padEnd(8)} ${JSON.stringify(features ?? 'default').padEnd(28)} -> ${got} ${got === text ? 'OK' : 'MISMATCH'}`);
  }
}
