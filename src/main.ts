import './style.css';
import { compareJson, parseJson, formatDocument, MAX_INPUT } from './compare.ts';
import type { Difference, Document, Json, Range } from './compare.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sides = ['left', 'right'] as const;
type Side = typeof sides[number];
const inputs = { left: $<HTMLTextAreaElement>('left-input'), right: $<HTMLTextAreaElement>('right-input') };
const order = $<HTMLInputElement>('key-order');
const storageKey = 'json-compare:v1';
let differences: Difference[] = [];
let current = -1;
let saveTimer: ReturnType<typeof setTimeout>;
let hasResults = false;
let storagePaused = false;
const fileVersions = { left: 0, right: 0 };

if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embedded');

function setError(side: Side, message = '') {
  const el = $(`${side}-error`);
  el.textContent = message ? `${side === 'left' ? 'Original' : 'Modified'} JSON: ${message}` : '';
  el.hidden = !message;
  inputs[side].setAttribute('aria-invalid', String(Boolean(message)));
}

function validate(side: Side): { value: Json } | undefined {
  try {
    const value = parseJson(inputs[side].value);
    setError(side);
    return { value };
  } catch (error) {
    setError(side, error instanceof Error ? error.message : String(error));
  }
}

function save() {
  if (storagePaused) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ left: inputs.left.value, right: inputs.right.value, keyOrder: order.checked }));
    $('storage-status').textContent = 'Saved in this browser';
  } catch {
    $('storage-status').textContent = 'Storage unavailable or full — work is not saved';
  }
}

function changed(side?: Side) {
  if (side) {
    fileVersions[side]++;
    $(`${side}-filename`).textContent = 'Or drop a JSON file here';
    if (inputs[side].getAttribute('aria-invalid') === 'true') validate(side);
  }
  if (hasResults) {
    $('result-status').textContent = 'Outdated — compare again to update';
    $('results').classList.add('outdated');
  }
  storagePaused = false;
  $('storage-status').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}

try {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    const stored = JSON.parse(raw);
    if (stored && typeof stored.left === 'string' && typeof stored.right === 'string' && stored.left.length <= MAX_INPUT && stored.right.length <= MAX_INPUT) {
      inputs.left.value = stored.left;
      inputs.right.value = stored.right;
      order.checked = stored.keyOrder === true;
      $('storage-status').textContent = 'Previous work restored';
    } else $('storage-status').textContent = 'Saved data could not be restored';
  }
} catch { $('storage-status').textContent = 'Storage unavailable — work stays in this session'; }

for (const side of sides) {
  inputs[side].addEventListener('input', () => changed(side));
  const fileInput = $<HTMLInputElement>(`${side}-file`);
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) void loadFile(side, fileInput.files[0]);
    fileInput.value = '';
  });
  const card = document.querySelector<HTMLElement>(`[data-side="${side}"]`)!;
  card.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    card.classList.add('dragging');
  });
  card.addEventListener('dragleave', event => {
    if (!card.contains(event.relatedTarget as Node | null)) card.classList.remove('dragging');
  });
  card.addEventListener('drop', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    card.classList.remove('dragging');
    if (event.dataTransfer.files.length !== 1) setError(side, 'Drop one JSON file at a time.');
    else void loadFile(side, event.dataTransfer.files[0]);
  });
}

async function loadFile(side: Side, file: File) {
  const version = ++fileVersions[side];
  if (file.size > MAX_INPUT) { setError(side, 'File exceeds the 1 MB limit. Use a smaller file.'); return; }
  try {
    const text = await file.text();
    if (version !== fileVersions[side]) return;
    inputs[side].value = text;
    changed(side);
    $(`${side}-filename`).textContent = file.name;
    validate(side);
  } catch { if (version === fileVersions[side]) setError(side, 'This file could not be read. Please select it again.'); }
}

