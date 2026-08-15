# După fiecare update de VS Code

Un update de VS Code rescrie tot `/Applications/Visual Studio Code.app/Contents/Resources/app/out/`.
Patch-urile de mai jos dispar **fără niciun mesaj** — nu se strică nimic, doar
se întoarce UI-ul la cum arăta din fabrică. Semnele sunt simple: dispare pastila
cu branch-ul din stânga sus și butonul de unelte din stânga pastilei de titlu,
bara de sus redevine mai înaltă (35px în loc de 28), iar Explorer-ul revine la
fontul de sistem cu rânduri mai strânse.

## Ce rulezi

```sh
~/workspace/victor-vsc/vscode-patch/apply.sh
```

Apoi **Reload Window** (⌘R). Atât. Scriptul e idempotent — poate fi rulat de
oricâte ori, nu se dublează nimic.

Ca să verifici că a prins, fără să te uiți la UI:

```sh
grep -c victor-vsc "/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html"
```

`0` = patch-ul nu e aplicat.

## Ce face scriptul, pas cu pas

1. Copiază `vscode-patch/workbench.css` și `workbench.js` lângă `workbench.html`,
   în bundle-ul aplicației, sub numele `victor-workbench.*`. **Trebuie** să stea
   acolo: Content-Security-Policy-ul din `workbench.html` acceptă doar
   `style-src 'self'`, deci un `<link href="file:///Users/...">` ar fi respins.
2. Șterge blocul `<!-- victor-vsc:start --> … <!-- victor-vsc:end -->` dacă
   există, și îl injectează la loc înainte de `</html>`. De asta nu ține backup:
   un backup făcut înainte de update ar fi din versiunea veche de VS Code, adică
   exact ce nu vrei să pui înapoi.
   URL-urile poartă o amprentă a conținutului (`?v=b23a3efd`). **Fără ea,
   renderer-ul servea CSS-ul din cache la Reload Window** — fișierul de pe disc
   era cel nou, dar pagina rula cu regulile vechi, și părea că „nu se aplică
   selectorul". Amprenta se schimbă la fiecare modificare, deci cache-ul pică
   singur.
3. Rescrie trei constante din `workbench.desktop.main.js`, pe care VS Code nu le
   expune ca setări. Numele minificate se schimbă la fiecare release, deci
   ancora e de fiecare dată ceva stabil din jur, nu numele:
   - **înălțimea rândului din Explorer** (`ITEM_HEIGHT`, 22 → 23.4), găsită după
     string-ul `"workbench.registry.explorer.fileContributions"`;
   - **marginea de sub status bar** (`FLOATING_BOTTOM_PADDING`, 10 → 0);
   - **înălțimea title bar-ului cu command center** (35 → 28, adică −20%),
     găsită după `this.isCommandCenterVisible||…?<nume>:30`.

   Dacă o ancoră nu mai prinde, scriptul **spune „ATENȚIE" și nu modifică
   nimic** — citește ce scrie în terminal după update, acolo apare.
4. Recalculează checksum-urile fișierelor atinse (`workbench.html` și
   `workbench.desktop.main.js`) și le scrie în `product.json`.
   **Ăsta e pasul care ține departe bannerul „Your Code installation appears to
   be corrupt"** — fișierele sunt în lista de checksums din `product.json`, iar
   VS Code o verifică la pornirea aplicației (nu la Reload Window, deci bannerul
   mai poate apărea o dată, până la următorul ⌘Q). Algoritmul e cel din sursă:
   `base64(sha256(fișier))` fără `=` la coadă.
5. Reaplică `~/.vscode/letterpress-patch/apply.sh` (golește logo-ul din editorul
   gol), dacă mai există. Acela golește SVG-uri din `out/media/`, care **nu**
   sunt în lista de checksums.

## Ca să dai înapoi

```sh
~/workspace/victor-vsc/vscode-patch/restore.sh
```

Scoate injecția și pune checksum-ul la loc. Un update de VS Code face oricum
același lucru.

## Când reglăm fonturi

```sh
~/workspace/victor-vsc/vscode-patch/apply.sh --watch
```

Pune în pagină un mic poller care reîncarcă CSS-ul la 1.5s, ca să nu fie nevoie
de ⌘R după fiecare modificare de `workbench.css`. Rulează `apply.sh` fără flag
când s-a terminat reglajul — pollerul n-are ce căuta în starea finală.

## De ce nu o extensie de pe Marketplace

- **APC Customize UI++** patchează `bootstrap-amd.js` și
  `vs/code/electron-sandbox/workbench/workbench.html`. Din VS Code 1.94 (migrarea
  la ESM) **niciunul nu mai există** — pe 1.133 extensia nu are ce patcha.
- **Custom CSS and JS Loader** funcționează, dar face exact ce face `apply.sh`
  și pe deasupra lasă bannerul de instalare coruptă, fiindcă nu atinge
  `product.json`.

## Ce ține de DOM și se poate rupe la un release nou

`workbench.js` citește DOM-ul workbench-ului, deci un release care redenumește
clase îl lasă fără efect (tăcut, prin `try/catch` — nu strică nimic). Ce
depinde de ce:

| ce vezi | de ce se ține |
|---|---|
| pastila de branch, stânga sus | `.titlebar-container > .titlebar-left`, plus titlul ferestrei, din care citește numele branch-ului (`${activeRepositoryBranchName}` în `window.title`) |
| butonul de unelte, stânga pastilei de titlu | `.titlebar-container > .titlebar-center` + intrarea de status bar `victorrentea.victor-vsc.tools`, pe care o apasă în locul tău |
| middle-click = ⌘-click în cod | `.monaco-editor .view-lines` și faptul că editorul citește `metaKey` din evenimentul DOM |

## Ce nu supraviețuiește update-ului și NU e în script

Nimic, deocamdată. Dacă apare un patch nou peste bundle, se adaugă în
`apply.sh` — nu într-un fișier de instrucțiuni pe lângă.

Extensia (`victor-vsc-*.vsix`) e altă poveste: ea **supraviețuiește**
update-urilor de VS Code, se instalează separat și e ceea ce ține setările,
culorile, iconițele și butonul din status bar. Vezi `README.md`.
