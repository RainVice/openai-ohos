import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveHostedToolchain } from './hosted-toolchain-layout.mjs';

const ets = 'sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark';
const rcp = 'sdk/default/hms/ets/api/@hms.collaboration.rcp.d.ts';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clt-layout-'));
  const write = relative => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
    return file;
  };
  for (const file of ['ohpm/bin/ohpm', 'hvigor/bin/hvigorw.js', rcp,
    'sdk/default/openharmony/js/build-tools/ace-loader/bin/ark/build/bin/es2abc']) write(file);
  return { root, write, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('resolves the actual Linux CLT 26.0.0.821 build/bin layout, ignoring JS compiler', () => {
  const f = fixture();
  try {
    const compiler = f.write(`${ets}/build/bin/es2abc`);
    assert.equal(resolveHostedToolchain(f.root).ES2ABC_BIN, compiler);
  } finally { f.clean(); }
});
test('compiler selection derives from the ETS package rather than an OS folder guess', () => {
  const f = fixture();
  try {
    const compiler = f.write(`${ets}/different-layout/bin/es2abc`);
    assert.equal(resolveHostedToolchain(f.root).ES2ABC_BIN, compiler);
  } finally { f.clean(); }
});
test('missing or ambiguous ETS compilers fail rather than selecting JS compiler', () => {
  const f = fixture();
  try {
    assert.throws(() => resolveHostedToolchain(f.root), /found 0/);
    f.write(`${ets}/build/bin/es2abc`);
    f.write(`${ets}/other/bin/es2abc`);
    assert.throws(() => resolveHostedToolchain(f.root), /found 2/);
  } finally { f.clean(); }
});
test('OpenHarmony-only SDK cannot silently replace required HMS API declarations', () => {
  const f = fixture();
  try {
    f.write(`${ets}/build/bin/es2abc`);
    fs.unlinkSync(path.join(f.root, rcp));
    assert.throws(() => resolveHostedToolchain(f.root), /RCP API/);
  } finally { f.clean(); }
});
