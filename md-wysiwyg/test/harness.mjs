// Webview-ul real, în Chromium headless: bundle-ul din `media/`, cu VS Code înlocuit de un stub
// care ține minte mesajele. Așa testele trec prin ProseMirror-ul adevărat, cu DOM adevărat.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const media = resolve(import.meta.dirname, '../../media/md-wysiwyg');
const builtin = '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/markdown-language-features/media';

export async function open({ theme = 'vscode-dark', viewport } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: viewport || { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --vscode-editor-background:#1e1f22; --vscode-editorWidget-background:#2b2d30; --vscode-editorWidget-border:#43454a;
            --vscode-foreground:#ccc; --vscode-editor-selectionBackground:#214283; --vscode-textCodeBlock-background:#2b2d30; }
    body { color:#ccc; background:#1e1f22 } body.vscode-light { color:#333; background:#fff }
    ${readFileSync(`${builtin}/markdown.css`, 'utf8')}
    ${readFileSync(`${builtin}/highlight.css`, 'utf8')}
    ${readFileSync(`${media}/editor.css`, 'utf8')}
    </style></head><body class="${theme}">
    <textarea id="mdw-frontmatter" hidden spellcheck="false"></textarea><div id="mdw-editor"></div>
    <script id="mdw-boot" type="application/json">${JSON.stringify({
      nonce: '', baseUri: 'https://base.test/docs/', rootUri: 'https://base.test/', readOnly: false,
      assets: { mermaid: 'https://assets.test/mermaid.min.js', katex: 'https://assets.test/katex.min.js' },
    })}</script></body></html>`);
  await page.route('https://assets.test/*', route => route.fulfill({
    path: `${media}/${new URL(route.request().url()).pathname.slice(1)}`, contentType: 'text/javascript',
  }));
  await page.evaluate(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.sent.push(m) });
  });
  await page.addScriptTag({ path: `${media}/editor.js` });
  const load = text => page.evaluate(t => {
    window.sent.length = 0;
    window.postMessage({ type: 'load', text: t }, '*');
    return new Promise(r => setTimeout(r, 30));
  }, text);
  const edits = () => page.evaluate(() => { window.__mdwTest.flush(); return window.sent.filter(m => m.type === 'edit').map(m => m.text); });
  return { browser, page, load, edits, errors };
}
