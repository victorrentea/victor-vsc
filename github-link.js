const vscode = require('vscode');
const path = require('path');
const { repoRoot, remoteUrl, currentRef, relativeToRoot } = require('./git');

// git@github.com:victorrentea/petclinic.git
// https://github.com/victorrentea/petclinic.git
// ssh://git@github.com/victorrentea/petclinic
function githubSlug(url) {
  const match = url.match(/github\.com[:/]+(.+?)(?:\.git)?$/);
  return match ? match[1] : undefined;
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
  const root = await repoRoot(cwd);
  const remote = await remoteUrl(root);
  if (!remote) throw new Error('repo-ul nu are niciun remote');
  const slug = githubSlug(remote);
  if (!slug) throw new Error(`remote-ul nu e pe GitHub: ${remote}`);

  const kind = isDirectory ? 'tree' : 'blob';
  const encodedRef = encodeURIComponent(await currentRef(root));
  const encodedPath = relativeToRoot(root, uri.fsPath).split('/').filter(Boolean)
    .map(encodeURIComponent).join('/');

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
