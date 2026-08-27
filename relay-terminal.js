// Deliver Walkie Talkie dictations into *one specific* integrated terminal.
//
// The relay can point itself at a terminal and type every later dictation into
// it. For Terminal.app it addresses the **tty** and for tmux the **pane**, and
// neither touches the focus. A terminal inside VS Code has neither address, so
// the relay fell back to the only handle left from outside — the application's
// pid — and delivered by putting the text on the clipboard, activating VS Code,
// and pressing ⌘V.
//
// ⌘V goes wherever the caret is. Measured, on a bound IntelliJ, with the same
// mechanism VS Code uses:
//
//   caret in the bound terminal      → landed correctly
//   focus in another app entirely    → landed correctly (the app is activated)
//   caret in the editor              → **pasted into the source file**, + Return
//   caret in a second terminal tab   → landed in the wrong terminal
//
// and the relay reported `delivered` in all four, because `⌘V was sent` is the
// only thing it can observe. On 2026-08-15 that put a dictation into
// OwnerRestController.java, the backend hot-compiled it, and every POST to that
// endpoint started answering 500.
//
// From outside a window you cannot address a pane; from inside, `sendText()` is
// right there. So the relay stops guessing and asks us. This is the same
// argument, and the same shape, as the relay's Chrome extension — except the
// direction is reversed: Chrome *reports* picks to the relay, whereas here the
// relay has to *push*, so this side is the one that listens.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const vscode = require('vscode');

/** Where the relay looks for us. Fixed, and deliberately not under the relay's
 *  `--home`: that flag moves the outbox for testing, and an extension has no
 *  way to learn it was passed. */
const REGISTRY = path.join(os.homedir(), '.walkie-talkie', 'ide');

/** Terminals handed out to the relay, by the id it was given.
 *  A `Terminal` is not serialisable and its `name` is not unique — two panels
 *  are both "zsh" — so identity has to be minted here and kept here. */
const bound = new Map();
let nextId = 1;

let server = null;
let registryFile = null;

function activate(context) {
  // Port 0: the OS picks a free one and we publish it. A fixed port would have
  // to be negotiated with every other VS Code window on the machine, and each
  // window runs its own extension host.
  server = http.createServer(handle);
  server.on('error', (e) => console.error('[walkie-talkie] listener failed:', e.message));

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    // A shared secret, unlike the Chrome side which has none. What that endpoint
    // hands over is a CSS selector; what this one does is **type a line into a
    // shell and press Return**, so "any local process may call it" is a
    // different proposition. The file is 0600 in the user's home.
    const token = crypto.randomBytes(16).toString('hex');
    global.__wisprRelayToken = token;

    try {
      fs.mkdirSync(REGISTRY, { recursive: true });
      registryFile = path.join(REGISTRY, `vscode-${process.pid}.json`);
      fs.writeFileSync(registryFile, JSON.stringify({
        app: 'vscode',
        port,
        token,
        // The extension host, **not** the app the relay sees in front. The relay
        // matches by walking up from here: this process is a descendant of the
        // Code process whose pid it holds. Publishing the app's own pid is not
        // possible from in here, and guessing it is worse than saying what we
        // know and letting the other side climb.
        pid: process.pid,
        ppid: process.ppid,
      }), { mode: 0o600 });
    } catch (e) {
      console.error('[walkie-talkie] could not publish registry entry:', e.message);
    }
  });

  // A terminal the relay is pointed at can be closed while it is pointed at it.
  // Dropping it here is what turns the next delivery into an honest 404 instead
  // of a silent no-op.
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [id, term] of bound) if (term === t) bound.delete(id);
    }),
    { dispose: deactivate },
  );
}

