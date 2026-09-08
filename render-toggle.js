const vscode = require('vscode');
const path = require('path');
const puml = require('./puml');

/**
 * Un singur buton, mereu în același colț: comută între forma TEXTUALĂ și forma
 * RANDATĂ a fișierului din față. Markdown, PlantUML și Draw.io au fiecare o
 * randare nativă, dar fiecare pe alt mecanism — de-aia aici e doar un registru
 * de tipuri, iar conversia propriu-zisă e delegată editorului potrivit.
 *
 * Alegerea „text sau randat" e per TIP DE FIȘIER și e globală: Victor lucrează
 * ori „în diagrame", ori „în sursă", dar independent pe fiecare limbaj — poate
 * citi Markdown randat cât timp scrie PlantUML în text. Deci comutatorul
 * rescrie toate tab-urile tipului lui deodată și **nu** atinge celelalte tipuri,
 * iar alegerea se ține minte în `globalState`: orice fișier de tipul ăla deschis
 * după aceea apare direct în modul curent, fără să reapeși.
 */


/**
 * Draw.io nu e al nostru, deci nici viewType-ul lui nu se codează aici: îl
 * căutăm în manifestul extensiei instalate. Fără extensie nu există formă
 * randată, iar tipul rămâne inert în loc să dea eroare la fiecare apăsare.
 */
function drawioViewType() {
  for (const ext of vscode.extensions.all) {
    for (const editor of ext.packageJSON?.contributes?.customEditors || []) {
      const id = editor.viewType || '';
      if (/drawio/i.test(id) && !/text|xml/i.test(id)) return id;
    }
  }
  return undefined;
}

const TYPES = [
  {
    id: 'markdown',
    exts: ['.md', '.markdown', '.mdx'],
    kind: 'markdown',
    fallback: 'text',
  },
  {
    id: 'plantuml',
    exts: ['.puml', '.plantuml', '.iuml', '.wsd', '.pu'],
    kind: 'custom',
    viewType: () => puml.VIEW_TYPE,
    fallback: 'text',
  },
  {
    // Draw.io deschide din oficiu editorul grafic, nu XML-ul — deci pentru el
    // „nimic ales încă" înseamnă randat, altfel prima deschidere l-ar contrazice.
    id: 'drawio',
    exts: ['.drawio', '.dio'],
    kind: 'custom',
    viewType: drawioViewType,
    fallback: 'rendered',
  },
];

const MARKDOWN = TYPES[0];

function typeForUri(uri) {
  if (!uri || uri.scheme !== 'file') return undefined;
  const name = path.basename(uri.fsPath).toLowerCase();
  return TYPES.find(t => t.exts.some(e => name.endsWith(e)));
}

/* -------------------------------------------------------------------- mode */

let store = null;                       // context.globalState, pus în `register`
const key = type => `renderMode.${type.id}`;

const isRendered = type => (store?.get(key(type)) || type.fallback) === 'rendered';
const setRendered = (type, on) => store?.update(key(type), on ? 'rendered' : 'text');

/* -------------------------------------------------------------------- tabs */

/**
 * Preview-ul de Markdown e un webview, nu un editor legat de un fișier: API-ul
 * de tab-uri nu spune ce fișier arată. Ținem noi legătura, pe identitatea
 * tab-ului, ca butonul să poată aduce sursa înapoi.
 */
const previewUris = new Map();

const isMarkdownPreview = input =>
  input instanceof vscode.TabInputWebview && String(input.viewType).includes('markdown.preview');

/** `{ type, rendered, uri }` pentru un tab pe care îl putem comuta, altfel undefined. */
function classify(tab) {
  const input = tab?.input;
  if (!input) return undefined;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    const type = typeForUri(input.uri);
    if (!type) return undefined;
    return { type, rendered: input instanceof vscode.TabInputCustom, uri: input.uri };
  }
  if (isMarkdownPreview(input)) {
    return { type: MARKDOWN, rendered: true, uri: previewUris.get(tab) };
  }
  return undefined;
}

function tabsOfType(type) {
  const found = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const info = classify(tab);
      if (info && info.type === type) found.push({ ...info, tab, column: group.viewColumn });
    }
  }
  return found;
}

/** Tipul pe care acționează butonul: cel al tab-ului din față. */
function activeInfo() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const info = classify(tab);
  return info ? { ...info, tab, column: vscode.window.tabGroups.activeTabGroup.viewColumn } : undefined;
}

function activeWebviewTab() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab && isMarkdownPreview(tab.input) ? tab : undefined;
}

// autoSave e „afterDelay", deci un tab murdar e o fereastră de o secundă — dar
// dacă nimerim în ea, închiderea ar scoate un dialog de salvare peste un gest
// care trebuie să fie instant. Salvăm și mergem mai departe.
async function closeTab(tab) {
  if (tab.isDirty && tab.input?.uri) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === tab.input.uri.toString());
    if (doc) await doc.save();
  }
  await vscode.window.tabGroups.close(tab);
}

/* --------------------------------------------------------------- conversion */

// Conversia produce ea însăși evenimente de tab; fără paza asta ascultătorul de
// mai jos ar reintra în conversie la fiecare tab rescris.
let applying = false;

