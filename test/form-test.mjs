// Saves test/fixtures/form.pdf the way the editor does (pages copied into a new
// document, form rebuilt and filled), then reads the result back.
// Usage: node test/form-test.mjs
import fs from 'fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rebuildForm, fillForm } from '../src/forms.js';

const bytes = new Uint8Array(fs.readFileSync('test/fixtures/form.pdf'));
const src = await PDFDocument.load(bytes);

async function save(indices, values) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, [...new Set(indices)]);
  indices.forEach((i) => out.addPage(pages[[...new Set(indices)].indexOf(i)]));
  rebuildForm(out, [src]);
  const failed = fillForm(out, values, await out.embedFont(StandardFonts.Helvetica));
  return { bytes: await out.save({ updateFieldAppearances: false }), failed };
}

const values = new Map(Object.entries({
  nombre: 'José Martínez',
  cp: '280011234', // longer than the 5-character limit
  comentarios: 'Primera línea\nSegunda línea',
  acepto: true,
  modalidad: 'online',
  pais: 'Francia',
  idiomas: ['Español', 'Inglés'],
  email: 'Ωmega@example.com', // Ω is not in Helvetica's range
}));

for (const [label, indices] of [['both pages', [0, 1]], ['page 1 only', [0]]]) {
  const { bytes: out, failed } = await save(indices, values);
  const d = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 }).promise;
  const summary = {};
  for (let n = 1; n <= d.numPages; n++) for (const a of await (await d.getPage(n)).getAnnotations()) if (a.fieldName) summary[a.fieldName + (a.buttonValue ? '(' + a.buttonValue + ')' : '')] = a.fieldValue;
  const text = (await (await d.getPage(1)).getTextContent()).items.length;
  console.log(`\n${label}: ${d.numPages} page(s), ${(out.length / 1024).toFixed(1)} KB (original ${(bytes.length / 1024).toFixed(1)} KB), failed: ${failed.join(', ') || 'none'}`);
  console.log(summary);
  const check = await PDFDocument.load(out);
  console.log('pdf-lib sees', check.getForm().getFields().length, 'fields; NeedAppearances =', String(check.catalog.getAcroForm()?.dict.get(check.context.obj('NeedAppearances'))));
}
