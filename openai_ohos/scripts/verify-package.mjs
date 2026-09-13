import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSON5 from 'json5';
import { listArchive, readArchiveFile } from './archive.mjs';
import { root, run, deveco, ohpmBinary, scaffold, write } from './toolchain.mjs';

const archive = path.resolve(process.argv[2] ?? path.join(root, 'dist/openai_ohos.har'));
if (!fs.existsSync(archive)) throw new Error(`HAR not found: ${archive}`);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-ohos-consumer-'));
try {
  const entries = listArchive(archive);
  const manifest = JSON5.parse(readArchiveFile(archive, 'package/oh-package.json5').toString('utf8'));
  for (const required of ['package/oh-package.json5', 'package/LICENSE', 'package/README.md', 'package/CHANGELOG.md', 'package/generated/openai.har',
    'package/src/main/resources/rawfile/runtime-licenses.txt', 'package/src/main/resources/rawfile/upstream.json',
    'package/src/main/resources/rawfile/NOTICE.txt']) {
    if (!entries.includes(required) || readArchiveFile(archive, required).length === 0) throw new Error(`Missing or empty release member: ${required}`);
  }
  const forbidden = entries.filter(file => /(?:node_modules|upstream\/openai|\.test\.|DemoSecrets|demo-result|scripts\/|convert_\d|\.openai-|package-lock\.json|TEST_RESULTS)/.test(file));
  if (forbidden.length) throw new Error(`Development files leaked into HAR: ${forbidden.join(', ')}`);
  if (manifest.metadata?.debug === true) throw new Error('Refusing a debug HAR');
  for (const [name, target] of Object.entries(manifest.dependencies ?? {})) {
    if (target.startsWith('file:')) {
      const relative = target.slice(5).replace(/^\.\//, '');
      if (relative.includes('..') || !entries.includes(`package/${relative}`)) throw new Error(`Unbundled local dependency: ${name} -> ${target}`);
    }
  }
  const upstream = JSON.parse(readArchiveFile(archive, 'package/src/main/resources/rawfile/upstream.json').toString('utf8'));
  const sdk = path.join(workspace, 'sdk.har');
  fs.writeFileSync(sdk, readArchiveFile(archive, 'package/generated/openai.har'));
  const sdkManifest = JSON5.parse(readArchiveFile(sdk, 'package/oh-package.json5').toString('utf8'));
  if (sdkManifest.version !== upstream.version) throw new Error('Bundled SDK version does not match upstream report');
  if (manifest.version !== upstream.version) throw new Error('OHPM package version must equal the bundled official SDK version');
  run(ohpmBinary(), ['prepublish', archive]);
  scaffold(workspace, ['entry']);
  fs.mkdirSync(path.join(workspace, 'entry/libs'), { recursive: true });
  fs.copyFileSync(archive, path.join(workspace, 'entry/libs/openai_ohos.har'));
  write(workspace, 'entry/oh-package.json5', { name: 'entry', version: '1.0.0', dependencies: { openai_ohos: 'file:./libs/openai_ohos.har' } });
  write(workspace, 'entry/build-profile.json5', { apiType: 'stageMode', targets: [{ name: 'default' }] });
  write(workspace, 'entry/hvigorfile.ts', "import { hapTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: hapTasks, plugins: [] };\n");
  write(workspace, 'entry/src/main/module.json5', { module: {
    name: 'entry', type: 'entry', mainElement: 'EntryAbility', deviceTypes: ['phone'], deliveryWithInstall: true,
    installationFree: false, pages: '$profile:main_pages', requestPermissions: [{ name: 'ohos.permission.INTERNET' }],
    abilities: [{ name: 'EntryAbility', srcEntry: './ets/EntryAbility.ets', exported: true,
      startWindowIcon: '$media:icon', startWindowBackground: '$color:start_background' }],
  } });
  write(workspace, 'entry/src/main/resources/base/profile/main_pages.json', { src: ['pages/Index'] });
  write(workspace, 'entry/src/main/resources/base/element/color.json', { color: [{ name: 'start_background', value: '#FFFFFF' }] });
  write(workspace, 'entry/src/main/ets/EntryAbility.ets', "import { UIAbility } from '@kit.AbilityKit';\nimport { window } from '@kit.ArkUI';\nexport default class EntryAbility extends UIAbility {\n  onWindowStageCreate(stage: window.WindowStage): void { try { stage.loadContent('pages/Index'); } catch (error) { console.error((error as Error).message); } }\n}\n");
  write(workspace, 'entry/src/main/ets/pages/Index.ets', `import OpenAI, { OpenAI as NamedOpenAI, harmonyFetch, createHarmonyAbortController } from 'openai_ohos';
@Entry
@Component
struct Index {
  private client: OpenAI = new NamedOpenAI({ apiKey: 'compile-only', fetch: harmonyFetch });
  async verify(): Promise<void> {
    const controller = createHarmonyAbortController();
    const response = await this.client.responses.create({ model: 'compile-only', input: 'test' }, { signal: controller.signal });
    console.info(response.output_text);
  }
  build() { Column() { Text('Standalone HAR consumer') } }
}
`);
  deveco(['build', '--modules', 'entry', '--build-mode', 'release'], workspace);
  console.log(`Package verified: ${manifest.name}@${manifest.version}; standalone consumer built without source checkout.`);
  const report = { package: manifest.name, version: manifest.version, upstreamVersion: upstream.version, bytes: fs.statSync(archive).size,
    sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    prepublish: 'passed', isolatedConsumerBuild: 'passed', mode: 'release', checkedAt: new Date().toISOString() };
  fs.writeFileSync(`${archive}.verification.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (process.env.KEEP_VERIFY_WORKSPACE === '1') console.log(`Verification workspace retained: ${workspace}`);
  else fs.rmSync(workspace, { recursive: true, force: true });
}
