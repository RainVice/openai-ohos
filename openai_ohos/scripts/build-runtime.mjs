import { build } from 'esbuild';
import { transformSync } from '@babel/core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ['scripts/runtime-vendor.mjs'], bundle: true,
  platform: 'neutral', mainFields: ['module', 'main'], format: 'esm', target: 'es2018', write: false, legalComments: 'inline',
});
const output = transformSync(result.outputFiles[0].text, {
  configFile: `${root}/babel.config.json`, babelrc: false, sourceType: 'module', comments: true,
});
fs.mkdirSync(`${root}/src/main/js/vendor`, { recursive: true });
fs.writeFileSync(`${root}/src/main/js/vendor/WebPrimitives.js`, output.code);
const licenses = ['web-streams-polyfill', 'abort-controller', 'event-target-shim', '@ungap/structured-clone'].map(name => {
  const directory = `${root}/node_modules/${name}`;
  const license = fs.readdirSync(directory).find(file => /^license(?:\.|$)/i.test(file));
  if (!license) throw new Error(`Missing license for ${name}`);
  return `=== ${name} ===\n${fs.readFileSync(`${directory}/${license}`, 'utf8')}`;
});
fs.mkdirSync(`${root}/src/main/resources/rawfile`, { recursive: true });
fs.writeFileSync(`${root}/src/main/resources/rawfile/runtime-licenses.txt`, licenses.join('\n\n'));
console.log('Built Web Streams, AbortController and structuredClone primitives (SDK remains unchanged)');
