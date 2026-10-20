// Plain node, no VS Code host: `node --test test/fold-wave.test.js`. When the cursor's
// line counts as a folded header, and which characters the yellow wave paints.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { isFoldedAt, charsOf } = require('../fold-wave');
Module._load = load;

test('a line that ends a visible range followed by a gap is folded', () => {
  assert.strictEqual(isFoldedAt([[0, 28], [32, 60]], 28), true);
});

test('a line in the middle of a visible range is not folded', () => {
  assert.strictEqual(isFoldedAt([[0, 28], [32, 60]], 10), false);
});

test('the last line of the viewport is not known to be folded', () => {
  assert.strictEqual(isFoldedAt([[0, 28], [32, 60]], 60), false);
});

test('ranges touching without a gap mean nothing is folded there', () => {
  assert.strictEqual(isFoldedAt([[0, 28], [29, 60]], 28), false);
});

test('charsOf skips whitespace and keeps the visual column', () => {
  assert.deepStrictEqual(charsOf('  - a'), [[2, 2, 1], [4, 4, 1]]);
});

test('an emoji is one column but two UTF-16 units, so it is never split', () => {
  assert.deepStrictEqual(charsOf('🤖x'), [[0, 0, 2], [1, 2, 1]]);
});
