// Web API values at the platform boundary. No OpenAI SDK implementation is modified.
export function createWebPlatform(native) {
  const { ReadableStream, TextEncoder, TextDecoder, Blob, URL, URLSearchParams, AbortController, AbortSignal } = native;
  const encoder = new TextEncoder();
  const bytes = value => value instanceof ArrayBuffer ? new Uint8Array(value) :
    ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : encoder.encode(String(value));
  const name = value => {
    const text = String(value).toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(text)) throw new TypeError('Invalid header name');
    return text;
  };
  const headerValue = value => {
    const text = String(value).trim();
    if (/[\r\n\0]/.test(text)) throw new TypeError('Invalid header value');
    return text;
  };
  class Headers {
    constructor(init) {
      this.valuesMap = new Map();
      if (!init) return;
      if (typeof init[Symbol.iterator] === 'function') {
        for (const pair of init) {
          if (pair.length !== 2) throw new TypeError('Expected header pair');
          this.append(pair[0], pair[1]);
        }
      } else {
        for (const key of Object.keys(init)) {
          const value = init[key];
          for (const item of Array.isArray(value) ? value : [value]) this.append(key, item);
        }
      }
    }
    append(key, value) { key = name(key); this.valuesMap.set(key, [...(this.valuesMap.get(key) || []), headerValue(value)]); }
    set(key, value) { this.valuesMap.set(name(key), [headerValue(value)]); }
    get(key) { const values = this.valuesMap.get(name(key)); return values ? values.join(', ') : null; }
    getSetCookie() { return [...(this.valuesMap.get('set-cookie') || [])]; }
    has(key) { return this.valuesMap.has(name(key)); }
    delete(key) { this.valuesMap.delete(name(key)); }
    *entries() { for (const key of [...this.valuesMap.keys()].sort()) yield [key, this.get(key)]; }
    *keys() { for (const [key] of this.entries()) yield key; }
    *values() { for (const [, value] of this.entries()) yield value; }
    forEach(fn, self) { for (const [key, value] of this.entries()) fn.call(self, value, key, this); }
    [Symbol.iterator]() { return this.entries(); }
  }
  class File extends Blob {
    constructor(parts, name, options = {}) {
      super(parts, options);
      this.name = String(name);
      this.lastModified = options.lastModified ?? Date.now();
    }
    get [Symbol.toStringTag]() { return 'File'; }
  }
  class FormData {
    constructor() { this.fields = []; }
    append(key, value, filename) {
      this.fields.push([String(key), value instanceof Blob ?
        new File([value], filename ?? value.name ?? 'blob', { type: value.type }) : String(value)]);
    }
    set(key, value, filename) { this.delete(key); this.append(key, value, filename); }
    delete(key) { this.fields = this.fields.filter(pair => pair[0] !== String(key)); }
    get(key) { return this.getAll(key)[0] ?? null; }
    getAll(key) { return this.fields.filter(pair => pair[0] === String(key)).map(pair => pair[1]); }
    has(key) { return this.fields.some(pair => pair[0] === String(key)); }
    *entries() { yield* this.fields; }
    *keys() { for (const [key] of this.fields) yield key; }
    *values() { for (const [, value] of this.fields) yield value; }
    forEach(fn, self) { for (const [key, value] of this.fields) fn.call(self, value, key, this); }
    [Symbol.iterator]() { return this.entries(); }
    get [Symbol.toStringTag]() { return 'FormData'; }
  }
  const escape = value => String(value).replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
  function normalizeBody(body) {
    if (body == null) return { stream: null, type: null };
    if (typeof body.getReader === 'function') return { stream: body, type: null };
    let type = null;
    if (body instanceof FormData) {
      const boundary = `----HarmonyFetch${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      const parts = [];
      for (const [key, value] of body) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${escape(key)}"`);
        if (value instanceof Blob) {
          parts.push(`; filename="${escape(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`, value, '\r\n');
        } else parts.push(`\r\n\r\n${value}\r\n`);
      }
      parts.push(`--${boundary}--\r\n`);
      type = `multipart/form-data; boundary=${boundary}`;
      body = new Blob(parts, { type });
    } else if (body instanceof URLSearchParams) {
      type = 'application/x-www-form-urlencoded;charset=UTF-8';
      body = body.toString();
    } else if (typeof body === 'string') type = 'text/plain;charset=UTF-8';
    if (body instanceof Blob) type = body.type || type;
    const value = body;
    return { type, stream: new ReadableStream({ async start(controller) {
      try {
        controller.enqueue(value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : bytes(value).slice());
        controller.close();
      } catch (error) { controller.error(error); }
    } }) };
  }
  class Body {
    constructor(body) {
      const normalized = normalizeBody(body);
      this.body = normalized.stream;
      this.bodyUsed = false;
      this.contentType = normalized.type;
    }
    async arrayBuffer() {
      if (this.bodyUsed || this.body?.locked) throw new TypeError('Body already used');
      this.bodyUsed = true;
      if (!this.body) return new ArrayBuffer(0);
      const reader = this.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = bytes(value); chunks.push(chunk); size += chunk.length;
        }
      } finally { reader.releaseLock(); }
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      return result.buffer;
    }
    async text() { return new TextDecoder().decode(new Uint8Array(await this.arrayBuffer())); }
    async json() { return JSON.parse(await this.text()); }
    async blob() { return new Blob([await this.arrayBuffer()], { type: this.headers.get('content-type') || '' }); }
    splitBody() {
      if (this.bodyUsed || this.body?.locked) throw new TypeError('Body already used');
      if (!this.body) return null;
      const [original, copy] = this.body.tee(); this.body = original; return copy;
    }
  }
  class Response extends Body {
    constructor(body = null, init = {}) {
      super(body);
      this.status = init.status ?? 200;
      if (this.status < 200 || this.status > 599) throw new RangeError('Invalid response status');
      if ([204, 205, 304].includes(this.status) && body !== null) throw new TypeError('Status must have a null body');
      this.statusText = init.statusText ?? '';
      this.headers = new Headers(init.headers);
      if (this.contentType && !this.headers.has('content-type')) this.headers.set('content-type', this.contentType);
      this.url = init.url ?? '';
      this.redirected = init.redirected ?? false;
      this.type = 'default';
    }
    get ok() { return this.status >= 200 && this.status < 300; }
    clone() { return new Response(this.splitBody(), this); }
    static json(value, init = {}) { const headers = new Headers(init.headers); if (!headers.has('content-type')) headers.set('content-type', 'application/json'); return new Response(JSON.stringify(value), { ...init, headers }); }
  }
  class Request extends Body {
    constructor(input, init = {}) {
      const prior = input instanceof Request ? input : null;
      super(init.body !== undefined ? init.body : prior ? prior.splitBody() : null);
      this.url = new URL(prior ? prior.url : String(input)).href;
      this.method = String(init.method ?? prior?.method ?? 'GET').toUpperCase();
      if (['GET', 'HEAD'].includes(this.method) && this.body) throw new TypeError('GET/HEAD cannot have a body');
      this.headers = new Headers(init.headers ?? prior?.headers);
      if (this.contentType && !this.headers.has('content-type')) this.headers.set('content-type', this.contentType);
      this.signal = init.signal ?? prior?.signal ?? new AbortController().signal;
      this.redirect = init.redirect ?? prior?.redirect ?? 'follow';
      this.credentials = init.credentials ?? prior?.credentials ?? 'omit';
    }
    clone() { return new Request(this); }
  }
  return { Headers, Request, Response, Blob, File, FormData, ReadableStream, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal };
}
