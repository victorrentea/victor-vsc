#!/usr/bin/env bash
#
# Scoate injecția făcută de apply.sh și pune checksum-ul la loc.
# Nu atinge patch-ul de letterpress — ăla are propriul restore.sh.
#
set -euo pipefail

APP="${VSCODE_APP:-/Applications/Visual Studio Code.app}"
RES="$APP/Contents/Resources/app"

VSCODE_RES="$RES" python3 - <<'PY'
import base64, hashlib, json, os, re, sys

res  = os.environ['VSCODE_RES']
wb   = os.path.join(res, 'out/vs/code/electron-browser/workbench')
html = os.path.join(wb, 'workbench.html')

doc = open(html, encoding='utf8').read()
doc = re.sub(r'<!-- victor-vsc:start -->.*?<!-- victor-vsc:end -->\n?', '', doc, flags=re.S)
open(html, 'w', encoding='utf8').write(doc)

for f in ('victor-workbench.css', 'victor-workbench.js'):
    p = os.path.join(wb, f)
    if os.path.exists(p): os.remove(p)

pj   = os.path.join(res, 'product.json')
prod = json.load(open(pj, encoding='utf8'))
key  = 'vs/code/electron-browser/workbench/workbench.html'
prod['checksums'][key] = base64.b64encode(
    hashlib.sha256(open(html, 'rb').read()).digest()).decode().rstrip('=')
json.dump(prod, open(pj, 'w', encoding='utf8'), indent='\t')
print('   scos din', html)
PY

echo "Gata. Reload Window (⌘R)."
