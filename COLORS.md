# De ce culorile astea

Valorile stau în `package.json`, la `contributes.configurationDefaults` →
`workbench.colorCustomizations`, pe temele **IntelliJ IDEA Islands Light / Dark**.
`package.json` e JSON strict, deci n-are unde ține comentarii — de-aia
raționamentul e aici. Au venit din `settings.json`-ul meu; extensia e acum
singura sursă, iar orice pun în `settings.json` bate extensia.

## Griul stă pe ramă, nu peste tot

Măsurat pe benzi întregi din screenshot-ul lui IntelliJ, nu ghicit: chrome-ul
(toolbar de sus, stripul de iconițe, status bar) e `#E8EAED` / `#ECEDF0`, iar
**conținutul** — panoul Project, tab-urile, editorul, terminalul — e alb curat
(`#FFFFFF`), respectiv `#1E1F22` pe dark. Contrastul ramă/conținut separă
panourile singur, deci bordurile scad la un fir abia vizibil în loc de liniile
negre de dinainte.

Pe dark asta înseamnă: tool windows `#2B2D30` **doar** pe titluri, headere de
secțiune și status bar; arborele Explorer, panoul de jos și terminalul stau pe
`#1E1F22`, aceeași culoare cu editorul. Bordurile: `#393B40`.

## Activity bar

Măsurat din stripul IntelliJ: butonul selectat e un pătrat plin `#D9D9DB`
(neselectat `#E9EAEE`) — și **nu** are bară-indicator în stânga, deci
`activityBar.activeBorder` e transparentă în loc s-o las să dubleze marcajul.

## Iconițele de simbol

Culorile de nod din IntelliJ New UI, luate din SVG-urile expui din
[intellij-community](https://github.com/JetBrains/intellij-community)
(Apache-2.0) — nu ghicite. Colorează codicon-urile `symbol-*` pe care le
desenează view-ul JAVA PROJECTS, plus Outline, breadcrumbs și lista de
completare. Varianta dark folosește fișierele `_dark` din aceleași surse.

## Fundalurile din zona de cod

Măsurate din editorul IntelliJ, pe același monitor: fundalurile deschise
non-albe ies `#F5F8FE` (linia curentă) și `#EDEBFB` (identificatorul de sub
cursor). Al treilea din IntelliJ, `#EBFCEE` (highlight de limbaj injectat),
n-are echivalent în VS Code.

## Roșul de erori din arbore

Numele fișierelor/folderelor cu erori nu mai sunt roșii
(`list.errorForeground` / `list.warningForeground` → culoarea normală de text).
VS Code colorează eticheta **și** badge-ul din același token, deci badge-ul își
pierde și el roșul — nu se pot separa fără CSS. Culorile git rămân.

## Culorile VCS

Luate din `DefaultColorSchemesManager.xml` din intellij-community — sursa pe
care o citește IntelliJ însuși. IntelliJ: modificat = albastru, adăugat = verde,
netracked („Unknown") = cărămiziu, ignorat = oliv.

---

## Nu doar culori: `editor.stickyScroll.maxLineCount: 1`

Cu sticky scroll pornit, editorul refuză să lase cursorul mai sus de
`stickyScroll.maxLineCount` linii de marginea de sus — codul din `revealRange`:

```js
I = Math.max(cursorSurroundingLines, stickyScrollEnabled ? maxNumberStickyLines : 0)
```

Default-ul lui `maxLineCount` e **5**, deci la fiecare tastă apăsată pe o linie
aflată sus în viewport, ecranul sare cu până la 5 rânduri ca să facă loc marginii.
Marginea are sens — altfel cursorul ar ajunge sub widget-ul sticky — dar widget-ul
arată o singură linie la un fișier de note, deci 1 e valoarea corectă, nu 5.

---

## Lista de fișiere, potrivită peste IntelliJ

Două valori, ambele măsurate, nu alese din ochi:

| | valoare | unde |
|---|---|---|
| font | Inter **14.6px** | `vscode-patch/workbench.css` |
| înălțime rând | **23.4px** | `vscode-patch/apply.sh`, `TREE_ROW_HEIGHT` |

VS Code ține înălțimea rândului ca o constantă în JS (`ITEM_HEIGHT = 22` în
delegatul Explorer-ului) și n-o expune ca setare — de-aia se patchează bundle-ul,
ancorat pe string-ul `"workbench.registry.explorer.fileContributions"`, care
supraviețuiește update-urilor, spre deosebire de numele minificate din jur.

**Cum s-a măsurat**, fiindcă metoda evidentă dă răspunsuri greșite: înălțimea
benzii de cerneală a unui rând include iconița fișierului, care e mai mare decât
textul și diferă între cele două IDE-uri — de trei ori mi-a spus că IntelliJ are
textul mai mare, când de fapt îl avea mai mic. Ce funcționează: **diferența de
lățime dintre două nume din același arbore** (ex. `petclinic-observability` minus
`openspec`). Aia e lățime de text curată — fără iconițe, fără indentare, fără
scala ecranului. Rândurile îngroșate (modulele, în IntelliJ) se sar.

Rezultat, VS Code vs IntelliJ: 102.0 / 101.5 px, 42.0 / 41.0, 60.0 / 60.5, pas
de rând 28.0 / 28.0.

⚠️ Cifrele sunt pentru fereastra cu **zoom-ul curent** (un pas de ⌘+, adică 1.2).
Zoom-ul înmulțește și fontul, și rândul, deci un ⌘0 le micșorează pe amândouă cu
20% și potrivirea se pierde. Dacă schimbi zoom-ul, se remăsoară.

### Grosimea și culoarea, nu doar mărimea

Mărimea potrivită nu ajunge — textul tot „nu arată la fel". Celelalte două axe,
măsurate cu ambele ferestre pe **același ecran și aceeași scală** (altfel 1x vs
2x falsifică totul):

| | VS Code | IntelliJ |
|---|---|---|
| culoarea textului (max pe rând) | 210 | 211 |
| acoperire de cerneală | 21.2% | 21.5% |
| lățimi pe aceleași nume | 117 / 101 / 118 / 99 | 116 / 99 / 116 / 99 |

- **Culoarea**: `sideBar.foreground: #D0D2D8` — măsurată din IntelliJ, nu luată din
  documentația New UI, care zice `#DFE1E5` și e vizibil mai deschis decât ce
  desenează IDE-ul de fapt.
- **Grosimea**: greyscale-ul workbench-ului dă cu 15% mai puțină cerneală decât
  IntelliJ, iar `subpixel-antialiased` sare cu 10% peste. Niciuna nu nimerește,
  deci: greyscale + `-webkit-text-stroke: 0.17px`, singura pârghie continuă.
  Rezultat: raport 1.015, sub pragul de zgomot al măsurătorii.

Două capcane de măsurare, ambele m-au trimis pe piste greșite:
- **percentila ca „vârf"**: numele lungi au mai mulți pixeli de antialias, care
  trag percentila în jos și fac rândurile să pară mai închise. Max-ul pe rând e
  210 peste tot — nu există nicio inconsistență. Folosește max, nu p99.
- **acoperirea pe o casetă lată**: normalizată pe toată lățimea panoului include
  spațiul gol din dreapta, care diferă între cele două IDE-uri. Se calculează
  strict pe caseta strânsă a cuvântului.
