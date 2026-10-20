const vscode = require('vscode');
const bullets = require('./bullets');
const foldWave = require('./fold-wave');

// „Vic Presentation" (⌘F12, și în meniul View): doar codul și numerele de linie
// pe ecran — fără taburi, activity bar și status bar. Doar în fereastra în care
// l-ai pornit.
//
// Zen Mode (F12) e apropiat, dar Victor îl folosește zilnic cu propriile
// `zenMode.*` din package.json (status bar, numere de linie, fără taburi),
// deci modul ăsta e separat.
//
// Setările de mai jos se scriu în stratul de configurare MEMORY al ferestrei:
// e per fereastră, bate setările utilizatorului și nu ajunge pe disc. API-ul de
// extensii nu-l expune (doar Global/Workspace/WorkspaceFolder), așa că
// `vscode-patch/apply.sh` (pasul 3h) înregistrează în workbench comanda
// `victor-vsc.memoryConfig`, care face doar `updateValue(cheie, valoare, MEMORY)`.
// Versiunea veche scria în setările globale și modul se aprindea în toate
// ferestrele deodată. Bonus: un Reload Window iese singur din mod, fiindcă
// stratul MEMORY nu supraviețuiește reîncărcării.
//
// Title bar-ul rămâne: pe macOS se poate ascunde doar în full screen, iar full
// screen-ul mută fereastra pe un Space propriu — la ieșire nu mai stătea pe
// Space-ul celorlalte ferestre VS Code și ⌘` nu mai trecea între ele.
const SETTINGS = {
  'workbench.editor.showTabs': 'none',
  'workbench.activityBar.location': 'hidden',
  'workbench.statusBar.visible': false,
  // Golul din stânga numerelor e glyph margin-ul (breakpoint-uri). Padding-ul
  // de 3 cifre al numerelor rămâne: `lineNumbersMinChars` nu e setare
  // înregistrată, editorul de text îl codează fix pe 3.
  //
  // Folding-ul rămâne pornit intenționat: coloana lui e singurul spațiu dintre
  // numere și cod (săgețile apar doar la hover). Fără ea textul se lipea de
  // numere, iar `lineDecorationsWidth`, care ar fi dat spațiul direct, nu e nici
  // ea setare înregistrată.
  'editor.glyphMargin': false,
  // Săgeata `v` din gutter, pe antetele desfăcute, stă tot timpul, nu doar sub
  // mouse: sala nu vede unde e mouse-ul, deci „aici se poate plia" trebuie să
  // fie permanent, ca `>`-ul de pe cele pliate.
  'editor.showFoldingControls': 'always',
  // Colțurile rotunjite ale selecției: VS Code pune pe fiecare bucată clase pentru
  // colțurile EXTERIOARE ale formei (`top-left-radius`…), din care workbench.css
  // rotunjește cutia neagră. Bucățile în plus, de 10px, pe care le adaugă lângă
  // colțurile interioare le ascunde tot workbench.css.
  'editor.roundedSelection': true,
  // Fără banda albastră pe tot rândul unui antet pliat: pe proiector bătea la ochi
  // mai tare decât selecția. Săgeata `>` din gutter arată deja că e pliat.
  'editor.foldingHighlight': false,
  // Fără punctele `·` pe care VS Code le pune în spațiile din textul selectat:
  // pe cutia neagră ieșeau ca un zgomot între cuvinte.
  'editor.renderWhitespace': 'none',
  // Fără cuvintele colorate în gri peste tot unde apare cel de sub cursor: pe
  // proiector par selecții, iar sala se uită la ele în loc de linia curentă.
  'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false,
  // Din același motiv, fără chenarele de lângă cursor pe perechea de paranteze.
  'editor.matchBrackets': 'never',
  // Antetul lipit sus de sticky scroll e desenat separat de text, fără
  // decorațiile noastre: titlul unui bloc estompat apărea acolo la luminozitate
  // plină. Blocul cursorului își are oricum titlul aprins.
  'editor.stickyScroll.enabled': false,
  // Fără becul / steluța din gutter cu meniul „Rewrite › Modify / Review" (code
  // actions, inclusiv cele AI de la Copilot), care sărea la orice selecție.
  'editor.lightbulb.enabled': 'off',
};

