// Plain node, no VS Code host: `node --test test/presentation.test.js`. Covers the pure half
// of Vic Presentation: which lines make up the cursor's section (the rest gets faded) and
// which lines are its parents (painted white with it).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// presentation.js requires 'vscode' at the top; the pure helpers don't touch it.
const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { sectionAround, lineWithParents, indentOf } = require('../presentation');
Module._load = load;

const doc = [
  'title',                 // 0
  '',                      // 1
  '- Clumsy Harness',      // 2
  '  - Copilot: Chat',     // 3
  '    => use Copilot CLI', // 4
  '  + Use the LLM',       // 5
  '',                      // 6
  '* Dumb zone',           // 7
  '\t- Context window',    // 8
];
const textAt = (i) => doc[i];

test('the section is the run of non-blank lines around the cursor', () => {
  assert.deepStrictEqual(sectionAround(4, doc.length, textAt), [2, 5]);
  assert.deepStrictEqual(sectionAround(0, doc.length, textAt), [0, 0]);
  assert.deepStrictEqual(sectionAround(8, doc.length, textAt), [7, 8]);
});

test('a blank line has no section, so the whole file gets faded', () => {
  assert.strictEqual(sectionAround(1, doc.length, textAt), null);
});

test('an indented line brings every less-indented parent above it', () => {
  assert.deepStrictEqual(lineWithParents(4, 2, textAt), [2, 3, 4]);
});

test('a sibling is not a parent: only lines with a smaller indent count', () => {
  assert.deepStrictEqual(lineWithParents(5, 2, textAt), [2, 5]);
});

test('a top-level line has no parents', () => {
  assert.deepStrictEqual(lineWithParents(2, 2, textAt), [2]);
});

test('tabs count up to the next tab stop', () => {
  assert.strictEqual(indentOf('\t- x', 4), 4);
  assert.strictEqual(indentOf('  \tx', 4), 4);
  assert.deepStrictEqual(lineWithParents(8, 7, textAt), [7, 8]);
});
