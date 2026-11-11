export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Range = { start: number; end: number };
export type Document = { lines: string[]; ranges: Map<string, Range> };
export type Difference = { path: string; kind: 'added' | 'removed' | 'changed' | 'key order'; left?: Range; right?: Range };
export const MAX_INPUT = 1_000_000;
const MAX_DEPTH = 150;
const MAX_LINES = 30_000;

export function parseJson(text: string): Json {
  if (!text.trim()) throw new Error('Enter or upload valid JSON. This input is empty.');
  if (text.length > MAX_INPUT) throw new Error('This input exceeds the 1 MB text limit. Use a smaller document.');
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON syntax.';
    const position = /position (\d+)/i.exec(message);
    if (position && !/line \d+ column/i.test(message)) {
      const before = text.slice(0, Number(position[1])).split('\n');
      throw new Error(`${message} (line ${before.length}, column ${before.at(-1)!.length + 1})`);
    }
    throw new Error(message);
  }
}

const object = (value: Json): value is { [key: string]: Json } => value !== null && typeof value === 'object' && !Array.isArray(value);
const child = (path: string, key: string) => `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;

export function formatDocument(value: Json, keyOrder = false): Document {
  const lines: string[] = [];
  const ranges = new Map<string, Range>();
  function visit(item: Json, path: string, depth: number, prefix = '', comma = '') {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('A number exceeds the supported finite JavaScript number range.');
    if (depth > MAX_DEPTH) throw new Error('JSON nesting exceeds 150 levels. Use a shallower document.');
    if (lines.length > MAX_LINES) throw new Error('Formatted JSON exceeds 30,000 lines. Use a smaller document.');
    const start = lines.length + 1;
    const indent = '  '.repeat(depth);
    if (item !== null && typeof item === 'object') {
      const array = Array.isArray(item);
      const keys = Object.keys(item);
      if (!array && !keyOrder) keys.sort();
      const opening = array ? '[' : '{';
      const closing = array ? ']' : '}';
      if (!keys.length) lines.push(`${indent}${prefix}${opening}${closing}${comma}`);
      else {
        lines.push(`${indent}${prefix}${opening}`);
        keys.forEach((key, index) => visit((item as { [key: string]: Json })[key], child(path, key), depth + 1, array ? '' : `${JSON.stringify(key)}: `, index < keys.length - 1 ? ',' : ''));
        lines.push(`${indent}${closing}${comma}`);
      }
    } else lines.push(`${indent}${prefix}${JSON.stringify(item)}${comma}`);
    ranges.set(path, { start, end: lines.length });
  }
  visit(value, '', 0);
  if (lines.length > MAX_LINES) throw new Error('Formatted JSON exceeds 30,000 lines. Use a smaller document.');
  return { lines, ranges };
}

export function compareJson(left: Json, right: Json, keyOrder = false) {
  const leftDoc = formatDocument(left, keyOrder);
  const rightDoc = formatDocument(right, keyOrder);
  const differences: Difference[] = [];
  function add(path: string, kind: Difference['kind']) {
    differences.push({ path, kind, left: leftDoc.ranges.get(path), right: rightDoc.ranges.get(path) });
  }
  function visit(a: Json, b: Json, path: string) {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const next = child(path, String(index));
        if (index >= a.length) add(next, 'added');
        else if (index >= b.length) add(next, 'removed');
        else visit(a[index], b[index], next);
      }
    } else if (object(a) && object(b)) {
      const aKeys = Object.keys(a), bKeys = Object.keys(b);
      // Only report ordering when shared keys change relative order. Added keys have their own differences.
      if (keyOrder && JSON.stringify(aKeys.filter(key => Object.hasOwn(b, key))) !== JSON.stringify(bKeys.filter(key => Object.hasOwn(a, key)))) add(path, 'key order');
      for (const key of new Set([...aKeys, ...bKeys])) {
        const next = child(path, key);
        if (!Object.hasOwn(a, key)) add(next, 'added');
        else if (!Object.hasOwn(b, key)) add(next, 'removed');
        else visit(a[key], b[key], next);
      }
    } else add(path, 'changed');
  }
  visit(left, right, '');
  return { leftDoc, rightDoc, differences };
}