// Secțiunea = liniile ne-goale lipite de cea a cursorului (până la prima linie
// goală în sus și în jos) — blocurile din notițele de curs. Restul fișierului
// se estompează la 30%. Albe de tot sunt linia cursorului și „părinții" ei din
// secțiune: urcând, fiecare linie mai puțin indentată decât ultima găsită —
// ca sala să vadă și sub ce titlu e punctul curent. Pe o linie goală rămâne
// vizibilă secțiunea de deasupra (gri): acolo se scrie punctul următor, iar
// blocul la care se adaugă nu trebuie să dispară cât linia e încă goală. Albi
// sunt părinții punctului pe care urmează să-l scrii, după coloana cursorului:
// urcând din ultima linie, fiecare linie mai puțin indentată decât cursorul — cursorul
// sub „- !AI Colleagues", dar mai la dreapta, îl aprinde; la aceeași coloană e
// frate, deci nu. Pe coloana 0 rămâne alb capitolul (linia de sus din lanțul
// de părinți al ultimei linii), ca sala să nu piardă sub ce titlu e. Restul liniilor din
// secțiune sunt un pic mai închise decât textul normal (70%): trei trepte —
// alb pe ce spui acum, gri pe blocul curent, abia vizibil în rest. Gri sunt
// doar liniile deja spuse: deasupra cursorului sau pe care a stat cursorul de
// la pornirea modului; cele de sub el, încă nevizitate, sunt estompate ca restul
// fișierului — sala nu citește înainte.
const FADE = '0.3';
const DIM = '0.7';
const CURSOR_COLOR = '#ffffff';

/** Lățimea indentării, cu tab-ul cât `tabSize` coloane. */
function indentOf(text, tabSize) {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += tabSize - (width % tabSize);
    else break;
  }
  return width;
}

const isBlank = (text) => text.trim() === '';

/** Liniile [start, end] (0-based, inclusiv) ale secțiunii care conține `line`,
 *  sau null când `line` e goală. `textAt(i)` dă textul liniei i. */
function sectionAround(line, lineCount, textAt) {
  if (line < 0 || line >= lineCount || isBlank(textAt(line))) return null;
  let start = line, end = line;
  while (start > 0 && !isBlank(textAt(start - 1))) start--;
  while (end < lineCount - 1 && !isBlank(textAt(end + 1))) end++;
  return [start, end];
}

/** Secțiunea de deasupra liniei goale `line` (prima ne-goală urcând), sau
 *  null când deasupra e doar gol. */
function sectionAbove(line, lineCount, textAt) {
  for (let i = Math.min(line, lineCount) - 1; i >= 0; i--) {
    if (!isBlank(textAt(i))) return sectionAround(i, lineCount, textAt);
  }
  return null;
}

/** Părinții unei linii indentate cu `indent`, căutați urcând de la `from`
 *  până la `sectionStart`, de sus în jos. */
function parentsOf(indent, from, sectionStart, textAt, tabSize = 4) {
  const out = [];
  for (let i = from; i >= sectionStart && indent > 0; i--) {
    const own = indentOf(textAt(i), tabSize);
    if (own < indent) { out.unshift(i); indent = own; }
  }
  return out;
}

/** Linia `line` plus părinții ei din secțiune, de sus în jos. */
function lineWithParents(line, sectionStart, textAt, tabSize = 4) {
  return [...parentsOf(indentOf(textAt(line), tabSize), line - 1, sectionStart, textAt, tabSize), line];
}

/** Ce rămâne alb din secțiunea [start, end] când cursorul stă pe o linie goală
 *  sub ea, la coloana (lățimea de indentare) `column`. */
function whiteOnBlank([start, end], column, textAt, tabSize = 4) {
  if (column === 0) return [chapterOf([start, end], textAt, tabSize)];
  return parentsOf(column, end, start, textAt, tabSize);
}

/** Unde duce un click pe rotiță din linia `line`: următoarea linie ne-goală — din
 *  ultima linie a unei secțiuni sare peste gol direct la capitolul următor — sau
 *  -1 la capătul fișierului. Pe un antet pliat e chiar primul lui copil. */
