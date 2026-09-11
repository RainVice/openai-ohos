import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createWebPlatform } from '../src/main/js/WebPlatform.js';
import { createFetchAdapter } from '../src/main/js/FetchAdapter.js';
import { ReadableStream, AbortController, AbortSignal } from '../src/main/js/vendor/WebPrimitives.js';
import OpenAI from '../generated/node_modules/openai/index.mjs';
import { createURLBindings } from '../src/main/js/URLBindings.js';

test('URL bindings expose standard iteration and live query updates', () => {
  const bindings = createURLBindings({ URL, URLParams: URLSearchParams });
  const url = new bindings.URL('/path?a=1&a=2&name=%E4%BD%A0', 'https://example.invalid');
  assert.deepEqual(Object.fromEntries(url.searchParams), { a: '2', name: '你' });
  assert.deepEqual(url.searchParams.getAll('a'), ['1', '2']);
  const params = url.searchParams;
  params.set('a', '3'); assert.match(url.href, /a=3/);
  url.search = '?x=4'; assert.equal(params.get('x'), '4');
  assert.equal(new bindings.URL('../next', url).pathname, '/next');
});

const platform = createWebPlatform({ ReadableStream, AbortController, AbortSignal, TextEncoder, TextDecoder, Blob, URL, URLSearchParams });
const encode = value => new TextEncoder().encode(value).buffer;
const fixture = (callback) => createFetchAdapter(platform, (request, sink) => {
  queueMicrotask(() => callback(request, sink));
  return { cancel() {} };
});

test('vendor primitives initialize without browser or native Web APIs', () => {
  const url = new URL('../src/main/js/vendor/WebPrimitives.js', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    delete globalThis.AbortController; delete globalThis.AbortSignal; delete globalThis.ReadableStream;
    const {AbortController, ReadableStream} = await import(${JSON.stringify(url)});
    const controller = new AbortController(); controller.abort();
    if (!controller.signal.aborted || typeof ReadableStream !== 'function') throw new Error('Missing primitives');
  `]);
});

test('headers normalize and preserve repeated set-cookie', () => {
  const h = new platform.Headers([['X-Test', ' first '], ['x-test', 'second'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']]);
  assert.equal(h.get('X-TEST'), 'first, second');
  assert.deepEqual(h.getSetCookie(), ['a=1', 'b=2']);
  assert.throws(() => h.append('invalid name', 'value'), TypeError);
  assert.throws(() => h.set('ok', 'a\r\nb'), TypeError);
});

test('JSON, Unicode, cloned body and read-once semantics', async () => {
  const response = platform.Response.json({ text: '你好 🌍' });
  const clone = response.clone();
  assert.deepEqual(await response.json(), { text: '你好 🌍' });
  assert.equal(await clone.text(), '{"text":"你好 🌍"}');
  await assert.rejects(response.text(), TypeError);
});

test('fetch resolves at headers, before the body ends', async () => {
  let sink;
  const fetch = createFetchAdapter(platform, (_request, target) => {
    sink = target; queueMicrotask(() => sink.headers(200, { 'content-type': 'text/plain' }));
    return { cancel() {} };
  });
  const response = await fetch('https://example.invalid');
  const reading = response.text();
  sink.chunk(encode('你')); sink.chunk(encode('好')); sink.end();
  assert.equal(await reading, '你好');
});

test('non-2xx response is returned for SDK error handling', async () => {
  const fetch = fixture((_req, sink) => { sink.headers(429, { 'retry-after': '1' }); sink.chunk(encode('rate limited')); sink.end(); });
  const response = await fetch('https://example.invalid');
  assert.equal(response.status, 429); assert.equal(response.ok, false);
  assert.equal(await response.text(), 'rate limited');
});

test('invalid native response metadata rejects fetch instead of leaving it pending', { timeout: 1000 }, async () => {
  const fetch = fixture((_req, sink) => sink.headers(700, {}));
  await assert.rejects(fetch('https://example.invalid'), RangeError);
});

test('network failure after headers rejects body consumption', async () => {
  let sink;
  const fetch = createFetchAdapter(platform, (_req, target) => { sink = target; queueMicrotask(() => sink.headers(200, {})); return { cancel() {} }; });
  const response = await fetch('https://example.invalid');
  const reading = response.text();
  sink.error(new Error('connection interrupted'));
  await assert.rejects(reading, /connection interrupted/);
});

test('abort before request prevents native transport creation', async () => {
  const controller = new AbortController(); controller.abort();
  const fetch = createFetchAdapter(platform, () => { assert.fail('must not start'); });
  await assert.rejects(fetch('https://example.invalid', { signal: controller.signal }), { name: 'AbortError' });
});

test('abort after headers cancels native transport and errors body', async () => {
  let canceled = 0;
  const controller = new AbortController();
  const fetch = createFetchAdapter(platform, (_req, sink) => {
    queueMicrotask(() => sink.headers(200, {}));
    return { cancel() { canceled++; } };
  });
  const response = await fetch('https://example.invalid', { signal: controller.signal });
  const reading = response.text(); controller.abort();
  await assert.rejects(reading, { name: 'AbortError' }); assert.equal(canceled, 1);
});

test('canceling a stream reader releases native request', async () => {
  let canceled = 0;
  const fetch = createFetchAdapter(platform, (_req, sink) => {
    queueMicrotask(() => sink.headers(200, {})); return { cancel() { canceled++; } };
  });
  const response = await fetch('https://example.invalid');
  await response.body.cancel(); assert.equal(canceled, 1);
});

test('cross-origin redirects strip credentials and convert POST 302 to GET', async () => {
  let calls = 0;
  const fetch = fixture((req, sink) => {
    calls++;
    if (calls === 1) { sink.headers(302, { location: 'https://other.invalid/final' }); sink.end(); }
    else {
      assert.equal(req.method, 'GET'); assert.equal(req.body, undefined);
      assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
      sink.headers(200, {}); sink.chunk(encode('ok')); sink.end();
    }
  });
  const response = await fetch('https://example.invalid', { method: 'POST', body: 'hello', headers: { authorization: 'secret', cookie: 'session=secret' } });
  assert.equal(await response.text(), 'ok'); assert.equal(response.redirected, true); assert.equal(calls, 2);
});

test('binary image data and multipart file body are preserved', async () => {
  const form = new platform.FormData();
  form.append('purpose', 'assistants');
  form.append('file', new platform.File(['你好'], 'test.txt', { type: 'text/plain' }));
  const fetch = fixture((req, sink) => {
    const text = new TextDecoder().decode(req.body);
    assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(text, /filename="test.txt"/); assert.match(text, /你好/);
    sink.headers(200, {}); sink.end();
  });
  await fetch('https://example.invalid', { method: 'POST', body: form });
});

test('unchanged official SDK sends Responses image content through the adapter', async () => {
  const fetch = fixture((req, sink) => {
    assert.equal(req.url, 'https://example.invalid/responses');
    const body = JSON.parse(new TextDecoder().decode(req.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.input[0].content[1].image_url, 'data:image/png;base64,test');
    sink.headers(200, { 'content-type': 'application/json' });
    sink.chunk(encode('{"id":"resp_test","output":[]}')); sink.end();
  });
  const client = new OpenAI({ apiKey: 'test-only', baseURL: 'https://example.invalid', fetch, maxRetries: 0 });
  assert.equal((await client.responses.create({ model: 'deepseek-flash', input: [{ role: 'user', content: [
    { type: 'input_text', text: 'describe' }, { type: 'input_image', image_url: 'data:image/png;base64,test', detail: 'auto' },
  ] }] })).id, 'resp_test');
});
