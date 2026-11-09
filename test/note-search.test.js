const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// note-search.js cere `vscode` doar pentru partea cu UI; partea pură nu-l atinge.
const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { search } = require('../note-search');
Module._load = load;

const docs = [
  { key: 'a', label: 'Untitled-130', text: '=== AI ROI ?\nhttps://dora.dev/guides/dora-metrics/\n- Adoption % de bug report\n- ROI: bug rate' },
  { key: 'b', label: 'Untitled-102', text: '=== Cum definim rezultatele vizibile dupa adopția AI?\n  ✅ DORA' },
  { key: 'c', label: 'notes.txt', text: 'Kent Beck\n90% din skilluri' },
];

test('toate cuvintele trebuie să fie în notiță, fără diacritice și majuscule', () => {
  const r = search(docs, 'dora ADOPTIA');
  assert.deepStrictEqual(r.map((d) => d.label), ['Untitled-102']);
});

test('liniile cu mai multe cuvinte urcă', () => {
  const [a] = search(docs, 'roi bug');
  assert.strictEqual(a.label, 'Untitled-130');
  assert.strictEqual(a.hits[0].text, '- ROI: bug rate');
});

test('interogare goală = nimic', () => {
  assert.deepStrictEqual(search(docs, '   '), []);
});

test('linkurile ies o dată fiecare, fără punctuația de după', () => {
  const { urls } = require('../note-search');
  assert.deepStrictEqual(
    urls('vezi https://dora.dev/guides/dora-metrics/, apoi\nhttps://claude.ai/artifact/Kx si https://dora.dev/guides/dora-metrics/'),
    ['https://dora.dev/guides/dora-metrics/', 'https://claude.ai/artifact/Kx']);
});
