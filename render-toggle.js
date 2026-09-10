const vscode = require('vscode');
const path = require('path');
const puml = require('./puml');

/**
 * UN SINGUR buton, mereu în același loc din bara de titlu: comută TAB-UL DIN FAȚĂ
 * între forma textuală și cea randată. Markdown, PlantUML și Draw.io au fiecare
 * altă randare, dar toate trei sunt „alt editor peste același fișier", deci aici e
 * doar un registru de tipuri, iar deschiderea o face `vscode.openWith`.
 *
 * Butonul lucrează pe TAB, nu pe tipul de fișier. Varianta veche rescria deodată
 * toate tab-urile tipului, ca să existe un „mod Markdown" global — dar asta face
 * ca un click pe un fișier să miște alte tab-uri, iar cele două butoane
 * (`showRendered` / `showSource`) își schimbau locul între ele după starea
 * curentă, deci nu exista un pixel constant pe care să apeși de două ori.
 *
 * Ce a rămas global e doar VALOAREA IMPLICITĂ: ultima formă aleasă se ține minte
 * per tip în `globalState`, iar fișierele DESCHISE DE ACUM ÎNAINTE apar direct în
 * ea. Un tab deja deschis nu mai e atins niciodată de altcineva decât de buton.
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
    // Markdown-ul are DOUĂ randări native: panoul `markdown.showPreview` (un
    // webview, adică alt tab, cu altă identitate și fără legătură cu fișierul) și
    // editorul `vscode.markdown.preview.editor`, care ține locul editorului de
    // text ÎN ACELAȘI TAB. Îl folosim pe al doilea: e literalmente „tab-ul ăsta,
    // altă formă", deci se comportă la fel ca PlantUML și Draw.io și scapă de tot
    // dansul de mai devreme cu blocatul panoului și ghicitul sursei din etichetă.
    id: 'markdown',
    exts: ['.md', '.markdown', '.mdx'],
    viewType: () => 'vscode.markdown.preview.editor',
    fallback: 'text',
  },
  {
    id: 'plantuml',
    exts: ['.puml', '.plantuml', '.iuml', '.wsd', '.pu'],
    viewType: () => puml.VIEW_TYPE,
    fallback: 'text',
  },
  {
    // Draw.io deschide din oficiu editorul grafic, nu XML-ul — deci pentru el
    // „nimic ales încă" înseamnă randat, altfel prima deschidere l-ar contrazice.
    id: 'drawio',
    exts: ['.drawio', '.dio'],
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
 * așezat — iar starea pe care o citim noi e cea așezată.
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
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const sameFile = (tab, uri) => tab.input?.uri && String(tab.input.uri) === String(uri);

/**
 * Un preview vechi, deschis de mână cu ⌘K V sau rămas dintr-o sesiune restaurată.
 * Nu-l mai producem noi, dar butonul trebuie să-l poată aduce înapoi pe text.
 */
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
  // Un webview nu spune ce fișier arată; `uri` lipsă înseamnă „doar înapoi pe text,
  // și numai prin comanda Markdown-ului, care știe ea sursa".
  if (isMarkdownPreview(input)) return { type: MARKDOWN, rendered: true, uri: undefined };
  return undefined;
}

/**
 * Același tab, dar obiectul pe care îl mai recunoaște VS Code acum. Identitatea
 * unui `Tab` se poate pierde când grupul lui se rearanjează sub noi, iar atunci
 * `close` pe referința veche nu închide nimic — de acolo veneau perechile
 * text+randat rămase una lângă alta.
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

  // Panou vechi de preview: singurul care știe ce fișier arată e Markdown-ul.
  if (!t.uri) {
    if (rendered || activeTab() !== t.tab) return;   // `showSource` lucrează pe panoul din față
    try { await vscode.commands.executeCommand('markdown.showSource'); } catch (_) { /* panou mort */ }
    return;
  }

  // Același fișier, alt editor. `openWith` NU înlocuiește editorul de dinainte
  // când providerul acceptă mai multe editoare pe același document — deschide
  // un al doilea tab peste primul. Așa se aduna, la fiecare apăsare, câte o
  // pereche text+diagramă din care „înapoi pe text" nu mai avea ce să scoată.
  // Deci închidem noi forma veche, după ce ne-am asigurat că cea nouă e sus.
  const viewType = rendered ? t.type.viewType() : 'default';
  if (!viewType) return;
  try {
    await vscode.commands.executeCommand('vscode.openWith', t.uri, viewType,
      { viewColumn: t.column, preserveFocus: true, preview: false });
  } catch (err) {
    // Editorul nativ de Markdown își declară selectorul pe `*.md`, deci un
    // `.mdx` sau `.markdown` poate fi refuzat. Mai bine spunem, decât să pară că
    // butonul e stricat — și nu ținem minte un mod în care fișierul n-a intrat.
    await setRendered(t.type, !rendered);
    vscode.window.showWarningMessage(
      `victor-vsc: nu pot randa ${path.basename(t.uri.fsPath)} — ${err.message || err}`);
    return;
  }
  await settle(() => !stillOpen(t.tab) || allTabs().some(tab => tab !== t.tab && sameFile(tab, t.uri)));
  await closeTab(t.tab, t.column);
}

