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
