// Fișierele Markdown reale de pe mașină: fidelitatea se măsoară pe ce am scris deja, nu pe exemple.
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { open } from './harness.mjs';

const limit = Number(process.argv[2] || 400);
const home = homedir();
const roots = ['victor-vsc', 'victor-skills', 'victor-skills-private', 'human-review', 'petclinic', 'walkie-talkie', 'agentic-wiki', 'assistant', 'travel-ski', 'victor-macos-addons', 'training-assistant', 'victorrentea.ro'];
let files = [`${home}/.claude/CLAUDE.md`, `${home}/workspace/AGENTS.md`];
for (const r of roots) {
  try {
    files.push(...execFileSync('find', [`${home}/workspace/${r}`, '-name', '*.md', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/md-wysiwyg/*'], { encoding: 'utf8' }).split('\n').filter(Boolean));
  } catch (_) { /* folder lipsă */ }
}
files = files.filter(f => { try { return statSync(f).size < 200_000; } catch (_) { return false; } }).slice(0, limit);

const { page, browser, load, errors } = await open();
let bytes = 0;
const lost = [], unstable = [], crashed = [], rawKinds = {};

for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  bytes += text.length;
  try {
    await load(text);
    const r = await page.evaluate(() => {
      const t = window.__mdwTest;
      const ed = t.editor, m = ed.markdown;
      const out = { same: t.text, unstable: [], kinds: {} };
      ed.state.doc.forEach(node => {
        if (node.type.name === 'rawBlock') out.kinds[node.attrs.kind] = (out.kinds[node.attrs.kind] || 0) + 1;
        if (node.type.spec.code) return;
        if (node.type.name === 'paragraph' && !node.childCount) return;
        const md = t.toMarkdown([node.toJSON()]);
        const back = m.parse(md);
        const clean = j => JSON.parse(JSON.stringify(j, (k, v) => (v === null ? undefined : k === 'delimiter' || k === 'marker' || k === 'markdown' ? undefined : v)));
        const a = JSON.stringify(clean(node.toJSON()));
        const b = JSON.stringify(clean(back.content?.length === 1 ? ed.schema.nodeFromJSON(back.content[0]).toJSON() : back.content));
        if (a !== b) { let i = 0; while (a[i] === b[i]) i++; out.unstable.push({ type: node.type.name, a: a.slice(Math.max(0, i - 80), i + 120), b: b.slice(Math.max(0, i - 80), i + 120) }); }
      });
      return out;
    });
    if (r.same !== text) {
      let i = 0; while (i < text.length && text[i] === r.same[i]) i++;
      lost.push({ file, at: i, want: text.slice(i, i + 60), got: r.same.slice(i, i + 60) });
    }
    if (r.unstable.length) unstable.push({ file, n: r.unstable.length, first: r.unstable[0] });
    for (const [k, v] of Object.entries(r.kinds)) rawKinds[k] = (rawKinds[k] || 0) + v;
  } catch (e) {
    crashed.push({ file, error: String(e).slice(0, 300) });
  }
}
const blocksBad = unstable.reduce((n, u) => n + u.n, 0);
console.log(JSON.stringify({ files: files.length, bytes, lost: lost.length, crashed: crashed.length, filesWithUnstableBlocks: unstable.length, blocksBad, rawKinds, pageErrors: errors.length }, null, 1));
for (const l of lost.slice(0, 8)) console.log('LOST', l);
for (const c of crashed.slice(0, 8)) console.log('CRASH', c);
for (const u of unstable.slice(0, 12)) console.log('UNSTABLE', u.file.replace(home, '~'), u.n, JSON.stringify(u.first, null, 0).slice(0, 900));

await browser.close();
process.exit(lost.length || crashed.length ? 1 : 0);