async function guarded(fn) {
  if (applying) return;
  applying = true;
  try { await fn(); } finally { applying = false; }
  drain().catch(() => { /* tab închis între timp */ });   // ce s-a adunat între timp
}

/* ---------------------------------------------------------------- comanda */

/**
 * Butonul din colț: tab-ul din față trece în cealaltă formă. Atât — nu atinge
 * niciun alt tab. Ce alegi aici devine și forma în care se vor deschide de acum
 * fișierele de același tip, ca butonul să nu fie contrazis peste o secundă de
 * alinierea automată de mai jos.
 */
function toggleRender() {
  return () => guarded(async () => {
    const group = vscode.window.tabGroups.activeTabGroup;
    const info = classify(group.activeTab);
    if (!info) return;
    const rendered = !info.rendered;
    // Forma randată vine de la o extensie terță (Draw.io) care poate lipsi. Fără
    // ea butonul nu putea face nimic — dar tăcea, și atunci nu se distinge de o
    // funcție stricată. Spunem de ce, și nu ținem minte un mod imposibil.
    if (rendered && !info.type.viewType()) {
      vscode.window.showWarningMessage(
        `victor-vsc: nu pot randa ${info.type.exts[0]} — lipsește extensia care desenează tipul ăsta.`);
      return;
    }
    await setRendered(info.type, rendered);
    await convert({ ...info, tab: group.activeTab, column: group.viewColumn }, rendered);
  });
}

/* ------------------------------------------------------- fișiere nou deschise */

/**
 * Fișierele deschise DE ACUM ÎNAINTE se aliniază singure la ultima formă aleasă
 * — și în ambele sensuri, fiindcă Draw.io pornește randat din oficiu, deci „text"
 * chiar are ce converti.
 *
 * Se ating DOAR tab-uri cu adevărat noi. O comutare de formă (a noastră, butonul
 * built-in „Reopen as Source File", ⌘K V) arată din afară exact ca o deschidere:
 * apare un tab pentru un fișier care era deja deschis. Alinierea îl lua drept
 * fișier nou și îl întorcea imediat la modul memorat — de aici venea senzația că
 * butonul „nu face nimic": Markdown-ul se deschidea randat, îl treceai pe text și
 * peste o clipă era iar randat, la nesfârșit.
 *
 * Deci: dacă același fișier mai are un tab deschis chiar acum, sau tocmai i s-a
 * închis unul, nu e o deschidere, e o comutare — și e a utilizatorului, nu a
 * noastră. Nu o contrazicem.
 */
const REOPEN_MS = 2000;
const closedAt = new Map();               // uri -> ceasul închiderii

const pending = new Set();

let draining = false;
async function drain() {
  if (applying || draining) return;
  draining = true;
  try {
    while (pending.size) {
      const tab = pending.values().next().value;
      pending.delete(tab);
      if (!stillOpen(tab)) continue;
      const info = classify(tab);
      if (!info || !info.uri || info.rendered === isRendered(info.type)) continue;
      const column = vscode.window.tabGroups.all.find(g => g.tabs.includes(tab))?.viewColumn;
      applying = true;
      try { await convert({ ...info, tab, column }, isRendered(info.type)); }
      catch (_) { /* tab închis între timp */ }
      finally { applying = false; }
    }
  } finally { draining = false; }
}

function isReopen(tab, uri, now) {
  const id = String(uri);
  if (now - (closedAt.get(id) || 0) < REOPEN_MS) return true;
  return allTabs().some(other => other !== tab && sameFile(other, uri));
}

function watchNewTabs() {
  return vscode.window.tabGroups.onDidChangeTabs(e => {
    const now = Date.now();
    for (const tab of e.closed) {
      pending.delete(tab);
      const uri = tab.input?.uri;
      if (uri) closedAt.set(String(uri), now);
    }
    for (const [id, at] of closedAt) if (now - at > REOPEN_MS) closedAt.delete(id);

    for (const tab of e.opened) {
      const info = classify(tab);
      if (info?.uri && !isReopen(tab, info.uri, now)) pending.add(tab);
    }
    drain().catch(() => { /* tab închis între timp */ });
  });
}

function register(context) {
  store = context.globalState;
  // Cheia pe care extensia de Markdown o consultă ca să-și ascundă butoanele de
  // preview când altcineva randează Markdown-ul. Nu e a noastră, dar exact
  // pentru asta există: de acum, pe un `.md` în text, singurul buton din bară e
  // al nostru. (Restul, `Reopen as Source File`, îl scoate `vscode-patch`.)
  vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', true);
  context.subscriptions.push(
    watchNewTabs(),
    vscode.commands.registerCommand('victor-vsc.toggleRender', toggleRender()),
  );
}

module.exports = { register };
