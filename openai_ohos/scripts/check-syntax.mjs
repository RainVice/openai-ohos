import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { es2abcBinary } from './toolchain.mjs';

const root = fileURLToPath(new URL('../generated/node_modules/openai/', import.meta.url));
const compiler = es2abcBinary();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-es2abc-'));
const runtime = fileURLToPath(new URL('../src/main/js/', import.meta.url));
const harmony = fileURLToPath(new URL('../generated/harmony/node_modules/openai/', import.meta.url));
const files = fs.readdirSync(root, { recursive: true }).filter(file => /\.(mjs|js)$/.test(file)).map(file => ({ file, root, module: file.endsWith('.mjs') }));
files.push(...fs.readdirSync(harmony, { recursive: true }).filter(file => file.endsWith('.mjs')).map(file => ({ file, root: harmony, module: true })));
files.push(...fs.readdirSync(runtime, { recursive: true }).filter(file => file.endsWith('.js')).map(file => ({ file, root: runtime, module: true })));
let failures = 0;
try {
  for (const entry of files) {
    // es2abc expects a .js extension; preserve the actual ESM/CommonJS parsing mode.
    const input = path.join(temporary, 'input.js');
    fs.copyFileSync(path.join(entry.root, entry.file), input);
    const result = spawnSync(compiler, [entry.module ? '--module' : '--commonjs', '--parse-only', input], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      failures++;
      console.error(`${entry.file}: ${result.stderr}${result.stdout}`);
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(`es2abc syntax: ${files.length - failures}/${files.length} files passed (ESM + CommonJS)`);
if (failures) process.exitCode = 1;
