// Native transport contract: start(request, sink) -> { cancel() }.
// The SDK continues to own HTTP errors, retries, SSE parsing and API resources.
export function createFetchAdapter(platform, start) {
  const { Request, Response, Headers, ReadableStream, URL } = platform;
  const abortError = signal => signal.reason ?? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  async function fetch(input, init, redirects = 0) {
    const request = new Request(input, init);
    if (!['https:', 'http:'].includes(new URL(request.url).protocol)) throw new TypeError('Only HTTP(S) URLs are supported');
    if (request.signal.aborted) throw abortError(request.signal);
    const body = request.body ? await request.arrayBuffer() : undefined;
    if (request.signal.aborted) throw abortError(request.signal);
    const response = await new Promise((resolve, reject) => {
      let nativeRequest;
      let settled = false;
      let ended = false;
      let controller;
      let receivedHeaders = false;
      const cleanup = () => request.signal.removeEventListener('abort', onAbort);
      const fail = error => {
        if (ended) return;
        ended = true;
        cleanup();
        controller.error(error);
        if (!settled) { settled = true; reject(error); }
      };
      const onAbort = () => { fail(abortError(request.signal)); nativeRequest?.cancel(); };
      const stream = new ReadableStream({
        start(value) { controller = value; },
        cancel() { ended = true; cleanup(); nativeRequest?.cancel(); },
      }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) { onAbort(); return; }
      try {
        nativeRequest = start({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body }, {
          headers(status, headers) {
            if (settled || ended || status < 200) return;
            try {
              const response = new Response(request.method === 'HEAD' || [204, 205, 304].includes(status) ? null : stream, {
                status, headers, url: request.url,
              });
              receivedHeaders = true;
              settled = true;
              resolve(response);
            } catch (error) { fail(error); nativeRequest?.cancel(); }
          },
          chunk(chunk) {
            if (ended) return;
            // Bound the native-to-JS queue if the caller stops consuming the body.
            if (controller.desiredSize - chunk.byteLength < -16 * 1024 * 1024) {
              fail(new RangeError('Response reader is too slow: queued body exceeded 16 MiB'));
              nativeRequest?.cancel(); return;
            }
            controller.enqueue(new Uint8Array(chunk).slice());
          },
          end() {
            if (ended) return;
            if (!receivedHeaders) { fail(new TypeError('Native transport ended without response headers')); return; }
            ended = true; cleanup(); controller.close();
          },
          error(error) { fail(error instanceof Error ? error : Object.assign(new TypeError(error.message || 'Network request failed'), { cause: error })); },
        });
        if (ended) nativeRequest.cancel();
      } catch (error) { fail(error); nativeRequest?.cancel(); }
    });
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (request.redirect === 'manual') return response;
      await response.body?.cancel();
      if (request.redirect === 'error' || redirects >= 20) throw new TypeError('Redirect is not allowed or limit exceeded');
      const destination = new URL(location, request.url);
      const headers = new Headers(request.headers);
      if (destination.origin !== new URL(request.url).origin) {
        headers.delete('authorization'); headers.delete('cookie'); headers.delete('proxy-authorization');
      }
      const toGet = (response.status === 303 && request.method !== 'HEAD') || ([301, 302].includes(response.status) && request.method === 'POST');
      if (toGet) { headers.delete('content-type'); headers.delete('content-length'); }
      const next = await fetch(destination.href, {
        method: toGet ? 'GET' : request.method, body: toGet ? undefined : body,
        headers, signal: request.signal, redirect: request.redirect,
      }, redirects + 1);
      next.redirected = true;
      return next;
    }
    return response;
  }
  return fetch;
}
