import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistryMetadata } from './registry-metadata.mjs';

test('bare author name is rejected even if the package has a homepage', () => {
  assert.throws(() => validateRegistryMetadata({ author: 'RainVice', homepage: 'https://github.com/RainVice/openai-ohos' }), /author.url or author.email/);
});
test('author homepage satisfies the server requirement without publishing an email', () => {
  assert.doesNotThrow(() => validateRegistryMetadata({ author: { name: 'RainVice', url: 'https://github.com/RainVice' } }));
});
test('author email or standard person string is accepted', () => {
  assert.doesNotThrow(() => validateRegistryMetadata({ author: { name: 'Example', email: 'author@example.com' } }));
  assert.doesNotThrow(() => validateRegistryMetadata({ author: 'RainVice (https://github.com/RainVice)' }));
});
test('invalid author contact metadata fails locally', () => {
  for (const author of [undefined, {}, { name: 'RainVice' }, { name: 'RainVice', url: 'not a url' },
    { name: 'RainVice', email: 'invalid' }, { url: 'https://github.com/RainVice' }]) {
    assert.throws(() => validateRegistryMetadata({ author }));
  }
});
test('OHPM repository is a URL string, not an npm repository object', () => {
  const author = { name: 'RainVice', url: 'https://github.com/RainVice' };
  assert.doesNotThrow(() => validateRegistryMetadata({ author, repository: 'https://github.com/RainVice/openai-ohos.git' }));
  assert.throws(() => validateRegistryMetadata({ author, repository: { type: 'git', url: 'https://github.com/RainVice/openai-ohos.git' } }), /URL string/);
  assert.throws(() => validateRegistryMetadata({ author, repository: 'github:RainVice/openai-ohos' }), /URL string/);
});
