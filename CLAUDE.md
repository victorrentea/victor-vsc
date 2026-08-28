# victor-vsc — regula de lucru

**Orice customizare de VS Code pe care o cere Victor se face AICI**, în această
extensie, nu în `~/Library/Application Support/Code/User/settings.json`.
Extensia e singura sursă: culori, iconițe, profiluri de terminal, comenzi,
butoane, keybindings — toate stau versionate în repo.

Repo public: <https://github.com/victorrentea/victor-vsc> (branch `main`).

## Ciclul complet, la fiecare schimbare

1. Editează fișierele de aici.
2. Bump `version` în `package.json` (VS Code nu reinstalează peste aceeași versiune).
3. Împachetează și instalează:
   ```sh
   npx --yes @vscode/vsce package
   "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
     --install-extension victor-vsc-<version>.vsix --force
   ```
   `code` nu e în PATH — de-aia calea completă din bundle.
4. **Commit și push la fiecare schimbare** — nu se lasă lucruri necomise:
   ```sh
   git add -A && git commit -m "..." && git push
   ```
5. **Dă tu reload window** — nimic nu se aplică fără, iar Victor nu vrea să fie
   el pasul manual de la finalul fiecărui task:
   ```sh
   ./reload-window.py
   ```
   Scriptul vorbește cu listener-ul din `relay-terminal.js` (endpoint `/reload`,
   autentificat cu token-ul din `~/.walkie-talkie/ide/`) și reîncarcă **toate**
   ferestrele VS Code deschise. Toate, nu doar cea din față: rulând dintr-un
   terminal, nicio fereastră VS Code nu e focusată, deci „cea activă" nu se poate
   observa de aici — și oricum build-ul nou trebuie să ajungă în fiecare extension
   host. Filtrele `--folder NAME` / `--focused` există dacă vrei totuși să țintești.

   Reload-ul nu pierde nimic: editoarele nesalvate revin prin hot exit, iar
   terminalele integrate se reconectează (`terminal.integrated.enablePersistentSessions`).
   Singura excepție reală: dacă sesiunea **ta** de Claude rulează chiar în
   terminalul integrat al ferestrei pe care o reîncarci, o tai sub tine — atunci
   întreabă-l pe Victor în loc să dai reload.

`*.vsix` e în `.gitignore`, deci artefactele de build nu ajung în repo.

## Unde stă ce

| fișier | ce face |
|---|---|
| `package.json` | toate `contributes`: culori (`configurationDefaults`), icon theme, profil de terminal, custom editor, comenzi, meniuri, setări |
| `COLORS.md` | de ce sunt culorile alea — `package.json` e JSON strict, n-are comentarii |
| `extension.js` | status bar (breadcrumb, problems, cog), profilul de terminal Claude |
| `puml.js` | randare PlantUML + comanda text / split / diagramă |
| `reload-window.py` | reîncarcă ferestrele VS Code după instalarea unei versiuni noi (pasul 5) |
| `relay-terminal.js` | listener pe loopback prin care Walkie Talkie livrează dictarea în EXACT terminalul legat (`sendText`), în loc de clipboard + ⌘V care ateriza unde e cursorul |
| `build-flower-font.py` | generează `icons/victor-icons.woff` (floarea din dropdown-ul de terminale) |
| `intellij-icon-theme.json`, `icons/` | icon theme-ul expui |
| `app-icon/` | iconița aplicației (negru + margine subțire colorată, în cheia IntelliJ); o instalează `vscode-patch/apply.sh` |

## Ce NU poate o extensie — și unde se rezolvă

O extensie n-are acces la DOM-ul workbench-ului: fontul și densitatea din
Explorer, layout-ul title bar-ului, interceptat click-uri pe UI-ul VS Code.
Pentru astea Victor a ridicat restricția de a modifica aplicația: patch-ul stă
în `vscode-patch/` (`workbench.css`, `workbench.js`, `apply.sh`, `restore.sh`).

Reguli pentru zona asta:

- orice adaugi acolo trebuie să treacă prin `apply.sh`, ca să se reaplice după
  update-urile de VS Code — vezi `VSCODE-UPDATE.md`;
- dacă atingi un fișier din lista `checksums` din `product.json`, recalculează
  checksum-ul în `apply.sh`, altfel apare bannerul „installation appears to be
  corrupt";
- CSP-ul din `workbench.html` acceptă doar `'self'`, deci fișierele injectate se
  copiază în bundle, nu se linkuiesc din `~/workspace`.

Ce ține de setări oficiale rămâne în `package.json` → `configurationDefaults`;
patch-ul e ultima soluție, nu prima.

Excepție: setările citite de **procesul main** al Electron (`window.*` de
deschidere de ferestre — `openFoldersInNewWindow`, `openFilesInNewWindow`, …).
Main-ul parsează doar `settings.json`-ul utilizatorului, deci un
`configurationDefaults` acolo arată corect în UI și nu face nimic. Pentru ele,
`enforceMainProcessSettings()` din `extension.js` scrie valoarea în setările
globale la activare — sursa rămâne versionată aici.
