import test from 'node:test';
import assert from 'node:assert/strict';
import { run, root } from './toolchain.mjs';

test('standard global AbortController cancels an ordinary official SDK request through the adapter', () => {
  // Child process isolates replacement of Node's native global from other tests.
  const output = run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { AbortController, AbortSignal, ReadableStream } from './src/main/js/vendor/WebPrimitives.js';
    import { createWebPlatform } from './src/main/js/WebPlatform.js';
    import { createFetchAdapter } from './src/main/js/FetchAdapter.js';
    import OpenAI from './generated/harmony/node_modules/openai/index.mjs';
    globalThis.AbortController = AbortController;
    globalThis.AbortSignal = AbortSignal;
    const platform = createWebPlatform({ AbortController, AbortSignal, ReadableStream, TextEncoder, TextDecoder, Blob, URL, URLSearchParams });
    let canceled = false;
    let notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const fetch = createFetchAdapter(platform, () => {
      notifyStarted();
      return { cancel() { canceled = true; } };
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch, maxRetries: 0 });
    const controller = new globalThis.AbortController();
    const pending = client.responses.create({ model: 'test-model', input: 'hello', stream: false }, { signal: controller.signal });
    const rejected = assert.rejects(pending, OpenAI.APIUserAbortError);
    await started;
    controller.abort();
    await rejected;
    assert.equal(controller.signal.aborted, true);
    assert.equal(canceled, true);
    console.log('ordinary request cancellation passed');
  `], root, { stdio: 'pipe', encoding: 'utf8', timeout: 10000 });
  assert.match(output, /ordinary request cancellation passed/);
});
