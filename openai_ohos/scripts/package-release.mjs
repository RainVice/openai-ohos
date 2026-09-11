import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, run, deveco, scaffold, write } from './toolchain.mjs';

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/openai'];
const generated = JSON.parse(fs.readFileSync(path.join(root, 'generated/conversion.json'), 'utf8'));
if (generated.version !== lock.version || generated.integrity !== lock.integrity) {
  throw new Error('Generated SDK does not match package-lock.json. Run npm run convert before packaging.');
}
run('npm', ['run', 'build:runtime']);
run('npm', ['test']);
run('npm', ['run', 'test:syntax']);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-ohos-release-'));
try {
  scaffold(workspace, ['openai_ohos']);
  const module = path.join(workspace, 'openai_ohos');
  fs.mkdirSync(module);
  // Explicit release inputs: demo, credentials, node_modules and intermediate sources cannot leak.
  for (const item of ['src/main', 'Index.ets', 'oh-package.json5', 'build-profile.json5', 'hvigorfile.ts',
    'consumer-rules.txt', 'obfuscation-rules.txt', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'generated/openai.har']) {
    const target = path.join(module, item);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, item), target, { recursive: true });
  }
  const upstream = JSON.parse(fs.readFileSync(path.join(root, 'generated/conversion.json'), 'utf8'));
  write(module, 'src/main/resources/rawfile/upstream.json', upstream);
  write(module, 'src/main/resources/rawfile/NOTICE.txt', fs.readFileSync(path.join(root, 'NOTICE'), 'utf8'));
  deveco(['build', '--modules', 'openai_ohos', '--build-mode', 'release'], workspace);
  const built = path.join(module, 'build/default/outputs/default/openai_ohos.har');
  run(process.execPath, [path.join(root, 'scripts/verify-package.mjs'), built]);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const output = path.join(root, 'dist/openai_ohos.har');
  fs.copyFileSync(built, `${output}.tmp`);
  fs.renameSync(`${output}.tmp`, output);
  fs.copyFileSync(`${built}.verification.json`, `${output}.verification.json`);
  fs.copyFileSync(path.join(root, 'generated/conversion.json'), path.join(root, 'dist/upstream.json'));
  console.log(`Release ready (not published): ${output}`);
} finally {
  if (process.env.KEEP_VERIFY_WORKSPACE === '1') console.log(`Release workspace retained: ${workspace}`);
  else fs.rmSync(workspace, { recursive: true, force: true });
}
