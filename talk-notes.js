const vscode = require('vscode');
const http = require('http');

// Notițele sesiunii, oglindite live pe telefoanele din sală (talk mode în
// training-assistant: tab-ul Notes din static/talk.html).
//
// Fereastra care are deschis un `.txt` îi spune daemonului de training
// (`POST http://127.0.0.1:1234/notes/live`) unde e cursorul, ce e selectat,
// ce regiuni sunt pliate și — doar când s-a schimbat — tot textul; plus
// `focused` când fereastra e în față cu fișierul ăla activ, semnalul că Victor
// prezintă acum din notițe, nu din slide-uri. Daemonul acceptă doar fișierul
// de notițe al sesiunii curente (răspunde `tracked: false` la orice altceva) și
// cere textul din nou (`need_text`) după un restart.
//
// API-ul de extensii nu spune ce e pliat. Se vede însă din `visibleRanges`: o
// regiune pliată rupe intervalul vizibil, deci un antet care e ultima linie a
// unui interval urmat de un gol e pliat, iar unul urmat imediat de linia lui
// de dedesubt e desfăcut. Merge doar pe ce e în viewport; antetele din afara lui
// își păstrează ultima stare știută. Collapse All / Expand All (butoanele de lângă
// semafoare) trec pe aici, deci acolo starea e știută pentru tot fișierul.

const DAEMON = { host: '127.0.0.1', port: 1234, path: '/notes/live' };
const TEXT_DEBOUNCE_MS = 300;
const CURSOR_THROTTLE_MS = 80;
const NOT_TRACKED_RECHECK_MS = 60000;
const DAEMON_DOWN_BACKOFF_MS = 5000;

const isBlank = (text) => text.trim() === '';

function indentOf(text, tabSize = 4) {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += tabSize - (width % tabSize);
    else break;
  }
  return width;
}

/** Antet de pliere (indentare): următoarea linie ne-goală e mai indentată. */
function isHeader(line, lineCount, textAt) {
  const own = textAt(line);
  if (isBlank(own)) return false;
  for (let j = line + 1; j < lineCount; j++) {
    const t = textAt(j);
    if (isBlank(t)) continue;
    return indentOf(t) > indentOf(own);
  }
  return false;
}

/** Actualizează `folds` (linie antet → pliat?) din intervalele vizibile,
 *  date ca [[start, end], …] (0-based, inclusiv, ordonate). */
function foldsFromVisible(ranges, lineCount, textAt, folds) {
  const out = new Map(folds);
  for (let k = 0; k < ranges.length; k++) {
    const [start, end] = ranges[k];
    for (let h = start; h <= end; h++) {
      if (!isHeader(h, lineCount, textAt)) continue;
      if (h < end) out.set(h, false);                              // linia de sub el se vede
      else if (k + 1 < ranges.length && ranges[k + 1][0] > h + 1) out.set(h, true);  // urmează un gol
      // ultima linie din viewport: nu se știe, rămâne cum era
    }
  }
  return out;
}

/** Mută cheile din `folds` după o editare: [startLine, endLine] înlocuit de un
 *  text cu `newLines` rânduri noi. */
function shiftFolds(folds, startLine, endLine, newLines) {
  const delta = newLines - (endLine - startLine);
  if (!delta && startLine === endLine) return folds;
  const out = new Map();
  for (const [line, collapsed] of folds) {
    if (line < startLine) out.set(line, collapsed);
    else if (line > endLine) out.set(line + delta, collapsed);
  }
  return out;
}

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ ...DAEMON, method: 'POST', timeout: 1500,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

const isNotesCandidate = (doc) => doc && doc.uri.scheme === 'file'
  && doc.languageId === 'plaintext' && doc.uri.fsPath.toLowerCase().endsWith('.txt');

