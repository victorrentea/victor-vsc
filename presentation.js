const vscode = require('vscode');

// „Vic Presentation" (⌘F12, și în meniul View): doar codul și numerele de linie
// pe ecran — fără taburi, activity bar și status bar. Doar în fereastra în care
// l-ai pornit.
//
// Zen Mode (F12) e apropiat, dar Victor îl folosește zilnic cu propriile
// `zenMode.*` din package.json (status bar, numere de linie, fără taburi),
// deci modul ăsta e separat.
//
// Setările de mai jos se scriu în stratul de configurare MEMORY al ferestrei:
// e per fereastră, bate setările utilizatorului și nu ajunge pe disc. API-ul de
// extensii nu-l expune (doar Global/Workspace/WorkspaceFolder), așa că
// `vscode-patch/apply.sh` (pasul 3h) înregistrează în workbench comanda
// `victor-vsc.memoryConfig`, care face doar `updateValue(cheie, valoare, MEMORY)`.
// Versiunea veche scria în setările globale și modul se aprindea în toate
// ferestrele deodată. Bonus: un Reload Window iese singur din mod, fiindcă
// stratul MEMORY nu supraviețuiește reîncărcării.
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
  // înregistrată, editorul de text îl codează fix pe 3.
  //
  // Folding-ul rămâne pornit intenționat: coloana lui e singurul spațiu dintre
  // numere și cod (săgețile apar doar la hover). Fără ea textul se lipea de
  // numere, iar `lineDecorationsWidth`, care ar fi dat spațiul direct, nu e nici
  // ea setare înregistrată.
  'editor.glyphMargin': false,
};
const STATE = 'victorVsc.presentation';
const MEMORY_CONFIG = 'victor-vsc.memoryConfig';

function register(context) {
  // Extension host-ul e unul per fereastră, deci o variabilă e exact starea
  // ferestrei ăsteia.
  let on = false;

  // Semnalul pentru patch-ul din workbench (vscode-patch/workbench.css): cât e
  // pornit modul, intrarea asta există în DOM, iar CSS-ul pune fundalul peste
  // editor. Extensia n-are acces la DOM, deci nu poate pune ea o clasă.
  const marker = vscode.window.createStatusBarItem('presentation', vscode.StatusBarAlignment.Right, -2000002);
  marker.name = 'Vic Presentation';
  marker.text = '$(device-desktop)';
  context.subscriptions.push(marker);

  const sync = () => {
    if (on) marker.show(); else marker.hide();
    return vscode.commands.executeCommand('setContext', STATE, on);
  };
  sync();

  context.subscriptions.push(vscode.commands.registerCommand('victor-vsc.togglePresentation', async () => {
    if (!(await vscode.commands.getCommands(true)).includes(MEMORY_CONFIG)) {
      vscode.window.showErrorMessage('Vic Presentation: lipsește patch-ul din workbench — rulează vscode-patch/apply.sh și dă Reload Window.');
      return;
    }
    on = !on;
    await vscode.commands.executeCommand(MEMORY_CONFIG,
      Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, on ? v : null])));
    // Ieșind din prezentare cu Zen (F12) rămas pornit, fereastra arăta tot
    // „blocată" în prezentare — Zen ascunde și el taburile și activity bar-ul.
    // Comanda nu face nimic fără Zen.
    if (!on) await vscode.commands.executeCommand('workbench.action.exitZenMode');
    await sync();
  }));
}

module.exports = { register };
