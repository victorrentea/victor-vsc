const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const VIEW_TYPE = 'victor-vsc.pumlDiagram';
const EXTS = ['.puml', '.plantuml', '.iuml', '.wsd', '.pu'];

/* ------------------------------------------------------------------ render */

// VS Code launched from Finder inherits launchd's PATH, which on this Mac does
// not include Homebrew — so the binary is looked up by hand instead of trusting
// `plantuml` to resolve.
function binary() {
  const configured = vscode.workspace.getConfiguration('victorVsc').get('plantumlPath');
  const candidates = [configured, '/opt/homebrew/bin/plantuml', '/usr/local/bin/plantuml']
    .filter(Boolean);
  for (const c of candidates) if (path.isAbsolute(c) ? fs.existsSync(c) : true) return c;
  return 'plantuml';
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Two ways to reach PlantUML, because neither covers everything:
 *   -picoweb  a JVM that stays up, so a redraw is ~80ms instead of ~1.4s — but
 *             it renders text with no notion of a working directory, so
 *             `!include ./foo.puml` cannot resolve.
 *   -pipe     a fresh JVM per render, launched in the file's own directory, so
 *             includes work. Slow, hence only for sources that need it.
 */
class Renderer {
  constructor() { this._server = null; }

  dispose() {
    if (this._server && this._server.proc) this._server.proc.kill();
    this._server = null;
  }

  async render(text, cwd) {
    if (/^\s*!(include|import)/m.test(text)) return this._pipe(text, cwd);
    try {
      const port = await this._picoweb();
      return await this._get(port, text);
    } catch {
      return this._pipe(text, cwd);          // picoweb missing or wedged
    }
  }

  _picoweb() {
    if (this._server) return this._server.ready;
    const server = { proc: null, ready: null };
    server.ready = (async () => {
      const port = await freePort();
      const proc = spawn(binary(), [`-picoweb:${port}`], { stdio: 'ignore' });
      server.proc = proc;
      let failed = false;
      proc.on('error', () => { failed = true; });   // ENOENT: no plantuml on PATH
      proc.on('exit', () => { if (this._server === server) this._server = null; });
      // The port only listens once the JVM is up; poll rather than sleep blind.
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (await reachable(port)) return port;
        if (failed || proc.exitCode !== null) throw new Error('plantuml -picoweb unavailable');
      }
      proc.kill();
      throw new Error('plantuml -picoweb did not come up');
    })();
    this._server = server;
    server.ready.catch(() => { if (this._server === server) this._server = null; });
    return server.ready;
  }

  _get(port, text) {
    // picoweb's own hex transport: /plantuml/svg/~h<hex>, no deflate/base64 dance.
    const hex = Buffer.from(text, 'utf8').toString('hex');
    return new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/plantuml/svg/~h${hex}`, timeout: 20000 },
        res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) reject(new Error(`picoweb ${res.statusCode}`));
            else resolve({ ok: true, svg: body });
          });
        });
      req.on('timeout', () => req.destroy(new Error('picoweb timeout')));
      req.on('error', reject);
    });
  }

  _pipe(text, cwd) {
    return new Promise(resolve => {
      const proc = spawn(binary(), ['-tsvg', '-pipe', '-charset', 'UTF-8'], { cwd });
      const out = [], err = [];
      proc.stdout.on('data', c => out.push(c));
      proc.stderr.on('data', c => err.push(c));
      proc.on('error', e => resolve({ ok: false, error: `${binary()}: ${e.message}` }));
      proc.on('close', code => {
        const svg = Buffer.concat(out).toString('utf8');
        if (code === 0 && svg.includes('<svg')) resolve({ ok: true, svg });
        else resolve({ ok: false, error: Buffer.concat(err).toString('utf8') || `plantuml exited ${code}` });
      });
      proc.stdin.end(text, 'utf8');
    });
  }
}

function reachable(port) {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
}

/* ------------------------------------------------------------------ webview */

function nonce() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function html(webview) {
  const n = nonce();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}'; img-src data:;">
<style>
  html, body { height: 100%; margin: 0; background: var(--vscode-editor-background); }
  body { color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  #pane { position: absolute; inset: 0; overflow: auto; padding: 12px; box-sizing: border-box; }
  #svg { transform-origin: 0 0; }
  #svg svg { max-width: 100%; height: auto; display: block; }
  #err { display: none; white-space: pre-wrap; padding: 12px; margin: 0;
         color: var(--vscode-errorForeground); font-family: var(--vscode-editor-font-family); }
  #err.on { display: block; }
  #hint { position: fixed; right: 10px; bottom: 8px; opacity: .45; font-size: 11px; }
</style></head>
<body>
  <pre id="err"></pre>
  <div id="pane"><div id="svg"></div></div>
  <div id="hint">⌘/Ctrl + scroll = zoom · dublu-click = 100%</div>
  <script nonce="${n}">
    const pane = document.getElementById('pane');
    const host = document.getElementById('svg');
    const err = document.getElementById('err');
    let zoom = 1;
    const apply = () => host.style.transform = 'scale(' + zoom + ')';

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'svg') {
        // Scroll survives a redraw, so typing does not throw the view around.
        const { scrollLeft: x, scrollTop: y } = pane;
        host.innerHTML = m.svg;
        err.classList.remove('on');
        pane.scrollTo(x, y);
      } else if (m.type === 'error') {
        err.textContent = m.message;
        err.classList.add('on');
      }
    });

    pane.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom = Math.min(8, Math.max(0.1, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      apply();
    }, { passive: false });

    pane.addEventListener('dblclick', () => { zoom = 1; apply(); });
  </script>
</body></html>`;
}

/* ----------------------------------------------------------- custom editor */

class PumlEditorProvider {
  constructor(renderer) { this.renderer = renderer; }

  resolveCustomTextEditor(document, panel) {
    panel.webview.options = { enableScripts: true };
    panel.webview.html = html(panel.webview);

    let timer;
    const draw = async () => {
      const res = await this.renderer.render(document.getText(), path.dirname(document.uri.fsPath));
      panel.webview.postMessage(res.ok
        ? { type: 'svg', svg: res.svg }
        : { type: 'error', message: res.error });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 300); };

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) schedule();
    });
    panel.onDidDispose(() => { clearTimeout(timer); sub.dispose(); });
    draw();
  }
}

