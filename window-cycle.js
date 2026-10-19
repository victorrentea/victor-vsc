// ⌃⌥Tab / ⌃⌥⇧Tab: the next / previous VS Code window, like macOS's ⌘` / ⌘⇧`.
//
// VS Code has no "next window" command — only `quickSwitchWindow`, a picker. And an
// extension can't list the app's windows: each one runs its own extension host, which
// knows only itself. What it can see is the registry every window publishes under
// ~/.walkie-talkie/ide/ (relay-terminal.js), so the cycle goes through that: ping each
// entry for its folders, order them, and ask the next one to raise itself with
// `workbench.action.focusWindow` — the same `/command` Human Review's VSC badge uses.
//
// The order is by folder path, not by z-order like ⌘`: the stacking order isn't
// observable from here, and a fixed order means repeated presses visit every window.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vscode = require('vscode');

const REGISTRY = path.join(os.homedir(), '.walkie-talkie', 'ide');

function call(entry, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: entry.port, path: pathname, method,
      headers: { 'x-relay-token': entry.token }, timeout: 1000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Every live VS Code window, this one included, in cycling order. */
async function windows() {
  let files = [];
  try { files = fs.readdirSync(REGISTRY).filter((f) => /^vscode-\d+\.json$/.test(f)); } catch (_) { return []; }
  const found = await Promise.all(files.map(async (f) => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf8'));
      const ping = await call(entry, '/ping');
      return { entry, key: (ping.folders || [])[0]?.path || '' };
    } catch (_) {
      return null; // dead or busy window: skip it, don't prune — reload-window.py owns that
    }
  }));
  return found.filter(Boolean).sort((a, b) => a.key.localeCompare(b.key) || a.entry.pid - b.entry.pid);
}

async function cycle(step) {
  const all = await windows();
  const me = all.findIndex((w) => w.entry.pid === process.pid);
  if (all.length < 2 || me < 0) return;
  const target = all[(me + step + all.length) % all.length];
  try {
    await call(target.entry, '/command?id=workbench.action.focusWindow', 'POST');
  } catch (e) {
    vscode.window.setStatusBarMessage(`next window: ${e.message}`, 3000);
  }
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.nextWindow', () => cycle(1)),
    vscode.commands.registerCommand('victor-vsc.previousWindow', () => cycle(-1)),
  );
}

module.exports = { register };
