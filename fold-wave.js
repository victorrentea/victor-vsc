const vscode = require('vscode');

// Doar în Vic Presentation (îl cheamă presentation.js): pe rândul cursorului, când
// e un antet pliat, un val galben trece încet prin text de la stânga la dreapta —
// „aici e ceva de deschis", împreună cu săgeata `>` din gutter care clipește în
// galben (vscode-patch/workbench.css, `victor-fold-blink`).
//
// Valul pornește la fiecare maxim al clipitului: clipitul e 1.6s `alternate`, deci
// săgeata e plină la 0, 3.2s, 6.4s…, iar valul are aceeași perioadă — amândouă
// încep când cursorul ajunge pe rând (sau rândul se pliază). Valul sare peste
// maximul de la 0: rândul pe care tocmai ai pus cursorul e întâi alb de tot. Fiecare caracter își animă culoarea alb → galben → alb (keyframes
// `victor-fold-wave` din workbench.css), cu o întârziere proporțională cu coloana.
// O decorație pe caracter, câte un tip pe coloană, fiindcă întârzierea e în CSS-ul
// tipului. Nu `background-clip: text` cu un gradient care alunecă: ăla cere text
// transparent, iar emoji-urile ar fi ieșit siluete albe.
//
// Culoarea vine din animație, deci rândul ăsta nu poate primi și albul lui
// presentation.js: VS Code pune `!important` pe `color` din decorații, iar
// `!important` bate animațiile. presentation.js îl scoate din `cursorDeco` cât
// valul e pe el.
//
// Ce e pliat nu spune API-ul; se vede din `visibleRanges` (ca în talk-notes.js): un
// rând care încheie un interval vizibil urmat de un gol e pliat.
const PERIOD_S = 3.2;           // = 2 × 1.6s din victor-fold-blink
const CHARS_PER_S = 25;         // viteza valului
const PEAK_S = 0.384;           // 12% din perioadă: când ajunge galbenul la maxim pe un caracter
const COLUMNS = 160;            // dincolo, toate caracterele primesc întârzierea ultimei coloane

/** Rândul `line` e ultimul dintr-un interval vizibil și după el urmează un gol? */
function isFoldedAt(ranges, line) {
  for (let k = 0; k + 1 < ranges.length; k++) {
    if (ranges[k][1] === line) return ranges[k + 1][0] > line + 1;
  }
  return false;
}

/** [coloana vizuală, offset UTF-16, lungime] pentru fiecare caracter ne-alb. */
function charsOf(text) {
  const out = [];
  let col = 0, at = 0;
  for (const ch of text) {
    if (!/\s/u.test(ch)) out.push([col, at, ch.length]);
    col++;
    at += ch.length;
  }
  return out;
}

let types = null;
let last = null;                // ce e desenat acum: {editor, line, text, used}

// Primul val vine abia la al doilea maxim al clipitului: cât cursorul tocmai a ajuns
// pe rând, rândul e alb de tot (fill-mode `both` ține 0%-ul, alb, cât durează
// întârzierea). Primul caracter atinge galbenul exact la maxim.
function delayOf(col) {
  return (PERIOD_S - PEAK_S + col / CHARS_PER_S).toFixed(3);
}

function clear() {
  if (!last) return;
  try {
    for (const i of last.used) last.editor.setDecorations(types[i], []);
  } catch { /* editorul s-a închis */ }
  last = null;
}

/** Desenează valul pe rândul cursorului dacă e pliat; întoarce rândul, sau -1. */
function paint(editor) {
  if (!editor || !types) { clear(); return -1; }
  const line = editor.selection.active.line;
  const ranges = editor.visibleRanges.map((r) => [r.start.line, r.end.line]);
  if (!editor.selection.isEmpty || !isFoldedAt(ranges, line)) { clear(); return -1; }
  const text = editor.document.lineAt(line).text;
  // Aceleași decorații din nou ar re-randa rândul și ar reporni animația, decalată
  // față de clipitul săgeții — de ex. la fiecare mișcare a cursorului pe rând.
  if (last && last.editor === editor && last.line === line && last.text === text) return line;
  clear();
  const byType = new Map();
  for (const [col, at, len] of charsOf(text)) {
    const i = Math.min(col, COLUMNS - 1);
    if (!byType.has(i)) byType.set(i, []);
    byType.get(i).push(new vscode.Range(line, at, line, at + len));
  }
  for (const [i, rs] of byType) editor.setDecorations(types[i], rs);
  last = { editor, line, text, used: [...byType.keys()] };
  return line;
}

function register(context) {
  types = Array.from({ length: COLUMNS }, (_, col) => vscode.window.createTextEditorDecorationType({
    textDecoration: `none; animation: victor-fold-wave ${PERIOD_S}s linear ${delayOf(col)}s infinite both`,
  }));
  context.subscriptions.push(...types);
}

module.exports = { register, paint, clear, isFoldedAt, charsOf };
