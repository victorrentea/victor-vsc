const vscode = require('vscode');
const path = require('path');
const puml = require('./puml');

const SEP = '  ›  ';

/** Deepest-first chain of symbols containing `pos`, outermost first. */
function symbolChain(symbols, pos) {
  for (const s of symbols || []) {
    if (s.range && s.range.contains(pos)) {
      return [s, ...symbolChain(s.children, pos)];
    }
  }
  return [];
}

function activate(context) {
  // A cog that opens the Command Palette on click. It lives in the status bar
  // rather than up next to the four layout controls because that strip is part
  // of the title bar, which VS Code keeps for itself — there is no contribution
  // point an extension can reach it through.
  // Below the problem counter's priority but above the bell's NEGATIVE_INFINITY,
  // so it sits between the two.
  const cog = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -2000000);
  cog.text = '$(gear)';
  cog.tooltip = 'Command Palette (⇧⌘A — Find Action, din keymap-ul IntelliJ)';
  cog.command = 'workbench.action.showCommands';
  cog.show();

  // IntelliJ puts the breadcrumb in the footer; VS Code puts it under the tabs.
  // `breadcrumbs.enabled` turns the top one off and this redraws it at the
  // bottom. Left-aligned with a priority above every other entry so it comes
  // first; only the remote indicator, which VS Code pins, stays to its left.
  const trail = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000000);
  trail.command = 'workbench.action.gotoSymbol';
  trail.tooltip = 'Go to Symbol in Editor…';

  // VS Code registers its own counter as an internal LEFT entry at priority 50
  // (`status.problems`) and exposes no way to move or reorder entries, so the
  // only route to the right end of the footer is our own entry with the native
  // one hidden by hand. NEGATIVE_INFINITY is the notification bell's priority,
  // so anything just above it lands immediately to the bell's left.
  const problems = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -1000000);
  problems.command = 'workbench.actions.view.toggleProblems';
  problems.name = 'Problems';

  function renderProblems() {
    let errors = 0, warnings = 0, infos = 0;
    for (const [, diags] of vscode.languages.getDiagnostics()) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
        else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        else if (d.severity === vscode.DiagnosticSeverity.Information) infos++;
      }
    }
    // Matches the native item, which only spells out the info count when there is one.
    problems.text = `$(error) ${errors} $(warning) ${warnings}` + (infos ? ` $(info) ${infos}` : '');
    problems.tooltip = `${errors} errors, ${warnings} warnings, ${infos} infos`;
    problems.show();
  }

  let seq = 0;
  async function render() {
    const mine = ++seq;                       // a slower symbol query must never
    const ed = vscode.window.activeTextEditor; // overwrite a newer one
    if (!ed) { trail.hide(); return; }

    const folder = vscode.workspace.getWorkspaceFolder(ed.document.uri);
    const rel = folder
      ? path.relative(path.dirname(folder.uri.fsPath), ed.document.uri.fsPath)
      : ed.document.uri.fsPath;
    const parts = rel.split(path.sep);

    let symbols = [];
    try {
      symbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider', ed.document.uri) || [];
    } catch { /* no provider for this language — path alone is still useful */ }
    if (mine !== seq) return;

    // DocumentSymbol has .children; SymbolInformation (the flat, older shape)
    // does not — only the former can produce a nested trail.
    const chain = symbols.length && symbols[0].children !== undefined
      ? symbolChain(symbols, ed.selection.active).map(s => s.name)
      : [];

    trail.text = [...parts, ...chain].join(SEP);
    trail.show();
  }

  const debounce = (fn, ms) => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  };
  const debounced = debounce(render, 120);
  // Diagnostics arrive in bursts while a language server catches up, and a full
  // recount walks every file, so this one is coarser than the breadcrumb's.
  const debouncedProblems = debounce(renderProblems, 300);

  // „Claude" în dropdown-ul de terminale, cu floricica din icons/victor-icons.woff.
  // Lista aia acceptă doar un id de icon înregistrat (codicon sau `contributes.icons`),
  // nu un SVG — de-aia floarea e un glif de font, nu un fișier.
  // Shell de login ca să prindă PATH-ul din profil; `exec` ca să nu rămână un zsh
  // părinte degeaba.
  const claudeProfile = vscode.window.registerTerminalProfileProvider('victor-vsc.claude', {
    provideTerminalProfile: () => new vscode.TerminalProfile({
      name: 'Claude',
      shellPath: vscode.env.shell || process.env.SHELL || '/bin/zsh',
      shellArgs: ['-lc', 'exec claude'],
      iconPath: new vscode.ThemeIcon('victor-flower'),
    }),
  });

  context.subscriptions.push(
    cog,
    trail,
    problems,
    claudeProfile,
    vscode.window.onDidChangeActiveTextEditor(debounced),
    vscode.window.onDidChangeTextEditorSelection(debounced),
    vscode.workspace.onDidChangeTextDocument(debounced),
    vscode.languages.onDidChangeDiagnostics(debouncedProblems),
  );
  // PlantUML: custom editor + butonul care ciclează text / split / diagramă.
  puml.register(context);

  render();
  renderProblems();
}

function deactivate() {}

module.exports = { activate, deactivate };
