// Verifică headless `__victorNestTestResults` din workbench.js — funcția care
// face ca panoul „Test Results" să arate clasele @Nested ca părinți, nu ca frați.
//
//   node vscode-patch/nest-test.mjs [green|red|with-classes|flat-class|single|two-classes]
//
// Există fiindcă singura verificare adevărată e cu ochii, în VS Code, după un
// `./apply.sh` + Reload Window — iar aia cere ecranul deschis. Harness-ul de aici
// reconstruiește exact structurile pe care i le dă bundle-ul (`result.tests`
// filtrat, `makeNode`, `TestCaseElement`) și tipărește arborele rezultat, deci
// se poate rula oricând, inclusiv după un update de VS Code, ca să vezi că
// logica n-a alunecat. Ce NU acoperă: că ancora din apply.sh mai prinde — aia
// se vede din ce tipărește apply.sh.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SEP = '\0';
const CTRL = 'java';
const PROJ = 'petclinic-backend';
const PKG = `${PROJ}@victor.training.petclinic.mcp`;
const CLS = `${PROJ}@victor.training.petclinic.mcp.CreateVisitShould`;

const RANGE = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
const FILE = 'file:///…/CreateVisitShould.java';

// --- rezultatul rulării, ca în VS Code -------------------------------------
const byId = new Map();
function add(extId, label, { state = 0, range = null, uri = undefined, messages = [] } = {}) {
  const item = { extId, label, uri, range };
  const rec = { item, tasks: [{ state, messages }], computedState: state };
  byId.set(extId, rec);
  return rec;
}

// lanțul pe care VS Code îl adaugă până la rădăcină (fără stare proprie)
add(CTRL, 'Java', {});
add([CTRL, PROJ].join(SEP), '$(project) petclinic-backend', {});
add([CTRL, PROJ, PKG].join(SEP), '$(symbol-namespace) victor.training.petclinic.mcp', {});

const clsId = [CTRL, PROJ, PKG, CLS].join(SEP);
add(clsId, '$(symbol-class) create visit should', { range: RANGE, uri: FILE });

const nested = {
  FailsIf: ['the pet does not exist', 'the pet belongs to another owner', 'the date is in the past',
    'the time has already passed today', 'the pet already has the maximum of upcoming visits'],
  ForAValidBooking: ['save the visit as described', 'link the visit to the pet on both sides',
    'confirm with the id of the new visit'],
};

const PASSED = 3, FAILED = 4;
const scenario = process.argv[2] || 'green';   // green | red
const flat = [];   // ce ajunge în `j` (filtrul state>=2 || messages.length)

let first = true;
for (const [nestedClass, methods] of Object.entries(nested)) {
  const nId = [clsId, `${CLS}$${nestedClass}`].join(SEP);
  add(nId, `$(symbol-class) ${nestedClass.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`,
    { range: RANGE, uri: FILE });
  for (const m of methods) {
    const state = scenario === 'red' && first ? FAILED : PASSED;
    const mId = [nId, `${CLS}$${nestedClass}#${m}`].join(SEP);
    flat.push(add(mId, m, { state, range: RANGE, uri: FILE, messages: state === FAILED ? [{ type: 0, message: 'boom' }] : [] }));
    first = false;
  }
}

// starea agregată, așa cum o calculează VS Code (refreshComputedState)
for (const [id, rec] of byId) {
  const kids = [...byId.values()].filter(r => r.item.extId.startsWith(id + SEP));
  if (kids.length) rec.computedState = kids.some(k => k.tasks[0].state === FAILED) ? FAILED : PASSED;
}

// scenarii suplimentare
if (scenario === 'with-classes') {           // dacă runner-ul RAPORTEAZĂ și suitele
  for (const id of [clsId, ...[...byId.keys()].filter(k => k.includes('$') && !k.includes('#'))]) {
    const r = byId.get(id); r.tasks[0].state = 2; flat.unshift(r);
  }
}
if (scenario === 'flat-class') {             // clasă fără @Nested
  flat.length = 0;
  for (const m of ['a test', 'another test']) {
    flat.push(add([clsId, `${CLS}#${m}`].join(SEP), m, { state: PASSED, range: RANGE, uri: FILE }));
  }
}
if (scenario === 'single') {                 // o singură metodă rulată
  flat.length = 1;
}
if (scenario === 'two-classes') {            // două clase, pachete diferite
  flat.length = 0;
  for (const [pkg, cls] of [[PKG, CLS], [`${PROJ}@victor.training.petclinic.web`, `${PROJ}@victor.training.petclinic.web.OwnerTest`]]) {
    const pid = [CTRL, PROJ, pkg].join(SEP);
    if (!byId.has(pid)) add(pid, `$(symbol-namespace) ${pkg}`, {});
    const cid = [pid, cls].join(SEP);
    if (!byId.has(cid)) add(cid, `$(symbol-class) ${cls.split('.').pop()}`, { range: RANGE, uri: FILE });
    flat.push(add([cid, `${cls}#t1`].join(SEP), 't1', { state: PASSED, range: RANGE, uri: FILE }));
  }
}

