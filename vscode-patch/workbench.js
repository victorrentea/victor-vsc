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

  // „Nu mai tasta acolo" — pulsul lent de pe marginea zonei de editare.
  //
  // Inginerul agentic nu mai scrie cod cu mâna: dictează în prompt, în terminal.
  // De-aia orice tastă apăsată ÎNTR-UN EDITOR (indiferent de limbaj: Java,
  // Markdown, JSON, orice) aprinde un chenar care pulsează încet și se stinge
  // singur la ~1.5s după ultima tastă. E doar un avertisment vizual — nu blochează
  // nimic, tastarea merge mai departe.
  //
  // Terminalul integrat e EXCEPTAT, inclusiv când e deschis ca tab în zona de
  // editare: acolo e locul unde e voie să scrii. La fel navigarea (săgeți, Escape,
  // scurtături cu ⌘/⌃/⌥) — cine doar se plimbă prin fișier nu modifică nimic.
  // Cât stă aprins după ultima tastă, apoi cât durează stingerea. Stingerea e
  // lungă intenționat: chenarul se retrage blând, nu clipește o dată și dispare.
  const TYPING_IDLE_MS = 1500;
  const TYPING_FADE_MS = 1400;   // ține pasul cu `transition` din CSS
  let typingPart = null;
  let typingTimer = null;
  let typingFadeTimer = null;

  function typingEditorPart(target) {
    if (!target?.closest) return null;
    const part = target.closest('.part.editor');
    if (!part) return null;
    // Terminal-în-tab, consola de debug și webview-urile (preview de Markdown,
    // Simple Browser) nu sunt „cod scris cu mâna".
    if (target.closest('.xterm, .terminal, .repl, .webview, iframe')) return null;
    return part;
  }

  function isTypingKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;   // scurtături, nu text
    if (e.isComposing) return true;                          // dictare / IME
    if (e.key.length === 1) return true;                     // literă, cifră, semn
    return e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab';
  }

  // Chenarul e un DIV propriu, nu un `::after` pe `.part.editor`: partea de
  // editor e plină de straturi cu z-index mare (grupuri, overlay-uri, sticky
  // scroll), care acopereau pseudo-elementul. Un nod real, ultimul copil și cu
  // z-index maxim, se vede peste tot ce e dedesubt.
  // Două straturi, ca stingerea să iasă lină: cel de afară ține DOAR opacitatea
  // de ansamblu (aprindere/stingere prin `transition`), cel dinăuntru desenează
  // chenarul și pulsează. Dacă pulsul ar sta pe același element cu stingerea,
  // oprirea animației i-ar smuci opacitatea înapoi la valoarea de bază și
  // dispariția ar fi bruscă — așa pulsul continuă liniștit cât timp ansamblul
  // se stinge.
  function typingOverlay(part) {
    let el = part.querySelector(':scope > .victor-typing-overlay');
    if (!el) {
      el = document.createElement('div');
      el.className = 'victor-typing-overlay';
      const ring = document.createElement('div');
      ring.className = 'victor-typing-ring';
      el.appendChild(ring);
      part.appendChild(el);
    }
    return el;
  }

  // Pasul 1: scoatem `victor-typing` și punem `victor-typing-out`, care doar
  // duce opacitatea spre 0 (pulsul merge mai departe). Pasul 2, după fade:
  // curățăm și clasa de stingere, ca animația să se oprească de tot.
  function stopTypingWarning() {
    typingTimer = null;
    const part = typingPart;
    typingPart = null;
    if (!part) return;
    part.classList.remove('victor-typing');
    part.classList.add('victor-typing-out');
    clearTimeout(typingFadeTimer);
    typingFadeTimer = setTimeout(() => {
      typingFadeTimer = null;
      part.classList.remove('victor-typing-out');
    }, TYPING_FADE_MS);
  }

  document.addEventListener('keydown', (e) => {
    try {
      if (!isTypingKey(e)) return;
      const part = typingEditorPart(e.target);
      if (!part) return;
      if (typingPart && typingPart !== part) typingPart.classList.remove('victor-typing');
      typingPart = part;
      typingOverlay(part);
      clearTimeout(typingFadeTimer);
      typingFadeTimer = null;
      part.classList.remove('victor-typing-out');   // tastat din nou în timpul stingerii
      part.classList.add('victor-typing');
      clearTimeout(typingTimer);
      typingTimer = setTimeout(stopTypingWarning, TYPING_IDLE_MS);
    } catch { /* niciun avertisment nu merită să strice o tastă */ }
  }, true);

  // Panou maximizat => fără bara laterală în stânga.
  //
  // „Maximize Panel Size" (butonul din bara panoului, F12 din terminal, comanda
  // din palette) doar înalță panoul: Project Explorer-ul rămâne pe loc, iar
  // terminalul pornește tot de la ~300px din stânga. VS Code n-are setare pentru
  // asta, iar o extensie nu poate prinde execuția unei comenzi built-in — dar
  // layout-ul își pune singur pe workbench clasele `nomaineditorarea` (editorul
  // ascuns, adică panou maximizat) și `nosidebar`, deci starea se citește din DOM.
  //
  // Ascunderea o facem cu un click pe iconița activă din activity bar, fiindcă de
  // aici nu putem executa comenzi VS Code; e exact drumul pe care l-ar face mâna
  // (`setPartHidden(sidebar)`), nu o păcăleală de CSS — altfel panoul ar rămâne
  // decalat cu lățimea barei, layout-ul fiind poziționat în px de grid.
  //
  // Reacționăm doar la TRANZIȚIA maximizat/nemaximizat, nu la orice schimbare de
  // clasă: altfel, dacă Victor deschide Explorer-ul cât panoul e maximizat, i-l
  // stingem imediat la loc. Și restaurăm bara numai dacă noi am fost cei care
  // au închis-o.
  const ACTIVITY_ITEM = '.part.activitybar .monaco-action-bar .action-item';

  // Iconițele n-au un id stabil pe care să-l reținem; aria-label („Explorer
  // (⇧⌘E)") e pus pe li sau pe <a>, iar codicon-ul e ultima plasă de siguranță.
  function activityItemKey(item) {
    const label = item.querySelector('.action-label');
    return item.getAttribute('aria-label') || label?.getAttribute('aria-label')
        || item.id || label?.className || '';
  }

  // La ascundere workbench-ul cheamă singur `focusPanelOrEditor()`, deci focusul
  // ajunge în terminal fără ajutor. La restaurare, în schimb, deschiderea
  // Explorer-ului fură focusul (`openPaneComposite(id, focus=true)`), așa că-l
  // punem noi înapoi — dar numai dacă era în panou, ca să nu focusăm un element
  // rămas într-o parte ascunsă.
  function clickActivityItem(item, restoreFocus) {
    const prev = restoreFocus ? document.activeElement : null;
    const inPanel = !!prev?.closest?.('.part.panel');
    (item.querySelector('.action-label') || item).click();
    if (!inPanel) return;
    const back = () => { if (prev.isConnected && document.activeElement !== prev) prev.focus(); };
    setTimeout(back, 0);
    setTimeout(back, 80);
  }

  let hiddenSidebarKey = null;   // iconița pe care am stins-o noi
  let wasMaximized = null;       // null = starea de la pornire, pe care n-o „corectăm"

  function syncSidebarToPanel(workbench) {
    const maximized = workbench.classList.contains('nomaineditorarea');
    if (maximized === wasMaximized) return;
    const first = wasMaximized === null;
    wasMaximized = maximized;
    if (first) return;

    const sidebarVisible = !workbench.classList.contains('nosidebar');

    if (maximized) {
      if (!sidebarVisible) return;   // deja închisă cu mâna, n-avem ce restaura
      const item = document.querySelector(ACTIVITY_ITEM + '.checked');
      if (!item) return;
      hiddenSidebarKey = activityItemKey(item);
      clickActivityItem(item, false);
      return;
    }

    const key = hiddenSidebarKey;
    hiddenSidebarKey = null;
    if (!key || sidebarVisible) return;   // a redeschis-o singur între timp
    const items = Array.from(document.querySelectorAll(ACTIVITY_ITEM));
    const item = items.find((i) => activityItemKey(i) === key)
              || document.querySelector('.part.activitybar .composite-bar .action-item');
    if (item) clickActivityItem(item, true);
  }

  // Scriptul e injectat la finalul lui workbench.html, adică pe un `<body>` gol:
  // `.monaco-workbench` apare abia după ce se construiește workbench-ul. De-aia
  // instalarea se încearcă din `tick()`, până prinde, nu o singură dată la load.
  //
  // Observatorul stă pe UN element și doar pe atributul `class`, fără subtree:
  // se trezește de câteva ori pe sesiune, nu de mii de ori pe secundă ca unul pus
  // pe document (vezi nota de la `tick`).
  let panelSyncInstalled = false;

  function installPanelSidebarSync() {
    if (panelSyncInstalled) return;
    const workbench = document.querySelector('.monaco-workbench');
    if (!workbench) return;
    panelSyncInstalled = true;
    syncSidebarToPanel(workbench);
    new MutationObserver(() => {
      try { syncSidebarToPanel(workbench); } catch { /* un selector mutat nu strică nimic */ }
    }).observe(workbench, { attributes: true, attributeFilter: ['class'] });
  }

  let lastTitle = null;

  function tick() {
    try {
      // Ieșire rapidă: cât timp titlul n-a mișcat și pastila e la locul ei, nu
      // atingem DOM-ul deloc.
      const title = document.title;
      const left = document.querySelector('.titlebar-container > .titlebar-left');
      ensureToolsButton();
      installPanelSidebarSync();
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
