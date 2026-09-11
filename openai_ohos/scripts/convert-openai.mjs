import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { transformFileSync } from '@babel/core';
import { ohpmBinary, run } from './toolchain.mjs';
import { extractArchive } from './archive.mjs';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const dependency = lock.packages['node_modules/openai'];
const ohpm = process.argv.includes('--no-har') ? undefined : ohpmBinary();
const staging = fs.mkdtempSync(path.join(root, '.openai-convert-'));
const generated = path.join(root, 'generated');

try {
  // Use the exact, integrity-checked distribution, never a possibly edited node_modules copy.
  const packed = JSON.parse(run('npm', [
    'pack', dependency.resolved, '--ignore-scripts', '--json', '--pack-destination', staging,
  ], staging, { encoding: 'utf8', stdio: 'pipe' }))[0];
  const archive = path.join(staging, packed.filename);
  const digest = `sha512-${createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
  if (digest !== dependency.integrity) throw new Error('Official tarball does not match package-lock.json integrity');

  const upstream = path.join(staging, 'upstream', 'openai');
  fs.mkdirSync(upstream, { recursive: true });
  extractArchive(archive, upstream, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  if (manifest.version !== dependency.version) throw new Error('SDK version does not match lockfile');
  if (Object.keys(manifest.dependencies ?? {}).length) {
    throw new Error('SDK now has runtime dependencies: extend the packaging pipeline before upgrading');
  }

  const output = path.join(staging, 'node_modules', 'openai');
  fs.cpSync(upstream, output, { recursive: true });
  const files = fs.readdirSync(upstream, { recursive: true }).filter(file => /\.(mjs|js)$/.test(file));
  for (const file of files) {
    const originalMap = path.join(upstream, `${file}.map`);
    const result = transformFileSync(path.join(upstream, file), {
      configFile: path.join(root, 'babel.config.json'),
      babelrc: false,
      sourceType: file.endsWith('.mjs') ? 'module' : 'commonjs',
      sourceMaps: true,
      inputSourceMap: fs.existsSync(originalMap) ? JSON.parse(fs.readFileSync(originalMap, 'utf8')) : false,
      sourceFileName: path.basename(file),
    });
    fs.writeFileSync(path.join(output, file), `${result.code}\n//# sourceMappingURL=${path.basename(file)}.map\n`);
    fs.writeFileSync(path.join(output, `${file}.map`), JSON.stringify(result.map));
  }

  // Compile mixed ESM/CommonJS into a single ESM graph. Hvigor normalizes .mjs to
  // .js and cannot represent a same-basename ESM->CJS edge (introduced upstream
  // in 7.15). Bundling/splitting handles this generically without source patches.
  const harmony = path.join(staging, 'harmony/node_modules/openai');
  fs.mkdirSync(harmony, { recursive: true });
  for (const file of fs.readdirSync(upstream, { recursive: true })) {
    const source = path.join(upstream, file);
    if (!fs.statSync(source).isFile()) continue;
    if (/\.d\.(?:ts|mts)(?:\.map)?$/.test(file) || /^(?:LICENSE|NOTICE|README.md)$/.test(file)) {
      fs.mkdirSync(path.dirname(path.join(harmony, file)), { recursive: true });
      fs.copyFileSync(source, path.join(harmony, file));
    }
  }
  const external = [...new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), ...Object.keys(manifest.peerDependencies ?? {})])];
  await build({
    absWorkingDir: upstream,
    entryPoints: files.filter(file => file.endsWith('.mjs')),
    outbase: upstream, outdir: harmony, outExtension: { '.js': '.mjs' },
    bundle: true, splitting: true, format: 'esm', platform: 'neutral',
    mainFields: ['module', 'main'], target: 'es2022', external,
    chunkNames: '_chunks/[name]-[hash]', sourcemap: true, sourcesContent: true,
    legalComments: 'inline', logLevel: 'warning',
  });
  const harmonyFiles = fs.readdirSync(harmony, { recursive: true }).filter(file => file.endsWith('.mjs'));
  for (const file of harmonyFiles) {
    const map = path.join(harmony, `${file}.map`);
    const result = transformFileSync(path.join(harmony, file), {
      configFile: path.join(root, 'babel.config.json'), babelrc: false, sourceType: 'module', sourceMaps: true,
      inputSourceMap: JSON.parse(fs.readFileSync(map, 'utf8')),
    });
    fs.writeFileSync(path.join(harmony, file), `${result.code}\n//# sourceMappingURL=${path.basename(file)}.map\n`);
    fs.writeFileSync(map, JSON.stringify(result.map));
  }
  // Metadata only: both loader conditions point to the generated ESM entry.
  const esmExports = value => typeof value === 'string' ? value.replace(/\.js$/, '.mjs') :
    Array.isArray(value) ? value.map(esmExports) : value && typeof value === 'object' ?
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, esmExports(entry)])) : value;
  fs.writeFileSync(path.join(harmony, 'package.json'), JSON.stringify({
    ...manifest, type: 'module', main: './index.mjs', module: './index.mjs', exports: esmExports(manifest.exports),
  }, null, 2));
  // Convert only the release graph; no development dependencies are included.
  if (!process.argv.includes('--no-har')) run(ohpm, ['convert', path.join(staging, 'harmony/node_modules')], staging, {
    stdio: 'inherit',
    // Avoid macOS AppleDouble metadata entries (._*.js) in the HAR archive.
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (!process.argv.includes('--no-har')) {
    const artifacts = fs.readdirSync(staging, { recursive: true }).filter(file => path.basename(file) === 'openai.har');
    if (artifacts.length !== 1) throw new Error(`Expected one openai.har, found ${artifacts.length}`);
    fs.copyFileSync(path.join(staging, artifacts[0]), path.join(staging, 'openai.har'));
  }
  for (const name of fs.readdirSync(staging)) {
    if (name.startsWith('convert_') || name === packed.filename) {
      fs.rmSync(path.join(staging, name), { recursive: true, force: true });
    }
  }
  const report = {
    version: manifest.version,
    integrity: digest,
    transformedFiles: files.length,
    harmonyESMFiles: harmonyFiles.length,
    moduleBuild: 'esbuild ESM graph with splitting; Babel object-method lowering',
    babel: lock.packages['node_modules/@babel/core'].version,
    plugin: '@babel/plugin-transform-shorthand-properties',
    optionalPeerDependencies: manifest.peerDependencies ?? {},
  };
  fs.writeFileSync(path.join(staging, 'conversion.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(generated, { recursive: true, force: true });
  fs.renameSync(staging, generated);
  console.log(`Converted official openai@${manifest.version}: ${files.length} JS files${process.argv.includes('--no-har') ? ' (portable JS validation only)' : ' → generated/openai.har'}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
