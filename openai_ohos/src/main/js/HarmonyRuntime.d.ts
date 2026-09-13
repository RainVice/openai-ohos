// HarmonyOS does not include DOM globals in the application's compiler libs.
// Declare the cancellation primitives initialized by this module at runtime.
declare global {
  interface AbortSignal {
    readonly aborted: boolean;
    onabort: ((event: { readonly type: string }) => void) | null;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean } | boolean): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }
  interface AbortController {
    readonly signal: AbortSignal;
    abort(): void;
  }
  var AbortController: {
    prototype: AbortController;
    new(): AbortController;
  };
}
export {};
