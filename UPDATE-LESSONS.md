# Lecții din update-urile de VS Code

Procedura e în [`VSCODE-UPDATE.md`](VSCODE-UPDATE.md). Aici stă doar ce s-a
învățat *rulând-o* — capcanele care au costat timp, ca să nu se plătească de
două ori. Câte o secțiune per update.

## 1.136.1 → 1.137.0 (10 sep 2026) — o singură ancoră ruptă, din două motive deodată

Update-ul a venit tot din butonul „Update with AI". Lanțul a mers până la capăt:
marker armat, `apply.sh` rulat singur la 15:36:34, ieșire 0 — dar cu un „ATENȚIE"
pe înălțimea title bar-ului, deci pasul 4 (repornirea automată) **nu** s-a
executat, cum e proiectat, și în loc de asta s-a deschis terminalul cu `claude`.
Restul patch-urilor prinseseră deja: `margine sub status bar: 6 -> 0`, sticky
scroll, arborele de teste, butoanele de markdown, pasul de zoom la terminal.

### Ancora title bar-ului: `$` nu e `\w`, iar `:30` nu mai e acolo

Pe 1.137 constanta se cheamă `$oe` (era `mte` pe 1.134, `Hte` pe 1.135). Ancora
veche

```python
re.search(r'this\.isCommandCenterVisible\|\|\w+\?(\w+):30', src_js)
```

pică din **două** motive independente, și e util să se știe amândouă, fiindcă
reparat doar unul ar fi părut că merge:

1. **`\w` nu prinde `$`.** Terser folosește `$` ca literă normală în numele
   generate, deci `[\w$]` e clasa corectă peste tot unde ancora citește un nume
   minificat. Din același motiv **nu se poate căuta definiția cu `\b`**:
   `re.search(rf'\b{name}=…')` nu găsește niciodată `var $oe=35`, fiindcă între
   spațiu și `$` nu există graniță de cuvânt — ambele sunt non-word. Căutarea e
   acum `(?:^|[^\w$.])` + `re.escape(name)` + `=(\d+…)[,;]`; `re.escape` fiindcă
   `$` e ancoră în regex, iar `[^…\.]` ca să nu nimerească un `x.$oe=`.
2. **`:30` a dispărut din forma pe care o citim.** Getter-ul e acum
   `let e=$t&&Oge(),t=this.isCommandCenterVisible||e?$oe:30`, dar subclasa nativă
   de macOS (nouă în 1.137) are `this.isCommandCenterVisible?$oe:this.macTitlebarSize`.
   Ancora se oprește la `?<nume>:` și nu mai spune nimic despre ce urmează.

`macTitlebarSize` e `this.tahoeOrNewer?32:28` — se folosește **doar** cu command
center-ul ascuns, deci nu ne atinge (Victor îl are pornit, pastila de branch stă
chiar în el). `$oe` e citit și de poziționarea notificărilor (`t+=$oe`), care
vrea oricum înălțimea reală — deci un singur loc de scris acoperă tot.

### `FLOATING_BOTTOM_PADDING` are de-acum un frate care-l conține

1.137 a adăugat `COMPACT_DENSITY_FLOATING_BOTTOM_PADDING=4`, folosit când
`window.density.layout` e `"compact"`. Numele vechi intră în cel nou ca **sufix**,
deci vechiul `re.search(r'FLOATING_BOTTOM_PADDING=…')` putea nimeri constanta
greșită și raporta linia de succes obișnuită. De data asta cea bună e prima în
fișier, deci a mers din noroc; ancora cere acum `this.` în față.

Consecință de ținut minte: cât timp `window.density.layout` **nu** e `"compact"`,
patch-ul lucrează pe constanta citită. Dacă densitatea compactă se pornește
vreodată, marginea de 4px se întoarce și `apply.sh` va spune că totul e în regulă
— pentru că, pe constanta lui, chiar e.

### `ITEM_HEIGHT` rămâne 22 din fabrică

Ca pe 1.136.1. Absența liniei „rând Explorer: … -> 22" din log nu e un semn de
rău, e semnul că nu era nimic de schimbat.

### Reparat pe drum: injecția din `workbench.html` nu era stabilă la bit

`apply.sh` scotea blocul `<!-- victor-vsc:start --> … :end -->` cu un `re.sub` care
lăsa în urmă **linia goală** pe care stătuse. La fiecare rulare fișierul creștea cu
un rând, deci checksum-ul ieșea altul și scriptul rulat de două ori la rând
raporta „checksum actualizat: workbench.html" fără să se fi schimbat nimic real.
Zgomotul ăsta e exact ce nu vrei când rulezi scriptul de mai multe ori după un
update, ca să verifici că a ieșit curat. Ștergerea ia acum și indentarea și
newline-ul, plus un `\n{3,}` care curăță ce adunaseră rulările vechi — două rulări
consecutive lasă acum fișierul identic la bit.

## 1.135.0 → 1.136.1 (6 sep 2026) — primul update dat din butonul „Update with AI"

Update-ul a fost dat din butonul nou din bara de titlu, nu din meniu. Lanțul a
mers cap-coadă, fără nimic manual: marker armat la click, `apply.sh` rulat singur
la 21:37:23 (ieșire 0, niciun „ATENȚIE"), aplicație repornită singură la 21:39:16.
Verificat după aceea în UI, nu doar pe disc: pastila de branch și butonul de
unelte sunt la locul lor, deci `workbench.js` chiar rulează pe 1.136.

Log-ul rulării: `globalStorage/victorrentea.victor-vsc/update-patch.log`.

### Ce s-a schimbat în bundle

Toate ancorele au prins. Două constante au venit din fabrică cu alte valori:

| ce | pe 1.135 | pe 1.136.1 | rezultat |
|---|---|---|---|
| `ITEM_HEIGHT` (rând Explorer) | 23.4 | **22** | nimic de făcut — `apply.sh` nu scrie și nu raportează când valoarea e deja cea vrută |
| `FLOATING_BOTTOM_PADDING` | 10 | 6 | 6 → 0, ca înainte |
| `FLOATING_COMPACT_ACTIVITYBAR_WIDTH` | 28 | 28 | neatinsă, e chiar valoarea din fabrică |

Adică VS Code a ajuns singur la înălțimea de rând a IntelliJ-ului. Pasul rămâne
în script: dacă un release o mută la loc, se reaplică singur — dar de-acum
**absența liniei „rând Explorer: … -> 22" din log nu mai e un semn de rău**, e
semnul că nu era nimic de schimbat.

### Butonul albastru de update, ca ancoră DOM

`workbench.js` se agață de `.update-indicator.prominent` (containerul cu
`role="button"` din jurul lui e item-ul de action bar pe care se apasă). Pe
1.136.1 structura e neschimbată față de 1.135, unde a fost scrisă.

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
