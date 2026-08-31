#!/usr/bin/env bash
#
# Injectează workbench.css + workbench.js în VS Code și repară checksum-urile.
#
# De rulat DUPĂ FIECARE UPDATE DE VS CODE — update-ul rescrie tot `out/`, deci
# patch-ul dispare fără niciun mesaj. Vezi ../VSCODE-UPDATE.md.
#
#   ./apply.sh            aplică
#   ./apply.sh --watch    aplică + reîncarcă CSS-ul la fiecare 1.5s (pentru reglaje)
#
set -euo pipefail

APP="${VSCODE_APP:-/Applications/Visual Studio Code.app}"
RES="$APP/Contents/Resources/app"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCH=0
[[ "${1:-}" == "--watch" ]] && WATCH=1

[[ -f "$RES/product.json" ]] || { echo "Nu găsesc VS Code în $APP" >&2; exit 1; }
[[ -w "$RES/product.json" ]] || { echo "$RES nu e scriibil — rulează cu drepturi pe /Applications" >&2; exit 1; }

# Înălțimea rândului din Explorer, în px logici. VS Code o ține ca o constantă în
# JS și n-o expune ca setare; din fabrică e 23.4 (nu 22, cum era în versiunile mai
# vechi — de-aia rândurile păreau mai aerisite decât în IntelliJ). 22 e pasul măsurat
# în IntelliJ pe 26 aug 2026, cu cele două ferestre una lângă alta pe același monitor:
# 13 rânduri consecutive, (508-243)/12 = 22.08 la IntelliJ față de (537-279)/11 = 23.45
# la VS Code. Vezi ../COLORS.md.
TREE_ROW_HEIGHT="${TREE_ROW_HEIGHT:-22}"

# Marginea pe care layout-ul „floating panels" o adaugă sub status bar
# (`FLOATING_BOTTOM_PADDING = 10` în bundle). Bara e 22px + marginea asta; cu 0
# footerul ajunge la înălțimea celui din IntelliJ.
STATUS_BAR_FLOATING_PADDING="${STATUS_BAR_FLOATING_PADDING:-0}"

# Lățimea barei de activități (Explorer, Search, …) — doar cutia iconițelor; peste ea
# layout-ul „floating panels" mai adaugă un gutter de 8px, deci pe ecran banda are
# ACTIVITY_BAR_WIDTH + 8. Cu `workbench.activityBar.compact` pornit (cazul lui Victor)
# constanta citită e FLOATING_COMPACT_ACTIVITYBAR_WIDTH, nu cea normală.
# 28 e din fabrică: bandă de 36px cu iconiță de 16 => 10px de o parte și de alta.
# Măsurat pe 26 aug 2026, strip-ul de tool windows din IntelliJ are 34px cu aceleași
# iconițe de 16 => 9px, adică practic la fel; de-aia rămâne pe 28. Dacă vrei spațiul
# chiar la jumătate: ACTIVITY_BAR_WIDTH=18 ./apply.sh (bandă 26px, 5px de fiecare parte).
ACTIVITY_BAR_WIDTH="${ACTIVITY_BAR_WIDTH:-28}"

# Înălțimea title bar-ului cu command center pornit — 35px din fabrică, tot o
# constantă în bundle. 28 = -20%, cât încape fix pastila de 22px cu aer.
TITLE_BAR_HEIGHT="${TITLE_BAR_HEIGHT:-28}"

# Pasul cu care se schimbă `terminal.integrated.fontSize` la zoom (⌘+scroll în
# terminal, plus comenzile Increase/Decrease Font Size). Din fabrică e 1px, adică
# ~9% dintr-un corp de 11px — prea gros ca să nimerești mărimea potrivită la
# proiector. Setarea e `type:"number"` în schema VS Code, deci acceptă și fracții;
# singurul lucru codat în bundle e pasul.
TERMINAL_ZOOM_STEP="${TERMINAL_ZOOM_STEP:-0.5}"

VSCODE_RES="$RES" PATCH_DIR="$HERE" VICTOR_WATCH="$WATCH" ROW_H="$TREE_ROW_HEIGHT" SB_PAD="$STATUS_BAR_FLOATING_PADDING" ACT_W="$ACTIVITY_BAR_WIDTH" TITLE_H="$TITLE_BAR_HEIGHT" ZOOM_STEP="$TERMINAL_ZOOM_STEP" python3 - <<'PY'
import base64, hashlib, json, os, re, shutil, sys

res   = os.environ['VSCODE_RES']
src   = os.environ['PATCH_DIR']
watch = os.environ['VICTOR_WATCH'] == '1'

