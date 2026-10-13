const vscode = require('vscode');
const { foldsFromVisible, shiftFolds } = require('./talk-notes');

// Doar în Vic Presentation, în fișierele text simplu (notițele): săgeata de pliere
// stă și după textul rândului-antet — `>` când e pliat, `v` când e desfăcut — pe
// lângă cea din gutter. De pe ultimul rând al sălii se vede la capătul titlului,
// nu doar într-o coloană îngustă lângă numere.
//
// `>`-ul e chiar `⋯`-ul lui VS Code de după un rând pliat, redesenat din
// `vscode-patch/workbench.css`; click-ul pe el deplică, nativ. `v`-ul nu are
// echivalent nativ (VS Code nu marchează regiunile desfăcute), deci îl punem noi ca
// decorație `after` pe capătul antetelor desfăcute. Click-ul pe el îl prinde
// `vscode-patch/workbench.js` (decorațiile nu primesc click) și apasă intrarea de
// status bar `foldline` din presentation.js → `victor-vsc.foldLine` de aici.
//
// Ce e pliat se deduce din `visibleRanges`, ca în talk-notes.js: doar în viewport;
// antetul de pe ultimul rând vizibil își ține ultima stare știută (implicit desfăcut).

const CHEVRON_DOWN = '';   // codicon chevron-down (60084)

let type = null;
let on = false;
const files = new Map();         // fsPath → Map(linie antet → pliat?)

const isNotes = (doc) => doc && doc.languageId === 'plaintext';

function paint(editor) {
  on = true;
  if (!editor || !type) return;
  const doc = editor.document;
  if (!isNotes(doc)) { editor.setDecorations(type, []); return; }
  const ranges = editor.visibleRanges.map((r) => [r.start.line, r.end.line]);
  const folds = foldsFromVisible(ranges, doc.lineCount, (i) => doc.lineAt(i).text, files.get(doc.uri.fsPath) || new Map());
  files.set(doc.uri.fsPath, folds);
  const marks = [];
  for (const [start, end] of ranges) {
    for (let l = start; l <= end; l++) {
      if (folds.has(l) && !folds.get(l)) {
        const len = doc.lineAt(l).text.length;
        marks.push(new vscode.Range(l, len, l, len));
      }
    }
  }
  editor.setDecorations(type, marks);
}

function clear() {
  on = false;
  if (!type) return;
  for (const editor of vscode.window.visibleTextEditors) {
    try { editor.setDecorations(type, []); } catch { /* editorul s-a închis */ }
  }
}

function register(context) {
  type = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: CHEVRON_DOWN,
      color: new vscode.ThemeColor('editor.foldPlaceholderForeground'),
      // Fontul codicon și grosimea săgeților din gutter intră pe la textDecoration,
      // ca în bullets.js — `after` n-are fontFamily. 15.5px, ca `>`-ul de pe rândurile
      // pliate (workbench.css): cele două săgeți de după text au aceeași mărime.
      textDecoration: 'none; font-family: codicon; font-size: 15.5px; -webkit-text-stroke: 0.9px currentColor; margin-left: 0.3em; vertical-align: middle; cursor: pointer',
    },
  });
  context.subscriptions.push(type,
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (on && e.textEditor === vscode.window.activeTextEditor) paint(e.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const folds = files.get(e.document.uri.fsPath);
      if (!folds) return;
      let next = folds;
      for (const c of e.contentChanges) {
        next = shiftFolds(next, c.range.start.line, c.range.end.line, c.text.split('\n').length - 1);
      }
      files.set(e.document.uri.fsPath, next);
    }),
    // Click pe `v`: workbench.js apasă intrarea după mouseup, când cursorul a
    // ajuns deja pe rând, deci pliem regiunea care începe acolo.
    vscode.commands.registerCommand('victor-vsc.foldLine', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      await vscode.commands.executeCommand('editor.fold', { levels: 1, selectionLines: [ed.selection.active.line] });
    }),
  );
}

module.exports = { register, paint, clear, CHEVRON_DOWN };
