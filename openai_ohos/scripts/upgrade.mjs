import fs from 'node:fs';
import path from 'node:path';
import { root, run } from './toolchain.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--version')) throw new Error('Usage: npm run upgrade [-- --version x.y.z]');
const registry = 'https://registry.npmjs.org';
const latest = args[1] ?? JSON.parse(run('npm', ['view', 'openai@latest', 'version', '--json', '--registry', registry], root, { encoding: 'utf8', stdio: 'pipe' }));
if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Unexpected latest stable version: ${latest}`);
console.log(`Official npm latest: openai@${latest}`);
const transaction = fs.mkdtempSync(path.join(root, '.upgrade-'));
const tracked = ['package.json', 'package-lock.json', 'generated', 'src/main/js/vendor', 'src/main/resources/rawfile/runtime-licenses.txt'];
const existed = new Set();
for (const item of tracked) {
  if (fs.existsSync(path.join(root, item))) {
    existed.add(item);
    const target = path.join(transaction, item);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, item), target, { recursive: true });
  }
}
try {
  run('npm', ['install', `openai@${latest}`, '--save-exact', '--ignore-scripts', '--registry', registry]);
  run('npm', ['run', 'convert']);
  run('npm', ['run', 'package']);
  console.log(`Upgrade complete: openai@${latest}. Dist passed prepublish and standalone consumer build. Nothing was published.`);
} catch (error) {
  for (const item of tracked) {
    fs.rmSync(path.join(root, item), { recursive: true, force: true });
    if (existed.has(item)) {
      fs.mkdirSync(path.dirname(path.join(root, item)), { recursive: true });
      fs.cpSync(path.join(transaction, item), path.join(root, item), { recursive: true });
    }
  }
  console.error('Upgrade failed; restored lockfiles and generated artifacts. Previous dist is retained.');
  try { run('npm', ['ci', '--ignore-scripts']); } catch { console.error('Run npm ci --ignore-scripts to restore the local tool installation.'); }
  throw error;
} finally { fs.rmSync(transaction, { recursive: true, force: true }); }
