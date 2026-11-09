// 🔎 Căutare în notițe — căsuța din title bar, lângă 🛠.
//
// Notițele lui Victor trăiesc ca taburi deschise: zeci de `Untitled-NNN` nesalvate (ținute
// în viață de hot exit) și câte un `notes.txt` per client. „Unde am scris despre DORA acum
// trei săptămâni?" însemna să le deschizi pe rând. Search-ul nativ (⌘⇧F) nu vede taburile
// untitled, iar Quick Open caută doar în NUME, nu în text.
//
// Aici: caută TEXTUL tuturor taburilor text deschise în fereastră, fără diacritice și fără
// majuscule, cu toate cuvintele din interogare (în orice ordine, oriunde în notiță). Un rând
// de rezultat = o linie potrivită; Enter aduce tab-ul în față cu linia selectată.
//
// Căsuța din title bar o desenează `vscode-patch/workbench.js` (o extensie n-are acces
// acolo); la click apasă intrarea ascunsă `notesearch` de mai jos, care deschide QuickPick-ul,
// iar el îi mută focusul în input — tastarea continuă acolo.

const vscode = require('vscode');

/** „Adopție" → „adoptie": fără diacritice, lowercase, ca să găsești ce ai scris în grabă. */
function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function terms(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * Partea pură. `docs` = [{ key, label, text }]. Întoarce [{ key, label, hits: [{ line, text, score }] }]:
 * doar notițele care conțin TOATE cuvintele; în fiecare, liniile cu cele mai multe cuvinte
 * întâi. Notițele cu potriviri mai dense (mai multe cuvinte pe aceeași linie) urcă.
 */
function search(docs, query, { maxHitsPerDoc = 5 } = {}) {
  const words = terms(query);
  if (!words.length) return [];
  const out = [];
  for (const doc of docs) {
    const folded = fold(doc.text);
    if (!words.every((w) => folded.includes(w))) continue;
    const lines = doc.text.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const fl = fold(lines[i]);
      const score = words.filter((w) => fl.includes(w)).length;
      if (score) hits.push({ line: i, text: lines[i], score });
    }
    hits.sort((a, b) => b.score - a.score || a.line - b.line);
    out.push({ key: doc.key, label: doc.label, best: hits[0] ? hits[0].score : 0, hits: hits.slice(0, maxHitsPerDoc) });
  }
  out.sort((a, b) => b.best - a.best);
  return out;
}

/** Taburile text din fereastră, cu textul lor. Un untitled restaurat din backup se încarcă abia
 *  la `openTextDocument`, deci îl cerem explicit — altfel ar lipsi tocmai notițele vechi. */
async function openNotes() {
  const seen = new Map();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      const uri = tab.input.uri;
      const key = uri.toString();
      if (seen.has(key)) continue;
      seen.set(key, { uri, label: tab.label });
    }
  }
  const docs = [];
  await Promise.all([...seen.values()].map(async ({ uri, label }) => {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      docs.push({ key: uri.toString(), label, uri, text: doc.getText() });
    } catch (_) { /* tab mort (fișier șters) — sărim */ }
  }));
  return docs;
}

// **Și fișierele recente** (2026-11-09, Victor: *"vreau să cauți și în recent, nu doar în cele
// deschise. De multe ori îl găsesc în recent. Deci open recent poate să fie chiar mai mult decât
// ce apare în listă"*). `_workbench.getRecentlyOpened` dă toată lista pe care VS Code o ține
// (până la 500), nu doar cele ~20 din File › Open Recent. Se citesc de pe disc, fără cele deja
// deschise, fără fișiere mari sau binare — și abia după ce lista e pe ecran, ca deschiderea să
// nu aștepte după disc.
const RECENT_MAX_BYTES = 2 * 1024 * 1024;

async function recentFiles(skip) {
  let recent;
  try { recent = await vscode.commands.executeCommand('_workbench.getRecentlyOpened'); } catch (_) { return []; }
  const entries = (recent && recent.files) || [];
  const docs = [];
  await Promise.all(entries.map(async (entry) => {
    const uri = entry.fileUri;
    if (!uri || skip.has(uri.toString())) return;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > RECENT_MAX_BYTES) return;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.includes(0)) return; // binar
      const text = Buffer.from(bytes).toString('utf8');
      const name = uri.path.split('/').pop();
      docs.push({ key: uri.toString(), label: `${name} (recent)`, uri, text });
    } catch (_) { /* șters, mutat, fără drept de citire — sărim */ }
  }));
  return docs;
}

