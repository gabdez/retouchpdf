// Fonts from the user's computer: matching a PDF's font name to an installed
// font, and preparing font files so pdf-lib can embed them.

import fontkit from '@pdf-lib/fontkit';

export { fontkit };

// "ABCDEF+Calibri-Bold" -> "Calibri-Bold"
export const pdfFontName = (baseFont) => (baseFont || '').replace(/^[A-Z]{6}\+/, '');

// Comparable form of a font name: "Arial-BoldMT", "Arial,Bold" and "Arial Bold"
// all become "arialbold".
export function normalizeFontName(name) {
  return (name || '')
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[\s,_-]+/g, '')
    .replace(/(psmt|mt|ps)$/, '');
}

const STYLE_WORDS = /(regular|roman|book|normal|bold|semibold|demibold|black|heavy|light|medium|italic|oblique)+$/;

function styleOfName(name) {
  const n = name.toLowerCase();
  return {
    bold: /bold|black|heavy|demi/.test(n),
    italic: /italic|oblique/.test(n),
  };
}

// Pick the installed font that best matches a font used in a PDF.
// `local` is the list from window.queryLocalFonts() (or anything shaped like it).
export function findLocalMatch(local, { baseFont, flags = 0, weight = 0 }) {
  const name = pdfFontName(baseFont);
  const target = normalizeFontName(name);
  if (!target) return null;

  // 1. Same PostScript or full name.
  const exact = local.find((f) => normalizeFontName(f.postscriptName) === target || normalizeFontName(f.fullName) === target);
  if (exact) return exact;

  // 2. Same family, closest style.
  const family = normalizeFontName(name.split(/[-,]/)[0]).replace(STYLE_WORDS, '');
  if (!family) return null;
  const want = styleOfName(name);
  want.bold ||= (flags & 0x40000) !== 0 || weight >= 600;
  want.italic ||= (flags & 64) !== 0;
  const candidates = local.filter((f) => normalizeFontName(f.family) === family);
  let best = null;
  let bestScore = -1;
  for (const f of candidates) {
    const s = styleOfName(`${f.style} ${f.fullName}`);
    const score = (s.bold === want.bold ? 2 : 0) + (s.italic === want.italic ? 1 : 0);
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

// A .ttc file holds several fonts; pdf-lib needs a single one. Rebuild a
// standalone font file from the table directory of the requested font.
export function extractFromCollection(bytes, postscriptName) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x74746366) return bytes; // not 'ttcf'

  const collection = fontkit.create(bytes);
  let index = collection.fonts.findIndex((f) => f.postscriptName === postscriptName);
  if (index < 0) index = 0;

  const offset = dv.getUint32(12 + 4 * index);
  const numTables = dv.getUint16(offset + 4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + 16 * i;
    tables.push({
      tag: dv.getUint32(rec),
      checksum: dv.getUint32(rec + 4),
      offset: dv.getUint32(rec + 8),
      length: dv.getUint32(rec + 12),
    });
  }

  const headerSize = 12 + 16 * numTables;
  const pad = (n) => (n + 3) & ~3;
  const total = tables.reduce((sum, t) => sum + pad(t.length), headerSize);
  const out = new Uint8Array(total);
  const odv = new DataView(out.buffer);
  out.set(bytes.subarray(offset, offset + 12)); // sfnt version + search fields
  let pos = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + 16 * i;
    odv.setUint32(rec, t.tag);
    odv.setUint32(rec + 4, t.checksum);
    odv.setUint32(rec + 8, pos);
    odv.setUint32(rec + 12, t.length);
    out.set(bytes.subarray(t.offset, t.offset + t.length), pos);
    pos += pad(t.length);
  });
  return out;
}

// Parse a font file (TTF / OTF / TTC) into what the editor needs.
export function readFontFile(bytes, postscriptName) {
  const single = extractFromCollection(bytes, postscriptName);
  const font = fontkit.create(single);
  return {
    bytes: single,
    postscriptName: font.postscriptName,
    name: font.fullName || font.postscriptName || 'Font',
    family: font.familyName,
    // pdf-lib's subsetting is reliable for TrueType outlines; CFF-based
    // OpenType fonts are embedded whole.
    subset: !font['CFF '] && !font.CFF2,
  };
}
