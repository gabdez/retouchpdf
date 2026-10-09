// Interface text in English and French. The language follows the browser
// unless the user picked one (kept in localStorage).

export const STRINGS = {
  en: {
    open: 'Open',
    'open.title': 'Open a PDF (Ctrl+O)',
    merge: 'Merge PDF',
    'merge.title': 'Add pages from another PDF',
    blank: 'Blank page',
    'blank.title': 'Insert a blank page after the current page',
    'undo.title': 'Undo (Ctrl+Z)',
    'redo.title': 'Redo (Ctrl+Y)',
    'zoomOut.title': 'Zoom out (Ctrl −)',
    'zoomIn.title': 'Zoom in (Ctrl +)',
    'theme.title': 'Switch light / dark mode',
    'lang.title': 'Passer en français',
    support: 'Support',
    'support.title': 'Support the project on Ko-fi',
    save: 'Save',
    saving: 'Saving…',
    'save.title': 'Save a copy (Ctrl+S)',

    'tool.select': 'Select',
    'tool.select.title': 'Select, move and delete things you added (V)',
    'tool.edittext': 'Edit text',
    'tool.edittext.title': "Edit the PDF's own text and checkboxes (E)",
    'tool.text': 'Add text',
    'tool.text.title': 'Add new text (T)',
    'tool.draw': 'Draw',
    'tool.draw.title': 'Draw freehand or sign (D)',
    'tool.highlight': 'Highlight',
    'tool.highlight.title': 'Highlight an area (H)',
    'tool.whiteout': 'White-out',
    'tool.whiteout.title': 'Cover content with white (W)',
    'tool.rect': 'Shape',
    'tool.rect.title': 'Draw a rectangle (R)',
    'tool.image': 'Image',
    'tool.image.title': 'Insert an image (I)',

    'prop.color': 'Color',
    'prop.font': 'Font',
    'prop.size': 'Size',
    'prop.size.title': 'Font size',
    'prop.line': 'Line',
    'prop.line.title': 'Line thickness',
    delete: 'Delete',
    'delete.title': 'Delete the selected item (Del)',
    'fonts.standard': 'Standard PDF fonts',
    'fonts.local': 'From this computer',
    'fonts.more': 'More fonts',
    'fonts.browse': 'Choose a font on this computer…',
    'fonts.file': 'Load a font file…',

    'help.select': 'Click a form field to fill it in · click something you added to select, move or delete it',
    'help.edittext': 'Click a line to edit it · drag across lines to edit a paragraph · click a checkbox to tick it',
    'help.text': 'Click where you want to type · Enter to finish, Shift+Enter for a new line',
    'help.draw': 'Drag to draw or sign',
    'help.highlight': 'Drag over the area to highlight',
    'help.whiteout': 'Drag over the area to cover',
    'help.rect': 'Drag to draw a rectangle',
    'help.image': 'Click on a page to place the image · Esc to cancel',

    'empty.title': 'Edit a PDF',
    'empty.text': 'Change its text and checkboxes, fill in forms, add text, signatures, highlights and images, or rearrange, rotate and merge pages.',
    'empty.open': 'Open a PDF',
    'empty.blank': 'Blank document',
    'empty.drop': 'or drop a PDF anywhere in this window',
    'empty.privacy': 'Your files stay on this computer. Nothing is uploaded.',
    'footer.legal': 'Legal notice',
    'footer.privacy': 'Privacy',
    'footer.source': 'Source code',
    'footer.download': 'Download for offline use',
    'footer.version': 'Version {version} · {date}',
    'footer.update': 'Check for updates',
    'footer.checksum': 'SHA-256 fingerprint',

    'meta.title': 'RetouchPDF: free, private PDF editor in your browser',
    'meta.description': 'Edit the existing text of a PDF in its original font, fill in forms, sign and merge PDFs. Free, no account, and your files never leave your computer.',
    'about.title': 'A PDF editor that keeps your files on your computer',
    'about.intro': 'RetouchPDF runs entirely in your browser. Open a PDF, change it and save it: nothing is uploaded, and the page is technically unable to send data anywhere. It is free, open source, with no account, no watermark and no ads.',
    'about.featuresTitle': 'What you can do',
    'feature.1': 'Edit the existing text of a PDF: the old text is removed from the file and the new text takes its place, in the original font when it is installed on your computer.',
    'feature.2': 'Fill in PDF forms: text fields, checkboxes, radio buttons and lists. The fields stay editable in Acrobat and other viewers.',
    'feature.3': 'Tick or cross checkboxes drawn as characters, such as Word forms.',
    'feature.4': 'Add text, a handwritten signature, highlights, shapes and images.',
    'feature.5': 'Rotate, reorder, duplicate, delete and merge pages.',
    'feature.6': 'Work offline: download the editor as a single HTML file that runs without an internet connection.',
    'about.faqTitle': 'Frequently asked questions',
    'faq.q1': 'Is it really free?',
    'faq.a1': 'Yes. There is no account, no watermark, no ads and no paid version. If it helps you, you can support the project on Ko-fi.',
    'faq.q2': 'Are my files uploaded to a server?',
    'faq.a2': 'No. Everything happens in your browser, and a security rule built into the page forbids it from making any network request. You can check it yourself: open the developer tools (F12), go to the Network tab and edit a document. Nothing is sent.',
    'faq.q3': 'Can I change the existing text of a PDF, not just add text on top?',
    'faq.a3': 'Yes. Choose Edit text and click a line. The original text is removed from the PDF itself and rewritten in the same place, with the same size, color and angle, and in the same font when it is installed on your computer.',
    'faq.q4': 'Does it work offline?',
    'faq.a4': 'Yes. Use the "Download for offline use" link at the bottom of this page: you get a single HTML file that works without an internet connection and never contacts any server.',
    'faq.q5': 'Can I fill in a PDF form and keep it editable?',
    'faq.a5': 'Yes. Form fields become real fields you can type in. When you save, the values are written into the PDF and the fields stay editable in other PDF viewers.',
    'faq.q6': 'Which browsers does it work in?',
    'faq.a6': 'Recent versions of Edge, Chrome, Firefox and Safari. Using the original fonts of a document requires Edge or Chrome, which can share the fonts installed on your computer.',

    'fontDialog.title': 'Fonts on this computer',
    'fontDialog.search': 'Search fonts',
    'fontDialog.none': 'No matching fonts',
    close: 'Close',

    'drop.open': 'Drop to open',
    'drop.add': 'Drop to add pages',
    unsaved: 'unsaved changes',
    'page.label': 'Page {n} / {total}',
    'thumb.rotateCw': 'Rotate clockwise',
    'thumb.rotateCcw': 'Rotate counter-clockwise',
    'thumb.duplicate': 'Duplicate page',
    'thumb.delete': 'Delete page',
    'check.empty': '☐ Empty',
    'check.check': '☑ Check',
    'check.cross': '☒ Cross',

    'confirm.discard': 'Discard unsaved changes to the current document?',
    'open.password': 'Password-protected PDFs are not supported.',
    'open.failed': 'Could not open {name}.',
    'pages.added.one': 'Added 1 page.',
    'pages.added.other': 'Added {n} pages.',
    'page.lastOne': 'A document needs at least one page.',
    'edit.noText': 'No editable text on this page. If it is a scanned image, use White-out and Text instead.',
    'busy.reading': 'Reading text…',
    'busy.text': 'Updating text…',
    'busy.checkbox': 'Updating checkbox…',
    'edit.readFailed': 'Could not read this text.',
    'edit.imageText': 'This text is part of an image, so it was painted over and retyped.',
    'edit.failed': 'Could not edit this text: {error}',
    'checkbox.failed': 'Could not change this checkbox: {error}',
    'image.failed': 'Could not read that image.',
    'forms.found': 'This PDF has form fields: click a field to fill it in.',
    'forms.failed': 'Some form fields could not be filled: {names}',
    'font.noApi': 'This browser can\'t use the fonts on your computer, so "{shown}" is replaced by {instead}. Use Edge or Chrome for exact fonts, or load a font file from the Font menu.',
    'font.blocked': 'Access to your fonts was not allowed, so "{shown}" is replaced by {instead}. You can allow it in the browser\'s site settings.',
    'font.missing': '"{shown}" is not installed on this computer, so {instead} is used instead.',
    'fontList.noApi': "This browser can't list the fonts on your computer. Use Edge or Chrome, or load a font file instead.",
    'fontList.blocked': "Access to your fonts was not allowed. You can allow it in the browser's site settings.",
    'font.unusable': "{name} can't be used in a PDF.",
    'fontFile.invalid': '{name} is not a font file this editor can use (TTF, OTF or TTC).',
    'chars.replaced': 'Some characters are not available in the chosen font and were replaced with "?".',
    saved: 'Saved {name}',
    downloaded: 'Downloaded {name}',
    'save.failed': 'Saving failed: {error}',

    'legal.title': 'Legal notice and terms of use',
    'legal.body': `
      <h3>Publisher</h3>
      <p>{publisher}, private individual. Contact: {contact}</p>
      <h3>Hosting</h3>
      <p>GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States.</p>
      <h3>Terms of use</h3>
      <p>RetouchPDF is free and provided "as is", without any warranty. You are responsible for the documents you edit. Using it to forge a document or to deceive anyone is forbidden and may be a criminal offence.</p>
      <h3>Licence</h3>
      <p>Free software under the GNU Affero General Public License v3 (AGPL-3.0). {source}</p>
      <p>Built with pdf.js (Apache 2.0), pdf-lib (MIT) and fontkit (MIT).</p>`,
    'privacy.title': 'Privacy',
    'privacy.body': `
      <p><strong>Your documents never leave your computer.</strong> Everything happens in your browser, and a security rule built into the page forbids it from sending anything over the network.</p>
      <ul>
        <li>No personal data is collected: no account, no cookies, no analytics, no ads.</li>
        <li>Only your preferences (theme and language) are kept in your browser's local storage. They are never sent anywhere.</li>
        <li>When you load this page, the host (GitHub) may record technical data such as your IP address to run its service: see the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub privacy statement</a>. The downloadable offline version avoids even that.</li>
        <li>The "Support" button opens Ko-fi, an external site with its own privacy policy.</li>
      </ul>`,
    'legal.missing': '(to be completed)',
    'legal.sourceLink': 'Source code: <a href="{url}" target="_blank" rel="noopener">{url}</a>',
  },

  fr: {
    open: 'Ouvrir',
    'open.title': 'Ouvrir un PDF (Ctrl+O)',
    merge: 'Fusionner',
    'merge.title': "Ajouter les pages d'un autre PDF",
    blank: 'Page blanche',
    'blank.title': 'Insérer une page blanche après la page actuelle',
    'undo.title': 'Annuler (Ctrl+Z)',
    'redo.title': 'Rétablir (Ctrl+Y)',
    'zoomOut.title': 'Zoom arrière (Ctrl −)',
    'zoomIn.title': 'Zoom avant (Ctrl +)',
    'theme.title': 'Passer en mode clair / sombre',
    'lang.title': 'Switch to English',
    support: 'Soutenir',
    'support.title': 'Soutenir le projet sur Ko-fi',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    'save.title': 'Enregistrer une copie (Ctrl+S)',

    'tool.select': 'Sélection',
    'tool.select.title': 'Sélectionner, déplacer et supprimer ce que vous avez ajouté (V)',
    'tool.edittext': 'Modifier le texte',
    'tool.edittext.title': 'Modifier le texte et les cases à cocher du PDF (E)',
    'tool.text': 'Ajouter du texte',
    'tool.text.title': 'Ajouter du texte (T)',
    'tool.draw': 'Dessiner',
    'tool.draw.title': 'Dessiner à main levée ou signer (D)',
    'tool.highlight': 'Surligner',
    'tool.highlight.title': 'Surligner une zone (H)',
    'tool.whiteout': 'Masquer',
    'tool.whiteout.title': 'Recouvrir une zone de blanc (W)',
    'tool.rect': 'Forme',
    'tool.rect.title': 'Dessiner un rectangle (R)',
    'tool.image': 'Image',
    'tool.image.title': 'Insérer une image (I)',

    'prop.color': 'Couleur',
    'prop.font': 'Police',
    'prop.size': 'Taille',
    'prop.size.title': 'Taille du texte',
    'prop.line': 'Trait',
    'prop.line.title': 'Épaisseur du trait',
    delete: 'Supprimer',
    'delete.title': "Supprimer l'élément sélectionné (Suppr)",
    'fonts.standard': 'Polices PDF standard',
    'fonts.local': 'De cet ordinateur',
    'fonts.more': 'Autres polices',
    'fonts.browse': 'Choisir une police de cet ordinateur…',
    'fonts.file': 'Charger un fichier de police…',

    'help.select': "Cliquez dans un champ de formulaire pour le remplir · cliquez sur ce que vous avez ajouté pour le sélectionner, le déplacer ou le supprimer",
    'help.edittext': 'Cliquez sur une ligne pour la modifier · glissez sur plusieurs lignes pour un paragraphe · cliquez sur une case pour la cocher',
    'help.text': 'Cliquez où vous voulez écrire · Entrée pour valider, Maj+Entrée pour une nouvelle ligne',
    'help.draw': 'Glissez pour dessiner ou signer',
    'help.highlight': 'Glissez sur la zone à surligner',
    'help.whiteout': 'Glissez sur la zone à recouvrir',
    'help.rect': 'Glissez pour dessiner un rectangle',
    'help.image': "Cliquez sur une page pour placer l'image · Échap pour annuler",

    'empty.title': 'Modifiez un PDF',
    'empty.text': 'Changez son texte et ses cases à cocher, remplissez des formulaires, ajoutez du texte, une signature, des surlignages et des images, ou réorganisez, faites pivoter et fusionnez des pages.',
    'empty.open': 'Ouvrir un PDF',
    'empty.blank': 'Document vierge',
    'empty.drop': 'ou déposez un PDF n’importe où dans cette fenêtre',
    'empty.privacy': 'Vos fichiers restent sur cet ordinateur. Rien n’est envoyé.',
    'footer.legal': 'Mentions légales',
    'footer.privacy': 'Confidentialité',
    'footer.source': 'Code source',
    'footer.download': 'Télécharger pour utiliser hors ligne',
    'footer.version': 'Version {version} du {date}',
    'footer.update': 'Vérifier les mises à jour',
    'footer.checksum': 'Empreinte SHA-256',

    'meta.title': 'RetouchPDF : éditeur PDF gratuit et privé, dans votre navigateur',
    'meta.description': "Modifiez le texte existant d'un PDF dans sa police d'origine, remplissez des formulaires, signez et fusionnez des PDF. Gratuit, sans compte, et vos fichiers ne quittent jamais votre ordinateur.",
    'about.title': 'Un éditeur PDF qui garde vos fichiers sur votre ordinateur',
    'about.intro': "RetouchPDF fonctionne entièrement dans votre navigateur. Ouvrez un PDF, modifiez-le, enregistrez-le : rien n'est envoyé, et la page est techniquement incapable de transmettre des données. Il est gratuit et open source, sans compte, sans filigrane et sans publicité.",
    'about.featuresTitle': 'Ce que vous pouvez faire',
    'feature.1': "Modifier le texte existant d'un PDF : l'ancien texte est retiré du fichier et le nouveau prend sa place, dans la police d'origine quand elle est installée sur votre ordinateur.",
    'feature.2': "Remplir des formulaires PDF : champs texte, cases à cocher, boutons radio et listes. Les champs restent modifiables dans Acrobat et les autres lecteurs.",
    'feature.3': 'Cocher ou barrer les cases dessinées comme des caractères, par exemple dans les formulaires Word.',
    'feature.4': 'Ajouter du texte, une signature manuscrite, des surlignages, des formes et des images.',
    'feature.5': 'Faire pivoter, réorganiser, dupliquer, supprimer et fusionner des pages.',
    'feature.6': "Travailler hors ligne : téléchargez l'éditeur sous forme d'un seul fichier HTML qui fonctionne sans connexion internet.",
    'about.faqTitle': 'Questions fréquentes',
    'faq.q1': "Est-ce vraiment gratuit ?",
    'faq.a1': "Oui. Pas de compte, pas de filigrane, pas de publicité, pas de version payante. Si l'outil vous aide, vous pouvez soutenir le projet sur Ko-fi.",
    'faq.q2': 'Mes fichiers sont-ils envoyés sur un serveur ?',
    'faq.a2': "Non. Tout se passe dans votre navigateur, et une règle de sécurité intégrée à la page lui interdit toute connexion réseau. Vous pouvez le vérifier : ouvrez les outils de développement (F12), onglet Réseau, et modifiez un document. Rien n'est envoyé.",
    'faq.q3': "Puis-je modifier le texte existant d'un PDF, et pas seulement ajouter du texte par-dessus ?",
    'faq.a3': "Oui. Choisissez Modifier le texte et cliquez sur une ligne. Le texte d'origine est retiré du PDF lui-même et réécrit au même endroit, avec la même taille, la même couleur et le même angle, et dans la même police quand elle est installée sur votre ordinateur.",
    'faq.q4': 'Fonctionne-t-il hors ligne ?',
    'faq.a4': "Oui. Utilisez le lien « Télécharger pour utiliser hors ligne » en bas de cette page : vous obtenez un seul fichier HTML qui fonctionne sans connexion et ne contacte jamais aucun serveur.",
    'faq.q5': 'Puis-je remplir un formulaire PDF et le garder modifiable ?',
    'faq.a5': "Oui. Les champs du formulaire deviennent de vrais champs à remplir. À l'enregistrement, les valeurs sont écrites dans le PDF et les champs restent modifiables dans les autres lecteurs PDF.",
    'faq.q6': 'Avec quels navigateurs fonctionne-t-il ?',
    'faq.a6': "Les versions récentes d'Edge, Chrome, Firefox et Safari. L'utilisation des polices d'origine d'un document nécessite Edge ou Chrome, qui peuvent accéder aux polices installées sur votre ordinateur.",

    'fontDialog.title': 'Polices de cet ordinateur',
    'fontDialog.search': 'Rechercher une police',
    'fontDialog.none': 'Aucune police trouvée',
    close: 'Fermer',

    'drop.open': 'Déposez pour ouvrir',
    'drop.add': 'Déposez pour ajouter les pages',
    unsaved: 'modifications non enregistrées',
    'page.label': 'Page {n} / {total}',
    'thumb.rotateCw': 'Pivoter vers la droite',
    'thumb.rotateCcw': 'Pivoter vers la gauche',
    'thumb.duplicate': 'Dupliquer la page',
    'thumb.delete': 'Supprimer la page',
    'check.empty': '☐ Vide',
    'check.check': '☑ Coché',
    'check.cross': '☒ Croix',

    'confirm.discard': 'Abandonner les modifications non enregistrées du document actuel ?',
    'open.password': 'Les PDF protégés par mot de passe ne sont pas pris en charge.',
    'open.failed': "Impossible d'ouvrir {name}.",
    'pages.added.one': '1 page ajoutée.',
    'pages.added.other': '{n} pages ajoutées.',
    'page.lastOne': 'Un document doit garder au moins une page.',
    'edit.noText': "Aucun texte modifiable sur cette page. S'il s'agit d'une image scannée, utilisez Masquer puis Ajouter du texte.",
    'busy.reading': 'Lecture du texte…',
    'busy.text': 'Mise à jour du texte…',
    'busy.checkbox': 'Mise à jour de la case…',
    'edit.readFailed': 'Impossible de lire ce texte.',
    'edit.imageText': 'Ce texte fait partie d’une image : il a été recouvert puis réécrit.',
    'edit.failed': 'Impossible de modifier ce texte : {error}',
    'checkbox.failed': 'Impossible de modifier cette case : {error}',
    'image.failed': 'Impossible de lire cette image.',
    'forms.found': 'Ce PDF contient un formulaire : cliquez dans un champ pour le remplir.',
    'forms.failed': "Certains champs n'ont pas pu être remplis : {names}",
    'font.noApi': "Ce navigateur ne peut pas utiliser les polices de votre ordinateur : « {shown} » est remplacée par {instead}. Utilisez Edge ou Chrome pour les polices exactes, ou chargez un fichier de police depuis le menu Police.",
    'font.blocked': "L'accès à vos polices a été refusé : « {shown} » est remplacée par {instead}. Vous pouvez l'autoriser dans les paramètres du site de votre navigateur.",
    'font.missing': "« {shown} » n'est pas installée sur cet ordinateur : {instead} est utilisée à la place.",
    'fontList.noApi': 'Ce navigateur ne peut pas lister les polices de votre ordinateur. Utilisez Edge ou Chrome, ou chargez un fichier de police.',
    'fontList.blocked': "L'accès à vos polices a été refusé. Vous pouvez l'autoriser dans les paramètres du site de votre navigateur.",
    'font.unusable': '{name} ne peut pas être utilisée dans un PDF.',
    'fontFile.invalid': "{name} n'est pas un fichier de police utilisable (TTF, OTF ou TTC).",
    'chars.replaced': 'Certains caractères absents de la police choisie ont été remplacés par « ? ».',
    saved: '{name} enregistré',
    downloaded: '{name} téléchargé',
    'save.failed': "Échec de l'enregistrement : {error}",

    'legal.title': "Mentions légales et conditions d'utilisation",
    'legal.body': `
      <h3>Éditeur du site</h3>
      <p>{publisher}, particulier, directeur de la publication. Contact : {contact}</p>
      <h3>Hébergeur</h3>
      <p>GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis.</p>
      <h3>Conditions d'utilisation</h3>
      <p>RetouchPDF est gratuit et fourni « en l'état », sans aucune garantie. Vous êtes responsable des documents que vous modifiez. Il est interdit de l'utiliser pour falsifier un document ou tromper qui que ce soit : le faux et l'usage de faux sont punis par la loi (article 441-1 du Code pénal).</p>
      <h3>Licence</h3>
      <p>Logiciel libre sous licence GNU Affero General Public License v3 (AGPL-3.0). {source}</p>
      <p>Réalisé avec pdf.js (Apache 2.0), pdf-lib (MIT) et fontkit (MIT).</p>`,
    'privacy.title': 'Confidentialité',
    'privacy.body': `
      <p><strong>Vos documents ne quittent jamais votre ordinateur.</strong> Tout se passe dans votre navigateur, et une règle de sécurité intégrée à la page lui interdit d'envoyer quoi que ce soit sur le réseau.</p>
      <ul>
        <li>Aucune donnée personnelle n'est collectée : pas de compte, pas de cookies, pas de mesure d'audience, pas de publicité.</li>
        <li>Seules vos préférences (thème et langue) sont conservées dans le stockage local de votre navigateur. Elles ne sont jamais transmises.</li>
        <li>Au chargement de la page, l'hébergeur (GitHub) peut enregistrer des données techniques, comme votre adresse IP, pour faire fonctionner son service : voir la <a href="https://docs.github.com/fr/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">déclaration de confidentialité de GitHub</a>. La version hors ligne téléchargeable évite même cela.</li>
        <li>Le bouton « Soutenir » ouvre Ko-fi, un site externe qui a sa propre politique de confidentialité.</li>
      </ul>`,
    'legal.missing': '(à compléter)',
    'legal.sourceLink': 'Code source : <a href="{url}" target="_blank" rel="noopener">{url}</a>',
  },
};

function detect() {
  try {
    const saved = localStorage.getItem('pdf-editor-lang');
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined' && document.documentElement.lang === 'fr') return 'fr';
  const nav = typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export let lang = detect();

// t('open.failed', { name }) → "Could not open report.pdf."
export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Static text in the page: data-i18n (text), data-i18n-title (tooltip +
// accessible name), data-i18n-placeholder, data-i18n-label (optgroups).
export function translatePage(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.title);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.label = t(el.dataset.i18nLabel);
}

export function setLang(next) {
  lang = next;
  try {
    localStorage.setItem('pdf-editor-lang', next);
  } catch {
    /* the choice lasts for this session only */
  }
  translatePage();
}
