const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Săgeata verde din dreptul scenariului, ca în IntelliJ. VS Code n-are runner de
// cucumber-js și nicio extensie mainstream nu-l aduce: extensiile de Gherkin fac
// doar sintaxă, completare și navigare la glue. Dar Testing API-ul dă exact
// afordanța cerută — un TestItem cu `range` desenează triunghiul în gutter, pe
// linia lui, și apare și în panoul Testing.
//
// Rularea se face prin `path:line`, forma nativă a lui cucumber-js pentru „doar
// scenariul de aici". E mai precisă decât `--name`: merge și pe scenarii cu
// nume identice, și pe un singur rând din Examples-ul unui Scenario Outline.

const SCENARIO = /^\s*(Scenario Outline|Scenario Template|Scenario|Example)\s*:\s*(.*)$/;
const FEATURE = /^\s*Feature\s*:\s*(.*)$/;

/** Rădăcina rulării: primul strămoș cu o configurație de cucumber sau cu scriptul npm. */
function projectRoot(fsPath) {
  for (let dir = path.dirname(fsPath); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ['cucumber.js', 'cucumber.cjs', 'cucumber.mjs', 'cucumber.json', 'cucumber.yaml']) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (parsed.scripts && Object.keys(parsed.scripts).some(s => s.includes('cucumber'))) return dir;
      } catch { /* package.json rupt — mergem mai sus */ }
    }
  }
  return undefined;
}

// Scriptul npm al proiectului bate `npx cucumber-js`: el poartă env-ul de care
// depinde suita (în petclinic, SKIP_SERVER_START=1 — fără el rularea pornește
// încă un stack peste cel deja pornit).
function command(root, target) {
  const pkg = path.join(root, 'package.json');
  try {
    const scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {};
    const name = ['test:cucumber', 'cucumber', 'test:bdd'].find(s => scripts[s]);
    if (name) return { file: 'npm', args: ['run', name, '--', target] };
  } catch { /* fără package.json */ }
  return { file: 'npx', args: ['cucumber-js', target] };
}

function parse(controller, uri, items) {
  let text;
  try { text = fs.readFileSync(uri.fsPath, 'utf8'); } catch { return; }
  const lines = text.split(/\r?\n/);

  const file = items.get(uri.toString()) || controller.createTestItem(uri.toString(), path.basename(uri.fsPath), uri);
  file.label = path.basename(uri.fsPath);
  const children = [];
  for (const [i, line] of lines.entries()) {
    const feature = FEATURE.exec(line);
    if (feature) {
      if (feature[1].trim()) file.label = feature[1].trim();
      // Range-ul pe linia `Feature:` desenează săgeata și în capul fișierului,
      // nu doar în dreptul scenariilor: un click acolo rulează tot fișierul.
      file.range = new vscode.Range(i, 0, i, line.length);
    }
    const scenario = SCENARIO.exec(line);
    if (!scenario) continue;
    const label = scenario[2].trim() || scenario[1];
    const item = controller.createTestItem(`${uri.toString()}:${i + 1}`, label, uri);
    item.range = new vscode.Range(i, 0, i, line.length);
    children.push(item);
  }
  file.children.replace(children);
  items.add(file);
}

async function runTarget(controller, request, token) {
  const run = controller.createTestRun(request);
  const queue = [];
  const collect = item => {
    if (request.exclude?.includes(item)) return;
    if (item.children.size) item.children.forEach(collect);
    else queue.push(item);
  };
  (request.include ?? [...gather(controller.items)]).forEach(collect);

  for (const item of queue) {
    if (token.isCancellationRequested) break;
    run.started(item);
    const fsPath = item.uri.fsPath;
    const root = projectRoot(fsPath);
    if (!root) {
      run.errored(item, new vscode.TestMessage('Nu găsesc rădăcina cucumber (cucumber.js sau un script npm) deasupra fișierului.'));
      continue;
    }
    const line = item.id.slice(item.uri.toString().length + 1);
    const target = path.relative(root, fsPath) + (line ? `:${line}` : '');
    const { file, args } = command(root, target);

    const started = Date.now();
    const output = await new Promise(resolve => {
      const child = spawn(file, args, { cwd: root, env: process.env });
      let buffer = '';
      const push = chunk => {
        buffer += chunk;
        run.appendOutput(chunk.toString().replace(/\r?\n/g, '\r\n'), undefined, item);
      };
      child.stdout.on('data', push);
      child.stderr.on('data', push);
      token.onCancellationRequested(() => child.kill());
      child.on('error', e => resolve({ code: -1, buffer: `${file}: ${e.message}` }));
      child.on('close', code => resolve({ code, buffer }));
    });

    const duration = Date.now() - started;
    if (output.code === 0) run.passed(item, duration);
    else run.failed(item, new vscode.TestMessage(tail(output.buffer)), duration);
  }
  run.end();
}

/** Ultimele rânduri ale ieșirii — atât cât să se vadă pasul căzut în tooltip. */
const tail = text => text.split(/\r?\n/).filter(Boolean).slice(-40).join('\n') || 'cucumber-js a ieșit cu eroare.';

function* gather(collection) {
  const out = [];
  collection.forEach(item => out.push(item));
  yield* out;
}

function register(context) {
  const controller = vscode.tests.createTestController('victor-vsc.cucumber', 'Cucumber');
  const items = controller.items;

  const discover = async () => {
    for (const uri of await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**')) parse(controller, uri, items);
  };

  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run,
    (request, token) => runTarget(controller, request, token), true);
  controller.refreshHandler = discover;

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.feature');
  watcher.onDidCreate(uri => parse(controller, uri, items));
  watcher.onDidChange(uri => parse(controller, uri, items));
  watcher.onDidDelete(uri => items.delete(uri.toString()));

  // Scenariile se re-numerotează pe măsură ce scrii, deci re-parsăm la fiecare
  // salvare, nu doar la schimbări venite din afara editorului.
  const saved = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.uri.fsPath.endsWith('.feature')) parse(controller, doc.uri, items);
  });

  context.subscriptions.push(controller, watcher, saved);
  discover();
}

module.exports = { register };
