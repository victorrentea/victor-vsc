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
 * O comandă de workbench răspunde când a pornit lucrul, nu când tab-urile s-au
 * așezat — iar starea pe care o citim noi e cea așezată. Fără așteptarea asta,
 * preview-ul abia creat nu se vede încă în `tabGroups` și rămâne netratat: exact
 * așa ajungea nezăvorât, ca al doilea Markdown randat să i se așeze peste el.
 */
async function settle(probe, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const v = probe();
    if (v) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  return undefined;
}

const allTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs);
const stillOpen = tab => allTabs().includes(tab);

/**
 * Preview-ul de Markdown e un webview, nu un editor legat de un fișier: API-ul
 * de tab-uri nu spune ce fișier arată. Ținem noi legătura, pe identitatea
 * tab-ului, ca butonul să poată aduce sursa înapoi.
 */
const previewUris = new Map();

const isMarkdownPreview = input =>
  input instanceof vscode.TabInputWebview && String(input.viewType).includes('markdown.preview');

/**
 * Un preview DEBLOCAT e refolosit de VS Code pentru următorul fișier deschis, cu
 * tot cu identitatea tab-ului — deci maparea noastră poate ajunge să arate spre
 * fișierul de dinainte, iar „înapoi la text" ar deschide altceva decât se vede.
 * Eticheta e singurul martor la îndemână că maparea mai e valabilă.
 */
function previewUri(tab) {
  const uri = previewUris.get(tab);
  if (!uri) return undefined;
  return tab.label.endsWith(path.basename(uri.fsPath)) ? uri : undefined;
}

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
    return { type: MARKDOWN, rendered: true, uri: previewUri(tab) };
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

const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

function activeWebviewTab() {
  const tab = activeTab();
  return tab && isMarkdownPreview(tab.input) ? tab : undefined;
}

const GROUPS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

/**
 * Aduce în față un tab oarecare — inclusiv un webview, pe care `tabGroups` nu-l
 * poate activa. Nu ținem cont de indexul lui, fiindcă `openEditorAtIndex` nu
 * numără la fel în toate versiunile; ciclăm prin grup până cade pe el, ceea ce
 * nu poate greși și e mărginit de numărul de tab-uri.
 */
async function activateTab(tab) {
  const group = vscode.window.tabGroups.all.find(g => g.tabs.includes(tab));
  if (!group) return false;
  const ordinal = GROUPS[group.viewColumn];
  if (ordinal) {
    try { await vscode.commands.executeCommand(`workbench.action.focus${ordinal}EditorGroup`); }
    catch (_) { /* mai puține grupuri decât credeam */ }
  }
  for (let i = 0; i <= group.tabs.length; i++) {
    if (activeTab() === tab) return true;
    await vscode.commands.executeCommand('workbench.action.nextEditorInGroup');
    await settle(() => true, 1);
  }
  return activeTab() === tab;
}

/**
 * Același tab, dar obiectul pe care îl mai recunoaște VS Code acum. Identitatea
 * unui `Tab` se poate pierde când grupul lui se rearanjează sub noi, iar atunci
 * `close` pe referința veche nu închide nimic — de acolo veneau perechile
 * text+randat rămase una lângă alta, nereproductibil, doar când conversia
 * nimerea într-o rearanjare.
 */
function liveTab(tab, column) {
  if (allTabs().includes(tab)) return tab;
  const input = tab.input;
  if (!input?.uri) return undefined;
  for (const group of vscode.window.tabGroups.all) {
    if (column && group.viewColumn !== column) continue;
    const same = group.tabs.find(other => other.input instanceof input.constructor
      && sameFile(other, input.uri) && other.input.viewType === input.viewType);
    if (same) return same;
  }
  return undefined;
}

// autoSave e „afterDelay", deci un tab murdar e o fereastră de o secundă — dar
// dacă nimerim în ea, închiderea ar scoate un dialog de salvare peste un gest
// care trebuie să fie instant. Salvăm și mergem mai departe.
async function closeTab(tab, column) {
  const live = liveTab(tab, column);
  if (!live) return;
  if (live.isDirty && live.input?.uri) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === live.input.uri.toString());
    if (doc) await doc.save();
  }
  await vscode.window.tabGroups.close(live);
  await settle(() => !allTabs().includes(live), 10);
}

/* --------------------------------------------------------------- conversion */

// Conversia produce ea însăși evenimente de tab; fără paza asta ascultătorul de
// mai jos ar reintra în conversie la fiecare tab rescris.
let applying = false;

