import rcp from '@hms.collaboration.rcp';
import util from '@ohos.util';
import url from '@ohos.url';
import buffer from '@ohos.buffer';
import { ReadableStream, AbortController, AbortSignal, structuredClone } from './vendor/WebPrimitives';
import { createWebPlatform } from './WebPlatform';
import { createFetchAdapter } from './FetchAdapter';
import { createURLBindings } from './URLBindings';

class TextEncoder {
  constructor() { this.native = new util.TextEncoder(); this.encoding = 'utf-8'; }
  encode(input = '') { return this.native.encodeInto(String(input)); }
  encodeInto(input, destination) { return this.native.encodeIntoUint8Array(input, destination); }
}
class TextDecoder {
  constructor(label = 'utf-8', options = {}) { this.native = new util.TextDecoder(label, options); }
  decode(input = new Uint8Array(), options = {}) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return this.native.decodeToString(bytes, options);
  }
}
const platform = createWebPlatform({
  ReadableStream, AbortController, AbortSignal, TextEncoder, TextDecoder,
  Blob: buffer.Blob, ...createURLBindings(url),
});

function startNative(request, sink) {
  const session = rcp.createSession();
  let finished = false;
  let status;
  let headers;
  const publishHeaders = () => { if (status && headers) sink.headers(status, headers); };
  const native = new rcp.Request(request.url);
  native.method = request.method;
  native.headers = request.headers;
  if (request.body !== undefined) native.content = request.body;
  native.configuration = {
    transfer: { autoRedirect: false, timeout: { connectMs: 30000, transferMs: 300000 } },
    tracing: { httpEventsHandler: {
      onStatusCodeReceive(value) { status = value; publishHeaders(); },
      onHeaderReceive(value) { headers = value; publishHeaders(); },
      onDataReceive(value) { sink.chunk(value); },
    } },
  };
  session.fetch(native).then(response => {
    if (finished) return;
    sink.headers(response.statusCode, response.headers);
    sink.end();
  }).catch(error => { if (!finished) sink.error(error); }).finally(() => {
    if (!finished) { finished = true; session.close(); }
  });
  return { cancel() { if (!finished) { finished = true; session.cancel(native); session.close(); } } };
}

export const harmonyFetch = createFetchAdapter(platform, startNative);
export function createHarmonyAbortController() { return new AbortController(); }
export function installHarmonyRuntime() {
  for (const [key, value] of Object.entries(platform)) {
    if (typeof globalThis[key] === 'undefined') globalThis[key] = value;
  }
  if (typeof globalThis.fetch === 'undefined') globalThis.fetch = harmonyFetch;
  if (typeof globalThis.structuredClone === 'undefined') globalThis.structuredClone = structuredClone;
}
installHarmonyRuntime();