wb    = os.path.join(res, 'out/vs/code/electron-browser/workbench')
html  = os.path.join(wb, 'workbench.html')
if not os.path.isfile(html):
    sys.exit(f'Nu găsesc {html} — VS Code și-a mutat iar entry point-ul, patch-ul trebuie refăcut.')

# 1. fișierele noastre, copiate lângă workbench.html ca să fie 'self' pentru CSP.
#    Un <link href="file:///..."> ar fi respins de Content-Security-Policy.
css = open(os.path.join(src, 'workbench.css'), encoding='utf8').read()
open(os.path.join(wb, 'victor-workbench.css'), 'w', encoding='utf8').write(css)
js = open(os.path.join(src, 'workbench.js'), encoding='utf8').read()
js = js.replace('const VICTOR_WATCH = false;', f'const VICTOR_WATCH = {"true" if watch else "false"};')
open(os.path.join(wb, 'victor-workbench.js'), 'w', encoding='utf8').write(js)

# 1b. amprenta conținutului, pusă în URL. Fără ea renderer-ul servea CSS-ul din
#     cache la Reload Window (URL identic = același fișier pentru el), așa că
#     regulile noi „nu se aplicau" deși pe disc erau — ore pierdute căutând în
#     selectoare o problemă care era de cache.
stamp = hashlib.sha256((css + js).encode()).hexdigest()[:8]

# 2. injectare idempotentă: întâi scoatem blocul vechi (dacă e), apoi îl punem la loc.
#    Așa nu ținem un backup care s-ar învechi la primul update de VS Code.
BEGIN, END = '<!-- victor-vsc:start -->', '<!-- victor-vsc:end -->'
doc = open(html, encoding='utf8').read()
doc = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), '', doc, flags=re.S).rstrip() + '\n'

block = (f'{BEGIN}\n'
         f'\t<link rel="stylesheet" href="./victor-workbench.css?v={stamp}" data-victor-css>\n'
         f'\t<script src="./victor-workbench.js?v={stamp}" type="module"></script>\n'
         f'\t{END}')
if '</html>' not in doc:
    sys.exit('workbench.html nu are </html> — nu ating nimic.')
doc = doc.replace('</html>', block + '\n</html>')
open(html, 'w', encoding='utf8').write(doc)

# 3. înălțimea rândului din Explorer, o constantă în bundle-ul minificat.
#    Ancora e string-ul de registry dinaintea ei — numele minificate (`Bgt`) se
#    schimbă la fiecare release, string-ul nu. Dacă ancora nu mai prinde, tace și
#    strigă, nu modifică la întâmplare.
row_h = os.environ['ROW_H']
bundle = os.path.join(res, 'out/vs/workbench/workbench.desktop.main.js')
src_js = open(bundle, encoding='utf8').read()
anchor = '"workbench.registry.explorer.fileContributions"'
at = src_js.find(anchor)
if at < 0:
    print('   ATENȚIE: nu găsesc delegatul Explorer-ului, înălțimea rândului rămâne cea din fabrică')
else:
    m = re.search(r'ITEM_HEIGHT=([\d.]+)', src_js[at:at + 4000])
    if not m:
        print('   ATENȚIE: ancora e acolo, dar ITEM_HEIGHT nu — înălțimea rândului rămâne neatinsă')
    elif m.group(1) != row_h:
        i = at + m.start(1)
        src_js = src_js[:i] + row_h + src_js[i + len(m.group(1)):]
        open(bundle, 'w', encoding='utf8').write(src_js)
        print(f'   rând Explorer: {m.group(1)} -> {row_h}')

# 3b. marginea de sub status bar, tot o constantă în bundle. Ancora e chiar
#     numele ei, care e destul de rar ca să nu se confunde cu altceva.
sb = os.environ['SB_PAD']
m = re.search(r'FLOATING_BOTTOM_PADDING=([\d.]+)', src_js)
if not m:
    print('   ATENȚIE: nu găsesc FLOATING_BOTTOM_PADDING, footerul rămâne cel din fabrică')
elif m.group(1) != sb:
    src_js = src_js[:m.start(1)] + sb + src_js[m.end(1):]
    open(bundle, 'w', encoding='utf8').write(src_js)
    print(f'   margine sub status bar: {m.group(1)} -> {sb}')

# 3b-bis. lățimea barei de activități. Cu „floating panels" pornit layout-ul citește
#     FLOATING_*_ACTIVITYBAR_WIDTH, nu ACTIVITYBAR_WIDTH (ăla rămâne pentru layout-ul
#     clasic, deci nu-l atingem), iar cu bara compactă pornită pe cea COMPACT.
#     Numele constantei e destul de rar ca să fie ancoră.
act_w = os.environ['ACT_W']
m = re.search(r'FLOATING_COMPACT_ACTIVITYBAR_WIDTH=([\d.]+)', src_js)
if not m:
    print('   ATENȚIE: nu găsesc FLOATING_COMPACT_ACTIVITYBAR_WIDTH, bara de activități rămâne cea din fabrică')
