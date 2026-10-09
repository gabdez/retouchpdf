import * as pdfjsLib from 'pdfjs-dist';
import workerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } from 'pdf-lib';
import { analyzePage, removeGlyphs, groupLines, lineQuad, pointInLine, glyphInLine, styleOf, matchStandardFont, findCheckboxes, isCheckboxGlyph } from './textedit.js';
import { rebuildForm, fillForm } from './forms.js';
import { t, lang, setLang, translatePage } from './i18n.js';
import { SITE } from './site.js';
import { fontkit, readFontFile, findLocalMatch, pdfFontName, normalizeFontName } from './fonts.js';
import './style.css';

// The worker is bundled as text and started from memory, so the app can be a
// single offline HTML file that never loads anything from anywhere.
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));

// ---------------------------------------------------------------------------
// Model
//
// A document is an ordered list of pages. Each page points at a source PDF
// (or is blank) and carries its own rotation and annotations. Annotations are
// stored in PDF user space (points, y axis up) so they export 1:1 with pdf-lib.
// ---------------------------------------------------------------------------

const SANS = 'Helvetica, Arial, sans-serif';
const SERIF = '"Times New Roman", Times, serif';
const MONO = '"Courier New", Courier, monospace';
const FONTS = {
  Helvetica: { std: StandardFonts.Helvetica, family: SANS },
  'Helvetica-Bold': { std: StandardFonts.HelveticaBold, family: SANS, bold: true },
  'Helvetica-Oblique': { std: StandardFonts.HelveticaOblique, family: SANS, italic: true },
  'Helvetica-BoldOblique': { std: StandardFonts.HelveticaBoldOblique, family: SANS, bold: true, italic: true },
  'Times-Roman': { std: StandardFonts.TimesRoman, family: SERIF },
  'Times-Bold': { std: StandardFonts.TimesRomanBold, family: SERIF, bold: true },
  'Times-Italic': { std: StandardFonts.TimesRomanItalic, family: SERIF, italic: true },
  'Times-BoldItalic': { std: StandardFonts.TimesRomanBoldItalic, family: SERIF, bold: true, italic: true },
  Courier: { std: StandardFonts.Courier, family: MONO },
  'Courier-Bold': { std: StandardFonts.CourierBold, family: MONO, bold: true },
  'Courier-Oblique': { std: StandardFonts.CourierOblique, family: MONO, italic: true },
  'Courier-BoldOblique': { std: StandardFonts.CourierBoldOblique, family: MONO, bold: true, italic: true },
};
// Fonts loaded from this computer, keyed "font:<n>": { bytes, subset, name, family, postscriptName, cssFamily }
const customFonts = new Map();
// Always lay text out with precomposed accents (e.g. "ñ" as one glyph) so that
// copied / searched text in the saved PDF stays correct.
const FONT_FEATURES = () => ({ ccmp: false });

