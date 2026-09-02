const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Curăță panoul „Test Results" de protocolul brut al runner-ului JUnit.
//
// Ce se vedea: peste output-ul real al testelor curgeau liniile de protocol ale
// lui `RemoteTestRunner` din Eclipse JDT — `%TSTTREE`, `%TESTS`, `%TESTE`,
// `%RUNTIME717` — fiecare urmată de un rând gol, deci un `System.out.println`
// din test se pierdea într-un teanc de zgomot dublu-spațiat.
//
// De ce: `Test Runner for Java` citește protocolul pe un socket, iar
// `JUnitRunnerResultAnalyzer.analyzeData()` face DOUĂ lucruri cu fiecare linie —
// o parsează (`processData`) ȘI o scrie verbatim în panou
// (`testRun.appendOutput`). Nu filtrează nimic: ce intră pe socket se vede.
// Nu e o configurare greșită și nici nu se poate stinge — extensia contribuie
// exact două setări, `java.test.config` și `java.test.defaultConfig`, niciuna
// despre output.
//
// Rândurile goale au aceeași cauză: handler-ul de socket taie bucata la ultimul
// EOL, deci `split(/\r?\n/)` întoarce mereu un ultim element gol, pe care bucla
// îl re-emite ca `\r\n`. De-aia se dublează inclusiv output-ul legitim.
//
// De ce se patchează fișierul altei extensii și nu se împachetează la runtime:
// fiecare extensie primește propriul obiect `vscode` în extension host, deci
// un `vscode.tests.createTestController` înfășurat aici nu se vede la ei.
// Singura pârghie e bundle-ul lor. Se reaplică singur după fiecare update al
// extensiei (folderul are versiunea în nume, deci vine nepatchat).

const EXTENSION_ID = 'vscjava.vscode-java-test';
const BUNDLE = path.join('dist', 'extension.bundle.js');
const MARKER = '__victorJavaTestOutput__';

const TARGET =
  'analyzeData(e){const t=e.split(/\\r?\\n/);' +
  'for(const e of t)this.processData(e),this.testContext.testRun.appendOutput(e+"\\r\\n")}';

// Aceeași buclă, cu două excepții la scris (parsarea rămâne pe TOATE liniile,
// ca să nu atingem starea analizorului): liniile de protocol nu se mai scriu,
// iar elementul gol de la coada bucății — terminatorul de linie, nu un rând
// gol real — nu se mai emite.
const PATCHED =
  'analyzeData(e){const t=e.split(/\\r?\\n/);' +
  'for(let i=0;i<t.length;i++){const n=t[i];this.processData(n);' +
  'if(/^%(TSTTREE|TESTS|TESTE|FAILED|ERROR|EXPECTS|EXPECTE|ACTUALS|ACTUALE|TRACES|TRACEE|RUNTIME)/.test(n))continue;' +
  'if(""===n&&i===t.length-1)continue;' +
  'this.testContext.testRun.appendOutput(n+"\\r\\n")}}' +
  `/*${MARKER}*/`;

function patch() {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) return;

  const file = path.join(ext.extensionPath, BUNDLE);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  if (source.includes(MARKER)) return;

  if (!source.includes(TARGET)) {
    // Upstream a rescris `analyzeData`. Nu ghicim — mai bine zgomot în panou
    // decât un patch aplicat pe altceva.
    console.warn(`[victor-vsc] ${EXTENSION_ID} ${ext.packageJSON.version}: ` +
      'analyzeData() nu mai arată ca înainte, output-ul rămâne nefiltrat');
    return;
  }

  try {
    fs.writeFileSync(`${file}.victor-orig`, source);
    fs.writeFileSync(file, source.replace(TARGET, PATCHED));
  } catch (e) {
    console.warn(`[victor-vsc] nu pot patcha ${file}: ${e.message}`);
    return;
  }

  // Extension host-ul are deja bundle-ul vechi în memorie.
  vscode.window
    .showInformationMessage(
      'Test Runner for Java: output-ul testelor e curățat de protocolul JUnit. ' +
        'Reload ca să se aplice.',
      'Reload Window')
    .then((choice) => {
      if (choice) vscode.commands.executeCommand('workbench.action.reloadWindow');
    });
}

module.exports = { patch };
