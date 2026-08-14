# După fiecare update de VS Code

Un update de VS Code rescrie tot `/Applications/Visual Studio Code.app/Contents/Resources/app/out/`.
Patch-urile de mai jos dispar **fără niciun mesaj** — nu se strică nimic, doar
se întoarce UI-ul la cum arăta din fabrică. Semnul e simplu: dispare pastila cu
branch-ul din stânga sus, iar Explorer-ul revine la fontul de sistem.

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
3. Recalculează checksum-ul lui `workbench.html` și îl scrie în `product.json`.
   **Ăsta e pasul care ține departe bannerul „Your Code installation appears to
   be corrupt"** — fișierul e în lista de checksums din `product.json`, iar VS
   Code îl verifică la fiecare pornire. Algoritmul e cel din sursă:
   `base64(sha256(fișier))` fără `=` la coadă.
4. Reaplică `~/.vscode/letterpress-patch/apply.sh` (golește logo-ul din editorul
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

## Ce nu supraviețuiește update-ului și NU e în script

Nimic, deocamdată. Dacă apare un patch nou peste bundle, se adaugă în
`apply.sh` — nu într-un fișier de instrucțiuni pe lângă.
