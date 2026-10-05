// „PR" în status bar: e servit acum un Human Review al checkout-ului din fereastra asta?
//
//   gri    — există `.human-review/review.html`, dar niciun serve-review.py nu-l servește
//   verde  — un server viu servește `<folder>/.human-review`, iar HEAD-ul checkout-ului e
//            commit-ul revizuit (`data-hr-head` de pe <html> din review.html)
//   amber  — servit, dar checkout-ul e pe alt commit: link-urile din pagină deschid doar
//            fișierele neschimbate de atunci
//   ascuns — fereastra n-are niciun review pe disc (n-are rost un „PR" gri în fiecare
//            fereastră)
//
// Detecția, de ce exact așa:
// - `.server.json` (scris de serve-review.py lângă review.html) dă portul și pid-ul. E doar
//   un indiciu — supraviețuiește unui `kill -9`, iar portul poate fi între timp al altcuiva.
// - Dovada e marker-ul (`GET /__human_review__`): cheia `humanReview`, `served` = exact
//   directorul nostru, `pid` = cel din fișier. Se întreabă O SINGURĂ DATĂ per (port, pid):
//   orice GET în afară de /__watch__ și /__editor__ resetează ceasul de `--idle-minutes`
//   al serverului, deci un poll pe marker la 10 s l-ar ține viu la nesfârșit.
// - După verificare, fiecare tick face doar `kill(pid, 0)` + citește fișierul: zero
//   rețea. Serverul care se oprește normal își șterge `.server.json`; unul omorât lasă
//   fișierul, dar pid-ul moare — gri în ambele cazuri.
// Un singur timer per fereastră: 10 s cât e servit, apoi 5 → 10 → 20 → 30 s când nu e
// nimic; un FileSystemWatcher pe `.server.json`/`review.html`, focusul ferestrei și orice
// schimbare de HEAD din extensia git dau refresh imediat.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { git } = require('./git');

const DIR = '.human-review';
const PAGE = 'review.html';
const IDENTITY = '.server.json';
const MARKER = '/__human_review__';
const MARKER_KEY = 'humanReview';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Ce a ștampilat build-ul pe <html> și în <title>; stă în primii ~1 KB dintr-un fișier de
// câțiva MB, deci se citește doar capul, și doar când i s-a schimbat mtime-ul.
const stampCache = new Map();
function readStamp(page) {
  let st;
  try { st = fs.statSync(page); } catch { return null; }
  const hit = stampCache.get(page);
  if (hit && hit.mtime === st.mtimeMs) return hit.stamp;
  let head = '';
  try {
    const fd = fs.openSync(page, 'r');
    try {
      const buf = Buffer.alloc(8192);
      head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const attr = (name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(head) || [])[1] || '';
  const title = ((/<title>([^<]*)<\/title>/i.exec(head) || [])[1] || '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
  const stamp = { sha: attr('data-hr-head'), branch: attr('data-hr-branch'), title: title.trim() };
  stampCache.set(page, { mtime: st.mtimeMs, stamp });
  return stamp;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function getMarker(port, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: MARKER, timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 1 << 20) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, answered: true });
        try { resolve({ ok: true, info: JSON.parse(body) }); }
        catch { resolve({ ok: false, answered: true }); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false, answered: false }));
  });
}

