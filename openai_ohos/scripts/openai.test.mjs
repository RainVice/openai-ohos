import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const generated = fileURLToPath(new URL('../generated/', import.meta.url));
const responseBody = { id: 'resp_test', object: 'response', output: [] };
const jsonResponse = () => new Response(JSON.stringify(responseBody), {
  headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
});

// Run the same externally observable contracts on the untouched and converted distributions.
// No real service, API credentials, or HarmonyOS runtime is used by this host-side suite.
for (const distribution of ['upstream/openai', 'node_modules/openai', 'harmony/node_modules/openai']) {
  for (const format of distribution.startsWith('harmony/') ? ['mjs'] : ['mjs', 'js']) {
    const root = path.join(generated, distribution);
    const load = file => format === 'mjs'
      ? import(pathToFileURL(path.join(root, `${file}.mjs`)).href)
      : Promise.resolve(require(path.join(root, `${file}.js`)));
    const exports = await load('index');
    const OpenAI = exports.default;
    const label = `${distribution}/${format}`;

    test(`${label}: default/named exports and Responses request`, async () => {
      assert.equal(OpenAI, exports.OpenAI);
      const client = new OpenAI({
        apiKey: 'test-only-not-a-real-key', baseURL: 'https://example.invalid/v1',
        fetch: async (url, init) => {
          assert.equal(String(url), 'https://example.invalid/v1/responses');
          assert.equal(init.method, 'POST');
          assert.deepEqual(JSON.parse(init.body), { model: 'test-model', input: 'hello' });
          assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-only-not-a-real-key');
          return jsonResponse();
        },
      });
      const result = await client.responses.create({ model: 'test-model', input: 'hello' }).withResponse();
      assert.equal(result.data.id, 'resp_test');
      assert.equal(result.request_id, 'req_test');
    });

    test(`${label}: split UTF-8 SSE chunks`, async () => {
      const wire = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }] })}\n\ndata: [DONE]\n\n`);
      const client = new OpenAI({
        apiKey: 'test-only',
        fetch: async () => new Response(new ReadableStream({
          start(controller) {
            for (const byte of wire) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } }),
      });
      const stream = await client.chat.completions.create({ model: 'test-model', messages: [], stream: true });
      const contents = [];
      for await (const event of stream) contents.push(event.choices[0].delta.content);
      assert.deepEqual(contents, ['你好']);
    });

    test(`${label}: retry server failure`, async () => {
      let calls = 0;
      const client = new OpenAI({
        apiKey: 'test-only', maxRetries: 1,
        fetch: async () => ++calls === 1
          ? new Response('{"error":{"message":"retry"}}', { status: 500, headers: { 'retry-after-ms': '1', 'content-type': 'application/json' } })
          : jsonResponse(),
      });
      assert.equal((await client.responses.create({ model: 'test-model', input: 'hello' })).id, 'resp_test');
      assert.equal(calls, 2);
    });

    test(`${label}: API error preserves status and request ID`, async () => {
      const client = new OpenAI({
        apiKey: 'test-only', maxRetries: 0,
        fetch: async () => new Response('{"error":{"message":"bad input","type":"invalid_request_error"}}', {
          status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req_bad' },
        }),
      });
      await assert.rejects(client.responses.create({ model: 'test-model', input: 'hello' }), error => {
        assert.ok(error instanceof exports.APIError);
        assert.equal(error.status, 400);
        assert.equal(error.requestID, 'req_bad');
        return true;
      });
    });

    test(`${label}: timeout aborts the transport`, async () => {
      let aborted = false;
      const client = new OpenAI({
        apiKey: 'test-only', maxRetries: 0, timeout: 20,
        fetch: async (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        }),
      });
      await assert.rejects(client.responses.create({ model: 'test-model', input: 'hello' }), exports.APIConnectionTimeoutError);
      assert.equal(aborted, true);
    });

    test(`${label}: multipart upload retains file contents`, async () => {
      const client = new OpenAI({
        apiKey: 'test-only',
        fetch: async (_url, init) => {
          assert.ok(init.body instanceof FormData);
          assert.equal(init.body.get('purpose'), 'assistants');
          const file = init.body.get('file');
          assert.equal(file.name, 'sample.txt');
          assert.equal(await file.text(), 'hello upload');
          return new Response('{"id":"file_test"}', { headers: { 'content-type': 'application/json' } });
        },
      });
      const result = await client.files.create({ file: new File(['hello upload'], 'sample.txt'), purpose: 'assistants' });
      assert.equal(result.id, 'file_test');
    });

    test(`${label}: iterator fallback return cancels and releases reader`, async () => {
      for (const module of ['internal/shims', 'internal/stream-utils']) {
        const { ReadableStreamToAsyncIterable } = await load(module);
        let canceled = false;
        const stream = new ReadableStream({
          start(controller) { controller.enqueue('first'); },
          cancel() { canceled = true; },
        });
        // Force the fallback containing the original async return() parser failure.
        const iterable = ReadableStreamToAsyncIterable({ getReader: () => stream.getReader() });
        assert.deepEqual(await iterable.next(), { done: false, value: 'first' });
        await iterable.return();
        assert.equal(canceled, true);
        assert.equal(stream.locked, false);
      }
    });
  }
}