elif m.group(1) != act_w:
    src_js = src_js[:m.start(1)] + act_w + src_js[m.end(1):]
    open(bundle, 'w', encoding='utf8').write(src_js)
    print(f'   lățime bară de activități: {m.group(1)} -> {act_w}')

# 3c. înălțimea title bar-ului. În bundle e o variabilă minificată (`mte=35`),
#     al cărei nume se schimbă la fiecare release — o găsim prin locul în care e
#     folosită, care e stabil: `this.isCommandCenterVisible||…?<nume>:30`.
title_h = os.environ['TITLE_H']
m = re.search(r'this\.isCommandCenterVisible\|\|\w+\?(\w+):30', src_js)
if not m:
    print('   ATENȚIE: nu găsesc înălțimea title bar-ului, rămâne cea din fabrică')
else:
    name = m.group(1)
    m2 = re.search(rf'\b{name}=(\d+(?:\.\d+)?)\b', src_js)
    if not m2:
        print(f'   ATENȚIE: {name} e folosit, dar nu găsesc unde e definit — title bar neatins')
    elif m2.group(1) != title_h:
        src_js = src_js[:m2.start(1)] + title_h + src_js[m2.end(1):]
        open(bundle, 'w', encoding='utf8').write(src_js)
        print(f'   înălțime title bar: {m2.group(1)} -> {title_h}')

# 3d. marginea pe care editorul o ține deasupra cursorului cât timp sticky scroll
#     e pornit. Din fabrică e `maxLineCount` — PLAFONUL configurat — nu numărul de
#     rânduri lipite chiar acum, deci cu plafonul urcat la 8 (nivelurile de ## din
#     .md, clasa + nested + metoda din .java) fiecare tastă apăsată sus în viewport
#     ar scrola 8 rânduri. Îl întrebăm întâi pe `__victorStickyLines` din
#     victor-workbench.js, care numără ce se vede; dacă lipsește, `??` cade înapoi
#     pe valoarea din fabrică, deci patch-ul e inofensiv fără scriptul injectat.
STICKY_OLD = 'this._stickyScrollEnabled?this._maxNumberStickyLines:0'
STICKY_NEW = 'this._stickyScrollEnabled?(globalThis.__victorStickyLines?.(this)??this._maxNumberStickyLines):0'
if '__victorStickyLines' in src_js:
    pass                       # deja aplicat (bundle nerescris de un update)
elif src_js.count(STICKY_OLD) != 1:
    print('   ATENȚIE: nu găsesc marginea de reveal a sticky scroll-ului — '
          'lasă editor.stickyScroll.maxLineCount pe 1, altfel sare ecranul la tastat')
else:
    src_js = src_js.replace(STICKY_OLD, STICKY_NEW)
    open(bundle, 'w', encoding='utf8').write(src_js)
    print('   margine sticky scroll: maxLineCount -> numărul real de rânduri lipite')

# 3d-bis. rezultatele testelor, ierarhic — ca în IntelliJ.
#     `getTaskChildren` din panoul „Test Results" trece o singură dată prin lista
#     PLATĂ `result.tests` și scoate câte un rând pentru fiecare, deci clasele
#     @Nested de JUnit 5 și metodele lor ies frați, una sub alta. Rescriem
#     expresia ca să întrebe întâi `__victorNestTestResults` din
#     victor-workbench.js, care reconstruiește arborele din prefixele de extId;
#     `?.()` + `??` fac ca lipsa funcției (sau o excepție în ea) să cadă înapoi
#     pe `Iterable.map`, adică pe lista plată din fabrică.
#     Numele minificate se schimbă la fiecare release, deci ancora e forma
#     expresiei — element + incompressible + children —, nu numele.
NEST = re.compile(
    r'(\w+)=(\w+)\.map\((\w+),(\w+)=>\(\{element:(\w+)\.getOrCreate\(\4,\(\)=>new (\w+)'
    r'\((\w+),\4,(\w+)\)\),incompressible:!0,children:(\w+)\(\7,\4,\8\)\}\)\)')
if '__victorNestTestResults' in src_js:
    pass                       # deja aplicat (bundle nerescris de un update)
