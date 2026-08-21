# Lecții din update-urile de VS Code

Procedura e în [`VSCODE-UPDATE.md`](VSCODE-UPDATE.md). Aici stă doar ce s-a
învățat *rulând-o* — capcanele care au costat timp, ca să nu se plătească de
două ori. Câte o secțiune per update.

## 1.133.0 → 1.134.0 (21 aug 2026)

Update-ul a fost dat din meniu (**Code → Restart to Update**; după update
intrarea redevine „Check for Updates…"). Binarul era deja descărcat de fundal în
`~/Library/Caches/com.microsoft.VSCode.ShipIt/update.*/`, deci click-ul doar a
schimbat bundle-ul și a repornit aplicația.

### Ce a mers fără nicio modificare

Toate cele trei ancore din `apply.sh` au prins pe 1.134 — n-a fost nevoie să
umblu la script:

| ce | ancora | rezultat |
|---|---|---|
| rând Explorer | `"workbench.registry.explorer.fileContributions"` → `ITEM_HEIGHT` | 22 → 23.4 |
| margine sub status bar | `FLOATING_BOTTOM_PADDING` | 10 → 0 |
| înălțime title bar | `this.isCommandCenterVisible\|\|…?<nume>:30` | `Hte` = 35 → 28 |

Numele minificat al înălțimii title bar-ului e `Hte` pe 1.134 — se schimbă la
fiecare release, de-aia ancora e locul de folosire, nu numele.

Neschimbate și ele, deci `workbench.js` și `workbench.css` au mers ca atare:

- entry point-ul e tot `out/vs/code/electron-browser/workbench/workbench.html`
  (singurul `workbench*.html` din bundle);
- CSP-ul e același — `script-src 'self' 'unsafe-eval' blob:`,
  `style-src 'self' 'unsafe-inline'`, plus `require-trusted-types-for 'script'`,
  pe care patch-ul nu-l atinge fiindcă nu scrie `innerHTML`;
- title bar-ul se construiește la fel: `.titlebar-container` cu
  `.titlebar-left` / `.titlebar-center` / `.titlebar-right`.

Extensia (`victorrentea.victor-vsc@0.0.29`) și `~/.vscode/letterpress-patch/`
au trecut update-ul intacte, cum scrie în `VSCODE-UPDATE.md`. Bannerul
„installation appears to be corrupt" n-a apărut: `apply.sh` a rescris
checksum-urile pentru `workbench.html` și `workbench.desktop.main.js` înainte de
prima pornire de după patch.

### Capcana 1 — aplicația se repornește singură, cu întârziere

După „Restart to Update", VS Code **nu** revine instant: bundle-ul se schimbă
întâi, iar procesul pornește la loc după câteva zeci de secunde. Dacă rulezi
`apply.sh` în fereastra aia, patch-ul ajunge pe disc **sub o aplicație deja
pornită**, care are `workbench.html` citit de mult — și UI-ul arată nepatchat
deși pe disc totul e corect. Exact așa a ieșit aici: procesul a pornit la
19:15:15, `apply.sh` a scris la 19:15:46, iar prima verificare vizuală n-a găsit
nici pastila de branch, nici butonul de unelte.

Ordinea sigură: **apply.sh → repornire completă a aplicației**, indiferent dacă
pare pornită sau nu.

### Capcana 2 — `pgrep … MacOS/Electron` nu mai prinde nimic

Executabilul din bundle e `Contents/MacOS/Code` (`CFBundleExecutable = Code`).
Un `pgrep -f "Visual Studio Code.app/Contents/MacOS/Electron"` întoarce gol **cu
aplicația pornită** — un `until pgrep …` pe modelul ăsta a stat 120s degeaba.
Ce funcționează:

```sh
pgrep -f "Visual Studio Code.app/Contents/MacOS/Code"
osascript -e 'tell application "System Events" to (name of processes) contains "Code"'
```

### Capcana 3 — ⌘R trimis din System Events nu reîncarcă fereastra

`keystroke "r" using command down` peste fiecare fereastră n-a produs **nicio**
linie nouă în `renderer.log` — se pierde (focus în terminalul integrat, sau
binding-ul nu e cel presupus; paleta de comenzi e remapată pe `ctrl+p` în
`keybindings.json`). Nu te lua după faptul că fereastra „clipește".

Verificarea care chiar spune dacă s-a reîncărcat:

```sh
tail -3 ~/Library/Application\ Support/Code/logs/<cel mai recent>/window1/renderer.log
```

Linii noi = reload. Ce a funcționat până la urmă: `quit` + `open -a`, care e
oricum necesar pentru letterpress (SVG-urile sunt în cache) și pentru ca VS Code
să re-verifice checksum-urile.

### Cum verifici că patch-ul e viu, fără să te uiți în UI

```sh
RES="/Applications/Visual Studio Code.app/Contents/Resources/app"
grep -c victor-vsc "$RES/out/vs/code/electron-browser/workbench/workbench.html"   # 2 = injectat
grep -o 'ITEM_HEIGHT=23.4\|FLOATING_BOTTOM_PADDING=0' "$RES/out/vs/workbench/workbench.desktop.main.js"
python3 - <<'PY'
import base64, hashlib, json, os
res = "/Applications/Visual Studio Code.app/Contents/Resources/app"
prod = json.load(open(res + "/product.json"))
bad = [k for k, v in prod.get("checksums", {}).items()
       if os.path.isfile(os.path.join(res, "out", k))
       and base64.b64encode(hashlib.sha256(open(os.path.join(res, "out", k), "rb").read()).digest()).decode().rstrip("=") != v]
print("checksum-uri greșite:", bad or "niciunul")
PY
```

Cele de mai sus spun doar că *fișierele* sunt corecte. Că `workbench.js` chiar
**rulează** se vede într-un singur loc: pastila de branch stânga-sus și butonul
de unelte din stânga pastilei de titlu. Dacă fișierele sunt bune și butoanele
lipsesc, e capcana 1 sau 3 — nu s-a reîncărcat renderer-ul.

### Rămas de rezolvat, descoperit cu ocazia asta (nu ține de update)

`gpt-token-counter-live` 1.5.2 a **unit** paleta de highlight cu numărul de
tokeni într-o singură intrare de status bar (`statusBar.text =
"$(symbol-color) 228 tok (GPT)"`, un singur `createStatusBarItem`). Regula din
`workbench.css` scrisă pe 15 aug ascundea o intrare separată:

```css
.part.statusbar .statusbar-item:has(> a.statusbar-item-label > .codicon-symbol-color) { display: none; }
```

Acum ea ascunde tot item-ul, deci **„N tok (GPT)" nu se mai vede deloc** cât timp
patch-ul e aplicat. Nu e o regresie din 1.134 — era așa și înainte, doar că
patch-ul lipsea de la update încoace. Fixul e în CSS: ascunde doar glifa
(`.statusbar-item[…] > a.statusbar-item-label > .codicon-symbol-color { display: none }`),
nu item-ul părinte.
