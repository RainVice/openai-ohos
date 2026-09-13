import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { parse } from 'yaml';
import { generateKeyPairSync } from 'node:crypto';
import { listArchive, readArchiveFile, extractArchive } from './archive.mjs';
import { root, run, executableOnPath, resolveTool } from './toolchain.mjs';
import { validateCredentials } from './publish-ohpm.mjs';

test('archive round-trip preserves Unicode paths and binary data without a system tar', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archive test '));
  try {
    fs.mkdirSync(path.join(temporary, 'package'));
    fs.writeFileSync(path.join(temporary, 'package/中文.bin'), Buffer.from([0, 1, 255]));
    const archive = path.join(temporary, 'test.har');
    tar.c({ file: archive, cwd: temporary, gzip: true, sync: true }, ['package']);
    assert.ok(listArchive(archive).includes('package/中文.bin'));
    assert.deepEqual(readArchiveFile(archive, 'package/中文.bin'), Buffer.from([0, 1, 255]));
    extractArchive(archive, path.join(temporary, 'out'), 1);
    assert.deepEqual(fs.readFileSync(path.join(temporary, 'out/中文.bin')), Buffer.from([0, 1, 255]));
    assert.throws(() => readArchiveFile(archive, 'missing'), /missing/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('tool resolution supports explicit paths with spaces and Windows command launchers', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tool path '));
  try {
    const file = path.join(temporary, 'ohpm.cmd'); fs.writeFileSync(file, '@echo off');
    assert.equal(resolveTool('ohpm', 'OHPM_BIN', { OHPM_BIN: file }), file);
    assert.equal(executableOnPath('ohpm', { PATH: temporary, PATHEXT: '.CMD;.EXE' }, 'win32'), file);
    assert.throws(() => resolveTool('es2abc', 'ES2ABC_BIN', { PATH: '' }), /ES2ABC_BIN/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('process arguments are preserved without a shell', () => {
  const value = 'a path with spaces; $(not-a-command) & 中文';
  const output = run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value], root, { stdio: 'pipe', encoding: 'utf8' });
  assert.equal(output, value);
});

test('publication accepts three credentials and verifies the original key password', () => {
  assert.throws(() => validateCredentials({}), /OHPM_PUBLISH_ID/);
  assert.throws(() => validateCredentials({ OHPM_PUBLISH_ID: 'test', OHPM_PRIVATE_KEY: 'plain', OHPM_KEY_PASSPHRASE: 'test' }), /encrypted/);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'temporary-test-only' },
    publicKeyEncoding: { type: 'spki', format: 'pem' } });
  assert.equal(validateCredentials({ OHPM_PUBLISH_ID: 'test', OHPM_PRIVATE_KEY: privateKey, OHPM_KEY_PASSPHRASE: 'temporary-test-only' }), privateKey);
  assert.throws(() => validateCredentials({ OHPM_PUBLISH_ID: 'test', OHPM_PRIVATE_KEY: privateKey, OHPM_KEY_PASSPHRASE: 'wrong' }), /must match/);
});

test('workflow separates hosted cross-platform tests and credentialed release jobs', () => {
  const ci = parse(fs.readFileSync(path.join(root, '../.github/workflows/ci.yml'), 'utf8'));
  assert.deepEqual(ci.jobs.javascript.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
  const release = parse(fs.readFileSync(path.join(root, '../.github/workflows/sync-openai.yml'), 'utf8'));
  assert.equal(release.on.schedule[0].cron, '23 0 * * *');
  assert.equal(release.jobs['build-publish']['runs-on'], 'ubuntu-24.04');
  assert.equal(release.jobs['build-publish'].environment, undefined);
  assert.doesNotMatch(release.jobs['build-publish'].if, /OHPM_RELEASE_ENABLED/);
  const steps = release.jobs['build-publish'].steps;
  const publish = steps.find(step => step.run === 'npm run publish:ohpm');
  assert.equal(Object.keys(publish.env).length, 3);
  assert.ok(steps.findIndex(step => step.run === 'npm run ci:commit') < steps.indexOf(publish));
});
