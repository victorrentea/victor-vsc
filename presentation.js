const vscode = require('vscode');

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
// alb pe ce spui acum, gri pe blocul curent, abia vizibil în rest.
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

/** Capitolul secțiunii [start, end]: cel mai de sus părinte al ultimei linii. */
function chapterOf([start, end], textAt, tabSize = 4) {
  return lineWithParents(end, start, textAt, tabSize)[0];
}

const STATE = 'victorVsc.presentation';

// Inline, nu `isWholeLine`: un decor pe toată linia se desenează pe stratul din
// spatele textului, deci opacitatea și culoarea lui n-ar atinge literele (vezi
// și range-focus.js). Pe span-urile de text, da.
let cursorDeco = null;
let fadeDeco = null;
let dimDeco = null;

function lineRange(doc, a, b) {
  return new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
}

function paint(editor) {
  if (!editor) return;
  const doc = editor.document;
  const textAt = (i) => doc.lineAt(i).text;
  const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
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
  const bright = new Set(editor.selections.map((sel) => sel.active.line));
  const fade = [];
  const [start, end] = section;
  for (const l of lineWithParents(cursor, start, textAt, tabSize)) bright.add(l);
  if (start > 0) fade.push(lineRange(doc, 0, start - 1));
  if (end < doc.lineCount - 1) fade.push(lineRange(doc, end + 1, doc.lineCount - 1));
  const dim = [];
  for (let l = start; l <= end; l++) if (!bright.has(l)) dim.push(lineRange(doc, l, l));
  editor.setDecorations(cursorDeco, [...bright].map((l) => lineRange(doc, l, l)));
  editor.setDecorations(dimDeco, dim);
  editor.setDecorations(fadeDeco, fade);
}

function unpaint() {
  for (const editor of vscode.window.visibleTextEditors) {
    try {
      editor.setDecorations(cursorDeco, []);
      editor.setDecorations(fadeDeco, []);
      editor.setDecorations(dimDeco, []);
    } catch { /* editorul s-a închis */ }
  }
}
const MEMORY_CONFIG = 'victor-vsc.memoryConfig';

function register(context) {
  // Extension host-ul e unul per fereastră, deci o variabilă e exact starea
  // ferestrei ăsteia.
  let on = false;

  cursorDeco = vscode.window.createTextEditorDecorationType({ color: CURSOR_COLOR });
  fadeDeco = vscode.window.createTextEditorDecorationType({ opacity: FADE });
  dimDeco = vscode.window.createTextEditorDecorationType({ opacity: DIM });
  context.subscriptions.push(cursorDeco, fadeDeco, dimDeco,
    vscode.window.onDidChangeTextEditorSelection((e) => { if (on) paint(e.textEditor); }),
    vscode.window.onDidChangeActiveTextEditor((ed) => { if (on) paint(ed); }),
    // Un rând gol scris sau șters mută granițele secțiunii.
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (on && ed && ed.document === e.document) paint(ed);
    }));

  // Semnalul pentru patch-ul din workbench (vscode-patch/workbench.css): cât e
  // pornit modul, intrarea asta există în DOM, iar CSS-ul pune fundalul peste
  // editor. Extensia n-are acces la DOM, deci nu poate pune ea o clasă.
  const marker = vscode.window.createStatusBarItem('presentation', vscode.StatusBarAlignment.Right, -2000002);
  marker.name = 'Vic Presentation';
  marker.text = '$(device-desktop)';
  context.subscriptions.push(marker);

  const sync = () => {
    if (on) marker.show(); else marker.hide();
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
    await vscode.commands.executeCommand(MEMORY_CONFIG,
      Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, on ? v : null])));
    // Ieșind din prezentare cu Zen (F12) rămas pornit, fereastra arăta tot
    // „blocată" în prezentare — Zen ascunde și el taburile și activity bar-ul.
    // Comanda nu face nimic fără Zen.
    if (!on) await vscode.commands.executeCommand('workbench.action.exitZenMode');
    if (on) paint(vscode.window.activeTextEditor); else unpaint();
    await sync();
  }));
}

module.exports = { register, sectionAround, sectionAbove, chapterOf, whiteOnBlank, lineWithParents, indentOf };
