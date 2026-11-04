// Banc de probă în VS Code real: instanță izolată, condusă de Playwright, fără mouse-ul nimănui.
// `node test/lab.mjs <folder cu sample.md>` — sandbox-ul trebuie instalat în /tmp/vsc-lab-*.
import { _electron as electron } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const shots = process.argv[3] || dir;
const sample = join(dir, 'sample.md');
const original = readFileSync(sample, 'utf8');
const app = await electron.launch({
  executablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  args: ['--user-data-dir=/tmp/vsc-lab-ud', '--extensions-dir=/tmp/vsc-lab-ed', '--disable-workspace-trust',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
    '--skip-welcome', '--skip-release-notes', '--disable-updates', dir, sample],
  // `~/.vscode/argv.json` fixează portul de debugging al instanței reale; în banc n-are ce căuta.
  env: { ...process.env, VSCODE_PORTABLE: '/tmp/vsc-lab-portable' },
  timeout: 60000,
});
const win = await app.firstWindow();
await win.waitForSelector('.monaco-workbench', { timeout: 60000 });
const say = (...a) => console.log(...a);
// Fereastra poate fi în spatele alteia: fără asta, Chromium o consideră nefocusată și nu livrează tastele.
const cdp = await win.context().newCDPSession(win);
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
say('workbench up', await win.title());

async function editorFrame() {
  for (let i = 0; i < 100; i++) {
    for (const f of win.frames()) {
      if (await f.locator('.mdw-content').count().catch(() => 0)) return f;
    }
    await win.waitForTimeout(100);
  }
  throw new Error('no webview editor');
}

const keys = async k => win.keyboard.press(k);
// comută în forma randată prin butonul real din title bar
await win.waitForTimeout(2500);
const btn = win.locator('.editor-actions a[aria-label*="Rendered"], .editor-actions a[aria-label*="rendered"], .editor-actions .action-label[aria-label*="Render"]').first();
say('buttons', await win.locator('.editor-actions a.action-label').evaluateAll(a => a.map(x => x.getAttribute('aria-label'))));
await btn.click();
const f = await editorFrame();
await f.locator('.mdw-content h1').waitFor();
await win.waitForTimeout(2500);
say('tabs', await win.locator('.tabs-container .tab').evaluateAll(t => t.map(x => x.getAttribute('aria-label'))));
await win.screenshot({ path: join(shots, 'lab-dark.png') });

// tastare reală în Last paragraph, autosave pe disc
await f.locator('.mdw-content p', { hasText: 'Last paragraph' }).click({ force: true, timeout: 5000 });
await win.waitForTimeout(300);
const state = () => f.evaluate(() => ({ focus: document.hasFocus(), active: document.activeElement?.className, sel: window.__mdwTest.editor.state.selection.from, end: window.__mdwTest.text.slice(-40) }));
say('state', await state());
await f.evaluate(() => { const e = window.__mdwTest.editor; e.commands.setTextSelection(e.state.doc.content.size - 1); });
await win.waitForTimeout(100);
await win.keyboard.type(' typed in VS Code');
await win.waitForTimeout(400);
say('state', await state());
say('dirty tabs', await win.locator('.tabs-container .tab.dirty').count());
await keys('Meta+s');
await win.waitForTimeout(700);
say('dirty tabs after ⌘S', await win.locator('.tabs-container .tab.dirty').count());
const after = readFileSync(sample, 'utf8');
say('disk edit minimal:', after === original.replace('Last paragraph.', 'Last paragraph. typed in VS Code'));
if (after !== original.replace('Last paragraph.', 'Last paragraph. typed in VS Code')) say(after);

// ⌘B în webview: bold, fără să închidă sidebar-ul
const sidebarBefore = await win.locator('.part.sidebar').isVisible();
await keys('Meta+b');
await win.keyboard.type('BOLD');
await keys('Meta+b');
await win.waitForTimeout(400);
say('bold:', await state());
say('sidebar neatins de ⌘B:', sidebarBefore === await win.locator('.part.sidebar').isVisible());
// ⌘Z de 2 ori: intră în ProseMirror, nu în VS Code
await keys('Meta+z');
await keys('Meta+z');
await win.waitForTimeout(300);
say('undo:', await state());
await keys('Meta+s');
await win.waitForTimeout(700);
say('după undo:', JSON.stringify(readFileSync(sample, 'utf8').slice(-60)));

// fișier schimbat pe disc (un agent): apare în editor, fără reload
const now = readFileSync(sample, 'utf8');
writeFileSync(sample, now.replace('# Java Code Style', '# Java Code Style CHANGED BY AGENT'));
await f.locator('.mdw-content h1', { hasText: 'CHANGED BY AGENT' }).waitFor({ timeout: 8000 });
say('schimbare externă vizibilă: ok');

// ⌘F: widgetul de căutare
await f.locator('.mdw-content p', { hasText: 'Keep methods' }).click();
await keys('Meta+f');
await win.waitForTimeout(500);
say('find widget:', await win.locator('.simple-find-part, .find-widget').count());
await win.screenshot({ path: join(shots, 'lab-find.png') });
await keys('Escape');

// ⌘-click pe link deschide fișierul; înapoi pe text cu butonul
await f.locator('.mdw-content a', { hasText: 'other' }).click({ modifiers: ['Meta'] });
await win.waitForTimeout(1200);
say('tabs după link', await win.locator('.tabs-container .tab').evaluateAll(t => t.map(x => x.getAttribute('aria-label'))));

await win.locator('.tabs-container .tab', { hasText: 'sample.md' }).click();
await win.waitForTimeout(800);
say('buttons', await win.locator('.editor-actions a.action-label').evaluateAll(a => a.map(x => x.getAttribute('aria-label'))));
await win.locator('.editor-actions a[aria-label*="Source"], .editor-actions a[aria-label*="source"]').first().click();
await win.waitForTimeout(1500);
say('tabs după ⇄', await win.locator('.tabs-container .tab').evaluateAll(t => t.map(x => x.getAttribute('aria-label'))));
say('monaco:', await win.locator('.monaco-editor .view-lines').count());
await win.screenshot({ path: join(shots, 'lab-text.png') });
await app.close();
