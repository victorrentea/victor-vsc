const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');

// VS Code pornit din Finder moștenește PATH-ul de la launchd, care n-are
// Homebrew; git-ul din Command Line Tools e însă mereu la calea absolută.
const GIT = ['git', '/usr/bin/git'];

async function git(cwd, args) {
  let lastError;
  for (const bin of GIT) {
    try {
      return await new Promise((resolve, reject) => {
        execFile(bin, args, { cwd }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// git@github.com:victorrentea/petclinic.git
// https://github.com/victorrentea/petclinic.git
// ssh://git@github.com/victorrentea/petclinic
function githubSlug(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]+(.+?)(?:\.git)?$/);
  return match ? match[1] : undefined;
}

// Remote-ul pe care urmărește branșa curentă, dacă are unul; altfel `origin`,
// altfel primul remote existent — un fork clonat cu alt nume tot trebuie să dea
// un link, nu o eroare.
async function remoteUrl(cwd) {
  const candidates = [];
  try {
    const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    candidates.push(upstream.split('/')[0]);
  } catch { /* branșă fără upstream */ }
  candidates.push('origin');
  const all = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
  candidates.push(...all);
  for (const name of candidates) {
    if (!all.includes(name)) continue;
    return git(cwd, ['remote', 'get-url', name]);
  }
  return undefined;
}

// Branșa curentă, ca în bara de stare. Pe HEAD detașat `--abbrev-ref` întoarce
// literal "HEAD", care n-ar duce nicăieri pe GitHub — acolo cade pe SHA.
async function ref(cwd) {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch === 'HEAD' ? git(cwd, ['rev-parse', 'HEAD']) : branch;
}

// Ancora de linii, doar când fișierul e chiar cel din editorul activ și are o
// selecție. Din Explorer nu există o linie „curentă", deci link-ul rămâne curat.
function lineAnchor(uri) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uri.toString()) return '';
  const { start, end } = editor.selection;
  if (editor.selection.isEmpty) return '';
  const last = end.character === 0 ? end.line - 1 : end.line;
  return start.line === last ? `#L${start.line + 1}` : `#L${start.line + 1}-L${last + 1}`;
}

async function linkFor(uri) {
  const stat = await vscode.workspace.fs.stat(uri);
  const isDirectory = stat.type === vscode.FileType.Directory;
  // Pentru un folder, git-ul se interoghează chiar din el: pe rădăcina unui
  // repo clonat direct în ~/workspace, părintele nu mai e sub versionare.
  const cwd = isDirectory ? uri.fsPath : path.dirname(uri.fsPath);
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const remote = await remoteUrl(root);
  if (!remote) throw new Error('repo-ul nu are niciun remote');
  const slug = githubSlug(remote);
  if (!slug) throw new Error(`remote-ul nu e pe GitHub: ${remote}`);

  const relative = path.relative(root, uri.fsPath).split(path.sep).filter(Boolean);
  const kind = isDirectory ? 'tree' : 'blob';
  const encodedRef = encodeURIComponent(await ref(root));
  const encodedPath = relative.map(encodeURIComponent).join('/');

  // Rădăcina repo-ului n-are cale — /tree/<branch> e forma corectă acolo.
  const suffix = encodedPath ? `/${encodedPath}` : '';
  return `https://github.com/${slug}/${kind}/${encodedRef}${suffix}${lineAnchor(uri)}`;
}

async function copyGitHubLink(uri, uris) {
  // Din Explorer vin (item-ul pe care s-a dat click, toată selecția); din
  // paleta de comenzi nu vine nimic, deci se cade pe editorul activ.
  const targets = (uris && uris.length ? uris : [uri || vscode.window.activeTextEditor?.document.uri])
    .filter(Boolean);
  if (!targets.length) {
    vscode.window.showWarningMessage('Copy GitHub Link: niciun fișier selectat.');
    return;
  }
  try {
    const links = [];
    for (const target of targets) links.push(await linkFor(target));
    await vscode.env.clipboard.writeText(links.join('\n'));
    vscode.window.setStatusBarMessage(
      links.length === 1 ? `Copiat: ${links[0]}` : `Copiate ${links.length} linkuri GitHub`,
      5000,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Copy GitHub Link: ${err.message}`);
  }
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.copyGitHubLink', copyGitHubLink),
  );
}

module.exports = { register };