else:
    m = NEST.search(src_js)
    if not m:
        print('   ATENȚIE: nu găsesc lista de rezultate din panoul Test Results — '
              'testele @Nested rămân plate')
    else:
        node = ('{0}=>({{element:{1}.getOrCreate({0},()=>new {2}({3},{0},{4})),'
                'incompressible:!0,children:{5}({3},{0},{4})}})').format(
                    m.group(4), m.group(5), m.group(6), m.group(7), m.group(8), m.group(9))
        new = '{ne}=globalThis.__victorNestTestResults?.({j},{node})??{It}.map({j},{node})'.format(
            ne=m.group(1), It=m.group(2), j=m.group(3), node=node)
        src_js = src_js[:m.start()] + new + src_js[m.end():]
        open(bundle, 'w', encoding='utf8').write(src_js)
        print('   rezultate de test: listă plată -> arbore (clasele @Nested devin părinți)')

# 3e. poziția butoanelor de markdown din bara de titlu. VS Code sortează acțiunile
#     dintr-un grup după `order` și, la egalitate, ALFABETIC după titlu — iar
#     „Open as Preview", „Reopen as Source File" și „Open Changes" (git) sunt toate
#     pe `navigation@2`. De-aia butonul de toggle stă înaintea lui „Open Changes" în
#     sursă („Open as…" < „Open Ch…") și după el în randare („Open Ch…" < „Reopen…"),
#     deci sare cu o lățime de icon la fiecare click — și își schimbă poziția și
#     după cum fișierul are sau nu modificări în git, fiindcă butonul de git apare
#     doar atunci. Le urcăm ordinul peste tot ce mai contribuie cineva în bara de
#     titlu (restul extensiilor instalate sunt pe `navigation` simplu, adică 0), ca
#     toggle-ul să fie ULTIMUL buton dinaintea celor trei puncte în ambele stări.
md_manifest = os.path.join(res, 'extensions/markdown-language-features/package.json')
MD_NAV = {
    'markdown.showPreviewToSide': 'navigation@8',
    'markdown.reopenAsPreview':   'navigation@9',
    'markdown.showSource':        'navigation@9',
    'markdown.reopenAsSource':    'navigation@9',
}
if not os.path.isfile(md_manifest):
    print('   ATENȚIE: nu găsesc extensia markdown, butonul de preview rămâne unde e')
else:
    man = json.load(open(md_manifest, encoding='utf8'))
    items = man.get('contributes', {}).get('menus', {}).get('editor/title', [])
    moved = [it['command'] for it in items
             if MD_NAV.get(it.get('command')) and it.get('group') != MD_NAV[it['command']]]
    for it in items:
        if it.get('command') in MD_NAV:
            it['group'] = MD_NAV[it['command']]
    if moved:
        json.dump(man, open(md_manifest, 'w', encoding='utf8'), indent='\t')
        # Manifestele extensiilor built-in sunt citite dintr-un cache validat pe
        # mtime-ul FOLDERULUI extensiei; pe APFS o scriere în fișier nu-l atinge,
        # deci fără cele două linii de mai jos VS Code ar servi mai departe
        # varianta veche și patch-ul ar părea că n-a făcut nimic.
        os.utime(os.path.dirname(md_manifest))
        import glob as _glob
        for c in _glob.glob(os.path.expanduser(
                '~/Library/Application Support/Code*/Cached*/**/builtin'), recursive=True):
            os.remove(c)
        print('   butoane markdown mutate la coada barei de titlu:',
              ', '.join(c.split('.')[-1] for c in moved))

# 3f. pasul de zoom al terminalului, tot o constantă din bundle. Din fabrică VS Code
#     sare cu 1px de `terminal.integrated.fontSize` la fiecare notch de ⌘+scroll și
#     la fiecare Increase/Decrease Font Size; cu TERMINAL_ZOOM_STEP=0.5 pasul se
#     înjumătățește. Setarea e `type:"number"` în schemă, deci fracțiile sunt legale.
#     Trei locuri, toate în jurul contribuției `terminal.mouseWheelZoom`:
#       - mouse fizic: fontSize + (±1) la fiecare notch;
#       - trackpad: notch-urile se acumulează întâi (`Math.ceil(|Δ|/5)`), deci se
#         înmulțește rezultatul acumulat, nu incrementul;
#       - comenzile `fontZoomIn` / `fontZoomOut`: fontSize ± 1.
#     Numele minificate se schimbă la fiecare release, deci ancora e forma expresiei
#     plus string-urile din jur, nu numele. Regexurile prind și varianta deja
#     patch-uită, ca să poți schimba pasul rulând scriptul din nou.
zoom_step = os.environ['ZOOM_STEP']
zoom_hits = []

