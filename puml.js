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

/* ----------------------------------------------------------------- sidecar */

// Diagramele generate din trace-uri (`X.genseq.puml`) își poartă detaliile
// într-un frate `X.genseq.json`: pentru fiecare săgeată marcată ⊕, SQL-ul sau
// payload-ul JSON din spatele apelului. Generatorul leagă cele două prin
// `[[genseq://<id>]]`, un identificator stabil pus la generare — de-aia nimic
// de aici nu depinde de textul etichetei.
const detailsPath = fsPath => fsPath.replace(/\.[^.]+$/, '.json');

async function readDetails(fsPath) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(detailsPath(fsPath), 'utf8'));
    return parsed && parsed.details ? parsed.details : undefined;
  } catch {
    return undefined;   // diagramă fără sidecar — cazul normal
  }
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

  /* Săgețile cu detalii: aceeași afordanță ca în review.html — banda se aprinde
     la hover, iar clicul prinde pe toată lățimea ei, nu doar pe glifa pe care
     PlantUML a făcut-o link. */
  .genseq-hot { cursor: pointer; }
  .genseq-hit { fill: transparent; }
  .genseq-hot:hover .genseq-hit { fill: currentColor; fill-opacity: .07; }
  .genseq-hot.genseq-open .genseq-hit { fill: currentColor; fill-opacity: .14; }
  .genseq-hot.genseq-open a[href^="genseq:"] text { font-weight: 700; }

  #genseq { position: fixed; z-index: 40; max-width: min(38rem, 92vw); min-width: 18rem;
            padding: .55rem .7rem; border-radius: 6px;
            background: var(--vscode-editorWidget-background);
            color: var(--vscode-editorWidget-foreground);
            border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
            box-shadow: 0 4px 16px rgba(0,0,0,.35); }
  #genseq[hidden] { display: none; }
  #genseq .head { display: flex; align-items: baseline; gap: .6rem; }
  #genseq .title { font: 600 12.5px/1.5 var(--vscode-editor-font-family); flex: 1;
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #genseq .step { opacity: .7; font-size: .76rem; white-space: nowrap; }
  #genseq button { border: 1px solid var(--vscode-editorWidget-border, transparent);
                   background: var(--vscode-button-secondaryBackground, transparent);
                   color: inherit; cursor: pointer; border-radius: 4px;
                   font-size: .76rem; padding: 1px 6px; }
  #genseq button:hover { border-color: var(--vscode-focusBorder); }
  #genseq .close { border: 0; background: none; font-size: 1rem; line-height: 1; opacity: .7; }
  #genseq [hidden] { display: none; }
  #genseq .label { color: var(--vscode-textLink-foreground); font-size: .8rem; margin: .15rem 0 0; }
  #genseq pre { margin: .35rem 0 0; max-height: 24rem; overflow: auto;
                background: var(--vscode-textCodeBlock-background);
                padding: .45rem .55rem; border-radius: 4px; white-space: pre-wrap;
                font: 12px/1.5 var(--vscode-editor-font-family); }
