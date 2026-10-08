const vscode = require('vscode');

// Marcajele din notițele de curs (fișiere text simplu): primul semn de pe rând
// spune ce fel de punct e. `+` verde (pro), `-` roșu (contra), `*` neutru
// (rămâne în culoarea textului), `i` = informație: un „i" alb pe un cerc albastru,
// ca un punct de informare.
//
// Totul rămâne monospace și nimic nu se mută: cercul e fundalul span-ului
// literei, lărgit cu padding orizontal și strâns înapoi cu margin negativ egal —
// un span inline cu `padding: 0 X; margin: 0 -X` ocupă exact cât litera. Padding-ul
// vertical pe un inline nu împinge rândurile. API-ul de decorații n-are padding,
// margin sau background pe span-ul de text (backgroundColor merge pe stratul de
// sub text, unde nu-l atinge opacitatea din Vic Presentation), deci CSS-ul intră
// prin `textDecoration`, pe care VS Code îl lipește ca `text-decoration:{0};`.
//
// Culorile au `!important`: pe liniile aprinse din Vic Presentation decorația
// cursorului pune tot rândul pe alb, pe același span și cu aceeași specificitate.
// Tot prin `textDecoration`: în câmpul `color` VS Code aruncă valoarea întreagă
// dacă nu e doar o culoare, și regula iese goală.
const PLUS = '#5fc35f';
const MINUS = '#f0625a';
const INFO_BG = '#2f74d0';

/** Pentru textul unei linii: [kind, coloana] a marcajului de la început, sau null.
 *  Marcajul e primul caracter ne-alb, urmat de spațiu sau de capătul liniei. */
function markerOf(text) {
  const m = /^[ \t]*([+\-*i])(?=[ \t]|$)/.exec(text);
  if (!m) return null;
  const kind = { '+': 'plus', '-': 'minus', '*': 'star', 'i': 'info' }[m[1]];
  return [kind, m[0].length - 1];
}

let types = null;

function paint(editor) {
  if (!editor || !types) return;
  const doc = editor.document;
  const on = doc.languageId === 'plaintext';
  const ranges = { plus: [], minus: [], info: [] };
  if (on) {
    for (let i = 0; i < doc.lineCount; i++) {
      const found = markerOf(doc.lineAt(i).text);
      if (found && ranges[found[0]]) ranges[found[0]].push(new vscode.Range(i, found[1], i, found[1] + 1));
    }
  }
  for (const kind of Object.keys(types)) editor.setDecorations(types[kind], ranges[kind]);
}

function register(context) {
  types = {
    plus: vscode.window.createTextEditorDecorationType({ textDecoration: `none; color: ${PLUS} !important` }),
    minus: vscode.window.createTextEditorDecorationType({ textDecoration: `none; color: ${MINUS} !important` }),
    info: vscode.window.createTextEditorDecorationType({
      fontWeight: 'bold',
      textDecoration: `none; color: #ffffff !important; background-color: ${INFO_BG}; border-radius: 50%; padding: 0.05em 0.4em; margin: 0 -0.4em`,
    }),
  };
  context.subscriptions.push(...Object.values(types),
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(paint)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) paint(ed);
    }),
    vscode.workspace.onDidOpenTextDocument(() => vscode.window.visibleTextEditors.forEach(paint)));
  vscode.window.visibleTextEditors.forEach(paint);
}

module.exports = { register, markerOf };