async function convert(t, rendered) {
  if (!t.uri || t.rendered === rendered) return;

  if (t.type.kind === 'custom') {
    // Același tab, alt editor — exact ce face „Reopen Editor With…". Nu se
    // închide și nu se redeschide nimic, deci două diagrame pot sta randate
    // simultan fără să-și fure una alteia tab-ul.
    const viewType = rendered ? t.type.viewType() : 'default';
    if (!viewType) return;
    await vscode.commands.executeCommand('vscode.openWith', t.uri, viewType,
      { viewColumn: t.column, preserveFocus: true, preview: false });
    return;
  }

  // Markdown: `markdown.showPreview` desenează în grupul ACTIV, deci întâi
  // aducem sursa în față, apoi randăm lângă ea și închidem textul.
  await vscode.window.showTextDocument(t.uri, { viewColumn: t.column, preview: false });
  if (!rendered) { await closeTab(t.tab); return; }

  await vscode.commands.executeCommand('markdown.showPreview', t.uri);
  const preview = activeWebviewTab();
  if (preview) {
    previewUris.set(preview, t.uri);
    // Un preview deblocat e refolosit pentru următorul .md deschis — adică al
    // doilea Markdown randat l-ar fura pe primul. Blocat, fiecare fișier își
    // ține panoul lui.
    if (!/^\[/.test(preview.label)) {
      await vscode.commands.executeCommand('markdown.preview.toggleLock');
    }
  }
  await closeTab(t.tab);
}

/** Aduce toate tab-urile tipului în modul cerut și lasă focusul unde era. */
async function applyMode(type, rendered) {
  const before = activeInfo();
  const targets = tabsOfType(type).filter(t => t.rendered !== rendered);

  // Un preview de Markdown nu poate fi adus în față din API — nu există „activate
  // tab". Deci tab-ul din față se convertește ULTIMUL: focusul rămâne pe el de la
  // sine, în loc să fie mutat înapoi după aceea.
  const last = t => (before && t.tab === before.tab ? 1 : 0);
  targets.sort((a, b) => last(a) - last(b));
  for (const t of targets) await convert(t, rendered);

  // Plasa de siguranță pentru cazul în care tab-ul din față era deja în modul
  // cerut și focusul a plecat convertind altceva. Doar spre reprezentări pe care
  // API-ul chiar le poate deschide.
  if (!before?.uri) return;
  const now = classify(vscode.window.tabGroups.activeTabGroup.activeTab);
  if (now && String(now.uri) === String(before.uri)) return;
  const viewType = !rendered ? 'default' : type.kind === 'custom' ? type.viewType() : undefined;
  if (viewType) {
    await vscode.commands.executeCommand('vscode.openWith', before.uri, viewType,
      { viewColumn: before.column, preview: false });
  }
}

async function guarded(fn) {
  if (applying) return;
  applying = true;
  try { await fn(); } finally { applying = false; }
}

/* ---------------------------------------------------------------- comenzile */

/** Butonul din colț. `rendered` e ce vrea utilizatorul să vadă după apăsare. */
function toggleTo(rendered) {
  return () => guarded(async () => {
    const info = activeInfo();
    const type = info?.type;
    if (!type) return;
    await setRendered(type, rendered);
    await applyMode(type, rendered);
  });
}

/**
 * Un fișier deschis după ce modul a fost ales se aliniază singur — și în ambele
 * sensuri, fiindcă Draw.io pornește randat din oficiu, deci „text" chiar are ce
 * converti. Se atinge DOAR tab-ul nou apărut: restul rămân cum sunt, ca
 * deschiderea unui al doilea fișier să nu rescrie primul.
 */
function watchNewTabs() {
  return vscode.window.tabGroups.onDidChangeTabs(e => {
    for (const tab of e.closed) previewUris.delete(tab);

    // Un preview deschis de mână (⌘K V) nu se contrazice — doar îl înregistrăm,
    // ca butonul să știe ce sursă să aducă înapoi din el.
    for (const tab of e.opened) {
      if (!isMarkdownPreview(tab.input) || previewUris.has(tab)) continue;
      const src = vscode.window.activeTextEditor?.document.uri;
      if (src && typeForUri(src) === MARKDOWN) previewUris.set(tab, src);
    }

    if (applying) return;
    const fresh = [...e.opened, ...e.changed]
      .filter(tab => !isMarkdownPreview(tab.input))   // vezi mai sus: nu-l contrazicem
      .map(tab => ({ info: classify(tab), tab }))
      .find(({ info }) => info && info.uri && info.rendered !== isRendered(info.type));
    if (!fresh) return;

    const column = vscode.window.tabGroups.all.find(g => g.tabs.includes(fresh.tab))?.viewColumn;
    guarded(() => convert({ ...fresh.info, tab: fresh.tab, column }, isRendered(fresh.info.type)))
      .catch(() => { /* tab închis între timp */ });
  });
}

function register(context) {
  store = context.globalState;
  context.subscriptions.push(
    watchNewTabs(),
    vscode.commands.registerCommand('victor-vsc.showRendered', toggleTo(true)),
    vscode.commands.registerCommand('victor-vsc.showSource', toggleTo(false)),
  );
}

module.exports = { register };
