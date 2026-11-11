import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareJson, parseJson, formatDocument, MAX_INPUT } from '../src/compare.ts';

test('whitespace and object key order do not affect default comparison', () => {
  assert.equal(compareJson(parseJson('{"a":1,"b":{"x":true,"y":null}}'), parseJson(' { "b": {"y":null,"x":true}, "a":1 } ')).differences.length, 0);
});
test('nested values, arrays, missing keys and types produce individual differences', () => {
  const { differences } = compareJson({ n: 100, nested: { a: true }, items: [1, 2], removed: null }, { n: 101, nested: { a: 'true' }, items: [1, 3, 4], added: false });
  assert.deepEqual(differences.map(d => [d.path, d.kind]), [['/n', 'changed'], ['/nested/a', 'changed'], ['/items/1', 'changed'], ['/items/2', 'added'], ['/removed', 'removed'], ['/added', 'added']]);
  assert.equal(differences[3].left, undefined);
  assert.equal(differences[4].right, undefined);
});
test('one replacement or added subtree counts once', () => {
  assert.equal(compareJson({ a: [1, 2] }, { a: true }).differences.length, 1);
  assert.equal(compareJson({}, { nested: { x: 1, y: 2 } }).differences.length, 1);
});
test('array order is significant', () => {
  assert.equal(compareJson([1, 2], [2, 1]).differences.length, 2);
});
test('optional key-order comparison reports relative order changes', () => {
  assert.equal(compareJson({ a: 1, b: 2 }, { b: 2, a: 1 }, true).differences[0].kind, 'key order');
  assert.deepEqual(compareJson({ a: 1 }, { z: 2, a: 1 }, true).differences.map(d => d.kind), ['added']);
});
test('formatted line ranges identify exact paths and subtree boundaries', () => {
  const { leftDoc, differences } = compareJson({ a: 1, b: { c: 2 } }, { a: 5, b: false });
  assert.deepEqual(leftDoc.lines, ['{', '  "a": 1,', '  "b": {', '    "c": 2', '  }', '}']);
  assert.deepEqual(differences[0].left, { start: 2, end: 2 });
  assert.deepEqual(differences[1].left, { start: 3, end: 5 });
  assert.deepEqual(differences[1].right, { start: 3, end: 3 });
});
test('JSON pointer paths safely distinguish slashes, tildes and special keys', () => {
  const a = parseJson('{"a/b":{"~":1},"__proto__":1}');
  const b = parseJson('{"a/b":{"~":2},"__proto__":2}');
  assert.deepEqual(compareJson(a, b).differences.map(d => d.path), ['/a~1b/~0', '/__proto__']);
});
test('root primitives and empty containers are supported', () => {
  for (const value of [null, true, 12, 'hello', [], {}]) assert.equal(compareJson(value, value).differences.length, 0);
  assert.deepEqual(compareJson(null, false).differences[0].left, { start: 1, end: 1 });
  assert.equal(compareJson([], {}).differences.length, 1);
});
test('invalid JSON is rejected with useful messages while valid primitives pass', () => {
  assert.throws(() => parseJson(''), /empty/);
  for (const text of ['{a:1}', '{"a":1,}', '{"a":', '[1,]', 'undefined']) assert.throws(() => parseJson(text));
  const malformed = '{\n "a" 1\n}';
  let parserMessage = '';
  try { JSON.parse(malformed); } catch (error) { parserMessage = (error as Error).message; }
  assert.throws(() => parseJson(malformed), /./);
  if (/position \d+|line 2/i.test(parserMessage)) assert.throws(() => parseJson(malformed), /line 2/);
  assert.equal(parseJson('false'), false);
  assert.equal(parseJson('null'), null);
});
test('resource limits produce errors instead of unbounded rendering', () => {
  assert.throws(() => parseJson(' '.repeat(MAX_INPUT) + '1'), /limit/);
  assert.throws(() => formatDocument(parseJson('['.repeat(152) + '0' + ']'.repeat(152))), /nesting/);
  assert.throws(() => formatDocument(Array(30_001).fill(1)), /30,000/);
  assert.throws(() => formatDocument(parseJson('1e400')), /finite/);
});
test('formatting preserves valid JSON and does not modify source objects', () => {
  const value = { z: '<script>alert(1)</script>', a: [false, { n: -1.25e-7 }] };
  const before = JSON.stringify(value);
  assert.deepEqual(JSON.parse(formatDocument(value).lines.join('\n')), value);
  assert.equal(JSON.stringify(value), before);
});
