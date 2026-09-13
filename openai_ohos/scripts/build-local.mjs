import fs from 'node:fs';
import path from 'node:path';
import { root, run, deveco } from './toolchain.mjs';

console.log('=== 开始本地打包 openai_ohos.har ===');

// 1. 确保 SDK 转换与运行时构建完成
if (!fs.existsSync(path.join(root, 'generated/openai.har'))) {
  console.log('正在执行依赖转换...');
  run('npm', ['run', 'convert'], root);
} else {
  console.log('正在更新运行时组件...');
  run('npm', ['run', 'build:runtime'], root);
}

// 2. 调用 DevEco 构建模块
console.log('正在调用构建工具生成 HAR 包...');
const projectRoot = path.dirname(root);
deveco(['build', '--modules', 'openai_ohos', '--build-mode', 'release'], projectRoot);

// 3. 收集并输出产物
const builtHar = path.join(root, 'build/default/outputs/default/openai_ohos.har');
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const targetHar = path.join(distDir, 'openai_ohos.har');
fs.copyFileSync(builtHar, targetHar);

const size = (fs.statSync(targetHar).size / (1024 * 1024)).toFixed(2);
console.log(`\n=== 本地打包成功！===`);
console.log(`产物文件: ${targetHar} (${size} MB)`);
console.log(`在其它鸿蒙工程的 oh-package.json5 中直接引用即可使用：`);
console.log(`"openai_ohos": "file:./libs/openai_ohos.har"`);
