import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDiagnostic } from './publish-diagnostics.mjs';

test('preserves actionable OHPM error messages and masks credentials', () => {
  const message = publicationDiagnostic({ stdout: 'debug secret transcript\n\x1b[31mohpm ERROR: Login failed\x1b[39m\nError Message: publish-id-test is invalid\nOriginal Error: password-test security:abcdef https://example.invalid/?token=hidden' }, ['publish-id-test', 'password-test']);
  assert.match(message, /Login failed/);
  assert.match(message, /is invalid/);
  assert.doesNotMatch(message, /publish-id-test|password-test|abcdef|hidden|transcript/);
});
test('never includes arbitrary child output', () => {
  assert.equal(publicationDiagnostic({ stdout: 'private information' }), 'No safe error details returned by the command');
});
