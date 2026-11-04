// Scenarii de editare, cu tastatură reală, în webview-ul real. `node test/run.mjs`
import assert from 'node:assert/strict';
import { open } from './harness.mjs';

const { browser, page, load, edits, errors } = await open();
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', name, e.message.slice(0, 700)]); }
}

/** Pune cursorul la capătul primului text care conține `needle`. */
const caretAfter = async (needle, offset = needle.length) => { await page.evaluate(([n, o]) => {
  const { editor } = window.__mdwTest;
  let at = null;
  editor.state.doc.descendants((node, pos) => {
    if (at === null && node.isText && node.text.includes(n)) at = pos + node.text.indexOf(n) + o;
  });
  editor.commands.focus();
  editor.commands.setTextSelection(at);
}, [needle, offset]); await page.waitForTimeout(40); };
const type = text => page.keyboard.type(text);
const press = key => page.keyboard.press(key);
const text = () => page.evaluate(() => window.__mdwTest.text);
const settle = () => page.waitForTimeout(150);

const MESSY = `Intro with  double  spaces
wrapped on a second line.

* star item one
* star item two

__under__ and _em_ and snake_case and a > b.

***

| a   |  b |
|:----|---:|
| 1   |  2 |

  - indented list

Final paragraph.
`;

await test('deschis și neatins: nimic nu pleacă spre fișier', async () => {
  await load(MESSY);
  assert.deepEqual(await edits(), []);
  assert.equal(await text(), MESSY);
});

await test('o literă într-un paragraf: restul fișierului rămâne octet cu octet', async () => {
  await load(MESSY);
  await caretAfter('Final paragraph');
  await type('!');
  await settle();
  assert.equal(await text(), MESSY.replace('Final paragraph.', 'Final paragraph!.'));
});

await test('editarea primului paragraf păstrează spațiile duble din el doar dacă le atinge', async () => {
  await load('alpha\n\nkeep   *this*   line\n\nomega\n');
  await caretAfter('omega');
  await type('X');
  await settle();
  assert.equal(await text(), 'alpha\n\nkeep   *this*   line\n\nomegaX\n');
});

await test('undo până la capăt întoarce exact sursa de la încărcare', async () => {
  await load(MESSY);
  await caretAfter('star item one');
  await type('abc');
  await settle();
  assert.notEqual(await text(), MESSY);
  for (let i = 0; i < 4; i++) await press('Meta+z');
  await settle();
  assert.equal(await text(), MESSY);
});

await test('într-o listă cu `*`, markerul rămâne `*` la editare', async () => {
  await load('* one\n* two\n');
  await caretAfter('two');
  await type('2');
  await settle();
  assert.equal(await text(), '* one\n* two2\n');
});

await test('Enter la capătul unui paragraf: rând gol între blocuri', async () => {
  await load('one\n\ntwo\n');
  await caretAfter('one');
  await press('Enter');
  await type('middle');
  await settle();
  assert.equal(await text(), 'one\n\nmiddle\n\ntwo\n');
});

await test('heading fără rând gol după el: paragraful nou nu se lipește', async () => {
  await load('# Title\ntext\n');
  await caretAfter('Title');
  await press('Enter');
  await type('fresh');
  await settle();
  assert.equal(await text(), '# Title\n\nfresh\n\ntext\n');
});

await test('blocul șters dispare fără să lipească vecinii', async () => {
  await load('one\ntail of one\n\ntwo\n\nthree\n');
  await page.evaluate(() => {
    const { editor } = window.__mdwTest;
    const node = editor.state.doc.child(1);
    const from = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(from, from + node.nodeSize));
  });
  await settle();
  assert.equal(await text(), 'one\ntail of one\n\nthree\n');
});

await test('scurtături Markdown la tastare', async () => {
  await load('');
  await page.evaluate(() => window.__mdwTest.editor.commands.focus());
  await page.waitForTimeout(40);
  await type('# Head');
  await press('Enter');
  await type('- item');
  await press('Enter');
  await press('Enter');
  await type('**bold** and `code` and ');
  await press('Meta+b');
  await type('keys');
  await press('Meta+b');
  await press('Enter');
  await type('> quote');
  await settle();
  assert.equal(await text(), '# Head\n\n- item\n\n**bold** and `code` and **keys**\n\n> quote');
});

await test('listă de task-uri: bifatul ajunge în fișier', async () => {
  await load('- [ ] todo\n- [x] done\n\nend\n');
  await page.locator('input[type=checkbox]').first().check();
  await settle();
  assert.equal(await text(), '- [x] todo\n- [x] done\n\nend\n');
});

await test('tabel: aliniamentul supraviețuiește unei editări', async () => {
  await load('| a | b |\n|:--|--:|\n| 1 | 2 |\n');
  await caretAfter('1');
  await type('0');
  await settle();
  const out = await text();
  assert.match(out, /\| 10 +\|/);
  assert.match(out.split('\n')[1], /^\| *:-+ *\| *-+: *\|$/);
});

await test('caractere care nu trebuie escapate în proză', async () => {
  await load('plain\n');
  await caretAfter('plain');
  await type(' snake_case a > b 2 * 3 [note] <3 tom&jerry');
  await settle();
  assert.equal(await text(), 'plain snake_case a > b 2 * 3 [note] <3 tom&jerry\n');
});

await test('caractere care chiar trebuie escapate', async () => {
  await load('plain\n');
  await page.evaluate(() => {
    const { editor } = window.__mdwTest;
    editor.commands.insertContentAt(1, { type: 'text', text: '*not em* _nor_ `tick` [a](b) <div> # ' });
  });
  await settle();
  const out = await text();
  const back = await page.evaluate(t => window.__mdwTest.editor.markdown.parse(t).content[0].content.map(n => n.text + (n.marks ? '!' : '')).join(''), out);
  assert.equal(back, '*not em* _nor_ `tick` [a](b) <div> # plain');
});

