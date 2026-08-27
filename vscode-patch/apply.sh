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

VSCODE_RES="$RES" PATCH_DIR="$HERE" VICTOR_WATCH="$WATCH" ROW_H="$TREE_ROW_HEIGHT" SB_PAD="$STATUS_BAR_FLOATING_PADDING" ACT_W="$ACTIVITY_BAR_WIDTH" TITLE_H="$TITLE_BAR_HEIGHT" python3 - <<'PY'
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

# 4. Patch-ul mai vechi care golește logo-ul din editorul gol, dacă mai există.
LETTERPRESS="$HOME/.vscode/letterpress-patch/apply.sh"
if [[ -x "$LETTERPRESS" ]]; then
  "$LETTERPRESS" >/dev/null && echo "   letterpress reaplicat"
fi

echo "Gata. Reload Window din paleta de comenzi ca să se vadă (⌘R e legat doar în build-urile de development)."
