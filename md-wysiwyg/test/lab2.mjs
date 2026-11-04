// A doua trecere prin VS Code real: autoSave, tema light, bare plutitoare, poziția la ⇄.
import { _electron as electron } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2], shots = process.argv[3];
const sample = join(dir, 'sample.md');
const app = await electron.launch({
  executablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  args: ['--user-data-dir=/tmp/vsc-lab-ud', '--extensions-dir=/tmp/vsc-lab-ed', '--disable-workspace-trust',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
    '--skip-welcome', '--skip-release-notes', '--disable-updates', dir, sample],
  env: { ...process.env, VSCODE_PORTABLE: '/tmp/vsc-lab-portable' }, timeout: 60000,
});
const win = await app.firstWindow();
await win.waitForSelector('.monaco-workbench', { timeout: 60000 });
const cdp = await win.context().newCDPSession(win);
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await win.waitForTimeout(2500);
const say = (...a) => console.log(...a);
let f;
const frame = async () => { for (let i = 0; i < 100; i++) { for (const x of win.frames()) if (await x.locator('.mdw-content').count().catch(() => 0)) return x; await win.waitForTimeout(100); } throw new Error('no editor'); };
const showRendered = win.locator('.editor-actions a[aria-label="Show Rendered"]');
if (await showRendered.count()) await showRendered.click();
f = await frame();
await f.locator('.mdw-content h1').waitFor();
await win.waitForTimeout(2000);

// bara de selecție
await f.evaluate(() => { const e = window.__mdwTest.editor; e.commands.focus(); e.commands.setTextSelection({ from: 12, to: 30 }); });
await win.waitForTimeout(300);
await win.screenshot({ path: join(shots, 'lab-light-bar.png') });

// autoSave
await f.evaluate(() => window.__mdwTest.editor.commands.setTextSelection(14));
await win.keyboard.type('XY');
await win.waitForTimeout(1500);
say('autoSave pe disc:', readFileSync(sample, 'utf8').includes('XY'), 'dirty', await win.locator('.tabs-container .tab.dirty').count());

// bara de tabel
await f.evaluate(() => { const t = window.__mdwTest; let at; t.editor.state.doc.descendants((n, p) => { if (at === undefined && n.isText && n.text === '1') at = p; }); t.editor.commands.setTextSelection(at + 1); });
await win.waitForTimeout(300);
say('table bar', await f.locator('.mdw-bar:not([hidden])').allInnerTexts());
await win.screenshot({ path: join(shots, 'lab-light-table.png') });

// ⇄ de jos din fișier: textul se deschide tot acolo
await f.evaluate(() => { [...document.querySelectorAll('h2')].find(h => h.textContent === 'Section 80').scrollIntoView(); });
await win.waitForTimeout(300);
await win.locator('.editor-actions a[aria-label="Show Source"]').click();
await win.waitForTimeout(1500);
say('prima linie vizibilă în text:', await win.locator('.monaco-editor .line-numbers').first().innerText().catch(e => e.message));
say('text vizibil:', (await win.locator('.monaco-editor .view-line').first().innerText()).slice(0, 40));
// și înapoi
await win.locator('.editor-actions a[aria-label="Show Rendered"]').click();
await win.waitForTimeout(1500);
f = await frame();
await win.waitForTimeout(800);
say('sus în randat:', await f.evaluate(() => [...document.querySelectorAll('[data-line]')].find(e => e.getBoundingClientRect().bottom > 0)?.textContent?.slice(0, 40)));
say('debug', await Promise.all(win.frames().map(async x => [await x.locator('.mdw-content').count().catch(() => -1), await x.evaluate(() => [window.scrollY, innerHeight, document.querySelectorAll('[data-line]').length, document.scrollingElement?.scrollTop]).catch(() => null)])));
await win.screenshot({ path: join(shots, 'lab-back.png') });
await app.close();
