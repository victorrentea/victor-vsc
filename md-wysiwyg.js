const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');

/**
 * Markdown editabil direct în forma randată, ca în Cursor: un editor Tiptap (ProseMirror) peste
 * același fișier. Ca și la Cursor, sursa de adevăr rămâne documentul text: dirty, hot exit, autoSave,
 * git și tab-ul text deschis alături merg ca pentru orice fișier. Partea de editor stă în
 * `md-wysiwyg/` și se bundle-uiește în `media/md-wysiwyg/`.
 *
 * Aspectul e al preview-ului pe care îl înlocuiește: `markdown.css` și `highlight.css` se iau din
 * extensia nativă de Markdown, deci urmează VS Code la fiecare update.
 */
const VIEW_TYPE = 'victor-vsc.mdWysiwyg';
const ZOOM_KEY = 'victor-vsc.mdWysiwyg.zoom';
const FLUSH_TIMEOUT_MS = 500;

const open = new Map();                 // uri -> Set de panouri deschise pe acel fișier
const pendingReveal = new Map();        // uri -> linia la care să se deschidă
let store = null;

const lf = text => text.replace(/\r\n?/g, '\n');

function nonce() {
  return crypto.randomBytes(16).toString('base64');
}

/** Înlocuiește doar porțiunea diferită, ca decorațiile, cursorul tab-ului text și undo-ul să rămână locale. */
function minimalEdit(document, wanted) {
  const current = document.getText();
  if (current === wanted) return null;
  let start = 0;
  const shortest = Math.min(current.length, wanted.length);
  while (start < shortest && current[start] === wanted[start]) start++;
  let end = 0;
  while (end < shortest - start
    && current[current.length - 1 - end] === wanted[wanted.length - 1 - end]) end++;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(current.length - end)),
    wanted.slice(start, wanted.length - end));
  return edit;
}

