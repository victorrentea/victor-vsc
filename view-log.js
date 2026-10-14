const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Jurnalul de vizualizare: ce linii din ce fișier am avut pe ecran, și când.
// Ca să poată răspunde un agent la „ce linie din ce fișier am privit aseară?"
// (ex. până unde am ajuns cu notițele într-un talk fără înregistrare).
//
// Un „segment" = o perioadă în care editorul activ și liniile vizibile au rămas
// neschimbate. În el, cursorul poate umbla: se ține cât a stat pe fiecare linie
// (`cursor: [[linie, secunde], …]`) — la un talk din notițe, linia cursorului e
// ideea despre care vorbesc. Se scrie când se mută ce se vede (dacă a stat pe loc
// cel puțin MIN_DWELL_MS — scroll-ul care trece nu e privit), când fereastra
// pierde focusul și, ca un crash să nu piardă mult, cel mult la MAX_SEGMENT_MS.
//
// Liniile se mută cu editările, deci fiecare segment ține și hash-ul textului de
// atunci; textul însuși se scrie o singură dată per conținut în `snapshots/`.
// Așa, `view-log.py` arată exact textul care era pe ecran, nu pe cel de azi.
//
// ~/.victor-vsc/view-log/YYYY-MM-DD.jsonl  — un segment pe rând (ora locală)
// ~/.victor-vsc/view-log/snapshots/<sha1>.txt
// Se păstrează RETENTION_DAYS zile; snapshot-urile nereferite se șterg odată cu ele.

const ROOT = path.join(os.homedir(), '.victor-vsc', 'view-log');
const SNAPSHOTS = path.join(ROOT, 'snapshots');
const MIN_DWELL_MS = 1500;
const MAX_SEGMENT_MS = 2 * 60 * 1000;
const RETENTION_DAYS = 8;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
// Se loghează că a fost privit, dar textul nu ajunge pe disc.
const SECRET_NAME = /(^|[\\/])(\.env[^\\/]*|[^\\/]*(secret|credential|password|token)[^\\/]*|[^\\/]*\.(pem|key|p12|keystore))$/i;

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Ce se vede acum într-un editor, ca obiect comparabil. Liniile sunt 1-based. */
function viewOf(editor, focused, presenting = false) {
  return {
    file: editor.document.uri.fsPath,
    visible: editor.visibleRanges.map((r) => [r.start.line + 1, r.end.line + 1]),
    focused,
    presenting,
  };
}

/** Aceeași privire = același fișier, aceleași linii pe ecran; cursorul nu contează. */
function sameView(a, b) {
  return !!a && !!b && a.file === b.file && a.focused === b.focused && a.presenting === b.presenting
    && JSON.stringify(a.visible) === JSON.stringify(b.visible);
}

function newSegment(view, startMs, line, selection) {
  const seg = { start: startMs, view, cursor: { line, since: startMs }, dwell: new Map(), selections: [] };
  noteSelection(seg, selection);
  return seg;
}

/** Cursorul a ajuns pe `line` (1-based) la `nowMs`. */
function moveCursor(seg, line, nowMs) {
  if (line === seg.cursor.line) return;
  seg.dwell.set(seg.cursor.line, (seg.dwell.get(seg.cursor.line) || 0) + nowMs - seg.cursor.since);
  seg.cursor = { line, since: nowMs };
}

function noteSelection(seg, selection) {
  if (!selection) return;
  const last = seg.selections[seg.selections.length - 1];
  if (last && last[0] === selection[0] && last[1] === selection[1]) return;
  seg.selections.push(selection);
  if (seg.selections.length > 20) seg.selections.shift();
}

/** Rândul de jurnal pentru un segment terminat, sau null dacă a fost prea scurt. */
function segmentRecord(seg, endMs, sha) {
  if (!seg || endMs - seg.start < MIN_DWELL_MS) return null;
  const dwell = new Map(seg.dwell);
  dwell.set(seg.cursor.line, (dwell.get(seg.cursor.line) || 0) + endMs - seg.cursor.since);
  let cursor = [...dwell].map(([line, ms]) => [line, Math.round(ms / 1000)]).filter(([, sec]) => sec >= 1);
  if (!cursor.length) cursor = [[seg.cursor.line, 0]];
  const v = seg.view;
  const rec = { from: new Date(seg.start).toISOString(), to: new Date(endMs).toISOString(),
    seconds: Math.round((endMs - seg.start) / 1000), file: v.file, visible: v.visible, cursor };
  if (seg.selections.length) rec.selections = seg.selections;
  if (!v.focused) rec.focused = false;
  if (v.presenting) rec.presenting = true;
  if (sha) rec.sha = sha;
  return rec;
}