function nextStop(line, lineCount, textAt) {
  for (let i = line + 1; i < lineCount; i++) if (!isBlank(textAt(i))) return i;
  return -1;
}

/** Linia `line` din secțiunea cursorului e încă nespusă: sub cursor și nevizitată. */
function isAhead(line, cursor, visited) {
  return line > cursor && !visited.has(line);
}

/** Capitolul secțiunii [start, end]: cel mai de sus părinte al ultimei linii. */
function chapterOf([start, end], textAt, tabSize = 4) {
  return lineWithParents(end, start, textAt, tabSize)[0];
}

const STATE = 'victorVsc.presentation';

// Inline, nu `isWholeLine`: un decor pe toată linia se desenează pe stratul din
// spatele textului, deci opacitatea și culoarea lui n-ar atinge literele (vezi
// și range-focus.js). Pe span-urile de text, da.
// Liniile pe care a stat cursorul, per document, de la pornirea modului.
let visitedLines = new Map();
function visitedIn(doc) {
  const key = doc.uri.toString();
  if (!visitedLines.has(key)) visitedLines.set(key, new Set());
  return visitedLines.get(key);
}

let cursorDeco = null;
let fadeDeco = null;
let dimDeco = null;

function lineRange(doc, a, b) {
  return new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
}

/** Ce rămâne din [from, to) după ce scoți intervalele `cut` (sortate, [a, b)). */
function subtract(from, to, cut) {
  const out = [];
  let at = from;
  for (const [a, b] of cut) {
    if (b <= at || a >= to) continue;
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < to) out.push([at, to]);
  return out;
}

/** Cu text selectat, albă e selecția, nu linia cursorului: cursorul stă de obicei
 *  la capătul selecției, pe linia de dedesubt (selecție de linie întreagă).
 *  Albi rămân și părinții primei linii selectate, ca titlul să se vadă; restul
 *  secțiunilor atinse e gri, inclusiv bucățile neselectate de pe liniile
 *  selectate; în rest, estompat. */
function paintSelection(editor, sels, textAt, tabSize) {
  const doc = editor.document;
  let first = Infinity, last = -1;
  for (const sel of sels) {
    first = Math.min(first, sel.start.line);
    last = Math.max(last, sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line);
  }
  const a = sectionAround(first, doc.lineCount, textAt) || [first, first];
  const b = sectionAround(last, doc.lineCount, textAt) || [last, last];
  const start = Math.min(a[0], first), end = Math.max(b[1], last);
  const parents = new Set(isBlank(textAt(first)) ? [] : parentsOf(indentOf(textAt(first), tabSize), first - 1, start, textAt, tabSize));
  const white = [...parents].map((l) => lineRange(doc, l, l));
  const dim = [];
  for (let l = start; l <= end; l++) {
    if (parents.has(l)) continue;
    const len = doc.lineAt(l).text.length;
    const cut = [];
    for (const sel of sels) {
      const piece = sel.intersection(new vscode.Range(l, 0, l, len));
      if (piece && !piece.isEmpty) cut.push([piece.start.character, piece.end.character]);
    }
    cut.sort((x, y) => x[0] - y[0]);
    for (const [x, y] of cut) white.push(new vscode.Range(l, x, l, y));
    for (const [x, y] of subtract(0, len, cut)) dim.push(new vscode.Range(l, x, l, y));
  }
  const fade = [];
  if (start > 0) fade.push(lineRange(doc, 0, start - 1));
  if (end < doc.lineCount - 1) fade.push(lineRange(doc, end + 1, doc.lineCount - 1));
  editor.setDecorations(cursorDeco, white);
  editor.setDecorations(dimDeco, dim);
  editor.setDecorations(fadeDeco, fade);
}

