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
  const TOOLS_ITEM = '.part.statusbar .statusbar-item[id^="victorrentea.victor-vsc"]';

  function clickToolsItem() {
    const item = document.querySelector(TOOLS_ITEM);
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
