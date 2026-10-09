// Writes the interface text into the built HTML, so that search engines and
// AI assistants that don't run JavaScript still see what the page says.
// The app translates the same elements again at runtime (data-i18n…).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setAttr(tag, name, value) {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const attr = ` ${name}="${esc(value)}"`;
  return re.test(tag) ? tag.replace(re, attr) : tag.replace(/\s*\/?>$/, (end) => attr + end);
}

// Structured data (schema.org) describing the app and its FAQ.
function structuredData(t, lang, site) {
  const faq = [1, 2, 3, 4, 5, 6].map((n) => ({
    '@type': 'Question',
    name: t(`faq.q${n}`),
    acceptedAnswer: { '@type': 'Answer', text: t(`faq.a${n}`) },
  }));
  const app = {
    '@type': 'SoftwareApplication',
    name: 'RetouchPDF',
    description: t('meta.description'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any (runs in a web browser)',
    inLanguage: lang,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    featureList: [1, 2, 3, 4, 5, 6].map((n) => t(`feature.${n}`)),
  };
  if (site.siteUrl) {
    app.url = lang === 'fr' ? new URL('fr/', site.siteUrl).href : site.siteUrl;
    app.image = new URL('ko-fi-cover.png', site.siteUrl).href;
  }
  if (site.sourceUrl) app.codeRepository = site.sourceUrl;
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': [app, { '@type': 'FAQPage', mainEntity: faq }] });
  return `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`;
}

// Links that need the site's public address: canonical page, language
// versions and the preview shown when the link is shared.
function addressTags(t, lang, site) {
  if (!site.siteUrl) return '';
  const en = site.siteUrl;
  const fr = new URL('fr/', site.siteUrl).href;
  const self = lang === 'fr' ? fr : en;
  const image = new URL('ko-fi-cover.png', site.siteUrl).href;
  return [
    `<link rel="canonical" href="${self}" />`,
    `<link rel="alternate" hreflang="en" href="${en}" />`,
    `<link rel="alternate" hreflang="fr" href="${fr}" />`,
    `<link rel="alternate" hreflang="x-default" href="${en}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${self}" />`,
    `<meta property="og:title" content="${esc(t('meta.title'))}" />`,
    `<meta property="og:description" content="${esc(t('meta.description'))}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_US'}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}

export function prerender(html, lang, strings, site) {
  const dict = { ...strings.en, ...strings[lang] };
  const t = (key) => dict[key] ?? key;

  const bodyAt = html.indexOf('<body');
  let head = html.slice(0, bodyAt);
  let body = html.slice(bodyAt);

  // Text of elements marked data-i18n (they hold plain text only).
  body = body.replace(/(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g, (m, open, tag, key, close) => open + esc(t(key)) + close);
  // Tooltips and accessible names, placeholders, option group labels.
  body = body.replace(/<[^>]*\sdata-i18n-title="([^"]+)"[^>]*>/g, (tag, key) => {
    let out = setAttr(tag, 'title', t(key));
    if (/\saria-label="/.test(out)) out = setAttr(out, 'aria-label', t(key));
    return out;
  });
  body = body.replace(/<[^>]*\sdata-i18n-placeholder="([^"]+)"[^>]*>/g, (tag, key) => setAttr(tag, 'placeholder', t(key)));
  body = body.replace(/<[^>]*\sdata-i18n-label="([^"]+)"[^>]*>/g, (tag, key) => setAttr(tag, 'label', t(key)));

  head = head
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(t('meta.title'))}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(t('meta.description'))}" />`)
    .replace('</head>', `    ${[addressTags(t, lang, site), structuredData(t, lang, site)].filter(Boolean).join('\n    ')}\n  </head>`);

  return head + body;
}

// Plain-language summary for AI assistants (llms.txt convention).
export function llmsTxt(strings, site) {
  const t = (key) => strings.en[key] ?? key;
  const at = (rel) => (site.siteUrl ? new URL(rel, site.siteUrl).href : rel);
  const lines = [
    '# RetouchPDF',
    '',
    `> ${t('meta.description')}`,
    '',
    t('about.intro'),
    '',
    '## Features',
    ...[1, 2, 3, 4, 5, 6].map((n) => `- ${t(`feature.${n}`)}`),
    '',
    '## FAQ',
    ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`### ${t(`faq.q${n}`)}`, t(`faq.a${n}`), '']),
    '## Links',
    `- [RetouchPDF (English)](${at('./')})`,
    `- [RetouchPDF (français)](${at('fr/')})`,
    `- [SHA-256 fingerprint of the offline file](${at('SHA256SUMS.txt')})`,
    ...(site.sourceUrl ? [`- [Source code, AGPL-3.0](${site.sourceUrl})`] : []),
    `- [Support the project on Ko-fi](${site.supportUrl})`,
    '',
  ];
  return lines.join('\n');
}