</style></head>
<body>
  <pre id="err"></pre>
  <div id="pane"><div id="svg"></div></div>
  <div id="hint">⌘/Ctrl + scroll = zoom · dublu-click = 100%</div>
  <div id="genseq" hidden>
    <div class="head"><span class="title"></span><button type="button" class="toggle" hidden></button>
    <span class="step"></span><button type="button" class="close" title="închide (Esc)" aria-label="închide">&times;</button></div>
    <div class="label"></div><pre></pre>
  </div>
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
        wireDetails(m.details);
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

    /* ----------------------------------------------------------- genseq ----
       Portat din .human-review/review.html, ca aceeași diagramă să se citească
       la fel din review și din IDE. Un clic pe o săgeată marcată ⊕ deschide
       panoul cu SQL-ul / payload-ul apelului; încă unul îl închide.

       Unde un pas are două randări ale aceluiași fapt — statement-ul cum a fost
       trimis vs. același statement cu valorile puse la loc — panoul le oferă ca
       buton. „?" sau valorile e un fel de a citi, nu o proprietate a unei
       săgeți: cine a cerut valorile o dată citește toată diagrama în valori,
       deci alegerea e a paginii și o moștenesc toate panourile deschise după. */
    const box = document.getElementById('genseq');
    const ui = {
      title: box.querySelector('.title'),
      step: box.querySelector('.step'),
      label: box.querySelector('.label'),
      toggle: box.querySelector('.toggle'),
      body: box.querySelector('pre'),
    };
    let current = null, step = null, showValues = false;

    function closePanel() {
      if (current) current.reset();
      current = null;
      box.hidden = true;
    }

    // Butonul numește mereu CEALALTĂ randare, ca să se citească drept ce obții
    // dacă apeși. Un pas fără alternativă — un payload JSON — n-are buton.
    function render() {
      const on = showValues && !!step.alternate;
      const view = on ? step.alternate : step;
      ui.label.textContent = view.label || '';
      ui.label.hidden = !view.label;
      ui.body.textContent = view.text;
      ui.toggle.hidden = !step.alternate;
      if (step.alternate) {
        ui.toggle.textContent = on ? 'arată ?' : 'arată valorile';
        ui.toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    // Ancorat de săgeată, nu de cursor: panoul trebuie să rămână lângă ce explică.
    function place(target) {
      const r = target.getBoundingClientRect();
      box.hidden = false;
      const left = Math.min(r.left, document.documentElement.clientWidth - box.offsetWidth - 12);
      box.style.left = Math.max(8, left) + 'px';
      const below = r.bottom + 8;
      box.style.top = (below + box.offsetHeight > document.documentElement.clientHeight
        ? Math.max(8, r.top - box.offsetHeight - 8) : below) + 'px';
    }

    // Un dreptunghi transparent sub săgeată, ca să prindă clicul pe toată banda.
    function addHitArea(group) {
      let b;
      try { b = group.getBBox(); } catch (e) { return; }
      if (!b || !b.width) return;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'genseq-hit');
      rect.setAttribute('x', b.x - 4);
      rect.setAttribute('y', b.y - 1);
      rect.setAttribute('width', b.width + 8);
      rect.setAttribute('height', Math.max(b.height - 2, 6));
      rect.setAttribute('rx', '3');
      group.insertBefore(rect, group.firstChild);
    }

    function wireDetails(details) {
      closePanel();
      const map = details || {};
      host.querySelectorAll('svg a[href^="genseq://"]').forEach(link => {
        const entry = map[(link.getAttribute('href') || '').slice('genseq://'.length)];
        const group = link.closest('g.message') || link.parentNode;
        // O săgeată fără detaliu înregistrat: îi scoatem mânerul desfăcând
        // link-ul, nu ștergându-l — eticheta e înăuntrul lui.
        if (!entry || !entry.steps || !entry.steps.length) {
          while (link.firstChild) link.parentNode.insertBefore(link.firstChild, link);
          link.remove();
          return;
        }
        let index = -1;
        const state = { reset() { index = -1; group.classList.remove('genseq-open'); } };
        group.classList.add('genseq-hot');
        addHitArea(group);
        group.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          if (current && current !== state) current.reset();
          index++;
          if (index >= entry.steps.length) { closePanel(); return; }
          current = state;
          group.classList.add('genseq-open');
          step = entry.steps[index];
          ui.title.textContent = entry.title;
          ui.step.textContent = entry.steps.length > 1 ? (index + 1) + ' / ' + entry.steps.length : '';
          render();
          place(link);
        });
      });
    }

    box.querySelector('.close').addEventListener('click', closePanel);
    ui.toggle.addEventListener('click', () => { showValues = !showValues; render(); });
    box.addEventListener('click', ev => ev.stopPropagation());
    // Panoul e poziționat în coordonate de viewport, deci o diagramă mutată sub
    // el l-ar lăsa arătând spre altă săgeată.
    pane.addEventListener('scroll', closePanel);
    document.addEventListener('click', closePanel);
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePanel(); });
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
        ? { type: 'svg', svg: res.svg, details: await readDetails(document.uri.fsPath) }
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
