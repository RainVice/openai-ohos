import fs from 'node:fs';
import path from 'node:path';
import { root, run } from './toolchain.mjs';
const files = fs.readdirSync(path.join(root, 'scripts')).filter(file => file.endsWith('.test.mjs')).sort();
run(process.execPath, ['--test', ...files.map(file => path.join(root, 'scripts', file))]);
