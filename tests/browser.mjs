// Dependency-free Chromium smoke test against the production build.
// Usage: node tests/browser.mjs [absolute-path-to-Chrome-or-Chromium]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { once } from 'node:events';

const executable = process.argv[2] || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'json-compare-test-'));
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/host.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Embed test</title><iframe title="JSON comparison tool" width="375" height="950" src="/json-compare/?embed=1"></iframe>');
      return;
    }
    const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/json-compare/, '');
    const file = resolve('dist', `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(resolve('dist') + sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
let sequence = 0;
const pending = new Map();
const errors = [];
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome did not start within 20 seconds')), 20_000);
    let stderr = '';
    chrome.on('error', error => { clearTimeout(timeout); reject(error); });
    chrome.stderr.on('data', data => {
      stderr += data;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  ws = new WebSocket(endpoint);
  await once(ws, 'open');
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  async function evaluate(fn) {
    const response = await command('Runtime.evaluate', { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  async function navigate(path) {
    await command('Page.navigate', { url: origin + path });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(() => document.readyState === 'complete' && Boolean(document.querySelector('#compare') || document.querySelector('iframe')?.contentDocument?.querySelector('#compare')))) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Page readiness timed out');
  }
  await navigate('/json-compare/');
  console.log(await evaluate(async () => {
    const $ = id => document.getElementById(id);
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const input = (side, text) => { $(`${side}-input`).value = text; $(`${side}-input`).dispatchEvent(new Event('input', { bubbles: true })); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    $('compare').click();
    assert(!$('left-error').hidden && !$('right-error').hidden, 'Both empty-input errors must be visible');
    assert($('results').hidden, 'Invalid input must not render results');
    $('sample').click(); $('compare').click();
    assert($('difference-count').textContent === '4 differences found', 'Sample difference count');
    assert(document.querySelectorAll('.different').length > 0, 'Red line highlights');
    assert([...document.querySelectorAll('mark')].some(el => el.textContent === '5'), 'Numeric value highlights');
    $('next').click();
    assert($('selection-status').textContent === '2 of 4', 'Next difference');
    $('previous').click();
    assert($('selection-status').textContent === '1 of 4', 'Previous difference');
    document.querySelectorAll('#difference-list button')[3].click();
    assert($('selection-status').textContent === '4 of 4', 'Clickable difference navigation');
    input('right', '{"a":1,}'); $('compare').click();
    assert(!$('right-error').hidden, 'Invalid syntax shows an error');
    assert($('result-status').textContent.includes('Outdated'), 'Previous results marked outdated');
    input('right', '{"a":1}');
    assert($('right-error').hidden, 'Correction clears validation error');
    const file = new DataTransfer();
    file.items.add(new File(['{"a":2}'], 'example.json', { type: 'application/json' }));
    $('left-file').files = file.files; $('left-file').dispatchEvent(new Event('change'));
    await wait(50);
    assert($('left-input').value === '{"a":2}' && $('left-filename').textContent === 'example.json', 'File upload');
    const invalid = new DataTransfer(); invalid.items.add(new File(['{bad}'], 'invalid.json'));
    document.querySelector('[data-side="right"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: invalid }));
    await wait(50);
    assert(!$('right-error').hidden, 'Invalid dropped JSON shows error immediately');
    const validDrop = new DataTransfer(); validDrop.items.add(new File(['{"a":2}'], 'dropped.json'));
    document.querySelector('[data-side="right"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: validDrop }));
    await wait(50);
    assert($('right-input').value === '{"a":2}', 'Valid dropped JSON loads');
    document.querySelector('[data-format="right"]').click();
    assert($('right-input').value.includes('\n'), 'Format action');
    $('compare').click();
    assert($('difference-count').textContent.includes('Identical'), 'Identical documents');
    input('left', '{"html":"<img src=x onerror=window.pwned=1>"}');
    input('right', '{"html":"<script>window.pwned=1</script>"}');
    $('compare').click();
    assert(!window.pwned && !$('left-result').querySelector('img') && !$('right-result').querySelector('script'), 'JSON renders as safe text');
    input('left', JSON.stringify(Array.from({ length: 100 }, (_, i) => i)));
    input('right', JSON.stringify(Array.from({ length: 110 }, (_, i) => i + 1)));
    $('compare').click(); await wait(70);
    $('left-result').scrollTop = 500; await wait(100);
    assert($('right-result').scrollTop > 0, 'Synchronized scrolling');
    document.querySelectorAll('#difference-list button')[90].click(); await wait(70);
    const selected = document.querySelector('#left-result .selected-line').getBoundingClientRect();
    const viewport = $('left-result').getBoundingClientRect();
    assert(selected.top >= viewport.top && selected.bottom <= viewport.bottom, 'Navigation brings selected line into view');
    await wait(400);
    assert(JSON.parse(localStorage.getItem('json-compare:v1')).left === $('left-input').value, 'Debounced local storage');
    assert($('storage-status').textContent.includes('Saved'), 'Saved status');
    return 'PASS: inputs, validation, comparison, counts, numeric highlights, navigation, upload, drop, format, stale results, safe rendering, scroll sync, autosave';
  }));
  await command('Page.reload');
  await new Promise(resolve => setTimeout(resolve, 400));
  console.log(await evaluate(() => {
    if (!document.getElementById('left-input').value.includes('99')) throw new Error('Reload did not restore saved input');
    document.getElementById('clear-saved').click();
    if (localStorage.getItem('json-compare:v1') !== null) throw new Error('Clear saved data failed');
    return 'PASS: restore and clear saved data';
  }));
  await navigate('/host.html');
  console.log(await evaluate(() => {
    const frame = document.querySelector('iframe');
    const doc = frame.contentDocument;
    if (!doc.body.classList.contains('embedded')) throw new Error('Embed mode missing');
    if (doc.querySelector('header, footer')) throw new Error('Header or footer should be removed');
    if (frame.contentWindow.getComputedStyle(doc.querySelector('.intro')).display !== 'none') throw new Error('Embed title visible');
    if (doc.documentElement.scrollWidth > frame.clientWidth) throw new Error('Narrow viewport has horizontal page overflow');
    doc.getElementById('sample').click(); doc.getElementById('compare').click();
    if (doc.getElementById('results').hidden) throw new Error('Embedded comparison failed');
    return 'PASS: iframe embed, narrow layout, embedded comparison';
  }));
  const { identifier } = await command('Page.addScriptToEvaluateOnNewDocument', { source: 'Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = function() { throw new DOMException("Blocked", "SecurityError"); };' });
  await navigate('/json-compare/');
  console.log(await evaluate(async () => {
    const $ = id => document.getElementById(id);
    if (!$('storage-status').textContent.includes('unavailable')) throw new Error('Blocked storage status missing');
    $('sample').click(); $('compare').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    if ($('results').hidden || !$('storage-status').textContent.includes('not saved')) throw new Error('Blocked storage prevents comparison');
    return 'PASS: blocked storage degrades gracefully';
  }));
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await navigate('/json-compare/');
  await evaluate(() => { document.getElementById('sample').click(); document.getElementById('compare').click(); });
  await evaluate(() => document.getElementById('left-input').focus());
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await evaluate(() => {
    if (document.activeElement.id !== 'left-file') throw new Error('Keyboard Tab did not reach file input');
    document.activeElement.blur();
  });
  await mkdir('.verification', { recursive: true });
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('.verification/desktop.png', Buffer.from(screenshot.data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => {
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Mobile viewport has horizontal overflow');
  });
  const mobile = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('.verification/mobile.png', Buffer.from(mobile.data, 'base64'));
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join(', ')}`);
  console.log('PASS: keyboard navigation; no browser exceptions; desktop and mobile screenshots saved in .verification/');
} finally {
  ws?.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  chrome.kill();
  server.close();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (resolve(profile).startsWith(resolve(tmpdir()) + sep) && profile.includes('json-compare-test-')) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}
