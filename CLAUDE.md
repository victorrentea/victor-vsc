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
| `open-in-browser.py` | deschide un URL în browserul embedded al ferestrei care are folderul curent — vezi mai jos |
| `open-in-editor.py` | deschide un fișier în fereastra care **conține** calea (nu cea din față) și o ridică — vezi mai jos |
| `git.js` | helper-e de git (rădăcină, remote, branșă) folosite de `github-link.js` și `open-file-reporter.js` |
| `github-link.js` | „Copy GitHub Link" din click-dreapta în Explorer, pe branșa curentă |
| `open-file-reporter.js` | raportează fișierul privit către Victor Addons — port al `OpenFileReporter.kt` din plugin-ul `live-coding` |
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

## Deschiderea unui URL în fereastra „asta"

`./open-in-browser.py <url>` arată o pagină în browserul embedded al ferestrei VS Code
care are deschis folderul git curent (`--folder NAME` ca să țintești altul). Există
pentru rapoartele HTML pe care le produc skill-urile: `open` le dă pe mâna Chrome, pe
alt desktop, în timp ce terminalul care le-a construit e chiar în editor.

Trei lucruri măsurate, care arată de ce e scris exact așa:

- **ținta se alege după folder, nu după focus.** Cât timp lucrează un agent, fereastra
  focusată e de obicei alta (Victor se uită în altă parte). Din terminal fereastra
  proprie nu e observabilă — de-aia treaba asta trebuie făcută din interiorul editorului.
- **`env.openExternal` deschide Chrome, nu Browser View-ul nativ.** 1.134 are un browser
  intern, iar `workbench.browser.openLocalhostLinks` (pornit din `configurationDefaults`)
  trimite acolo orice link localhost **click-uit în workbench**. Dar acela e un opener
  contribuit în workbench; `openExternal` dintr-o extensie îl ocolește și ajunge în
  procesul main. Nativul se atinge doar prin API propus (`$openBrowserTab`), interzis unei
  extensii instalate. Deci endpoint-ul folosește `simpleBrowser.api.open` cu
  `ViewColumn.Beside`. Consecință: auto-open → Simple Browser, ⌘-click pe același URL în
  terminal → Browser View. Două browsere embedded pentru aceeași pagină.
- **`file://` nu merge în niciunul.** Iframe-ul Simple Browser e legat de un CSP
  `frame-src *`, iar wildcard-ul nu acoperă schemele non-network: iese panou alb, fără
  nicio eroare. Cine cheamă servește folderul și dă URL-ul de localhost.

## Deschiderea unui fișier în fereastra care îl conține

`./open-in-editor.py /cale/absolută/File.java:120` deschide fișierul în fereastra VS
Code al cărei **workspace folder conține calea**, și o ridică. Acceptă și un
`vscode://file/...` ca argument, deci un link din raport se poate da direct.

Măsurat pe 1.135, cu trei ferestre pe trei checkout-uri ale aceluiași proiect
(`petclinic`, `petclinic-main`, `petclinic-pr`):

- **`open vscode://file/<abs>` rutează deja corect.** Fiecare link a aterizat în
  fereastra care ținea acel checkout, chiar când alta era ultima activă, și forma cu
  slash dublu (`vscode://file//Users/...`, cea emisă efectiv de rapoarte) se comportă
  la fel. Deci scriptul **nu** e un patch pentru cazul obișnuit — nu strica ce merge.
- **Ce nu merge:** o cale pe care n-o deține nicio fereastră deschisă cade pe ultima
  activă. Fișierul e corect (URL-ul poartă calea absolută), dar se deschide într-o
  fereastră care ține alt proiect — iar referința `path:line` de lângă el, lipită în
  Quick Open, se rezolvă în *acel* proiect, unde aceeași cale relativă există cu alt
  conținut. Nu e o eroare, e un fișier plauzibil greșit.
- **Și a doua instanță de VS Code.** LaunchServices știe o singură aplicație; procesul
  main care răspunde rutează doar printre ferestrele *lui*. Registrul de sub
  `~/.walkie-talkie/ide/` e per extension host, deci acoperă instanțe care nu se văd
  între ele.
- **`/ping` publică acum căile absolute ale folderelor** (`folders`), nu doar numele
  primului. Un nume nu e o adresă: două checkout-uri se numesc amândouă `petclinic`.
  Alegerea e pe cel mai lung prefix care se potrivește — fereastra deschisă pe checkout
  bate fereastra deschisă pe folderul de deasupra.
- **`showTextDocument` nu ridică fereastra.** Măsurat: fișierul s-a deschis corect și
  aplicația din față n-a fost schimbată, deci click-ul părea că nu face nimic.
  `/open-file` rulează acum și `workbench.action.focusWindow` — exact ce rulează și
  handler-ul de URL-uri al lui VS Code după ce tratează un `vscode://`.

**Nu se pune mâna pe schema `vscode://` la nivel de OS.** VS Code o folosește pentru
callback-urile lui de OAuth (`vscode://vscode.github-authentication/...`); un alt
handler pe ea ar rupe login-urile în feluri imposibil de diagnosticat mai târziu.
Rutarea stă în afara schemei — în registru și în scriptul ăsta — iar schema rămâne
fallback-ul, cum era.

**Intrări moarte în registru:** o fereastră care crapă nu apucă să-și șteargă fișierul.
O intrare e crezută doar după ce procesul pe care-l numește răspunde, pe portul lui, cu
token-ul lui. Portul *refuzat* → intrarea se șterge (dovadă că fereastra nu mai e);
timeout → nu se șterge nimic (nu dovedește nimic, iar o fereastră vie rămasă fără
fișier de registru e deconectată de Walkie Talkie până la următoarea activare).
