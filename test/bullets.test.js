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
  assert.deepStrictEqual(markerOf('+ Tooling'), ['plus', 0]);
  assert.deepStrictEqual(markerOf('  - MCP blocked'), ['minus', 2]);
  assert.deepStrictEqual(markerOf('\t* neutral'), ['star', 1]);
  assert.deepStrictEqual(markerOf('    i cheaper'), ['info', 4]);
  assert.deepStrictEqual(markerOf('i'), ['info', 0]);
});

test('not a mark: glued to a word, or not the first thing on the line', () => {
  assert.strictEqual(markerOf('in progress'), null);
  assert.strictEqual(markerOf('-1 point'), null);
  assert.strictEqual(markerOf('a + b'), null);
  assert.strictEqual(markerOf(''), null);
});
