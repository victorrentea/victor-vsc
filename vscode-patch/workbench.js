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

  // Rotița pe care extensia o pune în status bar (singurul loc în care o poate
  // pune) e mutată sus, lipită la dreapta pastilei de command center — exact
  // locul lăsat liber de săgeata „→" (Go Forward), stinsă din
  // `workbench.navigationControl.enabled`. VS Code n-are punct de extensie
  // pentru title bar, dar elementul e același nod DOM: mutat, își păstrează
  // handler-ul de click, deci nu trebuie simulat nimic.
  //
  // Gazda se agață de `.command-center`, NU de bara lui de acțiuni: aceea e un
  // ActionBar, iar `clear()` îi golește nodul la fiecare re-randare de meniu și
  // ne-ar rupe rotița din DOM definitiv (elementul de status bar e creat o
  // singură dată, nu se mai întoarce).
  function cogSlot() {
    return document.querySelector('.titlebar-container > .titlebar-center > .window-title > .command-center')
        || document.querySelector('.titlebar-container > .titlebar-right');
  }

  function moveCog() {
    const slot = cogSlot();
    if (!slot) return;

    let host = document.querySelector('.victor-cog-host');
    if (host && host.parentElement === slot && host.querySelector('.statusbar-item')) return;   // deja mutată

    const cog = document.querySelector('.part.statusbar .statusbar-item .codicon-gear');
    if (!cog && !(host && host.querySelector('.statusbar-item'))) return;

    if (!host) {
      host = document.createElement('div');
      host.className = 'victor-cog-host';
    }
    if (host.parentElement !== slot) slot.appendChild(host);
    if (cog) {
      const item = cog.closest('.statusbar-item');
      if (item) host.appendChild(item);
    }
  }

  let lastTitle = null;

  function tick() {
    try {
      // Ieșire rapidă: cât timp titlul n-a mișcat și pastila e la locul ei, nu
      // atingem DOM-ul deloc.
      const title = document.title;
      const left = document.querySelector('.titlebar-container > .titlebar-left');
      moveCog();
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
