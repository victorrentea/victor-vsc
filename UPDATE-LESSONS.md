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

### Capcana 3 — ⌘R **nu** e Reload Window într-un build stable

`keystroke "r" using command down` peste fiecare fereastră n-a produs **nicio**
linie nouă în `renderer.log`. Motivul nu e focusul, ci comanda însăși: în bundle
`workbench.action.reloadWindow` e declarată cu

```js
keybinding: { weight: 250, when: SD, primary: 2096 }   // SD = new Z("isDevelopment"), 2096 = ⌘R
```

adică ⌘R e legat **doar** în build-urile de development. În VS Code stable
scurtătura nu există — Reload Window se dă din paleta de comenzi (remapată aici
pe `ctrl+p`). Documentația din repo scria „⌘R"; era greșită și e corectată.

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

### Descoperit cu ocazia asta, reparat pe loc (nu ținea de update)

`gpt-token-counter-live` 1.5.2 a **unit** paleta de highlight cu numărul de
tokeni într-o singură intrare de status bar (`statusBar.text =
"$(symbol-color) 228 tok (GPT)"`, un singur `createStatusBarItem`, fiindcă
prioritățile din jurul lui 100 sunt ocupate de item-ele native). Regula scrisă
pe 15 aug ascundea o intrare separată, deci ascundea acum tot item-ul —
**„N tok (GPT)" dispăruse din status bar** cât timp patch-ul era aplicat.

Nu era o regresie din 1.134: era așa de la update-ul extensiei, doar că
patch-ul lipsea de la update-ul de VS Code încoace, așa că nu se văzuse.

Regula ascunde acum doar glifa, nu item-ul părinte, și prinde toate cele trei
stări (`symbol-color` / `paintcan` / `circle-slash`) printr-un `> .codicon`
delimitat de aria-label — cu prefix, fiindcă din 1.5.2 label-ul e „Toggle token
highlighting **and select a model family**", nu mai e egal cu cel vechi:

```css
.part.statusbar .statusbar-item > a.statusbar-item-label[aria-label^="Toggle token highlighting"] > .codicon {
  display: none;
}
```

Morala mai largă: o regulă care ascunde `.statusbar-item` întreg e o bombă cu
ceas — extensia poate să-și fuzioneze item-ele oricând, iar CSS-ul continuă să
„funcționeze", doar că ascunde altceva decât credeai. Când ținta e o glifă,
selectorul trebuie să se oprească la glifă.
