// Builds test/fixtures/form.pdf: a two-page form with every common field type,
// including one field ("nombre") whose widgets sit on both pages.
// Usage: node test/make-form.mjs
import fs from 'fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const form = doc.getForm();
const p1 = doc.addPage([595, 842]);
const p2 = doc.addPage([595, 842]);
const label = (page, text, x, y) => page.drawText(text, { x, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });

p1.drawText('Solicitud de inscripción', { x: 50, y: 780, size: 20, font });

label(p1, 'Nombre completo', 50, 730);
const name = form.createTextField('nombre');
name.addToPage(p1, { x: 180, y: 722, width: 300, height: 22 });

label(p1, 'Email', 50, 690);
const email = form.createTextField('email');
email.setText('ejemplo@correo.es');
email.addToPage(p1, { x: 180, y: 682, width: 300, height: 22 });

label(p1, 'Código postal', 50, 650);
const cp = form.createTextField('cp');
cp.setMaxLength(5);
cp.addToPage(p1, { x: 180, y: 642, width: 80, height: 22 });

label(p1, 'Comentarios', 50, 610);
const notes = form.createTextField('comentarios');
notes.enableMultiline();
notes.addToPage(p1, { x: 180, y: 540, width: 300, height: 80 });

label(p1, 'Acepto las condiciones', 50, 500);
const terms = form.createCheckBox('acepto');
terms.addToPage(p1, { x: 180, y: 496, width: 16, height: 16 });

label(p1, 'Newsletter', 50, 470);
const news = form.createCheckBox('newsletter');
news.check();
news.addToPage(p1, { x: 180, y: 466, width: 16, height: 16 });

label(p1, 'Modalidad', 50, 430);
const mode = form.createRadioGroup('modalidad');
label(p1, 'Presencial', 205, 430);
mode.addOptionToPage('presencial', p1, { x: 180, y: 426, width: 16, height: 16 });
label(p1, 'Online', 305, 430);
mode.addOptionToPage('online', p1, { x: 280, y: 426, width: 16, height: 16 });

label(p1, 'País', 50, 390);
const country = form.createDropdown('pais');
country.addOptions(['España', 'Francia', 'Portugal', 'Italia']);
country.addToPage(p1, { x: 180, y: 382, width: 150, height: 22 });

label(p1, 'Idiomas', 50, 350);
const langs = form.createOptionList('idiomas');
langs.addOptions(['Español', 'Francés', 'Inglés', 'Alemán']);
langs.enableMultiselect();
langs.addToPage(p1, { x: 180, y: 290, width: 150, height: 70 });

label(p1, 'Referencia (solo lectura)', 50, 250);
const ref = form.createTextField('referencia');
ref.setText('REF-2026-0042');
ref.enableReadOnly();
ref.addToPage(p1, { x: 220, y: 242, width: 150, height: 22 });

p2.drawText('Página 2: confirmación', { x: 50, y: 780, size: 20, font });
label(p2, 'Nombre (repetido)', 50, 730);
name.addToPage(p2, { x: 180, y: 722, width: 300, height: 22 });

fs.writeFileSync('test/fixtures/form.pdf', await doc.save());
console.log('wrote test/fixtures/form.pdf');
