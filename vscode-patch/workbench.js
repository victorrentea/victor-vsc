// Injectat în workbench-ul VS Code de vscode-patch/apply.sh.
// Rulează în renderer, fără acces la API-ul de extensii — deci tot ce face
// citește din DOM și scrie în DOM.
const VICTOR_WATCH = false;   // apply.sh --watch pune true, pentru iterat pe CSS

(function () {
  'use strict';

  // Branch-ul e deja în window.title („petclinic — ⑂ mm26 — File.java"), pus de
  // ${activeRepositoryBranchName}. Îl citim de acolo în loc să întrebăm git:
  // titlul se actualizează singur la fiecare checkout.
  function branchFromTitle() {
    const m = /⑂\s*([^—|·]+?)\s*(?:[—|·]|$)/.exec(document.title || '');
    return m ? m[1].trim() : '';
  }

  function ensureBranchPill() {
    const left = document.querySelector('.titlebar-container > .titlebar-left');
    if (!left) return;

    let pill = left.querySelector('.victor-branch');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'victor-branch';

      const icon = document.createElement('span');
      icon.className = 'codicon codicon-git-branch';
      const name = document.createElement('span');
      name.className = 'victor-branch-name';
      pill.append(icon, name);
      pill.title = 'Branch — click pentru lista de branch-uri';

      // Nu putem executa comenzi VS Code de aici, dar putem apăsa în locul
      // nostru intrarea de SCM din status bar, care deschide exact acel picker.
      pill.addEventListener('click', () => {
        const scm = document.querySelector('.statusbar-item[id*="scm"] a.statusbar-item-label')
                 || document.querySelector('.statusbar-item[id*="scm"] a');
        if (scm) scm.click();
      });

      left.appendChild(pill);
    }

    const branch = branchFromTitle();
    pill.querySelector('.victor-branch-name').textContent = branch;
    pill.classList.toggle('victor-empty', !branch);
  }

  // Butonul de unelte (Command Palette) urcă în title bar, în stânga pastilei
  // de command center — în `.titlebar-center`, care e singurul rând flex de pe
  // acolo, deci centrarea pe verticală vine de la sine.
  //
  // NU mai mutăm aici nodul din status bar, cum făceam cu rotița: în interiorul
  // badge-ului fiecare strat își oprește evenimentele (item-ul de ActionBar al
  // pastilei face `EventHelper.stop` pe click), iar nodul mutat rămâne fără
  // click. Desenăm propriul element și, la click, apăsăm în locul nostru
  // intrarea din status bar — aceeași manevră ca la pastila de branch. Intrarea
  // rămâne în status bar (ascunsă din CSS), deci handler-ul ei e mereu cel viu:
  // dacă patch-ul nu e aplicat, butonul se vede pur și simplu jos, ca înainte.
  // Id-ul EXACT, nu un prefix: VS Code numerotează intrările fără id explicit
  // tot sub numele extensiei (`victorrentea.victor-vsc.0` e breadcrumb-ul), iar
  // un `[id^=…]` prindea prima intrare din bară, adică Go to Symbol — de-aia se
  // deschidea lista de simboluri în loc de Command Palette.
  const TOOLS_ITEM = '.part.statusbar .statusbar-item[id="victorrentea.victor-vsc.tools"]';
  const TOOLS_FALLBACK = '.part.statusbar .statusbar-item:has(> a.statusbar-item-label .codicon-tools)';

  function clickToolsItem() {
    const item = document.querySelector(TOOLS_ITEM) || document.querySelector(TOOLS_FALLBACK);
    if (!item) return;
    (item.querySelector('a.statusbar-item-label') || item).click();
  }

  function ensureToolsButton() {
    const slot = document.querySelector('.titlebar-container > .titlebar-center');
    if (!slot) return;

    let btn = document.querySelector('.victor-tools');
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'victor-tools';
      btn.title = 'Command Palette (⇧⌘A)';
      btn.setAttribute('role', 'button');
      const icon = document.createElement('span');
      icon.className = 'codicon codicon-tools';
      btn.appendChild(icon);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clickToolsItem();
      });
    }

    // Înaintea pastilei (`.window-title`), ca să stea în stânga ei.
    const pill = slot.querySelector(':scope > .window-title');
    if (btn.parentElement !== slot || btn.nextElementSibling !== pill) {
      slot.insertBefore(btn, pill);
    }
  }

  // Sticky scroll pe mai multe niveluri, fără ca ecranul să sară la tastat.
  //
  // `_computeScrollTopToRevealRange` din editor ține cursorul la o margine de
  //     max(cursorSurroundingLines, stickyScrollEnabled ? maxNumberStickyLines : 0)
  // rânduri de marginea de sus. Marginea are sens — altfel cursorul ar ajunge sub
  // widget-ul sticky — dar se calculează din `maxLineCount`, adică din PLAFONUL
  // configurat, nu din câte rânduri arată widget-ul chiar acum. Cu plafonul urcat
  // la 8 (ca să încapă # / ## / ### sau clasa + clasa nested + metoda, ca-n
  // IntelliJ), fiecare tastă apăsată sus în viewport ar fi scrolat 8 rânduri —
  // exact motivul pentru care plafonul fusese coborât la 1.
  //
  // apply.sh rescrie expresia aia din bundle ca să întrebe întâi funcția de aici,
  // care numără rândurile chiar afișate. Într-un fișier plat răspunsul e 0 sau 1,
  // deci ecranul stă la fel de fix ca înainte; adâncimea o plătim doar acolo unde
  // widget-ul chiar e adânc. `undefined` = n-am putut afla, iar bundle-ul cade
  // înapoi pe `maxLineCount`, adică pe comportamentul din fabrică.
  globalThis.__victorStickyLines = function (viewLines) {
    try {
      // `domNode` e un FastDomNode în editor, dar poate fi direct elementul.
      const node = viewLines?.domNode?.domNode || viewLines?.domNode;
      const editor = node?.closest?.('.monaco-editor');
      if (!editor) return undefined;
      let lines = 0;
      for (const widget of editor.querySelectorAll('.sticky-widget')) {
        // Editoarele imbricate (diff inline, zone widgets) au widget-ul lor.
        if (widget.closest('.monaco-editor') !== editor) continue;
        if (widget.offsetHeight === 0) continue;
        lines = Math.max(lines, widget.querySelectorAll('.sticky-line-content').length);
      }
      return lines;
    } catch {
      return undefined;
    }
  };

  // Rezultatele testelor, ierarhic — ca în IntelliJ.
  //
  // Panoul „Test Results" din VS Code (`getTaskChildren` din testResultsTree.ts)
  // trece o singură dată prin `result.tests`, filtrează ce a apucat să ruleze și
  // scoate câte un rând PLAT pentru fiecare. Cu @Nested de JUnit 5 ies toate
  // metodele una sub alta, iar singurul indiciu că o metodă ține de o clasă e
  // breadcrumb-ul gri din dreapta („FailsIf ‹ CreateVisitShould"). IntelliJ, pe
  // același test, desenează exact invers: clasa e un nod, metodele îi sunt copii.
  //
  // Ierarhia există deja în date: `extId` e calea TestId a itemului, adică
  // id-urile de la rădăcină până la el, lipite cu \0. Deci un item e copilul
  // altuia când extId-ul lui începe cu extId-ul celuilalt + \0.
  //
  // Două lucruri nu se pot face doar din lista primită:
  //
  // 1. Rândurile de clasă LIPSESC de obicei. Extensia Test Runner for Java
  //    raportează stare pentru suite doar când pică (`setTestState` e chemat
  //    pentru suite numai la failed/errored/skipped), deci la o rulare verde
  //    clasa are `state` 0 și filtrul din panou o taie. Ca să existe nodul
  //    părinte îl luăm din `results.getStateById(<extId de strămoș>)` — obiectul
  //    e acolo, VS Code adaugă tot lanțul până la rădăcină în rezultat.
  //    `results` și `taskIndex` le citim de pe primul element construit, fiindcă
  //    `makeNode` le are în closure iar noi nu.
  //
  // 2. Ne oprim la CLASE, nu urcăm până la pachet și proiect. Distincția e
  //    `item.range`: clasele și metodele au o poziție într-un fișier, pachetul
  //    și proiectul n-au. Așa iese exact arborele din IntelliJ — clasa e
  //    rădăcina rândului, nu al treilea nivel de indentare.
  //
  // Nodurile de clasă n-au stare proprie folositoare: extensia raportează pentru
  // suite doar eșecurile, iar clasa pe care ai cerut-o rămâne pe „queued" de la
  // pornirea rulării — adică un ceas gri deasupra a opt bife verzi. Nici
  // `computedState`-ul lui VS Code nu ajută, fiindcă „queued" și „running" au
  // prioritate mai mare decât „passed" tocmai ca să se vadă cât timp rulează.
  // Deci le calculăm noi starea din copii, cu prioritățile din VS Code, și
  // păstrăm starea proprie doar când clasa chiar a picat (failed/errored — un
  // @BeforeAll căzut, de pildă). Umbrirea stă pe instanța de element (cache-uită),
  // nu pe rezultat, ca să nu stricăm numărătoarea „X passed" din antet.
  //
  // apply.sh rescrie expresia din bundle ca să întrebe funcția asta; dacă
  // lipsește sau crapă, `?.()` + `??` cad înapoi pe `Iterable.map`, adică pe
  // lista plată din fabrică — patch-ul e inofensiv fără scriptul injectat.
  const TEST_ID_SEP = '\0';

  // TestResultState + statePriority din VS Code (testingStates.ts): „running" și
  // „queued" bat „passed" tocmai ca să se vadă rulările în curs, iar eșecul bate
  // tot restul.
  const FAILED = 4, ERRORED = 6;
  const STATE_PRIORITY = { 2: 6, 6: 5, 4: 4, 1: 3, 3: 2, 5: 1, 0: 0 };

  // Breadcrumb-ul e text simplu, nu label cu iconițe, așa că `$(symbol-class)`
  // pus de Test Runner for Java în label-uri ajunge ACOLO ca atare, vizibil.
  // Îl scoatem — pe nodurile devenite copii îl scoatem cu totul, fiindcă
  // părintele pe care-l numea e chiar rândul de deasupra.
  function stripCodicons(text) {
    return typeof text === 'string' ? text.replace(/\$\([^)]*\)\s*/g, '').trim() : text;
  }

  globalThis.__victorNestTestResults = function (items, makeNode) {
    try {
      const list = Array.from(items);
      if (!list.length) return undefined;   // nimic de aranjat, lasă fabrica

      const idOf = (item) => item && item.item && item.item.extId;
      const listed = new Set(list.map(idOf));

      const nodes = new Map();      // extId -> nodul de arbore
      const kids = new Map();       // extId de părinte -> [extId de copii], în ordinea rulării
      const roots = [];
      let results;                  // ITestResult, citit de pe primul element
      let taskIndex = 0;

      const nodeFor = (item) => {
        const id = idOf(item);
        let node = nodes.get(id);
        if (!node) {
          nodes.set(id, node = makeNode(item));
          if (results === undefined && node.element && node.element.results) {
            results = node.element.results;
            taskIndex = node.element.taskIndex || 0;
          }
        }
        return node;
      };

      // Cel mai apropiat strămoș care merită un rând: unul care e deja în listă,
      // sau unul pe care rezultatul îl cunoaște și care e localizat într-un
      // fișier (clasă / clasă @Nested). Pachetul și proiectul n-au `range`, deci
      // bucla trece peste ele și itemul rămâne rădăcină.
      const parentOf = (id) => {
        const parts = String(id).split(TEST_ID_SEP);
        for (let n = parts.length - 1; n > 0; n--) {
          const candidate = parts.slice(0, n).join(TEST_ID_SEP);
          const found = results && results.getStateById && results.getStateById(candidate);
          if (!found) continue;
          if (listed.has(candidate) || (found.item && found.item.range)) return found;
        }
        return undefined;
      };

      // Coadă, nu buclă simplă: un strămoș adus din rezultat intră și el la rând,
      // ca să-și caute la rândul lui părintele (metodă -> clasă @Nested -> clasă).
      const queue = list.slice();
      const linked = new Set();
      while (queue.length) {
        const item = queue.shift();
        const id = idOf(item);
        if (id === undefined || linked.has(id)) continue;
        linked.add(id);
        nodeFor(item);

        const parent = parentOf(id);
        if (!parent) { roots.push(id); continue; }
        const parentId = idOf(parent);
        if (kids.has(parentId)) kids.get(parentId).push(id);
        else kids.set(parentId, [id]);
        queue.push(parent);
      }

      for (const [parentId, childIds] of kids) {
        const node = nodes.get(parentId);
        node.children = [...(node.children || []), ...childIds.map((id) => nodes.get(id))];
        node.collapsible = true;
        for (const id of childIds) {
          const el = nodes.get(id).element;
          if (el) el.description = '';   // breadcrumb-ul e acum rândul de deasupra
        }
      }

      // Starea nodurilor-părinte, agregată din copii (vezi comentariul de sus).
      // `seen` e per apel, nu memorat între apeluri: getter-ul e leneș, ca să
      // răspundă cu starea de ACUM de fiecare dată când rândul se re-desenează.
      const ownState = (id) => {
        const rec = results && results.getStateById && results.getStateById(id);
        const task = rec && rec.tasks && rec.tasks[taskIndex];
        return task ? task.state : 0;
      };
      const aggregate = (id, seen) => {
        if (seen.has(id)) return seen.get(id);
        seen.set(id, 0);                          // taie o eventuală buclă
        const childIds = kids.get(id);
        const own = ownState(id);
        let state = own;
        if (childIds && own !== FAILED && own !== ERRORED) {
          state = 0;
          for (const childId of childIds) {
            const child = aggregate(childId, seen);
            if (STATE_PRIORITY[child] > STATE_PRIORITY[state]) state = child;
          }
        }
        seen.set(id, state);
        return state;
      };

      // Rândul de clasă nu se re-desenează singur. `onDidChange` al unui element
      // ascultă DOAR schimbările itemului lui, iar clasa nu mai primește niciuna
      // după ce a fost pusă pe „queued" la pornirea rulării — deci rămânea cu
      // iconița de atunci oricât de verzi deveneau copiii dedesubt. Îi lărgim
      // ascultarea la tot subarborele. Un event VS Code e doar o funcție
      // `(listener, thisArgs, disposables) => IDisposable`, deci se poate filtra
      // de mână; `results.onChange` există doar pe rezultatul viu, iar pentru
      // unul rehidratat (rulare veche, restaurată la reload) lăsăm getter-ul din
      // clasă, care întoarce Event.None.
      const subtreeChanges = (id, source) => (listener, thisArgs, disposables) =>
        source((event) => {
          const changed = event && event.item && event.item.item && event.item.item.extId;
          if (changed === id || (typeof changed === 'string' && changed.startsWith(id + TEST_ID_SEP))) {
            listener.call(thisArgs, event);
          }
        }, undefined, disposables);

      for (const parentId of kids.keys()) {
        const el = nodes.get(parentId).element;
        if (!el) continue;
        Object.defineProperty(el, 'state', {
          configurable: true,
          get: () => aggregate(parentId, new Map()),
        });
        if (results && typeof results.onChange === 'function') {
          const event = subtreeChanges(parentId, results.onChange.bind(results));
          Object.defineProperty(el, 'onDidChange', { configurable: true, get: () => event });
        }
      }

      for (const id of roots) {
        const el = nodes.get(id).element;
        if (el) el.description = stripCodicons(el.description);
      }

      return roots.map((id) => nodes.get(id));
    } catch {
      return undefined;   // bundle-ul cade înapoi pe lista plată
    }
  };

  // Click pe rotița mouse-ului în cod = ⌘-click (Go to Definition). VS Code
  // n-are nicio setare pentru butonul din mijloc și nici keybindings-urile nu
  // primesc butoane de mouse — dar editorul își ia deciziile din evenimentele
  // DOM, iar `hasTriggerModifier` se uită la `metaKey`-ul evenimentului. Deci
  // retrimitem exact secvența pe care ar fi produs-o un ⌘-click adevărat:
  // mousemove (ca să apară link-ul sub cursor), apoi down / up / click.
  function replayAsCmdClick(e) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window, detail: 1,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      button: 0, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false
    };
    target.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  }

  // Capture, ca să ajungem înaintea editorului, care altfel ar trata butonul
  // din mijloc ca pe o selecție/paste (X11) sau l-ar înghiți în tăcere.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    if (!e.target?.closest?.('.monaco-editor .view-lines')) return;
    e.preventDefault();
    e.stopPropagation();
    replayAsCmdClick(e);
  }, true);

  document.addEventListener('auxclick', (e) => {
    if (e.button === 1 && e.target?.closest?.('.monaco-editor .view-lines')) e.preventDefault();
  }, true);

  let lastTitle = null;

  function tick() {
    try {
      // Ieșire rapidă: cât timp titlul n-a mișcat și pastila e la locul ei, nu
      // atingem DOM-ul deloc.
      const title = document.title;
      const left = document.querySelector('.titlebar-container > .titlebar-left');
      ensureToolsButton();
      if (title === lastTitle && left && left.querySelector('.victor-branch')) return;
      lastTitle = title;
      ensureBranchPill();
    } catch { /* un selector mutat nu strică workbench-ul */ }
  }

  // NU pune aici un MutationObserver pe document: workbench-ul mută DOM-ul de mii
  // de ori pe secundă când merg terminalele, iar callback-ul îneacă UI-ul.
  // Un tick la 2s e destul — title bar-ul nu se reconstruiește mai des de-atât.
  setInterval(tick, 2000);
  tick();

  // Doar în timpul reglajelor: reîncarcă CSS-ul injectat, ca să nu fie nevoie de
  // Reload Window după fiecare modificare.
  if (VICTOR_WATCH) {
    setInterval(() => {
      const link = document.querySelector('link[data-victor-css]');
      if (!link) return;
      const fresh = link.cloneNode();
      fresh.href = './victor-workbench.css?v=' + Date.now();
      fresh.addEventListener('load', () => link.remove(), { once: true });
      link.after(fresh);
    }, 1500);
  }
})();