async function convert(t, rendered) {
  if (t.rendered === rendered) return;
  // Un preview a cărui sursă am uitat-o (după un reload de fereastră harta e
  // goală) se poate totuși întoarce pe text — vezi mai jos.
  if (!t.uri && !(t.type === MARKDOWN && t.rendered)) return;

  if (t.type.kind === 'custom') {
    // Același fișier, alt editor. `openWith` NU înlocuiește editorul de dinainte
    // când providerul acceptă mai multe editoare pe același document — deschide
    // un al doilea tab peste primul. Așa se aduna, la fiecare apăsare, câte o
    // pereche text+diagramă din care „înapoi pe text" nu mai avea ce să scoată.
    // Deci închidem noi forma veche, după ce ne-am asigurat că cea nouă e sus.
    const viewType = rendered ? t.type.viewType() : 'default';
    if (!viewType) return;
    await vscode.commands.executeCommand('vscode.openWith', t.uri, viewType,
      { viewColumn: t.column, preserveFocus: true, preview: false });
    await settle(() => !stillOpen(t.tab) || allTabs().some(tab => tab !== t.tab && sameFile(tab, t.uri)));
    await closeTab(t.tab, t.column);
    return;
  }

  if (!rendered) return unrender(t);

  // Markdown: `markdown.showPreview` desenează în grupul ACTIV, deci întâi
  // aducem sursa în față, apoi randăm lângă ea și închidem textul.
  const before = new Set(allTabs());
  await vscode.window.showTextDocument(t.uri, { viewColumn: t.column, preview: false });
  await vscode.commands.executeCommand('markdown.showPreview', t.uri);

  // Panoul apare după ce comanda a răspuns; îl așteptăm, altfel îl ratăm.
  const preview = await settle(() => allTabs().find(tab => isMarkdownPreview(tab.input) && !before.has(tab)))
    || await settle(() => activeWebviewTab(), 10);
  if (preview) {
    previewUris.set(preview, t.uri);
    // Un preview deblocat e refolosit pentru următorul .md deschis — adică al
    // doilea Markdown randat l-ar fura pe primul. Blocat, fiecare fișier își
    // ține panoul lui. (`[Preview] x.md` = blocat, `Preview x.md` = nu.)
    if (!/^\[/.test(preview.label) && await activateTab(preview)) {
      await vscode.commands.executeCommand('markdown.preview.toggleLock');
      await settle(() => /^\[/.test(preview.label), 10);
    }
  }
  await closeTab(t.tab, t.column);
}

/**
 * Preview → sursă. Comanda proprie a Markdown-ului știe ce fișier arată panoul,
 * și o știe și după un reload de fereastră, când harta noastră s-a golit — deci
 * o preferăm hărții. Rămâne pe ea doar dacă panoul nu poate fi adus în față.
 */
async function unrender(t) {
  if (await activateTab(t.tab)) {
    await vscode.commands.executeCommand('markdown.showSource');
    await settle(() => !stillOpen(t.tab) || !isMarkdownPreview(activeTab()?.input));
    await closeTab(t.tab, t.column);
    return;
  }
  if (!t.uri) return;
  await vscode.window.showTextDocument(t.uri, { viewColumn: t.column, preview: false });
  await closeTab(t.tab, t.column);
}

const sameFile = (tab, uri) =>
  tab.input?.uri && String(tab.input.uri) === String(uri);

/**
 * A doua trecere peste ce a rămas în modul greșit. Un tab rătăcit are două
 * povești diferite: dacă fișierul lui apare deja în forma cerută în același
 * grup, e o rămășiță și se închide; dacă nu, pur și simplu n-a apucat să fie
 * convertit și îl convertim acum. Fără despărțirea asta, „mai încearcă o dată"
 * ar fabrica un al doilea panou pentru un fișier care îl are deja.
 */
async function sweep(type, rendered) {
  const all = tabsOfType(type);
  for (const t of all.filter(x => x.rendered !== rendered)) {
    const twin = t.uri && all.find(o => o !== t && o.rendered === rendered
      && o.column === t.column && String(o.uri) === String(t.uri));
    if (twin) await closeTab(t.tab, t.column);
    else await convert(t, rendered);
  }
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
  await sweep(type, rendered);

  // Plasa de siguranță pentru cazul în care tab-ul din față era deja în modul
  // cerut și focusul a plecat convertind altceva. Doar spre reprezentări pe care
  // API-ul chiar le poate deschide.
  if (!before?.uri) return;
  const now = classify(activeTab());
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
    // Forma randată vine de la o extensie terță (Draw.io) care poate lipsi. Fără
    // ea butonul nu putea face nimic — dar tăcea, și atunci nu se distinge de o
    // funcție stricată. Spunem de ce, și nu ținem minte un mod imposibil.
    if (rendered && type.kind === 'custom' && !type.viewType()) {
      vscode.window.showWarningMessage(
        `victor-vsc: nu pot randa .${type.exts[0].replace('.', '')} — lipsește extensia care desenează tipul ăsta.`);
      return;
    }
    await setRendered(type, rendered);
    await applyMode(type, rendered);
  });
}

/**
 * Fișierele deschise după ce modul a fost ales se aliniază singure — și în ambele
 * sensuri, fiindcă Draw.io pornește randat din oficiu, deci „text" chiar are ce
 * converti. Se ating DOAR tab-urile nou apărute: restul rămân cum sunt, ca
 * deschiderea unui al doilea fișier să nu rescrie primul. Sunt tratate toate, nu
 * doar primul: la restaurarea unei sesiuni toate tab-urile sosesc într-un singur
 * eveniment, iar celelalte rămâneau altfel în modul greșit.
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
    const fresh = [...new Set([...e.opened, ...e.changed])]
      .filter(tab => !isMarkdownPreview(tab.input))   // vezi mai sus: nu-l contrazicem
      .map(tab => ({ info: classify(tab), tab }))
      .filter(({ info }) => info && info.uri && info.rendered !== isRendered(info.type));
    if (!fresh.length) return;

    guarded(async () => {
      for (const { info, tab } of fresh) {
        if (!stillOpen(tab)) continue;
        const column = vscode.window.tabGroups.all.find(g => g.tabs.includes(tab))?.viewColumn;
        await convert({ ...info, tab, column }, isRendered(info.type));
      }
    }).catch(() => { /* tab închis între timp */ });
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