function html(webview, context, document, boot) {
  const media = file => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'md-wysiwyg', file));
  const native = vscode.extensions.getExtension('vscode.markdown-language-features')?.extensionUri;
  const nativeCss = native
    ? ['markdown.css', 'highlight.css'].map(file =>
      `<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(native, 'media', file))}">`).join('\n')
    : '';
  const preview = vscode.workspace.getConfiguration('markdown.preview', document.uri);
  const vars = [
    `--markdown-font-family: ${preview.get('fontFamily') || 'inherit'}`,
    `--markdown-font-size: ${preview.get('fontSize') || 14}px`,
    `--markdown-line-height: ${preview.get('lineHeight') || 1.6}`,
  ].join('; ');
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${boot.nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${nativeCss}
<link rel="stylesheet" href="${media('katex.min.css')}">
<link rel="stylesheet" href="${media('editor.css')}">
</head>
<body class="vscode-body" style="${vars}">
<textarea id="mdw-frontmatter" hidden spellcheck="false" aria-label="YAML frontmatter"></textarea>
<div id="mdw-editor"></div>
<script id="mdw-boot" type="application/json">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script nonce="${boot.nonce}" src="${media('editor.js')}"></script>
</body>
</html>`;
}

function directoryUri(webview, uri) {
  return `${webview.asWebviewUri(vscode.Uri.joinPath(uri, '..'))}/`;
}

class Panel {
  constructor(document, webviewPanel, context) {
    this.document = document;
    this.panel = webviewPanel;
    this.known = lf(document.getText());
    this.waiting = new Map();
    this.nextId = 0;
    this.disposables = [];

    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      // Imaginile dintr-un `.md` pot sta oriunde pe disc (`../../poze/x.png`, `/Users/…`).
      // Scripturile rămân limitate de CSP la bundle-ul nostru.
      localResourceRoots: [vscode.Uri.file('/')],
    };
    const key = nonce();
    const readOnly = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === false;
    webview.html = html(webview, context, document, {
      nonce: key,
      readOnly,
      baseUri: directoryUri(webview, document.uri),
      rootUri: `${webview.asWebviewUri(vscode.Uri.file('/'))}`,
      assets: {
        mermaid: `${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'md-wysiwyg', 'mermaid.min.js'))}`,
        katex: `${webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'md-wysiwyg', 'katex.min.js'))}`,
      },
    });

    this.disposables.push(
      webview.onDidReceiveMessage(message => this.onMessage(message)),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === document && event.contentChanges.length) this.onDocumentChange();
      }),
      vscode.workspace.onWillSaveTextDocument(event => {
        if (event.document === document) event.waitUntil(this.flush());
      }),
    );
    webviewPanel.onDidDispose(() => this.dispose());
  }

  post(message) {
    return this.panel.webview.postMessage(message);
  }

  /** Cere webview-ului ceva și așteaptă răspunsul; un panou mort sau ascuns nu blochează salvarea. */
  ask(type) {
    return new Promise(resolve => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.waiting.delete(id); resolve(undefined); }, FLUSH_TIMEOUT_MS);
      this.waiting.set(id, value => { clearTimeout(timer); this.waiting.delete(id); resolve(value); });
      this.post({ type, id });
    });
  }

  flush() {
    return this.ask('flush');
  }

  onMessage(message) {
    switch (message.type) {
      case 'ready': return this.load();
      case 'edit': return this.applyEdit(message.text);
      case 'open': return this.openHref(message.href);
      case 'zoom': return this.setZoom(message.px);
      case 'flushed': return this.waiting.get(message.id)?.();
      case 'topLine': return this.waiting.get(message.id)?.(message.line);
      default: return undefined;
    }
  }

  load() {
    const id = this.document.uri.toString();
    const line = pendingReveal.get(id);
    pendingReveal.delete(id);
    this.known = lf(this.document.getText());
    this.post({ type: 'load', text: this.known, zoom: store?.get(ZOOM_KEY), line });
  }

  async applyEdit(text) {
    this.known = text;
    const eol = this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = minimalEdit(this.document, eol === '\n' ? text : text.replace(/\n/g, eol));
    if (edit) await vscode.workspace.applyEdit(edit);
  }

  onDocumentChange() {
    const text = lf(this.document.getText());
    if (text === this.known) return;           // ecoul propriei editări
    this.known = text;
    this.post({ type: 'external', text });
  }

  async openHref(href) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const [target, fragment] = href.split('#');
    const match = /^L?(\d+)/.exec(fragment || '');
    const decoded = decodeURIComponent(target);
    let uri;
    if (/^file:/i.test(target)) uri = vscode.Uri.parse(target);
    else if (path.isAbsolute(decoded)) {
      const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
      const inFolder = folder && vscode.Uri.joinPath(folder.uri, decoded);
      uri = inFolder && await exists(inFolder) ? inFolder : vscode.Uri.file(decoded);
    } else uri = vscode.Uri.joinPath(this.document.uri, '..', decoded);
    const line = match ? Number(match[1]) - 1 : undefined;
    const options = line === undefined ? {} : { selection: new vscode.Range(line, 0, line, 0) };
    await vscode.commands.executeCommand('vscode.open', uri, options);
  }

  setZoom(px) {
    store?.update(ZOOM_KEY, px);
    for (const panels of open.values()) {
      for (const panel of panels) if (panel !== this) panel.post({ type: 'zoom', px });
    }
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    const id = this.document.uri.toString();
    open.get(id)?.delete(this);
    if (!open.get(id)?.size) open.delete(id);
  }
}

async function exists(uri) {
  try { await vscode.workspace.fs.stat(uri); return true; } catch (_) { return false; }
}

class Provider {
  constructor(context) { this.context = context; }

  resolveCustomTextEditor(document, webviewPanel) {
    const panel = new Panel(document, webviewPanel, this.context);
    const id = document.uri.toString();
    if (!open.has(id)) open.set(id, new Set());
    open.get(id).add(panel);
  }
}

/** Linia din capul panoului deschis pe `uri`, ca butonul ⇄ să nu te arunce la începutul fișierului. */
async function topLine(uri) {
  const panel = [...(open.get(uri.toString()) || [])].find(p => p.panel.active) ?? [...(open.get(uri.toString()) || [])][0];
  return panel ? panel.ask('topLine') : undefined;
}

function revealOnOpen(uri, line) {
  if (line > 0) pendingReveal.set(uri.toString(), line);
}

function register(context) {
  store = context.globalState;
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new Provider(context), {
      supportsMultipleEditorsPerDocument: true,
      // Istoria de undo și poziția trăiesc în webview; la o schimbare de tab n-au voie să moară.
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
    }),
  );
}

module.exports = { VIEW_TYPE, register, topLine, revealOnOpen };