function paint(editor) {
  if (!editor) return;
  bullets.paint(editor);
  // Rândul cu valul galben își ia culoarea din animație, deci nu primește albul de mai jos.
  const waved = foldWave.paint(editor);
  const doc = editor.document;
  const textAt = (i) => doc.lineAt(i).text;
  const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
  const sels = editor.selections.filter((sel) => !sel.isEmpty);
  if (sels.length) { paintSelection(editor, sels, textAt, tabSize); return; }
  const cursor = editor.selection.active.line;
  const section = sectionAround(cursor, doc.lineCount, textAt);
  if (!section) {
    const above = sectionAbove(cursor, doc.lineCount, textAt);
    const fade = [];
    const dim = [];
    const white = [];
    if (above) {
      const [start, end] = above;
      const active = editor.selection.active;
      const column = indentOf(textAt(cursor).slice(0, active.character), tabSize);
      const lit = new Set(whiteOnBlank(above, column, textAt, tabSize));
      if (start > 0) fade.push(lineRange(doc, 0, start - 1));
      for (let l = start; l <= end; l++) (lit.has(l) ? white : dim).push(lineRange(doc, l, l));
      if (end < doc.lineCount - 1) fade.push(lineRange(doc, end + 1, doc.lineCount - 1));
    } else {
      fade.push(lineRange(doc, 0, doc.lineCount - 1));
    }
    editor.setDecorations(cursorDeco, white);
    editor.setDecorations(dimDeco, dim);
    editor.setDecorations(fadeDeco, fade);
    return;
  }
  const visited = visitedIn(doc);
  visited.add(cursor);
  const bright = new Set(editor.selections.map((sel) => sel.active.line));
  const fade = [];
  const [start, end] = section;
  for (const l of lineWithParents(cursor, start, textAt, tabSize)) bright.add(l);
  if (start > 0) fade.push(lineRange(doc, 0, start - 1));
  if (end < doc.lineCount - 1) fade.push(lineRange(doc, end + 1, doc.lineCount - 1));
  const dim = [];
  for (let l = start; l <= end; l++) {
    if (!bright.has(l)) (isAhead(l, cursor, visited) ? fade : dim).push(lineRange(doc, l, l));
  }
  bright.delete(waved);
  editor.setDecorations(cursorDeco, [...bright].map((l) => lineRange(doc, l, l)));
  editor.setDecorations(dimDeco, dim);
  editor.setDecorations(fadeDeco, fade);
}

function unpaint() {
  bullets.clear();
  foldWave.clear();
  for (const editor of vscode.window.visibleTextEditors) {
    try {
      editor.setDecorations(cursorDeco, []);
      editor.setDecorations(fadeDeco, []);
      editor.setDecorations(dimDeco, []);
    } catch { /* editorul s-a închis */ }
  }
}

// Click pe rotiță oriunde în fereastră (vscode-patch/workbench.js) = un pas înainte
// prin notițe, ca un clicker: antetul pliat de sub cursor se desface, apoi cursorul
// coboară pe următoarea linie ne-goală. Pliat = deducție din `visibleRanges`, ca în
// fold-wave.js; dacă deducția ratează (antetul e ultima linie din viewport), mutarea
// cursorului pe o linie ascunsă desface oricum blocul — așa face VS Code.
async function advance() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const line = editor.selection.active.line;
  const ranges = editor.visibleRanges.map((r) => [r.start.line, r.end.line]);
  if (foldWave.isFoldedAt(ranges, line)) {
    await vscode.commands.executeCommand('editor.unfold', { levels: 1, selectionLines: [line] });
  }
  const next = nextStop(line, doc.lineCount, (i) => doc.lineAt(i).text);
  if (next < 0) return;
  const at = new vscode.Position(next, doc.lineAt(next).firstNonWhitespaceCharacterIndex);
  editor.selection = new vscode.Selection(at, at);
  editor.revealRange(new vscode.Range(at, at));
}

// La intrare, fișierul activ se mărește ca la ⌘-scroll până cât încape pe lățime
// cea mai lungă linie a lui. Lățimea editorului și a textului le știe doar
// workbench-ul, deci măsurarea și pașii îi face vscode-patch/workbench.js: de aici
// pleacă cele mai lungi linii (textul intrării ascunse `fit`), iar el apasă
// intrările `zoomin` / `zoomout` — exact `editor.action.fontZoomIn/Out`, zoom-ul
// de la ⌘-scroll (+10% din font pe pas, pe toată fereastra, nescris pe disc).
// Pașii se numără, ca ieșirea să-i desfacă și să rămână zoom-ul dinainte.
const FIT_LINES = 5;            // emoji-urile fac lățimea în pixeli ≠ numărul de caractere