function deactivate() {
  if (server) { try { server.close(); } catch (_) {} server = null; }
  if (registryFile) { try { fs.unlinkSync(registryFile); } catch (_) {} registryFile = null; }
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.headers['x-relay-token'] !== global.__wisprRelayToken) {
    return send(res, 403, { ok: false, error: 'bad token' });
  }

  // Which window is in front. With two VS Code windows open there are two
  // extension hosts, two listeners and two registry files, and the only one
  // that can be what Victor was looking at when he pressed ⌘⌃D is the focused
  // one. The relay pings every candidate and takes the one that says yes.
  if (req.method === 'GET' && url.pathname === '/ping') {
    return send(res, 200, {
      ok: true,
      app: 'vscode',
      focused: vscode.window.state.focused,
      folder: (vscode.workspace.workspaceFolders || [])[0]?.name || null,
    });
  }

  // Point me at the terminal that is active **right now** — the one he is
  // looking at as he presses the key.
  if (req.method === 'POST' && url.pathname === '/bind') {
    // **`activeTerminal`, and the newest terminal behind it.** That property is
    // only set once a terminal has actually held focus in this window, and it
    // is empty in the case the feature exists for: Victor clicks `+`, gets a
    // fresh shell, and presses ⌘⌃D looking straight at it — measured null here,
    // in a window whose terminal panel was open with a live zsh in it. The relay
    // then has no handle to take, falls back to pasting at whatever holds the
    // caret, and the dictation lands in the editor. The last terminal in
    // `terminals` is the one most recently created, which is exactly the one `+`
    // just made; IntelliJ's side of this bridge has always had the same fallback.
    const term = vscode.window.activeTerminal
      || vscode.window.terminals[vscode.window.terminals.length - 1];
    if (!term) return send(res, 409, { ok: false, error: 'no terminal open in this window' });
    const id = nextId++;
    bound.set(id, term);
    // `processId` is the **shell's** pid, and it is the whole reason the shell
    // guard can exist for these targets at all. From it the relay resolves a
    // tty and asks the same question it asks of a Terminal.app tab: is a shell
    // sitting at a prompt? A dictation typed at a prompt is not a prompt, it is
    // a command — "șterge tot ce e în folderul de build" said out loud is a
    // real rm. Until now IDE targets were the one place that could not be
    // checked, and `guarded: false` was the honest admission of it.
    term.processId.then(
      (pid) => send(res, 200, { ok: true, id, name: term.name, shellPID: pid || null }),
      () => send(res, 200, { ok: true, id, name: term.name, shellPID: null }),
    );
    return;
  }

  // Reload this window. Installing a new build of this very extension does
  // nothing until the extension host restarts, and the only way to ask for that
  // used to be Victor pressing ⌘⇧P himself — so every change ended with a "give
  // it a Reload Window" that he had to act on. The listener is already here and
  // already authenticated; the command is one line.
  //
  // The response is written **before** the command runs: `reloadWindow` tears
  // down this extension host, and a reply written after it is a reply written by
  // a process that is already gone. The caller gets `ok` meaning *accepted*, not
  // *finished* — there is nothing left alive here to report *finished*.
  if (req.method === 'POST' && url.pathname === '/reload') {
    send(res, 200, { ok: true, folder: (vscode.workspace.workspaceFolders || [])[0]?.name || null });
    setTimeout(() => vscode.commands.executeCommand('workbench.action.reloadWindow'), 100);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/unbind') {
    const id = Number(url.searchParams.get('id'));
    bound.delete(id);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (_) {
        return send(res, 400, { ok: false, error: 'expected JSON' });
      }
      const term = bound.get(Number(parsed.id));
      if (!term) return send(res, 404, { ok: false, error: 'that terminal is gone' });
      const line = String(parsed.line || '');
      if (!line) return send(res, 400, { ok: false, error: 'empty line' });

      // **`sendText` and not the clipboard.** It writes straight to that
      // terminal's pty: no window is activated, no focus moves, the caret stays
      // exactly where Victor left it, and the clipboard he was carrying is his
      // own.
      //
      // **The Return is written by hand, as `\r`, and `shouldExecute` is not
      // used.** That flag appends `\n` on macOS — and in a TUI in raw mode `\n`
      // is not Enter, it is *insert a newline*, which is the very convention
      // Claude Code uses for a multi-line prompt. So the dictation landed in the
      // prompt and sat there until Victor pressed Return himself. The tty paths
      // never had this: tmux's `send-keys Enter` and Terminal.app's `do script`
      // both press a real Return, which is `\r`.
      //
      // **Sent as a second write, a beat later**, for the other half of the same
      // problem: a TUI that reads `text\r` in one chunk treats it as a paste and
      // keeps the Return as text. A separate write is a keypress — which is
      // exactly why the tmux path has always been two calls.
      term.sendText(line, false);
      setTimeout(() => {
        try { term.sendText('\r', false); } catch (_) { /* the tab went away mid-flight */ }
      }, 120);
      send(res, 200, { ok: true, name: term.name });
    });
    return;
  }

  send(res, 404, { ok: false });
}

module.exports = { activate, deactivate };
