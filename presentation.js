const vscode = require('vscode');

// „Vic Presentation" (⌘F12, și în meniul View): doar codul și numerele de linie
// pe ecran — fără taburi, activity bar, status bar și title bar.
//
// Zen Mode (F12) e apropiat, dar Victor îl folosește zilnic cu propriile
// `zenMode.*` din package.json (status bar, numere de linie, fără taburi),
// deci modul ăsta e separat.
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

// Pornit = setările globale chiar arată modul. Nu `globalState`: setarea de
// context (bifa din View) e per fereastră, iar starea ținută de o fereastră nu
// ajunge sigur și în celelalte. Așa, când o fereastră intra în mod, celelalte
// rămâneau nebifate, iar „debifarea" din alta *intra* încă o dată — și ținea
// minte ca „înainte" chiar setările de prezentare, din care nu mai ieșea.
// Setările globale se schimbă în toate ferestrele deodată, deci și bifa.
function isOn() {
  return vscode.workspace.getConfiguration().inspect('workbench.editor.showTabs')?.globalValue === 'none';
}

function register(context) {
  // Semnalul pentru patch-ul din workbench (vscode-patch/workbench.css): cât e
  // pornit modul, intrarea asta există în DOM, iar CSS-ul pune fundalul peste
  // editor. Extensia n-are acces la DOM, deci nu poate pune ea o clasă.
  const marker = vscode.window.createStatusBarItem('presentation', vscode.StatusBarAlignment.Right, -2000002);
  marker.name = 'Vic Presentation';
  marker.text = '$(device-desktop)';
  context.subscriptions.push(marker);
  const syncContext = () => {
    if (isOn()) marker.show(); else marker.hide();
    return vscode.commands.executeCommand('setContext', STATE, isOn());
  };
  const apply = async (values) => {
    const config = vscode.workspace.getConfiguration();
    for (const [key, value] of Object.entries(values)) {
      await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
    }
  };
  syncContext();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('workbench.editor.showTabs')) syncContext();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.togglePresentation', async () => {
    const config = vscode.workspace.getConfiguration();
    if (isOn()) {
      // Doar cheile de acum: o stare scrisă de o versiune mai veche poate avea
      // chei pe care VS Code nu le mai acceptă. Fără stare ținută minte (sau cu
      // una care e chiar prezentarea), scoatem cheile cu totul.
      const previous = context.globalState.get(STATE) || {};
      await apply(Object.fromEntries(Object.keys(SETTINGS).map(k =>
        [k, previous[k] === SETTINGS[k] ? null : previous[k]])));
      await context.globalState.update(STATE, undefined);
      // Zen Mode (F12) ascunde și el taburile și activity bar-ul, dar e ținut
      // per fereastră: ieșind din prezentare cu Zen rămas pornit, fereastra
      // arăta tot „blocată" în prezentare. Comanda nu face nimic fără Zen.
      await vscode.commands.executeCommand('workbench.action.exitZenMode');
    } else {
      const before = {};
      for (const key of Object.keys(SETTINGS)) before[key] = config.inspect(key)?.globalValue ?? null;
      await context.globalState.update(STATE, before);
      try {
        await apply(SETTINGS);
      } catch (err) {
        await apply(before).catch(() => {});
        await context.globalState.update(STATE, undefined);
        vscode.window.showErrorMessage(`Vic Presentation: ${err.message}`);
      }
    }
    await syncContext();
  }));
}

module.exports = { register };
