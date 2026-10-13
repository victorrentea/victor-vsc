// Plain node, no VS Code host: `node --test test/bullets.test.js`. Which leading mark a
// line of course notes carries, and at which column it gets painted.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { markerOf } = require('../bullets');
Module._load = load;

test('the first mark on the line, followed by a space', () => {
  assert.deepStrictEqual(markerOf('+ Tooling'), ['plus', 0, 1]);
  assert.deepStrictEqual(markerOf('  - MCP blocked'), ['minus', 2, 1]);
  assert.deepStrictEqual(markerOf('    i cheaper'), ['info', 4, 1]);
});

test('any other single character before a space is blue, like i', () => {
  assert.deepStrictEqual(markerOf('  = burning tokens'), ['info', 2, 1]);
  assert.deepStrictEqual(markerOf('\t* Token-Maxing'), ['info', 1, 1]);
  assert.deepStrictEqual(markerOf('? open question'), ['info', 0, 1]);
  assert.deepStrictEqual(markerOf('𝔼 wide'), ['info', 0, 2]);
});

test('not a mark: glued to a word, or not the first thing on the line', () => {
  assert.strictEqual(markerOf('in progress'), null);
  assert.strictEqual(markerOf('-1 point'), null);
  assert.strictEqual(markerOf('ab + c'), null);
  assert.strictEqual(markerOf(''), null);
});

test('not a mark: alone on the line, nothing after it yet', () => {
  assert.strictEqual(markerOf('a'), null);
  assert.strictEqual(markerOf('  +'), null);
  assert.strictEqual(markerOf('- '), null);
});
