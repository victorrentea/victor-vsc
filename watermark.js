// Editorul gol (niciun fișier deschis): în locul celor 3 shortcut-uri din mijloc
// (Open Chat / Show All Commands / Start Debugging) — folderul ferestrei, relativ la
// ~/workspace, și dedesubt „Open another folder", care deschide un folder în fereastră nouă.
//
// Watermark-ul e desenat de workbench, nu de o extensie, deci DOM-ul îl face
// vscode-patch/workbench.js (`ensureWatermarkFolder`). De aici vin doar două lucruri,
// prin intrarea ascunsă de status bar `wmfolder`: textul ei e eticheta folderului,
// iar click-ul pe ea (apăsat de buton) e comanda. Ascunsă din workbench.css.
const vscode = require('vscode');
const os = require('os');
const path = require('path');

const WORKSPACE = path.join(os.homedir(), 'workspace');

/** Calea afișată: relativă la ~/workspace dacă e înăuntru, altfel cu ~ în loc de home. */
function label(fsPath) {
  const rel = path.relative(WORKSPACE, fsPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = os.homedir();
  return fsPath === home || fsPath.startsWith(home + path.sep) ? '~' + fsPath.slice(home.length) : fsPath;
}

function currentLabel() {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.map((f) => (f.uri.scheme === 'file' ? label(f.uri.fsPath) : f.name)).join(', ');
}

async function openOtherFolder() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Open in New Window',
    defaultUri: vscode.Uri.file(WORKSPACE),
  });
  if (picked && picked[0]) {
    await vscode.commands.executeCommand('vscode.openFolder', picked[0], { forceNewWindow: true });
  }
}

function register(context) {
  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.openOtherFolder', openOtherFolder));
  const item = vscode.window.createStatusBarItem('wmfolder', vscode.StatusBarAlignment.Right, -2000009);
  item.name = 'wmfolder';
  item.command = 'victor-vsc.openOtherFolder';
  // `$(` ar fi citit ca iconiță; în nume de foldere nu apare, dar nu riscăm.
  const refresh = () => { item.text = currentLabel().replace(/\$\(/g, '$​(') || '—'; };
  refresh();
  item.show();
  context.subscriptions.push(item, vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}

module.exports = { register, label };