/** Textul cu tab-urile desfăcute în spații, până la următorul tab stop. */
function expandTabs(text, tabSize = 4) {
  let out = '';
  for (const ch of text) out += ch === '\t' ? ' '.repeat(tabSize - (out.length % tabSize)) : ch;
  return out;
}

/** Cele mai lungi `n` linii ne-goale, cu tab-urile desfăcute: pe ele le măsoară workbench.js. */
function longestLines(lineCount, textAt, tabSize = 4, n = FIT_LINES) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const text = expandTabs(textAt(i), tabSize);
    if (!isBlank(text)) lines.push(text);
  }
  return lines.sort((a, b) => b.length - a.length).slice(0, n);
}

let zoomSteps = 0;
const zoom = (dir) => async () => {
  await vscode.commands.executeCommand(dir > 0 ? 'editor.action.fontZoomIn' : 'editor.action.fontZoomOut');
  zoomSteps += dir;
};

const MEMORY_CONFIG = 'victor-vsc.memoryConfig';

// Citit și de view-log.js: în prezentare, fereastra se vede pe proiector chiar nefocusată.
let presenting = false;
const isPresenting = () => presenting;

function register(context) {
  // Extension host-ul e unul per fereastră, deci o variabilă e exact starea
  // ferestrei ăsteia.
  let on = false;

  cursorDeco = vscode.window.createTextEditorDecorationType({ color: CURSOR_COLOR });
  fadeDeco = vscode.window.createTextEditorDecorationType({ opacity: FADE });
  dimDeco = vscode.window.createTextEditorDecorationType({ opacity: DIM });
  bullets.register(context);
  foldWave.register(context);
  context.subscriptions.push(cursorDeco, fadeDeco, dimDeco,
    vscode.window.onDidChangeTextEditorSelection((e) => { if (on) paint(e.textEditor); }),
    vscode.window.onDidChangeActiveTextEditor((ed) => { if (on) paint(ed); }),
    // Plierea și desfacerea schimbă doar intervalele vizibile — de aici știe valul
    // galben (fold-wave.js) că rândul cursorului s-a pliat.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => { if (on) paint(e.textEditor); }),
    // Un rând gol scris sau șters mută granițele secțiunii.
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (on && ed && ed.document === e.document) paint(ed);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (on && e.affectsConfiguration(`victorVsc.${bullets.SETTING}`)) bullets.paint(vscode.window.activeTextEditor);
    }),
    // View › Vic Presentation › Circle Bullets (vscode-patch/apply.sh, 3g). Bifa
    // urmează `config.victorVsc.presentationCircleBullets`, deci e o setare
    // globală, nu per fereastră: o preferință, nu o stare a prezentării.
    vscode.commands.registerCommand('victor-vsc.toggleCircleBullets', () => {
      const cfg = vscode.workspace.getConfiguration('victorVsc');
      return cfg.update(bullets.SETTING, !cfg.get(bullets.SETTING, false), vscode.ConfigurationTarget.Global);
    }));

  // Semnalul pentru patch-ul din workbench (vscode-patch/workbench.css): cât e
  // pornit modul, intrarea asta există în DOM, iar CSS-ul pune fundalul peste
  // editor. Extensia n-are acces la DOM, deci nu poate pune ea o clasă.
  const marker = vscode.window.createStatusBarItem('presentation', vscode.StatusBarAlignment.Right, -2000002);
  marker.name = 'Vic Presentation';
  marker.text = '$(device-desktop)';
  context.subscriptions.push(marker);

  // Fold All / Unfold All pentru notițele indentate: butoanele le desenează
  // `vscode-patch/workbench.js` în title bar, lângă semafoare, și la click apasă
  // intrările astea (ascunse din CSS) — din renderer nu se pot rula comenzi.
  // Există doar cât e pornit modul, deci și butoanele.
  // Prin talk-notes.js, care află așa că s-a pliat tot fișierul, nu doar ce se vede.
  const folds = [['foldall', 'victor-vsc.foldAll', 'Collapse All'],
                 ['unfoldall', 'victor-vsc.unfoldAll', 'Expand All']].map(([id, command, name]) => {
    const item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, -2000003);
    item.name = name;
    item.text = name;
    item.command = command;
    context.subscriptions.push(item);
    return item;
  });

  // Click pe rotiță: tot o intrare ascunsă, apăsată de workbench.js. Există doar
  // cât e pornit modul — după ea știe workbench.js că rotița nu mai e ⌘-click.
  const next = vscode.window.createStatusBarItem('advance', vscode.StatusBarAlignment.Right, -2000004);
  next.name = 'Next Line';
  next.text = 'Next Line';
  next.command = 'victor-vsc.presentationAdvance';
  context.subscriptions.push(next, vscode.commands.registerCommand('victor-vsc.presentationAdvance', advance));

  // Zoom-ul de la intrare (vezi `longestLines`): textul e payload-ul pentru
  // workbench.js, codat ca un `$(` din notițe să nu devină iconiță.
  const fit = vscode.window.createStatusBarItem('fit', vscode.StatusBarAlignment.Right, -2000005);
  fit.name = 'Presentation Fit';
  const zooms = [['zoomin', 1], ['zoomout', -1]].map(([id, dir]) => {
    const item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, -2000006);
    item.name = item.text = id;
    item.command = `victor-vsc.presentation.${id}`;
    context.subscriptions.push(item, vscode.commands.registerCommand(item.command, zoom(dir)));
    return item;
  });
  context.subscriptions.push(fit);

  const sync = () => {
    for (const item of [marker, ...folds, next, ...zooms]) if (on) item.show(); else item.hide();
    const ed = vscode.window.activeTextEditor;
    if (on && ed) {
      const tabSize = typeof ed.options.tabSize === 'number' ? ed.options.tabSize : 4;
      const lines = longestLines(ed.document.lineCount, (i) => ed.document.lineAt(i).text, tabSize);
      fit.text = encodeURIComponent(JSON.stringify({ at: Date.now(), lines }));
      fit.show();
    } else fit.hide();
    return vscode.commands.executeCommand('setContext', STATE, on);
  };
  sync();

  // Stratul MEMORY trăiește în workbench, `on` în extension host. Un restart doar
  // de extension host (fără Reload Window) reactivează extensia cu `on = false`,
  // dar lasă setările de prezentare aplicate: taburi și activity bar ascunse, fără
  // fundal, iar ⌘F12 *pornea* modul în loc să-l oprească. Deci la activare
  // aliniem fereastra la `on = false`; după un Reload Window stratul e gol oricum.
  vscode.commands.getCommands(true).then((ids) => {
    if (ids.includes(MEMORY_CONFIG)) {
      vscode.commands.executeCommand(MEMORY_CONFIG,
        Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, null])));
    }
  });

  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.togglePresentation', async () => {
    if (!(await vscode.commands.getCommands(true)).includes(MEMORY_CONFIG)) {
      // Bundle-ul workbench-ului se servește din cache la Reload Window, deci
      // după `apply.sh` comanda apare abia după ⌘Q + relansare.
      vscode.window.showErrorMessage('Vic Presentation: comanda din patch nu e încărcată — repornește VS Code (⌘Q + relansare, Reload Window nu ajunge); dacă tot nu merge, rulează vscode-patch/apply.sh.');
      return;
    }
    on = !on;
    presenting = on;
    visitedLines = new Map();
    await vscode.commands.executeCommand(MEMORY_CONFIG,
      Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, on ? v : null])));
    // Ieșind din prezentare cu Zen (F12) rămas pornit, fereastra arăta tot
    // „blocată" în prezentare — Zen ascunde și el taburile și activity bar-ul.
    // Comanda nu face nimic fără Zen.
    if (!on) await vscode.commands.executeCommand('workbench.action.exitZenMode');
    if (!on) while (zoomSteps) await zoom(-Math.sign(zoomSteps))();
    if (on) paint(vscode.window.activeTextEditor); else unpaint();
    await sync();
  }));
}

module.exports = { register, isPresenting, nextStop, isAhead, longestLines, expandTabs, sectionAround, sectionAbove, chapterOf, whiteOnBlank, lineWithParents, indentOf, subtract };