/** Fișierele de zi mai vechi decât `keepDays` zile față de `nowMs`. */
function expiredDays(names, nowMs, keepDays) {
  const cutoff = dayOf(nowMs - keepDays * 86400000);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) < cutoff);
}

const isLogged = (doc) => doc && doc.uri.scheme === 'file' && !doc.uri.fsPath.includes(`${path.sep}.git${path.sep}`)
  && !doc.uri.fsPath.startsWith(ROOT);

function snapshot(doc) {
  if (SECRET_NAME.test(doc.uri.fsPath)) return null;
  const text = doc.getText();
  if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) return null;
  const sha = crypto.createHash('sha1').update(text).digest('hex');
  const file = path.join(SNAPSHOTS, `${sha}.txt`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(SNAPSHOTS, { recursive: true });
    fs.writeFileSync(file, text);
  }
  return sha;
}

function prune(nowMs) {
  try {
    const names = fs.readdirSync(ROOT);
    for (const n of expiredDays(names, nowMs, RETENTION_DAYS)) fs.unlinkSync(path.join(ROOT, n));
    const kept = new Set();
    for (const n of fs.readdirSync(ROOT)) {
      if (!n.endsWith('.jsonl')) continue;
      for (const m of fs.readFileSync(path.join(ROOT, n), 'utf8').matchAll(/"sha":"([0-9a-f]{40})"/g)) kept.add(m[1]);
    }
    // O zi de grație: un snapshot proaspăt e scris înaintea rândului care îl referă.
    for (const n of fs.existsSync(SNAPSHOTS) ? fs.readdirSync(SNAPSHOTS) : []) {
      const f = path.join(SNAPSHOTS, n);
      if (!kept.has(n.replace(/\.txt$/, '')) && nowMs - fs.statSync(f).mtimeMs > 86400000) fs.unlinkSync(f);
    }
  } catch { /* jurnalul nu are voie să strice nimic */ }
}

function register(context, isPresenting = () => false) {
  let seg = null;  // newSegment(...) + editor
  let maxTimer = null;

  function close(endMs) {
    if (!seg) return;
    const done = seg;
    seg = null;
    clearTimeout(maxTimer);
    if (endMs - done.start < MIN_DWELL_MS) return;
    try {
      const sha = done.editor.document.isClosed ? null : snapshot(done.editor.document);
      const rec = segmentRecord(done, endMs, sha);
      if (!rec) return;
      fs.mkdirSync(ROOT, { recursive: true });
      fs.appendFileSync(path.join(ROOT, `${dayOf(done.start)}.jsonl`), JSON.stringify(rec) + '\n');
    } catch { /* idem */ }
  }

  // Doar editorul activ, și doar cât fereastra e în față: o fereastră din spate
  // nu e privită. Excepția: Vic Presentation — pe proiector se vede și nefocusată,
  // deci acolo se loghează și din spate, marcat `focused: false`.
  function observe() {
    const now = Date.now();
    const editor = vscode.window.activeTextEditor;
    const focused = vscode.window.state.focused;
    const presenting = isPresenting();
    const view = editor && isLogged(editor.document) && (focused || presenting) ? viewOf(editor, focused, presenting) : null;
    const sel = view && editor.selection;
    const line = sel && sel.active.line + 1;
    const selection = sel && !sel.isEmpty ? [sel.start.line + 1, sel.end.line + 1] : null;
    if (seg && seg.editor === editor && sameView(seg.view, view)) {
      moveCursor(seg, line, now);
      noteSelection(seg, selection);
      return;
    }
    close(now);
    if (!view) return;
    seg = Object.assign(newSegment(view, now, line, selection), { editor });
    maxTimer = setTimeout(() => { close(Date.now()); observe(); }, MAX_SEGMENT_MS);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(observe),
    vscode.window.onDidChangeTextEditorSelection(observe),
    vscode.window.onDidChangeTextEditorVisibleRanges(observe),
    vscode.window.onDidChangeWindowState(observe),
    vscode.workspace.onDidCloseTextDocument(observe),
    { dispose: () => close(Date.now()) },
  );

  prune(Date.now());
  const pruner = setInterval(() => prune(Date.now()), PRUNE_EVERY_MS);
  context.subscriptions.push({ dispose: () => clearInterval(pruner) });
  observe();
}

module.exports = { register, viewOf, sameView, newSegment, moveCursor, noteSelection, segmentRecord, expiredDays, SECRET_NAME, MIN_DWELL_MS };
