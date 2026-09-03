// Open a file as a *diff* — a committed revision on the left, the working tree on
// the right — inside this window.
//
// The Human Review guide's Auto-fixed tab links every applied fix this way. A snippet
// shows the code that is there now, which answers "what does it say" and not "what did
// you change": judging whether a fix was a real finding or the agent overfitting means
// seeing the delta. `serve-review.py` already does this over its own loopback endpoint,
// but only for a guide it is *serving* — a guide opened straight off disk from Chrome
// has no channel to any server, and that is how the report is actually read. The
// extension's URI handler is that missing channel, and this is the work it does.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// A ref, and nothing that could be read as a flag or a second argument. `git` is spawned
// without a shell, so this is not about quoting — it is about `--upload-pack=…` and
// friends arriving from a query string that anything on this machine can compose.
const REF_RE = /^[0-9a-fA-F]{7,40}$/;

function git(cwd, args, encoding) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { encoding: encoding || 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

/** Is `file` inside one of this window's workspace folders? The same containment test the
 *  router outside uses, asked from in here — a window must not be talked into opening a
 *  tree it has nothing to do with. */
function ownedHere(file) {
  for (const folder of vscode.workspace.workspaceFolders || []) {
    for (const root of new Set([folder.uri.fsPath, safeReal(folder.uri.fsPath)])) {
      const withSep = root.endsWith(path.sep) ? root : root + path.sep;
      if (file === root || file.startsWith(withSep)) return true;
    }
  }
  return false;
}

function safeReal(p) {
  try { return fs.realpathSync(p); } catch (_) { return p; }
}

/**
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 *
 * Refuses rather than improvises. If the ref does not resolve, or the file did not exist
 * in it, or the two sides are identical, there is no diff to show — and a diff with an
 * invented left half is worse than no diff, because it looks exactly like evidence.
 */
async function openDiff({ file, base, focus = true }) {
  if (!file || !path.isAbsolute(file)) return { ok: false, error: 'absolute path required' };
  if (!REF_RE.test(base || '')) return { ok: false, error: 'not a usable git ref' };
  if (!ownedHere(safeReal(file)) && !ownedHere(file)) {
    return { ok: false, error: 'that path is not in this window' };
  }
  let after;
  try { after = fs.readFileSync(file); } catch (_) {
    return { ok: false, error: `${path.basename(file)} is no longer in the working tree` };
  }

  const root = (await git(path.dirname(file), ['rev-parse', '--show-toplevel']) || '').trim();
  if (!root) return { ok: false, error: 'that file is not in a git repository' };
  const rel = path.relative(root, file);
  if (rel.startsWith('..')) return { ok: false, error: 'that file is outside the repository' };

  const shown = await git(root, ['show', `${base}:${rel}`], 'buffer');
  if (shown === null) return { ok: false, error: `${path.basename(file)} does not exist at ${base.slice(0, 8)}` };
  if (Buffer.from(shown).equals(after)) {
    return { ok: false, error: `${path.basename(file)} is unchanged since ${base.slice(0, 8)}` };
  }

  // Named `<stem>@<short><ext>` rather than `<name>@<short>`, so the extension survives
  // and the left pane keeps its syntax highlighting — and so the tab reads
  // `Owner@cb0988f5.java ↔ Owner.java`, which says what is being compared.
  //
  // Beside the report when there is one, matching where serve-review.py puts it so the two
  // routes do not each leave their own copy; otherwise in a temp dir. Unlike the served
  // route, *where* it lands no longer decides which window opens it — `vscode.diff` runs
  // in this extension host, so the window is already settled.
  const short = base.slice(0, 8);
  const parsed = path.parse(rel);
  const reportDir = path.join(root, '.human-review');
  const holder = fs.existsSync(reportDir) ? reportDir : path.join(os.tmpdir(), 'victor-vsc-diffbase');
  const before = path.join(holder, '.diffbase', short, parsed.dir, `${parsed.name}@${short}${parsed.ext}`);
  try {
    fs.mkdirSync(path.dirname(before), { recursive: true });
    fs.writeFileSync(before, shown);
  } catch (e) {
    return { ok: false, error: `could not write the before-image: ${e.message}` };
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(before), vscode.Uri.file(file),
    `${parsed.name}@${short}${parsed.ext} ↔ ${path.basename(file)}`,
    { preview: false },
  );
  if (focus) {
    try { await vscode.commands.executeCommand('workbench.action.focusWindow'); } catch (_) { /* the diff is open regardless */ }
  }
  return { ok: true };
}

module.exports = { openDiff, ownedHere, REF_RE };
