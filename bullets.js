const vscode = require('vscode');

// Doar în Vic Presentation: presentation.js cheamă `paint`/`clear` din paint/unpaint
// ale lui, pe editorul activ.
//
// Marcajele din notițele de curs (fișiere text simplu): primul semn de pe rând
// spune ce fel de punct e, desenat alb pe un cerc colorat: `+` verde (pro), `-`
// roșu (contra), `i` albastru (informație, ca un punct de informare). `*` rămâne
// neutru, neatins.
//
// Totul rămâne monospace și nimic nu se mută: cercul e fundalul span-ului
// semnului, lărgit cu padding orizontal și strâns înapoi cu margin negativ egal —
// un span inline cu `padding: 0 X; margin: 0 -X` ocupă exact cât litera. Padding-ul
// vertical pe un inline nu împinge rândurile. API-ul de decorații n-are padding,
// margin sau background pe span-ul de text (backgroundColor merge pe stratul de
// sub text, unde nu-l atinge opacitatea din Vic Presentation), deci CSS-ul intră
// prin `textDecoration`, pe care VS Code îl lipește ca `text-decoration:{0};`.
// Măsurat la 14px: semnul următor rămâne la exact o literă distanță, cercul are
// ~19.6×19.9px. Fără `fontWeight`: cu el, VS Code nu mai desena deloc decorația
// (span-ul semnului nici nu se mai despărțea de restul rândului) — măsurat.
//
// Semnul e alb, ca linia cursorului din Vic Presentation: VS Code pune singur
// `!important` pe orice `color` de decorație, deci pe rândul aprins două culori
// `!important` pe același span se băteau pe ordinea din stylesheet — un semn
// colorat ieșea uneori alb.
const DOT = { plus: '#2e9e4f', minus: '#d64541', info: '#2f74d0' };

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

function clear() {
  if (!types) return;
  for (const editor of vscode.window.visibleTextEditors) {
    try {
      for (const t of Object.values(types)) editor.setDecorations(t, []);
    } catch { /* editorul s-a închis */ }
  }
}

function register(context) {
  types = Object.fromEntries(Object.entries(DOT).map(([kind, bg]) => [kind,
    vscode.window.createTextEditorDecorationType({
      textDecoration: `none; color: #ffffff !important; background-color: ${bg}; border-radius: 50%; padding: 0.05em 0.4em; margin: 0 -0.4em`,
    })]));
  context.subscriptions.push(...Object.values(types));
}

module.exports = { register, paint, clear, markerOf };
