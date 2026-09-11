// HarmonyOS URLParams exposes an iterable whose iterator is not a Web iterator
// on the tested runtime. Keep native parsing/encoding, expose standard JS iteration.
export function createURLBindings(native) {
  class URLSearchParams {
    constructor(init = '', changed, read) {
      this.native = new native.URLParams(typeof init === 'string' ? init : '');
      this.changed = changed;
      this.read = read;
      if (typeof init !== 'string') {
        const entries = typeof init[Symbol.iterator] === 'function' ? init : Object.entries(init);
        for (const [key, value] of entries) this.native.append(String(key), String(value));
      }
    }
    current() { return this.read ? new native.URLParams(this.read()) : this.native; }
    mutate(fn) { const params = this.current(); fn(params); this.native = params; this.changed?.(params.toString()); }
    append(key, value) { this.mutate(params => params.append(String(key), String(value))); }
    set(key, value) { this.mutate(params => params.set(String(key), String(value))); }
    delete(key, value) {
      if (value === undefined) this.mutate(params => params.delete(String(key)));
      else {
        const entries = [...this].filter(pair => pair[0] !== String(key) || pair[1] !== String(value));
        this.mutate(params => { params.delete(String(key)); for (const [k, v] of entries) if (k === String(key)) params.append(k, v); });
      }
    }
    get(key) { return this.current().get(String(key)); }
    getAll(key) { return [...this].filter(pair => pair[0] === String(key)).map(pair => pair[1]); }
    has(key, value) { return value === undefined ? this.current().has(String(key)) : this.getAll(key).includes(String(value)); }
    sort() { this.mutate(params => params.sort()); }
    get size() { return [...this].length; }
    *entries() {
      const pairs = [];
      this.current().forEach((value, key) => pairs.push([key, value]));
      yield* pairs;
    }
    *keys() { for (const [key] of this.entries()) yield key; }
    *values() { for (const [, value] of this.entries()) yield value; }
    forEach(fn, self) { for (const [key, value] of this.entries()) fn.call(self, value, key, this); }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this.current().toString(); }
  }
  class URL {
    constructor(input, base) {
      this.native = base === undefined ? new native.URL(String(input)) : new native.URL(String(input), String(base));
      this.searchParams = new URLSearchParams('', value => { this.native.search = value; }, () => this.native.search);
    }
    toString() { return this.native.href; }
    toJSON() { return this.native.href; }
    static canParse(input, base) { try { new URL(input, base); return true; } catch { return false; } }
    static parse(input, base) { try { return new URL(input, base); } catch { return null; } }
  }
  for (const key of ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) {
    Object.defineProperty(URL.prototype, key, {
      get() { return this.native[key]; }, set(value) { this.native[key] = String(value); }, enumerable: true,
    });
  }
  Object.defineProperty(URL.prototype, 'origin', { get() { return this.native.origin; }, enumerable: true });
  return { URL, URLSearchParams };
}
