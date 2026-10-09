// Editing of text that already exists in a PDF.
//
// pdf.js tells us *what* the text says (it resolves ToUnicode maps, encodings,
// etc.). To actually change it, we interpret the page's content stream
// ourselves: track the text/graphics state, compute the position of every glyph
// shown, and then rewrite the show operators so the chosen glyphs disappear
// while every other glyph stays exactly where it was (each removed glyph is
// replaced by a TJ positioning adjustment of the same width).

import {
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { Font as StdFont, Encodings } from '@pdf-lib/standard-fonts';

// ---------------------------------------------------------------------------
// Content stream tokenizer
// ---------------------------------------------------------------------------

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const isRegular = (c) => c !== undefined && !WS.has(c) && !DELIM.has(c);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// Returns [{ op, args, start, end }] with byte offsets into `data`, so that
// individual operations can be replaced while leaving everything else intact.
export function parseContent(data) {
  const ops = [];
  const n = data.length;
  let i = 0;
  let args = [];
  let opStart = -1;
  const stack = [];

  const begin = (start) => {
    if (!stack.length && !args.length && opStart < 0) opStart = start;
  };
  const push = (v, start) => {
    if (stack.length) stack[stack.length - 1].push(v);
    else {
      begin(start);
      args.push(v);
    }
  };

  while (i < n) {
    const c = data[i];
    if (WS.has(c)) { i++; continue; }
    const start = i;

    if (c === 37) { // % comment
      while (i < n && data[i] !== 10 && data[i] !== 13) i++;
      continue;
    }
    if (c === 40) {
      const [bytes, j] = readLiteral(data, i);
      i = j;
      push({ t: 's', b: bytes }, start);
      continue;
    }
    if (c === 60) {
      if (data[i + 1] === 60) {
        begin(start);
        i += 2;
        stack.push([]);
        continue;
      }
      const [bytes, j] = readHex(data, i);
      i = j;
      push({ t: 's', b: bytes }, start);
      continue;
    }
    if (c === 62 && data[i + 1] === 62) {
      i += 2;
      push({ t: 'd', v: stack.pop() || [] }, start);
      continue;
    }
    if (c === 91) {
      begin(start);
      i++;
      stack.push([]);
      continue;
    }
    if (c === 93) {
      i++;
      push(stack.pop() || [], start);
      continue;
    }
    if (c === 47) {
      i++;
      let s = '';
      while (isRegular(data[i])) s += String.fromCharCode(data[i++]);
      push({ t: 'n', v: s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, start);
      continue;
    }
    if (!isRegular(c)) { i++; continue; } // stray delimiter

    let s = '';
    while (isRegular(data[i])) s += String.fromCharCode(data[i++]);
    if (NUMBER.test(s)) { push(Number(s), start); continue; }
    if (s === 'true' || s === 'false') { push(s === 'true', start); continue; }
    if (s === 'null') { push(null, start); continue; }
    if (stack.length) { stack[stack.length - 1].push({ t: 'k', v: s }); continue; }

    const op = { op: s, args, start: opStart >= 0 ? opStart : start, end: i };
    if (s === 'BI') op.end = i = skipInlineImage(data, i);
    ops.push(op);
    args = [];
    opStart = -1;
    stack.length = 0;
  }
  return ops;
}

function readLiteral(d, i) {
  i++;
  let depth = 1;
  const out = [];
  while (i < d.length) {
    let c = d[i++];
    if (c === 92) {
      c = d[i++];
      switch (c) {
        case 110: out.push(10); break;
        case 114: out.push(13); break;
        case 116: out.push(9); break;
        case 98: out.push(8); break;
        case 102: out.push(12); break;
        case 13: if (d[i] === 10) i++; break;
        case 10: break;
        default:
          if (c >= 48 && c <= 55) {
            let v = c - 48;
            for (let k = 0; k < 2 && d[i] >= 48 && d[i] <= 55; k++) v = v * 8 + (d[i++] - 48);
            out.push(v & 255);
          } else out.push(c);
      }
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) break;
    out.push(c);
  }
  return [Uint8Array.from(out), i];
}

function readHex(d, i) {
  i++;
  let s = '';
  while (i < d.length && d[i] !== 62) {
    const c = d[i++];
    if (!WS.has(c)) s += String.fromCharCode(c);
  }
  i++;
  if (s.length % 2) s += '0';
  const out = new Uint8Array(s.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(s.substr(2 * k, 2), 16);
  return [out, i];
}

// BI <dict> ID <binary data> EI
function skipInlineImage(d, i) {
  const n = d.length;
  let k = i;
  while (k < n - 1) {
    if (d[k] === 73 && d[k + 1] === 68 && !isRegular(d[k - 1]) && (k + 2 >= n || WS.has(d[k + 2]))) break;
    k++;
  }
  let m = k + 3;
  while (m < n - 1) {
    if (d[m] === 69 && d[m + 1] === 73 && WS.has(d[m - 1]) && (m + 2 >= n || !isRegular(d[m + 2]))) return m + 2;
    m++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Fonts: just enough to know glyph codes and widths
// ---------------------------------------------------------------------------

const lookup = (ctx, o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
const get = (ctx, dict, key) => (dict instanceof PDFDict ? lookup(ctx, dict.get(PDFName.of(key))) : undefined);
const num = (o) => (o instanceof PDFNumber ? o.asNumber() : undefined);
const nameOf = (o) => (o instanceof PDFName ? o.decodeText() : undefined);

function inherited(ctx, node, key) {
  let n = node;
  for (let depth = 0; n instanceof PDFDict && depth < 64; depth++) {
    const v = n.get(PDFName.of(key));
    if (v) return lookup(ctx, v);
    n = lookup(ctx, n.get(PDFName.of('Parent')));
  }
  return undefined;
}

const STD_ALIASES = [
  [/^(arial|helvetica)/i, 'Helvetica'],
  [/^(times|timesnewroman)/i, 'Times'],
  [/^(courier)/i, 'Courier'],
  [/^symbol/i, 'Symbol'],
  [/^zapfdingbats/i, 'ZapfDingbats'],
];

// Widths for the standard 14 fonts, which PDFs may use without a /Widths array.
function stdWidthFn(baseFont) {
  const raw = baseFont.replace(/^[A-Z]{6}\+/, '');
  const alias = STD_ALIASES.find(([re]) => re.test(raw));
  if (!alias) return null;
  const family = alias[1];
  const bold = /bold/i.test(raw);
  const italic = /italic|oblique/i.test(raw);
  let name = family;
  if (family === 'Times') name = bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  else if (family === 'Helvetica' || family === 'Courier') name = `${family}${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`;
  let font;
  try {
    font = StdFont.load(name);
  } catch {
    return null;
  }
  const enc = family === 'Symbol' ? Encodings.Symbol : family === 'ZapfDingbats' ? Encodings.ZapfDingbats : Encodings.WinAnsi;
  const codeToName = new Map();
  for (const cp of enc.supportedCodePoints) {
    const { code, name: glyph } = enc.encodeUnicodeCodePoint(cp);
    if (!codeToName.has(code)) codeToName.set(code, glyph);
  }
  return (code) => font.getWidthOfGlyph(codeToName.get(code)) ?? 500;
}

function parseCodespace(bytes) {
  const text = new TextDecoder('latin1').decode(bytes);
  const ranges = [];
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      ranges.push({ len: m[1].length / 2, lo: parseInt(m[1], 16), hi: parseInt(m[2], 16) });
    }
  }
  return ranges.length ? ranges : null;
}

function fontInfo(ctx, fontDict, cache) {
  if (cache.has(fontDict)) return cache.get(fontDict);
  const subtype = nameOf(get(ctx, fontDict, 'Subtype'));
  const baseFont = nameOf(get(ctx, fontDict, 'BaseFont')) || '';
  let info;

  if (subtype === 'Type0') {
    const descendants = get(ctx, fontDict, 'DescendantFonts');
    const desc = descendants instanceof PDFArray ? lookup(ctx, descendants.get(0)) : undefined;
    const dw = num(get(ctx, desc, 'DW')) ?? 1000;
    const widths = new Map();
    const W = get(ctx, desc, 'W');
    if (W instanceof PDFArray) {
      const arr = W.asArray().map((x) => lookup(ctx, x));
      for (let k = 0; k < arr.length; ) {
        const first = num(arr[k]);
        if (arr[k + 1] instanceof PDFArray) {
          arr[k + 1].asArray().forEach((w, j) => widths.set(first + j, num(lookup(ctx, w)) ?? dw));
          k += 2;
        } else {
          const last = num(arr[k + 1]);
          const w = num(arr[k + 2]);
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, w);
          k += 3;
        }
      }
    }
    const enc = get(ctx, fontDict, 'Encoding');
    let codespace = null;
    if (enc instanceof PDFRawStream) {
      try {
        codespace = parseCodespace(decodePDFRawStream(enc).decode());
      } catch {
        /* fall back to 2-byte codes */
      }
    }
    const fd = get(ctx, desc, 'FontDescriptor');
    info = {
      composite: true,
      codespace,
      width: (c) => widths.get(c) ?? dw,
      baseFont,
      flags: num(get(ctx, fd, 'Flags')) || 0,
      weight: num(get(ctx, fd, 'FontWeight')) || 0,
    };
  } else {
    const first = num(get(ctx, fontDict, 'FirstChar')) ?? 0;
    const W = get(ctx, fontDict, 'Widths');
    const widths = W instanceof PDFArray ? W.asArray().map((x) => num(lookup(ctx, x)) ?? 0) : null;
    const fd = get(ctx, fontDict, 'FontDescriptor');
    const missing = num(get(ctx, fd, 'MissingWidth')) ?? 0;
    let scale = 1;
    if (subtype === 'Type3') {
      const fm = get(ctx, fontDict, 'FontMatrix');
      scale = fm instanceof PDFArray ? (num(lookup(ctx, fm.get(0))) ?? 0.001) * 1000 : 1;
    }
    const std = widths ? null : stdWidthFn(baseFont);
    info = {
      composite: false,
      width: (c) => (widths ? (widths[c - first] ?? missing) * scale : std ? std(c) : 500),
      baseFont,
      flags: num(get(ctx, fd, 'Flags')) || 0,
      weight: num(get(ctx, fd, 'FontWeight')) || 0,
    };
  }
  cache.set(fontDict, info);
  return info;
}

function splitCodes(font, bytes) {
  const out = [];
  if (!font.composite) {
    for (let i = 0; i < bytes.length; i++) out.push({ code: bytes[i], start: i, len: 1 });
    return out;
  }
  for (let i = 0; i < bytes.length; ) {
    let len = 2;
    if (font.codespace) {
      len = 0;
      let v = 0;
      for (let l = 1; l <= 4 && i + l <= bytes.length; l++) {
        v = (v << 8) | bytes[i + l - 1];
        if (font.codespace.some((r) => r.len === l && v >= r.lo && v <= r.hi)) {
          len = l;
          break;
        }
      }
      if (!len) len = Math.min(2, bytes.length - i);
    }
    len = Math.min(len, bytes.length - i);
    let code = 0;
    for (let k = 0; k < len; k++) code = (code << 8) | bytes[i + k];
    out.push({ code, start: i, len });
    i += len;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

// Matrix product: apply m1, then m2.
const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const IDENTITY = [1, 0, 0, 1, 0, 0];

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
function toHex(components) {
  const c = components.map((x) => (typeof x === 'number' ? x : 0));
  if (c.length === 1) return `#${hex2(c[0])}${hex2(c[0])}${hex2(c[0])}`;
  if (c.length === 3) return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
  if (c.length === 4) {
    const [C, M, Y, K] = c;
    return `#${hex2((1 - C) * (1 - K))}${hex2((1 - M) * (1 - K))}${hex2((1 - Y) * (1 - K))}`;
  }
  return '#000000';
}

function readStream(ctx, obj) {
  const s = lookup(ctx, obj);
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s && typeof s.getUnencodedContents === 'function') return s.getUnencodedContents();
  return new Uint8Array();
}

function pageContentBytes(ctx, pageNode) {
  const contents = lookup(ctx, pageNode.get(PDFName.of('Contents')));
  if (!contents) return new Uint8Array();
  if (!(contents instanceof PDFArray)) return readStream(ctx, contents);
  const parts = contents.asArray().map((r) => readStream(ctx, r));
  const total = parts.reduce((s, p) => s + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}

// Interpret a page and return every glyph it shows, in PDF user space.
export function analyzePage(doc, pageNode) {
  const ctx = doc.context;
  const fontCache = new Map();
  const streams = [];
  const glyphs = [];
  const formRecords = new Map();

  const pageRec = { kind: 'page', bytes: pageContentBytes(ctx, pageNode) };
  pageRec.ops = parseContent(pageRec.bytes);
  streams.push(pageRec);

  const run = (rec, resources, ctm, depth) => {
    let gs = {
      ctm, color: '#000000', special: false, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0, Tr: 0, font: null, fs: 0,
    };
    const saved = [];
    let tm = IDENTITY;
    let tlm = IDENTITY;
    const fonts = get(ctx, resources, 'Font');
    const xobjects = get(ctx, resources, 'XObject');
    const colorSpaces = get(ctx, resources, 'ColorSpace');

    const nextLine = (tx, ty) => {
      tlm = mul([1, 0, 0, 1, tx, ty], tlm);
      tm = tlm;
    };

    const show = (str, opIndex, el) => {
      const f = gs.font;
      if (!f || !str || str.t !== 's') return;
      const { fs, Th, Tc, Ts } = gs;
      for (const { code, start, len } of splitCodes(f, str.b)) {
        const w = f.width(code) || 0;
        const tw = len === 1 && code === 32 ? gs.Tw : 0;
        const trm = mul(mul([fs * Th, 0, 0, fs, 0, Ts], tm), gs.ctm);
        tm = mul([1, 0, 0, 1, ((w / 1000) * fs + Tc + tw) * Th, 0], tm);
        const trm2 = mul(mul([fs * Th, 0, 0, fs, 0, Ts], tm), gs.ctm);
        const dl = Math.hypot(trm[0], trm[1]) || 1;
        glyphs.push({
          rec, op: opIndex, el, start, len, code,
          origin: [trm[4], trm[5]],
          end: [trm2[4], trm2[5]],
          dir: [trm[0] / dl, trm[1] / dl],
          size: Math.hypot(trm[2], trm[3]),
          font: f,
          color: gs.special ? '#000000' : gs.color,
          tr: gs.Tr,
          adj: fs ? (-((w / 1000) * fs + Tc + tw) * 1000) / fs : 0,
        });
      }
    };

    rec.ops.forEach((o, idx) => {
      const a = o.args;
      switch (o.op) {
        case 'q': saved.push({ ...gs }); break;
        case 'Q': if (saved.length) gs = saved.pop(); break;
        case 'cm': if (a.length === 6) gs.ctm = mul(a, gs.ctm); break;
        case 'BT': tm = tlm = IDENTITY; break;
        case 'Tc': gs.Tc = a[0] || 0; break;
        case 'Tw': gs.Tw = a[0] || 0; break;
        case 'Tz': gs.Th = (a[0] ?? 100) / 100; break;
        case 'TL': gs.TL = a[0] || 0; break;
        case 'Ts': gs.Ts = a[0] || 0; break;
        case 'Tr': gs.Tr = a[0] || 0; break;
        case 'Tf': {
          const fd = a[0]?.t === 'n' ? get(ctx, fonts, a[0].v) : undefined;
          gs.font = fd instanceof PDFDict ? fontInfo(ctx, fd, fontCache) : null;
          gs.fs = a[1] || 0;
          break;
        }
        case 'Td': nextLine(a[0] || 0, a[1] || 0); break;
        case 'TD': gs.TL = -(a[1] || 0); nextLine(a[0] || 0, a[1] || 0); break;
        case 'Tm': if (a.length === 6) tm = tlm = a.slice(); break;
        case 'T*': nextLine(0, -gs.TL); break;
        case 'Tj': show(a[0], idx, 0); break;
        case "'": nextLine(0, -gs.TL); show(a[0], idx, 0); break;
        case '"':
          gs.Tw = a[0] || 0;
          gs.Tc = a[1] || 0;
          nextLine(0, -gs.TL);
          show(a[2], idx, 0);
          break;
        case 'TJ':
          (Array.isArray(a[0]) ? a[0] : []).forEach((e, el) => {
            if (typeof e === 'number') tm = mul([1, 0, 0, 1, (-e / 1000) * gs.fs * gs.Th, 0], tm);
            else show(e, idx, el);
          });
          break;
        case 'g': gs.color = toHex(a); gs.special = false; break;
        case 'rg': gs.color = toHex(a); gs.special = false; break;
        case 'k': gs.color = toHex(a); gs.special = false; break;
        case 'cs': {
          const name = a[0]?.v;
          let special = !['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'G', 'RGB', 'CMYK'].includes(name);
          if (special) {
            const cs = get(ctx, colorSpaces, name);
            const family = cs instanceof PDFArray ? nameOf(lookup(ctx, cs.get(0))) : nameOf(cs);
            special = !['ICCBased', 'CalRGB', 'CalGray', 'DeviceGray', 'DeviceRGB', 'DeviceCMYK'].includes(family);
          }
          gs.special = special;
          gs.color = '#000000';
          break;
        }
        case 'sc':
        case 'scn': {
          const nums = a.filter((x) => typeof x === 'number');
          if (!gs.special && nums.length) gs.color = toHex(nums);
          break;
        }
        case 'Do': {
          if (depth > 8 || a[0]?.t !== 'n') break;
          const ref = xobjects instanceof PDFDict ? xobjects.get(PDFName.of(a[0].v)) : undefined;
          const xo = lookup(ctx, ref);
          if (!(xo instanceof PDFRawStream) || nameOf(get(ctx, xo.dict, 'Subtype')) !== 'Form') break;
          let formRec = ref instanceof PDFRef ? formRecords.get(ref.toString()) : undefined;
          if (!formRec) {
            const bytes = decodePDFRawStream(xo).decode();
            formRec = { kind: 'form', ref, stream: xo, bytes, ops: parseContent(bytes) };
            if (ref instanceof PDFRef) formRecords.set(ref.toString(), formRec);
            streams.push(formRec);
          }
          const m = get(ctx, xo.dict, 'Matrix');
          const matrix = m instanceof PDFArray && m.size() === 6 ? m.asArray().map((x) => num(lookup(ctx, x)) ?? 0) : IDENTITY;
          const res = get(ctx, xo.dict, 'Resources') || resources;
          run(formRec, res, mul(matrix, gs.ctm), depth + 1);
          break;
        }
      }
    });
  };

  run(pageRec, inherited(ctx, pageNode, 'Resources'), IDENTITY, 0);
  return { streams, glyphs };
}

// ---------------------------------------------------------------------------
// Removing glyphs
// ---------------------------------------------------------------------------

const fmt = (n) => String(Math.round(n * 1000) / 1000);
const toHexString = (bytes) => '<' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '>';

export function removeGlyphs(doc, pageNode, analysis, targets) {
  const ctx = doc.context;
  const removeKeys = new Set(targets.map((g) => `${g.op}:${g.el}:${g.start}`));
  const affected = new Map(); // rec -> Set(opIndex)
  for (const g of targets) {
    if (!affected.has(g.rec)) affected.set(g.rec, new Set());
    affected.get(g.rec).add(g.op);
  }

  for (const [rec, opSet] of affected) {
    const replacements = [];
    for (const opIndex of opSet) {
      const o = rec.ops[opIndex];
      const opGlyphs = [];
      const seen = new Set();
      for (const g of analysis.glyphs) {
        if (g.rec !== rec || g.op !== opIndex) continue;
        const key = `${g.el}:${g.start}`;
        if (seen.has(key)) continue; // same form drawn twice
        seen.add(key);
        opGlyphs.push(g);
      }

      let elements;
      let prefix = '';
      if (o.op === 'TJ') elements = o.args[0];
      else if (o.op === 'Tj') elements = [o.args[0]];
      else if (o.op === "'") { elements = [o.args[0]]; prefix = 'T* '; }
      else if (o.op === '"') { elements = [o.args[2]]; prefix = `${fmt(o.args[0])} Tw ${fmt(o.args[1])} Tc T* `; }
      else continue;

      const parts = [];
      const pushNum = (n) => {
        if (typeof parts[parts.length - 1] === 'number') parts[parts.length - 1] += n;
        else parts.push(n);
      };
      const pushBytes = (b) => {
        const last = parts[parts.length - 1];
        if (last instanceof Uint8Array) {
          const merged = new Uint8Array(last.length + b.length);
          merged.set(last);
          merged.set(b, last.length);
          parts[parts.length - 1] = merged;
        } else parts.push(b);
      };

      elements.forEach((e, el) => {
        if (typeof e === 'number') return pushNum(e);
        if (!e || e.t !== 's') return;
        const gl = opGlyphs.filter((g) => g.el === el).sort((x, y) => x.start - y.start);
        if (!gl.length) return pushBytes(e.b);
        for (const g of gl) {
          if (removeKeys.has(`${opIndex}:${el}:${g.start}`)) pushNum(g.adj);
          else pushBytes(e.b.subarray(g.start, g.start + g.len));
        }
      });

      const body = parts.map((p) => (typeof p === 'number' ? fmt(p) : toHexString(p))).join(' ');
      replacements.push({ start: o.start, end: o.end, text: `${prefix}[${body}] TJ` });
    }

    replacements.sort((x, y) => x.start - y.start);
    const enc = new TextEncoder();
    const chunks = [];
    let pos = 0;
    for (const r of replacements) {
      chunks.push(rec.bytes.subarray(pos, r.start), enc.encode(r.text));
      pos = r.end;
    }
    chunks.push(rec.bytes.subarray(pos));
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }

    if (rec.kind === 'page') {
      pageNode.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(out)));
    } else {
      const stream = ctx.flateStream(out);
      for (const [k, v] of rec.stream.dict.entries()) {
        const key = k.decodeText();
        if (!['Filter', 'DecodeParms', 'Length', 'DL'].includes(key)) stream.dict.set(k, v);
      }
      if (rec.ref instanceof PDFRef) ctx.assign(rec.ref, stream);
    }
  }
}

// ---------------------------------------------------------------------------
// Lines (from pdf.js text content) and matching glyphs to them
// ---------------------------------------------------------------------------

const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

export function groupLines(items, skip = new Set()) {
  const lines = [];
  for (const it of items) {
    if (!it.str.trim() || skip.has(it)) continue; // pdf.js emits whitespace items that bridge gaps between columns
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    const len = Math.hypot(a, b);
    if (!size || !len) continue;
    const dir = [a / len, b / len];
    const origin = [e, f];

    const fits = (L) => {
      if (dot(L.dir, dir) < 0.99 || size < L.size * 0.6 || size > L.size * 1.6) return false;
      const rel = [origin[0] - L.origin[0], origin[1] - L.origin[1]];
      const perp = dot(rel, L.normal);
      const along = dot(rel, L.dir);
      return Math.abs(perp) < 0.3 * L.size && along > L.end - 0.6 * L.size && along < L.end + 0.6 * L.size;
    };
    let line = lines.length && fits(lines[lines.length - 1]) ? lines[lines.length - 1] : lines.find(fits);

    if (line) {
      const along = dot([origin[0] - line.origin[0], origin[1] - line.origin[1]], line.dir);
      const gap = along - line.end;
      if (gap > 0.2 * line.size && !line.text.endsWith(' ') && !it.str.startsWith(' ')) line.text += ' ';
      line.text += it.str;
      line.end = Math.max(line.end, along + it.width);
    } else {
      lines.push({ origin, dir, normal: [-dir[1], dir[0]], size, start: 0, end: it.width, text: it.str });
    }
  }
  for (const L of lines) {
    const lead = L.text.length - L.text.trimStart().length;
    L.text = L.text.trim();
    if (lead && L.text) L.start = Math.min(L.end, (lead * L.size) / 4);
  }
  return lines.filter((L) => L.text);
}

export function lineQuad(L) {
  const at = (along, perp) => [
    L.origin[0] + L.dir[0] * along + L.normal[0] * perp,
    L.origin[1] + L.dir[1] * along + L.normal[1] * perp,
  ];
  return [at(L.start, -0.25 * L.size), at(L.end, -0.25 * L.size), at(L.end, 0.85 * L.size), at(L.start, 0.85 * L.size)];
}

export function pointInLine(L, pt, pad = 0) {
  const rel = [pt[0] - L.origin[0], pt[1] - L.origin[1]];
  const along = dot(rel, L.dir);
  const perp = dot(rel, L.normal);
  return along >= L.start - pad && along <= L.end + pad && perp >= -0.25 * L.size - pad && perp <= 0.85 * L.size + pad;
}

export function glyphInLine(g, L) {
  if (dot(g.dir, L.dir) < 0.95 || g.size < L.size * 0.6 || g.size > L.size * 1.6) return false;
  const mid = [(g.origin[0] + g.end[0]) / 2, (g.origin[1] + g.end[1]) / 2];
  const rel = [mid[0] - L.origin[0], mid[1] - L.origin[1]];
  const along = dot(rel, L.dir);
  const perp = dot(rel, L.normal);
  return along >= L.start - 0.1 * L.size && along <= L.end + 0.1 * L.size && perp >= -0.3 * L.size && perp <= 0.5 * L.size;
}

const isVisible = (g) => g.tr !== 3 && g.tr !== 7;

// Style of the text in the given lines: where it starts, font, size, color.
export function styleOf(glyphs, lines) {
  const first = lines[0];
  const inLines = glyphs.filter((g) => lines.some((L) => glyphInLine(g, L)));
  const visible = inLines.filter(isVisible);
  const pool = visible.length ? visible : inLines;
  const firstLineGlyphs = pool.filter((g) => glyphInLine(g, first));
  const startGlyph = firstLineGlyphs.reduce(
    (best, g) => (!best || dot([g.origin[0] - first.origin[0], g.origin[1] - first.origin[1]], first.dir) < dot([best.origin[0] - first.origin[0], best.origin[1] - first.origin[1]], first.dir) ? g : best),
    null,
  );

  const counts = new Map();
  for (const g of pool) counts.set(g.font, (counts.get(g.font) || 0) + 1);
  const font = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const sizes = pool.map((g) => g.size).sort((x, y) => x - y);

  return {
    found: inLines.length > 0,
    invisible: inLines.length > 0 && visible.length === 0,
    origin: startGlyph ? startGlyph.origin : [first.origin[0] + first.dir[0] * first.start, first.origin[1] + first.dir[1] * first.start],
    size: sizes.length ? sizes[Math.floor(sizes.length / 2)] : first.size,
    color: startGlyph?.color || '#000000',
    rot: (Math.atan2(first.dir[1], first.dir[0]) * 180) / Math.PI,
    baseFont: font?.baseFont || '',
    flags: font?.flags || 0,
    weight: font?.weight || 0,
    glyphs: inLines,
  };
}

// Pick the closest standard PDF font for an embedded font.
export function matchStandardFont({ baseFont, flags, weight }) {
  const n = baseFont.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const bold = /bold|black|heavy|semibold|demi|,b$|-b$/.test(n) || (flags & 0x40000) !== 0 || weight >= 600;
  const italic = /italic|oblique|,i$|-it$|-i$/.test(n) || (flags & 64) !== 0;
  let family = 'Helvetica';
  if (/courier|mono|consol|menlo|typewriter/.test(n) || ((flags & 1) && !/sans|arial|helvet/.test(n))) family = 'Courier';
  else if (
    !/sans|arial|helvet|calibri|verdana|tahoma|segoe/.test(n) &&
    (/times|roman|serif|georgia|garamond|cambria|book|minion|palatino|baskerville|caslon|century|bodoni|didot/.test(n) || (flags & 2))
  ) family = 'Times';

  if (family === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  return `${family}${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`;
}

// ---------------------------------------------------------------------------
// Checkboxes
//
// Forms usually draw checkboxes as characters: Unicode ones (☐ ☑ ☒) or symbol
// font ones, e.g. Wingdings, where the letter "q" is drawn as ❑ and "þ" as ☑.
// They are pulled out of the text lines so they can be toggled instead of
// being edited as letters.
// ---------------------------------------------------------------------------

const EMPTY = { state: 'empty', boxed: true };
const CHECKED = { state: 'check', boxed: true };
const CROSSED = { state: 'cross', boxed: true };
const CHECK = { state: 'check', boxed: false };
const CROSS = { state: 'cross', boxed: false };

const CHECK_UNICODE = new Map([
  ...[...'☐□❏❐❑❒◻▢⬜'].map((c) => [c, EMPTY]),
  ...[...'☑🗹'].map((c) => [c, CHECKED]),
  ...[...'☒⌧🗷'].map((c) => [c, CROSSED]),
  ...[...'✓✔'].map((c) => [c, CHECK]),
  ...[...'✗✘✕✖'].map((c) => [c, CROSS]),
]);
// Wingdings / ZapfDingbats character codes (as their Latin-1 look-alikes).
const CHECK_SYMBOL = new Map([
  ['o', EMPTY], ['q', EMPTY], ['r', EMPTY], ['¨', EMPTY],
  ['þ', CHECKED], ['ý', CROSSED], ['x', CROSSED],
  ['ü', CHECK], ['û', CROSS],
]);
const SYMBOL_FONT = /wingding|webding|dingbat/i;

function checkInfo(ch, symbolFont) {
  const cp = ch.codePointAt(0);
  // Symbol fonts are often mapped to the private use area (U+F020–U+F0FF).
  const plain = cp >= 0xf020 && cp <= 0xf0ff ? String.fromCharCode(cp - 0xf000) : ch;
  return CHECK_UNICODE.get(ch) || (symbolFont || plain !== ch ? CHECK_SYMBOL.get(plain) : undefined);
}

export function findCheckboxes(items, glyphs) {
  const boxes = [];
  const used = new Set();
  for (const it of items) {
    const chars = [...it.str].filter((c) => c.trim());
    if (!chars.length || chars.length > 8) continue;
    const [a, b, c, d, e, f] = it.transform;
    const len = Math.hypot(a, b);
    const size = Math.hypot(c, d) || len;
    if (!len || !size) continue;
    const dir = [a / len, b / len];
    const normal = [-dir[1], dir[0]];

    let gl = glyphs
      .filter((g) => {
        if (dot(g.dir, dir) < 0.95) return false;
        const rel = [(g.origin[0] + g.end[0]) / 2 - e, (g.origin[1] + g.end[1]) / 2 - f];
        const along = dot(rel, dir);
        return along >= -0.1 * size && along <= it.width + 0.1 * size && Math.abs(dot(rel, normal)) < 0.35 * size;
      })
      .sort((g1, g2) => dot(g1.origin, dir) - dot(g2.origin, dir));
    const symbolFont = gl.length > 0 && gl.every((g) => SYMBOL_FONT.test(g.font.baseFont));
    const infos = chars.map((ch) => checkInfo(ch, symbolFont));
    if (infos.some((i) => !i)) continue;
    if (gl.length !== chars.length) gl = gl.filter((g) => !(g.len === 1 && g.code === 32));
    if (gl.length !== chars.length) continue;

    used.add(it);
    gl.forEach((g, i) => {
      const advance = Math.hypot(g.end[0] - g.origin[0], g.end[1] - g.origin[1]);
      boxes.push({
        checkbox: true,
        ...infos[i],
        origin: g.origin,
        dir: g.dir,
        normal: [-g.dir[1], g.dir[0]],
        size: g.size,
        start: 0,
        end: Math.max(advance, 0.5 * g.size),
        color: g.color,
      });
    });
  }
  return { boxes, used };
}

// The glyph a checkbox was found from, in a fresh analysis of the same page.
export function isCheckboxGlyph(g, box) {
  return Math.hypot(g.origin[0] - box.origin[0], g.origin[1] - box.origin[1]) < 0.01 && Math.abs(g.size - box.size) < 0.01;
}