const cssFont = (name, px) => {
  const custom = customFonts.get(name);
  if (custom) return `${px}px "${custom.cssFamily}", sans-serif`;
  const f = FONTS[name] || FONTS.Helvetica;
  return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${px}px ${f.family}`;
};
const LINE_HEIGHT = 1.2;
// Distance from the top of a text box to the first baseline, in ems. Matches
// where the browser puts the baseline in the inline <textarea> editor.
const EDITOR_ASCENT = 0.94;
const HIGHLIGHT_OPACITY = 0.4;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

const state = {
  sources: [], // { bytes, doc (pdf.js), pageCache: Map }
  pages: [], // { id, src (-1 = blank), index, rotation, view: [x1,y1,x2,y2], annots: [] }
  images: new Map(), // id -> { bytes, type: 'png'|'jpg', el: HTMLImageElement }
  tool: 'select',
  color: '#1d4ed8',
  size: 14,
  stroke: 2,
  font: 'Helvetica',
  zoom: 1.25,
  selected: null, // { pageId, annotId }
  pendingImage: null,
  editing: null, // { pageId, hideId, cover: [quads] } while the inline editor is open
  hover: null, // { pageId, line } under the pointer in Edit text mode
  marquee: null, // { pageId, a, b } drag-selection in Edit text mode
  busy: false,
  fileName: 'document.pdf',
  dirty: false,
};

let undoStack = [];
let redoStack = [];
let nextId = 1;
const uid = () => nextId++;

const metricFonts = {}; // pdf-lib fonts used only to measure text widths
const views = new Map(); // pageId -> { wrap, canvas, overlay, vp, rendered }
const thumbCache = new Map(); // "src:index:rotation" -> canvas
const textCache = new Map(); // "src:index" -> { lines } (existing text of a page, from pdf.js)
const dpr = () => window.devicePixelRatio || 1;

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const sidebar = $('sidebar');
const workspace = $('workspace');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Same transform pdf.js builds for a PageViewport: PDF user space -> CSS pixels.
function makeViewport(view, scale, rotation) {
  const [x1, y1, x2, y2] = view;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  let a, b, c, d;
  switch (((rotation % 360) + 360) % 360) {
    case 90: [a, b, c, d] = [0, 1, 1, 0]; break;
    case 180: [a, b, c, d] = [-1, 0, 0, 1]; break;
    case 270: [a, b, c, d] = [0, -1, -1, 0]; break;
    default: [a, b, c, d] = [1, 0, 0, -1];
  }
  let ox, oy, width, height;
  if (a === 0) {
    ox = Math.abs(cy - y1) * scale;
    oy = Math.abs(cx - x1) * scale;
    width = Math.abs(y2 - y1) * scale;
    height = Math.abs(x2 - x1) * scale;
  } else {
    ox = Math.abs(cx - x1) * scale;
    oy = Math.abs(cy - y1) * scale;
    width = Math.abs(x2 - x1) * scale;
    height = Math.abs(y2 - y1) * scale;
  }
  const transform = [
    a * scale, b * scale, c * scale, d * scale,
    ox - a * scale * cx - c * scale * cy,
    oy - b * scale * cx - d * scale * cy,
  ];
  return { width, height, transform, inverse: invert(transform) };
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Rotate a vector counter-clockwise (PDF y-up convention) by `deg`.
function rot([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [x * cos - y * sin, x * sin + y * cos];
}

const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];

function textLines(a) {
  return a.text.split('\n');
}

function textWidth(a) {
  const f = metricFonts[a.font];
  return Math.max(1, ...textLines(a).map((l) => safeWidth(f, l, a.size)));
}

function safeWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(sanitize(font, text), size);
  } catch {
    return text.length * size * 0.55;
  }
}

// Box of text / image annotations in their own (rotated) frame, origin at (x, y).
const lineHeight = (a) => a.lh ?? LINE_HEIGHT;

function localBox(a) {
  if (a.type === 'image' || a.type === 'mark') return [0, 0, a.w, a.h];
  const n = textLines(a).length;
  return [0, -(n - 1) * a.size * lineHeight(a) - 0.25 * a.size, textWidth(a), 0.95 * a.size];
}

function toLocal(a, pt) {
  return rot(sub(pt, [a.x, a.y]), -a.rot);
}

function fromLocal(a, lp) {
  return add([a.x, a.y], rot(lp, a.rot));
}

// Outline of an annotation as a polygon in PDF space (for selection boxes).
function outline(a) {
  if (a.type === 'rect') {
    return [[a.x1, a.y1], [a.x2, a.y1], [a.x2, a.y2], [a.x1, a.y2]];
  }
  if (a.type === 'ink') {
    const xs = a.points.map((p) => p[0]);
    const ys = a.points.map((p) => p[1]);
    const pad = a.width / 2 + 2;
    const [x1, y1, x2, y2] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  }
  const [x1, y1, x2, y2] = localBox(a);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map((p) => fromLocal(a, p));
}

// Line segments of a checkbox mark (optional box outline + check or cross).
function markSegments(a) {
  const P = (u, v) => fromLocal(a, [u * a.w, v * a.h]);
  const segs = [];
  if (a.box) {
    const corners = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    corners.forEach((p, i) => segs.push([p, corners[(i + 1) % 4], a.boxWidth]));
  }
  if (a.kind === 'check') segs.push([P(0.2, 0.52), P(0.42, 0.27), a.width], [P(0.42, 0.27), P(0.82, 0.8), a.width]);
  if (a.kind === 'cross') segs.push([P(0.22, 0.22), P(0.78, 0.78), a.width], [P(0.22, 0.78), P(0.78, 0.22), a.width]);
  return segs;
}

function segDist(p, a, b) {
  const [dx, dy] = sub(b, a);
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function hitTest(a, pt, tol) {
  switch (a.type) {
    case 'rect': {
      const [x1, x2] = [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
      const [y1, y2] = [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
      return pt[0] >= x1 - tol && pt[0] <= x2 + tol && pt[1] >= y1 - tol && pt[1] <= y2 + tol;
    }
    case 'ink': {
      const pts = a.points;
      if (pts.length === 1) return Math.hypot(pt[0] - pts[0][0], pt[1] - pts[0][1]) <= a.width / 2 + tol;
      for (let i = 1; i < pts.length; i++) {
        if (segDist(pt, pts[i - 1], pts[i]) <= a.width / 2 + tol) return true;
      }
      return false;
    }
    default: {
      const [lx, ly] = toLocal(a, pt);
      const [x1, y1, x2, y2] = localBox(a);
      return lx >= x1 - tol && lx <= x2 + tol && ly >= y1 - tol && ly <= y2 + tol;
    }
  }
}

// Bottom-right resize handle of an image (in PDF space).
const imageHandle = (a) => fromLocal(a, [a.w, 0]);

function moveAnnot(a, orig, [dx, dy]) {
  if (a.type === 'rect') {
    a.x1 = orig.x1 + dx; a.x2 = orig.x2 + dx;
    a.y1 = orig.y1 + dy; a.y2 = orig.y2 + dy;
  } else if (a.type === 'ink') {
    a.points = orig.points.map(([x, y]) => [x + dx, y + dy]);
  } else {
    a.x = orig.x + dx;
    a.y = orig.y + dy;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Standard PDF fonts only cover WinAnsi; replace anything else with '?'.
function sanitize(font, text) {
  const set = font.getCharacterSet();
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    out += ch === '\n' || set.includes(cp) ? ch : '?';
  }
  return out;
}

let toastTimer;
function toast(msg, ms = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

const toolHelp = (tool) => (tool ? t(`help.${tool}`) : '');

// Help line in the tool bar: a message, or the help for the current tool.
function hint(msg) {
  const el = $('hint');
  $('hint-text').textContent = msg || toolHelp(state.tool);
  el.classList.toggle('emphasis', !!msg);
}

const getPage = (id) => state.pages.find((p) => p.id === id);

function getSelected() {
  if (!state.selected) return null;
  const page = getPage(state.selected.pageId);
  const annot = page?.annots.find((a) => a.id === state.selected.annotId);
  return annot ? { page, annot } : null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const snapshot = () => structuredClone(state.pages);

function pushUndo(snap = snapshot()) {
  undoStack.push(snap);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  state.dirty = true;
  updateButtons();
  scheduleThumbs();
}

function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  const before = structureKey();
  state.pages = from.pop();
  state.selected = null;
  state.dirty = true;
  if (structureKey() === before) {
    redrawAllOverlays();
    scheduleThumbs();
    for (const p of state.pages) syncFormLayer(p);
  } else refreshAll();
  updateButtons();
}

const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

const structureKey = () => state.pages.map((p) => `${p.id}:${p.rotation}:${p.src}:${p.index}`).join(',');

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function addSource(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  state.sources.push({ bytes, doc, pageCache: new Map(), lib: null });
  return state.sources.length - 1;
}

// pdf-lib view of a source, loaded once and shared (read-only).
function libDoc(srcIndex) {
  const src = state.sources[srcIndex];
  src.lib ??= PDFDocument.load(src.bytes, { ignoreEncryption: true });
  return src.lib;
}

async function loadSource(bytes) {
  const srcIndex = await addSource(bytes);
  const src = state.sources[srcIndex];
  const pages = [];
  for (let i = 0; i < src.doc.numPages; i++) {
    const p = await src.doc.getPage(i + 1);
    src.pageCache.set(i, p);
    pages.push({ id: uid(), src: srcIndex, origin: srcIndex, index: i, rotation: p.rotate, view: [...p.view], annots: [] });
  }
  return pages;
}

async function readFile(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function confirmDiscard() {
  return !state.dirty || confirm(t('confirm.discard'));
}

async function openFile(file) {
  if (!confirmDiscard()) return;
  try {
    const bytes = await readFile(file);
    resetDoc();
    state.fileName = file.name;
    state.pages = await loadSource(bytes);
    afterOpen();
  } catch (err) {
    console.error(err);
    toast(err?.name === 'PasswordException' ? t('open.password') : t('open.failed', { name: file.name }));
  }
}

function newBlankDoc() {
  if (!confirmDiscard()) return;
  resetDoc();
  state.fileName = 'untitled.pdf';
  state.pages = [blankPage([0, 0, 612, 792])];
  afterOpen();
}

function blankPage(view) {
  return { id: uid(), src: -1, index: 0, rotation: 0, view: [...view], annots: [] };
}

function resetDoc() {
  for (const s of state.sources) s.doc.loadingTask?.destroy();
  state.sources = [];
  state.pages = [];
  state.selected = null;
  state.dirty = false;
  undoStack = [];
  redoStack = [];
  thumbCache.clear();
  textCache.clear();
}

function afterOpen() {
  document.body.classList.add('has-doc');
  document.title = `${state.fileName} – RetouchPDF`;
  setTool('select');
  refreshAll();
  workspace.scrollTop = 0;
  updateButtons();
}

async function insertFiles(files) {
  const before = snapshot();
  let added = 0;
  for (const file of files) {
    try {
      const pages = await loadSource(await readFile(file));
      state.pages.push(...pages);
      added += pages.length;
    } catch (err) {
      console.error(err);
      toast(t('open.failed', { name: file.name }));
    }
  }
  if (added) {
    pushUndo(before);
    refreshAll();
    toast(added === 1 ? t('pages.added.one') : t('pages.added.other', { n: added }));
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const renderObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const v = views.get(Number(e.target.dataset.pageId));
      if (v && !v.rendered) renderPageCanvas(Number(e.target.dataset.pageId), v);
    }
  },
  { root: workspace, rootMargin: '600px 0px' },
);

function buildViewer() {
  closePicker();
  renderObserver.disconnect();
  views.clear();
  viewer.innerHTML = '';
  for (const page of state.pages) {
    const vp = makeViewport(page.view, state.zoom, page.rotation);
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.dataset.pageId = page.id;
    wrap.style.width = `${vp.width}px`;
    wrap.style.height = `${vp.height}px`;

    const canvas = document.createElement('canvas');
    const overlay = document.createElement('canvas');
    overlay.className = 'overlay';
    for (const c of [canvas, overlay]) {
      c.width = Math.round(vp.width * dpr());
      c.height = Math.round(vp.height * dpr());
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
    }
    const formLayer = document.createElement('div');
    formLayer.className = 'form-layer';
    wrap.append(canvas, overlay, formLayer);
    viewer.append(wrap);

    const v = { wrap, canvas, overlay, formLayer, vp, rendered: false };
    views.set(page.id, v);
    attachPointer(page.id, v);
    renderObserver.observe(wrap);
    drawOverlay(page);
  }
  updatePageLabel();
}

async function renderPageCanvas(pageId, v) {
  v.rendered = true;
  const page = getPage(pageId);
  if (!page) return;
  const ctx = v.canvas.getContext('2d');
  if (page.src < 0) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, v.canvas.width, v.canvas.height);
    return;
  }
  buildFormLayer(pageId, v);
  try {
    const pdfPage = await getPdfPage(page);
    const viewport = pdfPage.getViewport({ scale: state.zoom * dpr(), rotation: page.rotation });
    v.task?.cancel();
    v.task = pdfPage.render({ canvasContext: ctx, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS });
    await v.task.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.error(err);
  }
}

function rerenderPage(page) {
  const v = views.get(page.id);
  if (!v) return;
  renderPageCanvas(page.id, v);
  drawOverlay(page);
}

async function getPdfPage(page) {
  const src = state.sources[page.src];
  let p = src.pageCache.get(page.index);
  if (!p) {
    p = await src.doc.getPage(page.index + 1);
    src.pageCache.set(page.index, p);
  }
  return p;
}

function drawOverlay(page) {
  const v = views.get(page.id);
  if (!v) return;
  const ctx = v.overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, v.overlay.width, v.overlay.height);
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
  ctx.transform(...v.vp.transform);

  const px = 1 / state.zoom;
  const polygon = (poly) => {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.closePath();
  };

  // While an existing line is being edited, hide the original underneath.
  if (state.editing?.pageId === page.id) {
    ctx.fillStyle = state.editing.coverFill || '#fff';
    for (const q of state.editing.cover || []) {
      polygon(q);
      ctx.fill();
    }
  }

  for (const a of page.annots) {
    if (a.id !== state.editing?.hideId) drawAnnot(ctx, a);
  }

  if (state.tool === 'edittext' && !state.editing) {
    const lines = linesFor(page);
    ctx.save();
    ctx.lineWidth = px;
    for (const a of page.annots) {
      if (a.type !== 'text' && a.type !== 'mark') continue;
      polygon(outline(a));
      ctx.strokeStyle = a.type === 'mark' ? 'rgba(217, 119, 6, 0.6)' : 'rgba(37, 99, 235, 0.3)';
      ctx.stroke();
    }
    for (const B of boxesFor(page)) {
      const hovered = state.hover?.pageId === page.id && state.hover.line === B;
      polygon(lineQuad(B));
      ctx.fillStyle = hovered ? 'rgba(217, 119, 6, 0.22)' : 'rgba(217, 119, 6, 0.08)';
      ctx.strokeStyle = hovered ? 'rgba(217, 119, 6, 1)' : 'rgba(217, 119, 6, 0.55)';
      ctx.fill();
      ctx.stroke();
    }
    for (const L of lines || []) {
      const hovered = state.hover?.pageId === page.id && state.hover.line === L;
      polygon(lineQuad(L));
      ctx.fillStyle = hovered ? 'rgba(37, 99, 235, 0.16)' : 'rgba(37, 99, 235, 0.05)';
      ctx.strokeStyle = hovered ? 'rgba(37, 99, 235, 0.9)' : 'rgba(37, 99, 235, 0.3)';
      ctx.fill();
      ctx.stroke();
    }
    if (state.marquee?.pageId === page.id) {
      const { a, b } = state.marquee;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeStyle = '#2563eb';
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    ctx.restore();
  }

  const sel = getSelected();
  if (sel && sel.page.id === page.id && sel.annot.id !== state.editing?.hideId) {
    ctx.save();
    polygon(outline(sel.annot));
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.strokeStyle = '#2563eb';
    ctx.stroke();
    if (sel.annot.type === 'image') {
      const [hx, hy] = imageHandle(sel.annot);
      const s = 5 * px;
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - s, hy - s, 2 * s, 2 * s);
      ctx.strokeRect(hx - s, hy - s, 2 * s, 2 * s);
    }
    ctx.restore();
  }
}

function drawAnnot(ctx, a) {
  ctx.save();
  switch (a.type) {
    case 'rect': {
      const x = Math.min(a.x1, a.x2);
      const y = Math.min(a.y1, a.y2);
      const w = Math.abs(a.x2 - a.x1);
      const h = Math.abs(a.y2 - a.y1);
      if (a.variant === 'highlight') {
        ctx.globalAlpha = HIGHLIGHT_OPACITY;
        ctx.fillStyle = a.color;
        ctx.fillRect(x, y, w, h);
      } else if (a.variant === 'whiteout') {
        ctx.fillStyle = a.fill || '#fff';
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.strokeRect(x, y, w, h);
      }
      break;
    }
    case 'ink': {
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      a.points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      if (a.points.length === 1) ctx.lineTo(a.points[0][0] + 0.01, a.points[0][1]);
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.translate(a.x, a.y);
      ctx.scale(1, -1);
      ctx.rotate((-a.rot * Math.PI) / 180);
      ctx.font = cssFont(a.font, a.size);
      ctx.fillStyle = a.color;
      ctx.textBaseline = 'alphabetic';
      textLines(a).forEach((line, i) => ctx.fillText(line, 0, i * a.size * lineHeight(a)));
      break;
    }
    case 'mark': {
      ctx.strokeStyle = a.color;
      ctx.lineCap = 'round';
      for (const [p, q, w] of markSegments(a)) {
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(...p);
        ctx.lineTo(...q);
        ctx.stroke();
      }
      break;
    }
    case 'image': {
      const img = state.images.get(a.imageId)?.el;
      if (img) {
        ctx.translate(a.x, a.y);
        ctx.scale(1, -1);
        ctx.rotate((-a.rot * Math.PI) / 180);
        ctx.drawImage(img, 0, -a.h, a.w, a.h);
      }
      break;
    }
  }
  ctx.restore();
}

function redrawAllOverlays() {
  for (const p of state.pages) drawOverlay(p);
}

function refreshAll() {
  buildViewer();
  buildThumbs();
}

// ---------------------------------------------------------------------------
// Thumbnails & page operations
// ---------------------------------------------------------------------------

let thumbQueue = Promise.resolve();
let dragFrom = null;

function buildThumbs() {
  sidebar.innerHTML = '';
  state.pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'thumb';
    item.draggable = true;
    item.dataset.pageId = page.id;

    const canvas = document.createElement('canvas');
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = i + 1;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btn = (icon, title, fn) => {
      const b = document.createElement('button');
      b.innerHTML = `<svg class="icon"><use href="#i-${icon}" /></svg>`;
      b.title = title;
      b.setAttribute('aria-label', title);
      if (icon === 'x') b.classList.add('danger');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      actions.append(b);
    };
    btn('rotate-cw', t('thumb.rotateCw'), () => rotatePage(page.id, 90));
    btn('rotate-ccw', t('thumb.rotateCcw'), () => rotatePage(page.id, -90));
    btn('copy', t('thumb.duplicate'), () => duplicatePage(page.id));
    btn('x', t('thumb.delete'), () => deletePage(page.id));

    item.append(canvas, num, actions);
    item.addEventListener('click', () => scrollToPage(page.id));

    item.addEventListener('dragstart', (e) => {
      dragFrom = page.id;
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => (dragFrom = null));
    item.addEventListener('dragover', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      const after = e.offsetY > item.clientHeight / 2;
      item.classList.toggle('drop-before', !after);
      item.classList.toggle('drop-after', after);
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
    item.addEventListener('drop', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      e.stopPropagation();
      const after = item.classList.contains('drop-after');
      item.classList.remove('drop-before', 'drop-after');
      movePage(dragFrom, page.id, after);
    });

    sidebar.append(item);
    thumbQueue = thumbQueue.then(() => renderThumb(page, canvas));
  });
  updatePageLabel();
}

async function renderThumb(page, canvas) {
  const key = `${page.src}:${page.index}:${page.rotation}:${page.view.join(',')}`;
  const base = makeViewport(page.view, 1, page.rotation);
  const scale = 140 / base.width;
  const w = Math.round(base.width * scale);
  const h = Math.round(base.height * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const drawAnnots = () => {
    ctx.save();
    ctx.transform(...makeViewport(page.view, scale, page.rotation).transform);
    for (const a of page.annots) drawAnnot(ctx, a);
    ctx.restore();
  };
  if (page.src < 0) return drawAnnots();

  let cached = thumbCache.get(key);
  if (!cached) {
    try {
      cached = document.createElement('canvas');
      cached.width = w;
      cached.height = h;
      const pdfPage = await getPdfPage(page);
      const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });
      await pdfPage.render({ canvasContext: cached.getContext('2d'), viewport }).promise;
      thumbCache.set(key, cached);
    } catch (err) {
      console.error(err);
      return;
    }
  }
  ctx.drawImage(cached, 0, 0);
  drawAnnots();
}

// Annotations changed: repaint thumbnails (cheap, page images are cached).
let thumbTimer;
function scheduleThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    for (const item of sidebar.children) {
      const page = getPage(Number(item.dataset.pageId));
      if (page) thumbQueue = thumbQueue.then(() => renderThumb(page, item.querySelector('canvas')));
    }
  }, 400);
}

function rotatePage(id, delta) {
  pushUndo();
  const page = getPage(id);
  page.rotation = (((page.rotation + delta) % 360) + 360) % 360;
  refreshAll();
  scrollToPage(id);
}

function deletePage(id) {
  if (state.pages.length === 1) {
    toast(t('page.lastOne'));
    return;
  }
  pushUndo();
  state.pages = state.pages.filter((p) => p.id !== id);
  if (state.selected?.pageId === id) state.selected = null;
  refreshAll();
}

function duplicatePage(id) {
  pushUndo();
  const i = state.pages.findIndex((p) => p.id === id);
  const copy = structuredClone(state.pages[i]);
  copy.id = uid();
  copy.annots.forEach((a) => (a.id = uid()));
  state.pages.splice(i + 1, 0, copy);
  refreshAll();
}

function movePage(fromId, toId, after) {
  if (fromId === toId) return;
  pushUndo();
  const from = state.pages.findIndex((p) => p.id === fromId);
  const [page] = state.pages.splice(from, 1);
  let to = state.pages.findIndex((p) => p.id === toId);
  if (after) to++;
  state.pages.splice(to, 0, page);
  refreshAll();
}

function insertBlankPage() {
  const current = currentPageIndex();
  const ref = state.pages[current];
  const base = makeViewport(ref.view, 1, ref.rotation);
  pushUndo();
  const page = blankPage([0, 0, base.width, base.height]);
  state.pages.splice(current + 1, 0, page);
  refreshAll();
  scrollToPage(page.id);
}

function scrollToPage(id) {
  const v = views.get(id);
  if (v) workspace.scrollTo({ top: v.wrap.offsetTop - 16, behavior: 'smooth' });
}

function currentPageIndex() {
  const top = workspace.scrollTop + workspace.clientHeight / 3;
  let idx = 0;
  state.pages.forEach((p, i) => {
    const v = views.get(p.id);
    if (v && v.wrap.offsetTop <= top) idx = i;
  });
  return idx;
}

function updatePageLabel() {
  if (!state.pages.length) {
    $('page-label').textContent = '';
    return;
  }
  const idx = currentPageIndex();
  $('page-label').textContent = t('page.label', { n: idx + 1, total: state.pages.length });
  const id = state.pages[idx].id;
  for (const t of sidebar.children) t.classList.toggle('current', Number(t.dataset.pageId) === id);
}

workspace.addEventListener('scroll', updatePageLabel, { passive: true });

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

function eventToPdf(e, v) {
  const r = v.overlay.getBoundingClientRect();
  return apply(v.vp.inverse, [e.clientX - r.left, e.clientY - r.top]);
}

function attachPointer(pageId, v) {
  let drag = null;

  v.overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || state.busy) return;
    const page = getPage(pageId);
    const pt = eventToPdf(e, v);
    const tol = 4 / state.zoom;

    switch (state.tool) {
      case 'select': {
        const sel = getSelected();
        if (sel?.page.id === pageId && sel.annot.type === 'image') {
          const h = imageHandle(sel.annot);
          if (Math.hypot(pt[0] - h[0], pt[1] - h[1]) <= 8 / state.zoom) {
            drag = { kind: 'resize', annot: sel.annot, orig: structuredClone(sel.annot), before: snapshot() };
            break;
          }
        }
        const annot = [...page.annots].reverse().find((a) => hitTest(a, pt, tol));
        select(annot ? { pageId, annotId: annot.id } : null);
        if (annot) drag = { kind: 'move', annot, orig: structuredClone(annot), start: pt, before: snapshot() };
        break;
      }
      case 'text':
        openNewText(pageId, pt);
        e.preventDefault();
        return;
      case 'edittext': {
        e.preventDefault();
        if (state.busy) return;
        const annot = [...page.annots].reverse().find((a) => (a.type === 'text' || a.type === 'mark') && hitTest(a, pt, tol));
        if (annot?.type === 'mark') {
          openCheckPicker(page, { annot });
          return;
        }
        if (annot) {
          editAnnotText(pageId, annot);
          return;
        }
        state.marquee = { pageId, a: pt, b: pt };
        drag = { kind: 'marquee', start: pt };
        break;
      }
      case 'draw': {
        const before = snapshot();
        const annot = { id: uid(), type: 'ink', points: [pt], color: state.color, width: state.stroke };
        page.annots.push(annot);
        drag = { kind: 'ink', annot, before };
        break;
      }
      case 'highlight':
      case 'whiteout':
      case 'rect': {
        const before = snapshot();
        const annot = {
          id: uid(), type: 'rect', variant: state.tool,
          x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1],
          color: state.tool === 'highlight' && state.color === '#1d4ed8' ? '#facc15' : state.color,
          width: state.stroke,
        };
        page.annots.push(annot);
        drag = { kind: 'rect', annot, before };
        break;
      }
      case 'image':
        placeImage(page, pt);
        return;
    }
    if (drag) {
      v.overlay.setPointerCapture(e.pointerId);
      drawOverlay(page);
    }
  });

  v.overlay.addEventListener('pointermove', (e) => {
    const page = getPage(pageId);
    const pt = eventToPdf(e, v);
    if (!drag) {
      if (state.tool === 'select') v.overlay.style.cursor = hoverCursor(page, pt);
      if (state.tool === 'edittext' && !state.editing) updateHover(page, pt, v);
      return;
    }
    const a = drag.annot;
    if (drag.kind === 'marquee') {
      state.marquee.b = pt;
    } else if (drag.kind === 'move') {
      moveAnnot(a, drag.orig, sub(pt, drag.start));
    } else if (drag.kind === 'resize') {
      const o = drag.orig;
      const topLeft = fromLocal(o, [0, o.h]);
      const lx = Math.max(10, rot(sub(pt, topLeft), -o.rot)[0]);
      a.w = lx;
      a.h = (lx * o.h) / o.w;
      [a.x, a.y] = add(topLeft, rot([0, -a.h], o.rot));
    } else if (drag.kind === 'ink') {
      const last = a.points[a.points.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * state.zoom >= 1.5) a.points.push(pt);
    } else if (drag.kind === 'rect') {
      a.x2 = pt[0];
      a.y2 = pt[1];
    }
    drawOverlay(page);
  });

  const end = (e) => {
    if (!drag) return;
    const page = getPage(pageId);
    if (drag.kind === 'marquee') {
      const { a: p1, b: p2 } = state.marquee;
      state.marquee = null;
      drag = null;
      const lines = linesFor(page) || [];
      let picked;
      if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * state.zoom < 4) {
        const box = boxesFor(page).find((b) => pointInLine(b, p1, 2 / state.zoom));
        if (box) {
          drawOverlay(page);
          openCheckPicker(page, { box });
          return;
        }
        const L = lines.find((l) => pointInLine(l, p1, 2 / state.zoom));
        picked = L ? [L] : [];
      } else {
        const [x1, x2] = [Math.min(p1[0], p2[0]), Math.max(p1[0], p2[0])];
        const [y1, y2] = [Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1])];
        picked = lines.filter((L) => lineQuad(L).some(([x, y]) => x >= x1 && x <= x2 && y >= y1 && y <= y2));
      }
      drawOverlay(page);
      if (picked.length) editExistingText(page, picked);
      else if (lines && !lines.length && page.src >= 0 && e?.type === 'pointerup') {
        toast(t('edit.noText'), 5000);
      }
      return;
    }
    const a = drag.annot;
    let changed = true;
    if (drag.kind === 'move' || drag.kind === 'resize') {
      changed = JSON.stringify(a) !== JSON.stringify(drag.orig);
    } else if (drag.kind === 'rect' && Math.abs(a.x2 - a.x1) * state.zoom < 3 && Math.abs(a.y2 - a.y1) * state.zoom < 3) {
      page.annots = page.annots.filter((x) => x !== a); // just a click, not a drag
      changed = false;
    }
    if (changed) pushUndo(drag.before);
    drag = null;
    drawOverlay(page);
  };
  v.overlay.addEventListener('pointerup', end);
  v.overlay.addEventListener('pointercancel', end);

  v.overlay.addEventListener('dblclick', (e) => {
    if (state.tool !== 'select') return;
    const page = getPage(pageId);
    const pt = eventToPdf(e, v);
    const annot = [...page.annots].reverse().find((a) => a.type === 'text' && hitTest(a, pt, 4 / state.zoom));
    if (annot) editAnnotText(pageId, annot);
  });
}

function updateHover(page, pt, v) {
  const lines = linesFor(page) || [];
  const onAnnot = page.annots.find((a) => (a.type === 'text' || a.type === 'mark') && hitTest(a, pt, 4 / state.zoom));
  const box = onAnnot ? null : boxesFor(page).find((b) => pointInLine(b, pt, 2 / state.zoom));
  const line = onAnnot || box ? box || null : lines.find((L) => pointInLine(L, pt, 2 / state.zoom)) || null;
  v.overlay.style.cursor = box || onAnnot?.type === 'mark' ? 'pointer' : line || onAnnot ? 'text' : 'crosshair';
  const prev = state.hover;
  if (prev?.line === line && prev?.pageId === page.id) return;
  state.hover = line ? { pageId: page.id, line } : null;
  if (prev && prev.pageId !== page.id) {
    const p = getPage(prev.pageId);
    if (p) drawOverlay(p);
  }
  drawOverlay(page);
}

// Existing text of a page: lines (null while loading) and checkboxes.
function textInfo(page) {
  if (page.src < 0) return { lines: [], boxes: [] };
  const key = `${page.src}:${page.index}`;
  let entry = textCache.get(key);
  if (!entry) {
    entry = { lines: null, boxes: [] };
    textCache.set(key, entry);
    Promise.all([
      getPdfPage(page).then((p) => p.getTextContent()),
      pageAnalysis(page).catch((err) => {
        console.error(err);
        return null;
      }),
    ])
      .then(([tc, analysis]) => {
        const found = analysis ? findCheckboxes(tc.items, analysis.glyphs) : { boxes: [], used: new Set() };
        entry.boxes = found.boxes;
        entry.lines = groupLines(tc.items, found.used);
      })
      .catch((err) => {
        console.error(err);
        entry.lines = [];
      })
      .then(() => {
        for (const p of state.pages) if (`${p.src}:${p.index}` === key) drawOverlay(p);
      });
  }
  return entry;
}

const linesFor = (page) => textInfo(page).lines;
const boxesFor = (page) => textInfo(page).boxes;

function hoverCursor(page, pt) {
  const sel = getSelected();
  if (sel?.page.id === page.id && sel.annot.type === 'image') {
    const h = imageHandle(sel.annot);
    if (Math.hypot(pt[0] - h[0], pt[1] - h[1]) <= 8 / state.zoom) return 'nwse-resize';
  }
  return page.annots.some((a) => hitTest(a, pt, 4 / state.zoom)) ? 'move' : 'default';
}

function select(sel) {
  const prev = state.selected?.pageId;
  state.selected = sel;
  if (prev != null && prev !== sel?.pageId) {
    const p = getPage(prev);
    if (p) drawOverlay(p);
  }
  if (sel) {
    drawOverlay(getPage(sel.pageId));
    syncControlsFromSelection();
  }
  updateButtons();
}

function syncControlsFromSelection() {
  const a = getSelected()?.annot;
  if (!a) return;
  if (a.color && a.variant !== 'whiteout') {
    $('in-color').value = a.color;
    setSwatch(a.color);
  }
  if (a.type === 'text') {
    $('in-size').value = a.size;
    $('in-font').value = lastFont = a.font;
  }
  if (a.width) $('in-stroke').value = a.width;
}

function deleteSelected() {
  const sel = getSelected();
  if (!sel) return;
  pushUndo();
  sel.page.annots = sel.page.annots.filter((a) => a.id !== sel.annot.id);
  state.selected = null;
  drawOverlay(sel.page);
  updateButtons();
}

// ---------------------------------------------------------------------------
// Text editing
// ---------------------------------------------------------------------------

// One inline editor serves new text, text annotations and existing PDF text.
// `anchor` is the baseline start of the first line, in PDF space.
let activeEditor = null;

function openEditor({ pageId, anchor, rot: r, text, size, font, color, lh = LINE_HEIGHT, cover = null, coverFill = '#ffffff', hideId = null, onCommit }) {
  closeEditor(true);
  const page = getPage(pageId);
  const v = views.get(pageId);
  if (!page || !v) return;

  const topLeft = add(anchor, rot([0, EDITOR_ASCENT * size], r));
  const [left, top] = apply(v.vp.transform, topLeft);
  const [dx, dy] = sub(apply(v.vp.transform, add(topLeft, rot([1, 0], r))), [left, top]);

  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  if (cover) ta.style.background = coverFill;
  ta.value = text;
  ta.spellcheck = false;
  ta.style.left = `${left}px`;
  ta.style.top = `${top}px`;
  ta.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  ta.style.font = cssFont(font, size * state.zoom);
  ta.style.lineHeight = String(lh);
  ta.style.color = color;
  const autosize = () => {
    ta.style.width = '0';
    ta.style.height = '0';
    ta.style.width = `${ta.scrollWidth + 8}px`;
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', autosize);
  v.wrap.append(ta);
  autosize();

  state.editing = { pageId, hideId, cover, coverFill };
  state.hover = null;
  drawOverlay(page);
  activeEditor = { ta, pageId, original: text, onCommit };

  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeEditor(false);
    else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      closeEditor(true);
    }
  });
  ta.addEventListener('blur', () => closeEditor(true));
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

function closeEditor(commit) {
  const ed = activeEditor;
  if (!ed) return;
  activeEditor = null;
  state.editing = null;
  ed.ta.remove();
  const page = getPage(ed.pageId);
  if (page) drawOverlay(page);
  const text = ed.ta.value.replace(/\s+$/, '');
  if (commit && text !== ed.original) ed.onCommit(text);
  updateButtons();
}

function openNewText(pageId, clickPt) {
  const r = getPage(pageId).rotation;
  const style = { size: state.size, font: state.font, color: state.color };
  const anchor = add(clickPt, rot([0, -EDITOR_ASCENT * style.size], r));
  openEditor({
    pageId, anchor, rot: r, text: '', ...style,
    onCommit: (text) => {
      const page = getPage(pageId);
      if (!text || !page) return;
      pushUndo();
      const annot = { id: uid(), type: 'text', x: anchor[0], y: anchor[1], rot: r, text, ...style };
      page.annots.push(annot);
      state.selected = { pageId, annotId: annot.id };
      drawOverlay(page);
    },
  });
}

function editAnnotText(pageId, annot) {
  openEditor({
    pageId,
    anchor: [annot.x, annot.y],
    rot: annot.rot,
    text: annot.text,
    size: annot.size,
    font: annot.font,
    color: annot.color,
    lh: lineHeight(annot),
    hideId: annot.id,
    onCommit: (text) => {
      const page = getPage(pageId);
      const cur = page?.annots.find((a) => a.id === annot.id);
      if (!cur) return;
      pushUndo();
      if (text) cur.text = text;
      else page.annots = page.annots.filter((a) => a !== cur);
      drawOverlay(page);
    },
  });
}

// ---------------------------------------------------------------------------
// Editing text that is part of the PDF itself
// ---------------------------------------------------------------------------

const analysisCache = new Map(); // "src:index" -> Promise<analysis>
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

function pageAnalysis(page) {
  const key = `${page.src}:${page.index}`;
  if (!analysisCache.has(key)) {
    analysisCache.set(
      key,
      libDoc(page.src).then((doc) => analyzePage(doc, doc.getPage(page.index).node)),
    );
  }
  return analysisCache.get(key);
}

function setBusy(msg) {
  state.busy = !!msg;
  document.body.classList.toggle('busy', !!msg);
  hint(msg || null);
}

async function editExistingText(page, lines) {
  // Top to bottom, in the text's own orientation.
  const n0 = lines[0].normal;
  lines = [...lines].sort((p, q) => dot(q.origin, n0) - dot(p.origin, n0));

  let style = null;
  let font = null;
  setBusy(t('busy.reading'));
  try {
    style = styleOf((await pageAnalysis(page)).glyphs, lines);
    font = await originalFont(style);
  } catch (err) {
    console.error(err);
  } finally {
    setBusy(null);
  }
  if (!style) {
    toast(t('edit.readFailed'));
    return;
  }

  const v = views.get(page.id);
  if (style.invisible || !style.found) style.color = sampleInk(v, lines[0]);
  style.size = Math.round(style.size * 100) / 100;
  const snapped = Math.round(style.rot / 90) * 90;
  if (Math.abs(style.rot - snapped) < 0.05) style.rot = ((snapped % 360) + 360) % 360;
  if (!font) {
    font = matchStandardFont(style);
    explainFallback(style, font);
  }
  let lh = LINE_HEIGHT;
  if (lines.length > 1) {
    const spacing = Math.abs(dot(sub(lines[0].origin, lines[lines.length - 1].origin), n0)) / (lines.length - 1);
    lh = Math.round((spacing / style.size) * 1000) / 1000 || LINE_HEIGHT;
  }

  openEditor({
    pageId: page.id,
    anchor: style.origin,
    rot: style.rot,
    text: lines.map((L) => L.text).join('\n'),
    size: style.size,
    font,
    color: style.color,
    lh,
    cover: lines.map(lineQuad),
    coverFill: sampleBackground(v, lineQuad(lines[0])),
    onCommit: (text) => replaceText(page.id, lines, { ...style, font, lh }, text),
  });
}

// Remove the original glyphs from the page's content stream and put the new
// text in their place. The rewritten page becomes its own one-page source, so
// undo simply points the page back at the previous source.
async function replaceText(pageId, lines, style, newText) {
  const page = getPage(pageId);
  if (!page || page.src < 0) return;
  const before = snapshot();
  const cover = lines.map(lineQuad);
  setBusy(t('busy.text'));
  state.editing = { pageId, cover, coverFill: sampleBackground(views.get(pageId), cover[0]) };
  try {
    const targets = await removeFromPage(page, (g) => lines.some((L) => glyphInLine(g, L)));
    const visible = targets.some((g) => g.tr !== 3 && g.tr !== 7);
    const v = views.get(pageId);
    if (!visible) {
      // Text drawn as part of an image (e.g. a scanned page with an OCR layer):
      // paint over it with the surrounding background colour instead.
      for (const q of cover) {
        const xs = q.map((p) => p[0]);
        const ys = q.map((p) => p[1]);
        page.annots.push({
          id: uid(), type: 'rect', variant: 'whiteout',
          x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys),
          fill: sampleBackground(v, q), color: '#ffffff', width: 1,
        });
      }
    }
    if (newText) {
      page.annots.push({
        id: uid(), type: 'text',
        x: style.origin[0], y: style.origin[1], rot: style.rot,
        text: newText, size: style.size, font: style.font, color: style.color,
        ...(style.lh !== LINE_HEIGHT && { lh: style.lh }),
      });
    }
    pushUndo(before);
    if (v) renderPageCanvas(pageId, v);
    buildThumbs();
    if (!visible) toast(t('edit.imageText'), 5000);
  } catch (err) {
    console.error(err);
    state.pages = before;
    refreshAll();
    toast(t('edit.failed', { error: err?.message || err }), 6000);
  } finally {
    state.editing = null;
    setBusy(null);
    const p = getPage(pageId);
    if (p) drawOverlay(p);
  }
}

// Rewrite the page without the glyphs matching `predicate`. The result becomes
// a new one-page source; returns the removed glyphs.
async function removeFromPage(page, predicate) {
  const doc = await PDFDocument.create();
  const [copy] = await doc.copyPages(await libDoc(page.src), [page.index]);
  doc.addPage(copy);
  const analysis = analyzePage(doc, copy.node);
  const targets = analysis.glyphs.filter(predicate);
  if (targets.length) {
    removeGlyphs(doc, copy.node, analysis, targets);
    page.src = await addSource(await doc.save());
    page.index = 0;
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Checkboxes
// ---------------------------------------------------------------------------

const CHECK_STATES = [
  ['empty', 'check.empty'],
  ['check', 'check.check'],
  ['cross', 'check.cross'],
];
let picker = null;

function closePicker() {
  picker?.remove();
  picker = null;
}

document.addEventListener('pointerdown', (e) => {
  if (picker && !picker.contains(e.target)) closePicker();
}, true);

// target: { box } (a checkbox character of the PDF) or { annot } (a mark we drew)
function openCheckPicker(page, target) {
  closeEditor(true);
  closePicker();
  const v = views.get(page.id);
  if (!v) return;
  const pts = (target.annot ? outline(target.annot) : lineQuad(target.box)).map((p) => apply(v.vp.transform, p));
  const current = target.annot ? target.annot.kind || 'empty' : target.box.state;

  picker = document.createElement('div');
  picker.className = 'check-picker';
  picker.style.left = `${Math.min(...pts.map((p) => p[0]))}px`;
  picker.style.top = `${Math.max(...pts.map((p) => p[1])) + 6}px`;
  for (const [st, label] of CHECK_STATES) {
    const b = document.createElement('button');
    b.textContent = t(label);
    b.dataset.state = st;
    b.classList.toggle('active', st === current);
    b.addEventListener('click', () => {
      closePicker();
      setCheckbox(page.id, target, st);
    });
    picker.append(b);
  }
  v.wrap.append(picker);
}

async function setCheckbox(pageId, target, wanted) {
  const page = getPage(pageId);
  if (!page) return;

  if (target.annot) {
    const a = page.annots.find((x) => x.id === target.annot.id);
    if (!a || (a.kind || 'empty') === wanted) return;
    pushUndo();
    if (wanted === 'empty' && !a.box) page.annots = page.annots.filter((x) => x !== a);
    else a.kind = wanted === 'empty' ? null : wanted;
    drawOverlay(page);
    return;
  }

  const box = target.box;
  if (box.state === wanted) return;
  const v = views.get(pageId);
  const s = box.size;
  let [a1, p1, a2, p2] = measureInk(v, box) || [0.08 * s, 0, 0.7 * s, 0.62 * s];
  const m = Math.min(a2 - a1, p2 - p1);
  const width = Math.max(0.5, m * 0.12);
  const boxWidth = Math.max(0.4, m * 0.07);
  if (box.boxed && box.state !== 'empty') {
    // We redraw the box: keep its outline inside the measured ink.
    a1 += boxWidth / 2; p1 += boxWidth / 2; a2 -= boxWidth / 2; p2 -= boxWidth / 2;
  }
  let rotDeg = (Math.atan2(box.dir[1], box.dir[0]) * 180) / Math.PI;
  if (Math.abs(rotDeg - Math.round(rotDeg / 90) * 90) < 0.05) rotDeg = Math.round(rotDeg / 90) * 90;
  const [x, y] = add(box.origin, add(box.dir.map((c) => c * a1), box.normal.map((c) => c * p1)));
  const mark = { id: uid(), type: 'mark', x, y, w: a2 - a1, h: p2 - p1, rot: rotDeg, color: box.color || '#000000', width, boxWidth };

  if (box.state === 'empty') {
    // Keep the original empty box and draw the mark inside it.
    pushUndo();
    page.annots.push({ ...mark, kind: wanted, box: false });
    drawOverlay(page);
    return;
  }

  // The PDF has a check or cross: take it out, then draw what was asked for.
  const before = snapshot();
  setBusy(t('busy.checkbox'));
  try {
    await removeFromPage(page, (g) => isCheckboxGlyph(g, box));
    if (wanted !== 'empty' || box.boxed) page.annots.push({ ...mark, kind: wanted === 'empty' ? null : wanted, box: box.boxed });
    pushUndo(before);
    if (v) renderPageCanvas(pageId, v);
    buildThumbs();
  } catch (err) {
    console.error(err);
    state.pages = before;
    refreshAll();
    toast(t('checkbox.failed', { error: err?.message || err }), 6000);
  } finally {
    setBusy(null);
    const p = getPage(pageId);
    if (p) drawOverlay(p);
  }
}

// Bounds of the dark pixels of a checkbox glyph, in its own frame
// ([along1, perp1, along2, perp2] relative to the glyph origin).
function measureInk(v, box) {
  if (!v) return null;
  try {
    const s = box.size;
    const at = (al, pp) => add(box.origin, add(box.dir.map((c) => c * al), box.normal.map((c) => c * pp)));
    const quad = [at(-0.05 * s, -0.35 * s), at(box.end + 0.05 * s, -0.35 * s), at(box.end + 0.05 * s, 1.05 * s), at(-0.05 * s, 1.05 * s)];
    const dev = deviceBox(v, quad, 1);
    if (!dev) return null;
    const data = opaquePixels(v, dev);
    const d = dpr();
    let [minA, minP, maxA, maxP] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let yy = 0; yy < dev.h; yy++) {
      for (let xx = 0; xx < dev.w; xx++) {
        const i = (yy * dev.w + xx) * 4;
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > 170) continue;
        const pt = apply(v.vp.inverse, [(dev.x + xx + 0.5) / d, (dev.y + yy + 0.5) / d]);
        const rel = sub(pt, box.origin);
        const al = dot(rel, box.dir);
        const pp = dot(rel, box.normal);
        if (al < -0.05 * s || al > box.end + 0.05 * s || pp < -0.35 * s || pp > 1.05 * s) continue;
        minA = Math.min(minA, al); maxA = Math.max(maxA, al);
        minP = Math.min(minP, pp); maxP = Math.max(maxP, pp);
      }
    }
    if (!(maxA - minA > 0.15 * s && maxP - minP > 0.15 * s)) return null;
    const half = 0.5 / (state.zoom * d); // pixel centres -> pixel edges
    return [minA - half, minP - half, maxA + half, maxP + half];
  } catch {
    return null;
  }
}

function deviceBox(v, quad, pad = 0) {
  const pts = quad.map((p) => apply(v.vp.transform, p).map((c) => c * dpr()));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const w = Math.min(v.canvas.width - x, Math.ceil(Math.max(...xs) + pad) - x);
  const h = Math.min(v.canvas.height - y, Math.ceil(Math.max(...ys) + pad) - y);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// Canvas pixels are transparent where the page is blank; composite them over white.
function opaquePixels(v, box) {
  const { data } = v.canvas.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] * a + 255 * (1 - a));
  }
  return data;
}

const rgbHex = (r, g, b) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');

// Median colour of a thin ring just outside the quad.
function sampleBackground(v, quad) {
  try {
    const box = v && deviceBox(v, quad, 3);
    if (!box) return '#ffffff';
    const data = opaquePixels(v, box);
    const ch = [[], [], []];
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        if (x > 1 && x < box.w - 2 && y > 1 && y < box.h - 2) continue;
        const i = (y * box.w + x) * 4;
        ch[0].push(data[i]);
        ch[1].push(data[i + 1]);
        ch[2].push(data[i + 2]);
      }
    }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255;
    return rgbHex(med(ch[0]), med(ch[1]), med(ch[2]));
  } catch {
    return '#ffffff';
  }
}

// Darkest pixel inside a line: a good guess for the colour of text in an image.
function sampleInk(v, line) {
  try {
    const box = v && deviceBox(v, lineQuad(line));
    if (!box) return '#000000';
    const data = opaquePixels(v, box);
    let best = [0, 0, 0];
    let bestLum = Infinity;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < bestLum) {
        bestLum = lum;
        best = [data[i], data[i + 1], data[i + 2]];
      }
    }
    return rgbHex(...best);
  } catch {
    return '#000000';
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function loadImageFile(file) {
  let blob = file;
  let type = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : null;
  const el = await blobToImage(file);
  if (!type) {
    // Convert anything else (webp, gif, svg, …) to PNG so pdf-lib can embed it.
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    c.getContext('2d').drawImage(el, 0, 0);
    blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    type = 'png';
  }
  const id = uid();
  state.images.set(id, { bytes: new Uint8Array(await blob.arrayBuffer()), type, el });
  return id;
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

async function beginImagePlacement(file) {
  try {
    state.pendingImage = await loadImageFile(file);
    setTool('image');
    hint(null);
  } catch {
    toast(t('image.failed'));
  }
}

function placeImage(page, pt) {
  const img = state.images.get(state.pendingImage);
  if (!img) return;
  const base = makeViewport(page.view, 1, page.rotation);
  const w = Math.min(200, base.width * 0.5, img.el.naturalWidth);
  const h = (w * img.el.naturalHeight) / img.el.naturalWidth;
  const r = page.rotation;
  const [x, y] = add(pt, rot([0, -h], r));
  pushUndo();
  const annot = { id: uid(), type: 'image', imageId: state.pendingImage, x, y, w, h, rot: r };
  page.annots.push(annot);
  state.pendingImage = null;
  setTool('select');
  select({ pageId: page.id, annotId: annot.id });
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

let formNoticeShown = false;

// A field's value as stored in the PDF, in the form the editor keeps values.
function originalFieldValue(a) {
  if (a.fieldType === 'Tx') return a.fieldValue ?? '';
  if (a.checkBox) return !!a.fieldValue && a.fieldValue !== 'Off';
  if (a.radioButton) return a.fieldValue && a.fieldValue !== 'Off' ? a.fieldValue : null;
  const list = Array.isArray(a.fieldValue) ? a.fieldValue : a.fieldValue ? [a.fieldValue] : [];
  return a.combo ? list[0] ?? '' : list;
}

const currentFieldValue = (page, el) =>
  page.fields && Object.hasOwn(page.fields, el.dataset.field) ? page.fields[el.dataset.field] : el._original;

// Fillable fields of a page, as real inputs laid over it.
async function buildFormLayer(pageId, v) {
  const page = getPage(pageId);
  const key = page && page.src >= 0 ? `${page.src}:${page.index}` : '';
  if (v.formKey === key) return;
  v.formKey = key;
  v.formLayer.replaceChildren();
  if (!key) return;
  let annots;
  try {
    annots = await (await getPdfPage(page)).getAnnotations({ intent: 'display' });
  } catch (err) {
    console.error(err);
    return;
  }
  if (v.formKey !== key) return;
  const widgets = annots.filter(
    // Read-only fields are left to the page itself, which already draws them.
    (a) => a.annotationType === pdfjsLib.AnnotationType.WIDGET && a.fieldName && !a.hidden && !a.readOnly && !a.pushButton && ['Tx', 'Btn', 'Ch'].includes(a.fieldType),
  );
  for (const a of widgets) v.formLayer.append(fieldElement(pageId, a, v));
  syncFormLayer(getPage(pageId));
  if (widgets.length && !formNoticeShown) {
    formNoticeShown = true;
    toast(t('forms.found'), 5000);
  }
}

function fieldElement(pageId, a, v) {
  const [p1, p2] = [[a.rect[0], a.rect[1]], [a.rect[2], a.rect[3]]].map((p) => apply(v.vp.transform, p));
  const pdfHeight = Math.abs(a.rect[3] - a.rect[1]);
  const da = a.defaultAppearanceData || {};
  const color = da.fontColor ? `rgb(${[...da.fontColor].join(',')})` : '#000';
  // Field font size: the PDF's own when it is sensible, else one that fits.
  const textSize = (multiLine) => {
    const own = da.fontSize || 0;
    return multiLine ? Math.min(own || 11, 12) : Math.min(own || 99, pdfHeight * 0.7, 14);
  };
  let el;
  let kind;
  const commit = (value) => setFieldValue(pageId, a.fieldName, value);

  if (a.fieldType === 'Tx') {
    kind = 'text';
    el = document.createElement(a.multiLine ? 'textarea' : 'input');
    if (!a.multiLine) el.type = 'text';
    if (a.maxLen) el.maxLength = a.maxLen;
    el.spellcheck = false;
    el.style.font = `${textSize(a.multiLine) * state.zoom}px Helvetica, Arial, sans-serif`;
    el.style.textAlign = ['left', 'center', 'right'][a.textAlignment] || 'left';
    el.style.color = color;
    el.addEventListener('change', () => commit(el.value));
  } else if (a.checkBox || a.radioButton) {
    kind = a.checkBox ? 'check' : 'radio';
    el = document.createElement('input');
    el.type = a.checkBox ? 'checkbox' : 'radio';
    if (a.radioButton) {
      el.name = `radio-${pageId}-${a.fieldName}`;
      el._radioValue = a.buttonValue;
    }
    el.addEventListener('change', () => commit(a.checkBox ? el.checked : el.checked ? a.buttonValue : null));
  } else {
    kind = a.combo ? 'choice' : 'list';
    el = document.createElement('select');
    if (a.combo) el.append(new Option('', ''));
    else {
      el.multiple = !!a.multiSelect;
      el.size = Math.max(2, (a.options || []).length);
    }
    for (const o of a.options || []) el.append(new Option(o.displayValue ?? o.exportValue, o.exportValue));
    el.style.font = `${textSize(false) * state.zoom}px Helvetica, Arial, sans-serif`;
    el.style.color = color;
    el.addEventListener('change', () => commit(a.combo ? el.value : [...el.selectedOptions].map((o) => o.value)));
  }

  el.className = `form-field form-${kind}`;
  el.dataset.field = a.fieldName;
  el.dataset.kind = kind;
  el._original = originalFieldValue(a);
  el.disabled = !!a.readOnly;
  el.title = a.alternativeText || a.fieldName;
  Object.assign(el.style, {
    left: `${Math.min(p1[0], p2[0])}px`,
    top: `${Math.min(p1[1], p2[1])}px`,
    width: `${Math.abs(p2[0] - p1[0])}px`,
    height: `${Math.abs(p2[1] - p1[1])}px`,
  });
  el.style.setProperty('--h', `${Math.abs(p2[1] - p1[1])}px`);
  return el;
}

// Show each field's current value (after undo, redo or a change on another page).
function syncFormLayer(page) {
  const v = page && views.get(page.id);
  if (!v?.formLayer) return;
  for (const el of v.formLayer.children) {
    const value = currentFieldValue(page, el);
    switch (el.dataset.kind) {
      case 'text':
        if (el !== document.activeElement && el.value !== value) el.value = value ?? '';
        break;
      case 'check':
        el.checked = !!value;
        break;
      case 'radio':
        el.checked = value === el._radioValue;
        break;
      case 'choice':
        el.value = value ?? '';
        break;
      case 'list':
        for (const o of el.options) o.selected = (value || []).includes(o.value);
        break;
    }
  }
}

// A field with the same name is the same field on every page of its document.
function setFieldValue(pageId, name, value) {
  const page = getPage(pageId);
  if (!page) return;
  pushUndo();
  const origin = page.origin ?? page.src;
  for (const p of state.pages) {
    if ((p.origin ?? p.src) !== origin) continue;
    p.fields = { ...p.fields, [name]: value };
    syncFormLayer(p);
  }
}

// ---------------------------------------------------------------------------
// Fonts from this computer
// ---------------------------------------------------------------------------

const STANDARD_14 = /^(Helvetica|Times-(Roman|Bold|Italic|BoldItalic)|Courier|Symbol|ZapfDingbats)/;
const fontByPdfName = new Map(); // normalized PDF font name -> custom font key, or null if not installed
let localFontList = null; // Promise<FontData[]>
let localFontsBlocked = false;
const notified = new Set();
let measureDoc = null;

const canUseLocalFonts = () => 'queryLocalFonts' in window;

function notifyOnce(id, msg) {
  if (notified.has(id)) return;
  notified.add(id);
  toast(msg, 6500);
}

// The browser asks for permission the first time.
function getLocalFonts() {
  localFontList ??= window.queryLocalFonts().catch((err) => {
    localFontList = null;
    throw err;
  });
  return localFontList;
}

async function addCustomFont(bytes, postscriptName) {
  const f = readFontFile(bytes, postscriptName);
  for (const [key, existing] of customFonts) if (existing.postscriptName === f.postscriptName) return key;

  const key = `font:${uid()}`;
  const cssFamily = `pdfe-font-${key.slice(5)}`;
  const face = new FontFace(cssFamily, f.bytes);
  await face.load();
  document.fonts.add(face);
  if (!measureDoc) {
    measureDoc = await PDFDocument.create();
    measureDoc.registerFontkit(fontkit);
  }
  metricFonts[key] = await measureDoc.embedFont(f.bytes, { subset: true, features: FONT_FEATURES() });
  customFonts.set(key, { ...f, cssFamily });

  const group = $('font-group-local');
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = f.name;
  group.append(opt);
  group.hidden = false;
  return key;
}

// The installed font matching the one the text was set in, or null.
async function originalFont(style) {
  const pdfName = pdfFontName(style.baseFont);
  const id = normalizeFontName(pdfName);
  if (!id || STANDARD_14.test(pdfName)) return null;
  if (fontByPdfName.has(id)) return fontByPdfName.get(id);

  const loaded = findLocalMatch(
    [...customFonts].map(([key, f]) => ({ key, postscriptName: f.postscriptName, fullName: f.name, family: f.family, style: '' })),
    style,
  );
  if (loaded && normalizeFontName(loaded.postscriptName) === id) {
    fontByPdfName.set(id, loaded.key);
    return loaded.key;
  }
  if (!canUseLocalFonts() || localFontsBlocked) return null;

  let list;
  try {
    list = await getLocalFonts();
  } catch (err) {
    console.warn(err);
    localFontsBlocked = true;
    return null;
  }
  const match = findLocalMatch(list, style);
  let key = null;
  if (match) {
    try {
      key = await addCustomFont(new Uint8Array(await (await match.blob()).arrayBuffer()), match.postscriptName);
    } catch (err) {
      console.error(err);
    }
  }
  fontByPdfName.set(id, key);
  return key;
}

// Tell the user (once per font) why a standard font is used instead.
function explainFallback(style, fallback) {
  const pdfName = pdfFontName(style.baseFont);
  if (!pdfName || STANDARD_14.test(pdfName)) return;
  const shown = pdfName.replace(/[-,]/g, ' ').replace(/(PSMT|MT|PS)$/, '').trim();
  const instead = $('in-font').querySelector(`option[value="${fallback}"]`)?.textContent || fallback;
  if (!canUseLocalFonts()) {
    notifyOnce('no-api', t('font.noApi', { shown, instead }));
  } else if (localFontsBlocked) {
    notifyOnce('blocked', t('font.blocked', { shown, instead }));
  } else {
    notifyOnce(`missing:${normalizeFontName(pdfName)}`, t('font.missing', { shown, instead }));
  }
}

async function openFontDialog() {
  if (!canUseLocalFonts()) {
    toast(t('fontList.noApi'), 6000);
    return;
  }
  let list;
  try {
    list = await getLocalFonts();
  } catch {
    localFontsBlocked = true;
    toast(t('fontList.blocked'), 6000);
    return;
  }
  const fonts = [...new Map(list.map((f) => [f.postscriptName, f])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const dialog = $('font-dialog');
  const search = $('font-search');
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = fonts.filter((f) => !q || f.fullName.toLowerCase().includes(q)).slice(0, 300);
    const listEl = $('font-list');
    listEl.replaceChildren();
    for (const f of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f.fullName;
      b.addEventListener('click', async () => {
        dialog.close();
        try {
          chooseFont(await addCustomFont(new Uint8Array(await (await f.blob()).arrayBuffer()), f.postscriptName));
        } catch (err) {
          console.error(err);
          toast(t('font.unusable', { name: f.fullName }), 5000);
        }
      });
      listEl.append(b);
    }
    if (!shown.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = t('fontDialog.none');
      listEl.append(note);
    }
  };
  search.value = '';
  search.oninput = render;
  render();
  dialog.showModal();
  search.focus();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function exportPdf() {
  closeEditor(true);
  if (document.activeElement?.classList?.contains('form-field')) document.activeElement.blur(); // commits the value being typed
  const out = await PDFDocument.create();
  const fonts = {};
  const images = new Map();
  let replacedChars = false;

  out.registerFontkit(fontkit);
  const font = async (name) => {
    if (!fonts[name]) {
      const custom = customFonts.get(name);
      fonts[name] = custom
        ? await out.embedFont(custom.bytes, { subset: custom.subset, features: FONT_FEATURES() })
        : await out.embedFont((FONTS[name] || FONTS.Helvetica).std);
    }
    return fonts[name];
  };
  const image = async (id) => {
    if (!images.has(id)) {
      const img = state.images.get(id);
      images.set(id, img.type === 'png' ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes));
    }
    return images.get(id);
  };

  // Copy each source's pages in one call, so what its pages share (fonts,
  // form fields) is copied once; a page used twice gets its own extra copy.
  const copies = new Map();
  const wanted = new Map();
  for (const page of state.pages) {
    if (page.src < 0) continue;
    if (!wanted.has(page.src)) wanted.set(page.src, []);
    wanted.get(page.src).push(page.index);
  }
  for (const [src, indices] of wanted) {
    const doc = await libDoc(src);
    const unique = [...new Set(indices)];
    const copied = await out.copyPages(doc, unique);
    unique.forEach((index, i) => copies.set(`${src}:${index}`, [copied[i]]));
    for (const index of unique) {
      for (let extra = indices.filter((x) => x === index).length - 1; extra > 0; extra--) {
        copies.get(`${src}:${index}`).push((await out.copyPages(doc, [index]))[0]);
      }
    }
  }

  for (const page of state.pages) {
    let p;
    if (page.src < 0) {
      const [x1, y1, x2, y2] = page.view;
      p = out.addPage([x2 - x1, y2 - y1]);
    } else {
      p = copies.get(`${page.src}:${page.index}`).shift();
      out.addPage(p);
    }
    p.setRotation(degrees(page.rotation));

    for (const a of page.annots) {
      switch (a.type) {
        case 'rect': {
          const x = Math.min(a.x1, a.x2);
          const y = Math.min(a.y1, a.y2);
          const width = Math.abs(a.x2 - a.x1);
          const height = Math.abs(a.y2 - a.y1);
          if (a.variant === 'highlight') p.drawRectangle({ x, y, width, height, color: hexToRgb(a.color), opacity: HIGHLIGHT_OPACITY });
          else if (a.variant === 'whiteout') p.drawRectangle({ x, y, width, height, color: a.fill ? hexToRgb(a.fill) : rgb(1, 1, 1) });
          else p.drawRectangle({ x, y, width, height, borderColor: hexToRgb(a.color), borderWidth: a.width });
          break;
        }
        case 'ink': {
          const pts = a.points.length === 1 ? [a.points[0], a.points[0]] : a.points;
          for (let i = 1; i < pts.length; i++) {
            p.drawLine({
              start: { x: pts[i - 1][0], y: pts[i - 1][1] },
              end: { x: pts[i][0], y: pts[i][1] },
              thickness: a.width,
              color: hexToRgb(a.color),
              lineCap: LineCapStyle.Round,
            });
          }
          break;
        }
        case 'text': {
          const f = await font(a.font);
          const text = sanitize(f, a.text);
          if (text !== a.text) replacedChars = true;
          p.drawText(text, {
            x: a.x, y: a.y, size: a.size, font: f,
            color: hexToRgb(a.color),
            rotate: degrees(a.rot),
            lineHeight: a.size * lineHeight(a),
          });
          break;
        }
        case 'mark':
          for (const [s1, s2, w] of markSegments(a)) {
            p.drawLine({
              start: { x: s1[0], y: s1[1] },
              end: { x: s2[0], y: s2[1] },
              thickness: w,
              color: hexToRgb(a.color),
              lineCap: LineCapStyle.Round,
            });
          }
          break;
        case 'image':
          p.drawImage(await image(a.imageId), { x: a.x, y: a.y, width: a.w, height: a.h, rotate: degrees(a.rot) });
          break;
      }
    }
  }
  if (replacedChars) toast(t('chars.replaced'), 5000);

  // Form fields: list them in the new document and write the values typed in the editor.
  const formDocs = [];
  for (const i of new Set(state.pages.flatMap((p) => (p.src < 0 ? [] : [p.origin ?? p.src, p.src])))) formDocs.push(await libDoc(i));
  if (rebuildForm(out, formDocs)) {
    const values = new Map();
    for (const p of state.pages) for (const [name, value] of Object.entries(p.fields || {})) values.set(name, value);
    const failed = fillForm(out, values, await out.embedFont(StandardFonts.Helvetica));
    if (failed.length) toast(t('forms.failed', { names: failed.join(', ') }), 6000);
  }
  return out.save({ updateFieldAppearances: false });
}

async function save() {
  if (!state.pages.length) return;
  const btn = $('btn-save');
  btn.disabled = true;
  btn.querySelector('.label').textContent = t('saving');
  try {
    const bytes = await exportPdf();
    const name = state.fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
    const blob = new Blob([bytes], { type: 'application/pdf' });

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        state.dirty = false;
        toast(t('saved', { name: handle.name }));
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // Fall through to a plain download if the picker is unavailable here.
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    state.dirty = false;
    toast(t('downloaded', { name }));
  } catch (err) {
    console.error(err);
    toast(t('save.failed', { error: err?.message || err }));
  } finally {
    btn.disabled = false;
    btn.querySelector('.label').textContent = t('save');
    updateButtons();
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function setTool(tool) {
  if (state.busy) return;
  closeEditor(true);
  closePicker();
  const wasEditText = state.tool === 'edittext';
  if (tool !== 'image') state.pendingImage = null;
  state.tool = tool;
  hint(null);
  state.hover = null;
  state.marquee = null;
  document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim();
  document.body.classList.add(`tool-${tool}`);
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  if (tool !== 'select' && state.selected) select(null);
  if (wasEditText !== (tool === 'edittext')) redrawAllOverlays();
  updateProps();
}

function setZoom(z) {
  const anchor = workspace.scrollTop / Math.max(1, workspace.scrollHeight);
  state.zoom = z;
  $('zoom-label').textContent = `${Math.round(z * 100)}%`;
  closeEditor(true);
  buildViewer();
  workspace.scrollTop = anchor * workspace.scrollHeight;
}

function zoomStep(dir) {
  const i = ZOOM_STEPS.findIndex((z) => z >= state.zoom - 1e-6);
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))];
  if (next !== state.zoom) setZoom(next);
}

function updateButtons() {
  const hasDoc = state.pages.length > 0;
  for (const el of document.querySelectorAll('[data-needs-doc]')) {
    if (el.tagName === 'BUTTON') el.disabled = !hasDoc;
    else el.querySelectorAll('button').forEach((b) => (b.disabled = !hasDoc));
  }
  $('btn-undo').disabled = !undoStack.length;
  $('btn-redo').disabled = !redoStack.length;
  $('btn-delete').hidden = !getSelected();
  const name = $('doc-name');
  name.textContent = hasDoc ? state.fileName : '';
  name.title = name.textContent;
  name.classList.toggle('dirty', hasDoc && state.dirty);
  name.dataset.unsaved = t('unsaved');
  updateProps();
}

// Only show the settings that apply to the current tool or selection.
function updateProps() {
  const a = getSelected()?.annot;
  const kind = state.tool === 'select' ? (a ? (a.type === 'rect' ? a.variant : a.type) : null) : state.tool;
  const show = {
    color: ['text', 'draw', 'highlight', 'rect', 'ink', 'mark'].includes(kind),
    font: kind === 'text',
    size: kind === 'text',
    stroke: ['draw', 'rect', 'ink'].includes(kind),
  };
  for (const [k, v] of Object.entries(show)) $(`prop-${k}`).hidden = !v;
  $('props').hidden = !Object.values(show).some(Boolean);
}

function setSwatch(color) {
  $('prop-color').style.setProperty('--swatch', color);
}

// --- theme ---------------------------------------------------------------------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';

$('btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('pdf-editor-theme', next);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
});

// Apply a style control change to the selected annotation, if any.
function applyStyle(prop, value) {
  const a = getSelected()?.annot;
  if (!a) return;
  const applies =
    (prop === 'color' && a.type !== 'image' && a.variant !== 'whiteout') ||
    ((prop === 'size' || prop === 'font') && a.type === 'text') ||
    (prop === 'width' && (a.type === 'ink' || a.variant === 'rect'));
  if (!applies || a[prop] === value) return;
  pushUndo();
  getSelected().annot[prop] = value;
  drawOverlay(getSelected().page);
}

$('in-color').addEventListener('input', (e) => {
  state.color = e.target.value;
  setSwatch(state.color);
});
$('in-color').addEventListener('change', (e) => applyStyle('color', e.target.value));
let lastFont = state.font;
$('in-font').addEventListener('change', (e) => {
  const value = e.target.value;
  if (value.startsWith('__')) {
    e.target.value = lastFont; // these entries are actions, not fonts
    if (value === '__file__') $('file-font').click();
    else openFontDialog();
    return;
  }
  chooseFont(value);
});

function chooseFont(key) {
  state.font = lastFont = key;
  $('in-font').value = key;
  applyStyle('font', key);
}

$('file-font').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    chooseFont(await addCustomFont(new Uint8Array(await f.arrayBuffer())));
  } catch (err) {
    console.error(err);
    toast(t('fontFile.invalid', { name: f.name }), 5000);
  }
});
$('in-size').addEventListener('change', (e) => {
  state.size = Math.max(4, Math.min(144, Number(e.target.value) || 14));
  e.target.value = state.size;
  applyStyle('size', state.size);
});
$('in-stroke').addEventListener('change', (e) => {
  state.stroke = Math.max(0.5, Math.min(40, Number(e.target.value) || 2));
  e.target.value = state.stroke;
  applyStyle('width', state.stroke);
});

for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

$('btn-open').addEventListener('click', () => $('file-open').click());
$('btn-open-2').addEventListener('click', () => $('file-open').click());
$('btn-new').addEventListener('click', newBlankDoc);
$('btn-insert').addEventListener('click', () => $('file-insert').click());
$('btn-blank').addEventListener('click', insertBlankPage);
$('btn-image').addEventListener('click', () => $('file-image').click());
$('btn-save').addEventListener('click', save);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-delete').addEventListener('click', deleteSelected);
$('btn-zoom-in').addEventListener('click', () => zoomStep(1));
$('btn-zoom-out').addEventListener('click', () => zoomStep(-1));

$('file-open').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openFile(f);
});
$('file-insert').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) insertFiles(files);
});
$('file-image').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) beginImagePlacement(f);
});

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (state.busy) return;
  if (mod && key === 'o') { e.preventDefault(); $('file-open').click(); return; }
  if (!state.pages.length) return;
  if (mod && key === 's') { e.preventDefault(); save(); return; }
  if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomStep(1); return; }
  if (mod && key === '-') { e.preventDefault(); zoomStep(-1); return; }
  if (mod) return;

  if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelected(); return; }
  if (key === 'escape' && picker) { closePicker(); return; }
  if (key === 'escape') { select(null); setTool('select'); return; }
  const tools = { v: 'select', e: 'edittext', t: 'text', d: 'draw', h: 'highlight', w: 'whiteout', r: 'rect' };
  if (tools[key]) setTool(tools[key]);
  else if (key === 'i') $('file-image').click();
});

// Drag & drop: PDFs open (or append, if a document is already open); images get placed.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (dragFrom != null || !e.dataTransfer.types.includes('Files')) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (dragDepth && --dragDepth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files];
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const img = files.find((f) => f.type.startsWith('image/'));
  if (pdfs.length) {
    if (state.pages.length) insertFiles(pdfs);
    else openFile(pdfs[0]).then(() => pdfs.length > 1 && insertFiles(pdfs.slice(1)));
  } else if (img && state.pages.length) {
    beginImagePlacement(img);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

let resizeTimer;
window.matchMedia(`(resolution: ${dpr()}dppx)`).addEventListener?.('change', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.pages.length && buildViewer(), 200);
});

// ---------------------------------------------------------------------------
// Site: language, support link, footer, legal notice
// ---------------------------------------------------------------------------

function setupSite() {
  translatePage();
  workspace.dataset.dropOpen = t('drop.open');
  workspace.dataset.dropAdd = t('drop.add');
  $('btn-lang').textContent = lang === 'fr' ? 'EN' : 'FR';
  for (const id of ['btn-support', 'link-support']) $(id).href = SITE.supportUrl;
  if (SITE.sourceUrl) {
    $('link-source').href = SITE.sourceUrl;
    $('link-source').hidden = false;
  }
  // Version, so a downloaded copy can be compared with the site.
  // Both constants come from vite.config.js; without them the line is just left out.
  if (typeof __APP_VERSION__ !== 'undefined' && typeof __BUILD_DATE__ !== 'undefined') {
    const built = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(__BUILD_DATE__));
    $('app-version').textContent = t('footer.version', { version: __APP_VERSION__, date: built });
  }
  const fromWeb = /^https?:$/.test(location.protocol);
  // A downloaded copy never checks for updates by itself: it only offers a link.
  if (!fromWeb && SITE.siteUrl) {
    $('link-update').href = SITE.siteUrl;
    $('link-update').hidden = false;
  }
  // The site root, also from its French page (/fr/): the file to download and
  // its published fingerprint both live there.
  const siteRoot = new URL(/\/fr\/(index\.html)?$/.test(location.pathname) ? '../' : './', location.href).href;
  $('link-checksum').href = new URL('SHA256SUMS.txt', siteRoot).href;
  $('link-checksum').hidden = !fromWeb || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // Offer the page itself as a file to keep, when it is served from the web.
  if (fromWeb) {
    $('link-download').href = siteRoot;
    $('link-download').download = 'retouchpdf.html';
    $('link-download').hidden = false;
  }
}

$('btn-lang').addEventListener('click', () => {
  setLang(lang === 'fr' ? 'en' : 'fr');
  setupSite();
  hint(null);
  updatePageLabel();
  updateButtons();
  if (state.pages.length) buildThumbs();
});

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function showInfo(kind) {
  const missing = t('legal.missing');
  $('info-title').textContent = t(`${kind}.title`);
  $('info-body').innerHTML = t(`${kind}.body`, {
    publisher: escapeHtml(SITE.publisher || missing),
    contact: SITE.contact ? `<a href="mailto:${escapeHtml(SITE.contact)}">${escapeHtml(SITE.contact)}</a>` : missing,
    source: SITE.sourceUrl ? t('legal.sourceLink', { url: escapeHtml(SITE.sourceUrl) }) : '',
  });
  $('info-dialog').showModal();
}

$('link-legal').addEventListener('click', (e) => {
  e.preventDefault();
  showInfo('legal');
});
$('link-privacy').addEventListener('click', (e) => {
  e.preventDefault();
  showInfo('privacy');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  const scratch = await PDFDocument.create();
  for (const [name, f] of Object.entries(FONTS)) metricFonts[name] = await scratch.embedFont(f.std);
  setSwatch(state.color);
  setupSite();
  setTool('select');
  updateButtons();
  window.__pdfEditor = { state, exportPdf }; // handy for debugging in devtools
})();