/** Linkurile dintr-o notiță, o dată fiecare, în ordinea apariției. */
function urls(text) {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:]+$/, '')))];
}

function firstLine(text) {
  return (text.split(/\r?\n/).find((l) => l.trim()) || '').trim();
}

async function reveal(uri, line, length) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const end = new vscode.Position(line, length);
  const start = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

async function open(initial = '') {
  const qp = vscode.window.createQuickPick();
  qp.placeholder = 'Search open notes and recent files (all words, accents ignored)…';
  qp.matchOnDescription = false;
  qp.matchOnDetail = false;
  qp.value = initial;
  const docs = await openNotes();
  const openCount = docs.length;
  let recentCount = null; // null = still reading them
  const byKey = new Map(docs.map((d) => [d.key, d]));

  const render = () => {
    const results = search(docs, qp.value);
    const items = [];
    for (const r of results) {
      const doc = byKey.get(r.key);
      items.push({ label: r.label, kind: vscode.QuickPickItemKind.Separator });
      for (const h of r.hits) {
        items.push({
          label: h.text.trim() || '(empty line)',
          description: `${r.label}:${h.line + 1}`,
          detail: h.line === 0 ? undefined : firstLine(doc.text),
          alwaysShow: true,           // filtrăm noi; cel nativ ar căuta doar în label
          uri: doc.uri, line: h.line, length: h.text.length,
        });
      }
      // Linkurile notiței, ca bullet-uri sub rândurile ei: de obicei după link cauți.
      for (const url of urls(doc.text)) {
        items.push({ label: `• ${url}`, description: r.label, alwaysShow: true, url });
      }
    }
    qp.items = items;
    const scope = `${openCount} open notes + ` + (recentCount === null ? 'reading recent files…' : `${recentCount} recent files`);
    qp.title = qp.value.trim() ? `🔎 ${results.length} matches in ${scope}` : `🔎 ${scope}`;
  };

  qp.onDidChangeValue(render);
  qp.onDidAccept(async () => {
    const pick = qp.selectedItems[0];
    qp.hide();
    if (pick && pick.url) await vscode.env.openExternal(vscode.Uri.parse(pick.url));
    else if (pick && pick.uri) await reveal(pick.uri, pick.line, pick.length);
  });
  let closed = false;
  qp.onDidHide(() => { closed = true; qp.dispose(); });
  render();
  qp.show();
  qp.busy = true;
  const recent = await recentFiles(new Set(byKey.keys()));
  for (const d of recent) { docs.push(d); byKey.set(d.key, d); }
  if (closed) return;
  recentCount = recent.length;
  qp.busy = false;
  render();
}

/** Fără UI: aduce în față prima potrivire. Pentru agenți (`/command?id=victor-vsc.revealNote&arg=…`). */
async function revealBest(query) {
  const open = await openNotes();
  const docs = open.concat(await recentFiles(new Set(open.map((d) => d.key))));
  const [best] = search(docs, query || '');
  if (!best || !best.hits.length) return false;
  const doc = docs.find((d) => d.key === best.key);
  const hit = best.hits.slice().sort((a, b) => a.line - b.line)[0];
  await reveal(doc.uri, hit.line, hit.text.length);
  return true;
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.searchNotes', (q) => open(typeof q === 'string' ? q : '')),
    vscode.commands.registerCommand('victor-vsc.revealNote', (q) => revealBest(q)),
  );
  // Intrarea ascunsă pe care o apasă căsuța din title bar (workbench.js). Ascunsă din workbench.css.
  const item = vscode.window.createStatusBarItem('notesearch', vscode.StatusBarAlignment.Right, -2000008);
  item.name = item.text = 'notesearch';
  item.command = 'victor-vsc.searchNotes';
  item.show();
  context.subscriptions.push(item);
}

module.exports = { register, search, fold, urls };
