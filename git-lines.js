const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { git } = require('./git');

// Câte LINII s-au schimbat, nu doar câte fișiere.
//
// Capul fiecărui grup din Source Control („Changes", „Staged Changes") are un
// badge cu numărul de FIȘIERE, pus de extensia `vscode.git` din
// `group.resources.length`. Nicio extensie nu poate scrie în capul ăla: grupul e
// desenat de workbench, nu de noi, iar API-ul `vscode.scm` te lasă să-ți faci
// propriul SourceControl, nu să-l decorezi pe al altuia.
//
// Deci împărțim munca: aici calculăm numerele, iar vscode-patch/workbench.js le
// desenează în DOM, chiar în stânga badge-ului. Canalul dintre ele e o intrare de
// status bar cu id explicit (`victorrentea.victor-vsc.gitlines`), ascunsă din CSS
// — exact manevra deja folosită pentru butonul de unelte. E singurul canal care
// nu cere nici server, nici relaxarea CSP-ului din workbench.html: renderer-ul
// citește un textContent care oricum ajunge la el.
//
// Format: `Changes=142/38|Staged Changes=10/2`, adică `<eticheta grupului>=
// <adăugate>/<șterse>`, separate prin `|`. Cheia e chiar `group.label`, ca
// workbench.js să nu ghicească ce grup e rândul pe care-l decorează — el compară
// pur și simplu cu textul din `.name`.
const ITEM_ID = 'gitlines';

// Fișierele netrack-uite n-au diff: git nu știe nimic despre ele, deci liniile
// le numărăm noi. Plafoanele sunt acolo ca un `node_modules/` scăpat de sub
// .gitignore să nu blocheze extension host-ul la fiecare salvare.
const MAX_UNTRACKED_FILES = 500;
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

function countLines(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) return 0;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return 0;   // binar — git l-ar raporta tot cu `-`
    let lines = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
    if (buf.length && buf[buf.length - 1] !== 10) lines++;
    return lines;
  } catch {
    return 0;   // șters între `ls-files` și citire
  }
}

/** Suma coloanelor din `git diff --numstat`. Binarele apar ca `-` și se sar. */
function sumNumstat(stdout) {
  let added = 0, removed = 0;
  for (const line of stdout.split('\n')) {
    const [a, d] = line.split('\t');
    if (a === undefined || d === undefined) continue;
    if (a === '-' || d === '-') continue;
    added += Number(a) || 0;
    removed += Number(d) || 0;
  }
  return { added, removed };
}

async function untrackedLines(root) {
  const stdout = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  let added = 0;
  for (const rel of files) added += countLines(path.join(root, rel));
  return { added, removed: 0 };
}

const add = (into, key, { added, removed }) => {
  const cur = into.get(key) || { added: 0, removed: 0 };
  into.set(key, { added: cur.added + added, removed: cur.removed + removed });
};

async function countsFor(root, into) {
  const [staged, unstaged, untracked] = await Promise.all([
    git(root, ['diff', '--cached', '--numstat']).then(sumNumstat),
    git(root, ['diff', '--numstat']).then(sumNumstat),
    untrackedLines(root),
  ]);

  add(into, 'Staged Changes', staged);
  add(into, 'Changes', unstaged);

  // Unde aterizează fișierele noi depinde de setare: `mixed` (implicit) le pune
  // în „Changes", `separate` le dă grup propriu, `hidden` nu le arată deloc.
  // Numărăm liniile în același loc în care extensia de git numără fișierele,
  // altfel cele două cifre de pe același rând ar vorbi despre lucruri diferite.
  const mode = vscode.workspace.getConfiguration('git').get('untrackedChanges');
  if (mode === 'separate') add(into, 'Untracked Changes', untracked);
  else if (mode !== 'hidden') add(into, 'Changes', untracked);
}

function encode(counts) {
  return [...counts]
    .filter(([, c]) => c.added || c.removed)
    .map(([label, c]) => `${label}=${c.added}/${c.removed}`)
    .join('|');
}

function register(context) {
  const item = vscode.window.createStatusBarItem(ITEM_ID, vscode.StatusBarAlignment.Right, -2000001);
  item.name = 'Git lines changed';
  item.text = '';
  item.show();
  context.subscriptions.push(item);

  let seq = 0;
  async function refresh(api) {
    const mine = ++seq;
    const counts = new Map();
    // Mai multe repo-uri în aceeași fereastră au fiecare capul lui de grup, cu
    // aceeași etichetă. Le adunăm: pe o fereastră cu un singur repo — cazul
    // obișnuit — suma e chiar cifra exactă, iar pe mai multe rămâne singurul
    // răspuns care nu e greșit pentru niciun rând.
    for (const repo of api.repositories) {
      try { await countsFor(repo.rootUri.fsPath, counts); } catch { /* repo dispărut */ }
    }
    if (mine !== seq) return;
    item.text = encode(counts);
  }

  const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  async function start() {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) return;
    const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);

    // Un `git status` la fiecare tastă apăsată n-ar aduce nimic: badge-ul de
    // fișiere se mișcă și el abia după ce extensia de git reface starea.
    const update = debounce(() => refresh(api), 400);

    const watch = (repo) => context.subscriptions.push(repo.state.onDidChange(update));
    api.repositories.forEach(watch);
    context.subscriptions.push(
      api.onDidOpenRepository((repo) => { watch(repo); update(); }),
      api.onDidCloseRepository(update),
    );
    update();
  }

  start().catch(() => { /* fără extensia de git nu avem ce număra */ });
}

module.exports = { register };