const results = { id: 'run-1', tests: [...byId.values()], getStateById: (id) => byId.get(id) };

// --- elementele de arbore, ca ZJ (TestCaseElement) --------------------------
class TestCaseElement {
  constructor(results, test, taskIndex) {
    this.results = results; this.test = test; this.taskIndex = taskIndex;
    this.id = `${results.id}/${test.item.extId}`;
    const parts = test.item.extId.split(SEP);
    if (parts.length > 1) {
      this.description = '';
      for (let n = parts.length - 1; n > 0; n--) {
        if (n === 1) break;                       // isRoot
        const r = results.getStateById(parts.slice(0, n).join(SEP));
        if (!r) break;
        if (this.description.length) this.description += ' ‹ ';
        this.description += r.item.label;
      }
    }
  }
  get state() { return this.test.tasks[this.taskIndex].state; }
  get label() { return this.test.item.label; }
}
const cache = new Map();
const getOrCreate = (k, f) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));
const messagesOf = (t) => t.tasks[0].messages.map((m, i) => ({ element: { type: 'message', label: m.message }, incompressible: false }));
const makeNode = (t) => ({ element: getOrCreate(t, () => new TestCaseElement(results, t, 0)), incompressible: true, children: messagesOf(t) });

// --- încărcăm workbench.js real, cu DOM-ul stubuit -------------------------
const noop = () => {};
const el = new Proxy({}, { get: (_, p) => (p === 'style' || p === 'classList' || p === 'dataset' ? el : (p === 'querySelector' || p === 'querySelectorAll' ? () => null : noop)) });
const sandbox = {
  console,
  document: { title: '', addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], createElement: () => el, head: el, body: el, documentElement: el },
  window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
  setTimeout, setInterval: () => 0, clearTimeout, clearInterval,
  requestAnimationFrame: noop, MutationObserver: class { observe() {} disconnect() {} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Node: class {}, HTMLElement: class {}, MouseEvent: class {}, KeyboardEvent: class {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(HERE, 'workbench.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'workbench.js' });

const fn = sandbox.__victorNestTestResults;
if (typeof fn !== 'function') { console.error('FAIL: __victorNestTestResults nu s-a definit'); process.exit(1); }

// --- rulăm și tipărim ------------------------------------------------------
const ICON = { 0: '·', 2: '~', 3: '✓', 4: '✗', 5: '⊘', 6: '!' };
const tree = fn(flat, makeNode);
if (!tree) { console.error('FAIL: a căzut pe fallback (undefined)'); process.exit(1); }

const strip = (s) => String(s ?? '').replace(/\$\([^)]*\)\s*/g, '').trim();
function print(nodes, depth = 0) {
  for (const n of nodes) {
    const e = n.element;
    if (e.type === 'message') { console.log('  '.repeat(depth) + '  ⚠ ' + e.label); continue; }
    const desc = e.description ? `   (${e.description})` : '';
    console.log('  '.repeat(depth) + (ICON[e.state] ?? '?') + ' ' + strip(e.label) + desc);
    print(n.children || [], depth + 1);
  }
}
console.log(`=== scenariu: ${scenario} — ${flat.length} rânduri plate în intrare ===`);
print(tree);

// --- verificări ------------------------------------------------------------
const fails = [];
if (!['green','red'].includes(scenario)) { console.log('\n(fara verificari stricte pentru acest scenariu)'); process.exit(0); }
if (tree.length !== 1) fails.push(`așteptam o singură rădăcină (clasa), am ${tree.length}`);
const root = tree[0];
if (strip(root.element.label) !== 'create visit should') fails.push(`rădăcina e "${strip(root.element.label)}"`);
const nestedNodes = (root.children || []).filter(c => c.element.type !== 'message');
if (nestedNodes.length !== 2) fails.push(`așteptam 2 clase @Nested sub rădăcină, am ${nestedNodes.length}`);
const leafCount = nestedNodes.reduce((s, c) => s + (c.children || []).filter(x => x.element.type !== 'message').length, 0);
if (leafCount !== 8) fails.push(`așteptam 8 metode sub clasele @Nested, am ${leafCount}`);
if (nestedNodes.some(c => c.element.description !== '')) fails.push('breadcrumb-ul n-a fost golit pe copii');
const expectedRoot = scenario === 'red' ? 4 : 3;
if (root.element.state !== expectedRoot) fails.push(`starea rădăcinii e ${root.element.state}, așteptam ${expectedRoot}`);
console.log(fails.length ? '\nFAIL:\n - ' + fails.join('\n - ') : '\nOK: toate verificările trec');
process.exit(fails.length ? 1 : 0);