async function checkoutHead(folder) {
  try {
    const [head, ref] = (await git(folder, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'])).split('\n');
    return { head, branch: ref === 'HEAD' ? 'detached' : ref };
  } catch { return null; }
}

/**
 * Starea review-ului pentru un workspace folder. Fără `vscode`, ca să se poată rula din
 * node împotriva serverelor vii. `memo` ține verificările de marker între tick-uri:
 * `verified` = cheile (dir|port|pid) confirmate, `rejected` = cele la care a răspuns
 * altcineva (nu le mai întrebăm — n-are rost să-i resetăm ceasul de idle).
 */
async function probeFolder(folder, memo = { verified: new Set(), rejected: new Set() }) {
  const dir = path.join(folder, DIR);
  const page = path.join(dir, PAGE);
  const stamp = readStamp(page);
  if (!stamp) return { state: 'none', folder };
  const base = { folder, dir, title: stamp.title, reviewed: { sha: stamp.sha, branch: stamp.branch } };

  const rec = readJson(path.join(dir, IDENTITY));
  const port = rec && rec.port, pid = rec && rec.pid;
  if (!Number.isInteger(port) || !pidAlive(pid)) return { state: 'off', ...base };
  let real;
  try { real = fs.realpathSync(dir); } catch { real = dir; }
  const key = `${real}|${port}|${pid}`;
  if (memo.rejected.has(key)) return { state: 'off', ...base };
  if (!memo.verified.has(key)) {
    const m = await getMarker(port);
    const info = m.ok && m.info;
    if (info && info[MARKER_KEY] && info.served === real && info.pid === pid) {
      memo.verified.add(key);
    } else {
      if (m.answered || info) memo.rejected.add(key);  // altcineva pe port: nu mai întrebăm
      return { state: 'off', ...base };
    }
  }

  const live = { ...base, port, pid, url: `http://127.0.0.1:${port}/${PAGE}` };
  const co = await checkoutHead(folder);
  live.checkout = co;
  const at = !stamp.sha || (co && co.head && co.head.startsWith(stamp.sha));
  return { state: at ? 'on' : 'near', ...live };
}

const RANK = { none: 0, off: 1, near: 2, on: 3 };

/** Cel mai „aprins" dintre folderele ferestrei (multi-root: unul servit bate unul gri). */
async function probeFolders(folders, memo) {
  let best = { state: 'none' };
  for (const f of folders) {
    const s = await probeFolder(f, memo);
    if (RANK[s.state] > RANK[best.state]) best = s;
  }
  return best;
}

// --------------------------------------------------------------------------- UI

const short = (sha) => (sha || '').slice(0, 8);
const where = (b, sha) => `${b ? b + ' @ ' : ''}${short(sha) || '?'}`;

function serveCommand() {
  const local = path.join(os.homedir(), 'workspace/human-review/skills/human-review/scripts/serve-review.py');
  return `${fs.existsSync(local) ? 'python3 ' + local : 'serve-review.py'} ${DIR}`;
}

function register(context) {
  const vscode = require('vscode');
  // Stânga, imediat după intrările native de SCM (branch + sync, prioritatea 10000):
  // „PR" stă lângă branch-ul pe care îl revizuiește.
  const item = vscode.window.createStatusBarItem('humanreview', vscode.StatusBarAlignment.Left, 9999);
  item.name = 'Human Review';
  context.subscriptions.push(item);

  const memo = { verified: new Set(), rejected: new Set() };
  let current = { state: 'none' };
  let timer, idle = 0, running = false, again = false, disposed = false;

  function paint(s) {
    current = s;
    if (s.state === 'none') { item.hide(); return; }
    const name = path.basename(s.folder);
    const md = new vscode.MarkdownString(undefined, true);
    md.supportThemeIcons = true;
    const title = s.title ? `**${s.title.replace(/[\\`*_[\]<>]/g, '\\$&')}**\n\n` : '';
    const reviewed = where(s.reviewed && s.reviewed.branch, s.reviewed && s.reviewed.sha);
    if (s.state === 'off') {
      item.text = '👱🏻‍♂️review';
      item.color = new vscode.ThemeColor('disabledForeground');
      md.appendMarkdown(`$(circle-outline) Human Review — not served\n\n${title}`
        + `${name}/${DIR}/${PAGE} reviews ${reviewed}, but no review server is serving it.\n\n`
        + 'Click: how to serve it.');
    } else {
      item.text = '👱🏻‍♂️review $(circle-filled)';
      const co = s.checkout ? where(s.checkout.branch, s.checkout.head) : 'unknown';
      if (s.state === 'on') {
        item.color = new vscode.ThemeColor('testing.iconPassed');
        md.appendMarkdown(`$(pass-filled) Human Review — served on :${s.port}\n\n${title}`
          + `Reviewing ${reviewed}, which is what this checkout has.\n\n`);
      } else {
        item.color = new vscode.ThemeColor('editorWarning.foreground');
        md.appendMarkdown(`$(warning) Human Review — served on :${s.port}, other commit\n\n${title}`
          + `Reviewing ${reviewed}, but this checkout is on ${co}: `
          + 'links in the page open only files unchanged since.\n\n');
      }
      md.appendMarkdown(`Click: open ${s.url} in the browser.`);
    }
    item.tooltip = md;
    item.command = 'victor-vsc.humanReviewStatus';
    item.show();
  }

  async function tick() {
    if (disposed) return;
    clearTimeout(timer);
    if (running) { again = true; return; }
    running = true;
    try {
      const folders = (vscode.workspace.workspaceFolders || [])
        .filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
      const s = await probeFolders(folders, memo);
      paint(s);
      idle = s.state === 'on' || s.state === 'near' ? 0 : idle + 1;
    } catch { /* tick-ul următor încearcă din nou */ }
    running = false;
    if (again) { again = false; return tick(); }
    // Servit: 10 s, cât să prindă un server oprit. Nimic: 5 → 10 → 20 → 30 s, iar un
    // server nou pornit e prins oricum imediat de watcher-ul pe `.server.json`.
    const delay = idle === 0 ? 10000 : Math.min(30000, 5000 * 2 ** Math.min(idle - 1, 3));
    if (!disposed) timer = setTimeout(tick, delay);
  }
  const soon = () => { idle = Math.min(idle, 1); setTimeout(tick, 150); };

  const watchers = [];
  function rewatch() {
    watchers.splice(0).forEach((w) => w.dispose());
    for (const f of vscode.workspace.workspaceFolders || []) {
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(f, `${DIR}/{${IDENTITY},${PAGE}}`));
      w.onDidCreate(soon); w.onDidChange(soon); w.onDidDelete(soon);
      watchers.push(w);
    }
  }
  rewatch();

  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.humanReviewStatus', async () => {
      const s = current;
      if (s.state === 'on' || s.state === 'near') {
        await vscode.env.openExternal(vscode.Uri.parse(s.url));
        return;
      }
      if (s.state !== 'off') return;
      const cmd = serveCommand();
      const pick = await vscode.window.showInformationMessage(
        `No review server is serving ${path.basename(s.folder)}/${DIR}. `
        + `From the checkout, run: ${cmd} — or ask the agent to serve the review.`,
        'Copy command', 'Open from disk');
      if (pick === 'Copy command') await vscode.env.clipboard.writeText(`cd ${s.folder} && ${cmd}`);
      if (pick === 'Open from disk') await vscode.env.openExternal(vscode.Uri.file(path.join(s.dir, PAGE)));
    }),
    vscode.window.onDidChangeWindowState((st) => { if (st.focused) soon(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { rewatch(); soon(); }),
    { dispose: () => { disposed = true; clearTimeout(timer); watchers.forEach((w) => w.dispose()); } },
  );

  // HEAD mutat (checkout, commit) → verde/amber se reface imediat, nu la tick-ul următor.
  (async () => {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) return;
    try {
      const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
      let lastHeads = '';
      const onRepo = () => {
        const heads = api.repositories.map((r) => r.state.HEAD && r.state.HEAD.commit).join(',');
        if (heads !== lastHeads) { lastHeads = heads; if (current.state !== 'none') soon(); }
      };
      const watch = (r) => context.subscriptions.push(r.state.onDidChange(onRepo));
      api.repositories.forEach(watch);
      context.subscriptions.push(api.onDidOpenRepository((r) => { watch(r); onRepo(); }));
    } catch { /* fără extensia git: rămâne tick-ul */ }
  })();

  tick();
}

module.exports = { register, probeFolder, probeFolders, readStamp };
