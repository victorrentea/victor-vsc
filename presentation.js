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
// Title bar-ul rămâne: pe macOS se poate ascunde doar în full screen, iar full
// screen-ul mută fereastra pe un Space propriu — la ieșire nu mai stătea pe
// Space-ul celorlalte ferestre VS Code și ⌘` nu mai trecea între ele.
const SETTINGS = {
  'workbench.editor.showTabs': 'none',
  'workbench.activityBar.location': 'hidden',
  'workbench.statusBar.visible': false,
  // Golul din stânga numerelor e glyph margin-ul (breakpoint-uri). Padding-ul
  // de 3 cifre al numerelor rămâne: `lineNumbersMinChars` nu e setare
  // înregistrată (scrierea ei pică cu „not a registered configuration"),
  // editorul de text îl codează fix pe 3.
  //
  // Folding-ul rămâne pornit intenționat: coloana lui e singurul spațiu dintre
  // numere și cod (săgețile apar doar la hover). Fără ea textul se lipea de
  // numere, iar `lineDecorationsWidth`, care ar fi dat spațiul direct, nu e nici
  // ea setare înregistrată.
  'editor.glyphMargin': false,
};
const STATE = 'victorVsc.presentation';

function register(context) {
  const saved = () => context.globalState.get(STATE);
  const apply = async (values) => {
    const config = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(values)) {
      await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
    }
  };
  // Starea ținută minte fără setările care o confirmă (o intrare picată la
  // jumătate, sau setările schimbate de mână) ar face ca următorul ⌘F12 să
  // „iasă" dintr-un mod în care nu e — și să intre în full screen.
  if (saved() && vscode.workspace.getConfiguration().inspect('workbench.editor.showTabs')?.globalValue !== 'none') {
    context.globalState.update(STATE, undefined);
  }
  vscode.commands.executeCommand('setContext', STATE, !!saved());

  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.togglePresentation', async () => {
    const config = vscode.workspace.getConfiguration();
    const previous = saved();
    if (previous) {
      // Doar cheile de acum: o stare scrisă de o versiune mai veche poate avea
      // chei pe care VS Code nu le mai acceptă.
      await apply(Object.fromEntries(Object.keys(SETTINGS).map(k => [k, previous[k]])));
      await context.globalState.update(STATE, undefined);
    } else {
      const before = {};
      for (const key of Object.keys(SETTINGS)) before[key] = config.inspect(key)?.globalValue ?? null;
      try {
        await apply(SETTINGS);
      } catch (err) {
        await apply(before).catch(() => {});
        vscode.window.showErrorMessage(`Vic Presentation: ${err.message}`);
        return;
      }
      await context.globalState.update(STATE, before);
    }
    await vscode.commands.executeCommand('setContext', STATE, !previous);
  }));
}

module.exports = { register };
