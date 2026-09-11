import fs from 'node:fs';
import path from 'node:path';
import crossSpawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function run(command, args, cwd = root, options = {}) {
  const executable = /\.(?:mjs|cjs|js)$/i.test(command) ? process.execPath : command;
  const parameters = executable === command ? args : [command, ...args];
  const result = crossSpawn.sync(executable, parameters, { cwd, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${path.basename(command)} failed (${result.signal || result.status})`);
    Object.assign(error, { status: result.status, stdout: result.stdout, stderr: result.stderr });
    throw error;
  }
  return result.stdout;
}

export function executableOnPath(name, env = process.env, platform = process.platform) {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  const extensions = platform === 'win32' ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const directory of pathValue.split(platform === 'win32' ? ';' : path.delimiter)) {
    for (const extension of ['', ...extensions]) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), name + extension.toLowerCase());
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return undefined;
}

export function resolveTool(name, variable, env = process.env, platform = process.platform) {
  if (env[variable]) {
    const candidate = path.resolve(env[variable]);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`${variable} is not a file`);
    return candidate;
  }
  const found = executableOnPath(name, env, platform);
  if (found) return found;
  throw new Error(`Cannot find ${name}. Add it to PATH or set ${variable}.`);
}
export function ohpmBinary() { return resolveTool('ohpm', 'OHPM_BIN'); }
export function es2abcBinary() { return resolveTool('es2abc', 'ES2ABC_BIN'); }

export function deveco(args, cwd) {
  // DevEco CLI supports desktop toolchains. Linux CI uses explicitly configured
  // official Command Line Tools; no OS install directory is assumed.
  if (process.env.HVIGOR_BIN) {
    if (args[0] !== 'build') throw new Error('The command-line tool backend supports build only');
    const module = args[args.indexOf('--modules') + 1];
    const mode = args.includes('--build-mode') ? args[args.indexOf('--build-mode') + 1] : 'release';
    const task = module === 'entry' ? 'assembleHap' : 'assembleHar';
    const hvigor = resolveTool('hvigorw', 'HVIGOR_BIN');
    run(ohpmBinary(), ['install', '--all'], cwd);
    run(hvigor, ['--sync', '--no-daemon', '-p', 'product=default'], cwd);
    return run(hvigor, [task, '--mode', 'module', '-p', `module=${module}@default`, '-p', 'product=default', '-p', `buildMode=${mode}`, '--no-daemon'], cwd);
  }
  if (process.platform === 'linux') throw new Error('Linux builds require OHPM_BIN, ES2ABC_BIN and HVIGOR_BIN with the official HarmonyOS SDK configured.');
  return run('npx', ['-y', '--prefer-offline', '@deveco/deveco-cli', ...args], cwd);
}
export function write(workspace, relative, value) {
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}
// A standalone DevEco project: no credentials, signing files, demo, or parent checkout.
export function scaffold(workspace, modules) {
  write(workspace, 'build-profile.json5', {
    app: {
      products: [{ name: 'default', targetSdkVersion: process.env.TARGET_SDK_VERSION ?? '26.0.0',
        compatibleSdkVersion: '6.1.0(23)', runtimeOS: 'HarmonyOS',
        buildOption: { strictMode: { caseSensitiveCheck: true, useNormalizedOHMUrl: true } } }],
      buildModeSet: [{ name: 'debug' }, { name: 'release' }],
    },
    modules: modules.map(name => ({ name, srcPath: `./${name}`, ...(name === 'entry' ? { targets: [{ name: 'default', applyToProducts: ['default'] }] } : {}) })),
  });
  write(workspace, 'oh-package.json5', { modelVersion: '26.0.0', dependencies: {} });
  write(workspace, 'hvigor/hvigor-config.json5', { modelVersion: '26.0.0', dependencies: {} });
  write(workspace, 'hvigorfile.ts', "import { appTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: appTasks, plugins: [] };\n");
  write(workspace, 'AppScope/app.json5', { app: {
    bundleName: 'com.example.openaiohos.packagecheck', vendor: 'package-test', versionCode: 1, versionName: '1.0.0',
    icon: '$media:icon', label: '$string:app_name',
  } });
  write(workspace, 'AppScope/resources/base/element/string.json', { string: [{ name: 'app_name', value: 'Package verification' }] });
  write(workspace, 'AppScope/resources/base/media/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#0a59f7"/></svg>');
}