await test('cod în bold rămâne cod în bold', async () => {
  await load('see **`busy`** here\n\nz\n');
  await caretAfter('here');
  await type('!');
  await settle();
  assert.equal(await text(), 'see **`busy`** here!\n\nz\n');
});

await test('frontmatter: intact, editabil, deasupra corpului', async () => {
  const src = '---\nname: x\ndescription: "a: b"\n---\n\n# Body\n';
  await load(src);
  assert.equal(await text(), src);
  assert.equal(await page.locator('#mdw-frontmatter').inputValue(), '---\nname: x\ndescription: "a: b"\n---');
  await caretAfter('Body');
  await type('!');
  await settle();
  assert.equal(await text(), src.replace('Body', 'Body!'));
  await page.locator('#mdw-frontmatter').fill('---\nname: y\n---');
  await settle();
  assert.equal(await text(), '---\nname: y\n---\n\n# Body!\n');
});

await test('schimbare din afară: cursorul stă pe loc și nu e pas de undo', async () => {
  await load('alpha\n\nbeta\n\ngamma\n');
  await caretAfter('gamma', 2);
  await page.evaluate(() => window.postMessage({ type: 'external', text: 'alpha\n\nBETA changed\nby agent\n\ngamma\n' }, '*'));
  await settle();
  const r = await page.evaluate(() => {
    const { editor } = window.__mdwTest;
    const { from } = editor.state.selection;
    return { before: editor.state.doc.textBetween(from - 2, from), text: window.__mdwTest.text };
  });
  assert.equal(r.before, 'ga');
  assert.equal(r.text, 'alpha\n\nBETA changed\nby agent\n\ngamma\n');
  assert.deepEqual(await edits(), []);
  await caretAfter('gamma');
  await type('!');
  await settle();
  assert.equal(await text(), 'alpha\n\nBETA changed\nby agent\n\ngamma!\n');
});

await test('HTML și definițiile de link supraviețuiesc editării vecinilor', async () => {
  const src = '<!-- note -->\n\n<details>\n<summary>x</summary>\nbody\n</details>\n\nsee [ref][1]\n\n[1]: https://a.b\n\nend\n';
  await load(src);
  await caretAfter('end');
  await type('!');
  await settle();
  assert.equal(await text(), src.replace('end', 'end!'));
});

await test('Mermaid: se randează, iar cursorul în bloc arată sursa', async () => {
  await load('```mermaid\ngraph TD\n  A-->B\n```\n\nend\n');
  await page.waitForSelector('.mdw-source__render svg', { timeout: 15000 });
  assert.equal(await page.locator('.mdw-source pre').isVisible(), false);
  await page.locator('.mdw-source__render').click();
  await settle();
  assert.equal(await page.locator('.mdw-source pre').isVisible(), true);
});

await test('formule: bloc și în text, sursa rămâne', async () => {
  const src = 'Euler $e^{i\\pi}+1=0$ and $5 or $10.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nend\n';
  await load(src);
  await page.waitForSelector('.katex', { timeout: 15000 });
  assert.equal(await page.locator('.math-inline .katex').count(), 1);
  await caretAfter('end');
  await type('!');
  await settle();
  assert.equal(await text(), src.replace('end\n', 'end!\n'));
});

await test('imagine relativă: DOM-ul încarcă URL-ul webview, fișierul păstrează calea', async () => {
  await load('![pic](./img/a.png)\n\nend\n');
  assert.equal(await page.getByRole('img', { name: 'pic' }).getAttribute('src'), 'https://base.test/docs/img/a.png');
  await caretAfter('end');
  await type('!');
  await settle();
  assert.equal(await text(), '![pic](./img/a.png)\n\nend!\n');
});

await test('numerele de linie: imediat la deschidere și corecte după editare', async () => {
  const lines = () => page.locator('.mdw-content [data-line]').evaluateAll(all => all.map(e => e.getAttribute('data-line')));
  await load('---\na: 1\n---\n\n# T\n\none\n\n* a\n* b\n\nend\n');
  assert.deepEqual(await lines(), ['5', '7', '9', '9', '10', '12']);
  await caretAfter('one');
  await press('Enter');
  await type('two');
  await settle();
  assert.deepEqual(await lines(), ['5', '7', '9', '11', '11', '12', '14']);
});

await test('fără blocaje pe un fișier mare (~200 KB) și fără tastare care îngheață', async () => {
  const big = Array.from({ length: 2400 }, (_, i) => `## Heading ${i}\n\nSome **bold** text with \`code\` and [a link](x.md) number ${i}.\n\n- one\n- two\n`).join('\n');
  const t0 = Date.now();
  await load(big);
  const loadMs = Date.now() - t0;
  await caretAfter('number 1200');
  const t1 = Date.now();
  await type('!');
  await settle();
  const typeMs = Date.now() - t1 - 150;
  assert.equal(await text(), big.replace('number 1200.', 'number 1200!.'));
  console.log(`  big file: ${big.length} bytes, load ${loadMs} ms, keystroke+flush ${typeMs} ms`);
  assert.ok(loadMs < 4000 && typeMs < 500, `load ${loadMs}, type ${typeMs}`);
});

for (const [state, name, why] of results) console.log(state === 'ok' ? '  ✓' : '  ✗', name, why ? `\n      ${why}` : '');
const failed = results.filter(r => r[0] !== 'ok').length;
const relevant = errors.filter(e => !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e));
console.log(`${results.length - failed}/${results.length} ok; erori în pagină: ${relevant.length}`);
if (relevant.length) console.log(relevant.slice(0, 5));
await browser.close();
process.exit(failed || relevant.length ? 1 : 0);
