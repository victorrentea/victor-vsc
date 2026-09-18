const vscode = require('vscode');
const fs = require('fs');
const yaml = require('./media/js-yaml/js-yaml.min.js');

const VIEW_TYPE = 'victor-vsc.openapiPreview';

/**
 * Swagger UI ÎN TAB, nu lângă el.
 *
 * 42crunch.vscode-openapi randează spec-ul într-un webview panel deschis în
 * split — adică un al doilea tab, cu altă identitate, care nu are nimic de-a
 * face cu fișierul. Aici e același tipar ca la `puml.js`: un custom editor peste
 * ACELAȘI document, deci butonul ⇄ îl comută ca pe orice alt tip randabil, iar
 * fișierul rămâne un singur tab. Butonul lor e scos din bară din `vscode-patch`
 * (vezi comentariul de acolo), exact ca dublura lui jebbs.plantuml.
 *
 * Ce NU face: nu rezolvă `$ref`-uri către alte fișiere. 42Crunch face bundling
 * peste tot proiectul; aici pleacă documentul așa cum e, iar un ref extern apare
 * nerezolvat în Swagger UI. Pentru spec-urile dintr-un singur fișier — cazul de
 * la petclinic — nu se vede diferența.
 */

/* ------------------------------------------------------------- detecția */

// Un `.yaml` nu înseamnă OpenAPI, și un `.json` cu atât mai puțin: dacă ne-am
// lua după extensie, butonul ⇄ ar apărea peste orice fișier de configurare din
// proiect. Deci se uită în conținut, în primii câțiva KB, după cheia de versiune
// — `openapi: 3.1.0` sau `"swagger": "2.0"`. `(^|[{,])` o cere drept CHEIE, ca
// să nu prindă cuvântul dintr-o descriere sau dintr-un URL.
const EXTS = ['.yaml', '.yml', '.json'];
const HEAD_BYTES = 4096;
const MARKER = /(^|[{,])\s*["']?(openapi|swagger)["']?\s*:\s*["']?\d/m;

// `classify()` din render-toggle trece prin toate tab-urile la fiecare
// eveniment de tab, deci detecția se cheamă des. Ștampila e versiunea
// documentului deschis (care se schimbă la fiecare tastă) sau mtime-ul de pe
// disc, ca un fișier care tocmai a devenit OpenAPI să nu rămână necunoscut.
const cache = new Map();

function openDoc(uri) {
  const id = uri.toString();
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === id);
}

