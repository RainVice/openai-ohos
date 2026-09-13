import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRelease, publishedVersions, alignPackageVersion } from './release-version.mjs';

test('same published version skips the entire release', () => {
  assert.deepEqual(planRelease({ latest: '7.15.0', publishedVersions: ['7.14.0', '7.15.0'], submittedTags: [] }),
    { needed: false, upstream: '7.15.0', version: '7.15.0', reason: 'version-already-published' });
});
test('new upstream release uses the exact official version, not an independent patch', () => {
  const plan = planRelease({ latest: '8.0.0', publishedVersions: ['7.15.0'], submittedTags: ['ohpm-v7.15.0'] });
  assert.equal(plan.needed, true); assert.equal(plan.version, '8.0.0'); assert.equal(plan.upstream, '8.0.0');
});
test('first publication is needed even if the checkout already has that SDK', () => {
  assert.equal(planRelease({ latest: '7.15.0', publishedVersions: [], submittedTags: [] }).needed, true);
});
test('submitted version awaiting registry review is not submitted again', () => {
  const plan = planRelease({ latest: '7.15.0', publishedVersions: [], submittedTags: ['ohpm-v7.15.0'] });
  assert.equal(plan.needed, false); assert.equal(plan.reason, 'version-already-submitted');
});
test('registry includes all published versions, not just latest', async () => {
  let endpoint;
  const versions = await publishedVersions('@scope/package', async url => {
    endpoint = url;
    return new Response(JSON.stringify({ versions: { '7.15.0': {}, '8.0.0': {} }, 'dist-tags': { latest: '8.0.0' } }));
  });
  assert.match(endpoint, /%40scope%2Fpackage$/);
  assert.deepEqual(versions, ['7.15.0', '8.0.0']);
  assert.equal(planRelease({ latest: '7.15.0', publishedVersions: versions, submittedTags: [] }).needed, false);
});
test('registry errors fail closed; only 404 means no published package', async () => {
  assert.deepEqual(await publishedVersions('missing', async () => new Response('{}', { status: 404 })), []);
  await assert.rejects(publishedVersions('pkg', async () => new Response('{}', { status: 503 })), /HTTP 503/);
  await assert.rejects(publishedVersions('pkg', async () => new Response('{}')), /Invalid OHPM/);
  await assert.rejects(publishedVersions('pkg', async () => { throw new Error('network unavailable'); }), /network/);
});
test('version alignment updates the manifest and adds one changelog entry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
  try {
    fs.writeFileSync(path.join(directory, 'oh-package.json5'), '{"version":"7.15.0","name":"openai_ohos"}');
    fs.writeFileSync(path.join(directory, 'CHANGELOG.md'), '# 更新日志\n\n## 7.15.0\n');
    assert.equal(alignPackageVersion(directory, '8.0.0', '2026-09-13'), true);
    assert.equal(alignPackageVersion(directory, '8.0.0', '2026-09-13'), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'oh-package.json5'))).version, '8.0.0');
    assert.equal(fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8').match(/## 8\.0\.0/g).length, 1);
    assert.throws(() => alignPackageVersion(directory, 'latest'), /stable/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
