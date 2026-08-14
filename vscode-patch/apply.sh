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

VSCODE_RES="$RES" PATCH_DIR="$HERE" VICTOR_WATCH="$WATCH" python3 - <<'PY'
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

# 3. checksum-ul din product.json. Fără pasul ăsta VS Code arată la fiecare
#    pornire „Your Code installation appears to be corrupt". Algoritmul e chiar
#    cel din sursă: base64(sha256(fișier)), fără '=' la coadă.
pj = os.path.join(res, 'product.json')
prod = json.load(open(pj, encoding='utf8'))
key = 'vs/code/electron-browser/workbench/workbench.html'
digest = base64.b64encode(hashlib.sha256(open(html, 'rb').read()).digest()).decode().rstrip('=')
if prod.get('checksums', {}).get(key) != digest:
    prod['checksums'][key] = digest
    json.dump(prod, open(pj, 'w', encoding='utf8'), indent='\t')
    print('   checksum workbench.html actualizat')

print(f'   injectat în {html}' + ('  [watch pornit]' if watch else ''))
PY

# 4. Patch-ul mai vechi care golește logo-ul din editorul gol, dacă mai există.
LETTERPRESS="$HOME/.vscode/letterpress-patch/apply.sh"
if [[ -x "$LETTERPRESS" ]]; then
  "$LETTERPRESS" >/dev/null && echo "   letterpress reaplicat"
fi

echo "Gata. Reload Window (⌘R) ca să se vadă."