document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button => {
  button.addEventListener('click', () => {
    const side = button.dataset.format as Side;
    const result = validate(side);
    if (!result) return;
    try {
      inputs[side].value = formatDocument(result.value, true).lines.join('\n');
      changed(side);
    } catch (error) { setError(side, (error as Error).message); }
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach(button => {
  button.addEventListener('click', () => {
    const side = button.dataset.clear as Side;
    inputs[side].value = '';
    changed(side);
    setError(side);
    inputs[side].focus();
  });
});
order.addEventListener('change', () => changed());
$('sample').addEventListener('click', () => {
  inputs.left.value = JSON.stringify({ project: 'Orbital', version: 1, active: true, settings: { region: 'eu-west', retries: 3 }, tags: ['api', 'stable'] }, null, 2);
  inputs.right.value = JSON.stringify({ project: 'Orbital', version: 2, active: true, settings: { region: 'eu-west', retries: 5 }, tags: ['api', 'beta'], owner: 'Engineering' }, null, 2);
  for (const side of sides) { changed(side); setError(side); }
});
$('clear-saved').addEventListener('click', () => {
  clearTimeout(saveTimer);
  storagePaused = true;
  try {
    localStorage.removeItem(storageKey);
    $('storage-status').textContent = 'Saved data cleared — editing resumes autosave';
  } catch { $('storage-status').textContent = 'Storage unavailable — saved data could not be cleared'; }
});
window.addEventListener('pagehide', () => { clearTimeout(saveTimer); save(); });

function renderDocument(doc: Document, side: Side) {
  const affected = new Set<number>();
  for (const diff of differences) {
    const range = diff[side];
    if (range) for (let line = range.start; line <= range.end; line++) affected.add(line);
  }
  const fragment = document.createDocumentFragment();
  doc.lines.forEach((line, index) => {
    const row = document.createElement('div');
    row.className = `code-line${affected.has(index + 1) ? ' different' : ''}`;
    row.id = `${side}-line-${index + 1}`;
    const gutter = document.createElement('span');
    gutter.className = 'line-number';
    gutter.textContent = `${affected.has(index + 1) ? '• ' : ''}${index + 1}`;
    const code = document.createElement('code');
    // Match a numeric value at the end of a formatted JSON line, never a number inside a string or key.
    const numeric = affected.has(index + 1) && /(?:^\s*|:\s*)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(,?)$/i.exec(line);
    if (numeric) {
      const offset = line.length - numeric[1].length - numeric[2].length;
      code.append(document.createTextNode(line.slice(0, offset)));
      const mark = document.createElement('mark');
      mark.textContent = numeric[1];
      code.append(mark, document.createTextNode(numeric[2]));
    } else code.textContent = line;
    row.append(gutter, code);
    fragment.append(row);
  });
  $(`${side}-result`).replaceChildren(fragment);
}

function lineLabel(range?: Range) {
  return range ? (range.start === range.end ? `L${range.start}` : `L${range.start}–${range.end}`) : '— missing';
}

function selectDifference(index: number) {
  if (!differences.length) return;
  navigating = true;
  cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  current = (index + differences.length) % differences.length;
  document.querySelectorAll('.selected-line').forEach(el => el.classList.remove('selected-line'));
  const diff = differences[current];
  for (const side of sides) {
    const range = diff[side];
    if (!range) continue;
    for (let line = range.start; line <= range.end; line++) $(`${side}-line-${line}`).classList.add('selected-line');
    const view = $(`${side}-result`);
    view.scrollTop = $(`${side}-line-${range.start}`).offsetTop - 48;
  }
  document.querySelectorAll<HTMLButtonElement>('#difference-list button').forEach((button, index) => button.setAttribute('aria-current', String(index === current)));
  $('selection-status').textContent = `${current + 1} of ${differences.length}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { navigating = false; }));
}

$('compare').addEventListener('click', () => {
  const left = validate('left'), right = validate('right');
  if (!left || !right) { inputs[left ? 'right' : 'left'].focus(); return; }
  try {
    const result = compareJson(left.value, right.value, order.checked);
    differences = result.differences;
    current = -1;
    renderDocument(result.leftDoc, 'left');
    renderDocument(result.rightDoc, 'right');
    $('difference-list').replaceChildren();
    const fragment = document.createDocumentFragment();
    differences.forEach((diff, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const kind = document.createElement('span');
      kind.className = 'diff-kind';
      kind.textContent = diff.kind;
      const path = document.createElement('code');
      path.textContent = diff.path || '(root)';
      const lines = document.createElement('span');
      lines.className = 'diff-lines';
      lines.textContent = `A ${lineLabel(diff.left)}  →  B ${lineLabel(diff.right)}`;
      button.append(kind, path, lines);
      button.addEventListener('click', () => selectDifference(index));
      item.append(button);
      fragment.append(item);
    });
    $('difference-list').append(fragment);
    hasResults = true;
    $('empty-state').hidden = true;
    $('results').hidden = false;
    $('results').classList.remove('outdated');
    $('difference-count').textContent = differences.length ? `${differences.length} difference${differences.length === 1 ? '' : 's'} found` : '✓ Identical JSON';
    $('result-status').textContent = differences.length ? 'Changes highlighted in red' : 'No differences found';
    $('difference-details').hidden = differences.length === 0;
    for (const id of ['previous', 'next']) $<HTMLButtonElement>(id).disabled = !differences.length;
    $('selection-status').textContent = '';
    if (differences.length) selectDifference(0);
    $('results-section').scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  } catch (error) {
    $('result-status').textContent = (error as Error).message;
  }
});
$('previous').addEventListener('click', () => selectDifference(current - 1));
$('next').addEventListener('click', () => selectDifference(current + 1));

// Synchronize scroll positions by proportion, including documents of different lengths.
let scrollFrame = 0;
let navigating = false;
for (const side of sides) {
  const view = $(`${side}-result`);
  view.addEventListener('scroll', () => {
    if (scrollFrame || navigating) return;
    const other = $(`${side === 'left' ? 'right' : 'left'}-result`);
    scrollFrame = requestAnimationFrame(() => {
      navigating = true;
      const available = view.scrollHeight - view.clientHeight;
      other.scrollTop = available > 0 ? view.scrollTop / available * (other.scrollHeight - other.clientHeight) : 0;
      other.scrollLeft = view.scrollLeft;
      requestAnimationFrame(() => { navigating = false; scrollFrame = 0; });
    });
  });
}