def patch_zoom(pattern, repl, label):
    global src_js
    m = re.search(pattern, src_js, re.S)
    if not m:
        print(f'   ATENȚIE: nu găsesc {label} — pasul de zoom rămâne cel din fabrică')
        return
    new = m.expand(repl)
    if new != m.group(0):
        src_js = src_js[:m.start()] + new + src_js[m.end():]
        zoom_hits.append(label)

patch_zoom(r'(\w+)=(\w+)\.deltaY>0\?-1:1,(\w+)=this\._clampFontSize\(this\._getConfigFontSize\(\)\+\1(?:\*[\d.]+)?\)',
           r'\1=\2.deltaY>0?-1:1,\3=this._clampFontSize(this._getConfigFontSize()+\1*' + zoom_step + ')',
           'zoom-ul de wheel cu mouse fizic')

patch_zoom(r'(\w+)=Math\.ceil\(Math\.abs\((\w+)/5\)\),(\w+)=\2>0\?-1:1,(\w+)=\1\*\3(?:\*[\d.]+)?,',
           r'\1=Math.ceil(Math.abs(\2/5)),\3=\2>0?-1:1,\4=\1*\3*' + zoom_step + ',',
           'zoom-ul de wheel cu trackpad')

for _cmd, _sign in (('fontZoomIn', '+'), ('fontZoomOut', '-')):
    patch_zoom(r'("workbench\.action\.terminal\.' + _cmd + r'".{0,400}?getValue\("terminal\.integrated\.fontSize"\).{0,200}?\(\w+'
               + re.escape(_sign) + r')[\d.]+\)',
               r'\g<1>' + zoom_step + ')',
               f'comanda {_cmd}')

if zoom_hits:
    open(bundle, 'w', encoding='utf8').write(src_js)
    print(f'   pas de zoom la terminal -> {zoom_step}px:', ', '.join(zoom_hits))

# 4. checksum-urile din product.json, recalculate din ce e efectiv pe disc.
#    Fără pasul ăsta VS Code arată la fiecare pornire „Your Code installation
#    appears to be corrupt". Algoritmul e cel din sursă: base64(sha256(fișier)),
#    fără '=' la coadă. (Se aplică la pornirea aplicației, nu la reload de
#    fereastră — deci bannerul mai apare o dată, până la următorul ⌘Q.)
pj = os.path.join(res, 'product.json')
prod = json.load(open(pj, encoding='utf8'))
changed = []
for key in list(prod.get('checksums', {})):
    f = os.path.join(res, 'out', key)
    if not os.path.isfile(f):
        continue
    digest = base64.b64encode(hashlib.sha256(open(f, 'rb').read()).digest()).decode().rstrip('=')
    if prod['checksums'][key] != digest:
        prod['checksums'][key] = digest
        changed.append(key.split('/')[-1])
if changed:
    json.dump(prod, open(pj, 'w', encoding='utf8'), indent='\t')
    print('   checksum actualizat:', ', '.join(changed))

print(f'   injectat în {html}' + ('  [watch pornit]' if watch else ''))
PY

# 5. Iconița aplicației: pătrat negru cu margine subțire colorată (vezi
#    ../app-icon/build-icon.py). Update-ul de VS Code rescrie Code.icns, deci
#    pasul ăsta trebuie să treacă pe aici, nu făcut o dată de mână.
ICON_SRC="$HERE/../app-icon/Code.icns"
ICON_DST="$APP/Contents/Resources/Code.icns"
if [[ -f "$ICON_SRC" ]]; then
  if [[ ! -f "$ICON_DST.orig" ]]; then
    cp "$ICON_DST" "$ICON_DST.orig"
  fi
  if ! cmp -s "$ICON_SRC" "$ICON_DST"; then
    cp "$ICON_SRC" "$ICON_DST"
    # LaunchServices ține iconițele într-un cache legat de mtime-ul bundle-ului;
    # fără touch + repornirea Dock-ului, în Dock rămâne cea veche la nesfârșit.
    touch "$APP"
    rm -rf "$HOME/Library/Caches/com.apple.iconservices.store" 2>/dev/null || true
    killall Dock 2>/dev/null || true
    echo "   iconița aplicației înlocuită (original în Code.icns.orig)"
  fi
fi

# 6. Patch-ul mai vechi care golește logo-ul din editorul gol, dacă mai există.
LETTERPRESS="$HOME/.vscode/letterpress-patch/apply.sh"
if [[ -x "$LETTERPRESS" ]]; then
  "$LETTERPRESS" >/dev/null && echo "   letterpress reaplicat"
fi

echo "Gata. Reload Window din paleta de comenzi ca să se vadă (⌘R e legat doar în build-urile de development)."
