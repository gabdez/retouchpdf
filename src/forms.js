// Fillable forms (AcroForm) in the saved PDF.
//
// The editor saves by copying pages into a new document. Copied pages keep
// their field widgets, but the new document has no form dictionary listing
// those fields, so viewers would treat them as dead drawings. rebuildForm()
// relists them; fillForm() then writes the values typed in the editor.

import {
  PDFName,
  PDFDict,
  PDFRef,
  PDFBool,
  PDFObjectCopier,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from 'pdf-lib';

const isWidget = (dict) => dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))?.toString() === '/Widget';

// Make the fields whose widgets sit on `out`'s pages a working form again.
// `sources` = the documents the pages came from (their form defaults are reused).
export function rebuildForm(out, sources) {
  const ctx = out.context;
  const fields = new Map(); // ref tag -> ref of each top-level field
  for (const page of out.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof PDFRef) || !isWidget(ctx.lookup(ref))) continue;
      let top = ref;
      let node = ctx.lookup(ref);
      for (let depth = 0; depth < 32; depth++) {
        const parent = node.get(PDFName.of('Parent'));
        if (!(parent instanceof PDFRef)) break;
        top = parent;
        node = ctx.lookup(parent);
      }
      fields.set(top.toString(), top);
    }
  }
  if (!fields.size) return false;

  const acro = out.catalog.getOrCreateAcroForm();
  acro.dict.set(PDFName.of('Fields'), ctx.obj([...fields.values()]));
  for (const src of sources) {
    const srcAcro = src.catalog.getAcroForm();
    if (!srcAcro) continue;
    const copier = PDFObjectCopier.for(src.context, ctx);
    for (const key of ['DR', 'DA', 'Q']) {
      const value = srcAcro.dict.get(PDFName.of(key));
      if (value && !acro.dict.get(PDFName.of(key))) acro.dict.set(PDFName.of(key), copier.copy(value));
    }
  }
  return true;
}

// Write `values` (field name -> value) into the form of `out` and redraw the
// fields. `font` draws text fields; when it can't (characters outside its
// range), viewers are asked to redraw them instead. Returns names that failed.
export function fillForm(out, values, font) {
  const form = out.getForm();
  const failed = [];
  let needAppearances = false;
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!values.has(name)) continue;
    const v = values.get(name);
    try {
      if (field instanceof PDFTextField) {
        const max = field.getMaxLength();
        field.setText(max ? String(v ?? '').slice(0, max) : String(v ?? ''));
        // A multi-line field set to "auto" (0) or to an outsized font would be
        // drawn as one huge word: use the size the editor shows instead.
        const size = Number(/([\d.]+)\s+Tf/.exec(field.acroField.getDefaultAppearance() ?? '')?.[1] ?? 0);
        if (field.isMultiline() && (size === 0 || size > 24)) field.setFontSize(11);
      } else if (field instanceof PDFCheckBox) {
        if (v) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (v) field.select(v);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (v) field.select(v);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
        if (list.length) field.select(list);
        else field.clear();
      } else continue;
    } catch (err) {
      console.warn(`Field "${name}"`, err);
      failed.push(name);
      continue;
    }
    try {
      field.defaultUpdateAppearances(font);
    } catch {
      form.markFieldAsClean(field.ref);
      needAppearances = true;
    }
  }
  if (needAppearances) form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  return failed;
}
