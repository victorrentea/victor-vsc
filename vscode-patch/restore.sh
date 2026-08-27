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

# constantele din bundle, înapoi la valorile din fabrică. Amândouă se aplică pe
# același șir și se scriu o singură dată — altfel a doua scriere o pierde pe prima.
bundle = os.path.join(res, 'out/vs/workbench/workbench.desktop.main.js')
src = open(bundle, encoding='utf8').read()
dirty = []

at = src.find('"workbench.registry.explorer.fileContributions"')
if at >= 0:
    m = re.search(r'ITEM_HEIGHT=([\d.]+)', src[at:at + 4000])
    if m and m.group(1) != '22':
        i = at + m.start(1)
        src = src[:i] + '22' + src[i + len(m.group(1)):]
        dirty.append(f'rând Explorer: {m.group(1)} -> 22')

m = re.search(r'FLOATING_BOTTOM_PADDING=([\d.]+)', src)
if m and m.group(1) != '10':
    src = src[:m.start(1)] + '10' + src[m.end(1):]
    dirty.append(f'margine status bar: {m.group(1)} -> 10')

if dirty:
    open(bundle, 'w', encoding='utf8').write(src)
    for d in dirty: print('  ', d)

# butoanele de markdown, înapoi pe ordinul din fabrică (vezi 3e din apply.sh).
md_manifest = os.path.join(res, 'extensions/markdown-language-features/package.json')
MD_NAV = {
    'markdown.showPreviewToSide': 'navigation@1',
    'markdown.reopenAsPreview':   'navigation@2',
    'markdown.showSource':        'navigation@2',
    'markdown.reopenAsSource':    'navigation@2',
}
if os.path.isfile(md_manifest):
    man = json.load(open(md_manifest, encoding='utf8'))
    items = man.get('contributes', {}).get('menus', {}).get('editor/title', [])
    if any(it.get('group') != MD_NAV[it['command']] for it in items if it.get('command') in MD_NAV):
        for it in items:
            if it.get('command') in MD_NAV:
                it['group'] = MD_NAV[it['command']]
        json.dump(man, open(md_manifest, 'w', encoding='utf8'), indent='\t')
        os.utime(os.path.dirname(md_manifest))
        import glob as _glob
        for c in _glob.glob(os.path.expanduser(
                '~/Library/Application Support/Code*/Cached*/**/builtin'), recursive=True):
            os.remove(c)
        print('   butoane markdown: înapoi pe navigation@1/@2')

pj   = os.path.join(res, 'product.json')
prod = json.load(open(pj, encoding='utf8'))
for key in list(prod.get('checksums', {})):
    f = os.path.join(res, 'out', key)
    if os.path.isfile(f):
        prod['checksums'][key] = base64.b64encode(
            hashlib.sha256(open(f, 'rb').read()).digest()).decode().rstrip('=')
json.dump(prod, open(pj, 'w', encoding='utf8'), indent='\t')
print('   scos din', html)
PY

echo "Gata. Reload Window din paleta de comenzi (⌘R e legat doar în build-urile de development)."
