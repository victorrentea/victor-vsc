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
# JS (22 din fabrică) și n-o expune ca setare; 23.4 e valoarea măsurată care pune
# rândul peste cel din IntelliJ. Vezi ../COLORS.md.
TREE_ROW_HEIGHT="${TREE_ROW_HEIGHT:-23.4}"

# Marginea pe care layout-ul „floating panels" o adaugă sub status bar
# (`FLOATING_BOTTOM_PADDING = 10` în bundle). Bara e 22px + marginea asta; cu 0
# footerul ajunge la înălțimea celui din IntelliJ.
STATUS_BAR_FLOATING_PADDING="${STATUS_BAR_FLOATING_PADDING:-0}"

VSCODE_RES="$RES" PATCH_DIR="$HERE" VICTOR_WATCH="$WATCH" ROW_H="$TREE_ROW_HEIGHT" SB_PAD="$STATUS_BAR_FLOATING_PADDING" python3 - <<'PY'
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
shutil.copyfile(os.path.join(src, 'workbench.css'), os.path.join(wb, 'victor-workbench.css'))
js = open(os.path.join(src, 'workbench.js'), encoding='utf8').read()
js = js.replace('const VICTOR_WATCH = false;', f'const VICTOR_WATCH = {"true" if watch else "false"};')
open(os.path.join(wb, 'victor-workbench.js'), 'w', encoding='utf8').write(js)

# 2. injectare idempotentă: întâi scoatem blocul vechi (dacă e), apoi îl punem la loc.
#    Așa nu ținem un backup care s-ar învechi la primul update de VS Code.
BEGIN, END = '<!-- victor-vsc:start -->', '<!-- victor-vsc:end -->'
doc = open(html, encoding='utf8').read()
doc = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), '', doc, flags=re.S).rstrip() + '\n'

block = (f'{BEGIN}\n'
         '\t<link rel="stylesheet" href="./victor-workbench.css" data-victor-css>\n'
         '\t<script src="./victor-workbench.js" type="module"></script>\n'
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

echo "Gata. Reload Window (⌘R) ca să se vadă."
