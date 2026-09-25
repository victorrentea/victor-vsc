const vscode = require('vscode');

// „Vic Presentation" (⌘F12, și în meniul View): doar codul și numerele de linie
// pe ecran — fără taburi, activity bar, status bar și title bar.
//
// Zen Mode ar fi fost locul natural, dar Victor îl folosește zilnic cu activity
// bar-ul vizibil (vezi `zenMode.*` din package.json), deci modul ăsta e separat.
// VS Code nu are o comandă care să ascundă părțile astea fără să scrie în
// settings.json (nici toggle-urile lui din fabrică), așa că le scriem și noi,
// dar ținem minte ce era înainte și punem înapoi exact aceea la ieșire —
// `undefined` înseamnă „cheia nu era în fișier" și o scoate la loc.
//
// Title bar-ul nu se poate ascunde pe macOS într-o fereastră normală; cu
// `customTitleBarVisibility: windowed` dispare doar în full screen, de-aia
// modul intră și în full screen.
const SETTINGS = {
  'workbench.editor.showTabs': 'none',
  'workbench.activityBar.location': 'hidden',
  'workbench.statusBar.visible': false,
  'window.customTitleBarVisibility': 'windowed',
  // Golul din stânga numerelor: glyph margin-ul (breakpoint-uri) + coloana
  // de padding pentru 3 cifre. Între numere și cod: săgețile de folding.
  'editor.glyphMargin': false,
  'editor.folding': false,
  'editor.lineNumbersMinChars': 1,
};
const STATE = 'victorVsc.presentation';

function register(context) {
  const saved = () => context.globalState.get(STATE);
  vscode.commands.executeCommand('setContext', STATE, !!saved());

  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.togglePresentation', async () => {
    const config = vscode.workspace.getConfiguration();
    const previous = saved();
    if (previous) {
      for (const key of Object.keys(SETTINGS)) {
        await config.update(key, previous[key] ?? undefined, vscode.ConfigurationTarget.Global);
      }
      await context.globalState.update(STATE, undefined);
    } else {
      const before = {};
      for (const key of Object.keys(SETTINGS)) before[key] = config.inspect(key)?.globalValue ?? null;
      await context.globalState.update(STATE, before);
      for (const [key, value] of Object.entries(SETTINGS)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
    await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
    await vscode.commands.executeCommand('setContext', STATE, !previous);
  }));
}

module.exports = { register };