function register(context) {
  // Per fișier: pliurile știute, versiunea trimisă, verdictul daemonului.
  const files = new Map();  // fsPath → { folds, sentVersion, notTrackedAt }
  const fileState = (doc) => {
    let s = files.get(doc.uri.fsPath);
    if (!s) files.set(doc.uri.fsPath, s = { folds: new Map(), sentVersion: -1, notTrackedAt: 0 });
    return s;
  };
  let daemonDownAt = 0;
  let inFlight = false;
  let pending = null;  // { editor, withText } de trimis după cererea în curs
  let throttle = null;
  let textTimer = null;

  const activeNotesEditor = () => {
    const ed = vscode.window.activeTextEditor;
    return ed && isNotesCandidate(ed.document) ? ed : null;
  };

  function refreshFolds(editor) {
    const doc = editor.document;
    const st = fileState(doc);
    const ranges = editor.visibleRanges.map((r) => [r.start.line, r.end.line]);
    st.folds = foldsFromVisible(ranges, doc.lineCount, (i) => doc.lineAt(i).text, st.folds);
  }

  async function send(editor, withText) {
    const doc = editor.document;
    const st = fileState(doc);
    const now = Date.now();
    if (now - st.notTrackedAt < NOT_TRACKED_RECHECK_MS) return;
    if (now - daemonDownAt < DAEMON_DOWN_BACKOFF_MS) return;
    if (inFlight) { pending = { editor, withText: withText || (pending && pending.withText) }; return; }
    refreshFolds(editor);
    const sel = editor.selection;
    const body = {
      path: doc.uri.fsPath,
      line: sel.active.line,
      selection: sel.isEmpty ? null : {
        start_line: sel.start.line, start_char: sel.start.character,
        end_line: sel.end.line, end_char: sel.end.character,
      },
      collapsed: [...st.folds].filter(([line, c]) => c && line < doc.lineCount).map(([line]) => line).sort((a, b) => a - b),
      focused: vscode.window.state.focused && vscode.window.activeTextEditor === editor,
    };
    const version = doc.version;
    if (withText || st.sentVersion !== version) body.text = doc.getText();
    inFlight = true;
    try {
      const res = await post(body);
      if (!res.tracked) st.notTrackedAt = Date.now();
      else if (body.text !== undefined) st.sentVersion = version;
      if (res.need_text) pending = { editor, withText: true };
    } catch {
      daemonDownAt = Date.now();
      st.sentVersion = -1;  // daemonul poate reveni fără text
    } finally {
      inFlight = false;
    }
    if (pending) {
      const next = pending;
      pending = null;
      if (vscode.window.visibleTextEditors.includes(next.editor)) send(next.editor, next.withText);
    }
  }

  // Mișcările de cursor pleacă imediat, apoi cel mult o dată la 80 ms.
  function schedule(editor) {
    if (!editor || !isNotesCandidate(editor.document)) return;
    if (throttle) { throttle.editor = editor; return; }
    send(editor, false);
    throttle = { editor: null };
    setTimeout(() => {
      const again = throttle.editor;
      throttle = null;
      if (again) schedule(again);
    }, CURSOR_THROTTLE_MS);
  }

  const forget = (doc) => { const st = files.get(doc.uri.fsPath); if (st) st.notTrackedAt = 0; };

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => schedule(e.textEditor)),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!isNotesCandidate(e.textEditor.document)) return;
      const st = fileState(e.textEditor.document);
      const before = JSON.stringify([...st.folds].filter(([, c]) => c));
      refreshFolds(e.textEditor);
      // Un simplu scroll nu schimbă nimic din ce văd telefoanele.
      if (JSON.stringify([...st.folds].filter(([, c]) => c)) !== before) schedule(e.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed) { forget(ed.document); schedule(ed); } }),
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) schedule(activeNotesEditor()); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isNotesCandidate(e.document) || !e.contentChanges.length) return;
      const st = fileState(e.document);
      for (const c of e.contentChanges) {
        st.folds = shiftFolds(st.folds, c.range.start.line, c.range.end.line, c.text.split('\n').length - 1);
      }
      clearTimeout(textTimer);
      textTimer = setTimeout(() => {
        const ed = vscode.window.visibleTextEditors.find((x) => x.document === e.document);
        if (ed) send(ed, false);
      }, TEXT_DEBOUNCE_MS);
    }),
  );

  // Collapse All / Expand All: VS Code pliază tot fișierul, nu doar ce se vede.
  const all = (command, collapsed) => async () => {
    await vscode.commands.executeCommand(command);
    const ed = activeNotesEditor();
    if (!ed) return;
    const doc = ed.document;
    const textAt = (i) => doc.lineAt(i).text;
    const folds = new Map();
    for (let i = 0; i < doc.lineCount; i++) if (isHeader(i, doc.lineCount, textAt)) folds.set(i, collapsed);
    fileState(doc).folds = folds;
    schedule(ed);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.foldAll', all('editor.foldAll', true)),
    vscode.commands.registerCommand('victor-vsc.unfoldAll', all('editor.unfoldAll', false)),
  );

  schedule(activeNotesEditor());
}

module.exports = { register, foldsFromVisible, shiftFolds, isHeader };
