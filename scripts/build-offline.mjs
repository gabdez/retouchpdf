// Builds "RetouchPDF.html": the whole app in one self-contained file that can
// be opened straight from disk, without a server or an internet connection.
//
// The file carries a Content-Security-Policy that forbids the page from
// making any network request at all (no fetch/XHR/WebSocket, no external
// scripts, styles, images or fonts, no form submissions). The browser enforces
// it, so documents opened in the editor cannot leave the computer.

import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prerender, llmsTxt } from './prerender.mjs';
import { STRINGS } from '../src/i18n.js';
import { SITE } from '../src/site.js';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist-offline');
const target = path.join(root, 'RetouchPDF.html');

await build({
  root,
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: Infinity,
  },
});

let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const read = (ref) => fs.readFileSync(path.join(outDir, ref.replace(/^\.\//, '')), 'utf8');

// Inline the stylesheet(s).
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);

// Inline the script(s). "</script" inside the code would end the tag early.
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${code}\n</script>`;
});

if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('Some assets were not inlined');

const csp = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src blob: data:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');
html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);

fs.rmSync(outDir, { recursive: true, force: true });

// Text written into the page (English, French under /fr/), for search
// engines and AI assistants that read the HTML without running it.
const en = prerender(html, 'en', STRINGS, SITE);
const fr = prerender(html, 'fr', STRINGS, SITE);

fs.writeFileSync(target, en);
console.log(`Wrote ${path.relative(root, target)} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);

// The published site: what the GitHub Pages workflow uploads.
const site = path.join(root, '_site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'fr'), { recursive: true });
fs.writeFileSync(path.join(site, 'index.html'), en);
fs.writeFileSync(path.join(site, 'fr', 'index.html'), fr);
for (const img of ['logo.png', 'ko-fi-cover.png']) fs.copyFileSync(path.join(root, 'branding', img), path.join(site, img));
// Browsers ask for /favicon.ico on their own; answer instead of a 404 (a PNG
// under that name is accepted by every current browser).
fs.copyFileSync(path.join(root, 'branding', 'logo.png'), path.join(site, 'favicon.ico'));
// The "Download" link saves the English page as retouchpdf.html.
const sha = crypto.createHash('sha256').update(en).digest('hex');
fs.writeFileSync(path.join(site, 'SHA256SUMS.txt'), `${sha}  retouchpdf.html\n`);
fs.writeFileSync(path.join(site, 'llms.txt'), llmsTxt(STRINGS, SITE));
fs.writeFileSync(
  path.join(site, 'robots.txt'),
  `User-agent: *\nAllow: /\n${SITE.siteUrl ? `\nSitemap: ${new URL('sitemap.xml', SITE.siteUrl).href}\n` : ''}`,
);
if (SITE.siteUrl) {
  const urls = [SITE.siteUrl, new URL('fr/', SITE.siteUrl).href];
  fs.writeFileSync(
    path.join(site, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
}
console.log(`Wrote _site/ (${fs.readdirSync(site).join(', ')})`);
