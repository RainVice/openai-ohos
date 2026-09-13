import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDownloadURL, downloadToolchainResponse } from './toolchain-download.mjs';

test('accepts official Huawei DBank signed download URLs without altering signatures', () => {
  for (const host of ['contentcenter-vali-drcn.dbankcdn.cn', 'contentcenter-vali-drcn.dbankcdn.com', 'developer.huawei.com', 'repo.huaweicloud.com']) {
    const url = `https://${host}/tools.zip?HW-CC-Sign=TEST%2Bvalue&HW-CC-Date=20260913T055400Z`;
    assert.equal(validateDownloadURL(url), url);
  }
});

test('rejects deceptive domains, non-HTTPS and embedded user credentials', () => {
  for (const url of ['https://dbankcdn.cn.example.com/tools.zip', 'https://evil-dbankcdn.cn/tools.zip',
    'http://contentcenter-vali-drcn.dbankcdn.cn/tools.zip', 'https://user:password@developer.huawei.com/tools.zip', 'invalid']) {
    assert.throws(() => validateDownloadURL(url));
  }
});

test('validates a Huawei-to-CDN redirect before following it', async () => {
  const visited = [];
  const response = await downloadToolchainResponse('https://developer.huawei.com/tools.zip', async (url, options) => {
    visited.push(url); assert.equal(options.redirect, 'manual');
    return visited.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://contentcenter-vali-drcn.dbankcdn.cn/tools.zip?HW-CC-Sign=test' } })
      : new Response('ZIP');
  });
  assert.equal(visited.length, 2); assert.equal(await response.text(), 'ZIP');
});

test('never requests an unapproved redirect destination', async () => {
  let calls = 0;
  await assert.rejects(downloadToolchainResponse('https://developer.huawei.com/tools.zip', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://unrelated.example/file' } });
  }), /Unsupported/);
  assert.equal(calls, 1);
});

test('reports CDN HTTP errors without leaking signed query values', async () => {
  await assert.rejects(downloadToolchainResponse('https://contentcenter-vali-drcn.dbankcdn.cn/tools.zip?HW-CC-Sign=SECRET',
    async () => new Response('denied', { status: 403 })), error => {
    assert.match(error.message, /HTTP 403/); assert.doesNotMatch(error.message, /SECRET/); return true;
  });
});