function head(uri, doc) {
  if (doc) return doc.getText().slice(0, HEAD_BYTES);
  const fd = fs.openSync(uri.fsPath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.slice(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function looksLikeOpenapi(uri) {
  if (!uri || uri.scheme !== 'file') return false;
  const name = uri.fsPath.toLowerCase();
  if (!EXTS.some(e => name.endsWith(e))) return false;

  const doc = openDoc(uri);
  let stamp;
  if (doc) stamp = `d${doc.version}`;
  else {
    try { stamp = `f${fs.statSync(uri.fsPath).mtimeMs}`; } catch (_) { return false; }
  }

  const key = uri.toString();
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.value;

  let value = false;
  try { value = MARKER.test(head(uri, doc)); } catch (_) { value = false; }
  if (cache.size > 200) cache.clear();
  cache.set(key, { stamp, value });
  return value;
}

/* ---------------------------------------------------------------- parse */

/**
 * YAML și JSON ajung amândouă obiect aici, în extensie, nu în webview: o eroare
 * de sintaxă trebuie să se citească ca o eroare de sintaxă (cu linia ei), nu ca
 * un „Failed to load API definition" lângă care nu scrie nimic util. js-yaml
 * citește și JSON-ul, deci e un singur drum — dar `JSON.parse` dă mesaje mai
 * bune pe JSON, deci fișierele `.json` merg pe el.
 */
function parse(document) {
  const text = document.getText();
  if (!text.trim()) return { ok: false, error: 'Fișier gol — nimic de randat.' };
  const isJson = document.uri.fsPath.toLowerCase().endsWith('.json');
  try {
    const spec = isJson ? JSON.parse(text) : yaml.load(text, { json: true });
    if (!spec || typeof spec !== 'object') return { ok: false, error: 'Documentul nu e un obiect OpenAPI.' };
    return { ok: true, spec };
  } catch (err) {
    // js-yaml poartă poziția în `mark`; JSON.parse o are doar în text.
    const line = err && err.mark && typeof err.mark.line === 'number' ? ` (linia ${err.mark.line + 1})` : '';
    return { ok: false, error: `${err.message || err}${line}` };
  }
}

/* -------------------------------------------------------------- webview */

function nonce() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function html(webview, extensionUri) {
  const n = nonce();
  const asset = f => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'swagger-ui', f));
  const cs = webview.cspSource;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cs} 'unsafe-inline'; script-src 'nonce-${n}';
               img-src ${cs} data: https: http:; font-src ${cs} data:; connect-src https: http:;">
<link rel="stylesheet" href="${asset('swagger-ui.css')}">
<link rel="stylesheet" href="${asset('dark.css')}">
<style>
  body { margin: 0; background: var(--vscode-editor-background); }
  /* Banda de eroare stă DEASUPRA randării vechi, nu în locul ei: cât scrii, YAML-ul
     e invalid la fiecare a doua tastă, iar o pagină care se golește și revine ar
     clipi tot timpul. Deci ultima formă bună rămâne pe ecran, cu un avertisment
     lipit sus. */
  #err { display: none; position: sticky; top: 0; z-index: 10; margin: 0;
         padding: 8px 12px; white-space: pre-wrap;
         font: 12px/1.5 var(--vscode-editor-font-family);
         color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
         background: var(--vscode-inputValidation-errorBackground, rgba(150,0,0,.25));
         border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }
  #err.on { display: block; }
</style></head>
<body>
  <pre id="err"></pre>
  <div id="ui"></div>
  <script nonce="${n}" src="${asset('swagger-ui-bundle.js')}"></script>
  <script nonce="${n}">
    const err = document.getElementById('err');
    let ui = null;

    function create(spec) {
      ui = SwaggerUIBundle({
        spec,
        dom_id: '#ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
        // Fără deepLinking: ar scrie în hash-ul unui webview care oricum nu are
        // istoric de navigat, și ar sări la ancoră la fiecare redesenare.
        deepLinking: false,
        docExpansion: 'list',
        defaultModelsExpandDepth: 0,
        tryItOutEnabled: false,
      });
    }

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'spec') {
        err.classList.remove('on');
        if (!ui) { create(m.spec); return; }
        // Redesenarea păstrează scroll-ul, ca la puml: altfel fiecare tastă ar
        // arunca pagina înapoi sus.
        const y = window.scrollY;
        try {
          ui.specActions.updateSpec(JSON.stringify(m.spec));
        } catch (_) {
          document.getElementById('ui').innerHTML = '';
          create(m.spec);
        }
        requestAnimationFrame(() => window.scrollTo(0, y));
      } else if (m.type === 'error') {
        err.textContent = m.message;
        err.classList.add('on');
      }
    });
  </script>
</body></html>`;
}

/* -------------------------------------------------------- custom editor */

class OpenapiEditorProvider {
  constructor(extensionUri) { this.extensionUri = extensionUri; }

  resolveCustomTextEditor(document, panel) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    panel.webview.html = html(panel.webview, this.extensionUri);

    let timer;
    const draw = () => {
      const res = parse(document);
      panel.webview.postMessage(res.ok
        ? { type: 'spec', spec: res.spec }
        : { type: 'error', message: res.error });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 300); };

    const sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) schedule();
    });
    panel.onDidDispose(() => { clearTimeout(timer); sub.dispose(); });
    draw();
  }
}

/* ------------------------------------------------------------- register */

function register(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE, new OpenapiEditorProvider(context.extensionUri), {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
  );
}

module.exports = { register, VIEW_TYPE, looksLikeOpenapi };