/* ----------------------------------------------------- text / split / image */

const isPuml = uri => !!uri && EXTS.includes(path.extname(uri.fsPath).toLowerCase());

/** Every tab showing `uri`, tagged by which editor is drawing it. */
function tabsFor(uri) {
  const found = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!input || !input.uri || input.uri.toString() !== uri.toString()) continue;
      const kind = input instanceof vscode.TabInputCustom ? 'diagram'
                 : input instanceof vscode.TabInputText ? 'text' : 'other';
      if (kind !== 'other') found.push({ tab, group, kind });
    }
  }
  return found;
}

/** The .puml the command should act on: the focused editor, or the focused tab. */
function targetUri() {
  const ed = vscode.window.activeTextEditor;
  if (ed && isPuml(ed.document.uri)) return ed.document.uri;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const uri = tab && tab.input && tab.input.uri;
  return isPuml(uri) ? uri : undefined;
}

/**
 * Un singur buton, două stări — exact preview-ul de Markdown: textul e ÎNLOCUIT
 * în același tab de randarea grafică, iar butonul apăsat din nou aduce textul
 * înapoi. Fără split: `vscode.openWith` pe același grup schimbă editorul pe loc,
 * cum face „Reopen Editor With…".
 *
 * Starea se citește din tab-urile deschise, nu se ține minte, ca închiderea unui
 * panou cu mâna să nu desincronizeze butonul. Tab-urile de tipul greșit rămase
 * pe undeva (dintr-un split vechi) se închid, ca fișierul să rămână într-o
 * singură reprezentare.
 */
async function toggle() {
  const uri = targetUri();
  if (!uri) {
    vscode.window.showInformationMessage('Victor VSC: fișierul activ nu e un PlantUML.');
    return;
  }
  const tabs = tabsFor(uri);
  const diagram = tabs.find(t => t.kind === 'diagram');
  const showDiagram = !diagram;   // dacă nu e nicio diagramă deschisă, o arătăm
  const column = (diagram || tabs.find(t => t.kind === 'text'))?.group.viewColumn;

  await vscode.commands.executeCommand('vscode.openWith', uri, showDiagram ? VIEW_TYPE : 'default', column);

  for (const t of tabsFor(uri)) {
    if ((t.kind === 'diagram') !== showDiagram) await vscode.window.tabGroups.close(t.tab);
  }
}

function register(context) {
  const renderer = new Renderer();
  context.subscriptions.push(
    { dispose: () => renderer.dispose() },
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new PumlEditorProvider(renderer), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('victor-vsc.togglePumlView', toggle),
  );
}

module.exports = { register };
